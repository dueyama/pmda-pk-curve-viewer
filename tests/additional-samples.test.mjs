import assert from "node:assert/strict";
import test from "node:test";
import { parsePmdaXml } from "../src/lib/pmda-parser.ts";
import { simulateCandidate } from "../src/lib/pk-model.ts";

const sourceUrl = "https://www.pmda.go.jp/PmdaSearch/iyakuDetail/ResultDataSetXML/example";
const product = "<ApprovalEtc><DetailBrandName><ApprovalBrandName>検証用製品</ApprovalBrandName></DetailBrandName></ApprovalEtc>";

test("薬物動態欄のない正常な添文でも製品情報を返し、曲線は作らない", () => {
  for (const pharmacokinetics of ["", "<Pharmacokinetics><Absorption>検証用の吸収記載</Absorption></Pharmacokinetics>"]) {
    const data = parsePmdaXml(`<PackIns>${product}<GenericName>検証用成分</GenericName>${pharmacokinetics}</PackIns>`, sourceUrl);
    assert.deepEqual(data.productNames, ["検証用製品"]);
    assert.equal(data.genericName, "検証用成分");
    assert.deepEqual(data.candidates, []);
    assert.match(data.curveUnavailableReason, /記載がなく/);
    if (pharmacokinetics) assert.equal(data.notes[0].text, "検証用の吸収記載");
  }
  assert.throws(() => parsePmdaXml("<NotPackIns/>", sourceUrl), /PMDA電子添文/);
});

test("動物の最高時刻・消失時刻や尿中回収率だけからヒトの曲線を作らない", () => {
  const data = parsePmdaXml(`<PackIns>${product}<Pharmacokinetics>
    <BloodLevel><Detail><Lang>ラットで投与2時間後に最高となり、48時間後にはほぼ消失した。</Lang></Detail></BloodLevel>
    <Excretion><Detail><Lang>健康成人の24時間尿中回収率は6.32％。</Lang></Detail></Excretion>
  </Pharmacokinetics></PackIns>`, sourceUrl);
  assert.deepEqual(data.candidates, []);
  assert.match(data.curveUnavailableReason, /Cmax・tmax・t1\/2/);
});

test("結合されたtmax範囲を各用量へ展開し、出典の範囲と中間値の近似を保つ", () => {
  // 表構造だけの小さな入力。添文本体・画像は同梱しない。
  const cells = (values) => values.map(value => `<SimpTblCell><Detail><Lang>${value}</Lang></Detail></SimpTblCell>`).join("");
  const data = parsePmdaXml(`<PackIns><Pharmacokinetics><BloodLevel><Section><Header>単回投与</Header><TblBlock><SimpleTable>
    <SimpTblRow>${cells(["投与量", "Cmax（μg/mL）", "Tmax（hr）", "t1/2（hr）"])}</SimpTblRow>
    <SimpTblRow>${cells(["錠250mg", "3.9"])}<SimpTblCell rspan="3"><Detail><Lang>2～3</Lang></Detail></SimpTblCell>${cells(["3.1"])}</SimpTblRow>
    <SimpTblRow>${cells(["錠500mg", "6.0", "3.3"])}</SimpTblRow>
    <SimpTblRow>${cells(["カプセル500mg", "5.5", "3.3"])}</SimpTblRow>
  </SimpleTable></TblBlock></Section></BloodLevel></Pharmacokinetics></PackIns>`, sourceUrl);
  assert.equal(data.curveUnavailableReason, undefined);
  assert.deepEqual(data.candidates.map(c => [c.dose, c.cmax.mean, c.halfLife.mean]), [
    ["錠250mg", 3.9, 3.1], ["錠500mg", 6, 3.3], ["カプセル500mg", 5.5, 3.3],
  ]);
  for (const candidate of data.candidates) {
    assert.equal(candidate.tmax.raw, "2～3");
    assert.equal(candidate.tmax.mean, 2.5);
    assert.match(candidate.tmax.calculationNote, /中間値2.5 hr/);
    const result = simulateCandidate(candidate, "00:00", 1);
    assert.ok(result);
    assert.ok(result.points.every(p => Number.isFinite(p.concentration) && p.concentration >= 0));
    assert.ok(Math.abs(result.points.find(p => p.hour === 2.5).concentration - candidate.cmax.mean) < 1e-10);
  }
});

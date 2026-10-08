import assert from "node:assert/strict";
import test from "node:test";
import { parsePmdaXml } from "../src/lib/pmda-parser.ts";
import { simulateCandidate } from "../src/lib/pk-model.ts";
import { CLARIS_XML_URL } from "../src/lib/sample-reference.ts";

const cells = (values) => values.map(value => `<SimpTblCell><Detail><Lang>${value}</Lang></Detail></SimpTblCell>`).join("");
const table = (rows) => `<TblBlock><SimpleTable><SimpTblRow>${cells(["", "測定法", "Cmax（µg/mL）", "Tmax（hr）", "T1/2（hr）", "AUC（µg・hr/mL）"])}</SimpTblRow>${rows.map(row => `<SimpTblRow>${cells(row)}</SimpTblRow>`).join("")}</SimpleTable></TblBlock>`;
// 条件補足と表処理の小さな検証入力。添文・画像ファイルを保存しない。
const fixture = `<PackIns><CompanyIdentifier>400059</CompanyIdentifier><PackageInsertNo>6149003F2038_1_38</PackageInsertNo>
<ApprovalEtc><DetailBrandName><ApprovalBrandName>クラリス錠200</ApprovalBrandName></DetailBrandName></ApprovalEtc>
<Pharmacokinetics><BloodLevel><Section><Header>単回投与</Header>${table([
  ["成人（n＝8）200mg", "Bioassay", "1.16", "1.9", "4.04", "8.98"],
  ["成人（n＝8）400mg", "Bioassay", "2.24", "2.7", "4.36", "20.30"],
])}</Section><Section><Header>反復投与</Header>${table([
  ["成人400mg併用時", "HPLC 未変化体", "2.42", "2.7", "4.4", "18.45"],
])}</Section></BloodLevel></Pharmacokinetics></PackIns>`;

test("クラリスの単回Bioassay値に測定条件を付け、反復・併用値は計算から除く", () => {
  const data = parsePmdaXml(fixture, CLARIS_XML_URL);
  assert.deepEqual(data.candidates.slice(0, 2).map(c => [c.dose, c.cmax.mean, c.tmax.mean, c.halfLife.mean]), [
    ["200mg（力価）", 1.16, 1.9, 4.04], ["400mg（力価）", 2.24, 2.7, 4.36],
  ]);
  assert.match(data.modelReference.formulationNote, /未変化体だけ.*活性代謝物/);
  for (const candidate of data.candidates.slice(0, 2)) {
    assert.match(candidate.label, /空腹時単回.*Bioassay.*n=8/);
    assert.ok(simulateCandidate(candidate, "08:00,20:00", 5));
    assert.equal(candidate.allowSlowAbsorption, undefined);
  }
  assert.ok(data.candidates[2].modelExclusionReason);
  assert.equal(simulateCandidate(data.candidates[2], "08:00", 5), null);
});

test("クラリス以外の製品・未確認の改訂版・異なる測定法へ条件を流用しない", () => {
  for (const changed of [fixture.replace("400059", "999999"), fixture.replace("_1_38", "_1_39"), fixture.replace("クラリス錠200", "別製品")]) {
    assert.equal(parsePmdaXml(changed, CLARIS_XML_URL).modelReference, undefined);
  }
  const data = parsePmdaXml(fixture.replaceAll("Bioassay", "HPLC"), CLARIS_XML_URL);
  assert.equal(data.modelReference, undefined);
  assert.doesNotMatch(data.candidates[0].label, /空腹時/);
  assert.equal(data.candidates[0].dose, "成人（n＝8）200mg");
});

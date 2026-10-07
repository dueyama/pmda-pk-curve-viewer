import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parsePmdaXml, parsePmdaZip } from "../src/lib/pmda-parser.ts";
import { simulateCandidate } from "../src/lib/pk-model.ts";
import { MEIACT_XML_URL } from "../src/lib/sample-reference.ts";

// 表構造の小さな検証入力。PMDA文書本体は同梱しない。
const fixture = `<PackIns>
<CompanyIdentifier>780009</CompanyIdentifier><PackageInsertNo>6132015F1037_1_11</PackageInsertNo>
<ApprovalEtc><DetailBrandName><ApprovalBrandName>メイアクトMS錠100mg</ApprovalBrandName></DetailBrandName></ApprovalEtc>
<Pharmacokinetics><BloodLevel><Detail><Header>単回投与（旧錠剤）</Header><TblBlock>
<TblCaption>表1　健康成人の薬物動態パラメータ</TblCaption><SimpleTable>
<SimpTblRow><SimpTblCell>投与量（mg）</SimpTblCell><SimpTblCell>Tmax（hr）</SimpTblCell><SimpTblCell>Cmax（μg/mL）</SimpTblCell><SimpTblCell>T<Sub>1/2</Sub>（hr）</SimpTblCell><SimpTblCell>AUC<Sub>0→∞</Sub>（μg・hr/mL）</SimpTblCell></SimpTblRow>
<SimpTblRow><SimpTblCell>100</SimpTblCell><SimpTblCell>1.4</SimpTblCell><SimpTblCell>1.66</SimpTblCell><SimpTblCell>0.80</SimpTblCell><SimpTblCell>3.67</SimpTblCell></SimpTblRow>
<SimpTblRow><SimpTblCell>200</SimpTblCell><SimpTblCell>2.0</SimpTblCell><SimpTblCell>3.44</SimpTblCell><SimpTblCell>1.06</SimpTblCell><SimpTblCell>10.02</SimpTblCell></SimpTblRow>
</SimpleTable></TblBlock></Detail></BloodLevel></Pharmacokinetics></PackIns>`
  .replaceAll("<SimpTblCell>", "<SimpTblCell><Detail><Lang>")
  .replaceAll("</SimpTblCell>", "</Lang></Detail></SimpTblCell>");

function verifyMeiact(data) {
  assert.deepEqual(data.candidates.map(c => [c.dose, c.tmax.mean, c.cmax.mean, c.halfLife.mean, c.auc.mean]), [
    ["100mg（力価）", 1.4, 1.66, 0.8, 3.67],
    ["200mg（力価）", 2, 3.44, 1.06, 10.02],
  ]);
  for (const c of data.candidates) {
    assert.equal(c.cmax.unit, "μg/mL");
    assert.equal(c.tmax.unit, "hr");
    assert.equal(c.halfLife.unit, "hr");
    assert.equal(c.auc.unit, "μg・hr/mL");
    assert.match(c.label, /健康成人.*旧錠剤.*食後単回/);
  }
  assert.match(data.modelReference.concentrationLabel, /セフジトレン.*総濃度/);
  assert.match(data.modelReference.studyCondition, /n=5/);
  assert.match(data.modelReference.formulationNote, /生物学的同等性/);
  assert.match(data.modelReference.limitations, /小児用細粒、空腹時、腎機能障害/);
  assert.equal(data.sourceUrl, MEIACT_XML_URL);
}

const data = parsePmdaXml(fixture, MEIACT_XML_URL);

test("100mgと200mgを別条件として抽出し、活性体・力価・条件を付ける", () => verifyMeiact(data));

test("他製品・未確認の改訂版にメイアクトの補足条件を付けない", () => {
  for (const changed of [fixture.replace("780009", "999999"), fixture.replace("_1_11", "_1_12"), fixture.replace("メイアクトMS錠100mg", "別製品")]) {
    const other = parsePmdaXml(changed, MEIACT_XML_URL);
    assert.equal(other.modelReference, undefined);
    assert.equal(other.candidates[0].dose, "100");
  }
});

test("実PMDA ZIPの取得・解析結果も同じ値と条件を持つ", { skip: !process.env.PMDA_MEIACT_ZIP }, () => {
  const bytes = readFileSync(process.env.PMDA_MEIACT_ZIP);
  verifyMeiact(parsePmdaZip(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), MEIACT_XML_URL));
});

function concentrationAt(result, t) {
  const shape = result.ka === result.ke
    ? result.ke * t * Math.exp(-result.ke * t)
    : Math.abs(Math.exp(-result.ke * t) - Math.exp(-result.ka * t));
  return result.scale * shape;
}

test("両用量の連続曲線がTmaxでCmaxに達し、描画点は非負・有限", () => {
  assert.equal(data.candidates.length, 2);
  for (const c of data.candidates) {
    const r = simulateCandidate(c, "00:00", 1);
    assert.ok(r);
    assert.ok(Math.abs(r.ke - Math.log(2) / c.halfLife.mean) < 1e-12);
    assert.ok(Math.abs(Math.log(r.ka / r.ke) / (r.ka - r.ke) - c.tmax.mean) < 1e-10);
    assert.ok(Math.abs(concentrationAt(r, c.tmax.mean) - c.cmax.mean) < 1e-10);
    assert.ok(concentrationAt(r, c.tmax.mean - 0.05) < c.cmax.mean);
    assert.ok(concentrationAt(r, c.tmax.mean + 0.05) < c.cmax.mean);
    assert.ok(r.points.every(p => Number.isFinite(p.concentration) && p.concentration >= 0));
    assert.ok(Math.abs(r.peak / c.cmax.mean - 1) < 0.01); // 描画間隔は0.5時間。
    assert.ok(r.ka < r.ke);
    assert.match(r.warnings.join(" "), /曲線の後半.*半減期より緩やか/);
  }
});

test("反復投与は各単回曲線の加算、倍率は線形の概算", () => {
  const c = data.candidates[0];
  const r = simulateCandidate(c, "08:00, 14:00, 20:00", 5);
  assert.equal(r.doses.length, 15);
  for (const p of r.points) {
    const expected = r.doses.reduce((sum, dose) => sum + (p.hour >= dose.hour ? concentrationAt(r, p.hour - dose.hour) : 0), 0);
    assert.ok(Math.abs(p.concentration - expected) < 1e-10);
  }
  const doubled = simulateCandidate(c, "08:00, 14:00, 20:00", 5, 2);
  assert.ok(doubled.points.every((p, i) => Math.abs(p.concentration - r.points[i].concentration * 2) < 1e-10));
  assert.match(doubled.warnings.join(" "), /線形.*簡略仮定/);
  // 200mgの実測パラメータは100mgの単純な2倍に置き換えない。
  assert.notEqual(data.candidates[1].cmax.mean, c.cmax.mean * 2);
});

test("分・日の時間単位を換算し、ka=keの極限も有限", () => {
  const c = data.candidates[0];
  const hours = simulateCandidate(c, "00:00", 1);
  const converted = simulateCandidate({ ...c, tmax: { ...c.tmax, mean: 84, unit: "min" }, halfLife: { ...c.halfLife, mean: 0.8 / 24, unit: "日" } }, "00:00", 1);
  assert.deepEqual(converted.points, hours.points);
  const limit = simulateCandidate({ ...c, tmax: { ...c.tmax, mean: 0.8 / Math.log(2) } }, "00:00", 1);
  assert.equal(limit.ka, limit.ke);
  assert.ok(limit.points.every(p => Number.isFinite(p.concentration) && p.concentration >= 0));
  assert.ok(Math.abs(concentrationAt(limit, 1 / limit.ke) - c.cmax.mean) < 1e-10);
});

test("非正・非有限値や無効な時刻から曲線を作らない", () => {
  for (const key of ["cmax", "tmax", "halfLife"]) {
    for (const mean of [-1, 0, NaN, Infinity]) {
      const c = data.candidates[0];
      assert.equal(simulateCandidate({ ...c, [key]: { ...c[key], mean } }, "00:00", 1), null);
    }
  }
  assert.equal(simulateCandidate(data.candidates[0], "24:00", 1), null);
  assert.equal(simulateCandidate(data.candidates[0], "00:00", Infinity), null);
});

test("補足のない既存候補は従来のka近似を保持する", () => {
  const legacy = simulateCandidate({ ...data.candidates[0], allowSlowAbsorption: undefined }, "00:00", 1);
  assert.equal(legacy.ka, legacy.ke * 1.001);
  assert.match(legacy.warnings.join(" "), /ka は ke に近い値/);
  const allegra = simulateCandidate({
    ...data.candidates[0], allowSlowAbsorption: undefined,
    cmax: { raw: "248", mean: 248, unit: "ng/mL" },
    tmax: { raw: "2.2", mean: 2.2, unit: "h" },
    halfLife: { raw: "9.6", mean: 9.6, unit: "h" },
  }, "00:00", 1);
  assert.equal(allegra.ka, 1.4291980637973754); // 修正前の実XMLの60mg候補。
  assert.equal(allegra.ke, 0.07220283130832764);
});

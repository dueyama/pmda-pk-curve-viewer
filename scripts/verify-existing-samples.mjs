import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { parsePmdaZip } from "../src/lib/pmda-parser.ts";
import { simulateCandidate } from "../src/lib/pk-model.ts";

const [baselineRef, xmlDirectory] = process.argv.slice(2);
if (!baselineRef || !xmlDirectory) {
  throw new Error("使い方: npm run test:regression -- <比較元Gitリビジョン> <番号付きZIPのフォルダ>");
}

const baselineSource = (path) => execFileSync("git", ["show", `${baselineRef}:${path}`], { encoding: "utf8" });
async function baselineModule(path) {
  let code = ts.transpileModule(baselineSource(path), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  for (const dependency of ["fast-xml-parser", "fflate"]) {
    code = code.replaceAll(`from "${dependency}"`, `from ${JSON.stringify(import.meta.resolve(dependency))}`);
  }
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

const viewer = baselineSource("src/components/pk-viewer.tsx");
const sampleUrl = viewer.match(/const SAMPLE_URL =\s*"([^"]+)"/)[1];
const array = viewer.match(/const EXAMPLE_DRUGS = (\[[\s\S]*?\n\]) as const;/)[1];
// 比較元の自リポジトリの固定配列だけを評価する。XML内容はコードとして評価しない。
const drugs = vm.runInNewContext(array, { SAMPLE_URL: sampleUrl });
const oldParser = await baselineModule("src/lib/pmda-parser.ts");
const oldModel = await baselineModule("src/lib/pk-model.ts");
const reports = [];

function parseOutcome(parser, buffer, url) {
  try {
    return { data: parser(buffer, url) };
  } catch (error) {
    return { error: error.message };
  }
}

for (const [index, drug] of drugs.entries()) {
  const bytes = readFileSync(join(xmlDirectory, `${index}.zip`));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const previous = parseOutcome(oldParser.parsePmdaZip, buffer, drug.url);
  const current = parseOutcome(parsePmdaZip, buffer, drug.url);
  assert.deepEqual(current, previous, `${drug.name}: 解析結果`);
  if (current.error) {
    reports.push({ name: drug.name, error: current.error, unchanged: true });
    continue;
  }
  let simulations = 0;
  for (const candidate of current.data.candidates) {
    for (const [times, days, multiplier, jitter] of [
      ["00:00", 1, 1, 0],
      ["08:00,20:00", 5, 1, 0],
      ["08:00,14:00,20:00", 60, 2, 0.5],
    ]) {
      assert.deepEqual(
        simulateCandidate(candidate, times, days, multiplier, jitter),
        oldModel.simulateCandidate(candidate, times, days, multiplier, jitter),
        `${drug.name}: ${candidate.label}・${days}日`,
      );
      simulations += 1;
    }
  }
  reports.push({ name: drug.name, candidates: current.data.candidates.length, simulations, unchanged: true });
}
process.stdout.write(`${JSON.stringify({ baselineRef, reports }, null, 2)}\n`);

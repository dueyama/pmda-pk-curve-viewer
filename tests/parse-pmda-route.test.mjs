import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { NextRequest } from "next/server.js";

let source = readFileSync(new URL("../src/app/api/parse-pmda/route.ts", import.meta.url), "utf8");
source = source.replace('from "next/server"', `from ${JSON.stringify(import.meta.resolve("next/server.js"))}`);
// 取得境界を検証する。XML解析自体はメイアクト試験で別に検証する。
source = source.replace('import { parsePmdaZip } from "@/lib/pmda-parser";', 'const parsePmdaZip = () => ({ candidates: [] });');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const { POST } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
const url = "https://www.pmda.go.jp/PmdaSearch/iyakuDetail/ResultDataSetXML/example";
const request = (value = url) => new NextRequest("http://localhost/api/parse-pmda", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: value }),
});

test("取得境界: HTTP 200 HTML・空応答を502にし、octet-stream ZIPを受け入れる", async () => {
  const original = globalThis.fetch;
  try {
    for (const body of ["<html>URLに誤りがあります</html>", ""]) {
      globalThis.fetch = async () => new Response(body, { headers: { "Content-Type": "text/html" } });
      const response = await POST(request());
      assert.equal(response.status, 502);
      assert.match((await response.json()).error, /最新のXML URL/);
    }
    globalThis.fetch = async () => new Response(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), { headers: { "Content-Type": "application/octet-stream" } });
    assert.equal((await POST(request())).status, 200);
    globalThis.fetch = async () => new Response("", { status: 404 });
    assert.equal((await POST(request())).status, 502);
    globalThis.fetch = async () => { throw new Error("外部URLを取得してはいけない"); };
    const rejected = await POST(request("https://example.com/"));
    assert.equal(rejected.status, 400);
    assert.match((await rejected.json()).error, /許可されているのは/);
  } finally {
    globalThis.fetch = original;
  }
});

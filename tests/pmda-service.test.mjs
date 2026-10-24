import assert from "node:assert/strict";
import test from "node:test";
import { createPmdaPostHandler } from "../src/lib/pmda-service.ts";
import { PmdaError } from "../src/lib/pmda-errors.ts";

const url = "https://www.pmda.go.jp/PmdaSearch/iyakuDetail/ResultDataSetXML/780009_6132015F1037_1_11";
const other = url.replace("780009", "400059");
const bytes = new ArrayBuffer(4);
const request = (value = url, init = {}) => new Request("http://localhost/api/parse-pmda", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: value }), ...init,
});
const data = { candidates: [], productNames: ["検証用"], sourceUrl: url };
const fresh = (options = {}) => createPmdaPostHandler({ download: async () => bytes, parse: () => data, ...options });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
const nextTick = () => new Promise(resolve => setImmediate(resolve));

test("正常応答の形式を保持し、認証追加やクライアントcacheを行わない", async () => {
  const response = await fresh()(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), data);
});

test("入力の型・URL・Content-Type・実受信量を、外部取得より前に拒否する", async () => {
  let fetches = 0;
  const handler = fresh({ download: async () => { fetches++; return bytes; } });
  for (const bad of [
    request("https://example.com/"), request(null), request(url, { body: "null" }), request(url, { body: "{" }),
    request(url, { headers: { "Content-Type": "text/plain" } }),
    request(url, { headers: { "Content-Type": "application/json", "Content-Length": "9000" } }),
    request(url, { body: " ".repeat(4097) }),
  ]) assert.ok((await handler(bad)).status >= 400);
  assert.equal(fetches, 0);
});

test("小さなstreamでも宣言値に依存せず受信中に容量を打ち切る", async () => {
  let canceled = false;
  const stream = new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode("123456789")); },
    cancel() { canceled = true; },
  });
  const response = await fresh({ limits: { requestBytes: 8 } })(request(url, { body: stream, duplex: "half" }));
  assert.equal(response.status, 413);
  assert.equal((await response.json()).errorCode, "REQUEST_TOO_LARGE");
  assert.ok(canceled);
});

test("遅い入力のtimeout後にも要求枠を解放する", async () => {
  let canceled = false;
  const handler = fresh({ limits: { activeRequests: 1, bodyTimeoutMs: 10 } });
  const stream = new ReadableStream({ cancel() { canceled = true; } });
  assert.equal((await handler(request(url, { body: stream, duplex: "half" }))).status, 408);
  assert.ok(canceled);
  assert.equal((await handler(request())).status, 200);
});

test("同一取得を共有し、cacheのTTL・LRUを有界にする", async () => {
  let now = 0, fetches = 0;
  const waiting = deferred();
  const handler = fresh({
    now: () => now, limits: { cacheEntries: 1, cacheTtlMs: 50 },
    download: async () => { fetches++; if (fetches === 1) await waiting.promise; return bytes; },
  });
  const one = handler(request()), two = handler(request());
  await nextTick();
  assert.equal(fetches, 1);
  waiting.resolve();
  assert.deepEqual((await Promise.all([one, two])).map(r => r.status), [200, 200]);
  assert.equal((await handler(request())).status, 200);
  assert.equal(fetches, 1);
  await handler(request(other));
  await handler(request());
  assert.equal(fetches, 3);
  now = 51;
  await handler(request());
  assert.equal(fetches, 4);
});

test("異なる取得の同時上限と、エラー後の枠解放", async () => {
  const waiting = deferred();
  let fetches = 0;
  const handler = fresh({
    limits: { activeFetches: 1 },
    download: async () => { fetches++; if (fetches === 1) await waiting.promise; return bytes; },
  });
  const one = handler(request());
  await nextTick();
  const busy = await handler(request(other));
  assert.equal(busy.status, 429);
  assert.equal((await busy.json()).errorCode, "BUSY");
  waiting.reject(new Error("private configuration must never escape"));
  assert.equal((await one).status, 502);
  assert.equal((await handler(request(other))).status, 200);
});

test("要求回数と外部取得予算は別々に制限し、期限後に回復する", async () => {
  let now = 0;
  const limited = fresh({ now: () => now, limits: { requestsPerMinute: 1 } });
  assert.equal((await limited(request())).status, 200);
  const denied = await limited(request());
  assert.equal(denied.status, 429);
  assert.equal(denied.headers.get("Retry-After"), "60");
  now = 60_001;
  assert.equal((await limited(request())).status, 200);
  const budget = fresh({ limits: { fetchesPerMinute: 1 } });
  assert.equal((await budget(request())).status, 200);
  assert.equal((await budget(request())).status, 200);
  assert.equal((await (await budget(request(other))).json()).errorCode, "UPSTREAM_BUDGET");
});

test("timeout・解析例外を分類し、生の内部情報を応答しない", async () => {
  const secret = "private-url-and-configuration";
  for (const options of [
    { download: async () => { throw new Error(secret); } },
    { parse: () => { throw new Error(secret); } },
    { download: async () => { throw new PmdaError("UPSTREAM_TIMEOUT"); } },
  ]) {
    const response = await fresh(options)(request());
    assert.ok([422, 502, 504].includes(response.status));
    const text = await response.text();
    assert.ok(!text.includes(secret));
    assert.ok(!text.includes("stack"));
  }
});

test("応答容量超過と、入力中の同時要求上限", async () => {
  assert.equal((await fresh({ limits: { responseBytes: 8 } })(request())).status, 502);
  const escaped = await fresh({ parse: () => ({ text: "\n".repeat(16) }), limits: { responseBytes: 32 } })(request());
  assert.equal((await escaped.json()).errorCode, "DATA_TOO_LARGE");
  const handler = fresh({ limits: { activeRequests: 1, bodyTimeoutMs: 10 } });
  const one = handler(request(url, { body: new ReadableStream(), duplex: "half" }));
  assert.equal((await handler(request())).status, 429);
  await one;
  assert.equal((await handler(request())).status, 200);
});

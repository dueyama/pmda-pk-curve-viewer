import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { isPublicAddress, createPublicLookup, downloadPmdaZip, validatePmdaUrl } from "../src/lib/pmda-network.ts";

const url = "https://www.pmda.go.jp/PmdaSearch/iyakuDetail/ResultDataSetXML/780009_6132015F1037_1_11";
const valid = () => validatePmdaUrl(url);
const prefix = Buffer.from([0x50, 0x4b, 3, 4]);

test("PMDAの正確なoriginと文書IDだけを許可する（接続しない）", () => {
  assert.equal(valid().href, url);
  assert.equal(validatePmdaUrl(url.replace(".jp/", ".jp:443/")).href, url);
  for (const value of [
    null, "", "https://example.com/", url.replace("https:", "http:"),
    url.replace(".go.jp/", ".go.jp.example.com/"), url.replace(".jp/", ".jp:444/"),
    url.replace("https://", "https://name:password@"), url + "?test=1", url + "#part",
    url + "/extra", url.replace("780009", "%37%38%30%30%30%39"), url.replace("780009", "example"),
  ]) assert.throws(() => validatePmdaUrl(value), e => e.code === "INVALID_URL");
});

test("private/loopback/link-local/reserved/mappedの宛先をオフラインで拒否する", () => {
  for (const address of [
    "0.0.0.0", "10.1.2.3", "100.100.100.200", "127.0.0.1", "169.254.169.254",
    "172.16.0.1", "172.31.255.255", "192.168.1.1", "192.0.2.1", "198.18.0.1",
    "198.51.100.1", "203.0.113.1", "224.0.0.1", "255.255.255.255",
    "::", "::1", "::ffff:127.0.0.1", "::ffff:8.8.8.8", "64:ff9b::a00:1",
    "fc00::1", "fe80::1", "fe80::1%lo0", "ff02::1", "2001:db8::1",
    "2001::1", "2002:7f00:1::", "3fff::1", "not-an-address",
  ]) assert.equal(isPublicAddress(address), false, address);
  for (const address of ["8.8.8.8", "1.1.1.1", "2001:4860:4860::8888", "2606:4700:4700::1111"]) {
    assert.equal(isPublicAddress(address), true, address);
  }
});

const lookupResult = (lookup, host = "www.pmda.go.jp", all = true) => new Promise((resolve, reject) =>
  lookup(host, { all }, (error, address, family) => error ? reject(error) : resolve({address, family})));

test("接続用lookupで検査結果を直接返し、混在DNSや再解決を許さない", async () => {
  let calls = 0;
  const lookup = createPublicLookup(async () => {
    calls++;
    return calls === 1 ? [{address:"8.8.8.8",family:4}] : [{address:"127.0.0.1",family:4}];
  });
  assert.deepEqual((await lookupResult(lookup)).address, [{address:"8.8.8.8",family:4}]);
  assert.equal(calls, 1);
  await assert.rejects(lookupResult(lookup), e => e.code === "UPSTREAM_UNAVAILABLE");
  await assert.rejects(lookupResult(createPublicLookup(async () => [
    {address:"8.8.8.8",family:4}, {address:"10.0.0.1",family:4},
  ])));
  await assert.rejects(lookupResult(lookup, "example.com"));
  assert.equal(calls, 2);
  assert.equal((await lookupResult(createPublicLookup(async () => [{address:"8.8.8.8",family:4}]), undefined, false)).address, "8.8.8.8");
});

function mockRequest({status = 200, headers = {}, chunks = [prefix], hang = false, error = false} = {}) {
  const state = { calls: 0, destroyed: false, delivered: 0, options: null };
  const request = (_url, options, respond) => {
    state.calls++; state.options = options;
    const req = new EventEmitter(), res = new EventEmitter();
    res.statusCode = status; res.headers = headers; res.complete = false;
    req.destroy = res.destroy = () => { state.destroyed = true; };
    req.end = () => queueMicrotask(() => {
      if (error) { req.emit("error", new Error("internal-detail")); return; }
      if (hang) return;
      respond(res);
      for (const chunk of chunks) {
        if (state.destroyed) break;
        state.delivered++; res.emit("data", chunk);
      }
      if (!state.destroyed) { res.complete = true; res.emit("end"); res.emit("close"); }
    });
    return req;
  };
  return {request, state};
}

test("https requestに実接続lookupを渡し、接続再利用なし・TLS検証を保持する", async () => {
  const mock = mockRequest({chunks:[prefix.subarray(0,2),prefix.subarray(2)]});
  const lookup = createPublicLookup(async () => [{address:"8.8.8.8",family:4}]);
  assert.deepEqual(new Uint8Array(await downloadPmdaZip(valid(), {request:mock.request,lookup})), new Uint8Array(prefix));
  assert.equal(mock.state.options.lookup, lookup);
  assert.equal(mock.state.options.agent, false);
  assert.equal(mock.state.options.servername, "www.pmda.go.jp");
  assert.equal(mock.state.options.rejectUnauthorized, undefined);
});

test("Locationは外部/内部/同一hostでも接続せず拒否する", async () => {
  for (const location of ["https://example.com/", "http://127.0.0.1/", url]) {
    const mock = mockRequest({status:302,headers:{location}});
    await assert.rejects(downloadPmdaZip(valid(), {request:mock.request}), e=>e.code==="REDIRECT_BLOCKED");
    assert.equal(mock.state.calls, 1);
    assert.ok(mock.state.destroyed);
    assert.equal(mock.state.delivered, 0);
  }
});

test("宣言サイズと実受信量・ZIP署名を受信中に制限する", async () => {
  const declared = mockRequest({headers:{"content-length":"9"}});
  await assert.rejects(downloadPmdaZip(valid(),{request:declared.request,maxBytes:8}), e=>e.code==="DATA_TOO_LARGE");
  assert.equal(declared.state.delivered,0);
  const chunked = mockRequest({chunks:[prefix,Buffer.alloc(5),Buffer.alloc(1)]});
  await assert.rejects(downloadPmdaZip(valid(),{request:chunked.request,maxBytes:8}), e=>e.code==="DATA_TOO_LARGE");
  assert.equal(chunked.state.delivered,2);
  const html = mockRequest({chunks:[Buffer.from("<html>"),Buffer.from("not consumed")]});
  await assert.rejects(downloadPmdaZip(valid(),{request:html.request}), e=>e.code==="INVALID_DATASET");
  assert.equal(html.state.delivered,1);
});

test("DNS/TLS待ち相当の全体timeoutとネットワークエラーを分類する", async () => {
  const hanging=mockRequest({hang:true});
  await assert.rejects(downloadPmdaZip(valid(),{request:hanging.request,timeoutMs:10}), e=>e.code==="UPSTREAM_TIMEOUT");
  assert.ok(hanging.state.destroyed);
  await assert.rejects(downloadPmdaZip(valid(),{request:mockRequest({error:true}).request}), e=>e.code==="UPSTREAM_UNAVAILABLE");
});

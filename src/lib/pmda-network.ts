import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpsRequest, type RequestOptions } from "node:https";
import type { IncomingMessage, ClientRequest } from "node:http";
import { isIP } from "node:net";
import { PMDA_LIMITS } from "./pmda-limits";
import { PmdaError } from "./pmda-errors";

const HOST = "www.pmda.go.jp";
const DATASET_PATH = /^\/PmdaSearch\/iyakuDetail\/ResultDataSetXML\/[0-9]{6}_[0-9A-Z]{12}_[0-9]+_[0-9]+$/;

export function validatePmdaUrl(value: unknown): URL {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > PMDA_LIMITS.urlBytes) {
    throw new PmdaError("INVALID_URL");
  }
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new PmdaError("INVALID_URL"); }
  if (url.protocol !== "https:" || url.hostname !== HOST || url.port !== "" ||
      url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "" ||
      !DATASET_PATH.test(url.pathname)) {
    throw new PmdaError("INVALID_URL");
  }
  return url;
}

function ipv4Number(address: string): number {
  return address.split(".").reduce((number, part) => number * 256 + Number(part), 0);
}

function ipv6Number(address: string): bigint {
  const [left, right] = address.split("::");
  const a = left ? left.split(":") : [];
  const b = right ? right.split(":") : [];
  const parts = address.includes("::") ? [...a, ...Array(8 - a.length - b.length).fill("0"), ...b] : a;
  return BigInt("0x" + parts.map(part => part.padStart(4, "0")).join(""));
}

// 特殊用途は保守的に拒否する。mapped/NAT64/6to4やzone付き表現も許可しない。
export function isPublicAddress(address: string): boolean {
  if (address.includes("%")) return false;
  const family = isIP(address);
  if (family === 4) {
    const value = ipv4Number(address);
    const blocked: [string, number][] = [
      ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
      ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24],
      ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
      ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
      ["224.0.0.0", 4], ["240.0.0.0", 4],
    ];
    return !blocked.some(([base, bits]) => {
      const blockSize = 2 ** (32 - bits);
      return Math.floor(value / blockSize) === Math.floor(ipv4Number(base) / blockSize);
    });
  }
  if (family !== 6 || address.includes(".")) return false;
  const value = ipv6Number(address);
  const inRange = (base: string, bits: number) =>
    value >> BigInt(128 - bits) === ipv6Number(base) >> BigInt(128 - bits);
  return inRange("2000::", 3) &&
    ![["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20]]
      .some(([base, bits]) => inRange(String(base), Number(bits)));
}

type Address = { address: string; family: number };
type Resolver = (hostname: string) => Promise<Address[]>;

// 検査した結果をhttps.requestの実接続lookupへ返す。事前照会と別の再解決を行わない。
export function createPublicLookup(resolve: Resolver = hostname => dnsLookup(hostname, { all: true })) {
  const lookup: NonNullable<RequestOptions["lookup"]> = (hostname, options, callback) => {
    if (hostname !== HOST) {
      callback(new PmdaError("UPSTREAM_UNAVAILABLE"), "", 4);
      return;
    }
    void resolve(hostname).then(addresses => {
      if (!addresses.length || addresses.some(a => isIP(a.address) !== a.family || !isPublicAddress(a.address))) {
        throw new PmdaError("UPSTREAM_UNAVAILABLE");
      }
      const approved = addresses.map(a => ({ address: a.address, family: a.family }));
      if (options.all) callback(null, approved);
      else callback(null, approved[0].address, approved[0].family);
    }).catch(() => callback(new PmdaError("UPSTREAM_UNAVAILABLE"), "", 4));
  };
  return lookup;
}

type RequestFactory = (url: URL, options: RequestOptions, callback: (response: IncomingMessage) => void) => ClientRequest;
type DownloadOptions = {
  timeoutMs?: number;
  maxBytes?: number;
  request?: RequestFactory;
  lookup?: NonNullable<RequestOptions["lookup"]>;
};

export function downloadPmdaZip(input: URL, options: DownloadOptions = {}): Promise<ArrayBuffer> {
  const url = validatePmdaUrl(input.toString());
  const maxBytes = options.maxBytes ?? PMDA_LIMITS.zipBytes;
  const timeoutMs = options.timeoutMs ?? PMDA_LIMITS.fetchTimeoutMs;
  const request = options.request ?? httpsRequest;
  return new Promise((resolve, reject) => {
    let settled = false;
    let response: IncomingMessage | undefined;
    let req: ClientRequest | undefined;
    const finish = (error?: PmdaError, data?: Buffer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        response?.destroy();
        req?.destroy();
        reject(error);
      } else if (data) {
        resolve(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
      }
    };
    // DNS/TLS/ヘッダー/受信全体のdeadline。ソケットの無通信時間だけではない。
    const timer = setTimeout(() => finish(new PmdaError("UPSTREAM_TIMEOUT")), timeoutMs);
    try {
      req = request(url, {
        method: "GET",
        agent: false,
        servername: HOST,
        lookup: options.lookup ?? createPublicLookup(),
        headers: { "User-Agent": "pmda-pk-viewer/0.1 educational parser", "Accept-Encoding": "identity" },
      }, res => {
        response = res;
        if (settled) { res.destroy(); return; }
        const status = res.statusCode ?? 0;
        // このデータセットで必要と確認された転送はない。Locationへは接続しない。
        if (status >= 300 && status < 400) { finish(new PmdaError("REDIRECT_BLOCKED")); return; }
        if (status !== 200) { finish(new PmdaError("UPSTREAM_UNAVAILABLE")); return; }
        const length = res.headers["content-length"];
        if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
          finish(new PmdaError("DATA_TOO_LARGE")); return;
        }
        if (res.headers["content-encoding"] && res.headers["content-encoding"] !== "identity") {
          finish(new PmdaError("INVALID_DATASET")); return;
        }
        let received = 0;
        let prefix = Buffer.alloc(0);
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          if (settled) return;
          received += chunk.byteLength;
          if (received > maxBytes) { finish(new PmdaError("DATA_TOO_LARGE")); return; }
          if (prefix.length < 4) {
            prefix = Buffer.concat([prefix, chunk.subarray(0, 4 - prefix.length)]);
            if (prefix.length === 4 && !prefix.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
              finish(new PmdaError("INVALID_DATASET")); return;
            }
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          if (received < 4 || (length !== undefined && received !== Number(length))) {
            finish(new PmdaError("INVALID_DATASET"));
          } else finish(undefined, Buffer.concat(chunks, received));
        });
        res.on("error", () => finish(new PmdaError("UPSTREAM_UNAVAILABLE")));
        res.on("aborted", () => finish(new PmdaError("UPSTREAM_UNAVAILABLE")));
        res.on("close", () => { if (!res.complete) finish(new PmdaError("UPSTREAM_UNAVAILABLE")); });
      });
      req.on("error", () => finish(new PmdaError("UPSTREAM_UNAVAILABLE")));
      req.end();
    } catch {
      finish(new PmdaError("UPSTREAM_UNAVAILABLE"));
    }
  });
}

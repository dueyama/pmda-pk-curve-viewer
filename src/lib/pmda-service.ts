import { PMDA_LIMITS, type PmdaLimits } from "./pmda-limits";
import { PMDA_ERRORS, PmdaError } from "./pmda-errors";
import { downloadPmdaZip, validatePmdaUrl } from "./pmda-network";
import { parsePmdaZip } from "./pmda-parser";

type Dependencies = {
  download?: typeof downloadPmdaZip;
  parse?: typeof parsePmdaZip;
  now?: () => number;
  limits?: Partial<PmdaLimits>;
};

class WindowBudget {
  private timestamps: number[] = [];
  private readonly count: number;
  private readonly windowMs: number;
  constructor(count: number, windowMs: number) { this.count = count; this.windowMs = windowMs; }
  retryAfter(now: number): number {
    while (this.timestamps.length && this.timestamps[0] <= now - this.windowMs) this.timestamps.shift();
    return this.timestamps.length < this.count ? 0 : Math.max(1, Math.ceil((this.timestamps[0] + this.windowMs - now) / 1000));
  }
  spend(now: number) { this.timestamps.push(now); }
}

async function readBody(request: Request, limits: PmdaLimits): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) {
    throw new PmdaError("UNSUPPORTED_MEDIA");
  }
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > limits.requestBytes)) {
    throw new PmdaError("REQUEST_TOO_LARGE");
  }
  if (!request.body) throw new PmdaError("INVALID_REQUEST");
  const reader = request.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new PmdaError("REQUEST_TIMEOUT")), limits.bodyTimeoutMs);
  });
  const chunks: Uint8Array[] = [];
  let size = 0;
  let completed = false;
  try {
    for (;;) {
      const part = await Promise.race([reader.read(), deadline]);
      if (part.done) { completed = true; break; }
      size += part.value.byteLength;
      if (size > limits.requestBytes) throw new PmdaError("REQUEST_TOO_LARGE");
      chunks.push(part.value);
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size));
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof PmdaError) throw error;
    throw new PmdaError("INVALID_REQUEST");
  } finally {
    clearTimeout(timer);
    if (!completed) void reader.cancel().catch(() => {});
  }
}

// 全体のJSON文字列を作る前に出力予算を検査する。文字列のエスケープも計上する。
function assertResponseBudget(value: unknown, maxBytes: number): void {
  let remaining = maxBytes;
  const charge = (bytes: number) => {
    remaining -= bytes;
    if (remaining < 0) throw new PmdaError("DATA_TOO_LARGE");
  };
  const visit = (part: unknown): void => {
    if (typeof part === "string") {
      if (Buffer.byteLength(part, "utf8") > remaining) throw new PmdaError("DATA_TOO_LARGE");
      charge(Buffer.byteLength(JSON.stringify(part), "utf8"));
    } else if (part && typeof part === "object") {
      charge(2);
      if (Array.isArray(part)) {
        for (const child of part) { charge(1); visit(child); }
      } else {
        for (const [key, child] of Object.entries(part)) {
          if (child === undefined) continue;
          charge(2); visit(key); visit(child);
        }
      }
    } else charge(Buffer.byteLength(JSON.stringify(part) ?? "null", "utf8"));
  };
  visit(value);
}

export function createPmdaPostHandler(dependencies: Dependencies = {}) {
  const limits: PmdaLimits = { ...PMDA_LIMITS, ...dependencies.limits };
  const download = dependencies.download ?? downloadPmdaZip;
  const parse = dependencies.parse ?? parsePmdaZip;
  const now = dependencies.now ?? Date.now;
  // warmなプロセス/インスタンス内だけの制限。分散したサイト全体の上限ではない。
  const requests = [new WindowBudget(limits.requestsPerMinute, 60_000), new WindowBudget(limits.requestsPerTenSeconds, 10_000)];
  const fetches = [new WindowBudget(limits.fetchesPerMinute, 60_000), new WindowBudget(limits.fetchesPerTenSeconds, 10_000)];
  const pending = new Map<string, Promise<string>>();
  const cache = new Map<string, { text: string; bytes: number; expires: number }>();
  let active = 0;
  let cachedBytes = 0;

  function pruneCache(time: number) {
    for (const [key, entry] of cache) if (entry.expires <= time) {
      cachedBytes -= entry.bytes;
      cache.delete(key);
    }
  }

  async function resultText(url: URL): Promise<string> {
    const key = url.href;
    const time = now();
    pruneCache(time);
    const cached = cache.get(key);
    if (cached) {
      cache.delete(key);
      cache.set(key, cached);
      return cached.text;
    }
    const existing = pending.get(key);
    if (existing) return existing;
    if (pending.size >= limits.activeFetches) throw new PmdaError("BUSY", 2);
    const retryAfter = Math.max(...fetches.map(budget => budget.retryAfter(time)));
    if (retryAfter) throw new PmdaError("UPSTREAM_BUDGET", retryAfter);
    fetches.forEach(budget => budget.spend(time));
    const work = (async () => {
      let zip: ArrayBuffer;
      try {
        zip = await download(url, { timeoutMs: limits.fetchTimeoutMs, maxBytes: limits.zipBytes });
      } catch (error) {
        throw error instanceof PmdaError ? error : new PmdaError("UPSTREAM_UNAVAILABLE");
      }
      let text: string;
      try {
        const result = parse(zip, key);
        assertResponseBudget(result, limits.responseBytes);
        text = JSON.stringify(result);
      } catch (error) {
        throw error instanceof PmdaError ? error : new PmdaError("PARSE_FAILED");
      }
      const bytes = Buffer.byteLength(text, "utf8");
      if (bytes > limits.responseBytes) throw new PmdaError("DATA_TOO_LARGE");
      if (bytes <= limits.cacheBytes && limits.cacheEntries > 0) {
        while (cache.size && (cache.size >= limits.cacheEntries || cachedBytes + bytes > limits.cacheBytes)) {
          const oldest = cache.keys().next().value!;
          cachedBytes -= cache.get(oldest)!.bytes;
          cache.delete(oldest);
        }
        cache.set(key, { text, bytes, expires: now() + limits.cacheTtlMs });
        cachedBytes += bytes;
      }
      return text;
    })();
    pending.set(key, work);
    try { return await work; } finally { pending.delete(key); }
  }

  return async function POST(request: Request): Promise<Response> {
    let admitted = false;
    const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
    try {
      const time = now();
      const retryAfter = Math.max(...requests.map(budget => budget.retryAfter(time)));
      if (retryAfter) throw new PmdaError("RATE_LIMITED", retryAfter);
      if (active >= limits.activeRequests) throw new PmdaError("BUSY", 2);
      requests.forEach(budget => budget.spend(time));
      active++;
      admitted = true;
      const body = await readBody(request, limits);
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new PmdaError("INVALID_REQUEST");
      const url = validatePmdaUrl((body as { url?: unknown }).url);
      return new Response(await resultText(url), { status: 200, headers });
    } catch (error) {
      const safe = error instanceof PmdaError ? error : new PmdaError("INTERNAL_ERROR");
      const [status, message] = PMDA_ERRORS[safe.code];
      return new Response(JSON.stringify({ error: message, errorCode: safe.code }), {
        status,
        headers: { ...headers, ...(safe.retryAfter ? { "Retry-After": String(safe.retryAfter) } : {}) },
      });
    } finally {
      if (admitted) active--;
    }
  };
}

// 公開PMDA資料だけを扱うAPIの資源上限。全てインスタンス内で適用する。
export const PMDA_LIMITS = {
  requestBytes: 4 * 1024,
  urlBytes: 512,
  bodyTimeoutMs: 3_000,
  fetchTimeoutMs: 15_000,
  zipBytes: 8 * 1024 * 1024,
  zipEntries: 256,
  declaredExpandedBytes: 32 * 1024 * 1024,
  xmlBytes: 4 * 1024 * 1024,
  xmlDepth: 96,
  xmlTags: 100_000,
  tableRows: 4_096,
  tableSpan: 128,
  expandedTableCells: 100_000,
  expandedTableBytes: 4 * 1024 * 1024,
  requestsPerMinute: 60,
  requestsPerTenSeconds: 12,
  fetchesPerMinute: 30,
  fetchesPerTenSeconds: 6,
  activeRequests: 8,
  activeFetches: 2,
  responseBytes: 1024 * 1024,
  cacheEntries: 16,
  cacheBytes: 2 * 1024 * 1024,
  cacheTtlMs: 60_000,
} as const;

export type PmdaLimits = { [K in keyof typeof PMDA_LIMITS]: number };

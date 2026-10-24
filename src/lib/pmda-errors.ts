export const PMDA_ERRORS = {
  INVALID_REQUEST: [400, "解析リクエストの形式を確認してください。"],
  INVALID_URL: [400, "PMDA添文ページにある正規のXML URLを入力してください。"],
  REQUEST_TOO_LARGE: [413, "入力が大きすぎます。PMDA XML URLだけを入力してください。"],
  REQUEST_TIMEOUT: [408, "入力の受信に時間がかかりました。もう一度お試しください。"],
  UNSUPPORTED_MEDIA: [415, "JSON形式の解析リクエストを送信してください。"],
  RATE_LIMITED: [429, "短時間の解析回数が上限に達しました。少し待ってからお試しください。"],
  BUSY: [429, "解析が混み合っています。少し待ってからお試しください。"],
  UPSTREAM_BUDGET: [429, "PMDAへの取得回数が上限に達しました。少し待ってからお試しください。"],
  UPSTREAM_UNAVAILABLE: [502, "PMDAから取得できませんでした。時間をおいてお試しください。"],
  UPSTREAM_TIMEOUT: [504, "PMDAからの取得が時間内に完了しませんでした。時間をおいてお試しください。"],
  REDIRECT_BLOCKED: [502, "PMDAのXML URLが転送されました。添文ページで最新のXML URLを確認してください。"],
  DATA_TOO_LARGE: [502, "この資料は解析できる容量の上限を超えています。PMDA添文ページで確認してください。"],
  INVALID_DATASET: [502, "PMDAからXMLデータセットを取得できませんでした。添文ページで最新のXML URLを確認してください。"],
  PARSE_FAILED: [422, "このXML資料を解析できませんでした。PMDA添文ページで確認してください。"],
  INTERNAL_ERROR: [500, "解析を完了できませんでした。時間をおいてお試しください。"],
} as const;

export type PmdaErrorCode = keyof typeof PMDA_ERRORS;

export class PmdaError extends Error {
  readonly code: PmdaErrorCode;
  readonly retryAfter: number;

  constructor(code: PmdaErrorCode, retryAfter = 0) {
    super(code);
    this.name = "PmdaError";
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

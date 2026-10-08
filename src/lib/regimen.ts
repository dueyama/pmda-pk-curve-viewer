export type DailyFrequency = { frequency: number; rangeLabel?: string };

// 添文の明示的な回数・分割回数だけを読み、投与量や服用時刻は決めない。
export function inferDailyFrequency(text: string): DailyFrequency | null {
  const normalized = text.replace(/[０-９]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0xfee0),
  );
  const match = normalized.match(/1日\s*([0-9]+)(?:\s*[～〜~]\s*([0-9]+))?\s*回/) ??
    normalized.match(/1日[^。]*?を\s*([0-9]+)(?:\s*[～〜~]\s*([0-9]+))?\s*回に(?:分割|分け)/);
  if (!match) return null;

  const lower = Number(match[1]);
  const upper = match[2] ? Number(match[2]) : lower;
  if (!Number.isFinite(lower) || lower <= 0 || !Number.isFinite(upper) || upper < lower) return null;

  return {
    frequency: Math.min(lower, 6),
    ...(upper > lower ? { rangeLabel: `${lower}～${upper}回` } : {}),
  };
}

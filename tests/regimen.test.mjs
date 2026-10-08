import assert from "node:assert/strict";
import test from "node:test";
import { inferDailyFrequency } from "../src/lib/regimen.ts";

test("1日の分割回数を量や範囲の上限と混同せず、表示例と範囲を返す", () => {
  assert.deepEqual(inferDailyFrequency("通常成人1日750～2,000mgを3～4回に分割経口投与する。"), {frequency: 3, rangeLabel: "3～4回"});
  assert.deepEqual(inferDailyFrequency("1回1gを1日３〜４回経口投与する。"), {frequency: 3, rangeLabel: "3～4回"});
  assert.deepEqual(inferDailyFrequency("通常成人1日60～90mgを3回に分けて経口投与する。"), {frequency: 3});
  assert.deepEqual(inferDailyFrequency("通常1回100mgを1日3回食後に投与する。"), {frequency: 3});
  assert.deepEqual(inferDailyFrequency("1日400mgを2回に分けて経口投与する。"), {frequency: 2});
  assert.equal(inferDailyFrequency("1日量750mg。小児には3回に分割する。"), null);
  assert.equal(inferDailyFrequency("服用時刻08:00、20:00"), null);
  assert.equal(inferDailyFrequency("1日0回"), null);
});

import test from "node:test";
import assert from "node:assert/strict";
import { normalizePlan, reconcilePlan, nextRetry } from "../lib/monitor-engine.mjs";

const monitor = { scope: "all", planIds: [] };
const raw = (available, quantity = null) => normalizePlan({ externalId: "ryzen-s", name: "Ryzen S", available, quantity, buyUrl: "https://example.test/buy" }, "bero");

test("统一套餐模型拒绝无效状态", () => {
  assert.throws(() => normalizePlan({ externalId: "x", name: "X", available: "yes" }, "p"));
  assert.equal(raw(true, 3).id, "bero:ryzen-s");
});

test("补货周期仅在缺货转有货时创建新通知", () => {
  const sold = raw(false);
  const first = reconcilePlan(sold, raw(true, 3), monitor);
  assert.equal(first.action, "restocked");
  const sent = { ...first.next, notification: { chatId: "-100", messageId: 42 } };
  assert.equal(reconcilePlan(sent, raw(true, 3), monitor).action, null);
});

test("库存减少编辑当前卡片，售罄也编辑当前卡片", () => {
  const active = { ...raw(true, 3), notification: { chatId: "-100", messageId: 42 } };
  assert.equal(reconcilePlan(active, raw(true, 2), monitor).action, "stock_changed");
  assert.equal(reconcilePlan(active, raw(false), monitor).action, "sold_out");
});

test("新的补货周期丢弃旧消息 ID", () => {
  const sold = { ...raw(false), notification: { chatId: "-100", messageId: 42 } };
  const result = reconcilePlan(sold, raw(true, 1), monitor);
  assert.equal(result.action, "restocked");
  assert.equal(result.next.notification, null);
});

test("重试采用有上限的指数退避", () => {
  assert.equal(nextRetry(1, 0), new Date(2000).toISOString());
  assert.equal(nextRetry(20, 0), new Date(30 * 60_000).toISOString());
});

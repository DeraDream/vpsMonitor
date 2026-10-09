import test from "node:test";
import assert from "node:assert/strict";
import { formatCard } from "../packages/core/src/telegram.mjs";

test("Telegram 卡片按标题、套餐信息、配置、库存、购买链接和标签分段", () => {
  const card = formatCard({
    providerName: "VMISS",
    name: "LA 9929 Pro",
    price: "$12.00",
    billingCycle: "Monthly",
    location: "Los Angeles",
    categoryName: "CN2 GIA / 9929",
    configuration: [{ label: "CPU", value: "2 Cores" }, { label: "RAM", value: "4 GB" }],
    quantity: 3,
    buyUrl: "https://app.vmiss.com/order/123?a=1&b=2",
    tags: ["vmiss", "cn2"]
  }, { showBuyLink: true });

  assert.match(card, /^🟢 <b>补货提醒<\/b>\n\n<a href="https:\/\/app\.vmiss\.com\/order\/123\?a=1&amp;b=2">🏪 <b>VMISS - LA 9929 Pro<\/b><\/a>/);
  assert.match(card, /💰 \$12\.00 \/ Monthly\n📍 Los Angeles\n🛣 线路 \/ 产品线：CN2 GIA \/ 9929/);
  assert.match(card, /\n\n<b>配置<\/b>\n• CPU：2 Cores\n• RAM：4 GB\n\n📦 库存：3 台\n\n🛒 购买链接：<a href="https:\/\/app\.vmiss\.com\/order\/123\?a=1&amp;b=2">https:\/\/app\.vmiss\.com\/order\/123\?a=1&amp;b=2<\/a>\n\n#vmiss #cn2$/);
});

test("关闭购买链接时不渲染购买区块", () => {
  const card = formatCard({ name: "Plan", buyUrl: "https://example.com/order" }, { showBuyLink: false });
  assert.doesNotMatch(card, /购买链接|立即购买/);
});

test("售罄卡片将整体标题和购买链接标记为删除线", () => {
  const card = formatCard({ providerName: "V.PS", name: "Starter", buyUrl: "https://vps.hosting/order" }, { showBuyLink: true }, "sold_out");
  assert.match(card, /<s><a href="https:\/\/vps\.hosting\/order">🏪 <b>V\.PS - Starter<\/b><\/a><\/s>/);
  assert.match(card, /<s>🛒 购买链接：<a href="https:\/\/vps\.hosting\/order">https:\/\/vps\.hosting\/order<\/a><\/s>/);
  assert.doesNotMatch(card, /检测时间/);
});

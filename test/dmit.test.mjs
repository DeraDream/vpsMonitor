import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { categories, dmitPlanIdentity, parseDmitPricing } from "../packages/adapters/src/dmit/parser.mjs";
import { discoverDmit } from "../packages/adapters/src/dmit/index.mjs";
import { formatCard } from "../packages/core/src/telegram.mjs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase } from "../packages/db/src/database.mjs";
import { bootstrapProviders } from "../packages/core/src/bootstrap.mjs";
import { createService } from "../packages/core/src/service.mjs";
import { registerAdapter } from "../packages/adapters/src/index.mjs";

const fixture = await readFile(new URL("../packages/adapters/src/dmit/fixtures/pricing.html", import.meta.url), "utf8");

test("DMIT 将套餐归入三条主线路并保留地区与硬件平台", () => {
  const plans = parseDmitPricing(fixture);
  assert.equal(categories.length, 3);
  assert.deepEqual(plans.map(plan => plan.categoryName), ["三网优化", "家宽优化", "国际路线"]);
  assert.deepEqual(plans.map(plan => plan.location), ["洛杉矶", "香港", "东京"]);
  assert.deepEqual(plans.map(plan => plan.tags.at(-1)), ["an5", "as3", "as3"]);
  assert.equal(plans[0].available, true);
  assert.equal(plans[2].available, false);
  assert.equal(plans[1].buyUrl, "https://www.dmit.io/cart.php?a=add&pid=2");
  assert.deepEqual(dmitPlanIdentity("LAX.AN5.Pro.TINY"), { externalId: "LAX.AN5.PRO.TINY", location: "洛杉矶", hardware: "AN5" });
});

test("DMIT 当前价格页按地区、线路和硬件组合生成稳定套餐标识", () => {
  const html = `<div class="plan-group" data-loc="lax" data-net="premium" data-hw="an5"><div class="plan-card"><div class="plan-card-name">MINI</div><div class="plan-spec">4 vCore</div><div class="plan-spec">4GB</div><div class="plan-spec">80GB SSD</div><div class="plan-spec">5000GB</div><div class="plan-spec">10Gbps</div><div class="plan-card-price">$ 79.90<span>/Monthly</span></div><div class="plan-card-action"><button onclick="window.location.href='/cart.php?a=add&amp;pid=58'">Order Now</button></div></div></div><div class="plan-group" data-loc="hkg" data-net="eyeball" data-hw="as3"><div class="plan-card"><div class="plan-card-name">MINI</div><div class="plan-spec">4 vCore</div><div class="plan-spec">4GB</div><div class="plan-spec">80GB SSD</div><div class="plan-spec">5000GB</div><div class="plan-spec">1Gbps</div><div class="plan-card-price">$ 79.90<span>/Monthly</span></div><div class="plan-card-action">Out of Stock</div></div></div>`;
  const plans = parseDmitPricing(html);
  assert.deepEqual(plans.map(plan => [plan.externalId, plan.location, plan.categoryId, plan.available]), [["LAX.AN5.PREMIUM.MINI", "洛杉矶", "premium", true], ["HKG.AS3.EYEBALL.MINI", "香港", "eyeball", false]]);
  assert.equal(plans[0].buyUrl, "https://www.dmit.io/cart.php?a=add&pid=58");
  assert.match(plans[0].configuration.map(row => `${row.label}:${row.value}`).join("\n"), /Traffic:5000GB/);
});

test("DMIT TG 通知使用用户可读的线路名称", () => {
  const plan = parseDmitPricing(fixture)[0];
  const card = formatCard({ ...plan, providerName: "DMIT" }, { showBuyLink: false });
  assert.match(card, /📍 洛杉矶\n🛣 线路 \/ 产品线：三网优化/);
});

test("DMIT 只接受官方商城页面", async () => {
  const result = await discoverDmit({ fetchPage: async () => new Response(fixture, { headers: { "content-type": "text/html" } }) });
  assert.equal(result.plans.length, 3);
  await assert.rejects(() => discoverDmit({ fetchPage: async () => new Response(fixture, { status: 403 }) }), /HTTP 403/);
});

test("DMIT 接入商家列表，但等待管理员手动创建监控", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vps-dmit-"));
  const store = createDatabase(directory);
  try {
    bootstrapProviders(store);
    assert.equal(store.getProvider("dmit").name, "DMIT");
    assert.equal(store.getMonitorByProvider("dmit"), null);
  } finally { store.close(); await rm(directory, { recursive: true, force: true }); }
});

test("DMIT 目录预览只保存套餐，不创建监控、动态或通知", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vps-dmit-catalog-"));
  const store = createDatabase(directory);
  try {
    bootstrapProviders(store);
    const provider = store.getProvider("dmit");
    registerAdapter({ key: "dmit-catalog-fixture", discover: async () => ({
      categories,
      plans: parseDmitPricing(fixture),
      completedCategories: categories.map(category => category.id),
      failures: []
    }) });
    store.putProvider({ ...provider, adapterKey: "dmit-catalog-fixture" });

    const plans = await createService(store).refreshProviderCatalog("dmit");
    assert.equal(plans.length, 3);
    assert.equal(store.getMonitorByProvider("dmit"), null);
    assert.equal(store.listEvents().length, 0);
    assert.equal(store.listNotifications().length, 0);
  } finally { store.close(); await rm(directory, { recursive: true, force: true }); }
});

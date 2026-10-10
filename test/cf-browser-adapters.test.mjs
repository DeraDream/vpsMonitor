import test from "node:test";
import assert from "node:assert/strict";
import { parseVpsHostingPage } from "../packages/adapters/src/vps-hosting/parser.mjs";
import { parseVmissPage } from "../packages/adapters/src/vmiss/parser.mjs";

test("V.PS 依据单张套餐卡的售罄标记判断库存", () => {
  const category = { id: "tokyo", name: "Tokyo", url: "https://vps.hosting/cart/tokyo-cloud-kvm-vps/" };
  const html = `<div class="cart-product" data-value="148"><h4>Starter</h4><span class="product-price cycle-m">€6.95 EUR</span><span class="product-cycle cycle-m">Monthly</span><p>CPU 2 Cores Memory 1 GB NVMe Storage 20 GB Data Transfer 1 TB</p></div><div class="cart-product outofstock" data-value="149"><div class="product-out-of-stock">Out of stock</div><h4>Essential</h4><span class="product-price cycle-m">€7.95 EUR</span><span class="product-cycle cycle-m">Monthly</span><p>CPU 2 Cores Memory 2 GB NVMe Storage 30 GB Data Transfer 1 TB</p></div>`;
  const plans = parseVpsHostingPage(html, category, { location: "Tokyo", url: category.url });
  assert.deepEqual(plans.map(plan => [plan.externalId, plan.available]), [["tokyo:Tokyo:148", true], ["tokyo:Tokyo:149", false]]);
  assert.equal(plans[0].name, "Tokyo Starter");
  assert.equal(plans[0].location, "日本-东京");
  assert.equal(plans[0].storage, "20 GB");
  assert.throws(() => parseVpsHostingPage("<html>verification</html>", category), /未找到/);
});

test("V.PS 套餐名保留英文地区，通知地区使用中文名称", () => {
  const category = { id: "cloud", name: "Cloud KVM VPS", url: "https://vps.hosting/cart/cloud-kvm-vps/" };
  const html = '<div class="cart-product" data-value="101"><h4>Essential</h4></div>';
  const [plan] = parseVpsHostingPage(html, category, { location: "London", url: category.url });
  assert.equal(plan.name, "London Essential");
  assert.equal(plan.location, "英国-伦敦");
});

test("VMISS 依据 Order Now、数量与售罄文本判断库存", () => {
  const category = { id: "la", name: "US - LosAngeles - TRI", url: "https://app.vmiss.com/store/us-los-angeles-tri" };
  const html = `<div id="products"><div class="package" id="product32"><h3 class="package-title">US.LA.TRI.Basic</h3><div class="price-amount">$5.00 CAD</div><div class="price-cycle">Monthly</div><p>1 Core 1024 MB 10GB SSD 200Mbps Port 500GB Bandwidth 1 IPv4 Included</p><a id="product32-order-button" href="/store/us-los-angeles-tri/basic">Order Now</a><span class="qty">2 Available</span></div><div class="package" id="product33"><h3 class="package-title">US.LA.TRI.Core</h3><div class="price-amount">$10.00 CAD</div><div class="price-cycle">Monthly</div><p>1 Core 2048 MB 15GB SSD</p><span>Out of Stock</span><button id="product33-order-button" disabled>Order Now</button></div></div>`;
  const plans = parseVmissPage(html, category);
  assert.deepEqual(plans.map(plan => [plan.externalId, plan.available, plan.quantity]), [["la:32", true, 2], ["la:33", false, null]]);
  assert.equal(plans[0].buyUrl, "https://app.vmiss.com/store/us-los-angeles-tri/basic");
  assert.throws(() => parseVmissPage("<html>verification</html>", category), /未找到/);
});

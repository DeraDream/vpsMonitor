import { load } from "cheerio";

const PRICING_URL = "https://www.dmit.io/pages/pricing?language=english";
const clean = value => String(value || "").replace(/\s+/g, " ").trim();

export const categories = [
  { id: "premium", name: "三网优化", route: "Premium" },
  { id: "eyeball", name: "家宽优化", route: "Eyeball" },
  { id: "tier-1", name: "国际路线", route: "Tier 1" }
];

export function routeForPlan(name) {
  if (/\.(?:Pro|Premium)\./i.test(name)) return categories[0];
  if (/\.(?:EB|Eyeball)\./i.test(name)) return categories[1];
  if (/\.(?:T1|Tier1)\./i.test(name)) return categories[2];
  return null;
}

export function dmitPlanIdentity(name) {
  const match = clean(name).match(/^(LAX|HKG|TYO)\.(AS3|AN4|AN5)\.(?:Pro|Premium|EB|Eyeball|T1|Tier1)\.[A-Z0-9]+/i);
  if (!match) return null;
  const location = ({ LAX: "洛杉矶", HKG: "香港", TYO: "东京" })[match[1].toUpperCase()];
  return { externalId: match[0].toUpperCase(), location, hardware: match[2].toUpperCase() };
}

function detail(text, expression) { return clean(text.match(expression)?.[1]); }
function cardText($, heading) {
  const card = $(heading).closest("article, .product, .plan, .plan-card, li, section");
  return clean(card.length ? card.text() : $(heading).parent().text());
}
function purchaseUrl($, heading) {
  const card = $(heading).closest("article, .product, .plan, .plan-card, li, section");
  const href = card.find('a[href*="dmit.io"], a[href*="cart"], a[href*="aff.php"]').first().attr("href");
  if (!href) return PRICING_URL;
  try {
    const url = new URL(href, PRICING_URL);
    return url.protocol === "https:" && /(^|\.)dmit\.io$/i.test(url.hostname) ? url.href : PRICING_URL;
  } catch { return PRICING_URL; }
}

function actualRoute(net) { return ({ premium: categories[0], eyeball: categories[1], tier1: categories[2], "tier-1": categories[2] })[String(net).toLowerCase()] || null; }
function actualLocation(location) { return ({ lax: "洛杉矶", hkg: "香港", tyo: "东京" })[String(location).toLowerCase()] || null; }
function actualPurchaseUrl(raw) {
  const match = String(raw || "").match(/(?:href|location\.href)\s*=\s*['"]([^'"]+)/i);
  if (!match) return PRICING_URL;
  try { const url = new URL(match[1].replace(/&amp;/g, "&"), PRICING_URL); return url.protocol === "https:" && /(^|\.)dmit\.io$/i.test(url.hostname) ? url.href : PRICING_URL; }
  catch { return PRICING_URL; }
}
function parseActualPricing($) {
  const plans = [], seen = new Set();
  $(".plan-group[data-loc][data-net][data-hw]").each((_, group) => {
    const location = actualLocation($(group).attr("data-loc")), route = actualRoute($(group).attr("data-net"));
    const hardware = clean($(group).attr("data-hw")).split(/\s+/)[0]?.toUpperCase();
    if (!location || !route || !hardware) return;
    $(group).find(".plan-card").each((__, card) => {
      const tier = clean($(card).find(".plan-card-name").first().text());
      const specs = $(card).find(".plan-spec").map((___, item) => clean($(item).text())).get();
      const priceText = clean($(card).find(".plan-card-price").first().text());
      const action = clean($(card).find(".plan-card-action").text());
      const price = detail(priceText, /\$\s*([\d,.]+)/), cycle = /annual/i.test(priceText) ? "year" : "month";
      const cpu = specs.find(value => /v?(?:core|cpu)/i.test(value)) || "";
      const ram = specs.find(value => /GB(?:\s*DDR\d?)?$/i.test(value)) || "";
      const storage = specs.find(value => /(?:NVMe|SSD)/i.test(value)) || "";
      const bandwidth = specs.find(value => /(?:GB|TB)(?:\s*Max)?(?:\s*\(.*\))?$/i.test(value) && value !== ram && value !== storage) || "";
      const portSpeed = specs.find(value => /Gbps/i.test(value)) || "";
      const unavailable = /out of stock|sold out|unavailable/i.test(action), orderable = /order now|buy now|add to cart/i.test(action);
      if (!tier || !price || (!unavailable && !orderable)) return;
      const externalId = `${String($(group).attr("data-loc")).toUpperCase()}.${hardware}.${route.route.replace(/\s+/g, "")}.${tier}`.toUpperCase();
      if (seen.has(externalId)) return; seen.add(externalId);
      const configuration = [["地区", location], ["线路", route.name], ["硬件平台", hardware], ["CPU", cpu], ["RAM", ram], ["Storage", storage], ["Traffic", bandwidth], ["Port", portSpeed]].filter(([, value]) => value).map(([label, value]) => ({ label, value }));
      plans.push({ externalId, categoryId: route.id, categoryName: route.name, name: externalId, location, cpu, ram, storage, bandwidth, portSpeed, configuration, price: `$${price}`, billingCycle: cycle, available: !unavailable, quantity: null, availabilitySource: unavailable ? "sold-out" : "order-button", sourceUrl: PRICING_URL, buyUrl: actualPurchaseUrl($(card).find(".plan-card-action").html()), tags: ["dmit", route.id, hardware.toLowerCase()], listed: true });
    });
  });
  return plans;
}

export function parseDmitPricing(html) {
  const $ = load(html);
  const actualPlans = parseActualPricing($);
  if (actualPlans.length) return actualPlans;
  const headings = $("h1,h2,h3,h4,h5,strong,b").filter((_, el) => Boolean(dmitPlanIdentity($(el).text()))).toArray();
  const plans = [], seen = new Set();
  for (const heading of headings) {
    const name = clean($(heading).text());
    const identity = dmitPlanIdentity(name), route = routeForPlan(name);
    if (!identity || !route || seen.has(identity.externalId)) continue;
    seen.add(identity.externalId);
    const text = cardText($, heading);
    const unavailable = /out of stock|sold out|unavailable/i.test(text);
    const orderable = /order now|buy now|deploy now|add to cart/i.test(text);
    const price = detail(text, /\$\s*([\d,.]+)\s*\/?\s*(monthly|annually|quarterly|semi-annually)?/i);
    if (!price || (!unavailable && !orderable)) continue;
    const cpu = detail(text, /(\d+\s*(?:v?core|v?cpu))/i);
    const ram = detail(text, /(\d+(?:\.\d+)?\s*GB(?:\s*(?:DDR\d?)?)?)/i);
    const storage = detail(text, /(\d+(?:\.\d+)?\s*GB\s*(?:NVMe|SSD))/i);
    const bandwidth = detail(text, /(\d+(?:\.\d+)?\s*(?:GB|TB)(?:\s*Max[^ ]*)?)/i);
    const portSpeed = detail(text, /(\d+(?:\.\d+)?\s*Gbps)/i);
    const cycle = /annually/i.test(text) ? "year" : /quarterly/i.test(text) ? "quarter" : /semi-annually/i.test(text) ? "6 months" : "month";
    const configuration = [
      ["地区", identity.location], ["线路", route.name], ["硬件平台", identity.hardware],
      ["CPU", cpu], ["RAM", ram], ["Storage", storage], ["Traffic", bandwidth], ["Port", portSpeed]
    ].filter(([, value]) => value).map(([label, value]) => ({ label, value }));
    plans.push({
      externalId: identity.externalId, categoryId: route.id, categoryName: route.name, name: identity.externalId,
      location: identity.location, cpu, ram, storage, bandwidth, portSpeed, configuration,
      price: `$${price}`, billingCycle: cycle, available: !unavailable, quantity: null,
      availabilitySource: unavailable ? "sold-out" : "order-button", sourceUrl: PRICING_URL,
      buyUrl: purchaseUrl($, heading), tags: ["dmit", route.id, identity.hardware.toLowerCase()], listed: true
    });
  }
  if (!plans.length) throw new Error("DMIT 价格页未识别到套餐；页面结构可能已更新");
  return plans;
}

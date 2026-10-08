import { load } from "cheerio";

const clean = value => String(value || "").replace(/\s+/g, " ").trim();
const field = (card, label) => {
  const text = clean(card.text());
  const match = text.match(new RegExp(`${label}\\s+([^]+?)(?=\\s+(?:CPU|Memory|NVMe Storage|Data Transfer)\\s|$)`, "i"));
  return clean(match?.[1]);
};

export function parseVpsHostingPage(html, category, page = {}) {
  const $ = load(html), plans = [], seen = new Set();
  const cards = $(".cart-product[data-value]");
  if (!cards.length) throw new Error(`${category.name}：页面未找到套餐卡片`);
  cards.each((_, element) => {
    const card = $(element), externalId = card.attr("data-value"), name = clean(card.find("h4").first().text());
    if (!externalId || !name || seen.has(externalId)) throw new Error(`${category.name}：套餐标识或名称异常`);
    seen.add(externalId);
    const unavailable = card.hasClass("outofstock") || /out\s*of\s*stock/i.test(clean(card.find(".product-out-of-stock").text()));
    const price = clean(card.find(".product-price.cycle-m").first().text());
    const cycle = clean(card.find(".product-cycle.cycle-m").first().text());
    const configuration = [["CPU", field(card, "CPU")], ["Memory", field(card, "Memory")], ["NVMe Storage", field(card, "NVMe Storage")], ["Data Transfer", field(card, "Data Transfer")]].filter(([, value]) => value);
    const values = Object.fromEntries(configuration);
    plans.push({ externalId: `${category.id}:${page.location || category.name}:${externalId}`, categoryId: category.id, categoryName: category.name, name,
      available: !unavailable, quantity: null, availabilitySource: "sold-out-badge", price, billingCycle: cycle || "month",
      cpu: values.CPU || "", ram: values.Memory || "", nvme: values["NVMe Storage"] || "", storage: values["NVMe Storage"] || "", bandwidth: values["Data Transfer"] || "",
      specs: configuration.map(([label, value]) => `${label} ${value}`).join(" / "), configuration, location: page.location || category.name,
      sourceUrl: page.url || category.url, buyUrl: page.url || category.url, tags: ["vps-hosting", category.id], listed: true });
  });
  return plans;
}

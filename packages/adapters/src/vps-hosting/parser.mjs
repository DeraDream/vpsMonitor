import { load } from "cheerio";

const clean = value => String(value || "").replace(/\s+/g, " ").trim();
const locationNames = {
  amsterdam: "荷兰-阿姆斯特丹",
  atlanta: "美国-亚特兰大",
  chicago: "美国-芝加哥",
  dallas: "美国-达拉斯",
  frankfurt: "德国-法兰克福",
  london: "英国-伦敦",
  "los angeles": "美国-洛杉矶",
  miami: "美国-迈阿密",
  "new york": "美国-纽约",
  paris: "法国-巴黎",
  seattle: "美国-西雅图",
  singapore: "新加坡-新加坡",
  tokyo: "日本-东京"
};
const locationName = location => locationNames[clean(location).toLowerCase()] || clean(location);
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
    const card = $(element), externalId = card.attr("data-value"), rawName = clean(card.find("h4").first().text());
    if (!externalId || !rawName || seen.has(externalId)) throw new Error(`${category.name}：套餐标识或名称异常`);
    seen.add(externalId);
    const sourceLocation = clean(page.location || category.name);
    const name = sourceLocation ? `${sourceLocation} ${rawName}` : rawName;
    const unavailable = card.hasClass("outofstock") || /out\s*of\s*stock/i.test(clean(card.find(".product-out-of-stock").text()));
    const price = clean(card.find(".product-price.cycle-m").first().text());
    const cycle = clean(card.find(".product-cycle.cycle-m").first().text());
    const configuration = [["CPU", field(card, "CPU")], ["Memory", field(card, "Memory")], ["NVMe Storage", field(card, "NVMe Storage")], ["Data Transfer", field(card, "Data Transfer")]].filter(([, value]) => value);
    const values = Object.fromEntries(configuration);
    plans.push({ externalId: `${category.id}:${page.location || category.name}:${externalId}`, categoryId: category.id, categoryName: category.name, name,
      available: !unavailable, quantity: null, availabilitySource: "sold-out-badge", price, billingCycle: cycle || "month",
      cpu: values.CPU || "", ram: values.Memory || "", nvme: values["NVMe Storage"] || "", storage: values["NVMe Storage"] || "", bandwidth: values["Data Transfer"] || "",
      specs: configuration.map(([label, value]) => `${label} ${value}`).join(" / "), configuration, location: locationName(sourceLocation),
      sourceUrl: page.url || category.url, buyUrl: page.url || category.url, tags: ["vps-hosting", category.id], listed: true });
  });
  return plans;
}

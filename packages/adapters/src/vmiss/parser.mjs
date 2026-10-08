import { load } from "cheerio";

const clean = value => String(value || "").replace(/\s+/g, " ").trim();
function parseFeatures(card) {
  const text = clean(card.find(".package-description, .package-features, .package").text());
  const patterns = [["CPU", /([\d.]+\s*Cores?)/i], ["RAM", /(\d+\s*MB)/i], ["Storage", /(\d+\s*GB\s*(?:SSD|NVMe|HDD))/i], ["Port", /(\d+\s*Mbps\s*Port)/i], ["Bandwidth", /(\d+\s*GB\s*Bandwidth)/i], ["IPv4", /(\d+\s*IPv4)/i]];
  return patterns.map(([label, pattern]) => [label, text.match(pattern)?.[1] || ""]).filter(([, value]) => value);
}

export function parseVmissPage(html, category) {
  const $ = load(html), plans = [], seen = new Set();
  const cards = $("#products .package[id^=product]");
  const empty = /Product group does not contain any visible products/i.test(clean($("body").text()));
  if (!cards.length) { if (empty) return []; throw new Error(`${category.name}：页面未找到套餐卡片`); }
  cards.each((_, element) => {
    const card = $(element), id = card.attr("id")?.match(/^product(\d+)$/)?.[1], name = clean(card.find(".package-title").first().text());
    if (!id || !name || seen.has(id)) throw new Error(`${category.name}：套餐标识或名称异常`);
    seen.add(id);
    const order = card.find(`#product${id}-order-button`).first(), orderText = clean(order.text());
    const quantityText = clean(card.find(".package-qty, .qty").text()) || clean(card.text()).match(/\b\d+\s+Available\b/i)?.[0] || "";
    const quantity = quantityText.match(/(\d+)\s+Available/i)?.[1];
    const unavailable = /out\s*of\s*stock|sold\s*out|unavailable/i.test(clean(card.text())) || /out\s*of\s*stock/i.test(orderText) || order.is("[disabled]");
    if (!unavailable && !/order now/i.test(orderText)) throw new Error(`${category.name}：${name} 可售标记不明确`);
    const configuration = parseFeatures(card), values = Object.fromEntries(configuration);
    const price = clean(card.find(".price-amount").first().text());
    const billingCycle = clean(card.find(".price-cycle").first().text());
    plans.push({ externalId: `${category.id}:${id}`, categoryId: category.id, categoryName: category.name, name, available: !unavailable, quantity: quantity == null ? null : Number(quantity), availabilitySource: quantity == null ? "order-button" : "quantity", price, billingCycle, cpu: values.CPU || "", ram: values.RAM || "", storage: values.Storage || "", bandwidth: values.Bandwidth || "", portSpeed: values.Port || "", ipv4: values.IPv4 || "", specs: configuration.map(([label, value]) => `${label} ${value}`).join(" / "), configuration, location: category.name, sourceUrl: category.url, buyUrl: order.attr("href") ? new URL(order.attr("href"), category.url).href : category.url, tags: ["vmiss", category.id], listed: true });
  });
  return plans;
}

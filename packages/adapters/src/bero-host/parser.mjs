import { load } from "cheerio";

const clean = value => value.replace(/\s+/g, " ").trim();
const soldOut = text => /^(?:ausverkauft|sold\s*out)$/i.test(clean(text));

export function parsePackages(html, category) {
  const $ = load(html), plans = [], ids = new Set();
  // Each server-rendered Livewire card has its own stable package ID.
  const cards = $("[wire\\:click]").filter((_, element) =>
    /^selectPackage\(\s*\d+\s*\)$/.test($(element).attr("wire:click") || ""));
  if (!cards.length) throw new Error(`${category.name}：未找到套餐卡片，保留上次状态`);

  cards.each((_, element) => {
    const card = $(element), packageId = card.attr("wire:click").match(/\d+/)[0];
    if (ids.has(packageId)) throw new Error(`${category.name}：套餐 ID 重复`);
    ids.add(packageId);
    const body = card.find(".default-package-background").first();
    const name = clean(body.find("h4").first().text());
    const price = clean(body.find("h5").first().clone().find("small").remove().end().text());
    const fields = {};
    body.find("span.me-2").each((_, span) => {
      const label = clean($(span).text()).replace(/:$/, "").toLowerCase();
      const value = clean($(span).parent().find("span.ms-auto").text());
      if (label && value) fields[label] = value;
    });
    if (!name || !/\d[\d.,]*\s*€/.test(price) || !fields.cpu || !fields.ram || !fields.nvme)
      throw new Error(`${category.name}：套餐 ${packageId} 结构不完整，保留上次状态`);

    const unavailable = card.find("h4").toArray().some(heading =>
      !$(heading).closest(".default-package-background").length && soldOut($(heading).text()));
    const panel = card.find(".bero-orange-border").first();
    const opacity = Number(panel.attr("style")?.match(/opacity\s*:\s*([\d.]+)/i)?.[1] ?? 1);
    if (!panel.length || (!unavailable && (opacity < 1 || card.find("[disabled]").length)))
      throw new Error(`${category.name}：套餐 ${packageId} 可售标记不明确，保留上次状态`);

    const runtime = fields.laufzeit || fields.runtime || "";
    const days = runtime.match(/^(\d+)\s*(?:Tage?|days?)$/i)?.[1];
    plans.push({
      externalId: `${category.id}:${packageId}`, categoryId: category.id, categoryName: category.name,
      name, available: !unavailable, quantity: null,
      specs: `CPU ${fields.cpu} / RAM ${fields.ram} / NVMe ${fields.nvme}`,
      price, billingCycle: days === "365" ? "year" : days ? `${days} days` : runtime,
      location: /Frankfurt/i.test($("body").text()) ? "DE · Frankfurt" : "",
      buyUrl: category.url, sourceUrl: category.url, tags: ["bero", category.id], listed: true
    });
  });
  return plans;
}

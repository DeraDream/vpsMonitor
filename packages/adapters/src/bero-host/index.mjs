import { readFileSync } from "node:fs";
const version=JSON.parse(readFileSync(new URL("../../package.json",import.meta.url),"utf8")).version;
import { categories } from "./categories.mjs";
import { parsePackages } from "./parser.mjs";

export { categories, parsePackages };

export async function discoverBero({ fetchPage = fetch } = {}) {
  const results = await Promise.allSettled(categories.map(async category => {
    const response = await fetchPage(category.url, {
      headers: { "Accept": "text/html", "Accept-Language": "de-DE,de;q=0.9,en;q=0.8", "User-Agent": `VPSMonitor/${version} (+https://github.com/DeraDream/vpsMonitor)` },
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (!/text\/html/i.test(response.headers.get("content-type") || "")) throw new Error("响应不是 HTML 页面");
    return parsePackages(await response.text(), category);
  }));
  const plans = [], completedCategories = [], failures = [];
  results.forEach((result, index) => {
    const category = categories[index];
    if (result.status === "fulfilled") {
      plans.push(...result.value); completedCategories.push(category.id);
    } else failures.push({ categoryId: category.id, categoryName: category.name, error: result.reason.message });
  });
  if (!completedCategories.length) throw Object.assign(new Error(failures.map(item => `${item.categoryName}：${item.error}`).join("；")), { failures });
  return { plans, completedCategories, failures };
}

export const beroHost = {
  key: "bero-host", name: "Bero Host", version: "1.0.0",
  provider: { id: "bero-host", name: "Bero Host", website: "https://bero-host.de/", categories },
  discover: discoverBero
};

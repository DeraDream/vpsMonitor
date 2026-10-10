import { readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { categories, parseDmitPricing } from "./parser.mjs";

const exec = promisify(execFile);
const python = process.env.VPS_MONITOR_PYTHON || "/opt/vps-monitor/.venv/bin/python";
const script = fileURLToPath(new URL("./probe.py", import.meta.url));
const version = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version;
const pricingUrl = "https://www.dmit.io/pages/pricing?language=english";

export { categories, parseDmitPricing } from "./parser.mjs";

async function fetchWithBrowser() {
  let output;
  try { output = await exec(python, [script], { timeout: 3 * 60_000, maxBuffer: 20 * 1024 * 1024 }); }
  catch (error) { throw new Error(`DMIT 浏览器采集失败：${error.stderr || error.stdout || error.message}`); }
  let result;
  try { result = JSON.parse(output.stdout); } catch { throw new Error("DMIT 浏览器返回了无效数据"); }
  if (result.fatal) throw new Error(`DMIT 浏览器采集失败：${result.fatal}`);
  if (typeof result.html !== "string" || !result.html.trim()) throw new Error("DMIT 浏览器未返回价格页内容");
  return result.html;
}

export async function discoverDmit({ fetchPage } = {}) {
  if (!fetchPage) {
    const html = await fetchWithBrowser();
    return { categories, plans: parseDmitPricing(html), completedCategories: categories.map(category => category.id), failures: [] };
  }
  let response;
  try {
    response = await fetchPage(pricingUrl, {
      headers: { Accept: "text/html", "Accept-Language": "en-US,en;q=0.9", "User-Agent": `VPSMonitor/${version} (+https://github.com/DeraDream/vpsMonitor)` },
      signal: AbortSignal.timeout(30_000), redirect: "follow"
    });
  } catch (error) { throw new Error(`DMIT 商城访问失败：${error.message}`); }
  if (!response.ok) throw new Error(`DMIT 商城返回 HTTP ${response.status}`);
  if (response.url && !/^https:\/\/(?:www\.)?dmit\.io\//i.test(response.url)) throw new Error("DMIT 商城响应被重定向到其他站点");
  const html = await response.text();
  return { categories, plans: parseDmitPricing(html), completedCategories: categories.map(category => category.id), failures: [] };
}

export const dmit = { key: "dmit", name: "DMIT", version: "1.0.0", provider: {
  id: "dmit", name: "DMIT", website: "https://www.dmit.io/", categories, defaultIntervalSeconds: 300, notifyOnFirstDiscovery: false, autoCreateMonitor: false
}, discover: discoverDmit };

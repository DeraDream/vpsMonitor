import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parseVpsHostingPage } from "./parser.mjs";

const exec = promisify(execFile);
const python = process.env.VPS_MONITOR_PYTHON || "/opt/vps-monitor/.venv/bin/python";
const script = fileURLToPath(new URL("./probe.py", import.meta.url));
const version = "1.0.0";

export async function discoverVpsHosting() {
  let output;
  try { output = await exec(python, [script], { timeout: 12 * 60_000, maxBuffer: 40 * 1024 * 1024 }); }
  catch (error) { throw new Error(`V.PS 浏览器采集失败：${error.stderr || error.message}`); }
  let result;
  try { result = JSON.parse(output.stdout); } catch { throw new Error("V.PS 浏览器返回了无效数据"); }
  if (result.fatal) throw new Error(`V.PS 浏览器采集失败：${result.fatal}`);
  const plans = [], completedCategories = [], failures = [...(result.failures || [])];
  for (const category of result.categories || []) {
    const pages = (result.pages || []).filter(page => page.categoryId === category.id);
    if (!pages.length) { if (!failures.some(failure => failure.categoryId === category.id)) failures.push({ categoryId: category.id, categoryName: category.name, error: "未返回页面" }); continue; }
    try { for (const page of pages) plans.push(...parseVpsHostingPage(page.html, category, page)); if (!failures.some(failure => failure.categoryId === category.id)) completedCategories.push(category.id); }
    catch (error) { failures.push({ categoryId: category.id, categoryName: category.name, error: error.message }); }
  }
  if (!completedCategories.length) throw Object.assign(new Error("V.PS 未成功解析任何地区"), { failures });
  return { categories: result.categories, plans, completedCategories, failures };
}

export const vpsHosting = { key: "vps-hosting", name: "V.PS", version, provider: { id: "vps-hosting", name: "V.PS", website: "https://vps.hosting/", categories: [], dynamicCategories: true, defaultIntervalSeconds: 300, notifyOnFirstDiscovery: false }, discover: discoverVpsHosting };

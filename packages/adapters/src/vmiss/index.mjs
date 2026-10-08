import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parseVmissPage } from "./parser.mjs";

const exec = promisify(execFile);
const python = process.env.VPS_MONITOR_PYTHON || "/opt/vps-monitor/.venv/bin/python";
const script = fileURLToPath(new URL("./probe.py", import.meta.url));

export async function discoverVmiss() {
  let output;
  try { output = await exec("xvfb-run", ["-a", python, script], { timeout: 15 * 60_000, maxBuffer: 50 * 1024 * 1024, env: { ...process.env, VPS_MONITOR_VMISS_PROFILE: process.env.VPS_MONITOR_VMISS_PROFILE || "/opt/vps-monitor/data/browser-profiles/vmiss" } }); }
  catch (error) { throw new Error(`VMISS 浏览器采集失败：${error.stderr || error.message}`); }
  let result;
  try { result = JSON.parse(output.stdout); } catch { throw new Error("VMISS 浏览器返回了无效数据"); }
  if (result.fatal) throw new Error(`VMISS 浏览器采集失败：${result.fatal}`);
  const pages = new Map((result.pages || []).map(page => [page.categoryId, page.html]));
  const plans = [], completedCategories = [], failures = [...(result.failures || [])];
  for (const category of result.categories || []) {
    const html = pages.get(category.id); if (!html) { if (!failures.some(failure => failure.categoryId === category.id)) failures.push({ categoryId: category.id, categoryName: category.name, error: "未返回页面" }); continue; }
    try { plans.push(...parseVmissPage(html, category)); completedCategories.push(category.id); }
    catch (error) { failures.push({ categoryId: category.id, categoryName: category.name, error: error.message }); }
  }
  if (!completedCategories.length) throw Object.assign(new Error("VMISS 未成功解析任何分类"), { failures });
  return { categories: result.categories, plans, completedCategories, failures };
}

export const vmiss = { key: "vmiss", name: "VMISS", version: "1.0.0", provider: { id: "vmiss", name: "VMISS", website: "https://app.vmiss.com/", categories: [], dynamicCategories: true, defaultIntervalSeconds: 300, notifyOnFirstDiscovery: false }, discover: discoverVmiss };

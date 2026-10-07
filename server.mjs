import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { getAdapter } from "./lib/adapters.mjs";
import { normalizePlan, reconcilePlan, nextRetry } from "./lib/monitor-engine.mjs";
import { repositoryMatches } from "./lib/update-policy.mjs";

const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";
const version = "1.0";
const root = process.cwd();
const dataDir = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : join(root, "data");
const dataFile = join(dataDir, "store.json");

const seed = {
  providers: [],
  plans: [],
  monitors: [],
  notifications: [],
  events: [],
  runtime: { schedulerStartedAt: new Date().toISOString(), lastTickAt: null },
  settings: {
    telegram: {
      botToken: "",
      chatId: "",
      enabled: false,
      showQuantity: true,
      showBuyLink: true,
      soldoutMode: "edit",
      template: "standard"
    },
    updates: { repository: "DeraDream/vpsMonitor", branch: "main" }
  }
};

async function load() {
  if (!existsSync(dataFile)) {
    await mkdir(dataDir, { recursive: true });
    await writeFile(dataFile, JSON.stringify(seed, null, 2));
    return structuredClone(seed);
  }
  const data = JSON.parse(await readFile(dataFile, "utf8"));
  data.providers = (data.providers || []).filter((provider) => provider.status !== "pending");
  data.plans = data.plans || [];
  data.monitors = data.monitors || [];
  data.notifications = data.notifications || [];
  data.events = data.events || [];
  data.runtime = { ...seed.runtime, ...(data.runtime || {}) };
  data.settings = { ...seed.settings, ...(data.settings || {}), telegram: { ...seed.settings.telegram, ...(data.settings?.telegram || {}) }, updates: { ...seed.settings.updates, ...(data.settings?.updates || {}) } };
  if (data.settings.telegram.botToken) {
    if (tokenKey()) data.settings.telegram.botTokenEncrypted = encryptToken(data.settings.telegram.botToken);
    delete data.settings.telegram.botToken;
  }
  return data;
}

let store = await load();
async function save() {
  await writeFile(dataFile, JSON.stringify(store, null, 2));
}

function tokenKey() {
  const secret = process.env.TOKEN_ENCRYPTION_KEY;
  return secret ? createHash("sha256").update(secret).digest() : null;
}

function encryptToken(value) {
  const key = tokenKey();
  if (!key) throw new Error("服务器未设置 TOKEN_ENCRYPTION_KEY，不能保存 Bot Token");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `v1:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${encrypted.toString("base64")}`;
}

function decryptToken(value) {
  const key = tokenKey();
  if (!key) throw new Error("服务器未设置 TOKEN_ENCRYPTION_KEY");
  const [version, ivText, tagText, encryptedText] = String(value || "").split(":");
  if (version !== "v1" || !ivText || !tagText || !encryptedText) throw new Error("Bot Token 密文无效，请重新保存");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivText, "base64"));
  decipher.setAuthTag(Buffer.from(tagText, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedText, "base64")), decipher.final()]).toString("utf8");
}

function addEvent(type, message, extra = {}) {
  store.events.unshift({ id: `event_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, at: new Date().toISOString(), type, message, ...extra });
  store.events = store.events.slice(0, 500);
}

function protectedRequest(req, res) {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return true;
  const expected = `Basic ${Buffer.from(`admin:${password}`).toString("base64")}`;
  if (req.headers.authorization === expected) return true;
  res.writeHead(401, { "WWW-Authenticate": 'Basic realm="VPS Monitor", charset="UTF-8"' });
  res.end("Authentication required");
  return false;
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

async function body(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

function maskedSettings() {
  const telegram = { ...store.settings.telegram };
  telegram.botTokenConfigured = Boolean(telegram.botTokenEncrypted);
  delete telegram.botTokenEncrypted;
  delete telegram.botToken;
  return { telegram, updates: store.settings.updates, security: { passwordProtected: Boolean(process.env.ADMIN_PASSWORD), tokenEncryptionConfigured: Boolean(tokenKey()) } };
}

function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function updateStatus() {
  const settings = store.settings.updates;
  const base = { configured: Boolean(settings.repository), repository: settings.repository, branch: settings.branch, localRevision: null, remoteRevision: null, updateAvailable: false, deployReady: false, message: "尚未配置 GitHub 更新源。" };
  if (!settings.repository) return base;
  try {
    const localRevision = git(["rev-parse", "HEAD"]);
    const dirty = git(["status", "--porcelain"]);
    const originUrl = git(["remote", "get-url", "origin"]);
    if (!repositoryMatches(settings.repository, originUrl)) return { ...base, localRevision, deployReady: false, message: "设置页的 GitHub 仓库与本地 origin 不一致，已拒绝在线更新。" };
    if (dirty) return { ...base, localRevision, deployReady: false, message: "工作目录有未提交修改，不能在线更新。" };
    const remoteRevision = git(["ls-remote", "origin", `refs/heads/${settings.branch}`]).split(/\s+/)[0] || null;
    return { ...base, localRevision, remoteRevision, updateAvailable: Boolean(remoteRevision && remoteRevision !== localRevision), deployReady: true, message: remoteRevision && remoteRevision !== localRevision ? "发现新版本，可以在线更新。" : "已是最新版本。" };
  } catch (error) {
    const detail = error.stderr?.trim() || error.message;
    if (detail.includes("unknown revision") || detail.includes("ambiguous argument 'HEAD'")) return { ...base, message: "当前代码尚未首次提交。首次推送到 GitHub 后即可检查更新。" };
    return { ...base, message: `无法检查更新：${detail}` };
  }
}

function formatCard(plan, status = "restocked") {
  const telegram = store.settings.telegram;
  const lines = [
    status === "sold_out" ? "🔴 <b>售罄</b>" : "🟢 <b>补货提醒</b>",
    "",
    `📦 <b>${escapeHtml(plan.name)}</b>`,
    plan.price ? `💰 ${escapeHtml(plan.price)}${plan.billingCycle ? ` / ${escapeHtml(plan.billingCycle)}` : ""}` : "",
    plan.location ? `📍 ${escapeHtml(plan.location)}` : "",
    plan.specs ? `💻 ${escapeHtml(plan.specs)}` : "",
    telegram.showQuantity && Number.isInteger(plan.quantity) ? `📦 库存：${plan.quantity} 台` : "",
    status === "sold_out" ? "📦 本次补货已售罄" : "",
    telegram.showBuyLink && plan.buyUrl ? `🛒 <a href=\"${escapeAttr(plan.buyUrl)}\">立即购买</a>` : "",
    plan.tags?.length ? plan.tags.map((tag) => `#${tag}`).join(" ") : ""
  ];
  return lines.filter(Boolean).join("\n");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
}
function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

async function telegram(method, payload) {
  const encrypted = store.settings.telegram.botTokenEncrypted;
  if (!encrypted) throw new Error("请先保存 Telegram Bot Token");
  const botToken = decryptToken(encrypted);
  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const result = await response.json();
  if (!result.ok) {
    const error = new Error(result.description || "Telegram 请求失败");
    error.retryAfter = result.parameters?.retry_after;
    throw error;
  }
  return result.result;
}

function dashboard() {
  const monitored = store.monitors.filter((monitor) => monitor.enabled);
  const inStock = store.plans.filter((plan) => plan.available).length;
  return {
    stats: {
      providers: store.providers.length,
      monitoredProviders: new Set(monitored.map((monitor) => monitor.providerId)).size,
      monitoredPlans: monitored.reduce((total, monitor) => total + (monitor.scope === "all" ? store.plans.filter((plan) => plan.providerId === monitor.providerId).length : monitor.planIds.length), 0),
      inStock
    },
    version,
    providers: store.providers,
    monitors: store.monitors,
    runtime: { ...store.runtime, pendingNotifications: store.notifications.length },
    events: store.events.slice(0, 12)
  };
}

function monitorView(monitor) {
  const provider = store.providers.find((item) => item.id === monitor.providerId);
  return { ...monitor, providerName: provider?.name || "已移除商家", providerAdapterKey: provider?.adapterKey || "unknown", planCount: monitor.scope === "all" ? store.plans.filter((plan) => plan.providerId === monitor.providerId).length : monitor.planIds.length };
}

function validateMonitor(input, existingId = null) {
  const provider = store.providers.find((item) => item.id === input.providerId);
  if (!provider) throw new Error("请选择已接入的商家");
  if (store.monitors.some((item) => item.providerId === provider.id && item.id !== existingId)) throw new Error("该商家已有监控任务，请直接编辑现有任务");
  const scope = input.scope === "selected" ? "selected" : "all";
  const planIds = [...new Set(Array.isArray(input.planIds) ? input.planIds.filter((id) => typeof id === "string") : [])];
  const validPlanIds = new Set(store.plans.filter((plan) => plan.providerId === provider.id).map((plan) => plan.id));
  if (planIds.some((id) => !validPlanIds.has(id))) throw new Error("包含不属于该商家的套餐");
  if (scope === "selected" && !planIds.length) throw new Error("请选择至少一个套餐，或改为监控全部套餐");
  return { providerId: provider.id, scope, planIds, intervalSeconds: Math.max(30, Math.min(3600, Number(input.intervalSeconds) || 60)), enabled: Boolean(input.enabled) };
}

function enqueueNotification(action, plan) {
  if (!store.settings.telegram.enabled || !store.settings.telegram.chatId || !store.settings.telegram.botTokenEncrypted) {
    addEvent("notification_skipped", `${plan.name}：通知未配置，已记录状态变化`, { providerId: plan.providerId, planId: plan.id });
    return;
  }
  store.notifications.push({ id: `job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, action, planId: plan.id, attempts: 0, nextAttemptAt: new Date().toISOString(), createdAt: new Date().toISOString(), lastError: null });
}

async function deliverNotifications() {
  const now = Date.now();
  for (const job of [...store.notifications]) {
    if (Date.parse(job.nextAttemptAt) > now) continue;
    const plan = store.plans.find((item) => item.id === job.planId);
    if (!plan) { store.notifications = store.notifications.filter((item) => item.id !== job.id); continue; }
    try {
      if (job.action === "restocked") {
        const result = await telegram("sendMessage", { chat_id: store.settings.telegram.chatId, text: formatCard(plan, "restocked"), parse_mode: "HTML", disable_web_page_preview: true });
        plan.notification = { chatId: String(store.settings.telegram.chatId), messageId: result.message_id, sentAt: new Date().toISOString() };
        addEvent("telegram_sent", `${plan.name}：已发送补货卡片`, { providerId: plan.providerId, planId: plan.id });
      } else if (job.action === "sold_out") {
        if (store.settings.telegram.soldoutMode === "edit" && plan.notification?.messageId) {
          await telegram("editMessageText", { chat_id: plan.notification.chatId, message_id: plan.notification.messageId, text: formatCard(plan, "sold_out"), parse_mode: "HTML", disable_web_page_preview: true });
          addEvent("telegram_edited", `${plan.name}：已编辑为售罄`, { providerId: plan.providerId, planId: plan.id });
        }
      } else if (job.action === "stock_changed" && plan.notification?.messageId) {
        await telegram("editMessageText", { chat_id: plan.notification.chatId, message_id: plan.notification.messageId, text: formatCard(plan, "restocked"), parse_mode: "HTML", disable_web_page_preview: true });
        addEvent("telegram_edited", `${plan.name}：已更新库存卡片`, { providerId: plan.providerId, planId: plan.id });
      }
      store.notifications = store.notifications.filter((item) => item.id !== job.id);
    } catch (error) {
      job.attempts += 1;
      job.lastError = error.message;
      job.nextAttemptAt = error.retryAfter ? new Date(now + Number(error.retryAfter) * 1000).toISOString() : nextRetry(job.attempts, now);
      addEvent("telegram_failed", `${plan.name}：TG 投递失败，将重试`, { providerId: plan.providerId, planId: plan.id, error: error.message });
    }
  }
}

async function runMonitor(monitor) {
  const provider = store.providers.find((item) => item.id === monitor.providerId);
  const started = Date.now();
  if (!provider) throw new Error("商家不存在");
  const adapter = getAdapter(provider.adapterKey);
  if (!adapter) throw new Error(`Adapter ${provider.adapterKey} 尚未安装`);
  const discovered = await adapter.discover({ provider });
  if (!Array.isArray(discovered)) throw new Error("Adapter discover() 必须返回套餐数组");
  const current = discovered.map((plan) => normalizePlan(plan, provider.id));
  const previousById = new Map(store.plans.filter((plan) => plan.providerId === provider.id).map((plan) => [plan.id, plan]));
  for (const plan of current) {
    const result = reconcilePlan(previousById.get(plan.id), plan, monitor);
    const index = store.plans.findIndex((item) => item.id === plan.id);
    if (index >= 0) store.plans[index] = result.next; else store.plans.push(result.next);
    if (result.action) {
      addEvent(result.action, `${plan.name}：${result.reason}`, { providerId: provider.id, planId: plan.id });
      enqueueNotification(result.action, result.next);
    }
  }
  monitor.lastRunAt = new Date().toISOString();
  monitor.lastDurationMs = Date.now() - started;
  monitor.lastError = null;
  monitor.consecutiveFailures = 0;
  addEvent("monitor_succeeded", `${provider.name}：探测到 ${current.length} 个套餐`, { providerId: provider.id });
}

let schedulerBusy = false;
async function schedulerTick() {
  if (schedulerBusy) return;
  schedulerBusy = true;
  try {
    const now = Date.now();
    store.runtime.lastTickAt = new Date().toISOString();
    for (const monitor of store.monitors.filter((item) => item.enabled)) {
      if (monitor.lastRunAt && now - Date.parse(monitor.lastRunAt) < monitor.intervalSeconds * 1000) continue;
      try { await runMonitor(monitor); }
      catch (error) {
        monitor.lastRunAt = new Date().toISOString();
        monitor.lastDurationMs = 0;
        monitor.lastError = error.message;
        monitor.consecutiveFailures = (monitor.consecutiveFailures || 0) + 1;
        addEvent("monitor_failed", `${monitorView(monitor).providerName}：${error.message}`, { providerId: monitor.providerId, error: error.message });
      }
    }
    await deliverNotifications();
    await save();
  } finally { schedulerBusy = false; }
}

async function api(req, res, url) {
  const parts = url.pathname.split("/").filter(Boolean);
  if (req.method === "GET" && url.pathname === "/api/dashboard") return json(res, 200, dashboard());
  if (req.method === "GET" && url.pathname === "/api/providers") return json(res, 200, store.providers);
  if (req.method === "GET" && parts[0] === "api" && parts[1] === "providers" && parts[2] && parts[3] === "plans") {
    return json(res, 200, store.plans.filter((plan) => plan.providerId === parts[2]));
  }
  if (req.method === "PATCH" && parts[0] === "api" && parts[1] === "providers" && parts[2] && parts[3] === "monitor") {
    const provider = store.providers.find((item) => item.id === parts[2]);
    if (!provider) return json(res, 404, { error: "未找到商家" });
    const input = await body(req);
    const existing = store.monitors.find((item) => item.providerId === provider.id);
    const monitor = { ...validateMonitor({ ...input, providerId: provider.id, planIds: input.selectedPlanIds || input.planIds }, existing?.id), id: existing?.id || `monitor_${Date.now()}`, createdAt: existing?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(), lastRunAt: existing?.lastRunAt || null, lastError: existing?.lastError || null };
    store.monitors = existing ? store.monitors.map((item) => item.id === existing.id ? monitor : item) : [...store.monitors, monitor];
    await save(); return json(res, 200, monitorView(monitor));
  }
  if (req.method === "GET" && url.pathname === "/api/monitors") return json(res, 200, store.monitors.map(monitorView));
  if (req.method === "POST" && url.pathname === "/api/monitors") {
    try {
      const input = await body(req);
      const now = new Date().toISOString();
      const monitor = { ...validateMonitor(input), id: `monitor_${Date.now()}`, createdAt: now, updatedAt: now, lastRunAt: null, lastError: null };
      store.monitors.push(monitor);
      await save(); return json(res, 201, monitorView(monitor));
    } catch (error) { return json(res, 400, { error: error.message }); }
  }
  if (req.method === "PATCH" && parts[0] === "api" && parts[1] === "monitors" && parts[2]) {
    const existing = store.monitors.find((item) => item.id === parts[2]);
    if (!existing) return json(res, 404, { error: "未找到监控任务" });
    try {
      const input = await body(req);
      const monitor = { ...existing, ...validateMonitor({ ...existing, ...input }, existing.id), updatedAt: new Date().toISOString() };
      store.monitors = store.monitors.map((item) => item.id === existing.id ? monitor : item);
      await save(); return json(res, 200, monitorView(monitor));
    } catch (error) { return json(res, 400, { error: error.message }); }
  }
  if (req.method === "POST" && parts[0] === "api" && parts[1] === "monitors" && parts[2] && parts[3] === "run") {
    const monitor = store.monitors.find((item) => item.id === parts[2]);
    if (!monitor) return json(res, 404, { error: "未找到监控任务" });
    try { await runMonitor(monitor); await deliverNotifications(); await save(); return json(res, 200, monitorView(monitor)); }
    catch (error) { monitor.lastError = error.message; monitor.consecutiveFailures = (monitor.consecutiveFailures || 0) + 1; monitor.lastRunAt = new Date().toISOString(); addEvent("monitor_failed", `${monitorView(monitor).providerName}：${error.message}`, { providerId: monitor.providerId, error: error.message }); await save(); return json(res, 400, { error: error.message }); }
  }
  if (req.method === "DELETE" && parts[0] === "api" && parts[1] === "monitors" && parts[2]) {
    if (!store.monitors.some((item) => item.id === parts[2])) return json(res, 404, { error: "未找到监控任务" });
    store.monitors = store.monitors.filter((item) => item.id !== parts[2]);
    await save(); return json(res, 204, {});
  }
  if (req.method === "GET" && url.pathname === "/api/events") return json(res, 200, store.events);
  if (req.method === "GET" && url.pathname === "/api/settings") return json(res, 200, maskedSettings());
  if (req.method === "PUT" && url.pathname === "/api/settings") {
    const input = await body(req);
    const old = store.settings.telegram;
    const next = input.telegram || {};
    const rawToken = next.botToken?.trim();
    const { botToken, ...safeNext } = next;
    store.settings.telegram = { ...old, ...safeNext };
    if (rawToken) {
      store.settings.telegram.botTokenEncrypted = encryptToken(rawToken);
      delete store.settings.telegram.botToken;
    }
    store.settings.updates = { ...store.settings.updates, ...(input.updates || {}), branch: (input.updates?.branch || store.settings.updates.branch || "main").trim() };
    await save(); return json(res, 200, maskedSettings());
  }
  if (req.method === "POST" && url.pathname === "/api/telegram/test") {
    try {
      const { chatId } = store.settings.telegram;
      if (!chatId) throw new Error("请先保存频道 Chat ID");
      await telegram("sendMessage", { chat_id: chatId, text: "✅ <b>VPS Monitor 已连接</b>\nTG 通知模板测试成功。", parse_mode: "HTML", disable_web_page_preview: true });
      return json(res, 200, { ok: true });
    } catch (error) { return json(res, 400, { error: error.message }); }
  }
  if (req.method === "POST" && url.pathname === "/api/telegram/preview") {
    const input = await body(req);
    return json(res, 200, { text: formatCard(input.plan || { name: "BEROHOST-Ryzen Anniversary S", price: "€39.00 EUR", billingCycle: "year", location: "德国 · 法兰克福", specs: "2 Core Ryzen 9 9950X / 6GB / 60GB", quantity: 3, buyUrl: "https://bero-host.de", tags: ["berohost", "DE", "补货"] }, input.status) });
  }
  if (req.method === "GET" && url.pathname === "/api/updates/status") return json(res, 200, updateStatus());
  if (req.method === "POST" && url.pathname === "/api/updates/apply") {
    const status = updateStatus();
    if (!status.configured) return json(res, 400, { error: "请先保存 GitHub 仓库。" });
    if (!status.deployReady) return json(res, 400, { error: status.message });
    if (!status.updateAvailable) return json(res, 400, { error: "当前已是最新版本。" });
    try {
      git(["fetch", "origin", store.settings.updates.branch]);
      git(["pull", "--ff-only", "origin", store.settings.updates.branch]);
      json(res, 200, { ok: true, message: "代码已更新，进程即将退出并由部署服务自动重启。" });
      setTimeout(() => process.exit(0), 800);
      return;
    } catch (error) { return json(res, 400, { error: `更新失败：${error.stderr?.trim() || error.message}` }); }
  }
  return json(res, 404, { error: "接口不存在" });
}

const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml" };
const server = createServer(async (req, res) => {
  try {
    if (!protectedRequest(req, res)) return;
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) return await api(req, res, url);
    const requested = url.pathname === "/" ? "/public/index.html" : `/public${url.pathname}`;
    const file = normalize(join(root, requested));
    if (!file.startsWith(join(root, "public"))) return json(res, 403, { error: "禁止访问" });
    const content = await readFile(file);
    res.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream" });
    res.end(content);
  } catch (error) {
    if (error.code === "ENOENT") return json(res, 404, { error: "资源不存在" });
    console.error(error); return json(res, 500, { error: "服务器错误" });
  }
});
server.listen(port, host, () => console.log(`VPS Monitor is running at http://${host}:${port}`));
setInterval(() => schedulerTick().catch((error) => console.error("Scheduler tick failed", error)), 1000).unref();
schedulerTick().catch((error) => console.error("Initial scheduler tick failed", error));

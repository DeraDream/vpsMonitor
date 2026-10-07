import { decryptToken } from "./crypto.mjs";
export function escapeHtml(value) { return String(value).replace(/[&<>]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;"})[c]); }
function escapeAttr(value) { return escapeHtml(value).replace(/"/g, "&quot;"); }
export function formatCard(plan, telegramSettings, status = "restocked") {
  const lines = [status === "sold_out" ? "🔴 <b>售罄</b>" : "🟢 <b>补货提醒</b>", "", `📦 <b>${escapeHtml(plan.name)}</b>`,
    plan.price ? `💰 ${escapeHtml(plan.price)}${plan.billingCycle ? ` / ${escapeHtml(plan.billingCycle)}` : ""}` : "",
    plan.location ? `📍 ${escapeHtml(plan.location)}` : "", plan.specs ? `💻 ${escapeHtml(plan.specs)}` : "",
    Number.isInteger(plan.quantity) ? `📦 库存：${plan.quantity} 台` : "", status === "sold_out" ? "📦 本次补货已售罄" : "",
    telegramSettings.showBuyLink && plan.buyUrl ? `🛒 <a href=\"${escapeAttr(plan.buyUrl)}\">立即购买</a>` : "",
    plan.tags?.length ? plan.tags.map(tag => `#${tag}`).join(" ") : ""];
  return lines.filter(Boolean).join("\n");
}
export async function telegramCall(settings, method, payload) {
  if (!settings.botTokenEncrypted) throw new Error("请先保存 Telegram Bot Token");
  const token = decryptToken(settings.botTokenEncrypted);
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
  const result = await response.json();
  if (!result.ok) { const error = new Error(result.description || "Telegram 请求失败"); error.retryAfter = result.parameters?.retry_after; throw error; }
  return result.result;
}

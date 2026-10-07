import { quietHoursStatus, beijingTimestamp } from "./notification-policy.mjs";
import { decryptToken } from "./crypto.mjs";
export function escapeHtml(value) { return String(value).replace(/[&<>]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;"})[c]); }
function escapeAttr(value) { return escapeHtml(value).replace(/"/g, "&quot;"); }
export function formatCard(plan, telegramSettings, status = "restocked") {
  const lines = [status === "new_plan" ? "✨ <b>新套餐上架</b>" : status === "sold_out" ? "🔴 <b>售罄</b>" : status === "stock_changed" ? "📊 <b>库存变化</b>" : plan.availabilitySource==="order-button"?"🟢 <b>可订购提醒</b>":"🟢 <b>补货提醒</b>", "", plan.categoryName ? `🗂 ${escapeHtml(plan.categoryName)}` : "", `📦 <b>${escapeHtml(plan.name)}</b>`,
    status === "new_plan" ? `📌 库存状态：${plan.available ? "有货 / 可订购" : "已售罄"}` : "",
    plan.price ? `💰 ${escapeHtml(plan.price)}${plan.billingCycle ? ` / ${escapeHtml(plan.billingCycle)}` : ""}` : "",
    plan.location ? `📍 ${escapeHtml(plan.location)}` : "", plan.specs ? `💻 ${escapeHtml(plan.specs)}` : "",
    Number.isInteger(plan.quantity) ? `📦 库存：${plan.quantity} 台` : "", status === "stock_changed" && plan.previousQuantity !== undefined ? `📈 库存变化：${Number.isInteger(plan.previousQuantity)?plan.previousQuantity:"未公开"} → ${Number.isInteger(plan.quantity)?plan.quantity:"未公开"}` : "",
    plan.observedAt ? `🕒 检测时间：${escapeHtml(beijingTimestamp(plan.observedAt))}（北京时间）` : "",
    telegramSettings.showBuyLink && /^https?:\/\//i.test(plan.buyUrl || "") ? `🛒 <a href=\"${escapeAttr(plan.buyUrl)}\">立即购买</a>` : "",
    plan.tags?.length ? plan.tags.map(tag => `#${escapeHtml(tag)}`).join(" ") : ""];
  return lines.filter(Boolean).join("\n");
}
export async function telegramCall(settings, method, payload, {now=Date.now()}={}) {
  const quiet=quietHoursStatus(settings,now);
  if(quiet.active){const error=new Error(`当前为北京时间免打扰时段（${settings.quietHours.start}–${settings.quietHours.end}），Telegram 暂停发送和编辑`);error.quietHours=true;error.resumeAt=quiet.resumeAt;throw error;}
  if (!settings.botTokenEncrypted) throw new Error("请先保存 Telegram Bot Token");
  const token = decryptToken(settings.botTokenEncrypted);
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload),signal:AbortSignal.timeout(15000)});
  const result = await response.json();
  if (!result.ok && method === "editMessageText" && /message is not modified/i.test(result.description || "")) return {};
  if (!result.ok) { const error = new Error(result.description || "Telegram 请求失败"); error.retryAfter = result.parameters?.retry_after; error.permanent = [400,401,403,404].includes(result.error_code ?? response.status); throw error; }
  return result.result;
}

export function telegramTargets(settings) {
  const targets=[];
  if(settings.channelEnabled!==false&&settings.chatId)targets.push({kind:'channel',chatId:String(settings.chatId).trim()});
  if(settings.personalEnabled&&settings.personalChatId)targets.push({kind:'personal',chatId:String(settings.personalChatId).trim()});
  return targets.filter((target,index)=>target.chatId&&targets.findIndex(other=>other.chatId===target.chatId)===index);
}

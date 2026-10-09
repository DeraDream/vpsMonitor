import { quietHoursStatus } from "./notification-policy.mjs";
import { decryptToken } from "./crypto.mjs";
export function escapeHtml(value) { return String(value).replace(/[&<>]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;"})[c]); }
function escapeAttr(value) { return escapeHtml(value).replace(/"/g, "&quot;"); }
function titleFor(plan, status) {
  if (status === "new_plan") return "✨ <b>新套餐上架</b>";
  if (status === "sold_out") return "🔴 <b>售罄</b>";
  if (status === "stock_changed") return "📊 <b>库存变化</b>";
  return plan.availabilitySource === "order-button" ? "🟢 <b>可订购提醒</b>" : "🟢 <b>补货提醒</b>";
}

function configurationLines(plan) {
  const rows = Array.isArray(plan.configuration) ? plan.configuration : [];
  if (rows.length) return rows.map(row => `• ${escapeHtml(row.label)}：${escapeHtml(row.value)}`);
  return plan.specs ? [`• ${escapeHtml(plan.specs)}`] : [];
}

export function formatCard(plan, telegramSettings, status = "restocked") {
  const merchant = plan.providerName || plan.providerId || "商家";
  const identity = `🏪 <b>${escapeHtml(merchant)} - ${escapeHtml(plan.name)}</b>`;
  const hasBuyLink = /^https?:\/\//i.test(plan.buyUrl || "");
  const linkedIdentity = hasBuyLink ? `<a href="${escapeAttr(plan.buyUrl)}">${identity}</a>` : identity;
  const overview = [
    status === "sold_out" ? `<s>${linkedIdentity}</s>` : linkedIdentity,
    plan.price ? `💰 ${escapeHtml(plan.price)}${plan.billingCycle ? ` / ${escapeHtml(plan.billingCycle)}` : ""}` : "",
    plan.location ? `📍 ${escapeHtml(plan.location)}` : "",
    plan.categoryName ? `🛣 线路 / 产品线：${escapeHtml(plan.categoryName)}` : ""
  ].filter(Boolean);
  const configuration = configurationLines(plan);
  const inventory = [
    status === "stock_changed" && plan.previousQuantity !== undefined
      ? `📈 库存变化：${Number.isInteger(plan.previousQuantity) ? plan.previousQuantity : "未公开"} → ${Number.isInteger(plan.quantity) ? plan.quantity : "未公开"}` : "",
    Number.isInteger(plan.quantity) ? `📦 库存：${plan.quantity} 台` : ""
  ].filter(Boolean).join("\n");
  const purchase = telegramSettings.showBuyLink && /^https?:\/\//i.test(plan.buyUrl || "")
    ? `${status === "sold_out" ? "<s>" : ""}🛒 购买链接：<a href=\"${escapeAttr(plan.buyUrl)}\">${escapeHtml(plan.buyUrl)}</a>${status === "sold_out" ? "</s>" : ""}` : "";
  const tags = plan.tags?.length ? plan.tags.map(tag => `#${escapeHtml(tag)}`).join(" ") : "";
  return [
    titleFor(plan, status),
    overview.join("\n"),
    configuration.length ? ["<b>配置</b>", ...configuration].join("\n") : "",
    inventory,
    purchase,
    tags
  ].filter(Boolean).join("\n\n");
}
export async function telegramCall(settings, method, payload, {now=Date.now(),management=false}={}) {
  const quiet=quietHoursStatus(settings,now);
  if(quiet.active&&!management){const error=new Error(`当前为北京时间免打扰时段（${settings.quietHours.start}–${settings.quietHours.end}），Telegram 暂停发送和编辑`);error.quietHours=true;error.resumeAt=quiet.resumeAt;throw error;}
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

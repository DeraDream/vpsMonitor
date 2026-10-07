export function normalizePlan(input, providerId) {
  if (!input?.externalId) throw new Error("Adapter 套餐缺少 externalId");
  if (!input?.name) throw new Error(`Adapter 套餐 ${input.externalId} 缺少 name`);
  if (typeof input.available !== "boolean") throw new Error(`Adapter 套餐 ${input.externalId} 的 available 必须是布尔值`);
  const quantity = Number.isInteger(input.quantity) && input.quantity >= 0 ? input.quantity : null;
  return {
    id: `${providerId}:${input.externalId}`,
    providerId,
    externalId: String(input.externalId),
    categoryId: input.categoryId ? String(input.categoryId) : "",
    categoryName: input.categoryName ? String(input.categoryName) : "",
    sourceUrl: input.sourceUrl ? String(input.sourceUrl) : "",
    listed: input.listed !== false,
    name: String(input.name),
    specs: input.specs ? String(input.specs) : "",
    ...Object.fromEntries(["cpu", "ram", "nvme", "ipv4", "ipv6", "backups", "runtime", "storage", "storageType", "bandwidth", "portSpeed", "os", "controlPanel", "virtualization", "description", "availabilitySource"].map(field => [field, input[field] == null ? "" : String(input[field]).trim()])),
    configuration: Array.isArray(input.configuration) ? input.configuration.filter(row => row && typeof row.label === "string" && typeof row.value === "string" && row.label.trim() && row.value.trim()).map(row => ({label: row.label.trim(), value: row.value.trim()})) : [],
    price: input.price ? String(input.price) : "",
    billingCycle: input.billingCycle ? String(input.billingCycle) : "",
    location: input.location ? String(input.location) : "",
    buyUrl: input.buyUrl ? String(input.buyUrl) : "",
    tags: Array.isArray(input.tags) ? input.tags.map(String) : [],
    available: input.available,
    quantity
  };
}
export function monitored(plan, monitor) { return monitor.scope === "all" || (monitor.scope === "categories" ? (monitor.categoryIds||[]).includes(plan.categoryId) : monitor.planIds.includes(plan.id)); }
export function reconcilePlan(previous, next, monitor, {notifyAllChanges=false}={}) {
  if (!previous) return { next: { ...next, notification: null }, action: next.available && monitored(next, monitor) ? "restocked" : null, reason: "首次发现" };
  const notification = previous.notification || null;
  const wasAvailable = Boolean(previous.available), isAvailable = Boolean(next.available);
  const base = { ...previous, ...next, notification };
  if (!monitored(next, monitor)) return { next: base, action: null, reason: "不在监控范围" };
  if (!wasAvailable && isAvailable) return { next: { ...base, notification: null }, action: "restocked", reason: "由缺货变为有货" };
  if (wasAvailable && !isAvailable) return { next: base, action: notifyAllChanges || notification?.messageId ? "sold_out" : null, reason: "由有货变为缺货" };
  if ((notifyAllChanges && (previous.quantity ?? null) !== (next.quantity ?? null)) || (wasAvailable && isAvailable && Number.isInteger(previous.quantity) && Number.isInteger(next.quantity) && previous.quantity !== next.quantity && notification?.messageId)) {
    return { next: base, action: "stock_changed", reason: !Number.isInteger(previous.quantity)||!Number.isInteger(next.quantity) ? "库存数量公开状态变化" : next.quantity < previous.quantity ? "库存减少" : "库存增加" };
  }
  return { next: base, action: null, reason: "状态未变化" };
}
export function nextRetry(attempts, now = Date.now()) { return new Date(now + Math.min(30 * 60_000, 1_000 * 2 ** Math.min(attempts, 20))).toISOString(); }

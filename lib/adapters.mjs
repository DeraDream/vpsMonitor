// 商家 Adapter 后续在这里注册。每个 Adapter 必须导出 discover()，返回 normalizePlan 所需字段。
export const adapters = new Map();

export function getAdapter(key) {
  return adapters.get(key) || null;
}

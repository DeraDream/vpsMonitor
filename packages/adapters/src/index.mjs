const adapters = new Map();
export function registerAdapter(adapter) {
  if (!adapter?.key || typeof adapter.discover !== "function") throw new Error("Adapter 必须包含 key 和 discover() 方法");
  adapters.set(adapter.key, adapter);
  return adapter;
}
export function getAdapter(key) { return adapters.get(key) || null; }
export function listAdapters() { return [...adapters.values()].map(({key,name,version}) => ({key,name:name || key,version:version || "0.0.0"})); }

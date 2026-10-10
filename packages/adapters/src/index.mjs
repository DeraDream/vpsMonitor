import { beroHost } from "./bero-host/index.mjs";
import { greenCloud } from "./greencloud/index.mjs";
import { vpsHosting } from "./vps-hosting/index.mjs";
import { vmiss } from "./vmiss/index.mjs";
import { dmit } from "./dmit/index.mjs";
const adapters = new Map();
export function registerAdapter(adapter) {
  if (!adapter?.key || typeof adapter.discover !== "function") throw new Error("Adapter 必须包含 key 和 discover() 方法");
  adapters.set(adapter.key, adapter);
  return adapter;
}
export function getAdapter(key) { return adapters.get(key) || null; }
export function listAdapters() { return [...adapters.values()].map(({key,name,version}) => ({key,name:name || key,version:version || "0.0.0"})); }
export function builtInProviders() { return [...adapters.values()].filter(adapter=>adapter.provider).map(adapter=>({...adapter.provider,adapterKey:adapter.key,adapterVersion:adapter.version,status:"active"})); }
registerAdapter(beroHost);

registerAdapter(greenCloud);
registerAdapter(vpsHosting);
registerAdapter(vmiss);
registerAdapter(dmit);

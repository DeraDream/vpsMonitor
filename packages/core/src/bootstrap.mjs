import { randomUUID } from "node:crypto";
import { builtInProviders } from "@vps-monitor/adapters";

export function bootstrapProviders(store) {
  // Test servers use fixtures and must not start live merchant monitoring.
  if (process.env.DISABLE_BUILTIN_PROVIDERS === "1") return;
  store.transaction(() => {
    for (const provider of builtInProviders()) {
      const existing = store.getProvider(provider.id);
      store.putProvider({ ...existing, ...provider, categories:provider.dynamicCategories?(existing?.categories||provider.categories):provider.categories });
      // Once deleted by the user, a monitor is not recreated at every restart.
      if (!existing && !store.getMonitorByProvider(provider.id)) {
        const now = new Date().toISOString();
        store.putMonitor({ id: `monitor_${randomUUID()}`, providerId: provider.id, scope: "all", planIds: [], enabled: true,
          intervalSeconds: provider.defaultIntervalSeconds||60, createdAt: now, updatedAt: now, lastRunAt: null, lastError: null, consecutiveFailures: 0 });
      }
    }
  });
}

import { builtInProviders } from "@vps-monitor/adapters";

export function bootstrapProviders(store) {
  // Test servers use fixtures and must not start live merchant monitoring.
  if (process.env.DISABLE_BUILTIN_PROVIDERS === "1") return;
  store.transaction(() => {
    const now = new Date().toISOString();
    for (const provider of builtInProviders()) {
      const existing = store.getProvider(provider.id);
      store.putProvider({ ...existing, ...provider, createdAt:existing?.createdAt||now, categories:provider.dynamicCategories?(existing?.categories||provider.categories):provider.categories });
      // Registering a merchant is catalogue-only. Monitoring starts only after
      // an administrator explicitly creates a task for one or more plans.
    }
  });
}

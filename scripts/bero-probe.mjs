import { createDatabase } from '@vps-monitor/db'
import { bootstrapProviders, createService } from '@vps-monitor/core'

const store = createDatabase(process.env.DATA_DIR || './data')
try {
  bootstrapProviders(store)
  const monitor = store.getMonitorByProvider('bero-host')
  if (!monitor) throw new Error('Bero Host 监控已删除，请在页面中重新添加')
  const result = await createService(store).runMonitorSafe(monitor)
  console.log(JSON.stringify({ provider: 'Bero Host', enabled: result.enabled, scope: result.scope,
    intervalSeconds: result.intervalSeconds, lastRunAt: result.lastRunAt, lastError: result.lastError,
    categories: result.categories.map(category => ({ name: category.name, plans: category.planCount,
      inStock: category.inStock, lastError: category.lastError })) }, null, 2))
  if (result.lastError) process.exitCode = 1
} finally { store.close() }

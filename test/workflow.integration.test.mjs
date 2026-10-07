import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDatabase } from '../packages/db/src/database.mjs'
import { createService } from '../packages/core/src/service.mjs'
import { encryptToken } from '../packages/core/src/crypto.mjs'

async function waitFor(check) {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error('等待服务状态超时')
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit')
  child.kill('SIGTERM')
  await exited
}

test('API 编辑、删除、校验、事件查询和重启持久化；Worker 心跳', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'vpsm-workflow-'))
  const store = createDatabase(dir)
  store.putProvider({ id: 'fixture', name: 'Test fixture', adapterKey: 'not-installed' })
  const env = { ...process.env, DISABLE_BUILTIN_PROVIDERS: "1", DATA_DIR: dir, HOST: '127.0.0.1', ADMIN_PASSWORD: 'workflow-password', TOKEN_ENCRYPTION_KEY: 'workflow-key', WORKER_TICK_MS: '500' }
  const auth = `Basic ${Buffer.from('admin:workflow-password').toString('base64')}`
  let api, worker, base
  async function startApi() {
    api = spawn(process.execPath, ['apps/api/src/server.mjs'], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    api.stdout.on('data', chunk => { output += chunk })
  }
  const port = 47000 + Math.floor(Math.random() * 1000)
  env.PORT = String(port)
  base = `http://127.0.0.1:${port}`
  const request = async (path, method = 'GET', body) => {
    const response = await fetch(base + path, { method, headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: response.status, data: response.status === 204 ? null : await response.json() }
  }
  const ready = () => waitFor(async () => { try { return (await request('/api/dashboard')).status === 200 } catch { return false } })
  try {
    await startApi(); await ready()
    assert.equal((await fetch(base + '/api/settings')).status, 401)
    const created = await request('/api/monitors', 'POST', { providerId: 'fixture', scope: 'all', enabled: false, intervalSeconds: 1 })
    assert.equal(created.status, 201)
    assert.equal(created.data.intervalSeconds, 30)
    const id = created.data.id
    assert.equal((await request('/api/monitors', 'POST', { providerId: 'fixture' })).status, 400)
    assert.equal((await request('/api/monitors', 'POST', { providerId: 'missing' })).status, 400)
    assert.equal((await request(`/api/monitors/${id}`, 'PATCH', { scope: 'selected', planIds: [] })).status, 400)
    const edited = await request(`/api/monitors/${id}`, 'PATCH', { intervalSeconds: 120, enabled: true })
    assert.equal(edited.data.intervalSeconds, 120)
    assert.equal(edited.data.enabled, true)
    assert.equal((await request(`/api/monitors/${id}/run`, 'POST', {})).status, 400)
    const failed = (await request('/api/monitors')).data[0]
    assert.equal(failed.consecutiveFailures, 1)
    assert.match(failed.lastError, /尚未安装/)
    assert.deepEqual((await request('/api/events')).data, []);assert.ok(store.listEvents().some(e=>e.type==='monitor_failed'))
    await request(`/api/monitors/${id}`, 'PATCH', { enabled: false })
    await request('/api/settings', 'PUT', { telegram: { botToken: 'test-only-secret', chatId: '-123' } })
    await stop(api); await startApi(); await ready()
    assert.equal((await request('/api/monitors')).data[0].intervalSeconds, 120)
    assert.equal((await request('/api/settings')).data.telegram.botTokenConfigured, true)
    assert.equal((await request('/api/telegram/preview', 'POST', {})).status, 200)
    assert.equal((await request(`/api/monitors/${id}`, 'DELETE')).status, 204)
    assert.equal((await request(`/api/monitors/${id}`, 'DELETE')).status, 404)
    worker = spawn(process.execPath, ['apps/worker/src/worker.mjs'], { env, stdio: 'ignore' })
    await waitFor(() => Boolean(store.getRuntime().lastTickAt))
    const first = store.getRuntime().lastTickAt
    await waitFor(() => store.getRuntime().lastTickAt !== first)
    await stop(worker)
    assert.equal((await request('/api/dashboard')).data.runtime.lastTickAt, store.getRuntime().lastTickAt)
    await t.test('错误 JSON 应返回 400', async () => {
      const response = await fetch(base + '/api/telegram/preview', { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: '{' })
      assert.equal(response.status, 400)
    })
    await t.test('TG enabled 必须是布尔值', async () => {
      assert.equal((await request('/api/settings', 'PUT', { telegram: { enabled: 'false' } })).status, 400)
    })
    await t.test('TG 密文不能由客户端直接覆盖', async () => {
      assert.equal((await request('/api/settings', 'PUT', { telegram: { botTokenEncrypted: 'invalid' } })).status, 400)
    })
  } finally {
    if (worker) await stop(worker)
    if (api) await stop(api)
    store.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('Telegram 429 保留队列并遵守 retry_after，成功后移除；不发送真实消息', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vpsm-notification-'))
  const store = createDatabase(dir)
  const originalFetch = globalThis.fetch
  const originalKey = process.env.TOKEN_ENCRYPTION_KEY
  process.env.TOKEN_ENCRYPTION_KEY = 'notification-test-key'
  try {
    const settings = store.getSettings()
    settings.telegram = { ...settings.telegram, enabled: true, chatId: '-123', botTokenEncrypted: encryptToken('fixture-token') }
    store.setSettings(settings)
    store.putProvider({id:'fixture',name:'Fixture'});store.putMonitor({id:'fixture-monitor',providerId:'fixture',scope:'all',planIds:[],enabled:true});
    store.putPlan({ id: 'fixture:item', providerId: 'fixture', name: 'Fixture', available: true, quantity: 1, tags: [] })
    store.putNotification({ id: 'job', action: 'restocked', planId: 'fixture:item', attempts: 0, nextAttemptAt: new Date(0).toISOString() })
    const service = createService(store)
    globalThis.fetch = async () => ({ json: async () => ({ ok: false, description: 'Too Many Requests', parameters: { retry_after: 60 } }) })
    const before = Date.now()
    await service.deliverNotifications()
    const retry = store.listNotifications()[0]
    assert.equal(retry.attempts, 1)
    assert.ok(Date.parse(retry.nextAttemptAt) >= before + 60000)
    retry.nextAttemptAt = new Date(0).toISOString(); store.putNotification(retry)
    globalThis.fetch = async (url, options) => {
      assert.match(url, /\/sendMessage$/)
      assert.equal(JSON.parse(options.body).chat_id, '-123')
      return { json: async () => ({ ok: true, result: { message_id: 42 } }) }
    }
    await service.deliverNotifications()
    assert.equal(store.listNotifications().length, 0)
    assert.equal(store.getPlan('fixture:item').notification.messageId, 42)
  } finally {
    globalThis.fetch = originalFetch
    if (originalKey === undefined) delete process.env.TOKEN_ENCRYPTION_KEY
    else process.env.TOKEN_ENCRYPTION_KEY = originalKey
    store.close()
    await rm(dir, { recursive: true, force: true })
  }
})

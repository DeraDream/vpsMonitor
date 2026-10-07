import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDatabase } from '../packages/db/src/database.mjs'
import { createService } from '../packages/core/src/service.mjs'
import { encryptToken } from '../packages/core/src/crypto.mjs'
import { formatCard } from '../packages/core/src/telegram.mjs'
import { registerAdapter } from '../packages/adapters/src/index.mjs'

async function fixture(run) {
  const dir = await mkdtemp(join(tmpdir(), 'vpsm-cycle-'))
  const store = createDatabase(dir), service = createService(store)
  const savedFetch = globalThis.fetch, savedKey = process.env.TOKEN_ENCRYPTION_KEY
  process.env.TOKEN_ENCRYPTION_KEY = 'cycle-test-key'
  let state = { available: false, quantity: 0 }, calls = []
  registerAdapter({ key: 'synthetic-cycle', async discover() { return [{ externalId: 'item', name: 'Synthetic fixture', tags: [], ...state }] } })
  store.putProvider({ id: 'synthetic', name: 'Synthetic fixture', adapterKey: 'synthetic-cycle' })
  const monitor = { id: 'm', providerId: 'synthetic', scope: 'all', planIds: [], enabled: true, intervalSeconds: 30 }
  store.putMonitor(monitor)
  const settings = store.getSettings()
  settings.telegram = { ...settings.telegram, enabled: true, chatId: '-1', botTokenEncrypted: encryptToken('fake-token') }
  store.setSettings(settings)
  globalThis.fetch = async (url, options) => {
    calls.push({ method: url.split('/').at(-1), ...JSON.parse(options.body) })
    return { json: async () => ({ ok: true, result: { message_id: calls.length } }) }
  }
  const probe = async next => { state = next; await service.runMonitorSafe(store.getMonitor('m')) }
  try { await run({ dir, store, service, calls, probe }) }
  finally {
    globalThis.fetch = savedFetch
    if (savedKey === undefined) delete process.env.TOKEN_ENCRYPTION_KEY
    else process.env.TOKEN_ENCRYPTION_KEY = savedKey
    store.close(); await rm(dir, { recursive: true, force: true })
  }
}

test('模拟完整补货周期：补货发送、库存变化编辑、售罄编辑、再次补货新消息', () => fixture(async ({ service, calls, probe }) => {
  await probe({ available: false, quantity: 0 }); await service.deliverNotifications()
  assert.equal(calls.length, 0)
  await probe({ available: true, quantity: 3 }); await service.deliverNotifications()
  await probe({ available: true, quantity: 3 }); await service.deliverNotifications()
  assert.equal(calls.length, 1)
  await probe({ available: true, quantity: 2 }); await service.deliverNotifications()
  await probe({ available: false, quantity: 0 }); await service.deliverNotifications()
  await probe({ available: true, quantity: 1 }); await service.deliverNotifications()
  assert.deepEqual(calls.map(c => c.method), ['sendMessage', 'editMessageText', 'editMessageText', 'sendMessage'])
  assert.equal(calls[1].message_id, calls[2].message_id)
  assert.match(calls[2].text, /售罄/)
}))

test('已售罄的积压补货通知应取消', () => fixture(async ({ service, calls, probe }) => {
  await probe({ available: true, quantity: 3 })
  await probe({ available: false, quantity: 0 })
  await service.deliverNotifications()
  assert.equal(calls.length, 0)
}))

test('关闭 TG 后积压队列应停止发送', () => fixture(async ({ store, service, calls, probe }) => {
  await probe({ available: true, quantity: 3 })
  const settings = store.getSettings(); settings.telegram.enabled = false; store.setSettings(settings)
  await service.deliverNotifications()
  assert.equal(calls.length, 0)
}))

test('两个投递者不能发送同一 job 两次', () => fixture(async ({ service, calls, probe }) => {
  await probe({ available: true, quantity: 3 })
  await Promise.all([service.deliverNotifications(), service.deliverNotifications()])
  assert.equal(calls.length, 1)
}))

test('删除任务后待投递通知应停止发送', () => fixture(async ({ store, service, calls, probe }) => {
  await probe({ available: true, quantity: 3 })
  store.deleteMonitor('m')
  await service.deliverNotifications()
  assert.equal(calls.length, 0)
}))

test('Telegram message is not modified 应视为投递成功', () => fixture(async ({ store, service, probe }) => {
  await probe({ available: true, quantity: 3 }); await service.deliverNotifications()
  await probe({ available: true, quantity: 2 })
  globalThis.fetch = async () => ({ json: async () => ({ ok: false, description: 'Bad Request: message is not modified' }) })
  await service.deliverNotifications()
  assert.equal(store.listNotifications().length, 0)
}))

test('Telegram 标签需要转义 HTML', () => {
  const text = formatCard({ name: 'Fixture', tags: ['<b>unsafe</b>'] }, {})
  assert.ok(text.includes('#&lt;b&gt;unsafe&lt;/b&gt;'))
})

test('两个独立数据库连接的投递者只能发送一次', () => fixture(async ({ dir, service, calls, probe }) => {
  const second = createDatabase(dir)
  try {
    await probe({ available: true, quantity: 3 })
    await Promise.all([service.deliverNotifications(), createService(second).deliverNotifications()])
    assert.equal(calls.length, 1)
    assert.equal(second.listNotifications().length, 0)
  } finally { second.close() }
}))

test('通知暂停保留任务，重新启用后发送', () => fixture(async ({ store, service, calls, probe }) => {
  await probe({ available: true, quantity: 3 })
  const settings=store.getSettings();settings.telegram.enabled=false;store.setSettings(settings)
  await service.deliverNotifications()
  assert.equal(store.listNotifications().length,1)
  settings.telegram.enabled=true;store.setSettings(settings)
  await service.deliverNotifications()
  assert.equal(calls.length,1)
  assert.equal(store.listNotifications().length,0)
}))

test('多次未发送补货周期仅发送当前周期', () => fixture(async ({ service, calls, probe }) => {
  await probe({ available: true, quantity: 3 })
  await probe({ available: false, quantity: 0 })
  await probe({ available: true, quantity: 5 })
  await service.deliverNotifications()
  assert.equal(calls.length,1)
  assert.match(calls[0].text,/库存：5 台/)
}))

test('积压售罄编辑保留旧周期 messageId，下一周期独立发送', () => fixture(async ({ service, calls, probe }) => {
  await probe({ available: true, quantity: 3 });await service.deliverNotifications()
  await probe({ available: false, quantity: 0 })
  await probe({ available: true, quantity: 5 })
  await service.deliverNotifications()
  assert.deepEqual(calls.map(c=>c.method),['sendMessage','editMessageText','sendMessage'])
  assert.equal(calls[1].message_id,1)
  assert.match(calls[1].text,/售罄/)
  assert.match(calls[2].text,/库存：5 台/)
}))

test('发送期间售罄不会覆盖最新状态，随后补发售罄编辑', () => fixture(async ({ store, service, calls, probe }) => {
  await probe({ available: true, quantity: 3 })
  const send=globalThis.fetch
  globalThis.fetch=async (...args)=>{await probe({available:false,quantity:0});return send(...args)}
  await service.deliverNotifications()
  assert.equal(store.getPlan('synthetic:item').available,false)
  globalThis.fetch=send
  await service.deliverNotifications()
  assert.equal(calls.length,2)
  assert.equal(calls[1].method,'editMessageText')
  assert.match(calls[1].text,/售罄/)
}))

test('探测期间删除任务不会重新创建任务', () => fixture(async ({ store, service }) => {
  registerAdapter({key:'delete-in-flight',async discover(){store.deleteMonitor('m');return []}})
  store.putProvider({id:'synthetic',name:'Fixture',adapterKey:'delete-in-flight'})
  await assert.rejects(()=>service.runMonitorSafe(store.getMonitor('m')),/已删除/)
  assert.equal(store.getMonitor('m'),null)
}))

test('Telegram 403 永久错误停止重试并记录原因', () => fixture(async ({ store, service, probe }) => {
  await probe({available:true,quantity:3})
  globalThis.fetch=async()=>({status:403,json:async()=>({ok:false,error_code:403,description:'Forbidden'})})
  await service.deliverNotifications()
  assert.equal(store.listNotifications().length,0)
  assert.ok(store.listEvents().some(event=>event.error==='Forbidden'))
}))

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

function allNotifications(store){const settings=store.getSettings();settings.telegram.notificationMode='all';store.setSettings(settings)}
test('全部变化模式补货、数量变化和售罄都发新卡片，未发送旧卡片也能检测变化',()=>fixture(async({store,service,calls,probe})=>{
 allNotifications(store);
 await probe({available:false,quantity:0});
 await probe({available:true,quantity:3});
 await probe({available:true,quantity:2});
 await probe({available:true,quantity:2});
 await probe({available:false,quantity:0});
 await service.deliverNotifications();
 assert.deepEqual(calls.map(c=>c.method),['sendMessage','sendMessage','sendMessage']);
 assert.match(calls[0].text,/库存：3 台/);assert.match(calls[1].text,/库存变化：3 → 2/);assert.match(calls[2].text,/售罄/);assert.ok(calls.every(c=>!c.text.includes('检测时间')));
 assert.equal(store.listNotifications().length,0);
}));
test('全部变化模式不依赖已有补货 messageId，未知数量转公开数量也推送',()=>fixture(async({store,service,calls,probe})=>{
 allNotifications(store);
 store.putPlan({id:'synthetic:item',providerId:'synthetic',externalId:'item',name:'Fixture',available:true,quantity:null,notification:null});
 await probe({available:true,quantity:2});await service.deliverNotifications();
 await probe({available:false,quantity:0});await service.deliverNotifications();
 assert.equal(calls.length,2);assert.match(calls[0].text,/未公开 → 2/);assert.match(calls[1].text,/售罄/);
}));
test('免打扰暂停发送，跨午夜结束后保留历史补货、库存和售罄快照逐条补发',()=>fixture(async({store,calls,probe})=>{
 allNotifications(store);const settings=store.getSettings();settings.telegram.quietHours={enabled:true,start:'23:00',end:'08:00'};store.setSettings(settings);
 let time=Date.parse('2099-01-01T15:30:00Z');const service=createService(store,{now:()=>time});
 await probe({available:false,quantity:0});await probe({available:true,quantity:5});await probe({available:true,quantity:4});await probe({available:false,quantity:0});
 await service.deliverNotifications();assert.equal(calls.length,0);assert.equal(store.listNotifications().length,3);assert.ok(store.listNotifications().every(n=>n.attempts===0));
 time=Date.parse('2099-01-02T00:00:00Z');await service.deliverNotifications();
 assert.equal(calls.length,3);assert.match(calls[0].text,/库存：5 台/);assert.match(calls[1].text,/5 → 4/);assert.match(calls[2].text,/售罄/);
}));
test('免打扰也暂停默认模式的卡片编辑，结束后保留原 messageId',()=>fixture(async({store,service,calls,probe})=>{
 await probe({available:true,quantity:3});await service.deliverNotifications();
 const settings=store.getSettings();settings.telegram.quietHours={enabled:true,start:'23:00',end:'08:00'};store.setSettings(settings);
 let time=Date.parse('2099-01-01T15:30:00Z');const paused=createService(store,{now:()=>time});
 await probe({available:false,quantity:0});await paused.deliverNotifications();assert.equal(calls.length,1);
 time=Date.parse('2099-01-02T00:00:00Z');await paused.deliverNotifications();assert.equal(calls.length,2);assert.equal(calls[1].method,'editMessageText');assert.equal(calls[1].message_id,1);
}));
test('TG 底层统一免打扰，手动发送和编辑都不能绕过，且不发网络请求',()=>fixture(async({store,calls})=>{
 const {telegramCall}=await import('../packages/core/src/telegram.mjs');
 const settings={...store.getSettings().telegram,quietHours:{enabled:true,start:'23:00',end:'08:00'}};
 for(const method of ['sendMessage','editMessageText'])await assert.rejects(()=>telegramCall(settings,method,{}, {now:Date.parse('2099-01-01T15:00:00Z')}),e=>e.quietHours&&e.resumeAt==='2099-01-02T00:00:00.000Z');
 assert.equal(calls.length,0);
}));
test('免打扰队列和新设置持久化，另一个进程结束后可以补发',()=>fixture(async({dir,store,calls,probe})=>{
 allNotifications(store);const settings=store.getSettings();settings.telegram.quietHours={enabled:true,start:'23:00',end:'08:00'};store.setSettings(settings);
 await probe({available:true,quantity:3});
 const second=createDatabase(dir);
 try{assert.equal(second.getSettings().telegram.notificationMode,'all');const service=createService(second,{now:()=>Date.parse('2099-01-02T00:00:00Z')});await service.deliverNotifications();assert.equal(calls.length,1);assert.equal(store.listNotifications().length,0)}finally{second.close()}
}));
test('更改监控套餐范围后，原范围的积压通知不能继续发送',()=>fixture(async({store,service,calls,probe})=>{
 allNotifications(store);await probe({available:true,quantity:3});store.putMonitor({...store.getMonitor('m'),scope:'selected',planIds:['synthetic:other']});await service.deliverNotifications();assert.equal(calls.length,0);assert.equal(store.listNotifications().length,0);
}));
test('切回默认补货模式，待发送的全部变化库存和售罄提醒取消',()=>fixture(async({store,service,calls,probe})=>{
 allNotifications(store);await probe({available:true,quantity:3});await service.deliverNotifications();await probe({available:true,quantity:2});await probe({available:false,quantity:0});const settings=store.getSettings();settings.telegram.notificationMode='restock';store.setSettings(settings);await service.deliverNotifications();assert.equal(calls.length,1);assert.equal(store.listNotifications().length,0);
}));

test('频道和个人私聊分别发送、编辑、售罄和开启下一补货周期',()=>fixture(async({store,service,calls,probe})=>{
 const settings=store.getSettings();Object.assign(settings.telegram,{channelEnabled:true,personalEnabled:true,personalChatId:'12345'});store.setSettings(settings)
 await probe({available:false,quantity:0});await probe({available:true,quantity:3});await service.deliverNotifications()
 assert.deepEqual(calls.map(call=>call.chat_id),['-1','12345']);assert.equal(calls.length,2)
 const first=store.getPlan('synthetic:item');assert.equal(first.notifications['-1'].messageId,1);assert.equal(first.notifications['12345'].messageId,2)
 await probe({available:true,quantity:2});await service.deliverNotifications()
 assert.deepEqual(calls.slice(2).map(call=>[call.method,call.chat_id,call.message_id]),[['editMessageText','-1',1],['editMessageText','12345',2]])
 await probe({available:false,quantity:0});await service.deliverNotifications();assert.equal(calls.length,6)
 await probe({available:true,quantity:4});await service.deliverNotifications();assert.equal(calls.length,8);assert.ok(calls.slice(6).every(call=>call.method==='sendMessage'))
 await service.deliverNotifications();assert.equal(calls.length,8)
}))

test('个人投递失败独立重试，不重复频道；个人单目标和去重兼容',()=>fixture(async({store,service,probe})=>{
 const settings=store.getSettings();Object.assign(settings.telegram,{channelEnabled:true,personalEnabled:true,personalChatId:'12345',notificationMode:'all'});store.setSettings(settings)
 const sent=[];let failPersonal=true
 globalThis.fetch=async(_url,options)=>{const body=JSON.parse(options.body);sent.push(body);return {json:async()=>body.chat_id==='12345'&&failPersonal?{ok:false,error_code:503,description:'temporary failure'}:{ok:true,result:{message_id:sent.length}}}}
 await probe({available:false,quantity:0});await probe({available:true,quantity:3});await service.deliverNotifications()
 assert.equal(store.listNotifications().length,1);assert.equal(store.listNotifications()[0].recipientChatId,'12345')
 failPersonal=false;const job=store.listNotifications()[0];store.putNotification({...job,nextAttemptAt:new Date(0).toISOString()});await service.deliverNotifications()
 assert.equal(sent.filter(call=>call.chat_id==='-1').length,1);assert.equal(sent.filter(call=>call.chat_id==='12345').length,2);assert.equal(store.listNotifications().length,0)
 settings.telegram.channelEnabled=false;store.setSettings(settings);await probe({available:true,quantity:2});await service.deliverNotifications();assert.equal(sent.at(-1).chat_id,'12345');assert.equal(sent.length,4)
 settings.telegram.channelEnabled=true;settings.telegram.chatId='12345';store.setSettings(settings);await probe({available:true,quantity:1});await service.deliverNotifications();assert.equal(sent.length,5)
}))

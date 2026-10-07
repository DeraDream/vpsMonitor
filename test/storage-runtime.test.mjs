import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDatabase } from '../packages/db/src/database.mjs'
import { encryptToken, decryptToken } from '../packages/core/src/crypto.mjs'

test('SQLite 重开持久化、500 条事件上限、迁移重复启动不覆盖已有数据', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vpsm-storage-'))
  let store
  try {
    store = createDatabase(dir)
    store.putProvider({ id: 'fixture', name: 'Original' })
    for (let i = 0; i < 510; i++) store.addEvent({ id: String(i), at: new Date(i * 1000).toISOString(), message: String(i) })
    assert.equal(store.listEvents().length, 500)
    assert.equal(store.listEvents()[0].id, '509')
    store.close(); store = null
    await writeFile(join(dir, 'store.json'), JSON.stringify({ providers: [{ id: 'fixture', name: 'Overwrite' }] }))
    store = createDatabase(dir)
    assert.equal(store.getProvider('fixture').name, 'Original')
    assert.equal(store.listEvents().length, 500)
  } finally { store?.close(); await rm(dir, { recursive: true, force: true }) }
})

test('Token 加解密、随机 IV、篡改密文和错误密钥拒绝', () => {
  const key = process.env.TOKEN_ENCRYPTION_KEY
  try {
    process.env.TOKEN_ENCRYPTION_KEY = 'original-key'
    const encrypted = encryptToken('fake-secret')
    assert.equal(decryptToken(encrypted), 'fake-secret')
    assert.notEqual(encryptToken('fake-secret'), encrypted)
    assert.throws(() => decryptToken(encrypted.replace(/^v1:/, 'v2:')))
    process.env.TOKEN_ENCRYPTION_KEY = 'wrong-key'
    assert.throws(() => decryptToken(encrypted))
    delete process.env.TOKEN_ENCRYPTION_KEY
    assert.throws(() => encryptToken('fake-secret'))
  } finally { if (key === undefined) delete process.env.TOKEN_ENCRYPTION_KEY; else process.env.TOKEN_ENCRYPTION_KEY = key }
})

test('通知租约未过期不能抢占，过期可恢复；旧持有者不能确认新任务', async () => {
  const dir=await mkdtemp(join(tmpdir(),'vpsm-lease-'))
  const store=createDatabase(dir)
  try {
    store.putNotification({id:'job',nextAttemptAt:new Date(0).toISOString()})
    assert.equal(store.claimNotification('job','first',1000),true)
    assert.equal(store.claimNotification('job','second',2000),false)
    assert.equal(store.claimNotification('job','second',61000),true)
    assert.equal(store.finishNotification('job','first'),false)
    assert.equal(store.listNotifications().length,1)
    assert.equal(store.finishNotification('job','second'),true)
    assert.equal(store.listNotifications().length,0)
  } finally {store.close();await rm(dir,{recursive:true,force:true})}
})

test('迁移旧明文 Token 后归档文件不应保留明文', async () => {
  const savedKey=process.env.TOKEN_ENCRYPTION_KEY;process.env.TOKEN_ENCRYPTION_KEY='legacy-test-key'
  const dir = await mkdtemp(join(tmpdir(), 'vpsm-legacy-secret-'))
  let store
  try {
    await writeFile(join(dir, 'store.json'), JSON.stringify({ settings: { telegram: { botToken: 'legacy-plaintext-secret' } } }))
    store = createDatabase(dir)
    assert.equal((await readFile(join(dir, 'store.json.migrated'), 'utf8')).includes('legacy-plaintext-secret'), false)
    assert.equal(decryptToken(store.getSettings().telegram.botTokenEncrypted),'legacy-plaintext-secret')
  } finally { if(savedKey===undefined)delete process.env.TOKEN_ENCRYPTION_KEY;else process.env.TOKEN_ENCRYPTION_KEY=savedKey;store?.close(); await rm(dir, { recursive: true, force: true }) }
})

test('缺少加密密钥时迁移拒绝且保留原文件，配置密钥后可重试',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'vpsm-migration-retry-'))
  const savedKey=process.env.TOKEN_ENCRYPTION_KEY
  let store
  try {
    const legacy=JSON.stringify({providers:[{id:'fixture',name:'Fixture'}],settings:{telegram:{botToken:'legacy-secret'}}})
    await writeFile(join(dir,'store.json'),legacy)
    delete process.env.TOKEN_ENCRYPTION_KEY
    assert.throws(()=>createDatabase(dir),/TOKEN_ENCRYPTION_KEY/)
    assert.equal(await readFile(join(dir,'store.json'),'utf8'),legacy)
    process.env.TOKEN_ENCRYPTION_KEY='retry-key'
    store=createDatabase(dir)
    assert.equal(store.getProvider('fixture').name,'Fixture')
    assert.equal(decryptToken(store.getSettings().telegram.botTokenEncrypted),'legacy-secret')
  }finally{if(savedKey===undefined)delete process.env.TOKEN_ENCRYPTION_KEY;else process.env.TOKEN_ENCRYPTION_KEY=savedKey;store?.close();await rm(dir,{recursive:true,force:true})}
})

for (const preexisting of [true, false]) {
  test(`Worker ${preexisting ? '启动前已有' : '运行中收到'}重启标记应正常退出`, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vpsm-restart-'))
    let child, exited
    try {
      if (preexisting) await writeFile(join(dir, '.restart-worker'), 'test')
      child = spawn(process.execPath, ['apps/worker/src/worker.mjs'], { env: { ...process.env, DISABLE_BUILTIN_PROVIDERS: "1", DATA_DIR: dir, WORKER_TICK_MS: '500' }, stdio: ['ignore', 'pipe', 'pipe'] })
      exited = once(child, 'exit')
      let output = ''
      child.stderr.on('data', c => { output += c })
      if (!preexisting) {
        await new Promise(resolve => setTimeout(resolve, 200))
        await writeFile(join(dir, '.restart-worker'), 'test')
      }
      let timeout
      const result = await Promise.race([exited, new Promise(resolve => { timeout = setTimeout(() => resolve('timeout'), 1800) })])
      clearTimeout(timeout)
      assert.notEqual(result, 'timeout', '重启请求后 Worker 一直未退出')
      assert.equal(result[0], 0, output)
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited }
      await rm(dir, { recursive: true, force: true })
    }
  })
}

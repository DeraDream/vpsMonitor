import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(new URL('..', import.meta.url).pathname)
const auth = `Basic ${Buffer.from('admin:integration-password').toString('base64')}`

async function waitFor(url, headers) {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    try { const r = await fetch(url, { headers }); if (r.status < 500) return } catch {}
    await new Promise(r => setTimeout(r, 80))
  }
  throw new Error('测试服务器未能启动')
}

test('API 认证、监控 CRUD、Token 加密和 SPA 静态路由协同工作', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'vps-monitor-api-'))
  const dataDir = join(temp, 'data')
  const webDir = join(temp, 'web')
  await mkdir(dataDir, { recursive: true })
  await mkdir(webDir, { recursive: true })
  await writeFile(join(webDir, 'index.html'), '<!doctype html><div id="app">ok</div>')
  await writeFile(join(webDir, 'app.js'), 'console.log("ok")')

  // Seed legacy JSON so migration path and API can be tested together.
  await writeFile(join(dataDir, 'store.json'), JSON.stringify({
    providers: [{ id: 'demo', name: 'Demo Provider', adapterKey: 'demo', adapterVersion: '0.1.0', status: 'active' }],
    plans: [{ id: 'demo:starter', providerId: 'demo', externalId: 'starter', name: 'Starter', available: false, quantity: null }],
    monitors: [], notifications: [], events: [], runtime: {},
    settings: { telegram: { chatId: '', enabled: false, showBuyLink: true }, updates: { repository: '', branch: 'main' } }
  }))

  const port = 45000 + Math.floor(Math.random() * 1000)
  const child = spawn(process.execPath, ['apps/api/src/server.mjs'], {
    cwd: root,
    env: {
      ...process.env, DISABLE_BUILTIN_PROVIDERS: "1",
      HOST: '127.0.0.1', PORT: String(port), DATA_DIR: dataDir, WEB_DIST_DIR: webDir,
      ADMIN_PASSWORD: 'integration-password', TOKEN_ENCRYPTION_KEY: 'integration-encryption-key'
    },
    stdio: 'ignore'
  })
  const base = `http://127.0.0.1:${port}`
  try {
    await waitFor(`${base}/api/dashboard`, { Authorization: auth })
    assert.equal((await fetch(`${base}/api/dashboard`)).status, 401)

    const dashboard = await (await fetch(`${base}/api/dashboard`, { headers: { Authorization: auth } })).json()
    assert.equal(dashboard.stats.providers, 1)

    const create = await fetch(`${base}/api/monitors`, {
      method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: 'demo', scope: 'all', enabled: true, intervalSeconds: 30 })
    })
    assert.equal(create.status, 201)
    const monitor = await create.json()
    assert.equal(monitor.providerName, 'Demo Provider')

    const run = await fetch(`${base}/api/monitors/${monitor.id}/run`, { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: '{}' })
    assert.equal(run.status, 400)
    assert.match((await run.json()).error, /尚未安装/)

    const settings = await fetch(`${base}/api/settings`, {
      method: 'PUT', headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegram: { botToken: '123456:test-secret-token', chatId: '-1001' } })
    })
    assert.equal(settings.status, 200)
    const visible = await settings.json()
    assert.equal(visible.telegram.botTokenConfigured, true)
    assert.equal(Object.hasOwn(visible.telegram, 'botToken'), false)

    const preview = await fetch(`${base}/api/telegram/preview`, { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'sold_out' }) })
    assert.equal(preview.status, 200)
    const previewText = (await preview.json()).text
    assert.match(previewText, /<s><a href=/)
    assert.doesNotMatch(previewText, /检测时间/)

    const dbBytes = await readFile(join(dataDir, 'vps-monitor.db'))
    assert.equal(dbBytes.includes(Buffer.from('123456:test-secret-token')), false)

    const spa = await fetch(`${base}/monitors`, { headers: { Authorization: auth } })
    assert.equal(spa.status, 200)
    assert.match(await spa.text(), /id="app"/)

    const asset = await fetch(`${base}/app.js`, { headers: { Authorization: auth } })
    assert.equal(asset.status, 200)
    assert.match(asset.headers.get('content-type') || '', /javascript/)

    const missingAsset = await fetch(`${base}/missing.js`, { headers: { Authorization: auth } })
    assert.equal(missingAsset.status, 404)
  } finally {
    child.kill('SIGTERM')
    await new Promise(r => setTimeout(r, 120))
    await rm(temp, { recursive: true, force: true })
  }
})

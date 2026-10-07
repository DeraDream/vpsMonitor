import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'

const root = resolve(new URL('..', import.meta.url).pathname)
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const filename = `vps-monitor-${version}-linux-x64.tar.gz`, archive = join(root, 'releases', filename)
const digest = createHash('sha256').update(await readFile(archive)).digest('hex')
assert.equal((await readFile(join(root, 'releases/SHA256SUMS'), 'utf8')).trim(), `${digest}  ${filename}`)
const listing = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n')
assert.ok(listing.every(name => !/(?:^|\/)(?:\.git|\.env|\.env\.release|data|fixtures)(?:\/|$)/.test(name)))
assert.ok(listing.every(name => !/node_modules\/(?:vite|@vitejs\/[^/]+)\//.test(name)))
const dir = await mkdtemp(join(tmpdir(), 'vpsmonitor-release-test-')), children = []
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited
}
try {
  execFileSync('tar', ['-xzf', archive, '-C', dir])
  const bundle = join(dir, `vps-monitor-${version}`)
  const { createDatabase } = await import(pathToFileURL(join(bundle, 'packages/db/src/database.mjs')).href)
  const db = createDatabase(join(dir, 'test-data'))
  try {
    db.putProvider({ id: 'release-fixture', name: 'Release fixture', adapterKey: 'not-installed' })
    const settings = db.getSettings(); settings.updates.repository = ''; db.setSettings(settings)
  } finally { db.close() }
  execFileSync(process.execPath, ['--input-type=module', '-e', "import {getAdapter} from '@vps-monitor/adapters';if(!getAdapter('bero-host'))process.exit(1)"], { cwd: bundle })
  const port = 55000 + Math.floor(Math.random() * 1000)
  const env = { ...process.env, DISABLE_BUILTIN_PROVIDERS: '1', DATA_DIR: join(dir, 'test-data'), HOST: '127.0.0.1', PORT: String(port), ADMIN_PASSWORD: 'release-test-password', TOKEN_ENCRYPTION_KEY: 'release-test-key', WORKER_TICK_MS: '500' }
  const api = spawn(process.execPath, ['apps/api/src/server.mjs'], { cwd: bundle, env, stdio: 'ignore' }); children.push(api)
  const base = `http://127.0.0.1:${port}`, auth = `Basic ${Buffer.from('admin:release-test-password').toString('base64')}`
  async function request(path, method = 'GET', body) {
    return fetch(base + path, { method, headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  }
  let ready = false
  for (let i = 0; i < 100; i++) { try { if ((await request('/api/dashboard')).status === 200) { ready = true; break } } catch {} await new Promise(resolve => setTimeout(resolve, 50)) }
  assert.ok(ready, '解压后的 API 未能启动')
  assert.equal((await fetch(base + '/api/dashboard')).status, 401)
  assert.equal((await (await request('/api/dashboard')).json()).version, version)
  const html = await (await request('/')).text(), asset = html.match(/src="([^"]+\.js)"/)?.[1]
  assert.ok(asset, '发布包缺少前端构建入口')
  const js = await request(asset); assert.equal(js.status, 200); assert.ok((await js.text()).includes(version))
  const created = await request('/api/monitors', 'POST', { providerId: 'release-fixture', enabled: false, scope: 'all', intervalSeconds: 60 })
  assert.equal(created.status, 201)
  const monitor = await created.json()
  assert.equal((await request(`/api/monitors/${monitor.id}/run`, 'POST', {})).status, 400)
  assert.equal((await request('/api/settings', 'PUT', { telegram: { botToken: 'release-fake-token', chatId: '-1' } })).status, 200)
  const worker = spawn(process.execPath, ['apps/worker/src/worker.mjs'], { cwd: bundle, env, stdio: 'ignore' }); children.push(worker)
  let heartbeat = false
  for (let i = 0; i < 100; i++) { if ((await (await request('/api/dashboard')).json()).runtime.lastTickAt) { heartbeat = true; break } await new Promise(resolve => setTimeout(resolve, 50)) }
  assert.ok(heartbeat, '解压后的 Worker 没有心跳')
  const release = JSON.parse(await readFile(join(bundle, 'release-manifest.json'), 'utf8'))
  assert.equal(release.version, version); assert.equal(release.builtLocally, true)
  const result = { version, filename, sha256: digest, verified: true,
    checks: ['SHA256', '排除凭据和业务数据', '排除前端开发依赖', '生产 Adapter 可加载', '解压后 API 启动及认证', 'API 与前端版本一致', '监控创建及错误反馈', 'Token 加密设置', '解压后 Worker 心跳'] }
  await writeFile(join(root, 'releases/verification.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result, null, 2))
} finally { for (const child of children.reverse()) await stop(child); await rm(dir, { recursive: true, force: true }) }

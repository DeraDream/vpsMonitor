// Install Playwright separately and set PLAYWRIGHT_MODULE to its index.mjs.
// Uses an isolated database, synthetic provider and mocked update-status response.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createDatabase } from '../packages/db/src/database.mjs'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright')
const {version}=JSON.parse(await readFile(new URL("../package.json",import.meta.url),"utf8"))
const dir = await mkdtemp(join(tmpdir(), 'vpsm-browser-'))
const store = createDatabase(dir)
store.putProvider({ id: 'fixture', name: 'Synthetic fixture', adapterKey: 'missing' })
for (let i = 0; i < 20; i++) store.addEvent({ id: `e${i}`, at: new Date(Date.now() + i).toISOString(), type: 'restocked', providerId: 'fixture', message: `Fixture event ${i}` })
store.setRuntime({ lastTickAt: new Date(Date.now() - 3600000).toISOString() })
const port = 49000 + Math.floor(Math.random() * 1000), base = `http://127.0.0.1:${port}`
const child = spawn(process.execPath, ['apps/api/src/server.mjs'], { env: { ...process.env, DISABLE_BUILTIN_PROVIDERS: "1", DATA_DIR: dir, HOST: '127.0.0.1', PORT: String(port), ADMIN_PASSWORD: 'browser-password', TOKEN_ENCRYPTION_KEY: 'browser-key' }, stdio: 'ignore' })
const results = [], errors = []
let browser
async function check(name, fn) { try { await fn(); results.push({ name, result: 'PASS' }) } catch (e) { results.push({ name, result: 'FAIL', error: e.message }) } }
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base+'/api/dashboard')).status === 401) break } catch {} await new Promise(r => setTimeout(r, 50)) }
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
  const context = await browser.newContext({ httpCredentials: { username: 'admin', password: 'browser-password' }, viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.route('**/api/updates/status', route => route.fulfill({ json: { configured: true, message: 'Isolated browser test', deployReady: false, updateAvailable: false } }))
  await page.goto(base+'/admin')
  await page.getByLabel('用户名',{exact:true}).fill('admin')
  await page.getByLabel('密码',{exact:true}).fill('browser-password')
  await page.getByRole('button',{name:'登录控制台'}).click()
  await check('概览加载和版本显示', async () => { await page.getByRole('heading', { name: '实时状态' }).waitFor(); await page.getByText(`v${version}`, { exact: true }).waitFor() })
  await check('过期心跳应显示离线', async () => { assert.equal(await page.getByText('监控服务运行中', { exact: true }).count(), 0) })
  await page.locator('nav').getByRole('link', { name: '监控', exact: true }).click()
  await check('浏览器创建监控', async () => {
    await page.getByRole('button', { name: '添加监控', exact: true }).click()
    await page.getByLabel('1. 选择商家').selectOption('fixture')
    await page.getByRole('button', { name: '保存任务' }).click()
    await page.locator('.monitor-card').waitFor()
    assert.equal(store.listMonitors().length, 1)
  })
  await check('浏览器编辑监控', async () => {
    await page.getByRole('button', { name: '编辑', exact: true }).click()
    await page.locator('.dialog-card').waitFor({ timeout: 1500 })
    await page.locator('.dialog-card input[type=number]').fill('150')
    const saved=page.waitForResponse(response=>response.request().method()==='PATCH'&&response.url().includes('/api/monitors/'))
    await page.getByRole('button', { name: '保存任务' }).click()
    assert.equal((await saved).status(),200)
    await page.locator('.dialog-card').waitFor({state:'hidden'})
    await page.getByText('监控任务已保存', { exact: true }).waitFor()
    assert.equal(store.listMonitors()[0].intervalSeconds,150)
    await page.getByRole('button', { name: '编辑', exact: true }).click()
    await page.locator('.dialog-card').waitFor()
    await page.getByRole('button', { name: '取消', exact: true }).click()
  })
  await check('浏览器手动探测失败反馈', async () => {
    await page.getByRole('button', { name: '立即运行', exact: true }).click()
    await page.getByText(/最近失败：Adapter/).waitFor()
  })
  await check('浏览器删除监控', async () => {
    page.once('dialog', d => d.accept())
    await page.getByRole('button', { name: '删除', exact: true }).click()
    await page.getByText('监控任务已删除', { exact: true }).waitFor()
    assert.equal(store.listMonitors().length, 0)
  })
  await page.locator('nav').getByRole('link', { name: '补货事件', exact: true }).click()
  await check('事件页显示完整事件列表', async () => { await page.locator('.event').first().waitFor(); assert.equal(await page.locator('.event').count(), store.listEvents().length) })
  await page.locator('nav').getByRole('link', { name: '通知设置', exact: true }).click()
  await check('设置与三种消息预览加载', async () => { await page.getByRole('heading', { name: 'Telegram 频道通知' }).waitFor(); await page.waitForFunction(() => [...document.querySelectorAll('.preview')].every(e => !e.textContent.includes('正在生成'))); assert.equal(await page.locator('.preview').count(), 3) })
  await check('自动刷新不覆盖未保存的设置',async()=>{
    await page.locator('input[type=password]').fill('unsaved-fake-token')
    await page.waitForResponse(response=>response.url().endsWith('/api/dashboard'),{timeout:12000})
    assert.equal(await page.locator('input[type=password]').inputValue(),'unsaved-fake-token')
  })
  await check('保存 Telegram 设置', async () => {
    await page.locator('input[type=password]').fill('browser-fake-token')
    await page.getByPlaceholder('-1001234567890').fill('-123')
    await page.getByRole('button', { name: '保存设置', exact: true }).click()
    await page.getByText('Telegram 设置已保存', { exact: true }).waitFor()
    assert.equal(store.getSettings().telegram.chatId, '-123')
    assert.ok(store.getSettings().telegram.botTokenEncrypted.startsWith('v1:'))
  })
  await check('Token 保存后输入框应清空', async () => { assert.equal(await page.locator('input[type=password]').inputValue(), '') })
  await check('购买链接开关保存后预览应同步', async () => {
    await page.locator('.check').filter({ hasText: '在卡片中展示购买链接' }).locator('input').uncheck()
    await page.getByRole('button', { name: '保存设置', exact: true }).click()
    await page.waitForTimeout(250)
    assert.equal((await page.locator('.preview').first().textContent()).includes('立即购买'), false)
  })
  await page.screenshot({ path: '/tmp/vpsmonitor-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await check('手机宽度无横向溢出', async () => { assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)) })
  await page.screenshot({ path: '/tmp/vpsmonitor-mobile.png', fullPage: true })
  await check('无未捕获的页面或 Vue 运行错误',async()=>{assert.equal(errors.filter(error=>!error.includes('status of 400')).length,0)})
  const output = { results, pageErrors: errors }
  await writeFile('/tmp/vpsmonitor-browser-results.json', JSON.stringify(output, null, 2))
  console.log(JSON.stringify(output, null, 2))
  if (results.some(result => result.result === 'FAIL')) process.exitCode = 1
} finally {
  await browser?.close()
  if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited }
  store.close(); await rm(dir, { recursive: true, force: true })
}

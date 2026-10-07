import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { load } from 'cheerio'
import { createDatabase } from '@vps-monitor/db'
import { bootstrapProviders, createService } from '@vps-monitor/core'
import { registerAdapter } from '@vps-monitor/adapters'
import { discoverBero } from '../packages/adapters/src/bero-host/index.mjs'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright')
const dir = await mkdtemp(join(tmpdir(), 'vpsm-bero-browser-')), store = createDatabase(dir)
const ryzen = await readFile(new URL('../packages/adapters/src/bero-host/fixtures/ryzen.html', import.meta.url), 'utf8')
const kvm = await readFile(new URL('../packages/adapters/src/bero-host/fixtures/kvm.html', import.meta.url), 'utf8')
let currentRyzen = ryzen, failKvm = false
registerAdapter({ key: 'bero-browser', discover: () => discoverBero({ fetchPage: async url =>
  failKvm && url.includes('kvm') ? new Response('', { status: 503 }) : new Response(url.includes('ryzen') ? currentRyzen : kvm, { headers: { 'Content-Type': 'text/html' } }) }) })
bootstrapProviders(store)
store.putProvider({ ...store.getProvider('bero-host'), adapterKey: 'bero-browser' })
const service = createService(store)
await service.runMonitorSafe(store.getMonitorByProvider('bero-host'))
const port = 53000 + Math.floor(Math.random() * 1000), base = `http://127.0.0.1:${port}`
const child = spawn(process.execPath, ['apps/api/src/server.mjs'], { env: { ...process.env, DISABLE_BUILTIN_PROVIDERS: '1', DATA_DIR: dir, HOST: '127.0.0.1', PORT: String(port), ADMIN_PASSWORD: 'bero-browser-password' }, stdio: 'ignore' })
const results = [], errors = []
let browser
async function check(name, fn) { try { await fn(); results.push({ name, result: 'PASS' }) } catch (error) { results.push({ name, result: 'FAIL', error: error.message }) } }
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base)).status === 401) break } catch {} await new Promise(resolve => setTimeout(resolve, 50)) }
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
  const context = await browser.newContext({ httpCredentials: { username: 'admin', password: 'bero-browser-password' }, viewport: { width: 1440, height: 1000 } })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto(base)
  const ryzenButton = () => page.locator('.provider-categories').getByRole('button', { name: /Ryzen VPS/ })
  const kvmButton = () => page.locator('.provider-categories').getByRole('button', { name: /KVM Rootserver/ })
  await check('商家卡片分别显示两个系列入口', async () => { await ryzenButton().waitFor(); assert.equal(await page.locator('.provider-categories button').count(), 2) })
  await check('Ryzen 套餐单独显示五张卡片', async () => {
    await ryzenButton().click(); await page.getByRole('tabpanel', { name: 'Ryzen VPS' }).waitFor()
    assert.equal(await page.locator('.plan-card').count(), 5)
    assert.equal(await page.getByRole('tabpanel').count(), 1)
    assert.equal(await page.getByRole('tab', { name: /Ryzen VPS/ }).getAttribute('aria-selected'), 'true')
  })
  await page.screenshot({ path: '/tmp/bero-ryzen-desktop.png', fullPage: true })
  await check('切换 KVM 只展示 KVM 的五张卡片及其配置', async () => {
    await page.getByRole('tab', { name: /KVM Rootserver/ }).click()
    const panel = page.getByRole('tabpanel', { name: 'KVM Rootserver' }); await panel.waitFor()
    assert.equal(await panel.locator('.plan-card').count(), 5)
    assert.equal(await panel.locator('.plan-card .status.available').count(), 0)
    assert.ok((await panel.textContent()).includes('RAM 12 GB'))
    assert.equal(await page.getByRole('tabpanel', { name: 'Ryzen VPS' }).count(), 0)
  })
  await page.screenshot({ path: '/tmp/bero-kvm-desktop.png', fullPage: true })
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await check('直接点击 KVM 商家入口默认打开 KVM 页签', async () => {
    await kvmButton().click(); await page.getByRole('tabpanel', { name: 'KVM Rootserver' }).waitFor()
    assert.equal(await page.getByRole('tab', { name: /KVM Rootserver/ }).getAttribute('aria-selected'), 'true')
    await page.getByRole('button', { name: '关闭', exact: true }).click()
  })
  await check('新任务默认监听所有系列，而非写死十个 ID', async () => {
    await page.getByRole('button', { name: '编辑监控' }).click()
    await page.locator('.dialog-card').waitFor()
    assert.equal(await page.locator('input[type=radio][value=all]').isChecked(), true)
    assert.deepEqual(store.getMonitorByProvider('bero-host').planIds, [])
  })
  await check('监控套餐选择按系列分开，切换保留跨系列选择', async () => {
    await page.getByRole('button', { name: '选择此系列全部套餐' }).click()
    assert.equal(await page.locator('.monitor-plans input:checked').count(), 5)
    await page.getByRole('tab', { name: /KVM Rootserver/ }).click()
    assert.equal(await page.locator('.monitor-plans input').count(), 5)
    await page.locator('.monitor-plans input').first().check()
    await page.getByRole('tab', { name: /Ryzen VPS/ }).click()
    assert.equal(await page.locator('.monitor-plans input:checked').count(), 5)
    await page.getByRole('button', { name: '保存任务' }).click()
    await page.getByText('监控任务已保存', { exact: true }).waitFor()
    const selected = store.getMonitorByProvider('bero-host')
    assert.equal(selected.scope, 'selected'); assert.equal(selected.planIds.length, 6)
    await page.getByRole('button', { name: '编辑监控' }).click()
    await page.locator('input[type=radio][value=all]').check()
    await page.getByRole('button', { name: '保存任务' }).click()
    await page.waitForFunction(() => !document.querySelector('.dialog-card'))
  })
  await check('新增第六个 Ryzen 套餐自动出现，KVM 仍独立为五个', async () => {
    const $ = load(ryzen), card = $('[wire\\:click]').last().clone()
    card.attr('wire:click', 'selectPackage(999999)').find('.default-package-background h4').text('Future Plan')
    $('body').append(card); currentRyzen = $.html()
    await service.runMonitorSafe(store.getMonitorByProvider('bero-host'))
    await page.getByRole('button', { name: '立即刷新', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.provider-categories')?.textContent.includes('6 个套餐'))
    await ryzenButton().click(); await page.getByRole('tabpanel', { name: 'Ryzen VPS' }).waitFor()
    assert.equal(await page.locator('.plan-card').count(), 6)
    await page.getByRole('tab', { name: /KVM Rootserver/ }).click(); assert.equal(await page.locator('.plan-card').count(), 5)
    await page.getByRole('button', { name: '关闭', exact: true }).click()
  })
  await check('单系列失败显示保留状态提示，其套餐不消失、不变成售罄', async () => {
    failKvm = true; await service.runMonitorSafe(store.getMonitorByProvider('bero-host'))
    await page.getByRole('button', { name: '立即刷新', exact: true }).click()
    await page.locator('.provider-categories .category-warning').waitFor()
    await kvmButton().click(); await page.locator('.dialog-card .category-warning').waitFor()
    assert.equal(await page.locator('.plan-card').count(), 5)
    assert.ok((await page.locator('.plan-card').first().textContent()).includes('上次状态：'))
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await check('手机上的系列页签和弹窗无横向溢出', async () => {
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    assert.ok(await page.locator('.dialog-card').evaluate(element => element.scrollWidth <= element.clientWidth))
    assert.equal(await page.getByRole('tab').count(), 2)
  })
  await page.screenshot({ path: '/tmp/bero-mobile.png', fullPage: true })
  await check('无浏览器或 Vue 运行错误', async () => { assert.deepEqual(errors, []) })
  const output = { results, errors }
  await writeFile('/tmp/bero-browser-results.json', JSON.stringify(output, null, 2))
  console.log(JSON.stringify(output, null, 2))
  if (results.some(result => result.result === 'FAIL')) process.exitCode = 1
} finally {
  await browser?.close()
  if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited }
  store.close(); await rm(dir, { recursive: true, force: true })
}

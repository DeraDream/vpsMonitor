import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { load } from 'cheerio'
import { categories, parsePackages, discoverBero } from '../packages/adapters/src/bero-host/index.mjs'
import { registerAdapter } from '../packages/adapters/src/index.mjs'
import { createDatabase } from '../packages/db/src/database.mjs'
import { createService } from '../packages/core/src/service.mjs'
import { bootstrapProviders } from '../packages/core/src/bootstrap.mjs'
import { formatCard } from '../packages/core/src/telegram.mjs'
import { groupPlans } from '../apps/web/src/plan-groups.js'

const ryzen = await readFile(new URL('../packages/adapters/src/bero-host/fixtures/ryzen.html', import.meta.url), 'utf8')
const kvm = await readFile(new URL('../packages/adapters/src/bero-host/fixtures/kvm.html', import.meta.url), 'utf8')
const response = html => new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
const fixtureFetch = async url => response(url.includes('ryzen') ? ryzen : kvm)

test('实际页面样本：两个系列各五个套餐，售罄与有货逐卡判断', () => {
  const a = parsePackages(ryzen, categories[0]), b = parsePackages(kvm, categories[1])
  assert.equal(a.length, 5); assert.equal(b.length, 5)
  assert.deepEqual(a.filter(plan => plan.available).map(plan => plan.externalId), ['ryzen:114', 'ryzen:116', 'ryzen:124'])
  assert.ok(b.every(plan => !plan.available))
  assert.ok([...a, ...b].every(plan => plan.quantity === null && plan.billingCycle === 'year'))
  assert.equal(a[0].price, '39,00 €')
  assert.equal(a[0].name, b[0].name)
  assert.notEqual(a[0].externalId, b[0].externalId)
})

test('自动发现任意新名称、ID 和数量，不写死五个套餐', () => {
  const $ = load(ryzen), card = $('[wire\\:click]').last().clone()
  card.attr('wire:click', 'selectPackage(999999)')
  card.find('.default-package-background h4').text('Future & Special Plan')
  $('body').append(card)
  const plans = parsePackages($.html(), categories[0])
  assert.equal(plans.length, 6)
  assert.equal(plans.at(-1).externalId, 'ryzen:999999')
  assert.equal(plans.at(-1).name, 'Future & Special Plan')
  assert.equal(plans.at(-1).available, true)
})

test('英文 Sold out 与德文标记等价', () => {
  const german = parsePackages(ryzen, categories[0])
  const english = parsePackages(ryzen.replaceAll('Ausverkauft', 'Sold out'), categories[0])
  assert.deepEqual(english.map(plan => plan.available), german.map(plan => plan.available))
})

test('套餐名称包含售罄文字不会被当成状态标记', () => {
  const $ = load(ryzen), card = $('[wire\\:click]').last()
  card.find('.default-package-background h4').text('Sold out')
  assert.equal(parsePackages($.html(), categories[0]).at(-1).available, true)
})

test('套餐顺序变化不改变 ID，非套餐配置按钮不会被解析', () => {
  const $ = load(ryzen), cards = $('[wire\\:click]').toArray().reverse()
  $('body').empty().append(cards)
  $('body').append('<div wire:click="loadIndividual()"><h4>Configure</h4></div>')
  const plans = parsePackages($.html(), categories[0])
  assert.deepEqual(plans.map(plan => plan.externalId).sort(), parsePackages(ryzen, categories[0]).map(plan => plan.externalId).sort())
})

test('重复 ID、空页面、字段缺失和不明确库存样式拒绝解析', () => {
  const $ = load(ryzen)
  $('body').append($('[wire\\:click]').first().clone())
  assert.throws(() => parsePackages($.html(), categories[0]), /重复/)
  assert.throws(() => parsePackages('<html>Maintenance</html>', categories[0]), /未找到/)
  const broken = load(ryzen); broken('h5').remove()
  assert.throws(() => parsePackages(broken.html(), categories[0]), /不完整/)
  assert.throws(() => parsePackages(ryzen.replaceAll('Ausverkauft', ''), categories[0]), /不明确/)
})

test('请求只读取两个商品页，使用超时；失败系列不会阻断成功系列', async () => {
  const calls = []
  const result = await discoverBero({ fetchPage: async (url, options) => {
    calls.push(url); assert.ok(options.signal)
    return url.includes('ryzen') ? response(ryzen) : new Response('', { status: 503 })
  } })
  assert.equal(calls.length, 2)
  assert.deepEqual(result.completedCategories, ['ryzen'])
  assert.equal(result.plans.length, 5)
  assert.equal(result.failures[0].categoryId, 'kvm')
  assert.match(result.failures[0].error, /503/)
})

test('非 HTML 响应、两页失败均返回明确错误，不伪装成缺货', async () => {
  await assert.rejects(() => discoverBero({ fetchPage: async () => new Response('{}', { headers: { 'Content-Type': 'application/json' } }) }), error => {
    assert.equal(error.failures.length, 2)
    return /不是 HTML/.test(error.message)
  })
  await assert.rejects(() => discoverBero({ fetchPage: async () => { throw new Error('Timeout') } }), /Timeout/)
})

test('分组工具和 TG 消息保留系列，空系列仍独立显示', () => {
  const plans = parsePackages(ryzen, categories[0])
  const groups = groupPlans(plans, categories)
  assert.deepEqual(groups.map(group => [group.id, group.plans.length]), [['ryzen', 5], ['kvm', 0]])
  assert.ok(formatCard(plans[0], {}).includes('Ryzen VPS'))
})

async function withStore(run) {
  const dir = await mkdtemp(join(tmpdir(), 'vpsm-bero-')), store = createDatabase(dir)
  try { await run(store) } finally { store.close(); await rm(dir, { recursive: true, force: true }) }
}

test('内置商家自动创建全部监控，暂停和删除不会在启动时被重置', () => withStore(async store => {
  bootstrapProviders(store)
  const monitor = store.getMonitorByProvider('bero-host')
  assert.equal(monitor.scope, 'all'); assert.equal(monitor.enabled, true); assert.equal(monitor.intervalSeconds, 60)
  assert.deepEqual(store.getProvider('bero-host').categories.map(category => category.id), ['ryzen', 'kvm'])
  monitor.enabled = false; store.putMonitor(monitor); bootstrapProviders(store)
  assert.equal(store.getMonitorByProvider('bero-host').enabled, false)
  store.deleteMonitor(monitor.id); bootstrapProviders(store)
  assert.equal(store.getMonitorByProvider('bero-host'), null)
}))

test('页面上架下架、单页失败与恢复：只更新完整成功系列，保留历史状态', () => withStore(async store => {
  bootstrapProviders(store)
  const provider = store.getProvider('bero-host')
  let fetchPage = fixtureFetch
  registerAdapter({ key: 'bero-fixture', discover: () => discoverBero({ fetchPage }) })
  store.putProvider({ ...provider, adapterKey: 'bero-fixture' })
  const monitorId = store.getMonitorByProvider(provider.id).id, service = createService(store)
  const probe = () => service.runMonitorSafe(store.getMonitor(monitorId))
  await probe()
  assert.equal(store.listPlans(provider.id).length, 10)
  assert.equal(service.monitorView(store.getMonitor(monitorId)).categories[0].planCount, 5)
  fetchPage = async url => url.includes('ryzen') ? response(ryzen) : new Response('', { status: 403 })
  const partial = await probe()
  assert.match(partial.lastError, /KVM/)
  assert.equal(store.getPlan('bero-host:kvm:108').available, false)
  assert.equal(partial.categories[1].planCount, 5)
  assert.ok(partial.categoryStatuses.kvm.lastError)
  const smaller = load(ryzen); smaller('[wire\\:click]').first().remove()
  fetchPage = async url => response(url.includes('ryzen') ? smaller.html() : kvm)
  await probe()
  const removed = store.getPlan('bero-host:ryzen:113')
  assert.equal(removed.listed, false)
  assert.equal(removed.available, false)
  assert.equal(service.monitorView(store.getMonitor(monitorId)).planCount, 9)
  fetchPage = fixtureFetch; await probe()
  assert.equal(store.getPlan('bero-host:ryzen:113').listed, true)
  assert.equal(store.getMonitor(monitorId).lastError, null)
  fetchPage = async () => { throw new Error('network unavailable') }
  await assert.rejects(probe, /network unavailable/)
  assert.equal(store.listPlans(provider.id).filter(plan => plan.listed).length, 10)
  assert.match(store.getMonitor(monitorId).categoryStatuses.ryzen.lastError, /network unavailable/)
  assert.match(store.getMonitor(monitorId).categoryStatuses.kvm.lastError, /network unavailable/)
}))

test('套餐公共模型保存官网所有配置：CPU/RAM/NVMe/IPv4/IPv6/Backups/周期和新增字段', async () => {
  const { normalizePlan } = await import('../packages/core/src/monitor-engine.mjs')
  for (const [html, category] of [[ryzen,categories[0]],[kvm,categories[1]]]) {
    const plans=parsePackages(html,category)
    for(const plan of plans){
      const normalized=normalizePlan(plan,'bero-host')
      for(const key of ['cpu','ram','nvme','ipv4','ipv6','backups','runtime'])assert.equal(normalized[key],plan[key])
      assert.equal(plan.ipv4,'1 Adresse');assert.equal(plan.ipv6,'1 /64 Netz');assert.equal(plan.backups,'3 Slots');assert.equal(plan.runtime,'365 Tage')
      assert.equal(normalized.configuration.length,7)
      assert.deepEqual(normalized.configuration,plan.configuration)
    }
  }
  const $=load(ryzen),card=$('[wire\\:click]').first()
  card.find('span.me-2').each((_,span)=>{if($(span).text().trim().startsWith('Backups'))$(span).parent().find('.ms-auto').text('7 Slots')})
  card.find('.default-package-background').append('<div><span class="me-2">Traffic:</span><span class="ms-auto">15 TB</span></div>')
  const changed=normalizePlan(parsePackages($.html(),categories[0])[0],'bero-host')
  assert.equal(changed.backups,'7 Slots');assert.ok(changed.configuration.some(row=>row.label==='Traffic'&&row.value==='15 TB'))
  const english=parsePackages(ryzen.replaceAll('Laufzeit:','Runtime:'),categories[0])[0];assert.equal(english.runtime,'365 Tage')
  const legacy=normalizePlan({externalId:'old',name:'old',available:false,specs:'2C / 2GB'},'legacy');assert.equal(legacy.ipv4,'');assert.deepEqual(legacy.configuration,[]);assert.equal(legacy.specs,'2C / 2GB')
})

import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {load} from 'cheerio'
import {parseCategories,parseProducts,discoverGreenCloud,greenCloud} from '../packages/adapters/src/greencloud/index.mjs'
import {registerAdapter} from '../packages/adapters/src/index.mjs'
import {normalizePlan,monitored} from '../packages/core/src/monitor-engine.mjs'
import {createDatabase} from '../packages/db/src/database.mjs'
import {createService} from '../packages/core/src/service.mjs'
import {bootstrapProviders} from '../packages/core/src/bootstrap.mjs'
import {formatCard} from '../packages/core/src/telegram.mjs'
const fixtures={}
for(const name of ['catalog','budget-kvm-sale','storage-kvm-sale','managed-windows-vps','semi-dedicated-proxies','mac-mini-dedicated'])fixtures[name]=await readFile(new URL(`../packages/adapters/src/greencloud/fixtures/${name}.html`,import.meta.url),'utf8')
const cats=parseCategories(fixtures.catalog),category=cats[0]
const response=html=>new Response(html,{headers:{'content-type':'text/html'}})
const fakeFetch=async url=>new URL(url).pathname==='/billing/store'?response(fixtures.catalog):response(fixtures[new URL(url).pathname.split('/').at(-1)]||fixtures['budget-kvm-sale'])
test('GreenCloud 独立 Adapter 动态发现分类，排除语言、外站和产品链接',()=>{
 assert.equal(cats.length,19);assert.equal(cats[0].id,'budget-kvm-sale')
 const html=fixtures.catalog.replace('</body>','<a href="/billing/store/fake">not category</a><div menuItemName="Categories"><a href="https://evil.test/billing/store/bad">bad</a><a href="/billing/store/new-sale">New Sale</a><a href="/billing/store/x/product">product</a></div></body>')
 const next=parseCategories(html);assert.equal(next.length,20);assert.ok(next.some(c=>c.id==='new-sale'));assert.throws(()=>parseCategories('<html>Challenge</html>'),/分类导航/)
})
test('明确数量优先于 Order Now：零库存、正库存、库存变化与官网配置',()=>{
 const plans=parseProducts(fixtures['budget-kvm-sale'],category);assert.equal(plans.length,3)
 assert.equal(plans[0].quantity,0);assert.equal(plans[0].available,false);assert.equal(plans[1].quantity,1);assert.equal(plans[1].available,true)
 const plan=normalizePlan(plans[1],'greencloud');assert.equal(plan.cpu,'4 cores @ EPYC Rome');assert.equal(plan.ram,'8192MB');assert.equal(plan.storage,'60GB NVMe RAID-10');assert.equal(plan.storageType,'NVMe');assert.equal(plan.nvme,plan.storage);assert.equal(plan.ipv4,'1');assert.equal(plan.ipv6,'/64');assert.equal(plan.bandwidth,'8TB');assert.equal(plan.portSpeed,'10Gbps');assert.equal(plan.os,'Linux');assert.equal(plan.controlPanel,'Virtfusion');assert.equal(plan.backups,'1 Free');assert.equal(plan.location,'Staten Island, NY');assert.equal(plan.billingCycle,'year');assert.equal(plan.configuration.length,12);assert.ok(plan.configuration.some(row=>row.label==='Billing cycle'&&row.value==='Annually'))
 assert.equal(parseProducts(fixtures['budget-kvm-sale'].replace('1 Available','1,002 Available'),category)[1].quantity,1002)
})
test('存储混合磁盘与合并 IPv4/IPv6 不丢失信息',()=>{
 const p=parseProducts(fixtures['storage-kvm-sale'],cats.find(c=>c.id==='storage-kvm-sale'))[0]
 assert.equal(p.storage,'20GB NVMe OS Boot + 500GB SATA RAID-10');assert.equal(p.storageType,'NVMe + SATA/HDD');assert.equal(p.ipv4,'1');assert.equal(p.ipv6,'/64');assert.equal(p.location,'Tokyo, JP (Softbank)')
})
test('不公开数量标为可订购，描述型配置和 Starting from 保留原文',()=>{
 const p=parseProducts(fixtures['managed-windows-vps'],cats.find(c=>c.id==='managed-windows-vps'))[0]
 assert.equal(p.quantity,null);assert.equal(p.available,true);assert.equal(p.availabilitySource,'order-button');assert.equal(p.ram,'4GB RAM');assert.equal(p.cpu,'3 cores');assert.equal(p.storage,'50GB NVMe');assert.equal(p.portSpeed,'1Gbps');assert.equal(p.os,'Windows Server 2022');assert.match(p.price,/^Starting from/);assert.ok(formatCard(p,{},'restocked').includes('可订购提醒'));assert.ok(!formatCard(p,{},'restocked').includes('库存：'))
})
test('代理类套餐使用订单真实 PID，不能使用卡片序号充当产品 ID',()=>{
 const plans=parseProducts(fixtures['semi-dedicated-proxies'],cats.find(c=>c.id==='semi-dedicated-proxies'))
 assert.equal(plans[0].externalId,'semi-dedicated-proxies:125');assert.notEqual(plans[0].externalId,plans[1].externalId);assert.ok(plans[0].configuration.some(row=>row.value==='10 HTTP proxies'))
})
test('空分类是成功结果；异常页、重复 ID、价格缺失、数量未知和恶意链接拒绝',()=>{
 assert.deepEqual(parseProducts(fixtures['mac-mini-dedicated'],cats.find(c=>c.id==='mac-mini-dedicated')),[])
 assert.throws(()=>parseProducts('<html>Maintenance</html>',category),/未找到/)
 assert.throws(()=>parseProducts(fixtures['budget-kvm-sale'].replace('0 Available','? Available'),category),/库存标记/)
 const $=load(fixtures['budget-kvm-sale']);$('#products').append($('#products .product').first().clone());assert.throws(()=>parseProducts($.html(),category),/ID/)
 const noPrice=load(fixtures['budget-kvm-sale']);noPrice('.price').remove();assert.throws(()=>parseProducts(noPrice.html(),category),/价格/)
 assert.throws(()=>parseProducts(fixtures['budget-kvm-sale'].replace('/billing/store/budget-kvm-sale/budgetkvmnyc-2','https://evil.test/p'),category),/非 GreenCloud/)
 const sold=load(fixtures['managed-windows-vps']);sold('[id$="order-button"]').first().addClass('disabled');assert.equal(parseProducts(sold.html(),cats.find(c=>c.id==='managed-windows-vps'))[0].available,false)
})
test('分类批量请求最多两个并发，单类失败保留其旧状态，全失败报告错误',async()=>{
 let concurrent=0,max=0
 const fetchPage=async url=>{concurrent++;max=Math.max(max,concurrent);await new Promise(r=>setTimeout(r,2));concurrent--;return url.includes('/storage-kvm-sale')?new Response('',{status:403}):fakeFetch(url)}
 const result=await discoverGreenCloud({fetchPage,delayMs:0});assert.equal(result.categories.length,19);assert.equal(max,2);assert.equal(result.failures.length,1);assert.equal(result.completedCategories.length,18);assert.ok(result.completedCategories.includes('mac-mini-dedicated'))
 await assert.rejects(()=>discoverGreenCloud({fetchPage:async url=>new URL(url).pathname==='/billing/store'?response(fixtures.catalog):new Response('',{status:503}),delayMs:0}),e=>e.failures.length===19)
})
test('动态分类持久化、分类监控及初始基线；之后新增和补货产生通知事件',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'vps-green-model-')),store=createDatabase(dir)
 try{
  bootstrapProviders(store);const provider=store.getProvider('greencloud');assert.equal(provider.adapterKey,'greencloud');assert.equal(store.getMonitorByProvider('greencloud').intervalSeconds,300)
  const initial=parseProducts(fixtures['budget-kvm-sale'],category)
  let batch={categories:[category],plans:initial,completedCategories:[category.id],failures:[]}
  registerAdapter({key:'green-test',discover:async()=>batch});store.putProvider({...provider,adapterKey:'green-test'})
  const settings=store.getSettings();settings.telegram={...settings.telegram,enabled:true,notifyNewPlans:true,chatId:'-1',botTokenEncrypted:'fixture-encrypted'};store.setSettings(settings)
  const service=createService(store),monitor=store.getMonitorByProvider('greencloud')
  await service.runMonitorSafe(monitor);assert.equal(store.listPlans('greencloud').length,3);assert.equal(store.listEvents().filter(e=>e.type==='restocked').length,0);assert.equal(store.listNotifications().length,0)
  bootstrapProviders(store);assert.equal(store.getProvider('greencloud').categories.length,1);store.putProvider({...store.getProvider('greencloud'),adapterKey:'green-test'})
  const selected=service.validateMonitor({...store.getMonitor(monitor.id),scope:'categories',categoryIds:[category.id]},monitor.id);store.putMonitor({...store.getMonitor(monitor.id),...selected});assert.equal(service.monitorView(store.getMonitor(monitor.id)).planCount,3)
  assert.throws(()=>service.validateMonitor({...selected,categoryIds:[]},monitor.id),/有效分类/);assert.throws(()=>service.validateMonitor({...selected,categoryIds:['ryzen']},monitor.id),/有效分类/)
  assert.equal(monitored({categoryId:category.id},selected),true);assert.equal(monitored({categoryId:'other'},selected),false)
  batch={...batch,plans:[{...initial[0],available:true,quantity:2},...initial.slice(1),{...initial[1],externalId:category.id+':999999',name:'New Deal'}]};await service.runMonitorSafe(store.getMonitor(monitor.id));assert.equal(store.listEvents().filter(e=>e.type==='restocked').length,1);assert.equal(store.listEvents().filter(e=>e.type==='new_plan').length,1);assert.equal(store.listNotifications().length,2);assert.equal(service.monitorView(store.getMonitor(monitor.id)).planCount,4)
  const old=store.listPlans('greencloud');batch={categories:[category],plans:[],completedCategories:[],failures:[{categoryId:category.id,categoryName:category.name,error:'broken'}]};await service.runMonitorSafe(store.getMonitor(monitor.id));assert.deepEqual(store.listPlans('greencloud'),old)
  batch={categories:[{id:'new-group',name:'New Group',url:'https://greencloudvps.com/billing/store/new-group'}],plans:[],completedCategories:['new-group'],failures:[]};await service.runMonitorSafe(store.getMonitor(monitor.id));assert.ok(store.listPlans('greencloud').every(p=>p.listed===false));assert.equal(store.getProvider('greencloud').categories.find(c=>c.id===category.id).retired,true)
 }finally{store.close();await rm(dir,{recursive:true,force:true})}
})

test('目录异常时为已有每个分类记录失败，不把旧库存当成最新状态',async()=>{
 await assert.rejects(()=>discoverGreenCloud({provider:{categories:cats},fetchPage:async()=>new Response('',{status:403}),delayMs:0}),e=>e.failures.length===19)
})

test('官网有货和售罄套餐均保留各自专属购买地址，TG 不使用分类页替代',async()=>{
 const html=await readFile(new URL('../packages/adapters/src/greencloud/fixtures/purchase-links.html',import.meta.url),'utf8');
 const plans=parseProducts(html,category),available=plans.find(p=>p.name==='BudgetKVMMO-2'),sold=plans.find(p=>p.name==='BudgetKVMNYC-2');
 assert.equal(available.quantity,5);assert.equal(available.available,true);assert.equal(sold.quantity,0);assert.equal(sold.available,false);
 assert.equal(available.buyUrl,'https://greencloudvps.com/billing/store/budget-kvm-sale/budgetkvmmo-2');
 assert.equal(sold.buyUrl,'https://greencloudvps.com/billing/store/budget-kvm-sale/budgetkvmnyc-2');
 for(const p of plans){assert.notEqual(p.buyUrl,p.sourceUrl);assert.ok(formatCard(normalizePlan(p,'greencloud'),{showBuyLink:true},p.available?'restocked':'sold_out').includes(`href="${p.buyUrl}"`));}
 // Display names and product slugs can differ. The merchant's link is authoritative.
 const changed=html.replace('BudgetKVMMO-2','MO Plan with another display name');
 assert.equal(parseProducts(changed,category)[0].buyUrl,available.buyUrl);
});

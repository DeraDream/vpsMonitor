import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {createDatabase} from '../packages/db/src/database.mjs'
import {normalizePlan} from '../packages/core/src/monitor-engine.mjs'
import {categories,parsePackages} from '../packages/adapters/src/bero-host/index.mjs'
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href)
const dir=await mkdtemp(join(tmpdir(),'vps-responsive-')),store=createDatabase(dir)
store.putProvider({id:'bero-host',name:'Bero Host',categories,adapterKey:'bero-host'})
for(const category of categories){const html=await readFile(new URL(`../packages/adapters/src/bero-host/fixtures/${category.id}.html`,import.meta.url),'utf8');for(const plan of parsePackages(html,category))store.putPlan(normalizePlan(plan,'bero-host'))}
store.putMonitor({id:'bero-monitor',providerId:'bero-host',scope:'all',planIds:[],enabled:false,intervalSeconds:60})
store.putProvider({id:'other',name:'另一个测试商家',adapterKey:'missing'})
store.putPlan(normalizePlan({externalId:'special',name:'Long Plan Example',price:'€12.00',available:true,cpu:'4 vCPU',ram:'8 GB',nvme:'120 GB',ipv4:'1',ipv6:'/64',backups:'2 slots',runtime:'30 days'},'other'))
const port=56000+Math.floor(Math.random()*1000),base=`http://127.0.0.1:${port}`
const child=spawn(process.execPath,['apps/api/src/server.mjs'],{env:{...process.env,DATA_DIR:dir,DISABLE_BUILTIN_PROVIDERS:'1',ADMIN_PASSWORD:'responsive-test',TOKEN_ENCRYPTION_KEY:'test',HOST:'127.0.0.1',PORT:String(port)},stdio:'ignore'})
let browser;const results=[],errors=[]
async function check(name,fn){await fn();results.push({name,result:'PASS'})}
try{
 for(let i=0;i<100;i++){try{if((await fetch(base+'/api/auth/session')).ok)break}catch{}await new Promise(r=>setTimeout(r,40))}
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message))
 await page.goto(base+'/admin');await page.getByLabel('密码',{exact:true}).fill('responsive-test');await page.getByRole('button',{name:'登录控制台'}).click();await page.locator('nav').waitFor()
 await page.locator('nav').getByRole('link',{name:'监控',exact:true}).click()
 await check('已有商家任务时添加按钮仍弹窗，先选择商家',async()=>{await page.getByRole('button',{name:'添加监控',exact:true}).click();await page.getByRole('dialog').waitFor();assert.equal(await page.getByLabel('1. 选择商家').evaluate(e=>e.selectedOptions[0].disabled),true);assert.equal(await page.getByRole('button',{name:'保存任务'}).isDisabled(),true)})
 await check('选择已有 Bero 任务进入编辑，不创建重复任务',async()=>{await page.getByLabel('1. 选择商家').selectOption('bero-host');await page.getByText('此商家已有监控任务，保存会更新该任务。').waitFor();await page.locator('.monitor-plan-choice').first().waitFor();assert.equal(await page.locator('.monitor-plan-choice').count(),5)})
 await check('编辑列表逐套餐显示官网七项配置、名称和价格',async()=>{const first=page.locator('.monitor-plan-choice').first();assert.equal(await first.locator('.plan-details>div').count(),7);for(const text of ['CPU','RAM','NVME','IPv4','IPv6','Backups','Laufzeit','2 Kerne','6 GB','60 GB','1 Adresse','1 /64 Netz','3 Slots','365 Tage','Anniversary S','39,00 €'])assert.ok((await first.textContent()).includes(text),text)})
 await check('跨系列套餐选择保存到原任务',async()=>{await page.locator('.monitor-plans input').first().check();await page.getByRole('tab',{name:/KVM Rootserver/}).click();await page.locator('.monitor-plans input').first().check();await page.getByRole('button',{name:'保存任务'}).click();await page.getByText('监控任务已保存',{exact:true}).waitFor();assert.equal(store.listMonitors().length,1);assert.equal(store.getMonitor('bero-monitor').planIds.length,2)})
 await check('新商家选择套餐创建监控',async()=>{await page.getByRole('button',{name:'添加监控',exact:true}).click();await page.getByLabel('1. 选择商家').selectOption('other');await page.locator('.monitor-plan-choice').waitFor();await page.locator('.monitor-plans input').check();await page.getByRole('button',{name:'保存任务'}).click();await page.getByText('监控任务已保存',{exact:true}).waitFor();assert.equal(store.listMonitors().length,2);assert.equal(store.getMonitorByProvider('other').scope,'selected')})
 await check('套餐加载时即时弹窗，关闭后请求不会重开弹窗',async()=>{
  await page.route('**/api/providers/bero-host/plans',async route=>{await new Promise(r=>setTimeout(r,300));await route.continue()})
  await page.getByRole('button',{name:'添加监控',exact:true}).click();await page.getByLabel('1. 选择商家').selectOption('bero-host');await page.getByRole('status').filter({hasText:'正在加载商家套餐'}).waitFor();await page.getByRole('button',{name:'取消',exact:true}).click();await page.waitForTimeout(400);assert.equal(await page.getByRole('dialog').count(),0);await page.unroute('**/api/providers/bero-host/plans')
 })
 await check('套餐请求失败显示可见错误并禁止保存',async()=>{
  await page.route('**/api/providers/bero-host/plans',route=>route.fulfill({status:500,json:{error:'测试加载失败'}}));await page.getByRole('button',{name:'添加监控',exact:true}).click();await page.getByLabel('1. 选择商家').selectOption('bero-host');await page.getByRole('alert').filter({hasText:'测试加载失败'}).waitFor();assert.equal(await page.getByRole('button',{name:'保存任务'}).isDisabled(),true);await page.getByRole('button',{name:'取消',exact:true}).click();await page.unroute('**/api/providers/bero-host/plans')
 })
 const routes=['overview' ,'monitors','providers','events','settings']
 for(const width of [1440,1200,1024,901,900,768,560,390,320]){
  await page.setViewportSize({width,height:900})
  await check(`窗口 ${width}px：各页面和编辑弹窗无溢出或卡片重叠`,async()=>{
   for(const route of routes){await page.evaluate(route=>location.hash=route,route);await page.waitForTimeout(60);if(route==='settings')await page.getByRole('heading',{name:'Telegram 频道通知'}).waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${route} overflow ${width}`)
    assert.ok(await page.evaluate(()=>{const elements=[...document.querySelectorAll('.provider-card,.monitor-card,.stat,.setting-grid>.settings-card')];for(let i=0;i<elements.length;i++)for(let j=i+1;j<elements.length;j++){const a=elements[i].getBoundingClientRect(),b=elements[j].getBoundingClientRect();if(Math.min(a.right,b.right)>Math.max(a.left,b.left)+1&&Math.min(a.bottom,b.bottom)>Math.max(a.top,b.top)+1)return false}return true}),`${route} overlap ${width}`)
   }
   await page.evaluate(()=>location.hash='providers');await page.getByRole('button',{name:'编辑监控'}).first().click();await page.locator('.monitor-plan-choice').first().waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.ok(await page.locator('.dialog-card').evaluate(e=>e.scrollWidth<=e.clientWidth));await page.getByRole('button',{name:'取消',exact:true}).click()
  })
 }
 await page.setViewportSize({width:1024,height:768});await page.getByRole('button',{name:'编辑监控'}).first().click();await page.locator('.monitor-plan-choice').first().waitFor();await page.screenshot({path:'/tmp/vpsmonitor-plan-config-1024.png',fullPage:true});await page.keyboard.press('Escape');await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'编辑监控'}).first().click();await page.locator('.monitor-plan-choice').first().waitFor();await page.screenshot({path:'/tmp/vpsmonitor-plan-config-mobile.png',fullPage:true})
 await check('无 Vue 或页面异常',async()=>assert.deepEqual(errors,[]))
 await writeFile('/tmp/vpsmonitor-responsive-results.json',JSON.stringify({results,errors},null,2));console.log(JSON.stringify({results,errors},null,2))
}finally{await browser?.close();if(child.exitCode===null){const done=once(child,'exit');child.kill('SIGTERM');await done}store.close();await rm(dir,{recursive:true,force:true})}

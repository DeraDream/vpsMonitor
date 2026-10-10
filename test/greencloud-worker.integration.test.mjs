import test from 'node:test'
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createDatabase} from '../packages/db/src/database.mjs'
test('长时间抓取期间 Worker 心跳持续更新，初始抓取时 SIGTERM 能正确退出',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'vps-green-worker-')),store=createDatabase(dir)
 store.putProvider({id:'greencloud',name:'GreenCloud',adapterKey:'greencloud',categories:[],dynamicCategories:true,notifyOnFirstDiscovery:false});store.putMonitor({id:'g',providerId:'greencloud',enabled:true,scope:'all',planIds:[],intervalSeconds:300})
 const preload=join(dir,'fetch-fixture.mjs'),html=await readFile(new URL('../packages/adapters/src/greencloud/fixtures/budget-kvm-sale.html',import.meta.url),'utf8')
 await writeFile(preload,`globalThis.fetch=async(url)=>{if(new URL(url).pathname==='/billing/store'){await new Promise(r=>setTimeout(r,2500));return new Response('<div menuItemName="Categories"><a href="/billing/store/budget-kvm-sale">Budget KVM Sale</a></div>',{headers:{'content-type':'text/html'}})}return new Response(${JSON.stringify(html)},{headers:{'content-type':'text/html'}})};`)
 const child=spawn(process.execPath,['--import',preload,'apps/worker/src/worker.mjs'],{env:{...process.env,DISABLE_BUILTIN_PROVIDERS:'1',DATA_DIR:dir,WORKER_TICK_MS:'500'},stdio:'ignore'})
 try{
  for(let i=0;i<100&&!store.getRuntime().lastTickAt;i++)await new Promise(r=>setTimeout(r,20))
  const first=store.getRuntime().lastTickAt;assert.ok(first)
  await new Promise(r=>setTimeout(r,700));assert.notEqual(store.getRuntime().lastTickAt,first);assert.equal(store.getMonitor('g').lastRunAt,undefined)
  const done=once(child,'exit');child.kill('SIGTERM');const [code]=await done;assert.equal(code,0);assert.equal(store.listPlans('greencloud').length,3)
 }finally{if(child.exitCode===null){child.kill('SIGKILL');await once(child,'exit')}store.close();await rm(dir,{recursive:true,force:true})}
})

test('未创建监控的商家由 Worker 后台刷新目录，不创建动态或通知',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'vps-catalog-worker-')),store=createDatabase(dir)
 store.putProvider({id:'greencloud',name:'GreenCloud',adapterKey:'greencloud',categories:[],dynamicCategories:true,notifyOnFirstDiscovery:false})
 const preload=join(dir,'fetch-fixture.mjs'),html=await readFile(new URL('../packages/adapters/src/greencloud/fixtures/budget-kvm-sale.html',import.meta.url),'utf8')
 await writeFile(preload,`globalThis.fetch=async(url)=>{if(new URL(url).pathname==='/billing/store'){return new Response('<div menuItemName="Categories"><a href="/billing/store/budget-kvm-sale">Budget KVM Sale</a></div>',{headers:{'content-type':'text/html'}})}return new Response(${JSON.stringify(html)},{headers:{'content-type':'text/html'}})};`)
 const child=spawn(process.execPath,['--import',preload,'apps/worker/src/worker.mjs'],{env:{...process.env,DISABLE_BUILTIN_PROVIDERS:'1',DATA_DIR:dir,WORKER_TICK_MS:'500'},stdio:'ignore'})
 try{
  for(let i=0;i<100&&!store.listPlans('greencloud').length;i++)await new Promise(r=>setTimeout(r,25))
  assert.equal(store.listPlans('greencloud').length,3)
  assert.equal(store.getMonitorByProvider('greencloud'),null)
  assert.equal(store.listEvents().length,0)
  assert.equal(store.listNotifications().length,0)
  const provider=store.getProvider('greencloud');assert.ok(provider.catalogLastAttemptAt);assert.ok(provider.catalogLastRefreshAt);assert.equal(provider.catalogLastError,null)
 }finally{if(child.exitCode===null){child.kill('SIGTERM');await once(child,'exit')}store.close();await rm(dir,{recursive:true,force:true})}
})

test('监控任务独立运行，慢任务不会阻塞新任务的首次探测',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'vps-parallel-worker-')),store=createDatabase(dir)
 store.putProvider({id:'slow',name:'Slow',adapterKey:'slow-fixture',categories:[],notifyOnFirstDiscovery:false});store.putProvider({id:'fast',name:'Fast',adapterKey:'fast-fixture',categories:[],notifyOnFirstDiscovery:false})
 store.putMonitor({id:'slow-monitor',providerId:'slow',enabled:true,scope:'all',planIds:[],intervalSeconds:300});store.putMonitor({id:'fast-monitor',providerId:'fast',enabled:true,scope:'all',planIds:[],intervalSeconds:300})
 const preload=join(dir,'adapters.mjs'),adapterModule=new URL('../packages/adapters/src/index.mjs',import.meta.url).href
 await writeFile(preload,`import {registerAdapter} from ${JSON.stringify(adapterModule)};const plan=(externalId)=>({externalId,name:externalId,available:true,quantity:1});registerAdapter({key:'slow-fixture',discover:async()=>{await new Promise(resolve=>setTimeout(resolve,2500));return {plans:[plan('slow')],completedCategories:[],failures:[]}}});registerAdapter({key:'fast-fixture',discover:async()=>({plans:[plan('fast')],completedCategories:[],failures:[]})});`)
 const child=spawn(process.execPath,['--import',preload,'apps/worker/src/worker.mjs'],{env:{...process.env,DISABLE_BUILTIN_PROVIDERS:'1',DATA_DIR:dir,WORKER_TICK_MS:'500'},stdio:['ignore','ignore','pipe']});let errors='';child.stderr.on('data',chunk=>errors+=chunk)
 try{
  for(let i=0;i<40&&!store.getMonitor('fast-monitor').lastRunAt;i++)await new Promise(r=>setTimeout(r,25))
  assert.ok(store.getMonitor('fast-monitor').lastRunAt,errors)
  assert.equal(store.getMonitor('slow-monitor').lastRunAt,undefined)
 }finally{if(child.exitCode===null){child.kill('SIGTERM');await once(child,'exit')}store.close();await rm(dir,{recursive:true,force:true})}
})

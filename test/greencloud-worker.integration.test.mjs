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

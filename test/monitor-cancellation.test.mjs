import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createDatabase} from '../packages/db/src/database.mjs'
import {createService} from '../packages/core/src/service.mjs'
import {registerAdapter} from '../packages/adapters/src/index.mjs'

test('Worker 退出时中断的探测不记录为监控失败',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'vps-monitor-cancel-')),store=createDatabase(dir)
 registerAdapter({key:'shutdown-fixture',discover:async()=>{throw new Error('（信号 SIGTERM）')}})
 store.putProvider({id:'shutdown',name:'Shutdown fixture',adapterKey:'shutdown-fixture',categories:[]})
 store.putMonitor({id:'shutdown-monitor',providerId:'shutdown',enabled:true,scope:'all',planIds:[],intervalSeconds:60})
 try{
  const service=createService(store);let stopping=false
  const run=service.runMonitorSafe(store.getMonitor('shutdown-monitor'),{isStopping:()=>stopping})
  stopping=true
  await assert.rejects(run,/SIGTERM/)
  assert.equal(store.getMonitor('shutdown-monitor').lastError,undefined)
  assert.equal(store.listEvents().some(event=>event.type==='monitor_failed'),false)
 }finally{store.close();await rm(dir,{recursive:true,force:true})}
})

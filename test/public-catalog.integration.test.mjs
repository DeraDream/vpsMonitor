import test from 'node:test'
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createDatabase} from '../packages/db/src/database.mjs'
test('公开展示匿名可读，仅输出白名单，管理接口和写操作继续需要登录',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'public-api-')),store=createDatabase(dir),port=60000+Math.floor(Math.random()*1000),base=`http://127.0.0.1:${port}`;
 store.putProvider({id:'fixture',name:'Fixture',website:'https://example.com',adapterKey:'internal',lastError:'secret'});
 store.putPlan({id:'fixture:one',providerId:'fixture',name:'One',available:true,quantity:2,notification:{chatId:'private-chat',messageId:42},notificationCycle:'private-cycle',internalSecret:'private'});
 store.putPlan({id:'fixture:gone',providerId:'fixture',name:'Gone',listed:false});
 store.addEvent({id:'event',at:new Date().toISOString(),type:'new_plan',message:'One：新套餐上架',providerId:'fixture',planId:'fixture:one',error:'internal error'});
 for(let i=0;i<510;i++)store.addEvent({id:'log'+i,at:new Date(Date.now()+i).toISOString(),type:'telegram_sent',message:'private-chat'});
 const child=spawn(process.execPath,['apps/api/src/server.mjs'],{env:{...process.env,HOST:'127.0.0.1',PORT:String(port),DATA_DIR:dir,DISABLE_BUILTIN_PROVIDERS:'1',ADMIN_PASSWORD:'public-test'},stdio:'ignore'});
 try{
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/api/auth/session')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,40))}assert.ok(ready);
  const response=await fetch(base+'/api/public/catalog');assert.equal(response.status,200);const value=await response.json();assert.equal(value.providers.length,1);assert.equal(value.plans.length,1);assert.equal(value.events.length,1);
  assert.equal(value.events[0].type,'new_plan');assert.ok(!JSON.stringify(value).includes('private'));assert.equal(value.providers[0].adapterKey,undefined);assert.equal(value.events[0].error,undefined);
  for(const path of ['/api/settings','/api/dashboard','/api/monitors','/api/providers','/api/events'])assert.equal((await fetch(base+path)).status,401);
  for(const method of ['POST','PUT','PATCH','DELETE'])assert.equal((await fetch(base+'/api/public/catalog',{method})).status,401);
  for(const path of ['/','/admin'])assert.equal((await fetch(base+path)).status,200);
  const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'public-test'})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
  const settings=await fetch(base+'/api/settings',{method:'PUT',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({telegram:{notifyNewPlans:true}})});assert.equal(settings.status,200);assert.equal((await settings.json()).telegram.notifyNewPlans,true);
  assert.equal((await fetch(base+'/api/settings',{method:'PUT',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({telegram:{notifyNewPlans:'yes'}})})).status,400);
 }finally{if(child.exitCode===null){const done=once(child,'exit');child.kill();await done}store.close();await rm(dir,{recursive:true,force:true})}
});

import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDatabase } from '../packages/db/src/database.mjs'
test('登录会话：无弹窗、错误密码、持久化、过期、退出、来源校验与限流',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'vps-auth-')),port=54000+Math.floor(Math.random()*1000),base=`http://127.0.0.1:${port}`
 const env={...process.env,DISABLE_BUILTIN_PROVIDERS:'1',DATA_DIR:dir,HOST:'127.0.0.1',PORT:String(port),ADMIN_PASSWORD:'test-pass'}
 let child,cookie
 const start=async()=>{child=spawn(process.execPath,['apps/api/src/server.mjs'],{env,stdio:'ignore'});for(let i=0;i<100;i++){try{if((await fetch(base+'/api/auth/session')).ok)return}catch{}await new Promise(r=>setTimeout(r,40))}throw Error('startup timeout')}
 const stop=async()=>{const done=once(child,'exit');child.kill('SIGTERM');await done}
 const post=(path,body,headers={})=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)})
 try{
  await start()
  const unauthed=await fetch(base+'/api/dashboard');assert.equal(unauthed.status,401);assert.equal(unauthed.headers.has('www-authenticate'),false)
  assert.notEqual((await fetch(base+'/')).status,401)
  assert.equal((await post('/api/auth/login',{username:'admin',password:'bad'})).status,401)
  assert.equal((await post('/api/auth/login',{username:'admin',password:'test-pass'},{Origin:'https://attacker.example'})).status,403)
  const login=await post('/api/auth/login',{username:'admin',password:'test-pass'});assert.equal(login.status,200)
  assert.match(login.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/)
  cookie=login.headers.get('set-cookie').split(';')[0]
  assert.equal((await fetch(base+'/api/dashboard',{headers:{Cookie:cookie}})).status,200)
  await stop();await start()
  assert.equal((await fetch(base+'/api/dashboard',{headers:{Cookie:cookie}})).status,200)
  assert.equal((await post('/api/auth/logout',{}, {Cookie:cookie,Origin:'https://attacker.example'})).status,403)
  assert.equal((await post('/api/auth/logout',{}, {Cookie:cookie})).status,200)
  assert.equal((await fetch(base+'/api/dashboard',{headers:{Cookie:cookie}})).status,401)
  const second=await post('/api/auth/login',{username:'admin',password:'test-pass'});cookie=second.headers.get('set-cookie').split(';')[0]
  const store=createDatabase(dir);store.db.prepare('UPDATE auth_sessions SET expires=0').run();store.close()
  assert.equal((await fetch(base+'/api/dashboard',{headers:{Cookie:cookie}})).status,401)
  for(let i=0;i<10;i++)await post('/api/auth/login',{username:'admin',password:'bad'})
  assert.equal((await post('/api/auth/login',{username:'admin',password:'test-pass'})).status,429)
 }finally{if(child?.exitCode===null)await stop();await rm(dir,{recursive:true,force:true})}
})

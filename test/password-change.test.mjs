import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createDatabase} from '../packages/db/src/database.mjs'
import {createAuth} from '../apps/api/src/auth.mjs'
test('修改密码验证身份、原密码和确认；持久化加盐摘要并撤销旧会话',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'vps-password-'));let store=createDatabase(dir),auth=createAuth(store,{password:'original-password'})
 const req=(cookie='',extra={})=>({method:'POST',headers:{host:'localhost',cookie,...extra},socket:{remoteAddress:'127.0.0.1'}})
 async function call(path,input,cookie='',headers={}){let code,result,session;await auth.handle(req(cookie,headers),{setHeader:(k,v)=>session=v},path,async()=>input,(_res,status,data)=>{code=status;result=data});return {code,result,cookie:session?.split(';')[0]}}
 const valid={currentPassword:'original-password',newPassword:'replacement-password',confirmPassword:'replacement-password'}
 try{
  await assert.rejects(call('/api/auth/password',valid),{status:401})
  const first=await call('/api/auth/login',{username:'admin',password:'original-password'}),other=await call('/api/auth/login',{username:'admin',password:'original-password'})
  await assert.rejects(call('/api/auth/password',valid,first.cookie,{origin:'https://evil.example'}),{status:403})
  await assert.rejects(call('/api/auth/password',{...valid,currentPassword:'wrong'},first.cookie),/当前密码错误/)
  await assert.rejects(call('/api/auth/password',{...valid,newPassword:'short'},first.cookie),/8–128/)
  await assert.rejects(call('/api/auth/password',{...valid,confirmPassword:'mismatch'},first.cookie),/不一致/)
  const changed=await call('/api/auth/password',valid,first.cookie);assert.equal(changed.code,200)
  assert.equal(auth.authorize(req(first.cookie)),false);assert.equal(auth.authorize(req(other.cookie)),false);assert.equal(auth.authorize(req(changed.cookie)),true)
  const basic=p=>'Basic '+Buffer.from('admin:'+p).toString('base64')
  assert.equal(auth.authorize(req('',{authorization:basic('original-password')})),false)
  assert.equal(auth.authorize(req('',{authorization:basic('replacement-password')})),true)
  const saved=store.db.prepare('SELECT * FROM auth_credentials').get();assert.equal(saved.digest.length,128);assert.ok(saved.salt);assert.ok(!JSON.stringify(saved).includes('replacement-password'))
  store.close();store=createDatabase(dir);auth=createAuth(store,{password:'different-environment-password'})
  assert.equal(auth.authorize(req(changed.cookie)),true)
  assert.equal((await call('/api/auth/login',{username:'admin',password:'replacement-password'})).code,200)
  await assert.rejects(call('/api/auth/login',{username:'admin',password:'different-environment-password'}),{status:401})
 }finally{store.close();rmSync(dir,{recursive:true,force:true})}
})

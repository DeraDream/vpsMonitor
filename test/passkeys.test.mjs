import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createDatabase} from '../packages/db/src/database.mjs';import {createAuth} from '../apps/api/src/auth.mjs';
test('Passkey HTTPS 限制、会话与密码验证、RP 来源、失败挑战不能重放',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'passkey-test-')),store=createDatabase(dir);let auth=createAuth(store,{password:'test-password',origin:'http://example.com'});
 const req=(cookie='',origin='https://example.com')=>({method:'POST',headers:{host:'example.com',cookie,origin},socket:{remoteAddress:'127.0.0.1',encrypted:origin.startsWith('https:')}});
 async function call(path,input={},cookie='',origin='https://example.com',method='POST'){let result,cookieOut;const r=req(cookie,origin);r.method=method;await auth.handle(r,{setHeader:(k,v)=>cookieOut=v.split(';')[0]},path,async()=>input,(_,status,data)=>result={status,data});return {...result,cookie:cookieOut}}
 try{await assert.rejects(call('/api/auth/passkeys/login/options',{},'','http://example.com'),{status:403});auth=createAuth(store,{password:'test-password',origin:'https://example.com'});
 await assert.rejects(call('/api/auth/passkeys/register/options',{currentPassword:'test-password'}),{status:401});const login=await call('/api/auth/login',{username:'admin',password:'test-password'});assert.ok(login.cookie);
 await assert.rejects(call('/api/auth/passkeys/register/options',{currentPassword:'wrong'},login.cookie),{status:403});
 await assert.rejects(call('/api/auth/passkeys/register/options',{currentPassword:'test-password'},login.cookie,'https://evil.example'),{status:403});
 const challenge=await call('/api/auth/passkeys/register/options',{currentPassword:'test-password'},login.cookie);assert.equal(challenge.data.options.rp.id,'example.com');assert.equal(challenge.data.options.authenticatorSelection.userVerification,'required');assert.equal(challenge.data.options.authenticatorSelection.residentKey,'required');
 await assert.rejects(call('/api/auth/passkeys/register/verify',{requestId:challenge.data.requestId,response:{}},login.cookie),/注册验证失败/);
 await assert.rejects(call('/api/auth/passkeys/register/verify',{requestId:challenge.data.requestId,response:{}},login.cookie),/过期或已使用/);
 const list=await call('/api/auth/passkeys',{},login.cookie,'https://example.com','GET');assert.deepEqual(list.data,[]);
 }finally{store.close();rmSync(dir,{recursive:true,force:true})}
});

import { randomBytes } from 'node:crypto'
import * as webauthn from '@simplewebauthn/server'
export function createPasskeys({db,session,verify,newSession,throttle,getOrigin,username,enabled},ceremony=webauthn){
 db.exec(`CREATE TABLE IF NOT EXISTS passkeys(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS passkey_challenges(id TEXT PRIMARY KEY,kind TEXT NOT NULL,challenge TEXT NOT NULL,session_id TEXT,expires INTEGER NOT NULL);`)
 const list=()=>db.prepare('SELECT payload FROM passkeys').all().map(r=>JSON.parse(r.payload))
 const supported=req=>{try{return enabled()&&new URL(getOrigin(req)).protocol==='https:'&&Boolean(req.socket.encrypted||(['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)&&req.headers['x-forwarded-proto']==='https'))}catch{return false}}
 const error=(message,status=400)=>Object.assign(new Error(message),{status})
 const requireSession=req=>{const id=session(req);if(!id)throw error('请先登录',401);return id}
 const requirePassword=(req,input)=>{requireSession(req);throttle(req);if(!verify(input.currentPassword))throw error('当前密码错误',403)}
 function save(kind,options,req){const id=randomBytes(32).toString('base64url');db.prepare('DELETE FROM passkey_challenges WHERE expires<=?').run(Date.now());db.prepare('INSERT INTO passkey_challenges VALUES (?,?,?,?,?)').run(id,kind,options.challenge,kind==='register'?session(req):null,Date.now()+300000);return {requestId:id,options}}
 function consume(input,kind,req){const row=db.prepare('DELETE FROM passkey_challenges WHERE id=? RETURNING *').get(String(input.requestId||''));if(!row||row.kind!==kind||row.expires<=Date.now()||(kind==='register'&&row.session_id!==session(req)))throw error('验证请求已过期或已使用，请重试');return row.challenge}
 async function handle(req,res,path,read,json){
  if(!path.startsWith('/api/auth/passkeys'))return false
  if(!supported(req))throw error('Passkey 仅支持已配置的 HTTPS 域名',403)
  const origin=getOrigin(req),rpID=new URL(origin).hostname
  if(req.method==='GET'&&path==='/api/auth/passkeys'){requireSession(req);json(res,200,list().map(({id,name,createdAt,lastUsedAt})=>({id,name,createdAt,lastUsedAt})));return true}
  const input=await read(req)
  if(req.method==='POST'&&path==='/api/auth/passkeys/register/options'){
   requirePassword(req,input)
   if(list().length>=20)throw error('最多保存 20 个 Passkey')
   const options=await ceremony.generateRegistrationOptions({rpName:'VPS Monitor',rpID,userName:username,userID:Buffer.from('vps-monitor-admin'),attestationType:'none',excludeCredentials:list().map(p=>({id:p.id,transports:p.transports})),authenticatorSelection:{residentKey:'required',userVerification:'required'}})
   json(res,200,save('register',options,req));return true
  }
  if(req.method==='POST'&&path==='/api/auth/passkeys/register/verify'){
   requireSession(req)
   const owner=requireSession(req),challenge=consume(input,'register',req)
   let result;try{result=await ceremony.verifyRegistrationResponse({response:input.response,expectedChallenge:challenge,expectedOrigin:origin,expectedRPID:rpID,requireUserVerification:true})}catch{throw error('Passkey 注册验证失败')}
   if(!result.verified||!result.registrationInfo)throw error('Passkey 注册验证失败')
   if(session(req)!==owner)throw error('登录会话已失效，请重新登录',401)
   const c=result.registrationInfo.credential
   const value={id:c.id,publicKey:Buffer.from(c.publicKey).toString('base64url'),counter:c.counter,transports:c.transports||[],name:String(input.name||'Passkey').trim().slice(0,80)||'Passkey',createdAt:new Date().toISOString(),lastUsedAt:null}
   db.prepare('INSERT INTO passkeys VALUES (?,?)').run(c.id,JSON.stringify(value));json(res,201,{ok:true});return true
  }
  if(req.method==='POST'&&path==='/api/auth/passkeys/login/options'){
   throttle(req);if(!list().length)throw error('尚未添加 Passkey，请先使用密码登录')
   const options=await ceremony.generateAuthenticationOptions({rpID,userVerification:'required',allowCredentials:list().map(p=>({id:p.id,transports:p.transports}))})
   json(res,200,save('login',options,req));return true
  }
  if(req.method==='POST'&&path==='/api/auth/passkeys/login/verify'){
   throttle(req);const challenge=consume(input,'login',req),p=list().find(p=>p.id===input.response?.id);if(!p)throw error('未知 Passkey',401)
   let result;try{result=await ceremony.verifyAuthenticationResponse({response:input.response,expectedChallenge:challenge,expectedOrigin:origin,expectedRPID:rpID,credential:{id:p.id,publicKey:Buffer.from(p.publicKey,'base64url'),counter:p.counter,transports:p.transports},requireUserVerification:true})}catch{throw error('Passkey 登录验证失败',401)}
   if(!result.verified)throw error('Passkey 登录验证失败',401)
   p.counter=result.authenticationInfo.newCounter;p.lastUsedAt=new Date().toISOString();const changed=db.prepare('UPDATE passkeys SET payload=? WHERE id=?').run(JSON.stringify(p),p.id);if(!changed.changes)throw error('Passkey 已被删除',401);newSession(req,res);json(res,200,{ok:true});return true
  }
  if(req.method==='DELETE'&&path==='/api/auth/passkeys'){requirePassword(req,input);db.prepare('DELETE FROM passkeys WHERE id=?').run(String(input.id||''));db.exec('DELETE FROM auth_sessions; DELETE FROM passkey_challenges;');newSession(req,res);json(res,200,{ok:true});return true}
  if(req.method==='PATCH'&&path==='/api/auth/passkeys'){requirePassword(req,input);const p=list().find(p=>p.id===input.id);if(!p)throw error('Passkey 不存在',404);if(typeof input.name!=='string'||!input.name.trim()||input.name.length>80)throw error('名称须为 1–80 个字符');p.name=input.name.trim();db.prepare('UPDATE passkeys SET payload=? WHERE id=?').run(JSON.stringify(p),p.id);json(res,200,{ok:true});return true}
  json(res,404,{error:'Not found'});return true
 }
 return {handle,supported,available:()=>list().length>0}
}

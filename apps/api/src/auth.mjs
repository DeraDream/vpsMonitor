import { createPasskeys } from './passkeys.mjs'
import { createHash, randomBytes, timingSafeEqual, scryptSync } from 'node:crypto'
const hash=value=>createHash('sha256').update(value).digest('hex')
const equal=(a,b)=>timingSafeEqual(Buffer.from(hash(a)),Buffer.from(hash(b)))
const fail=(message,status=400)=>Object.assign(new Error(message),{status})
export function createAuth(store,{password=process.env.ADMIN_PASSWORD||'',username=process.env.ADMIN_USERNAME||'admin',origin=process.env.AUTH_ORIGIN||''}={}){
 const db=store.db
 db.exec(`CREATE TABLE IF NOT EXISTS auth_sessions (id TEXT PRIMARY KEY, expires INTEGER NOT NULL);`)
 db.exec('CREATE TABLE IF NOT EXISTS auth_credentials (id INTEGER PRIMARY KEY CHECK(id=1), salt TEXT NOT NULL, digest TEXT NOT NULL);')
 const credential=()=>db.prepare('SELECT salt,digest FROM auth_credentials WHERE id=1').get()
 const enabled=()=>Boolean(credential()||password)
 const verify=value=>{if(typeof value!=='string'||value.length>1024)return false;const saved=credential();return saved?equal(scryptSync(value,saved.salt,64).toString('hex'),saved.digest):equal(value,password)}
 const attempts=new Map()
 const cookie=req=>{const match=(req.headers.cookie||'').match(/(?:^|;\s*)vps_session=([^;]+)/);return match?.[1]||''}
 const sessionHash=token=>hash(token+'\0'+(credential()?.digest||password))
 const session=req=>{const id=sessionHash(cookie(req));return db.prepare('SELECT id FROM auth_sessions WHERE id=? AND expires>?').get(id,Date.now())?.id||null}
 const getOrigin=req=>origin||`${req.socket.encrypted?'https':'http'}://${req.headers.host}`
 const config=req=>({enabled:enabled(),username,authenticated:!enabled()||Boolean(session(req)),passkeySupported:passkeys.supported(req),passkeyAvailable:passkeys.available()})
 const authorize=req=>{if(!enabled()||session(req))return true;const header=req.headers.authorization||'';if(!header.startsWith('Basic '))return false;const decoded=Buffer.from(header.slice(6),'base64').toString(),index=decoded.indexOf(':');return index>=0&&equal(decoded.slice(0,index),username)&&verify(decoded.slice(index+1))}
 const checkOrigin=req=>{if(req.headers.origin&&req.headers.origin!==getOrigin(req))throw fail('请求来源不匹配',403);if(req.headers['sec-fetch-site']==='cross-site')throw fail('拒绝跨站请求',403)}
 function newSession(req,res){const token=randomBytes(32).toString('base64url');db.prepare('DELETE FROM auth_sessions WHERE expires<=?').run(Date.now());db.prepare('INSERT INTO auth_sessions VALUES (?,?)').run(sessionHash(token),Date.now()+7*86400000);res.setHeader('Set-Cookie',`vps_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${new URL(getOrigin(req)).protocol==='https:'?'; Secure':''}`)}
 function throttle(req){const key=req.socket.remoteAddress,now=Date.now();for(const [k,v] of attempts)if(v.until<=now)attempts.delete(k);const value=attempts.get(key)||{count:0,until:now+60000};if(value.count>=10)throw fail('尝试过于频繁，请稍后重试',429);value.count++;attempts.set(key,value)}
 const passkeys=createPasskeys({db,session,verify,newSession,throttle,getOrigin,username,enabled})
 async function handle(req,res,path,read,json){
  if(path==='/api/auth/session'&&req.method==='GET'){json(res,200,config(req));return true}
  if(!path.startsWith('/api/auth/'))return false
  checkOrigin(req)
  if(await passkeys.handle(req,res,path,read,json))return true
  if(req.method==='POST'&&path==='/api/auth/login'){
   throttle(req);const input=await read(req)
   if(!enabled())throw fail('当前实例未配置登录密码')
   if(typeof input.username!=='string'||typeof input.password!=='string'||!equal(input.username,username)||!verify(input.password))throw fail('用户名或密码错误',401)
   newSession(req,res);json(res,200,{ok:true});return true
  }
  if(req.method==='POST'&&path==='/api/auth/password'){
   if(!enabled()||!authorize(req))throw fail('请先登录',401)
   throttle(req);const input=await read(req)
   if(!verify(input.currentPassword))throw fail('当前密码错误',400)
   if(typeof input.newPassword!=='string'||input.newPassword.length<8||input.newPassword.length>128)throw fail('新密码长度须为 8–128 个字符')
   if(input.newPassword!==input.confirmPassword)throw fail('两次输入的新密码不一致')
   if(verify(input.newPassword))throw fail('新密码不能与当前密码相同')
   const salt=randomBytes(16).toString('hex'),digest=scryptSync(input.newPassword,salt,64).toString('hex')
   store.transaction(()=>{db.prepare('INSERT OR REPLACE INTO auth_credentials VALUES (1,?,?)').run(salt,digest);db.exec('DELETE FROM auth_sessions; DELETE FROM passkey_challenges;')})
   newSession(req,res);json(res,200,{ok:true});return true
  }
  if(req.method==='POST'&&path==='/api/auth/logout'){db.prepare('DELETE FROM auth_sessions WHERE id=?').run(sessionHash(cookie(req)));res.setHeader('Set-Cookie','vps_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');json(res,200,{ok:true});return true}
  json(res,404,{error:'Not found'});return true
 }
 return {authorize,checkOrigin,handle,isEnabled:enabled}
}

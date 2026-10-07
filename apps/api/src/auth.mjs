import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
const hash=value=>createHash('sha256').update(value).digest('hex')
const equal=(a,b)=>timingSafeEqual(Buffer.from(hash(a)),Buffer.from(hash(b)))
const fail=(message,status=400)=>Object.assign(new Error(message),{status})
export function createAuth(store,{password=process.env.ADMIN_PASSWORD||'',username=process.env.ADMIN_USERNAME||'admin',origin=process.env.AUTH_ORIGIN||''}={}){
 const db=store.db
 db.exec(`CREATE TABLE IF NOT EXISTS auth_sessions (id TEXT PRIMARY KEY, expires INTEGER NOT NULL);`)
 const attempts=new Map()
 const cookie=req=>{const match=(req.headers.cookie||'').match(/(?:^|;\s*)vps_session=([^;]+)/);return match?.[1]||''}
 const sessionHash=token=>hash(token+'\0'+password)
 const session=req=>{const id=sessionHash(cookie(req));return db.prepare('SELECT id FROM auth_sessions WHERE id=? AND expires>?').get(id,Date.now())?.id||null}
 const getOrigin=req=>origin||`${req.socket.encrypted?'https':'http'}://${req.headers.host}`
 const config=req=>({enabled:password.length>0,username,authenticated:!password||Boolean(session(req))})
 const authorize=req=>!password||Boolean(session(req))||equal(req.headers.authorization||'',`Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`)
 const checkOrigin=req=>{if(req.headers.origin&&req.headers.origin!==getOrigin(req))throw fail('请求来源不匹配',403);if(req.headers['sec-fetch-site']==='cross-site')throw fail('拒绝跨站请求',403)}
 function newSession(req,res){const token=randomBytes(32).toString('base64url');db.prepare('DELETE FROM auth_sessions WHERE expires<=?').run(Date.now());db.prepare('INSERT INTO auth_sessions VALUES (?,?)').run(sessionHash(token),Date.now()+7*86400000);res.setHeader('Set-Cookie',`vps_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${new URL(getOrigin(req)).protocol==='https:'?'; Secure':''}`)}
 function throttle(req){const key=req.socket.remoteAddress,now=Date.now();for(const [k,v] of attempts)if(v.until<=now)attempts.delete(k);const value=attempts.get(key)||{count:0,until:now+60000};if(value.count>=10)throw fail('尝试过于频繁，请稍后重试',429);value.count++;attempts.set(key,value)}
 async function handle(req,res,path,read,json){
  if(path==='/api/auth/session'&&req.method==='GET'){json(res,200,config(req));return true}
  if(!path.startsWith('/api/auth/'))return false
  checkOrigin(req)
  if(req.method==='POST'&&path==='/api/auth/login'){
   throttle(req);const input=await read(req)
   if(!password)throw fail('当前实例未配置登录密码')
   if(typeof input.username!=='string'||typeof input.password!=='string'||!equal(input.username,username)||!equal(input.password,password))throw fail('用户名或密码错误',401)
   newSession(req,res);json(res,200,{ok:true});return true
  }
  if(req.method==='POST'&&path==='/api/auth/logout'){db.prepare('DELETE FROM auth_sessions WHERE id=?').run(sessionHash(cookie(req)));res.setHeader('Set-Cookie','vps_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');json(res,200,{ok:true});return true}
  json(res,404,{error:'Not found'});return true
 }
 return {authorize,checkOrigin,handle}
}

import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'

const root = resolve(new URL('..', import.meta.url).pathname)
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const filename = `vps-monitor-${version}-linux-x64.tar.gz`, archive = join(root, 'releases', filename)
const digest = createHash('sha256').update(await readFile(archive)).digest('hex')
assert.equal((await readFile(join(root, 'releases/SHA256SUMS'), 'utf8')).trim(), `${digest}  ${filename}`)
const listing = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n')
assert.ok(listing.every(name => !/(?:^|\/)(?:\.git|\.env|\.env\.release|data|fixtures)(?:\/|$)/.test(name)))
assert.ok(listing.every(name => !/node_modules\/(?:vite|@vitejs\/[^/]+)\//.test(name)))
const dir = await mkdtemp(join(tmpdir(), 'vpsmonitor-release-test-')), children = []
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited
}
try {
  execFileSync('tar', ['-xzf', archive, '-C', dir])
  const bundle = join(dir, `vps-monitor-${version}`)
  const { createDatabase } = await import(pathToFileURL(join(bundle, 'packages/db/src/database.mjs')).href)
  const db = createDatabase(join(dir, 'test-data'))
  try {
    db.putProvider({ id: 'release-fixture', name: 'Release fixture', adapterKey: 'not-installed' })
    const settings = db.getSettings(); settings.updates.repository = ''; db.setSettings(settings)
  } finally { db.close() }
  // Exercise new authentication and Bot behavior using only extracted production modules.
  const {createAuth}=await import(pathToFileURL(join(bundle,'apps/api/src/auth.mjs')).href)
  const {createBotManagement}=await import(pathToFileURL(join(bundle,'packages/core/src/bot-management.mjs')).href)
  const {createService}=await import(pathToFileURL(join(bundle,'packages/core/src/service.mjs')).href)
  const featureDb=createDatabase(join(dir,'feature-data'))
  try {
    const auth=createAuth(featureDb,{password:'feature-password',origin:'https://release.example.com'})
    let featureCookie='',result
    async function authRequest(path,input={},secure=true){
      const req={method:'POST',headers:{host:'release.example.com',cookie:featureCookie,origin:'https://release.example.com'},socket:{remoteAddress:'127.0.0.1',encrypted:secure}}
      await auth.handle(req,{setHeader:(_,value)=>featureCookie=value.split(';')[0]},path,async()=>input,(_,status,data)=>result={status,data})
      return result
    }
    await assert.rejects(authRequest('/api/auth/passkeys/login/options',{},false),{status:403})
    await authRequest('/api/auth/login',{username:'admin',password:'feature-password'})
    const options=await authRequest('/api/auth/passkeys/register/options',{currentPassword:'feature-password'})
    assert.equal(options.data.options.rp.id,'release.example.com')
    assert.equal(options.data.options.authenticatorSelection.userVerification,'required')
    const verify={requestId:options.data.requestId,response:{}}
    await assert.rejects(authRequest('/api/auth/passkeys/register/verify',verify),/注册验证失败/)
    await assert.rejects(authRequest('/api/auth/passkeys/register/verify',verify),/过期或已使用/)
    featureDb.putProvider({id:'fixture',name:'Release <fixture>',adapterKey:'not-installed'})
    featureDb.putMonitor({id:'fixture-monitor',providerId:'fixture',enabled:false,intervalSeconds:60})
    const settings=featureDb.getSettings();settings.telegram.personalChatId='123';featureDb.setSettings(settings)
    const calls=[],bot=createBotManagement(featureDb,createService(featureDb),{call:async(_t,method,payload)=>{calls.push({method,payload});return {}}})
    const callback=data=>({callback_query:{id:'callback',from:{id:123},message:{message_id:42,chat:{id:123,type:'private'}},data}})
    await bot.handle(callback('custominterval:fixture-monitor'))
    await bot.handle({message:{chat:{id:123,type:'private'},from:{id:123},text:'5m'}})
    assert.equal(featureDb.getMonitor('fixture-monitor').intervalSeconds,300)
    assert.equal(calls.at(-1).method,'editMessageText');assert.equal(calls.at(-1).payload.parse_mode,'HTML')
    assert.ok(calls.at(-1).payload.text.includes('&lt;fixture&gt;'))
  } finally {featureDb.close()}
  execFileSync(process.execPath, ['--input-type=module', '-e', "import {getAdapter} from '@vps-monitor/adapters';if(!getAdapter('bero-host')||!getAdapter('greencloud'))process.exit(1)"], { cwd: bundle })
  const port = 55000 + Math.floor(Math.random() * 1000)
  const env = { ...process.env, DISABLE_BUILTIN_PROVIDERS: '1', DATA_DIR: join(dir, 'test-data'), HOST: '127.0.0.1', PORT: String(port), ADMIN_PASSWORD: 'release-test-password', TOKEN_ENCRYPTION_KEY: 'release-test-key', WORKER_TICK_MS: '500' }
  const api = spawn(process.execPath, ['apps/api/src/server.mjs'], { cwd: bundle, env, stdio: 'ignore' }); children.push(api)
  const base = `http://127.0.0.1:${port}`; let cookie=''
  async function request(path, method = 'GET', body) {
    return fetch(base + path, { method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  }
  let ready = false
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base+'/api/auth/session')).status === 200) { ready = true; break } } catch {} await new Promise(resolve => setTimeout(resolve, 50)) }
  assert.ok(ready, '解压后的 API 未能启动')
  const progressAnonymous=await fetch(base+'/api/updates/progress');assert.equal(progressAnonymous.status,401);
  const publicResponse=await fetch(base+'/api/public/catalog');assert.equal(publicResponse.status,200);assert.equal((await publicResponse.json()).version,version);assert.equal((await fetch(base+'/admin')).status,200);
  const anonymous=await fetch(base+'/api/dashboard');assert.equal(anonymous.status,401);assert.equal(anonymous.headers.has('www-authenticate'),false)
  const login=await request('/api/auth/login','POST',{username:'admin',password:'release-test-password'});assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0]
  assert.equal((await (await request('/api/updates/progress')).json()).state,'idle');
  const update=await (await request('/api/updates/status')).json();assert.equal(update.mode,'release')
  assert.equal((await (await request('/api/dashboard')).json()).version, version)
  const html = await (await request('/')).text(), asset = html.match(/src="([^"]+\.js)"/)?.[1]
  assert.ok(asset, '发布包缺少前端构建入口')
  const js = await request(asset); assert.equal(js.status, 200); assert.ok((await js.text()).includes(version))
  const created = await request('/api/monitors', 'POST', { providerId: 'release-fixture', enabled: false, scope: 'all', intervalSeconds: 60 })
  assert.equal(created.status, 201)
  const monitor = await created.json()
  const intervalSaved=await request(`/api/monitors/${monitor.id}`,'PATCH',{intervalSeconds:15});assert.equal(intervalSaved.status,200);assert.equal((await intervalSaved.json()).intervalSeconds,15);
  assert.equal((await (await request('/api/events')).json()).items.length,0);
  assert.equal((await fetch(base+'/api/logs')).status,401);
  assert.equal((await (await request('/api/public/activity-settings')).json()).refreshIntervalSeconds,10);
  assert.equal((await request('/api/activity/settings','PUT',{refreshIntervalSeconds:2})).status,200);
  assert.equal((await (await request('/api/public/activity-settings')).json()).refreshIntervalSeconds,2);
  const {logLevel}=await import(pathToFileURL(join(bundle,'apps/api/src/log-level.mjs')).href);
  assert.equal(logLevel({PRIORITY:'6',MESSAGE:'[monitor] GreenCloud: 采集 401 个套餐，失败分类 0 个'}),'info');
  assert.equal(logLevel({PRIORITY:'6',MESSAGE:'[monitor] GreenCloud: 采集 401 个套餐，失败分类 1 个'}),'error');
  assert.ok((await readFile(join(bundle,'deploy/systemd/vps-monitor-api.service'),'utf8')).includes('SupplementaryGroups=systemd-journal'));

  assert.equal((await request(`/api/monitors/${monitor.id}/run`, 'POST', {})).status, 400)
  assert.equal((await request('/api/settings', 'PUT', { telegram: { botToken: 'release-fake-token', chatId: '-1' } })).status, 200)
  const oldCookie=cookie
  const passwordChanged=await request('/api/auth/password','POST',{currentPassword:'release-test-password',newPassword:'release-new-password',confirmPassword:'release-new-password'})
  assert.equal(passwordChanged.status,200);cookie=passwordChanged.headers.get('set-cookie').split(';')[0]
  assert.equal((await fetch(base+'/api/dashboard',{headers:{Cookie:oldCookie}})).status,401)
  assert.equal((await request('/api/dashboard')).status,200)
  await stop(api)
  const restarted=spawn(process.execPath,['apps/api/src/server.mjs'],{cwd:bundle,env,stdio:'ignore'});children.push(restarted)
  let restartedReady=false
  for(let i=0;i<100;i++){try{if((await request('/api/auth/session')).ok){restartedReady=true;break}}catch{}await new Promise(resolve=>setTimeout(resolve,50))}
  assert.ok(restartedReady,'密码修改后的 API 重启失败')
  assert.equal((await (await request('/api/public/activity-settings')).json()).refreshIntervalSeconds,2);
  assert.equal((await (await request('/api/monitors')).json())[0].intervalSeconds,15);
  assert.equal((await request('/api/dashboard')).status,200)
  assert.equal((await request('/api/auth/login','POST',{username:'admin',password:'release-test-password'})).status,401)
  const newLogin=await request('/api/auth/login','POST',{username:'admin',password:'release-new-password'});assert.equal(newLogin.status,200);cookie=newLogin.headers.get('set-cookie').split(';')[0]
  const worker = spawn(process.execPath, ['apps/worker/src/worker.mjs'], { cwd: bundle, env, stdio: 'ignore' }); children.push(worker)
  let heartbeat = false
  for (let i = 0; i < 100; i++) { if ((await (await request('/api/dashboard')).json()).runtime.lastTickAt) { heartbeat = true; break } await new Promise(resolve => setTimeout(resolve, 50)) }
  assert.ok(heartbeat, '解压后的 Worker 没有心跳')
  const release = JSON.parse(await readFile(join(bundle, 'release-manifest.json'), 'utf8'))
  assert.equal(release.version, version); assert.equal(release.builtLocally, true)
  const result = { version, filename, sha256: digest, verified: true,
    checks: ['动态分页接口、共享刷新设置及重启持久化', '15 秒监控间隔保存及重启持久化', '成功/失败日志级别及 systemd 读取权限', 'Passkey 生产依赖、HTTPS 限制、RP ID、用户验证及一次性挑战', 'Bot 生产模块、自定义间隔及 HTML 原地更新', 'SHA256', '匿名公开库存及后台登录入口', '排除凭据和业务数据', '排除前端开发依赖', '生产 Adapter 可加载', '解压后 API 启动及会话认证（无弹窗）', '无 Git 安装包版本检查', 'API 与前端版本一致', '监控创建及错误反馈', 'Token 加密设置', '密码修改、旧会话失效及 API 重启后新密码有效', '解压后 Worker 心跳'] }
  await writeFile(join(root, 'releases/verification.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result, null, 2))
} finally { for (const child of children.reverse()) await stop(child); await rm(dir, { recursive: true, force: true }) }

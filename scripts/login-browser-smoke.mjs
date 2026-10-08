import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp,rm,writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href)
const dir=await mkdtemp(join(tmpdir(),'vps-login-browser-')),port=55000+Math.floor(Math.random()*1000),base=`http://127.0.0.1:${port}`
const child=spawn(process.execPath,['apps/api/src/server.mjs'],{env:{...process.env,DISABLE_BUILTIN_PROVIDERS:'1',DATA_DIR:dir,HOST:'127.0.0.1',PORT:String(port),ADMIN_PASSWORD:'login-test'},stdio:'ignore'})
const results=[],errors=[];let browser
async function check(name,fn){await fn();results.push({name,result:'PASS'})}
try{
 for(let i=0;i<100;i++){try{if((await fetch(base+'/api/auth/session')).ok)break}catch{}await new Promise(r=>setTimeout(r,50))}
 browser=await chromium.launch({headless:true,args:['--no-sandbox']})
 const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage()
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',()=>errors.push('unexpected browser dialog'))
 await page.goto(base+'/admin#account')
 await check('未登录直接访问个人中心显示完整登录页',async()=>{await page.getByRole('heading',{name:'欢迎回来'}).waitFor();assert.equal(await page.locator('.app-shell').count(),0)})
 await check('空密码阻止提交',async()=>{await page.getByRole('button',{name:'登录控制台'}).click();assert.equal(await page.locator('#login-password').evaluate(e=>e.validity.valueMissing),true)})
 await check('错误密码显示页内提示',async()=>{await page.getByLabel('密码',{exact:true}).fill('wrong');await page.getByRole('button',{name:'登录控制台'}).click();await page.getByRole('alert').filter({hasText:'用户名或密码错误'}).waitFor()})
 await check('显示和隐藏密码',async()=>{await page.getByRole('button',{name:'显示密码',exact:true}).click();assert.equal(await page.locator('#login-password').getAttribute('type'),'text');await page.getByRole('button',{name:'隐藏密码',exact:true}).click();assert.equal(await page.locator('#login-password').getAttribute('type'),'password')})
 await page.screenshot({path:'/tmp/vpsmonitor-login-desktop.png',fullPage:true})
 await page.setViewportSize({width:390,height:844})
 await check('手机登录页无横向溢出',async()=>{assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))})
 await page.screenshot({path:'/tmp/vpsmonitor-login-mobile.png',fullPage:true})
 await check('密码登录后恢复目标页',async()=>{await page.getByLabel('密码',{exact:true}).fill('login-test');await page.getByRole('button',{name:'登录控制台'}).click();await page.getByRole('heading',{name:'修改密码'}).waitFor()})
 await check('刷新后保持会话',async()=>{await page.reload();await page.getByRole('heading',{name:'修改密码'}).waitFor()})
 await check('退出登录位于个人中心下方，个人卡片桌面两列、手机一列',async()=>{
  assert.equal(await page.locator('.topbar').getByRole('button',{name:'退出登录',exact:true}).count(),0);
  const account=await page.locator('.sidebar-foot').getByRole('link',{name:'个人中心',exact:true}).boundingBox(),logout=await page.locator('.sidebar-foot').getByRole('button',{name:'退出登录',exact:true}).boundingBox();assert.ok(logout.y>account.y);
  await page.setViewportSize({width:1440,height:900});const cards=page.locator('.personal-cards .settings-card');assert.equal(await cards.count(),2);const left=await cards.nth(0).boundingBox(),right=await cards.nth(1).boundingBox();assert.ok(Math.abs(left.y-right.y)<2);assert.ok(right.x>=left.x+left.width);
  await page.screenshot({path:'/tmp/personal-center-two-columns.png'});
  await page.setViewportSize({width:390,height:844});const top=await cards.nth(0).boundingBox(),bottom=await cards.nth(1).boundingBox();assert.ok(bottom.y>=top.y+top.height);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 })
 await check('已登录公开页显示后台',async()=>{await page.getByRole('link',{name:'主页',exact:true}).click();await page.getByRole('link',{name:'后台 ↗',exact:true}).waitFor();await page.getByRole('link',{name:'后台 ↗',exact:true}).click();await page.locator('.sidebar-foot').getByRole('link',{name:'个人中心',exact:true}).click();await page.getByRole('heading',{name:'修改密码'}).waitFor()})
 await check('设置只保留版本状态，不显示仓库和分支配置',async()=>{await page.locator('.sidebar nav').getByRole('link',{name:'设置',exact:true}).click();assert.equal(await page.getByRole('heading',{name:'在线更新',exact:true}).count(),0);assert.equal(await page.getByText('GitHub 仓库',{exact:true}).count(),0);assert.equal(await page.getByText('发布分支',{exact:true}).count(),0);await page.getByRole('heading',{name:'版本状态',exact:true}).waitFor();await page.getByRole('button',{name:'检查更新',exact:true}).waitFor();assert.equal(await page.getByRole('heading',{name:'修改密码',exact:true}).count(),0);assert.equal(await page.getByRole('heading',{name:'Passkey 登录',exact:true}).count(),0);await page.locator('.sidebar-foot').getByRole('link',{name:'个人中心',exact:true}).click();await page.getByRole('heading',{name:'修改密码',exact:true}).waitFor()})
 await check('手机后台操作栏无横向溢出',async()=>{for(const width of [390,320]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.getByRole('link',{name:'主页',exact:true}).waitFor()}await page.setViewportSize({width:1440,height:900})})
 await check('错误当前密码显示页内提示',async()=>{await page.getByLabel('当前密码',{exact:true}).fill('wrong');await page.getByLabel('新密码',{exact:true}).fill('new-login-test');await page.getByLabel('确认新密码',{exact:true}).fill('new-login-test');await page.getByRole('button',{name:'修改密码',exact:true}).click();await page.getByRole('alert').filter({hasText:'当前密码错误'}).waitFor()})
 await check('修改密码成功并保持当前登录',async()=>{await page.getByLabel('当前密码',{exact:true}).fill('login-test');await page.getByRole('button',{name:'修改密码',exact:true}).click();await page.getByRole('status').filter({hasText:'密码已修改'}).waitFor();assert.equal(await page.getByLabel('新密码',{exact:true}).inputValue(),'');await page.reload();await page.getByRole('heading',{name:'修改密码'}).waitFor()})
 await check('退出登录回到公开首页',async()=>{await page.getByRole('button',{name:'退出登录'}).click();await page.locator('.public-hero').waitFor();await page.getByRole('link',{name:'登录 ↗',exact:true}).waitFor();await page.goto(base+'/admin');await page.getByRole('heading',{name:'欢迎回来'}).waitFor();assert.equal((await context.request.get(base+'/api/dashboard')).status(),401)})
 await check('重新登录可用',async()=>{await page.getByLabel('密码',{exact:true}).fill('new-login-test');await page.getByRole('button',{name:'登录控制台'}).click();await page.getByRole('heading',{name:'实时状态'}).waitFor()})
 await check('会话失效自动回到登录页',async()=>{await context.clearCookies();await page.getByRole('button',{name:'立即刷新'}).click();await page.getByRole('heading',{name:'欢迎回来'}).waitFor()})
 await check('无浏览器弹窗和页面异常',async()=>assert.deepEqual(errors,[]))
 console.log(JSON.stringify({results},null,2));await writeFile('/tmp/vpsmonitor-login-results.json',JSON.stringify({results},null,2))
}finally{await browser?.close();if(child.exitCode===null){const done=once(child,'exit');child.kill('SIGTERM');await done}await rm(dir,{recursive:true,force:true})}

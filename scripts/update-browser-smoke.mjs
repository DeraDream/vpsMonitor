import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {mkdtemp,rm,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href),dir=await mkdtemp(join(tmpdir(),'update-browser-')),port=57000+Math.floor(Math.random()*1000),base=`http://127.0.0.1:${port}`
const child=spawn(process.execPath,['apps/api/src/server.mjs'],{env:{...process.env,DATA_DIR:dir,DISABLE_BUILTIN_PROVIDERS:'1',ADMIN_PASSWORD:'',HOST:'127.0.0.1',PORT:String(port)},stdio:'ignore'})
const results=[],errors=[];let browser,available=false,applyCalls=0,step=-1,fail=false,reloads=0,interruptions=0
async function check(name,fn){await fn();results.push({name,result:'PASS'})}
try{
 let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/api/auth/session')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,40))}assert.ok(ready)
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.message));page.on('dialog',async dialog=>{errors.push('系统弹窗：'+dialog.type());await dialog.dismiss()});page.on('framenavigated',frame=>{if(frame===page.mainFrame())reloads++})
 await page.route('**/api/updates/status',route=>route.fulfill({json:{mode:'release',localVersion:'1.6.0',remoteVersion:available?'1.6.1':'1.6.0',updateAvailable:available,deployReady:true,message:available?'发现新版本 v1.6.1。可在线下载并更新。':'已是最新版本。'}}))
 await page.route('**/api/updates/apply',async route=>{applyCalls++;assert.equal(route.request().method(),'POST');assert.equal(route.request().postDataJSON().targetVersion,'1.6.1');step=0;await route.fulfill({status:202,json:{state:'checking',progress:1,targetVersion:'1.6.1',message:'开始更新'}})})
 await page.route('**/api/updates/progress',async route=>{
  if(step<0)return route.fulfill({json:{state:'idle',progress:0}})
  if(fail)return route.fulfill({json:{state:'failed',progress:40,message:'安装包 SHA256 校验失败，未修改现有部署'}})
  const states=[['downloading',15,'正在下载发布包'],['verifying',40,'正在校验 SHA256'],['installing',75,'正在安装新版本'],['restarting',95,'正在重启服务']]
  if(step===4&&interruptions<2){interruptions++;return route.abort('connectionrefused')}
  if(step>=states.length){available=false;return route.fulfill({json:{state:'completed',progress:100,targetVersion:'1.6.1',version:'1.6.1',message:'更新完成'}})}
  const [state,progress,message]=states[step++];return route.fulfill({json:{state,progress,message,targetVersion:'1.6.1'}})
 })
 await page.goto(base+'/admin#settings');await page.getByRole('button',{name:'检查更新',exact:true}).waitFor()
 await check('检查更新显示最新状态，操作按钮可用',async()=>{await page.getByRole('button',{name:'检查更新',exact:true}).click();await page.getByText('已是最新版本。',{exact:true}).first().waitFor();assert.equal(await page.locator('.update-dialog').count(),0)})
 available=true
 await check('有更新时打开站内确认弹窗，取消不调用更新接口',async()=>{await page.getByRole('button',{name:'检查更新',exact:true}).click();await page.getByRole('dialog').waitFor();assert.match(await page.getByRole('dialog').textContent(),/1.6.1/);await page.getByRole('button',{name:'暂不更新'}).click();assert.equal(applyCalls,0);assert.equal(await page.getByRole('dialog').count(),0)})
 await check('确认更新后展示实际阶段与百分比，按钮避免重复提交',async()=>{await page.getByRole('button',{name:'检查更新',exact:true}).click();await page.getByRole('button',{name:'确定更新'}).click();await page.getByText('正在下载发布包',{exact:true}).waitFor();assert.equal(await page.getByRole('progressbar').getAttribute('value'),'15');assert.equal(await page.getByRole('button',{name:'确定更新'}).count(),0);await page.getByText('正在校验 SHA256',{exact:true}).waitFor();assert.equal(await page.getByRole('progressbar').getAttribute('value'),'40')})
 await page.screenshot({path:'/tmp/vpsmonitor-update-progress.png',fullPage:true})
 const before=reloads
 await check('服务重启短暂断连自动重试，完成后刷新页面',async()=>{await page.waitForFunction(()=>!document.querySelector('.update-dialog'),{},{timeout:30000});await page.getByRole('button',{name:'检查更新',exact:true}).waitFor();assert.ok(reloads>before);assert.equal(applyCalls,1);assert.equal(interruptions,2);assert.equal(await page.locator('.update-dialog').count(),0)})
 available=true;fail=true
 await check('更新失败在站内显示原因，支持关闭及重新检查',async()=>{await page.getByRole('button',{name:'检查更新',exact:true}).click();await page.getByRole('button',{name:'确定更新'}).click();await page.getByRole('alert').filter({hasText:'SHA256'}).waitFor();await page.getByRole('button',{name:'重新检查'}).click();await page.getByRole('button',{name:'确定更新'}).waitFor();await page.getByRole('button',{name:'暂不更新'}).click()})
 for(const width of [390,320])await check(`${width}px 更新弹窗不溢出`,async()=>{await page.setViewportSize({width,height:844});await page.getByRole('button',{name:'检查更新',exact:true}).click();await page.getByRole('dialog').waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.ok(await page.getByRole('dialog').evaluate(e=>e.scrollWidth<=e.clientWidth));await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'})})
 await check('未使用系统弹窗且无浏览器运行异常',async()=>assert.deepEqual(errors,[]))
 const report={checks:results.length,results,errors};await writeFile('docs/test-results/v1.6.2/update-browser.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2))
}finally{await browser?.close();if(child.exitCode===null){const done=once(child,'exit');child.kill();await done}await rm(dir,{recursive:true,force:true})}

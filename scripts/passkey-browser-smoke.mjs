import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {once} from 'node:events';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const dir=await mkdtemp(join(tmpdir(),'passkey-browser-')),port=56000+Math.floor(Math.random()*1000),base=`http://127.0.0.1:${port}`,origin='https://passkey.example.com';
const child=spawn(process.execPath,['apps/api/src/server.mjs'],{env:{...process.env,DISABLE_BUILTIN_PROVIDERS:'1',DATA_DIR:dir,HOST:'127.0.0.1',PORT:String(port),AUTH_ORIGIN:origin,ADMIN_PASSWORD:'test-password'},stdio:'ignore'});let browser;
try{
 for(let i=0;i<100;i++){try{if((await fetch(base+'/api/auth/session')).ok)break}catch{}await new Promise(r=>setTimeout(r,50))}
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});const context=await browser.newContext();
 // Intercept the trusted HTTPS test origin; no certificates are generated or installed.
 await context.route(origin+'/**',async route=>{const request=route.request(),url=new URL(request.url()),headers={...request.headers()};delete headers.host;headers['x-forwarded-proto']='https';const r=await fetch(base+url.pathname+url.search,{method:request.method(),headers,body:request.postData()||undefined,redirect:'manual'});await route.fulfill({status:r.status,headers:Object.fromEntries(r.headers),body:Buffer.from(await r.arrayBuffer())})});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept(d.type()==='prompt'?'新设备名':undefined));const cdp=await context.newCDPSession(page);await cdp.send('WebAuthn.enable');await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}});
 await page.goto(origin+'/admin#settings');await page.getByLabel('密码',{exact:true}).fill('test-password');await page.getByRole('button',{name:'登录控制台'}).click();await page.getByRole('heading',{name:'Passkey 登录'}).waitFor();
 await page.locator('#passkey-password').fill('test-password');await page.getByRole('button',{name:'添加 Passkey',exact:true}).click();await page.locator('.passkey-row').waitFor();assert.match(await page.locator('.passkey-row').innerText(),/我的设备/);
 await page.locator('#passkey-password').fill('test-password');await page.getByRole('button',{name:'重命名',exact:true}).click();await page.getByText('新设备名',{exact:true}).waitFor();
 await page.getByRole('button',{name:'退出登录'}).click();await page.goto(origin+'/admin');await page.getByRole('button',{name:'使用 Passkey 登录'}).click();await page.getByRole('heading',{name:'实时状态'}).waitFor();
 await page.locator('.sidebar nav').getByRole('link',{name:'设置',exact:true}).click();await page.locator('.passkey-row').waitFor();assert.ok(!(await page.locator('.passkey-row').innerText()).includes('尚未使用'));
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await page.locator('#passkey-password').fill('test-password');await page.getByRole('button',{name:'删除',exact:true}).click();await page.getByText('尚未添加 Passkey。',{exact:true}).waitFor();assert.deepEqual(errors,[]);
 console.log('PASS: HTTPS 注册、重命名、Passkey 登录、最近使用时间、移动端、删除；无自签名证书');
}finally{await browser?.close();if(child.exitCode===null){const done=once(child,'exit');child.kill('SIGTERM');await done}await rm(dir,{recursive:true,force:true})}

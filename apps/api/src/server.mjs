import { createServer } from "node:http";
import { logLevel } from "./log-level.mjs";
import { createAuth } from "./auth.mjs";
import { createUpdateController } from "./update-runner.mjs";
import { releaseStatus, isGitCheckout } from "./updates.mjs";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createDatabase } from "@vps-monitor/db";
import { createService, bootstrapProviders, encryptToken, tokenKey, formatCard, telegramCall, telegramTargets, repositoryMatches, monitored, validateQuietHours } from "@vps-monitor/core";

const host=process.env.HOST||"127.0.0.1",port=Number(process.env.PORT||4173);
const root=resolve(fileURLToPath(new URL("../../..",import.meta.url)));
const version=JSON.parse(readFileSync(join(root,"package.json"),"utf8")).version;
const webDir=process.env.WEB_DIST_DIR?resolve(process.env.WEB_DIST_DIR):join(root,"apps/web/dist");
const store=createDatabase(process.env.DATA_DIR||join(root,"data"));
bootstrapProviders(store);
const service=createService(store);

const dataDir=resolve(process.env.DATA_DIR||join(root,"data"));
const updater=createUpdateController({root,dataDir,version,workerActive:()=>Date.now()-Date.parse(store.getRuntime().lastTickAt||0)<30000});
await updater.initialize();
const auth=createAuth(store);
function json(res,status,value){if(status>=400&&value?.error)console.error(`[HTTP ${status}] ${value.error}`);res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});res.end(status===204?"":JSON.stringify(value));}
async function body(req){let raw="";for await(const c of req){raw+=c;if(raw.length>1_000_000){const error=new Error("请求体过大");error.status=413;throw error;}}try{const value=raw?JSON.parse(raw):{};if(!value||typeof value!=="object"||Array.isArray(value))throw new Error();return value;}catch{const error=new Error("请求体必须是有效 JSON 对象");error.status=400;throw error;}}
function settingsPatch(input,settings){
  if(Object.keys(input).some(key=>!["telegram","updates"].includes(key)))throw new Error("未知设置字段");
  for(const section of ["telegram","updates"]){
    if(input[section]===undefined)continue;
    const value=input[section];if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("设置必须是对象");
    const allowed=section==="telegram"?["botToken","chatId","personalChatId","channelEnabled","personalEnabled","enabled","showBuyLink","notificationMode","notifyNewPlans","quietHours"]:["repository","branch"];
    if(Object.keys(value).some(key=>!allowed.includes(key)))throw new Error("未知或只读设置字段");
    for(const [key,item] of Object.entries(value)){
      if(key==="quietHours"){validateQuietHours(item,settings.telegram.quietHours);}
      else if(key==="notificationMode"){if(!["restock","all"].includes(item))throw new Error("通知模式必须为 restock 或 all");}
      else if(["enabled","showBuyLink","notifyNewPlans","channelEnabled","personalEnabled"].includes(key)){if(typeof item!=="boolean")throw new Error(`${key} 必须是布尔值`);}
      else if(typeof item!=="string"||item.length>500)throw new Error(`${key} 必须是长度不超过 500 的字符串`);
    }
    if(section==='telegram'){
      if(value.personalChatId!==undefined&&value.personalChatId!==''&&!/^[1-9]\d{0,19}$/.test(value.personalChatId))throw new Error('个人 User ID 必须是正整数');
      if(value.chatId!==undefined&&value.chatId!==''&&!/^(?:-?\d{1,20}|@[A-Za-z][A-Za-z0-9_]{4,31})$/.test(value.chatId))throw new Error('频道 Chat ID 格式不正确');
    }
    if(section==="telegram"){
      const {botToken,quietHours,...visible}=value;Object.assign(settings.telegram,visible);
      if(quietHours!==undefined)settings.telegram.quietHours=validateQuietHours(quietHours,settings.telegram.quietHours);
      if(botToken)settings.telegram.botTokenEncrypted=encryptToken(botToken);
    }else{
      if(value.repository&&!/^[\w.-]+\/[\w.-]+$/.test(value.repository))throw new Error("仓库格式应为 owner/repository");
      if(value.branch!==undefined&&(!value.branch||value.branch.startsWith("-")||/[\s~^:?*\[\]\\]/.test(value.branch)||value.branch.includes("..")))throw new Error("无效发布分支");
      Object.assign(settings.updates,value);
    }
  }
  return settings;
}
function maskedSettings(){const settings=store.getSettings(),telegram={...settings.telegram,botTokenConfigured:Boolean(settings.telegram.botTokenEncrypted)};delete telegram.botTokenEncrypted;delete telegram.botToken;return {telegram,updates:settings.updates,security:{passwordProtected:auth.isEnabled(),tokenEncryptionConfigured:Boolean(tokenKey())}};}
const marketTypes=new Set(["new_plan","restocked","sold_out","stock_changed","delisted"]);
function marketEvents(limit=12){return store.listEvents(limit,[...marketTypes]).map(event=>({...event,providerName:store.getProvider(event.providerId)?.name||event.providerName||event.providerId||'未知商家'}));}
function eventPage(url){
 let cursor=null;const raw=url.searchParams.get('cursor');
 if(raw){try{cursor=JSON.parse(Buffer.from(raw,'base64url').toString());if(typeof cursor.at!=='string'||typeof cursor.id!=='string'||raw.length>1000)throw Error();}catch{throw Object.assign(new Error('无效分页参数'),{status:400});}}
 const type=url.searchParams.get('type');if(type&&!marketTypes.has(type))throw Object.assign(new Error('无效动态类型'),{status:400});
 const result=store.pageEvents({types:type?[type]:[...marketTypes],limit:Math.max(1,Math.min(50,Number(url.searchParams.get('limit'))||30)),cursor});
 result.items=result.items.map(({id,at,type,message,providerId,planId,snapshot})=>({id,at,type,message,providerId,planId,providerName:store.getProvider(providerId)?.name||providerId||'未知商家',snapshot:snapshot?Object.fromEntries(Object.entries(snapshot).filter(([key])=>publicPlanFields.has(key))):null}));return result;
}
const publicPlanFields=new Set(["id","providerId","externalId","categoryId","categoryName","sourceUrl","listed","name","specs","cpu","ram","nvme","ipv4","ipv6","backups","runtime","storage","storageType","bandwidth","portSpeed","os","controlPanel","virtualization","description","availabilitySource","configuration","price","billingCycle","location","buyUrl","tags","available","quantity","observedAt"]);
function publicCatalog(){
 const providers=store.listProviders().map(({id,name,website,categories})=>({id,name,website,categories}));
 const plans=store.listPlans().filter(p=>p.listed!==false).map(p=>Object.fromEntries(Object.entries(p).filter(([key])=>publicPlanFields.has(key))));
 const events=marketEvents(8).map(({id,at,type,message,providerId,providerName,planId,snapshot})=>({id,at,type,message,providerId,providerName,planId,snapshot:snapshot?Object.fromEntries(Object.entries(snapshot).filter(([key])=>publicPlanFields.has(key))):null}));
 return {version,providers,plans,events};
}
function dashboard(){const providers=store.listProviders(),monitors=store.listMonitors(),plans=store.listPlans().filter(p=>p.listed!==false),enabled=monitors.filter(m=>m.enabled);return {stats:{providers:providers.length,monitoredProviders:new Set(enabled.map(m=>m.providerId)).size,monitoredPlans:enabled.reduce((sum,m)=>sum+(plans.filter(p=>p.providerId===m.providerId&&monitored(p,m)).length),0),inStock:plans.filter(p=>p.available&&p.availabilitySource!=="order-button").length,orderable:plans.filter(p=>p.available&&p.availabilitySource==="order-button").length},version,providers,monitors:monitors.map(service.monitorView),runtime:{...store.getRuntime(),pendingNotifications:store.listNotifications().length},events:marketEvents().slice(0,12)};}
const execute=promisify(execFile);
async function serverLogs(url){
 const cursor=url.searchParams.get('cursor');if(cursor&&(cursor.length>2048||!/^[a-zA-Z0-9;=_-]+$/.test(cursor)))throw Object.assign(new Error('无效日志游标'),{status:400});
 const args=['--no-pager','-o','json','-u','vps-monitor-api.service','-u','vps-monitor-worker.service'];
 if(cursor)args.push('--after-cursor',cursor,'-n','1000');else args.push('-n','200');
 const {stdout}=await execute('journalctl',args,{encoding:'utf8',timeout:10000,maxBuffer:4*1024*1024});
 const entries=stdout.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
 const redact=text=>String(text).replace(/\b\d{5,}:[A-Za-z0-9_-]{20,}\b/g,'[隐藏 Token]').replace(/((?:password|authorization|botToken|tokenKey)\s*[=:]\s*)[^\s,;]+/gi,'$1[隐藏]');
 const items=entries.slice(-1000).map(row=>({id:row.__CURSOR,at:new Date(Number(row.__REALTIME_TIMESTAMP)/1000).toISOString(),source:(row._SYSTEMD_UNIT||row.UNIT)?.includes('worker')?'Worker':'API',level:logLevel(row),message:redact(row.MESSAGE)}));
 return {items,cursor:items.at(-1)?.id||cursor||null};
}
async function git(args){return (await execute("git",args,{cwd:root,encoding:"utf8",timeout:20000})).stdout.trim();}
async function updateStatus(){if(!isGitCheckout(root))return releaseStatus(root,version,store.getSettings().updates);const settings=store.getSettings().updates,base={configured:Boolean(settings.repository),repository:settings.repository,branch:settings.branch,mode:"git",localVersion:version,localRevision:null,remoteRevision:null,updateAvailable:false,deployReady:false,message:"尚未配置 GitHub 更新源。"};if(!settings.repository)return base;try{const localRevision=await git(["rev-parse","HEAD"]),dirty=await git(["status","--porcelain"]),originUrl=await git(["remote","get-url","origin"]);if(!repositoryMatches(settings.repository,originUrl))return {...base,localRevision,message:"设置页的 GitHub 仓库与本地 origin 不一致，已拒绝在线更新。"};if(dirty)return {...base,localRevision,message:"工作目录有未提交修改，不能在线更新。"};const remoteRevision=(await git(["ls-remote","origin",`refs/heads/${settings.branch}`])).split(/\s+/)[0]||null;if(!remoteRevision)return {...base,localRevision,message:"远端发布分支不存在，已拒绝在线更新。"};return {...base,localRevision,remoteRevision,updateAvailable:Boolean(remoteRevision&&remoteRevision!==localRevision),deployReady:true,message:remoteRevision&&remoteRevision!==localRevision?"发现新版本，可以在线更新。":"已是最新版本。"};}catch(error){const detail=error.stderr?.trim()||error.message;return {...base,message:`无法检查更新：${detail}`};}}
function samplePlan(input={}){return {providerName:"示例商家",name:"Anniversary S Ryzen VPS",price:"€39.00",billingCycle:"year",location:"DE · Frankfurt",categoryName:"CN2 GIA / 9929",configuration:[{label:"CPU",value:"2 Cores"},{label:"RAM",value:"6 GB"},{label:"Storage",value:"60 GB NVMe"}],quantity:3,buyUrl:"https://example.com/order/anniversary-s",tags:["bero","DE"],...input};}
async function api(req,res,url){const p=url.pathname.split("/").filter(Boolean);
  if(req.method==="GET"&&url.pathname==="/api/dashboard")return json(res,200,dashboard());
  if(req.method==="GET"&&url.pathname==="/api/providers")return json(res,200,store.listProviders());
  if(req.method==="GET"&&p[0]==="api"&&p[1]==="providers"&&p[2]&&p[3]==="plans")return json(res,200,store.listPlans(p[2]).filter(plan=>plan.listed!==false));
  if(req.method==="PATCH"&&p[0]==="api"&&p[1]==="providers"&&p[2]&&p[3]==="monitor"){
    const provider=store.getProvider(p[2]);if(!provider)return json(res,404,{error:"未找到商家"});
    try{const input=await body(req),existing=store.getMonitorByProvider(provider.id),now=new Date().toISOString();const monitor={...(existing||{}),...service.validateMonitor({...existing,...input,providerId:provider.id,planIds:input.selectedPlanIds||input.planIds||existing?.planIds},existing?.id),id:existing?.id||`monitor_${Date.now()}`,createdAt:existing?.createdAt||now,updatedAt:now,lastRunAt:existing?.lastRunAt||null,lastError:existing?.lastError||null};store.putMonitor(monitor);return json(res,200,service.monitorView(monitor));}catch(e){return json(res,400,{error:e.message});}}
  if(req.method==="GET"&&url.pathname==="/api/monitors")return json(res,200,store.listMonitors().map(service.monitorView));
  if(req.method==="POST"&&url.pathname==="/api/monitors"){try{const input=await body(req),now=new Date().toISOString(),monitor={...service.validateMonitor(input),id:`monitor_${Date.now()}`,createdAt:now,updatedAt:now,lastRunAt:null,lastError:null,consecutiveFailures:0};store.putMonitor(monitor);return json(res,201,service.monitorView(monitor));}catch(e){return json(res,400,{error:e.message});}}
  if(req.method==="PATCH"&&p[0]==="api"&&p[1]==="monitors"&&p[2]){const existing=store.getMonitor(p[2]);if(!existing)return json(res,404,{error:"未找到监控任务"});try{const input=await body(req),monitor={...existing,...service.validateMonitor({...existing,...input},existing.id),updatedAt:new Date().toISOString()};store.putMonitor(monitor);return json(res,200,service.monitorView(monitor));}catch(e){return json(res,400,{error:e.message});}}
  if(req.method==="POST"&&p[0]==="api"&&p[1]==="monitors"&&p[2]&&p[3]==="run"){const monitor=store.getMonitor(p[2]);if(!monitor)return json(res,404,{error:"未找到监控任务"});try{const out=await service.runMonitorSafe(monitor);return json(res,200,out);}catch(e){return json(res,400,{error:e.message});}}
  if(req.method==="DELETE"&&p[0]==="api"&&p[1]==="monitors"&&p[2]){if(!store.getMonitor(p[2]))return json(res,404,{error:"未找到监控任务"});store.deleteMonitor(p[2]);return json(res,204,{});}
  if(req.method==="GET"&&url.pathname==="/api/events")return json(res,200,eventPage(url));
  if(req.method==="PUT"&&url.pathname==="/api/activity/settings"){
    const input=await body(req),seconds=input.refreshIntervalSeconds;
    if(Object.keys(input).some(key=>key!=='refreshIntervalSeconds')||!Number.isInteger(seconds)||seconds<1||seconds>3600)return json(res,400,{error:'刷新间隔必须是 1–3600 秒的整数'});
    const settings=store.getSettings();settings.activity={...settings.activity,refreshIntervalSeconds:seconds};store.setSettings(settings);return json(res,200,settings.activity);
  }
  if(req.method==="GET"&&url.pathname==="/api/logs")return json(res,200,await serverLogs(url));
  if(req.method==="GET"&&url.pathname==="/api/settings")return json(res,200,maskedSettings());
  if(req.method==="PUT"&&url.pathname==="/api/settings"){try{const input=await body(req),settings=store.getSettings();settingsPatch(input,settings);store.setSettings(settings);return json(res,200,maskedSettings());}catch(e){return json(res,400,{error:e.message});}}
  if(req.method==="POST"&&url.pathname==="/api/telegram/preview"){const input=await body(req),settings=store.getSettings().telegram;return json(res,200,{text:formatCard(samplePlan(input.plan||{}),settings,["sold_out","stock_changed"].includes(input.status)?input.status:"restocked")});}
  if(req.method==="POST"&&url.pathname==="/api/telegram/preview/send"){try{const input=await body(req),status=["sold_out","stock_changed"].includes(input.status)?input.status:"restocked",t=store.getSettings().telegram,targets=telegramTargets(t);if(!targets.length)throw new Error('请先保存并开启至少一个 Telegram 通知目标');const text=formatCard(samplePlan(input.plan||{}),t,status),results=await Promise.all(targets.map(async target=>{try{await telegramCall(t,'sendMessage',{chat_id:target.chatId,text,parse_mode:'HTML',disable_web_page_preview:true});return {target:target.kind,ok:true};}catch(e){return {target:target.kind,ok:false,error:e.message};}}));if(results.every(result=>!result.ok))return json(res,400,{error:results.map(result=>result.error).join('；'),results});return json(res,200,{ok:results.every(result=>result.ok),results});}catch(e){return json(res,400,{error:e.message});}}
  if(req.method==="POST"&&url.pathname==="/api/telegram/test"){try{const input=await body(req),t=store.getSettings().telegram;if(input.target&&!['channel','personal'].includes(input.target))throw new Error('未知测试目标');const targets=telegramTargets(t).filter(target=>!input.target||target.kind===input.target);if(!targets.length)throw new Error('请先保存并开启对应通知目标');const results=await Promise.all(targets.map(async target=>{try{await telegramCall(t,'sendMessage',{chat_id:target.chatId,text:'✅ VPS Monitor Telegram 连通性测试成功',disable_web_page_preview:true});return {target:target.kind,ok:true}}catch(e){return {target:target.kind,ok:false,error:e.message}}}));if(results.every(result=>!result.ok))return json(res,400,{error:results.map(result=>result.error).join('；'),results});return json(res,200,{ok:results.every(result=>result.ok),results});}catch(e){return json(res,400,{error:e.message});}}

  if(req.method==="GET"&&url.pathname==="/api/updates/status")return json(res,200,await updateStatus());
  if(req.method==="GET"&&url.pathname==="/api/updates/progress")return json(res,200,updater.getStatus());
  if(req.method==="POST"&&url.pathname==="/api/updates/apply"){
    try{
      const input=await body(req),status=await updateStatus();
      if(!status.updateAvailable||!status.deployReady)return json(res,400,{error:status.message});
      if(input.targetVersion&&input.targetVersion!==status.remoteVersion||input.remoteRevision&&input.remoteRevision!==status.remoteRevision)return json(res,409,{error:"远端版本已变化，请重新检查并确认"});
      return json(res,202,await updater.start(status));
    }catch(e){return json(res,e.status||400,{error:e.message});}
  }
  return json(res,404,{error:"Not found"});
}
function mime(path){return ({".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".svg":"image/svg+xml",".json":"application/json; charset=utf-8"})[extname(path)]||"application/octet-stream";}
function staticFile(res,url){
  if(!existsSync(webDir)){json(res,503,{error:"前端尚未构建，请先执行 npm run build:web"});return;}
  const path=normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/ ,"").replace(/^[/\\]+/,"");
  let file=join(webDir,path||"index.html");
  if(!file.startsWith(webDir))return json(res,403,{error:"Forbidden"});
  if(!existsSync(file)){
    if(extname(path))return json(res,404,{error:"Not found"});
    file=join(webDir,"index.html");
  } else if(!extname(file) && file!==join(webDir,"index.html")) {
    file=join(webDir,"index.html");
  }
  try{res.writeHead(200,{"Content-Type":mime(file),"Cache-Control":file.endsWith("index.html")?"no-cache":"public, max-age=31536000, immutable"});res.end(readFileSync(file));}catch{json(res,404,{error:"Not found"});}
}
const server=createServer(async(req,res)=>{const url=new URL(req.url,`http://${req.headers.host||"localhost"}`);try{if(await auth.handle(req,res,url.pathname,body,json))return;if(url.pathname.startsWith("/api/")){if(req.method==="GET"&&url.pathname==="/api/public/catalog")return json(res,200,publicCatalog());if(req.method==="GET"&&url.pathname==="/api/public/events")return json(res,200,eventPage(url));if(req.method==="GET"&&url.pathname==="/api/public/activity-settings")return json(res,200,store.getSettings().activity);if(!auth.authorize(req))return json(res,401,{error:"请先登录"});if(!["GET","HEAD"].includes(req.method))auth.checkOrigin(req);await api(req,res,url);}else staticFile(res,url);}catch(e){console.error(`${req.method} ${url.pathname}:`,e.stack||e.message);if(!res.headersSent)json(res,e.status||500,{error:e.message||"Internal error"});else res.end();}});
server.listen(port,host,()=>console.log(`VPS Monitor API v${version} listening on http://${host}:${port}`));
const close=()=>{server.close(()=>{store.close();process.exit(0);});};process.on("SIGTERM",close);process.on("SIGINT",close);

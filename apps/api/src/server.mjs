import { createServer } from "node:http";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createDatabase } from "@vps-monitor/db";
import { createService, encryptToken, tokenKey, formatCard, telegramCall, repositoryMatches } from "@vps-monitor/core";

const host=process.env.HOST||"127.0.0.1",port=Number(process.env.PORT||4173),version="2.0.0";
const root=resolve(fileURLToPath(new URL("../../..",import.meta.url)));
const webDir=process.env.WEB_DIST_DIR?resolve(process.env.WEB_DIST_DIR):join(root,"apps/web/dist");
const store=createDatabase(process.env.DATA_DIR||join(root,"data"));
const service=createService(store);

function authorized(req,res){const password=process.env.ADMIN_PASSWORD;if(!password)return true;const expected=`Basic ${Buffer.from(`admin:${password}`).toString("base64")}`;if(req.headers.authorization===expected)return true;res.writeHead(401,{"WWW-Authenticate":'Basic realm="VPS Monitor", charset="UTF-8"'});res.end("Authentication required");return false;}
function json(res,status,value){res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});res.end(status===204?"":JSON.stringify(value));}
async function body(req){let raw="";for await(const c of req){raw+=c;if(raw.length>1_000_000)throw new Error("请求体过大");}return raw?JSON.parse(raw):{};}
function maskedSettings(){const settings=store.getSettings(),telegram={...settings.telegram,botTokenConfigured:Boolean(settings.telegram.botTokenEncrypted)};delete telegram.botTokenEncrypted;delete telegram.botToken;return {telegram,updates:settings.updates,security:{passwordProtected:Boolean(process.env.ADMIN_PASSWORD),tokenEncryptionConfigured:Boolean(tokenKey())}};}
function dashboard(){const providers=store.listProviders(),monitors=store.listMonitors(),plans=store.listPlans(),enabled=monitors.filter(m=>m.enabled);return {stats:{providers:providers.length,monitoredProviders:new Set(enabled.map(m=>m.providerId)).size,monitoredPlans:enabled.reduce((sum,m)=>sum+(m.scope==="all"?plans.filter(p=>p.providerId===m.providerId).length:m.planIds.length),0),inStock:plans.filter(p=>p.available).length},version,providers,monitors:monitors.map(service.monitorView),runtime:{...store.getRuntime(),pendingNotifications:store.listNotifications().length},events:store.listEvents(12)};}
function git(args){return execFileSync("git",args,{cwd:root,encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();}
function updateStatus(){const settings=store.getSettings().updates,base={configured:Boolean(settings.repository),repository:settings.repository,branch:settings.branch,localRevision:null,remoteRevision:null,updateAvailable:false,deployReady:false,message:"尚未配置 GitHub 更新源。"};if(!settings.repository)return base;try{const localRevision=git(["rev-parse","HEAD"]),dirty=git(["status","--porcelain"]),originUrl=git(["remote","get-url","origin"]);if(!repositoryMatches(settings.repository,originUrl))return {...base,localRevision,message:"设置页的 GitHub 仓库与本地 origin 不一致，已拒绝在线更新。"};if(dirty)return {...base,localRevision,message:"工作目录有未提交修改，不能在线更新。"};const remoteRevision=git(["ls-remote","origin",`refs/heads/${settings.branch}`]).split(/\s+/)[0]||null;return {...base,localRevision,remoteRevision,updateAvailable:Boolean(remoteRevision&&remoteRevision!==localRevision),deployReady:true,message:remoteRevision&&remoteRevision!==localRevision?"发现新版本，可以在线更新。":"已是最新版本。"};}catch(error){const detail=error.stderr?.trim()||error.message;return {...base,message:`无法检查更新：${detail}`};}}
function samplePlan(input={}){return {name:"Anniversary S Ryzen VPS",price:"€39.00",billingCycle:"year",location:"DE · Frankfurt",specs:"2C / 6GB / 60GB",quantity:3,buyUrl:"https://example.com",tags:["bero","DE"],...input};}
async function api(req,res,url){const p=url.pathname.split("/").filter(Boolean);
  if(req.method==="GET"&&url.pathname==="/api/dashboard")return json(res,200,dashboard());
  if(req.method==="GET"&&url.pathname==="/api/providers")return json(res,200,store.listProviders());
  if(req.method==="GET"&&p[0]==="api"&&p[1]==="providers"&&p[2]&&p[3]==="plans")return json(res,200,store.listPlans(p[2]));
  if(req.method==="PATCH"&&p[0]==="api"&&p[1]==="providers"&&p[2]&&p[3]==="monitor"){
    const provider=store.getProvider(p[2]);if(!provider)return json(res,404,{error:"未找到商家"});
    try{const input=await body(req),existing=store.getMonitorByProvider(provider.id),now=new Date().toISOString();const monitor={...(existing||{}),...service.validateMonitor({...input,providerId:provider.id,planIds:input.selectedPlanIds||input.planIds},existing?.id),id:existing?.id||`monitor_${Date.now()}`,createdAt:existing?.createdAt||now,updatedAt:now,lastRunAt:existing?.lastRunAt||null,lastError:existing?.lastError||null};store.putMonitor(monitor);return json(res,200,service.monitorView(monitor));}catch(e){return json(res,400,{error:e.message});}}
  if(req.method==="GET"&&url.pathname==="/api/monitors")return json(res,200,store.listMonitors().map(service.monitorView));
  if(req.method==="POST"&&url.pathname==="/api/monitors"){try{const input=await body(req),now=new Date().toISOString(),monitor={...service.validateMonitor(input),id:`monitor_${Date.now()}`,createdAt:now,updatedAt:now,lastRunAt:null,lastError:null,consecutiveFailures:0};store.putMonitor(monitor);return json(res,201,service.monitorView(monitor));}catch(e){return json(res,400,{error:e.message});}}
  if(req.method==="PATCH"&&p[0]==="api"&&p[1]==="monitors"&&p[2]){const existing=store.getMonitor(p[2]);if(!existing)return json(res,404,{error:"未找到监控任务"});try{const input=await body(req),monitor={...existing,...service.validateMonitor({...existing,...input},existing.id),updatedAt:new Date().toISOString()};store.putMonitor(monitor);return json(res,200,service.monitorView(monitor));}catch(e){return json(res,400,{error:e.message});}}
  if(req.method==="POST"&&p[0]==="api"&&p[1]==="monitors"&&p[2]&&p[3]==="run"){const monitor=store.getMonitor(p[2]);if(!monitor)return json(res,404,{error:"未找到监控任务"});try{const out=await service.runMonitorSafe(monitor);await service.deliverNotifications();return json(res,200,out);}catch(e){return json(res,400,{error:e.message});}}
  if(req.method==="DELETE"&&p[0]==="api"&&p[1]==="monitors"&&p[2]){if(!store.getMonitor(p[2]))return json(res,404,{error:"未找到监控任务"});store.deleteMonitor(p[2]);return json(res,204,{});}
  if(req.method==="GET"&&url.pathname==="/api/events")return json(res,200,store.listEvents());
  if(req.method==="GET"&&url.pathname==="/api/settings")return json(res,200,maskedSettings());
  if(req.method==="PUT"&&url.pathname==="/api/settings"){try{const input=await body(req),settings=store.getSettings();if(input.telegram){const t={...settings.telegram,...input.telegram};if(input.telegram.botToken)t.botTokenEncrypted=encryptToken(input.telegram.botToken);delete t.botToken;delete t.botTokenConfigured;settings.telegram=t;}if(input.updates)settings.updates={...settings.updates,...input.updates};store.setSettings(settings);return json(res,200,maskedSettings());}catch(e){return json(res,400,{error:e.message});}}
  if(req.method==="POST"&&url.pathname==="/api/telegram/preview"){const input=await body(req),settings=store.getSettings().telegram;return json(res,200,{text:formatCard(samplePlan(input.plan||{}),settings,input.status==="sold_out"?"sold_out":"restocked")});}
  if(req.method==="POST"&&url.pathname==="/api/telegram/test"){try{const t=store.getSettings().telegram;if(!t.chatId)throw new Error("请先填写频道 Chat ID");await telegramCall(t,"sendMessage",{chat_id:t.chatId,text:"✅ VPS Monitor Telegram 连通性测试成功",disable_web_page_preview:true});return json(res,200,{ok:true});}catch(e){return json(res,400,{error:e.message});}}
  if(req.method==="GET"&&url.pathname==="/api/updates/status")return json(res,200,updateStatus());
  if(req.method==="POST"&&url.pathname==="/api/updates/apply"){const status=updateStatus();if(!status.deployReady)return json(res,400,{error:status.message});if(!status.updateAvailable)return json(res,200,{message:"已是最新版本。"});try{git(["fetch","origin",store.getSettings().updates.branch]);git(["merge","--ff-only",`origin/${store.getSettings().updates.branch}`]);execFileSync("npm",["install"],{cwd:root,stdio:"pipe"});execFileSync("npm",["run","build:web"],{cwd:root,stdio:"pipe"});const dataDir=resolve(process.env.DATA_DIR||join(root,"data"));writeFileSync(join(dataDir,".restart-worker"),String(Date.now()));json(res,200,{message:"更新与前端构建已完成，服务即将重启。"});setTimeout(()=>process.exit(0),200);return;}catch(e){return json(res,400,{error:e.stderr?.trim()||e.message});}}
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
const server=createServer(async(req,res)=>{if(!authorized(req,res))return;const url=new URL(req.url,`http://${req.headers.host||"localhost"}`);try{if(url.pathname.startsWith("/api/"))await api(req,res,url);else staticFile(res,url);}catch(e){console.error(e);if(!res.headersSent)json(res,500,{error:e.message||"Internal error"});else res.end();}});
server.listen(port,host,()=>console.log(`VPS Monitor API v${version} listening on http://${host}:${port}`));
const close=()=>{server.close(()=>{store.close();process.exit(0);});};process.on("SIGTERM",close);process.on("SIGINT",close);

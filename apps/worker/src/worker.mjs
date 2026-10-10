import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createDatabase } from "@vps-monitor/db";
import { createService, bootstrapProviders, createBotManagement } from "@vps-monitor/core";
const dataDir=resolve(process.env.DATA_DIR||"./data"),restartMarker=join(dataDir,".restart-worker");
const maintenance=join(dataDir,'.update-in-progress'),paused=join(dataDir,'.worker-paused');
while(existsSync(maintenance))await new Promise(r=>setTimeout(r,500));
const store=createDatabase(dataDir);bootstrapProviders(store);
const service=createService(store),tickMs=Math.max(500,Number(process.env.WORKER_TICK_MS||1000)),catalogIntervalMs=120_000;
let busy=false,stopping=false,timer,heartbeatTimer,botBusy=false;const catalogRunning=new Set(),monitorRunning=new Set();
const bot=createBotManagement(store,service);
async function pollBot(){if(stopping||existsSync(maintenance))return;botBusy=true;try{await bot.poll()}catch(e){console.error("bot management failed",e.message)}finally{botBusy=false;if(!stopping)setTimeout(pollBot,1000)}}
pollBot();
heartbeatTimer=setInterval(()=>{if(stopping)return;const runtime=store.getRuntime();runtime.lastTickAt=new Date().toISOString();store.setRuntime(runtime)},Math.min(tickMs,5000));
async function tick(){if(existsSync(maintenance))return close();if(existsSync(restartMarker)){try{unlinkSync(restartMarker)}catch{};return close()}if(busy||stopping)return;busy=true;try{const now=Date.now(),runtime=store.getRuntime();runtime.lastTickAt=new Date().toISOString();store.setRuntime(runtime);const monitors=store.listMonitors(),monitoredProviderIds=new Set(monitors.map(m=>m.providerId));for(const provider of store.listProviders()){if(stopping||monitoredProviderIds.has(provider.id)||catalogRunning.has(provider.id))continue;const lastAttempt=Date.parse(provider.catalogLastAttemptAt||0);if(Number.isFinite(lastAttempt)&&now-lastAttempt<catalogIntervalMs)continue;catalogRunning.add(provider.id);void service.refreshProviderCatalog(provider.id).catch(error=>console.error(`[catalog] ${provider.name}: ${error.message}`)).finally(()=>catalogRunning.delete(provider.id));}for(const monitor of monitors.filter(m=>m.enabled)){if(stopping||monitorRunning.has(monitor.id))continue;if(monitor.lastRunAt&&now-Date.parse(monitor.lastRunAt)<monitor.intervalSeconds*1000)continue;monitorRunning.add(monitor.id);void service.runMonitorSafe(monitor).catch(()=>{}).finally(()=>monitorRunning.delete(monitor.id));}if(!stopping)await service.deliverNotifications();}catch(e){console.error("worker tick failed",e);}finally{busy=false;}}
console.log(`VPS Monitor worker started, tick=${tickMs}ms`);process.on("SIGTERM",close);process.on("SIGINT",close);await tick();if(!stopping)timer=setInterval(tick,tickMs);
async function close(){if(stopping)return;stopping=true;clearInterval(timer);clearInterval(heartbeatTimer);while(busy||botBusy||catalogRunning.size||monitorRunning.size)await new Promise(r=>setTimeout(r,20));store.close();if(existsSync(maintenance))writeFileSync(paused,String(Date.now()));process.exit(0);}

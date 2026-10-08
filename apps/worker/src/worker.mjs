import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createDatabase } from "@vps-monitor/db";
import { createService, bootstrapProviders, createBotManagement } from "@vps-monitor/core";
const dataDir=resolve(process.env.DATA_DIR||"./data"),restartMarker=join(dataDir,".restart-worker");
const maintenance=join(dataDir,'.update-in-progress'),paused=join(dataDir,'.worker-paused');
while(existsSync(maintenance))await new Promise(r=>setTimeout(r,500));
const store=createDatabase(dataDir);bootstrapProviders(store);
const service=createService(store),tickMs=Math.max(500,Number(process.env.WORKER_TICK_MS||1000));
let busy=false,stopping=false,timer,heartbeatTimer,botBusy=false;
const bot=createBotManagement(store,service);
async function pollBot(){if(stopping||existsSync(maintenance))return;botBusy=true;try{await bot.poll()}catch(e){console.error("bot management failed",e.message)}finally{botBusy=false;if(!stopping)setTimeout(pollBot,1000)}}
pollBot();
heartbeatTimer=setInterval(()=>{if(stopping)return;const runtime=store.getRuntime();runtime.lastTickAt=new Date().toISOString();store.setRuntime(runtime)},Math.min(tickMs,5000));
async function tick(){if(existsSync(maintenance))return close();if(existsSync(restartMarker)){try{unlinkSync(restartMarker)}catch{};return close()}if(busy||stopping)return;busy=true;try{const now=Date.now(),runtime=store.getRuntime();runtime.lastTickAt=new Date().toISOString();store.setRuntime(runtime);for(const monitor of store.listMonitors().filter(m=>m.enabled)){if(stopping)break;if(monitor.lastRunAt&&now-Date.parse(monitor.lastRunAt)<monitor.intervalSeconds*1000)continue;try{await service.runMonitorSafe(monitor);}catch{}}if(!stopping)await service.deliverNotifications();}catch(e){console.error("worker tick failed",e);}finally{busy=false;}}
console.log(`VPS Monitor worker started, tick=${tickMs}ms`);process.on("SIGTERM",close);process.on("SIGINT",close);await tick();if(!stopping)timer=setInterval(tick,tickMs);
async function close(){if(stopping)return;stopping=true;clearInterval(timer);clearInterval(heartbeatTimer);while(busy||botBusy)await new Promise(r=>setTimeout(r,20));store.close();if(existsSync(maintenance))writeFileSync(paused,String(Date.now()));process.exit(0);}

import { existsSync, unlinkSync } from "node:fs";
import { resolve, join } from "node:path";
import { createDatabase } from "@vps-monitor/db";
import { createService } from "@vps-monitor/core";
const dataDir=resolve(process.env.DATA_DIR||"./data"),restartMarker=join(dataDir,".restart-worker");
const store=createDatabase(dataDir),service=createService(store),tickMs=Math.max(500,Number(process.env.WORKER_TICK_MS||1000));
let busy=false,stopping=false;
async function tick(){if(existsSync(restartMarker)){try{unlinkSync(restartMarker)}catch{};return close()}if(busy||stopping)return;busy=true;try{const now=Date.now(),runtime=store.getRuntime();runtime.lastTickAt=new Date().toISOString();store.setRuntime(runtime);for(const monitor of store.listMonitors().filter(m=>m.enabled)){if(monitor.lastRunAt&&now-Date.parse(monitor.lastRunAt)<monitor.intervalSeconds*1000)continue;try{await service.runMonitorSafe(monitor);}catch{}}await service.deliverNotifications();}catch(e){console.error("worker tick failed",e);}finally{busy=false;}}
console.log(`VPS Monitor worker started, tick=${tickMs}ms`);await tick();const timer=setInterval(tick,tickMs);
async function close(){stopping=true;clearInterval(timer);while(busy)await new Promise(r=>setTimeout(r,20));store.close();process.exit(0);}process.on("SIGTERM",close);process.on("SIGINT",close);

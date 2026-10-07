import { getAdapter } from "@vps-monitor/adapters";
import { normalizePlan, reconcilePlan, nextRetry } from "./monitor-engine.mjs";
import { formatCard, telegramCall } from "./telegram.mjs";

export function createService(store) {
  const addEvent = (type,message,extra={}) => store.addEvent({id:`event_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,at:new Date().toISOString(),type,message,...extra});
  function monitorView(monitor) {
    const provider=store.getProvider(monitor.providerId);
    return {...monitor,providerName:provider?.name||"已移除商家",providerAdapterKey:provider?.adapterKey||"unknown",planCount:monitor.scope==="all"?store.listPlans(monitor.providerId).length:monitor.planIds.length};
  }
  function validateMonitor(input, existingId=null) {
    const provider=store.getProvider(input.providerId); if(!provider) throw new Error("请选择已接入的商家");
    const same=store.getMonitorByProvider(provider.id); if(same && same.id!==existingId) throw new Error("该商家已有监控任务，请直接编辑现有任务");
    const scope=input.scope==="selected"?"selected":"all";
    const planIds=[...new Set(Array.isArray(input.planIds)?input.planIds.filter(id=>typeof id==="string"):[])];
    const valid=new Set(store.listPlans(provider.id).map(p=>p.id)); if(planIds.some(id=>!valid.has(id))) throw new Error("包含不属于该商家的套餐");
    if(scope==="selected"&&!planIds.length) throw new Error("请选择至少一个套餐，或改为监控全部套餐");
    return {providerId:provider.id,scope,planIds,intervalSeconds:Math.max(30,Math.min(3600,Number(input.intervalSeconds)||60)),enabled:Boolean(input.enabled)};
  }
  function enqueue(action, plan) {
    const t=store.getSettings().telegram;
    if(!t.enabled||!t.chatId||!t.botTokenEncrypted){addEvent("notification_skipped",`${plan.name}：通知未配置，已记录状态变化`,{providerId:plan.providerId,planId:plan.id});return;}
    const job={id:`job_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,action,planId:plan.id,attempts:0,nextAttemptAt:new Date().toISOString(),createdAt:new Date().toISOString(),lastError:null};store.putNotification(job);
  }
  async function deliverNotifications(){
    const now=Date.now(), settings=store.getSettings().telegram;
    for(const job of store.listNotifications()){
      if(Date.parse(job.nextAttemptAt)>now) continue;
      const plan=store.getPlan(job.planId); if(!plan){store.deleteNotification(job.id);continue;}
      try{
        if(job.action==="restocked") { const result=await telegramCall(settings,"sendMessage",{chat_id:settings.chatId,text:formatCard(plan,settings,"restocked"),parse_mode:"HTML",disable_web_page_preview:true}); plan.notification={chatId:String(settings.chatId),messageId:result.message_id,sentAt:new Date().toISOString()};store.putPlan(plan);addEvent("telegram_sent",`${plan.name}：已发送补货卡片`,{providerId:plan.providerId,planId:plan.id}); }
        else if(job.action==="sold_out"&&plan.notification?.messageId){await telegramCall(settings,"editMessageText",{chat_id:plan.notification.chatId,message_id:plan.notification.messageId,text:formatCard(plan,settings,"sold_out"),parse_mode:"HTML",disable_web_page_preview:true});addEvent("telegram_edited",`${plan.name}：已编辑为售罄`,{providerId:plan.providerId,planId:plan.id});}
        else if(job.action==="stock_changed"&&plan.notification?.messageId){await telegramCall(settings,"editMessageText",{chat_id:plan.notification.chatId,message_id:plan.notification.messageId,text:formatCard(plan,settings,"restocked"),parse_mode:"HTML",disable_web_page_preview:true});addEvent("telegram_edited",`${plan.name}：已更新库存卡片`,{providerId:plan.providerId,planId:plan.id});}
        store.deleteNotification(job.id);
      }catch(error){job.attempts+=1;job.lastError=error.message;job.nextAttemptAt=error.retryAfter?new Date(now+Number(error.retryAfter)*1000).toISOString():nextRetry(job.attempts,now);store.putNotification(job);addEvent("telegram_failed",`${plan.name}：TG 投递失败，将重试`,{providerId:plan.providerId,planId:plan.id,error:error.message});}
    }
  }
  async function runMonitor(monitor){
    const provider=store.getProvider(monitor.providerId),started=Date.now(); if(!provider) throw new Error("商家不存在");
    const adapter=getAdapter(provider.adapterKey); if(!adapter) throw new Error(`Adapter ${provider.adapterKey} 尚未安装`);
    const discovered=await adapter.discover({provider}); if(!Array.isArray(discovered)) throw new Error("Adapter discover() 必须返回套餐数组");
    const current=discovered.map(plan=>normalizePlan(plan,provider.id));
    for(const plan of current){const result=reconcilePlan(store.getPlan(plan.id),plan,monitor);store.putPlan(result.next);if(result.action){addEvent(result.action,`${plan.name}：${result.reason}`,{providerId:provider.id,planId:plan.id});enqueue(result.action,result.next);}}
    monitor.lastRunAt=new Date().toISOString();monitor.lastDurationMs=Date.now()-started;monitor.lastError=null;monitor.consecutiveFailures=0;store.putMonitor(monitor);addEvent("monitor_succeeded",`${provider.name}：探测到 ${current.length} 个套餐`,{providerId:provider.id});return monitorView(monitor);
  }
  async function runMonitorSafe(monitor){try{return await runMonitor(monitor);}catch(error){monitor.lastRunAt=new Date().toISOString();monitor.lastDurationMs=0;monitor.lastError=error.message;monitor.consecutiveFailures=(monitor.consecutiveFailures||0)+1;store.putMonitor(monitor);addEvent("monitor_failed",`${monitorView(monitor).providerName}：${error.message}`,{providerId:monitor.providerId,error:error.message});throw error;}}
  return {addEvent,monitorView,validateMonitor,deliverNotifications,runMonitor,runMonitorSafe};
}

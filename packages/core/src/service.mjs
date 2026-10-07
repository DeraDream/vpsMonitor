import { randomUUID } from "node:crypto";
import { getAdapter } from "@vps-monitor/adapters";
import { normalizePlan, reconcilePlan, nextRetry } from "./monitor-engine.mjs";
import { formatCard, telegramCall } from "./telegram.mjs";

export function createService(store) {
  const addEvent = (type,message,extra={}) => store.addEvent({id:`event_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,at:new Date().toISOString(),type,message,...extra});
  function monitorView(monitor) {
    const provider=store.getProvider(monitor.providerId);
    return {...monitor,providerName:provider?.name||"已移除商家",providerAdapterKey:provider?.adapterKey||"unknown",planCount:monitor.scope==="all"?store.listPlans(monitor.providerId).filter(p=>p.listed!==false).length:monitor.planIds.length,categories:(provider?.categories||[]).map(category=>{const plans=store.listPlans(monitor.providerId).filter(p=>p.listed!==false&&p.categoryId===category.id);return {...category,...monitor.categoryStatuses?.[category.id],planCount:plans.length,inStock:plans.filter(p=>p.available).length}})};
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
  function enqueue(action, plan, monitor) {
    const t=store.getSettings().telegram;
    if(!t.enabled||!t.chatId||!t.botTokenEncrypted){addEvent("notification_skipped",`${plan.name}：通知未配置，已记录状态变化`,{providerId:plan.providerId,planId:plan.id});return;}
    const job={id:`job_${randomUUID()}`,action,planId:plan.id,monitorId:monitor.id,cycleId:plan.notificationCycle,snapshot:plan,target:plan.notification,attempts:0,nextAttemptAt:new Date().toISOString(),createdAt:new Date().toISOString(),lastError:null};store.putNotification(job);
  }
  async function deliverNotifications(){
    for(const listed of store.listNotifications()){
      const now=Date.now();if(Date.parse(listed.nextAttemptAt)>now)continue;
      const owner=randomUUID();if(!store.claimNotification(listed.id,owner,now))continue;
      try{
        const job=store.getNotification(listed.id);
        if(!job)continue;
        const settings=store.getSettings().telegram;
        // Disabling notifications pauses the queue without losing its retry state.
        if(!settings.enabled||!settings.chatId||!settings.botTokenEncrypted)continue;
        const plan=store.getPlan(job.planId);
        const monitor=job.monitorId?store.getMonitor(job.monitorId):plan&&store.getMonitorByProvider(plan.providerId);
        if(!plan||plan.listed===false||!monitor){store.finishNotification(job.id,owner);continue;}
        if(!monitor.enabled)continue;
        if(monitor.categoryStatuses?.[plan.categoryId]?.lastError)continue;
        const sameCycle=!job.cycleId||job.cycleId===plan.notificationCycle;
        const target=job.target||plan.notification;
        if((job.action==="restocked"&&(!sameCycle||!plan.available||plan.notification?.messageId))||
           (job.action==="stock_changed"&&(!sameCycle||!plan.available))){store.finishNotification(job.id,owner);continue;}
        try{
          if(job.action==="restocked") {
            const result=await telegramCall(settings,"sendMessage",{chat_id:settings.chatId,text:formatCard(plan,settings,"restocked"),parse_mode:"HTML",disable_web_page_preview:true});
            // A probe may have changed stock while the network request was in flight.
            store.transaction(()=>{
              const latest=store.getPlan(plan.id),active=store.getMonitor(monitor.id);
              const notification={chatId:String(settings.chatId),messageId:result.message_id,sentAt:new Date().toISOString()};
              if(latest&&latest.notificationCycle===plan.notificationCycle){latest.notification=notification;store.putPlan(latest);}
              if(active&&latest&&(!latest.available||latest.notificationCycle!==plan.notificationCycle)){
                enqueue("sold_out",{...plan,available:false,quantity:0,notification},active);
              }else if(active&&latest&&latest.quantity!==plan.quantity){enqueue("stock_changed",{...latest,notification},active);}
            });
            addEvent("telegram_sent",`${plan.name}：已发送补货卡片`,{providerId:plan.providerId,planId:plan.id});
          }else if(target?.messageId){
            const soldOut=job.action==="sold_out",card=soldOut?(job.snapshot||plan):plan;
            await telegramCall(settings,"editMessageText",{chat_id:target.chatId,message_id:target.messageId,text:formatCard(card,settings,soldOut?"sold_out":"restocked"),parse_mode:"HTML",disable_web_page_preview:true});
            addEvent("telegram_edited",`${plan.name}：${soldOut?"已编辑为售罄":"已更新库存卡片"}`,{providerId:plan.providerId,planId:plan.id});
          }
          store.finishNotification(job.id,owner);
        }catch(error){
          if(error.permanent){store.finishNotification(job.id,owner);addEvent("telegram_failed",`${plan.name}：TG 永久错误，已停止重试`,{planId:plan.id,error:error.message});continue;}
          job.attempts+=1;job.lastError=error.message;job.nextAttemptAt=error.retryAfter?new Date(Date.now()+Number(error.retryAfter)*1000).toISOString():nextRetry(job.attempts);
          store.finishNotification(job.id,owner,job);addEvent("telegram_failed",`${plan.name}：TG 投递失败，将重试`,{providerId:plan.providerId,planId:plan.id,error:error.message});
        }
      }finally{store.releaseNotification(listed.id,owner);}
    }
  }
  async function runMonitor(monitor){
    const provider=store.getProvider(monitor.providerId),started=Date.now(); if(!provider) throw new Error("商家不存在");
    const adapter=getAdapter(provider.adapterKey); if(!adapter) throw new Error(`Adapter ${provider.adapterKey} 尚未安装`);
    const discovered=await adapter.discover({provider});
    const batch=Array.isArray(discovered)?{plans:discovered,completedCategories:[],failures:[]}:discovered;
    if(!batch||!Array.isArray(batch.plans)||!Array.isArray(batch.completedCategories)||!Array.isArray(batch.failures))throw new Error("Adapter discover() 必须返回套餐数组或完整探测结果");
    const current=batch.plans.map(plan=>normalizePlan(plan,provider.id));
    return store.transaction(()=>{
      const active=store.getMonitor(monitor.id);if(!active)throw new Error("监控任务已删除");
      const observedAt=new Date().toISOString();
      // Only complete, successfully parsed pages may change their visible listing.
      const present=new Set(current.map(plan=>plan.id));
      for(const previous of store.listPlans(provider.id)){
        if(batch.completedCategories.includes(previous.categoryId)&&!present.has(previous.id))store.putPlan({...previous,listed:false,listingCheckedAt:observedAt});
      }
      active.categoryStatuses={...active.categoryStatuses};
      for(const categoryId of batch.completedCategories)active.categoryStatuses[categoryId]={lastSuccessAt:observedAt,lastAttemptAt:observedAt,lastError:null};
      for(const failure of batch.failures){active.categoryStatuses[failure.categoryId]={...active.categoryStatuses[failure.categoryId],lastAttemptAt:observedAt,lastError:failure.error};addEvent("monitor_category_failed",`${provider.name} · ${failure.categoryName}：${failure.error}`,{providerId:provider.id,categoryId:failure.categoryId});}
      for(const plan of current){
        const result=reconcilePlan(store.getPlan(plan.id),plan,active);
        if(result.action==="restocked")result.next.notificationCycle=randomUUID();
        result.next.observedAt=observedAt;store.putPlan(result.next);
        if(result.action){addEvent(result.action,`${plan.name}：${result.reason}`,{providerId:provider.id,planId:plan.id});enqueue(result.action,result.next,active);}
      }
      active.lastRunAt=new Date().toISOString();active.lastDurationMs=Date.now()-started;active.lastError=batch.failures.length?batch.failures.map(f=>`${f.categoryName}：${f.error}`).join("；"):null;active.consecutiveFailures=batch.failures.length?(active.consecutiveFailures||0)+1:0;store.putMonitor(active);
      addEvent(batch.failures.length?"monitor_partial":"monitor_succeeded",`${provider.name}：探测到 ${current.length} 个套餐${batch.failures.length?"，部分系列失败，保留上次状态":""}`,{providerId:provider.id});return monitorView(active);
    });
  }
  async function runMonitorSafe(monitor){try{return await runMonitor(monitor);}catch(error){const active=store.getMonitor(monitor.id);if(!active)throw error;monitor=active;monitor.lastRunAt=new Date().toISOString();monitor.lastDurationMs=0;monitor.lastError=error.message;monitor.consecutiveFailures=(monitor.consecutiveFailures||0)+1;for(const failure of error.failures||[]){monitor.categoryStatuses={...monitor.categoryStatuses,[failure.categoryId]:{...monitor.categoryStatuses?.[failure.categoryId],lastAttemptAt:monitor.lastRunAt,lastError:failure.error}};}store.putMonitor(monitor);addEvent("monitor_failed",`${monitorView(monitor).providerName}：${error.message}`,{providerId:monitor.providerId,error:error.message});throw error;}}
  return {addEvent,monitorView,validateMonitor,deliverNotifications,runMonitor,runMonitorSafe};
}

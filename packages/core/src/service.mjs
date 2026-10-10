import { randomUUID } from "node:crypto";
import { getAdapter } from "@vps-monitor/adapters";
import { normalizePlan, reconcilePlan, nextRetry, monitored } from "./monitor-engine.mjs";
import { formatCard, telegramCall, telegramTargets } from "./telegram.mjs";

export function createService(store, {now: notificationNow=Date.now}={}) {
  const snapshot=plan=>Object.fromEntries(["name","price","billingCycle","specs","location","quantity","available","buyUrl","categoryName","cpu","ram","storage","bandwidth","portSpeed"].filter(key=>plan[key]!==undefined).map(key=>[key,plan[key]]));
  const notificationCard=(plan,settings,status)=>formatCard({...plan,providerName:store.getProvider(plan.providerId)?.name||plan.providerName},settings,status);
  const addEvent = (type,message,extra={}) => { if(!["new_plan","restocked","sold_out","stock_changed","delisted"].includes(type))( /failed|partial/.test(type)?console.error:console.log)(`[${type}] ${message}${extra.error?" — "+extra.error:""}`);return store.addEvent({id:`event_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,at:new Date().toISOString(),type,message,...extra}); };
  function monitorView(monitor) {
    const provider=store.getProvider(monitor.providerId);
    return {...monitor,providerName:provider?.name||"已移除商家",providerAdapterKey:provider?.adapterKey||"unknown",planCount:store.listPlans(monitor.providerId).filter(p=>p.listed!==false&&monitored(p,monitor)).length,categories:(provider?.categories||[]).map(category=>{const plans=store.listPlans(monitor.providerId).filter(p=>p.listed!==false&&p.categoryId===category.id);return {...category,...monitor.categoryStatuses?.[category.id],planCount:plans.length,inStock:plans.filter(p=>p.available&&p.availabilitySource!=="order-button").length,orderable:plans.filter(p=>p.available&&p.availabilitySource==="order-button").length}})};
  }
  function validateMonitor(input, existingId=null) {
    const provider=store.getProvider(input.providerId); if(!provider) throw new Error("请选择已接入的商家");
    const same=store.getMonitorByProvider(provider.id); if(same && same.id!==existingId) throw new Error("该商家已有监控任务，请直接编辑现有任务");
    const scope=["selected","categories"].includes(input.scope)?input.scope:"all";
    const categoryIds=[...new Set(Array.isArray(input.categoryIds)?input.categoryIds.filter(id=>typeof id==="string"):[])];
    const categorySet=new Set((provider.categories||[]).map(category=>category.id));
    if(scope==="categories"&&(!categoryIds.length||categoryIds.some(id=>!categorySet.has(id))))throw new Error("请选择该商家的有效分类");
    const planIds=[...new Set(Array.isArray(input.planIds)?input.planIds.filter(id=>typeof id==="string"):[])];
    const valid=new Set(store.listPlans(provider.id).map(p=>p.id)); if(planIds.some(id=>!valid.has(id))) throw new Error("包含不属于该商家的套餐");
    if(scope==="selected"&&!planIds.length) throw new Error("请选择至少一个套餐，或改为监控全部套餐");
    const requestedInterval=input.intervalSeconds??provider.defaultIntervalSeconds??60;
    if(requestedInterval===''||!Number.isInteger(Number(requestedInterval))||Number(requestedInterval)<=0)throw new Error('轮询间隔必须为正整数秒数');
    return {providerId:provider.id,scope,planIds,categoryIds,intervalSeconds:Math.min(3600,Number(requestedInterval)),enabled:Boolean(input.enabled)};
  }
  function enqueue(action, plan, monitor, onlyRecipient=null) {
    const t=store.getSettings().telegram;
    if(!t.enabled||!telegramTargets(t).length||!t.botTokenEncrypted){addEvent("notification_skipped",`${plan.name}：通知未配置，已记录状态变化`,{providerId:plan.providerId,planId:plan.id});return;}
    for(const recipient of onlyRecipient?[onlyRecipient]:telegramTargets(t)){
    const job={recipientChatId:recipient.chatId,recipientKind:recipient.kind,id:`job_${randomUUID()}`,action,deliveryMode:t.notificationMode||"restock",planId:plan.id,monitorId:monitor.id,cycleId:plan.notificationCycle,snapshot:plan,target:plan.notifications?.[recipient.chatId]||(String(plan.notification?.chatId)===recipient.chatId?plan.notification:null),attempts:0,nextAttemptAt:new Date().toISOString(),createdAt:new Date().toISOString(),lastError:null};store.putNotification(job);
    }
  }
  async function deliverNotifications(){
    for(const listed of store.listNotifications()){
      const now=notificationNow();if(Date.parse(listed.nextAttemptAt)>now)continue;
      const owner=randomUUID();if(!store.claimNotification(listed.id,owner,now))continue;
      try{
        const job=store.getNotification(listed.id);
        if(!job)continue;
        const settings=store.getSettings().telegram;
        // Disabling notifications pauses the queue without losing its retry state.
        if(!settings.enabled||!telegramTargets(settings).length||!settings.botTokenEncrypted)continue;
        const recipients=telegramTargets(settings);
        if(!job.recipientChatId&&recipients.length>1){store.transaction(()=>{for(const recipient of recipients)store.putNotification({...job,id:`job_${randomUUID()}`,recipientChatId:recipient.chatId,recipientKind:recipient.kind,target:String(job.target?.chatId)===recipient.chatId?job.target:null});store.deleteNotification(job.id)});continue;}
        const recipient=job.recipientChatId?recipients.find(target=>target.chatId===job.recipientChatId):recipients[0];
        if(!recipient){store.finishNotification(job.id,owner);continue;}
        const chatId=recipient.chatId;
        const plan=store.getPlan(job.planId);
        const monitor=job.monitorId?store.getMonitor(job.monitorId):plan&&store.getMonitorByProvider(plan.providerId);
        if(!plan||plan.listed===false||!monitor){store.finishNotification(job.id,owner);continue;}
        if(!monitor.enabled)continue;
        if(job.action==="new_plan"&&!settings.notifyNewPlans){store.finishNotification(job.id,owner);continue;}
        if(job.action!=="new_plan"&&!monitored(plan,monitor)){store.finishNotification(job.id,owner);continue;}
        if(monitor.categoryStatuses?.[plan.categoryId]?.lastError)continue;
        const allChanges=job.deliveryMode==="all"&&settings.notificationMode==="all";
        if(job.deliveryMode==="all"&&!allChanges&&job.action!=="restocked"&&job.action!=="new_plan"){store.finishNotification(job.id,owner);continue;}
        const sameCycle=!job.cycleId||job.cycleId===plan.notificationCycle;
        const target=(String(job.target?.chatId)===chatId?job.target:null)||plan.notifications?.[chatId]||(String(plan.notification?.chatId)===chatId?plan.notification:null);
        if(!allChanges&&((job.action==="restocked"&&(!sameCycle||!plan.available||target?.messageId))||
           (job.action==="stock_changed"&&(!sameCycle||!plan.available)))){store.finishNotification(job.id,owner);continue;}
        try{
          if(allChanges||job.action==="new_plan"){
            // Each queued event is an immutable observation, including changes
            // made during quiet hours. Never rewrite history with today's stock.
            const card=job.snapshot||plan;
            const result=await telegramCall(settings,"sendMessage",{chat_id:chatId,text:notificationCard(card,settings,job.action),parse_mode:"HTML",disable_web_page_preview:true},{now:notificationNow()});
            store.transaction(()=>{
              const latest=store.getPlan(plan.id);
              if(latest&&latest.notificationCycle===job.cycleId){const notification={chatId,messageId:result.message_id,sentAt:new Date().toISOString()};store.putPlan({...latest,notification,notifications:{...latest.notifications,[chatId]:notification}});}
            });
            addEvent("telegram_sent",`${plan.name}：已发送${job.action==="new_plan"?"新上架":job.action==="sold_out"?"售罄":job.action==="stock_changed"?"库存变化":"补货"}卡片`,{providerId:plan.providerId,planId:plan.id,recipientKind:recipient.kind});
          }else if(job.action==="restocked") {
            const result=await telegramCall(settings,"sendMessage",{chat_id:chatId,text:notificationCard(plan,settings,"restocked"),parse_mode:"HTML",disable_web_page_preview:true},{now:notificationNow()});
            // A probe may have changed stock while the network request was in flight.
            store.transaction(()=>{
              const latest=store.getPlan(plan.id),active=store.getMonitor(monitor.id);
              const notification={chatId:chatId,messageId:result.message_id,sentAt:new Date().toISOString()};
              if(latest&&latest.notificationCycle===plan.notificationCycle){latest.notification=notification;latest.notifications={...latest.notifications,[chatId]:notification};store.putPlan(latest);}
              if(active&&latest&&(!latest.available||latest.notificationCycle!==plan.notificationCycle)){
                enqueue("sold_out",{...plan,available:false,quantity:0,notification},active,recipient);
              }else if(active&&latest&&latest.quantity!==plan.quantity){enqueue("stock_changed",{...latest,notification},active,recipient);}
            });
            addEvent("telegram_sent",`${plan.name}：已发送补货卡片`,{providerId:plan.providerId,planId:plan.id,recipientKind:recipient.kind});
          }else if(target?.messageId){
            const soldOut=job.action==="sold_out",card=soldOut?(job.snapshot||plan):plan;
            await telegramCall(settings,"editMessageText",{chat_id:target.chatId,message_id:target.messageId,text:notificationCard(card,settings,soldOut?"sold_out":"restocked"),parse_mode:"HTML",disable_web_page_preview:true},{now:notificationNow()});
            addEvent("telegram_edited",`${plan.name}：${soldOut?"已编辑为售罄":"已更新库存卡片"}`,{providerId:plan.providerId,planId:plan.id,recipientKind:recipient.kind});
          }
          store.finishNotification(job.id,owner);
        }catch(error){
          if(error.quietHours){job.nextAttemptAt=error.resumeAt;store.finishNotification(job.id,owner,job);continue;}
          if(error.permanent){store.finishNotification(job.id,owner);addEvent("telegram_failed",`${plan.name}：TG 永久错误，已停止重试`,{planId:plan.id,recipientKind:recipient.kind,error:error.message});continue;}
          job.attempts+=1;job.lastError=error.message;job.nextAttemptAt=error.retryAfter?new Date(Date.now()+Number(error.retryAfter)*1000).toISOString():nextRetry(job.attempts);
          store.finishNotification(job.id,owner,job);addEvent("telegram_failed",`${plan.name}：TG 投递失败，将重试`,{providerId:plan.providerId,planId:plan.id,recipientKind:recipient.kind,error:error.message});
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
      if(Array.isArray(batch.categories))store.putProvider({...provider,categories:[...batch.categories,...(provider.categories||[]).filter(category=>!batch.categories.some(next=>next.id===category.id)).map(category=>({...category,retired:true}))]});
      const observedAt=new Date().toISOString();
      // Only complete, successfully parsed pages may change their visible listing.
      const present=new Set(current.map(plan=>plan.id)),catalogCategories=Array.isArray(batch.categories)?new Set(batch.categories.map(category=>category.id)):null;
      for(const previous of store.listPlans(provider.id)){
        if((catalogCategories&&!catalogCategories.has(previous.categoryId))||(batch.completedCategories.includes(previous.categoryId)&&!present.has(previous.id))){
          if(previous.listed!==false)addEvent("delisted",`${previous.name}：套餐下架`,{providerId:provider.id,planId:previous.id,snapshot:snapshot(previous)});
          store.putPlan({...previous,listed:false,listingCheckedAt:observedAt});
        }
      }
      const baselineCategories=new Set(Object.entries(active.categoryStatuses||{}).filter(([,status])=>status.lastSuccessAt).map(([id])=>id));
      active.categoryStatuses={...active.categoryStatuses};
      for(const categoryId of batch.completedCategories)active.categoryStatuses[categoryId]={lastSuccessAt:observedAt,lastAttemptAt:observedAt,lastError:null};
      for(const failure of batch.failures){active.categoryStatuses[failure.categoryId]={...active.categoryStatuses[failure.categoryId],lastAttemptAt:observedAt,lastError:failure.error};addEvent("monitor_category_failed",`${provider.name} · ${failure.categoryName}：${failure.error}`,{providerId:provider.id,categoryId:failure.categoryId});}
      for(const plan of current){
        const previous=store.getPlan(plan.id),result=reconcilePlan(previous,plan,active,{notifyAllChanges:store.getSettings().telegram.notificationMode==="all"});
        const baseline=Boolean(active.catalogInitialized||baselineCategories.has(plan.categoryId)||(!baselineCategories.size&&active.lastRunAt&&!active.lastError)||(baselineCategories.size&&!(provider.categories||[]).some(category=>category.id===plan.categoryId)));
        const isNew=!previous&&baseline;
        if(!previous&&(isNew||provider.notifyOnFirstDiscovery===false))result.action=null;
        const dynamic=isNew?"new_plan":previous?.listed===false?"new_plan":previous&&previous.available!==plan.available?(plan.available?"restocked":"sold_out"):previous&&(previous.quantity??null)!==(plan.quantity??null)?"stock_changed":null;
        if(result.action==="restocked"||isNew)result.next.notificationCycle=randomUUID();
        result.next.observedAt=observedAt;store.putPlan(result.next);
        if(dynamic)addEvent(dynamic,`${plan.name}：${dynamic==="new_plan"?"新套餐上架":dynamic==="sold_out"?"套餐售罄":dynamic==="restocked"?"套餐补货":"库存数量变化"}`,{providerId:provider.id,planId:plan.id,snapshot:snapshot(result.next)});
        if(isNew&&store.getSettings().telegram.notifyNewPlans)enqueue("new_plan",result.next,active);
        else if(result.action)enqueue(result.action,{...result.next,previousQuantity:previous?.quantity??null},active);
      }
      if(!batch.failures.length)active.catalogInitialized=true;
      active.lastRunAt=new Date().toISOString();active.lastDurationMs=Date.now()-started;active.lastError=batch.failures.length?batch.failures.map(f=>`${f.categoryName}：${f.error}`).join("；"):null;active.consecutiveFailures=batch.failures.length?(active.consecutiveFailures||0)+1:0;store.putMonitor(active);
      console.log(`[monitor] ${provider.name}: 采集 ${current.length} 个套餐，失败分类 ${batch.failures.length} 个`);
      if(batch.failures.length)addEvent("monitor_partial",`${provider.name}：探测到 ${current.length} 个套餐${batch.failures.length?"，部分系列失败，保留上次状态":""}`,{providerId:provider.id});return monitorView(active);
    });
  }
  const running=new Map();
  function runMonitorSafe(monitor){if(running.has(monitor.id))return running.get(monitor.id);const task=runMonitorSafeInternal(monitor).finally(()=>running.delete(monitor.id));running.set(monitor.id,task);return task;}
  async function runMonitorSafeInternal(monitor){try{return await runMonitor(monitor);}catch(error){const active=store.getMonitor(monitor.id);if(!active)throw error;monitor=active;monitor.lastRunAt=new Date().toISOString();monitor.lastDurationMs=0;monitor.lastError=error.message;monitor.consecutiveFailures=(monitor.consecutiveFailures||0)+1;for(const failure of error.failures||[]){monitor.categoryStatuses={...monitor.categoryStatuses,[failure.categoryId]:{...monitor.categoryStatuses?.[failure.categoryId],lastAttemptAt:monitor.lastRunAt,lastError:failure.error}};}store.putMonitor(monitor);addEvent("monitor_failed",`${monitorView(monitor).providerName}：${error.message}`,{providerId:monitor.providerId,error:error.message});throw error;}}
  return {addEvent,monitorView,validateMonitor,deliverNotifications,runMonitor,runMonitorSafe};
}

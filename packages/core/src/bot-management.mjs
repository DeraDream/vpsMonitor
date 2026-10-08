import { randomBytes, createHash } from 'node:crypto';
import { telegramCall, telegramTargets, escapeHtml } from './telegram.mjs';
import { validateQuietHours, beijingTimestamp } from './notification-policy.mjs';

export function createBotManagement(store, service, {call=telegramCall, origin=process.env.AUTH_ORIGIN||'', now=Date.now}={}) {
 const pending=new Map(), inputs=new Map(); let initialized='', retryAt=0;
 store.db.exec('CREATE TABLE IF NOT EXISTS bot_offsets(id TEXT PRIMARY KEY, value INTEGER NOT NULL)');
 const button=(text,data)=>({text,callback_data:data});
 const label=value=>String(value??'').replace(/[\u0000-\u0008]/g,'').slice(0,160);
 const text=value=>escapeHtml(label(value));
 const date=value=>value&&Number.isFinite(Date.parse(value))?beijingTimestamp(value):'尚未检查';
 const duration=value=>value%60===0?`${value/60} 分钟`:`${value} 秒`;
 const title=(icon,name,subtitle='')=>`${icon} <b>${text(name)}</b>${subtitle?'\n'+text(subtitle):''}\n`;
 const badge=value=>value?'🟢 已开启':'⚪ 已关闭';
 const admin=()=>String(store.getSettings().telegram.personalChatId||'');
 const api=(method,payload)=>call(store.getSettings().telegram,method,payload,{management:true});
 const audit=action=>service.addEvent('bot_management',`Telegram 管理员 ${admin()}：${action}`,{actor:admin()});
 const home=()=>[[button('📊 系统状态','status'),button('🎛 监控管理','monitors:0')],[button('📦 套餐库存','providers:0'),button('🔔 通知设置','notifications')],[button('🕘 最近事件','events:0'),button('❔ 使用帮助','help')],...(origin.startsWith('https://')?[[{text:'↗ 打开网页后台',url:new URL('/admin',origin).href}]]:[])];
 const back=()=>[button('‹ 主菜单','menu')];
 async function display(chat,body,rows=home(),messageId) {
  const payload={chat_id:chat,text:body,parse_mode:'HTML',reply_markup:{inline_keyboard:rows.filter(row=>row.length)},disable_web_page_preview:true};
  if(messageId){try{return await api('editMessageText',{...payload,message_id:messageId})}catch(error){if(!/message (?:to edit not found|can't be edited|identifier is not specified)/i.test(error.message))throw error}}
  return api('sendMessage',payload);
 }
 function ticket(chat,action){const key=randomBytes(12).toString('hex');pending.set(key,{chat:String(chat),admin:admin(),action,expires:now()+120000});return key}
 function consume(chat,key){const p=pending.get(key);pending.delete(key);if(!p||p.chat!==String(chat)||p.admin!==admin()||p.expires<now())throw new Error('确认已过期，请重新操作');return p.action}
 const monitor=id=>{const m=store.getMonitor(id);if(!m)throw new Error('监控任务不存在');return m};
 const providerName=m=>store.getProvider(m.providerId)?.name||'未知商家';
 function updateMonitor(id,patch){const m=monitor(id);store.putMonitor({...m,...service.validateMonitor({...m,...patch},m.id),updatedAt:new Date(now()).toISOString()});audit(`修改 ${providerName(m)} 监控`)}
 function page(items,n,size=6){const index=Math.max(0,Math.min(Math.floor(Number(n)||0),Math.max(0,Math.ceil(items.length/size)-1)));return {index,items:items.slice(index*size,(index+1)*size),pages:Math.ceil(items.length/size),total:items.length}}
 const navigation=(kind,p)=>[...(p.index>0?[button('‹ 上一页',`${kind}:${p.index-1}`)]:[]),...(p.index+1<p.pages?[button('下一页 ›',`${kind}:${p.index+1}`)]:[])];
 const pageLabel=p=>`共 ${p.total} 项 · 第 ${p.index+1}/${Math.max(1,p.pages)} 页`;
 function settingsPatch(patch){const settings=store.getSettings();Object.assign(settings.telegram,patch);store.setSettings(settings);audit('修改通知设置')}
 function interval(value){if(!Number.isInteger(value)||value<30||value>3600)throw new Error('检查间隔须为 30–3600 秒的整数');return value}
 function parseInterval(value){const match=/^(\d+)\s*(s|秒|m|分钟)?$/i.exec(String(value).trim());if(!match)throw new Error('请输入秒数（例如 75），或分钟数（例如 5m）；范围 30–3600 秒');return interval(Number(match[1])*(/^(m|分钟)$/i.test(match[2]||'')?60:1))}
 async function execute(chat,action,messageId) {
  const [kind,arg,extra]=action.split(':');
  const show=(body,rows)=>display(chat,body,rows,messageId);
  const next=action=>execute(chat,action,messageId);
  if(kind==='menu'){
   const ms=store.listMonitors(),plans=store.listPlans().filter(p=>p.listed!==false);
   return show(title('🛰','VPS Monitor','你的库存与监控控制台')+`\n<b>${ms.filter(m=>m.enabled).length}</b> 个运行中监控   ·   <b>${plans.filter(p=>p.available).length}</b> 个有货套餐\n\n选择下方入口查看或管理。`);
  }
  if(kind==='help')return show(title('❔','使用帮助')+'\n<b>常用命令</b>\n/menu  打开主菜单\n/status  查看运行状态\n/monitors  管理监控\n/stock  查看套餐库存\n/cancel  取消当前输入\n\n<b>自定义检查间隔</b>\n监控详情 → 检查间隔 → 自定义\n发送 <code>75</code> 表示 75 秒，<code>5m</code> 表示 5 分钟。\n\n<b>免打扰</b>\n<code>/quiet 23:00 08:00</code>\n时间均为北京时间（UTC+8）。',[back()]);
  if(kind==='status'){
   const ms=store.listMonitors(),rt=store.getRuntime(),alive=now()-Date.parse(rt.lastTickAt||0)<30000;
   const details=ms.slice(0,6).map(m=>`${m.lastError?'🔴':m.enabled?'🟢':'⚪'} <b>${text(providerName(m))}</b>\n   ${text(date(m.lastRunAt))}${m.lastError?'\n   '+text(m.lastError):''}`).join('\n\n');
   return show(title('📊','系统状态')+`\n${alive?'🟢 Worker 正常运行':'🔴 Worker 心跳超时'}\n最近心跳  <code>${text(date(rt.lastTickAt))}</code>\n\n<b>监控概览</b>\n运行中 ${ms.filter(m=>m.enabled).length} / ${ms.length}   ·   异常 ${ms.filter(m=>m.lastError).length}\n待发通知 ${store.listNotifications().length}\n\n<b>最近检查 · 北京时间</b>\n${details||'暂无监控任务'}`,[[button('↻ 刷新状态','status'),button('🎛 管理监控','monitors:0')],back()]);
  }
  if(kind==='monitors'){
   const p=page(store.listMonitors(),arg);
   const body=p.items.map(m=>`${m.enabled?'🟢':'⚪'} <b>${text(providerName(m))}</b>\n   ${m.enabled?'运行中':'已暂停'} · 每 ${duration(m.intervalSeconds)}\n   ${m.lastError?'⚠ '+text(m.lastError):'上次检查 '+text(date(m.lastRunAt))}`).join('\n\n');
   return show(title('🎛','监控管理',pageLabel(p))+`\n${body||'还没有监控任务，点击下方添加。'}\n\n<i>点击商家按钮查看详情和操作。</i>`,[...p.items.map(m=>[button(`${m.enabled?'🟢':'⚪'} ${label(providerName(m)).slice(0,35)} · ${duration(m.intervalSeconds)}`,`monitor:${m.id}`)]),navigation('monitors',p),[button('＋ 添加监控','add:0'),button('⏸ 全部暂停','pauseall')],back()]);
  }
  if(kind==='add'){
   const p=page(store.listProviders().filter(v=>!store.getMonitorByProvider(v.id)),arg);
   return show(title('＋','添加监控',pageLabel(p))+'\n'+(p.total?'选择商家创建监控。\n默认监控全部套餐，每 1 分钟检查一次。':'所有已接入商家都已有监控。'),[...p.items.map(v=>[button(label(v.name),`create:${v.id}`)]),navigation('add',p),[button('‹ 监控列表','monitors:0')]]);
  }
  if(kind==='create'){const provider=store.getProvider(arg);if(!provider)throw new Error('商家不存在');if(store.getMonitorByProvider(arg))throw new Error('商家已有监控');const time=new Date(now()).toISOString();store.putMonitor({...service.validateMonitor({providerId:arg,enabled:true,intervalSeconds:60,scope:'all'}),id:`monitor_${randomBytes(8).toString('hex')}`,createdAt:time,updatedAt:time,lastRunAt:null,lastError:null});audit(`创建 ${provider.name} 监控`);return next('monitors:0')}
  if(kind==='monitor'){
   const m=monitor(arg),scope=m.scope==='selected'?'指定套餐':m.scope==='categories'?'指定分类':'全部套餐';
   return show(title('🎛',providerName(m),'监控详情')+`\n${m.enabled?'🟢 监控运行中':'⚪ 监控已暂停'}\n\n<b>检查配置</b>\n检查间隔  <b>${duration(m.intervalSeconds)}</b>\n监控范围  ${scope}\n\n<b>最近检查</b>\n<code>${text(date(m.lastRunAt))}</code>\n${m.lastError?'⚠ '+text(m.lastError):'✅ 无异常记录'}\n\n<i>时间为北京时间。</i>`,[[button(m.enabled?'⏸ 暂停监控':'▶ 启用监控',`toggle:${arg}`),button('↻ 立即检查',`run:${arg}`)],[button('⏱ 检查间隔',`interval:${arg}`),button('🗑 删除监控',`delete:${arg}`)],[button('‹ 监控列表','monitors:0')]]);
  }
  if(kind==='toggle'){const m=monitor(arg);updateMonitor(arg,{enabled:!m.enabled});return next(`monitor:${arg}`)}
  if(kind==='interval'){
   const m=monitor(arg);return show(title('⏱','检查间隔',providerName(m))+`\n当前间隔  <b>${duration(m.intervalSeconds)}</b>\n\n选择快捷时间，或输入自定义间隔。\n支持 <b>30–3600 秒</b>。`,[[30,60,120].map(v=>button(`${v===m.intervalSeconds?'✓ ':''}${duration(v)}`,`setinterval:${arg}:${v}`)),[300,600,1800].map(v=>button(`${v===m.intervalSeconds?'✓ ':''}${duration(v)}`,`setinterval:${arg}:${v}`)),[button('✎ 自定义间隔',`custominterval:${arg}`)],[button('‹ 监控详情',`monitor:${arg}`)]]);
  }
  if(kind==='custominterval'){
   const m=monitor(arg);inputs.set(String(chat),{admin:admin(),monitorId:arg,messageId,expires:now()+300000});
   return show(title('✎','自定义检查间隔',providerName(m))+`\n当前  <b>${duration(m.intervalSeconds)}</b>\n\n直接发送希望设置的时间：\n<code>75</code> 或 <code>75秒</code> → 75 秒\n<code>5m</code> 或 <code>5分钟</code> → 5 分钟\n\n范围 <b>30–3600 秒</b>，请输入整数。\n<i>5 分钟内有效，/cancel 可取消。</i>`,[[button('取消输入',`interval:${arg}`)]]);
  }
  if(kind==='setinterval'){updateMonitor(arg,{intervalSeconds:interval(Number(extra))});return next(`monitor:${arg}`)}
  if(kind==='run'){const m=monitor(arg);await show(title('↻',providerName(m))+'\n正在检查库存，请稍候…',[[button('‹ 监控列表','monitors:0')]]);await service.runMonitorSafe(m);audit(`立即检查 ${providerName(m)}`);return next(`monitor:${arg}`)}
  if(kind==='delete'||kind==='pauseall'){
   const name=kind==='delete'?providerName(monitor(arg)):'全部监控';
   return show(title('⚠',kind==='delete'?'删除监控':'暂停全部监控',name)+'\n'+(kind==='delete'?'删除后将移除监控及其待发通知。':'所有商家的自动检查将暂停，可逐个重新开启。')+'\n\n<b>确定继续吗？</b>\n<i>确认按钮 2 分钟内有效。</i>',[[button('确认'+(kind==='delete'?'删除':'暂停'),`confirm:${ticket(chat,action)}`),button('取消','monitors:0')]]);
  }
  if(kind==='confirm'){const confirmed=consume(chat,arg);if(confirmed==='pauseall'){for(const m of store.listMonitors())updateMonitor(m.id,{enabled:false});audit('批量暂停监控')}else if(confirmed.startsWith('delete:')){store.deleteMonitor(confirmed.slice(7));audit('删除监控')}return next('monitors:0')}
  if(kind==='providers'){
   const p=page(store.listProviders(),arg);const body=p.items.map(v=>{const plans=store.listPlans(v.id).filter(p=>p.listed!==false);return `<b>${text(v.name)}</b>\n   ${plans.length} 个套餐 · ${plans.filter(p=>p.available).length} 个有货 / 可订购`}).join('\n\n');
   return show(title('📦','套餐库存',pageLabel(p))+`\n${body||'暂无商家'}\n\n<i>选择商家浏览套餐。</i>`,[...p.items.map(v=>[button(`📦 ${label(v.name)}`,`plans:${v.id}:0`)]),navigation('providers',p),back()]);
  }
  if(kind==='plans'){
   const all=store.listPlans(arg).filter(p=>p.listed!==false),p=page(all,extra,4),name=store.getProvider(arg)?.name||'套餐';
   const cards=p.items.map((v,i)=>{const n=p.index*4+i+1,stock=v.available?(v.availabilitySource==='order-button'?'🟢 可订购':'🟢 有货'):'⚪ 已售罄';return `<b>${n}. ${text(v.name)}</b>\n${stock}${Number.isInteger(v.quantity)?` · 剩余 <b>${v.quantity}</b> 台`:''}\n💰 <b>${text(v.price)||'价格未公开'}</b>${v.billingCycle?' / '+text(({month:'月',year:'年',quarter:'季',hour:'小时'})[v.billingCycle]||v.billingCycle):''}${v.specs?'\n💻 '+text(v.specs):''}${v.location?'\n📍 '+text(v.location):''}${v.categoryName?'\n🗂 '+text(v.categoryName):''}`}).join('\n\n────────────\n\n');
   const purchases=p.items.flatMap((v,i)=>/^https?:\/\//.test(v.buyUrl||'')?[{text:`${p.index*4+i+1}. ${v.available?'购买':'查看'} ${label(v.name).slice(0,22)}`,url:v.buyUrl}]:[]),purchaseRows=[];for(let i=0;i<purchases.length;i+=2)purchaseRows.push(purchases.slice(i,i+2));
   return show(title('📦',name,`${all.filter(v=>v.available).length} 个有货 / 可订购 · ${pageLabel(p)}`)+`\n${cards||'暂无已采集套餐，请先运行监控。'}`,[...purchaseRows,navigation(`plans:${arg}`,p),[button('↻ 刷新库存',`plans:${arg}:${p.index}`),button('‹ 商家列表','providers:0')],back()]);
  }
  if(kind==='events'){
   const p=page(store.listEvents(100),arg,6),icons={restocked:'🟢',sold_out:'⚪',new_plan:'✨',stock_changed:'📊',monitor_failed:'⚠',telegram_failed:'⚠',bot_management:'🎛'};
   return show(title('🕘','最近事件',pageLabel(p))+`\n${p.items.map(e=>`${icons[e.type]||'•'} ${text(e.message)}\n<code>${text(date(e.at))}</code>`).join('\n\n')||'暂无事件记录'}\n\n<i>时间为北京时间。</i>`,[navigation('events',p),[button('↻ 刷新事件','events:0')],back()]);
  }
  if(kind==='notifications'){
   const t=store.getSettings().telegram;
   return show(title('🔔','通知设置')+`\n<b>推送渠道</b>\n总开关  ${badge(t.enabled)}\n频道推送  ${badge(t.channelEnabled)}\n个人推送  ${badge(t.personalEnabled)}\n\n<b>推送内容</b>\n库存变化  ${t.notificationMode==='all'?'全部变化':'仅补货'}\n新套餐提醒  ${badge(t.notifyNewPlans)}\n\n<b>免打扰 · 北京时间</b>\n${badge(t.quietHours?.enabled)}\n<code>${text(t.quietHours?.start)} – ${text(t.quietHours?.end)}</code>\n\n<i>修改时段：/quiet 23:00 08:00</i>`,[[button(`${t.enabled?'🟢':'⚪'} 通知总开关`,'setting:enabled')],[button(`${t.channelEnabled?'🟢':'⚪'} 频道推送`,'setting:channelEnabled'),button(`${t.personalEnabled?'🟢':'⚪'} 个人推送`,'setting:personalEnabled')],[button('⇄ 库存通知模式','setting:notificationMode'),button(`${t.notifyNewPlans?'🟢':'⚪'} 新套餐`,'setting:notifyNewPlans')],[button(`${t.quietHours?.enabled?'🌙':'☀'} 免打扰`,'quiettoggle')],[button('测试频道','test:channel'),button('测试个人','test:personal')],back()]);
  }
  if(kind==='setting'){if(!['enabled','channelEnabled','personalEnabled','notifyNewPlans','notificationMode'].includes(arg))throw new Error('未知设置');const t=store.getSettings().telegram;settingsPatch({[arg]:arg==='notificationMode'?(t.notificationMode==='all'?'restock':'all'):!t[arg]});return next('notifications')}
  if(kind==='quiettoggle'){const q=store.getSettings().telegram.quietHours;settingsPatch({quietHours:validateQuietHours({...q,enabled:!q.enabled},q)});return next('notifications')}
  if(kind==='test'){const t=store.getSettings().telegram,target=telegramTargets(t).find(v=>v.kind===arg);if(!target)throw new Error('请先在后台配置并开启此通知目标');await call(t,'sendMessage',{chat_id:target.chatId,text:'✅ VPS Monitor Telegram 连通性测试成功'});return show(title('✅','测试消息已发送')+'\n请检查对应通知渠道。',[[button('‹ 通知设置','notifications')]])}
  throw new Error('未知操作，请使用 /menu');
 }
 async function handle(update){
  for(const [key,value] of pending)if(value.expires<now())pending.delete(key);
  const cb=update.callback_query,msg=cb?.message||update.message,user=cb?.from||msg?.from;
  if(!msg||!user)return;
  const configured=admin(),chat=String(msg.chat?.id);
  if(!/^[1-9]\d{0,19}$/.test(configured)||msg.chat?.type!=='private'||String(user.id)!==configured||chat!==configured){if(cb)await api('answerCallbackQuery',{callback_query_id:cb.id,text:'无管理权限',show_alert:true});return}
  if(cb)await api('answerCallbackQuery',{callback_query_id:cb.id});
  try{
   if(cb){if(typeof cb.data!=='string'||Buffer.byteLength(cb.data)>64)throw new Error('无效操作');inputs.delete(chat);await execute(msg.chat.id,cb.data,msg.message_id);return}
   const value=String(msg.text||''),parts=value.trim().split(/\s+/),command=parts[0].split('@')[0],input=inputs.get(chat);
   if(command==='/cancel'){inputs.delete(chat);await execute(msg.chat.id,input?.admin===configured?`interval:${input.monitorId}`:'menu',input?.messageId);return}
   if(!value.startsWith('/')&&input){
    if(input.admin!==configured){inputs.delete(chat);return}
    if(input.expires<now()){inputs.delete(chat);await display(msg.chat.id,title('⏳','输入已过期')+'\n请重新打开检查间隔 → 自定义。',[[button('‹ 监控列表','monitors:0')]]);return}
    try{const seconds=parseInterval(value);updateMonitor(input.monitorId,{intervalSeconds:seconds});inputs.delete(chat);await execute(msg.chat.id,`monitor:${input.monitorId}`,input.messageId)}catch(e){await display(msg.chat.id,title('✎','请重新输入')+'\n'+text(e.message)+'\n\n<code>75</code> = 75 秒 · <code>5m</code> = 5 分钟\n/cancel 取消',[ [button('取消输入',`interval:${input.monitorId}`)] ])}return;
   }
   inputs.delete(chat);
   if(command==='/quiet'){const q=store.getSettings().telegram.quietHours;settingsPatch({quietHours:validateQuietHours({enabled:true,start:parts[1],end:parts[2]},q)});await execute(msg.chat.id,'notifications');return}
   const action={'/start':'menu','/menu':'menu','/help':'help','/status':'status','/monitors':'monitors:0','/stock':'providers:0','/notifications':'notifications','/events':'events:0'}[command];
   await execute(msg.chat.id,action||'help');
  }catch(e){await display(msg.chat.id,title('⚠','操作未完成')+'\n'+text(e.message),undefined,cb?msg.message_id:undefined)}
 }
 async function poll(){
  const t=store.getSettings().telegram;if(!t.botTokenEncrypted||!admin()||now()<retryAt)return;
  const key=createHash('sha256').update(t.botTokenEncrypted).digest('hex'),identity=key+':'+admin();
  try{
   if(initialized!==identity){const webhook=await api('getWebhookInfo',{});if(webhook.url)throw new Error('Bot 已配置 Webhook，无法同时长轮询；请先在原服务停用 Webhook');await api('setMyCommands',{scope:{type:'chat',chat_id:admin()},commands:[{command:'menu',description:'管理菜单'},{command:'status',description:'系统状态'},{command:'monitors',description:'监控管理'},{command:'stock',description:'库存查询'},{command:'notifications',description:'通知设置'},{command:'events',description:'最近事件'},{command:'help',description:'帮助'},{command:'cancel',description:'取消当前输入'}]});initialized=identity}
   const offset=store.db.prepare('SELECT value FROM bot_offsets WHERE id=?').get(key)?.value||0;
   const updates=await api('getUpdates',{offset,timeout:5,allowed_updates:['message','callback_query']});
   for(const update of updates){store.db.prepare('INSERT OR REPLACE INTO bot_offsets VALUES (?,?)').run(key,update.update_id+1);await handle(update)}
  }catch(e){retryAt=now()+30000;service.addEvent('bot_management_failed',label(e.message));}
 }
 return {handle,poll};
}

import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createDatabase} from '../packages/db/src/database.mjs';import {createService} from '../packages/core/src/service.mjs';import {createBotManagement} from '../packages/core/src/bot-management.mjs';
test('Bot 私聊鉴权、通知开关独立、确认码单次消费、间隔和库存分页',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'bot-test-')),store=createDatabase(dir),calls=[];let time=Date.now();
 try{const settings=store.getSettings();Object.assign(settings.telegram,{personalChatId:'123',personalEnabled:false,enabled:false});store.setSettings(settings);store.putProvider({id:'p',name:'商家',adapterKey:'test'});store.putMonitor({id:'m',providerId:'p',enabled:true,intervalSeconds:60});const bot=createBotManagement(store,createService(store),{call:async(t,method,payload)=>{calls.push({method,payload});return []},now:()=>time,origin:'https://example.com'});
 const message=(id,type='private',text='/menu')=>({message:{chat:{id,type},from:{id},text}});const callback=(data,id=123,type='private')=>({callback_query:{id:'cb',from:{id},message:{chat:{id,type}},data}});
 await bot.handle(message(456));await bot.handle(message(123,'group'));await bot.handle(callback('toggle:m',456));assert.equal(store.getMonitor('m').enabled,true);assert.equal(calls.filter(c=>c.method==='sendMessage').length,0);
 await bot.handle(message(123));assert.equal(calls.at(-1).payload.chat_id,123);await bot.handle(callback('toggle:m'));assert.equal(store.getMonitor('m').enabled,false);
 await bot.handle(callback('setinterval:m:300'));assert.equal(store.getMonitor('m').intervalSeconds,300);
 await bot.handle(callback('delete:m'));const token=calls.at(-1).payload.reply_markup.inline_keyboard[0][0].callback_data;assert.ok(store.getMonitor('m'));time+=120001;await bot.handle(callback(token));assert.ok(store.getMonitor('m'));
 await bot.handle(callback('delete:m'));const fresh=calls.at(-1).payload.reply_markup.inline_keyboard[0][0].callback_data;await bot.handle(callback(fresh));assert.equal(store.getMonitor('m'),null);await bot.handle(callback(fresh));assert.match(calls.at(-1).payload.text,/过期/);
 await bot.handle(message(123,'private','/quiet 22:00 07:00'));assert.equal(store.getSettings().telegram.quietHours.start,'22:00');assert.equal(store.getSettings().telegram.quietHours.enabled,true);
 await bot.handle(message(123,'private','/quiet invalid 07:00'));assert.equal(store.getSettings().telegram.quietHours.start,'22:00');
 for(let i=0;i<8;i++)store.putPlan({id:'p'+i,providerId:'p',name:'套餐'+i,available:true,listed:true});await bot.handle(callback('plans:p:1'));assert.match(calls.at(-1).payload.text,/套餐4/);
 settings.telegram.personalChatId='456';store.setSettings(settings);const before=calls.filter(c=>c.method==='sendMessage').length;await bot.handle(message(123));assert.equal(calls.filter(c=>c.method==='sendMessage').length,before);
 }finally{store.close();rmSync(dir,{recursive:true,force:true})}
});

test('Bot 自定义间隔：严格范围、单位、重试、取消、过期和权限隔离',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'bot-input-')),store=createDatabase(dir),calls=[];let time=Date.now();
 try{
  const settings=store.getSettings();settings.telegram.personalChatId='123';store.setSettings(settings);store.putProvider({id:'p',name:'商家',adapterKey:'test'});store.putMonitor({id:'m',providerId:'p',enabled:true,intervalSeconds:60});
  const bot=createBotManagement(store,createService(store),{call:async(t,method,payload)=>{calls.push({method,payload});return {}},now:()=>time});
  const cb=data=>({callback_query:{id:'cb',from:{id:123},message:{message_id:42,chat:{id:123,type:'private'}},data}});
  const msg=(text,id=123)=>({message:{chat:{id,type:'private'},from:{id},text}});
  await bot.handle(cb('custominterval:m'));assert.equal(calls.at(-1).method,'editMessageText');
  for(const input of ['19','3601','1.5m','garbage','5h']){await bot.handle(msg(input));assert.equal(store.getMonitor('m').intervalSeconds,60);assert.match(calls.at(-1).payload.text,/重新输入/)}
  await bot.handle(msg('75',456));assert.equal(store.getMonitor('m').intervalSeconds,60);
  await bot.handle(msg('75'));assert.equal(store.getMonitor('m').intervalSeconds,75);assert.equal(calls.at(-1).payload.message_id,42);
  for(const [input,seconds] of [['5m',300],['7分钟',420],['95秒',95],['20',20],['30',30],['3600',3600]]){await bot.handle(cb('custominterval:m'));await bot.handle(msg(input));assert.equal(store.getMonitor('m').intervalSeconds,seconds)}
  await bot.handle(cb('custominterval:m'));await bot.handle(msg('/cancel'));await bot.handle(msg('90'));assert.equal(store.getMonitor('m').intervalSeconds,3600);
  await bot.handle(cb('custominterval:m'));time+=300001;await bot.handle(msg('100'));assert.equal(store.getMonitor('m').intervalSeconds,3600);assert.match(calls.at(-1).payload.text,/过期/);
  await bot.handle(cb('custominterval:m'));await bot.handle(cb('menu'));await bot.handle(msg('90'));assert.equal(store.getMonitor('m').intervalSeconds,3600);
  await bot.handle(cb('setinterval:m:99999'));assert.equal(store.getMonitor('m').intervalSeconds,3600);
 }finally{store.close();rmSync(dir,{recursive:true,force:true})}
});

test('Bot 卡片 HTML 转义、菜单原地更新、分页与购买按钮对应',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'bot-ui-')),store=createDatabase(dir),calls=[];
 try{
  const settings=store.getSettings();settings.telegram.personalChatId='123';store.setSettings(settings);store.putProvider({id:'p',name:'商家 <A&B>',adapterKey:'test'});
  for(let i=0;i<8;i++)store.putPlan({id:'p'+i,providerId:'p',name:`套餐 <${i}&>`,available:i%2===0,price:'$10',billingCycle:'month',specs:'2C / 4GB',location:'DE',categoryName:'VPS',quantity:i,buyUrl:`https://example.com/${i}`});
  const bot=createBotManagement(store,createService(store),{call:async(t,method,payload)=>{calls.push({method,payload});return {}}});
  const cb=data=>({callback_query:{id:'cb',from:{id:123},message:{message_id:42,chat:{id:123,type:'private'}},data}});
  await bot.handle(cb('plans:p:1'));const card=calls.at(-1);assert.equal(card.method,'editMessageText');assert.equal(card.payload.parse_mode,'HTML');assert.equal(card.payload.message_id,42);assert.match(card.payload.text,/套餐 &lt;4&amp;&gt;/);assert.match(card.payload.text,/<b>5\./);assert.match(card.payload.text,/第 2\/2 页/);assert.match(card.payload.text,/2C \/ 4GB/);
  const rows=card.payload.reply_markup.inline_keyboard;assert.equal(rows[0][0].url,'https://example.com/4');assert.match(rows[0][0].text,/^5\./);assert.equal(rows[0].length,2);assert.ok(rows.flat().some(b=>b.callback_data==='plans:p:0'));
  await bot.handle(cb('status'));assert.ok(calls.at(-1).payload.reply_markup.inline_keyboard.flat().some(b=>b.callback_data==='status'));assert.equal(calls.filter(c=>c.method==='sendMessage').length,0);
 }finally{store.close();rmSync(dir,{recursive:true,force:true})}
});

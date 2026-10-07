import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createDatabase} from '../packages/db/src/database.mjs'
import {createService} from '../packages/core/src/service.mjs'
import {registerAdapter} from '../packages/adapters/src/index.mjs'
import {encryptToken} from '../packages/core/src/crypto.mjs'
async function fixture(run){
 const dir=await mkdtemp(join(tmpdir(),'new-plans-')),store=createDatabase(dir),oldFetch=globalThis.fetch,oldKey=process.env.TOKEN_ENCRYPTION_KEY;
 process.env.TOKEN_ENCRYPTION_KEY='new-plan-test-key';
 let batch={plans:[],categories:[{id:'regular',name:'Regular'}],completedCategories:['regular'],failures:[]},calls=[];
 registerAdapter({key:'new-plan-test',discover:async()=>batch});
 store.putProvider({id:'test',name:'Test merchant',adapterKey:'new-plan-test',notifyOnFirstDiscovery:false,categories:batch.categories});
 store.putMonitor({id:'m',providerId:'test',enabled:true,scope:'all',planIds:[],intervalSeconds:30});
 const settings=store.getSettings();settings.telegram={...settings.telegram,enabled:true,notifyNewPlans:true,chatId:'-1',botTokenEncrypted:encryptToken('fake')};store.setSettings(settings);
 globalThis.fetch=async(url,options)=>{calls.push({method:url.split('/').at(-1),...JSON.parse(options.body)});return {json:async()=>({ok:true,result:{message_id:calls.length}})}};
 const service=createService(store),plan=(id,extra={})=>({externalId:id,name:id,categoryId:'regular',available:true,quantity:3,price:'$19',cpu:'2 cores',ram:'4GB',specs:'2 cores / 4GB',buyUrl:'https://example.com/'+id,...extra});
 const probe=async next=>{batch={...batch,...next};await service.runMonitorSafe(store.getMonitor('m'))};
 try{await run({store,service,calls,plan,probe})}finally{globalThis.fetch=oldFetch;if(oldKey===undefined)delete process.env.TOKEN_ENCRYPTION_KEY;else process.env.TOKEN_ENCRYPTION_KEY=oldKey;store.close();await rm(dir,{recursive:true,force:true})}
}
test('首次基线不刷上架；新分类与范围外新套餐自动解析、推送一次，售罄新套餐也通知',()=>fixture(async({store,service,calls,plan,probe})=>{
 await probe({plans:[plan('existing')]});await service.deliverNotifications();assert.equal(calls.length,0);assert.equal(store.listEvents().length,0);
 store.putMonitor({...store.getMonitor('m'),scope:'selected',planIds:['test:existing']});
 await probe({categories:[{id:'regular',name:'Regular'},{id:'black-friday',name:'Black Friday'}],completedCategories:['regular','black-friday'],plans:[plan('existing'),plan('black-friday',{categoryId:'black-friday'}),plan('sold-new',{available:false,quantity:0})]});
 assert.equal(store.listEvents().filter(e=>e.type==='new_plan').length,2);assert.equal(store.listNotifications().length,2);
 await service.deliverNotifications();assert.equal(calls.length,2);assert.ok(calls.every(c=>c.method==='sendMessage'&&c.text.includes('新套餐上架')&&c.text.includes('2 cores / 4GB')));assert.match(calls[1].text,/库存：0 台/);
 await probe({});await service.deliverNotifications();assert.equal(calls.length,2);assert.equal(store.listEvents().length,4);
}));
test('关闭新套餐开关仍记录动态，开启不补发已有套餐，关闭后取消排队的新套餐',()=>fixture(async({store,service,calls,plan,probe})=>{
 const settings=store.getSettings();settings.telegram.notifyNewPlans=false;store.setSettings(settings);
 await probe({plans:[plan('old')]});await probe({plans:[plan('old'),plan('during-off')]});assert.equal(store.listEvents().filter(e=>e.type==='new_plan').length,1);assert.equal(store.listNotifications().length,0);
 settings.telegram.notifyNewPlans=true;store.setSettings(settings);await probe({});await service.deliverNotifications();assert.equal(calls.length,0);
 await probe({plans:[plan('old'),plan('during-off'),plan('queued')]});assert.equal(store.listNotifications().length,1);
 settings.telegram.notifyNewPlans=false;store.setSettings(settings);await service.deliverNotifications();assert.equal(calls.length,0);assert.equal(store.listNotifications().length,0);
}));
test('TG 未配置和无旧卡片也记录售罄；重复探测不产生成功事件，失败分类不误判下架',()=>fixture(async({store,plan,probe})=>{
 const settings=store.getSettings();settings.telegram.enabled=false;store.setSettings(settings);
 await probe({plans:[plan('old')]});await probe({plans:[plan('old',{available:false,quantity:0})]});await probe({});
 assert.equal(store.listEvents().filter(e=>e.type==='sold_out').length,1);assert.ok(!store.listEvents().some(e=>e.type==='monitor_succeeded'));
 await probe({plans:[],completedCategories:[],failures:[{categoryId:'regular',categoryName:'Regular',error:'HTTP 503'}]});assert.equal(store.getPlan('test:old').listed,true);assert.equal(store.listEvents().filter(e=>e.type==='delisted').length,0);
 await probe({plans:[],completedCategories:['regular'],failures:[]});assert.equal(store.listEvents().filter(e=>e.type==='delisted').length,1);
}));
test('免打扰与暂停监控保留新套餐任务，恢复后发新上架快照，库存模式切换不丢任务',()=>fixture(async({store,service,calls,plan,probe})=>{
 await probe({plans:[plan('old')]});const settings=store.getSettings();settings.telegram.notificationMode='all';settings.telegram.quietHours={enabled:true,start:'23:00',end:'08:00'};store.setSettings(settings);
 await probe({plans:[plan('old'),plan('holiday')]});let time=Date.parse('2099-01-01T15:30:00Z');const paused=createService(store,{now:()=>time});await paused.deliverNotifications();assert.equal(calls.length,0);
 settings.telegram.notificationMode='restock';store.setSettings(settings);time=Date.parse('2099-01-02T00:00:00Z');store.putMonitor({...store.getMonitor('m'),enabled:false});await paused.deliverNotifications();assert.equal(calls.length,0);assert.equal(store.listNotifications().length,1);
 store.putMonitor({...store.getMonitor('m'),enabled:true});await paused.deliverNotifications();assert.equal(calls.length,1);assert.match(calls[0].text,/新套餐上架/);assert.equal(store.listNotifications().length,0);
}));
test('首次部分分类失败，恢复分类先建基线，不误报该分类所有旧套餐为新品',()=>fixture(async({store,service,calls,plan,probe})=>{
 const categories=[{id:'regular',name:'Regular'},{id:'holiday',name:'Holiday'}];store.putProvider({...store.getProvider('test'),categories});
 await probe({categories,plans:[plan('old')],completedCategories:['regular'],failures:[{categoryId:'holiday',categoryName:'Holiday',error:'HTTP 503'}]});
 await probe({categories,plans:[plan('old'),plan('existing-holiday',{categoryId:'holiday'})],completedCategories:['regular','holiday'],failures:[]});await service.deliverNotifications();assert.equal(calls.length,0);assert.equal(store.listEvents().filter(e=>e.type==='new_plan').length,0);
 await probe({plans:[plan('old'),plan('existing-holiday',{categoryId:'holiday'}),plan('new-holiday',{categoryId:'holiday'})]});await service.deliverNotifications();assert.equal(calls.length,1);assert.match(calls[0].text,/new-holiday/);
}));

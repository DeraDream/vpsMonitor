import test from 'node:test';import assert from 'node:assert/strict';import { normalizePlan,reconcilePlan,nextRetry } from '../packages/core/src/monitor-engine.mjs';
const monitor={scope:'all',planIds:[]};const raw=(available,quantity=null)=>normalizePlan({externalId:'ryzen-s',name:'Ryzen S',available,quantity,buyUrl:'https://example.test/buy'},'bero');
test('统一套餐模型拒绝无效状态',()=>{assert.throws(()=>normalizePlan({externalId:'x',name:'X',available:'yes'},'p'));assert.equal(raw(true,3).id,'bero:ryzen-s')});
test('补货周期仅在缺货转有货时创建新通知',()=>{const first=reconcilePlan(raw(false),raw(true,3),monitor);assert.equal(first.action,'restocked');const sent={...first.next,notification:{chatId:'-100',messageId:42}};assert.equal(reconcilePlan(sent,raw(true,3),monitor).action,null)});
test('库存减少和售罄编辑当前卡片',()=>{const active={...raw(true,3),notification:{chatId:'-100',messageId:42}};assert.equal(reconcilePlan(active,raw(true,2),monitor).action,'stock_changed');assert.equal(reconcilePlan(active,raw(false),monitor).action,'sold_out')});
test('重试采用有上限的指数退避',()=>{assert.equal(nextRetry(1,0),new Date(2000).toISOString());assert.equal(nextRetry(20,0),new Date(30*60_000).toISOString())});

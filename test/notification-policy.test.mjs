import test from 'node:test';import assert from 'node:assert/strict';
import {quietHoursStatus,validateQuietHours,beijingTimestamp} from '../packages/core/src/notification-policy.mjs';
const status=(start,end,date)=>quietHoursStatus({quietHours:{enabled:true,start,end}},Date.parse(date));
test('北京时间免打扰跨午夜：开始包含、结束不包含，计算下次结束时间',()=>{
 assert.deepEqual(status('23:00','08:00','2026-10-07T15:00:00Z'),{active:true,resumeAt:'2026-10-08T00:00:00.000Z'});
 assert.equal(status('23:00','08:00','2026-10-07T14:59:59Z').active,false);
 assert.equal(status('23:00','08:00','2026-10-08T00:00:00Z').active,false);
 assert.equal(status('23:00','08:00','2026-10-07T23:59:59Z').active,true);
});
test('同一天免打扰区间与关闭开关，不依赖 VPS 本地时区',()=>{
 const saved=process.env.TZ;process.env.TZ='America/New_York';
 try{assert.equal(status('09:00','18:00','2026-10-07T01:00:00Z').active,true);assert.equal(status('09:00','18:00','2026-10-07T10:00:00Z').active,false);assert.match(beijingTimestamp('2026-10-07T15:30:00Z'),/23:30:00/);assert.equal(quietHoursStatus({quietHours:{enabled:false,start:'00:00',end:'23:59'}}).active,false)}finally{if(saved===undefined)delete process.env.TZ;else process.env.TZ=saved}
});
test('免打扰输入校验：非法时刻、相同时间、字符串布尔值和未知字段拒绝',()=>{
 for(const value of [{start:'24:00'},{end:'08:60'},{start:'8:00'},{enabled:'true'},{start:'08:00',end:'08:00'},{timeZone:'UTC'},null,[]])assert.throws(()=>validateQuietHours(value));
 assert.deepEqual(validateQuietHours({enabled:true}),{enabled:true,start:'23:00',end:'08:00'});
});

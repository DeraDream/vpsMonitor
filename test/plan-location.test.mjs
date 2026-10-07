import test from 'node:test'
import assert from 'node:assert/strict'
import {planLocation} from '../apps/web/src/plan-location.js'
test('绿云地区翻译兼容已采集数据并保留线路和未识别文本',()=>{
 for(const [location,expected] of [['Tokyo, JP (Softbank)','东京, 日本 (Softbank)'],['Staten Island, NY','史泰登岛, 纽约州'],['Los Angeles, CA (Premium)','洛杉矶, 加利福尼亚州 (Premium)'],['Unknown DC (IIJ)','Unknown DC (IIJ)'],['东京, 日本','东京, 日本']]){
  const plan={providerId:'greencloud',location};assert.equal(planLocation(plan),expected);assert.equal(plan.location,location)
 }
 assert.equal(planLocation({providerId:'bero-host',location:'Frankfurt, DE'}),'Frankfurt, DE')
 assert.equal(planLocation({providerId:'greencloud'}),undefined)
})

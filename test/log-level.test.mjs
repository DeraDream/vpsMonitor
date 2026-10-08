import test from 'node:test';
import assert from 'node:assert/strict';
import {logLevel} from '../apps/api/src/log-level.mjs';
test('successful historical monitor summaries show INFO and failed classifications stay ERROR',()=>{
  for(const name of ['Bero Host','GreenCloud','Provider with error in name'])assert.equal(logLevel({PRIORITY:'6',MESSAGE:`[monitor] ${name}: 采集 401 个套餐，失败分类 0 个`}), 'info');
  for(const count of [1,2,10])assert.equal(logLevel({PRIORITY:'6',MESSAGE:`[monitor] GreenCloud: 采集 401 个套餐，失败分类 ${count} 个`}), 'error');
});
test('system errors, request errors, warnings and ordinary messages retain their levels',()=>{
  assert.equal(logLevel({PRIORITY:'3',MESSAGE:'[monitor] Bero Host: 采集 10 个套餐，失败分类 0 个'}),'error');
  for(const message of ['[monitor_failed] 探测失败','[HTTP 500] 请求失败','worker tick failed','Error: timeout'])assert.equal(logLevel({PRIORITY:'6',MESSAGE:message}),'error');
  assert.equal(logLevel({PRIORITY:'4',MESSAGE:'system warning'}),'warn');
  assert.equal(logLevel({PRIORITY:'6',MESSAGE:'ExperimentalWarning: SQLite'}),'warn');
  assert.equal(logLevel({PRIORITY:'6',MESSAGE:'Worker started'}),'info');
});

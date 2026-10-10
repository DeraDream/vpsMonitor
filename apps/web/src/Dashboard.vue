<script setup>
import { computed,onMounted,onUnmounted,reactive,ref,toRaw } from 'vue'
import { api } from './api.js'
defineProps({loginEnabled:Boolean});defineEmits(['logout'])
import webPackage from '../package.json'
import UpdateDialog from './components/UpdateDialog.vue'
import PersonalCenter from './components/PersonalCenter.vue';
import EventFeed from './components/EventFeed.vue';import LogsPage from './components/LogsPage.vue';
import ProviderCard from './components/ProviderCard.vue';import MonitorDialog from './components/MonitorDialog.vue';import SettingsPage from './components/SettingsPage.vue'
const state=reactive({route:location.hash.slice(1)||'overview',dashboard:{stats:{providers:0,monitoredProviders:0,monitoredPlans:0,inStock:0},providers:[],monitors:[],events:[],runtime:{},version:webPackage.version},events:[],settings:null,update:null});const toast=ref(''),toastError=ref(false);const dialog=reactive({open:false,type:'',providerId:null,provider:null,monitor:null,plans:[],categoryId:null,loading:false,error:'',revision:0})
const monitorSaving=ref(false)
const manualRefreshing=ref(false),activePage=ref(null)
const updateChecking=ref(false),updateDialog=reactive({open:false,phase:'confirm',status:null,error:''}),removeDialog=reactive({open:false,id:null,busy:false});let updateTimer,reconnectStarted=0;
const now=ref(Date.now());let refreshTimer;const workerOnline=computed(()=>{const tick=Date.parse(state.dashboard.runtime?.lastTickAt);return Number.isFinite(tick)&&now.value-tick<30000});
const titles={overview:['概览','实时状态'],monitors:['监控','监控任务与事件'],providers:['商家','商家套餐'],logs:['系统','日志'],settings:['设置','设置'],account:['账号','个人中心']};const title=computed(()=>titles[state.route]||titles.overview)
function tip(msg,error=false){toast.value=msg;toastError.value=error;clearTimeout(tip.t);tip.t=setTimeout(()=>toast.value='',2400)}
function clock(v){if(!v)return '尚未运行';return new Date(v).toLocaleString('zh-CN',{hour12:false})}
function monitorState(m){if(!m.enabled)return {key:'paused',label:'已暂停'};if(m.lastError)return {key:'error',label:'监控异常'};if(!m.lastRunAt)return {key:'starting',label:'启动中'};return {key:'healthy',label:'监控正常'}}
async function refresh(options={}){now.value=Date.now();state.dashboard=await api('/api/dashboard');if(options.settings!==false){if(state.route==='settings')await loadSettings();else if(state.route==='account')state.settings=await api('/api/settings')}}
async function manualRefresh(){
 if(manualRefreshing.value)return
 manualRefreshing.value=true
 try{await refresh();await activePage.value?.refresh()}catch(e){tip(e.message,true)}finally{manualRefreshing.value=false}
}
async function loadSettings(){state.settings=await api('/api/settings');await checkUpdate(false)}
async function checkUpdate(prompt=true){
 if(updateChecking.value)return;updateChecking.value=true
 try{state.update=await api('/api/updates/status');if(state.update.checkError)tip(state.update.message,true);else if(state.update.updateAvailable&&state.update.deployReady&&prompt===true){Object.assign(updateDialog,{open:true,phase:'confirm',error:'',status:null})}else if(prompt===true)tip(state.update.message,!state.update.deployReady&&state.update.updateAvailable)}catch(e){tip(e.message,true)}finally{updateChecking.value=false}
}
async function watchUpdate(){
 clearTimeout(updateTimer)
 try{
  const status=await api('/api/updates/progress');updateDialog.status=status;updateDialog.error='';reconnectStarted=0
  if(status.state==='completed'){location.reload();return}
  if(status.state==='failed'){updateDialog.phase='failed';return}
  if(status.state==='idle'){updateDialog.phase='failed';updateDialog.error='服务没有正在进行的更新，请重新检查';return}
 }catch(e){if(!reconnectStarted)reconnectStarted=Date.now();updateDialog.error='服务正在重启或连接暂时中断，正在重试…';if(Date.now()-reconnectStarted>90000){updateDialog.phase='failed';updateDialog.error='等待服务恢复超时，请检查服务状态后重新连接';return}}
 updateTimer=setTimeout(watchUpdate,1500)
}
async function resumeUpdate(){try{const status=await api('/api/updates/progress');if(['checking','downloading','verifying','extracting','backing_up','installing','restarting'].includes(status.state)){Object.assign(updateDialog,{open:true,phase:'running',status,error:''});watchUpdate()}}catch{}}
function retryUpdate(){updateDialog.open=false;checkUpdate(true)}
function onHash(){const route=location.hash.slice(1)||'overview';state.route=route==='events'?'monitors':route;if(state.route==='settings')loadSettings().catch(e=>tip(e.message,true));else if(state.route==='account')api('/api/settings').then(settings=>state.settings=settings).catch(e=>tip(e.message,true));}
let planRequest=0
async function openMonitor(providerId=null,monitor=null){
 const active=monitor?.providerId||providerId,existing=monitor||state.dashboard.monitors.find(m=>m.providerId===active)||null;
 const request=++planRequest;
 Object.assign(dialog,{type:'monitor',categoryId:null,providerId:active,provider:state.dashboard.providers.find(p=>p.id===active)||null,monitor:existing?structuredClone(toRaw(existing)):null,plans:[],loading:!!active,error:'',open:true,revision:dialog.revision+1});
 if(!active)return;
 try{const plans=await api(`/api/providers/${active}/plans`);if(request===planRequest&&dialog.open)dialog.plans=plans}catch(e){if(request===planRequest&&dialog.open)dialog.error=e.message}finally{if(request===planRequest)dialog.loading=false}
}
async function openPlans(provider,categoryId=null){const request=++planRequest;Object.assign(dialog,{categoryId,type:'plans',providerId:provider.id,provider,monitor:null,plans:[],loading:true,error:'',open:true,revision:dialog.revision+1});try{const plans=await api(`/api/providers/${provider.id}/plans`);if(request===planRequest&&dialog.open)dialog.plans=plans}catch(e){if(request===planRequest&&dialog.open)dialog.error=e.message}finally{if(request===planRequest)dialog.loading=false}}
async function saveMonitor(payload){
 if(monitorSaving.value)return;monitorSaving.value=true
 try{const saved=await api(dialog.monitor?.id?`/api/monitors/${dialog.monitor.id}`:'/api/monitors',{method:dialog.monitor?.id?'PATCH':'POST',body:JSON.stringify(payload)});const index=state.dashboard.monitors.findIndex(m=>m.id===saved.id);if(index<0)state.dashboard.monitors.push(saved);else state.dashboard.monitors[index]=saved;dialog.open=false;tip('监控任务已保存');await refresh()}catch(e){tip(e.message,true)}finally{monitorSaving.value=false}
}

async function runMonitor(id){try{await api(`/api/monitors/${id}/run`,{method:'POST',body:'{}'});await refresh();tip('已完成一次探测')}catch(e){await refresh();tip(e.message,true)}}
function removeMonitor(id){Object.assign(removeDialog,{open:true,id,busy:false})}
async function confirmRemove(){removeDialog.busy=true;try{await api(`/api/monitors/${removeDialog.id}`,{method:'DELETE'});removeDialog.open=false;await refresh();tip('监控任务已删除')}catch(e){tip(e.message,true)}finally{removeDialog.busy=false}}
async function saveTelegram(x){try{await api('/api/settings',{method:'PUT',body:JSON.stringify({telegram:x})});await loadSettings();tip('Telegram 设置已保存')}catch(e){tip(e.message,true)}}
async function testTelegram(target,silent=false){try{const result=await api('/api/telegram/test',{method:'POST',body:JSON.stringify({target,silent})});if(result.ok)tip(silent?'静默测试消息已发送':'测试消息已发送');else tip(result.results.filter(item=>!item.ok).map(item=>`${item.target==='personal'?'个人私聊':'频道'}：${item.error}`).join('；'),true)}catch(e){tip(e.message,true)}}
async function sendPreview(status){try{const result=await api('/api/telegram/preview/send',{method:'POST',body:JSON.stringify({status})});if(result.ok)tip('模拟卡片已发送');else tip(result.results.filter(item=>!item.ok).map(item=>`${item.target==='personal'?'个人私聊':'频道'}：${item.error}`).join('；'),true)}catch(e){tip(e.message,true)}}
async function applyUpdate(){
 if(updateDialog.phase==='running')return
 Object.assign(updateDialog,{phase:'running',error:'',status:{state:'checking',progress:0,message:'正在确认更新版本…'}})
 try{updateDialog.status=await api('/api/updates/apply',{method:'POST',body:JSON.stringify({targetVersion:state.update?.remoteVersion,remoteRevision:state.update?.remoteRevision})});watchUpdate()}catch(e){Object.assign(updateDialog,{phase:'failed',error:e.message})}
}
function openUpdate(){if(state.update?.updateAvailable&&state.update.deployReady)Object.assign(updateDialog,{open:true,phase:'confirm',error:'',status:null})}
onMounted(()=>{onHash();window.addEventListener('hashchange',onHash);refresh().catch(e=>tip(e.message,true));resumeUpdate();refreshTimer=setInterval(()=>refresh({settings:false}).catch(()=>{}),10000)});onUnmounted(()=>{window.removeEventListener('hashchange',onHash);clearInterval(refreshTimer);clearTimeout(tip.t);clearTimeout(updateTimer)})
</script>
<template><div class="app-shell"><aside class="sidebar"><a class="brand" href="#overview"><span class="brand-mark">V</span><span>VPS Monitor</span></a><div class="sidebar-version">控制台 · v{{state.dashboard.version||webPackage.version}}</div><div class="runtime" :class="{ready:workerOnline}"><i></i><span>{{workerOnline?'监控服务运行中':state.dashboard.runtime?.lastTickAt?'监控服务已离线':'监控服务待配置'}}</span></div><p class="nav-caption">工作台</p><nav><a v-for="x in [['overview','概览','⌂'],['monitors','监控','◉'],['providers','商家','▦'],['logs','日志','≡'],['settings','设置','⚙']]" :key="x[0]" :href="`#${x[0]}`" class="nav-link" :class="{active:state.route===x[0]}"><span class="nav-icon" aria-hidden="true">{{x[2]}}</span>{{x[1]}}</a></nav><div class="sidebar-foot"><a class="nav-link" href="/"><span class="nav-icon" aria-hidden="true">↗</span>返回前台</a><a class="nav-link" href="#account" :class="{active:state.route==='account'}"><span class="nav-icon" aria-hidden="true">◌</span>个人中心</a><button v-if="loginEnabled" class="nav-link sidebar-logout" @click="$emit('logout')"><span class="nav-icon" aria-hidden="true">↪</span>退出登录</button></div></aside>
<main><header class="topbar"><div><p class="eyebrow">{{title[0]}}</p><h1>{{title[1]}}</h1></div><div class="topbar-actions"><span class="topbar-status" :class="{online:workerOnline}"><i></i>{{workerOnline?'服务在线':'等待服务'}}</span><button class="button secondary refresh-button" :disabled="manualRefreshing" :aria-busy="manualRefreshing" @click="manualRefresh"><span v-if="manualRefreshing" class="refresh-spinner" aria-hidden="true"></span>{{manualRefreshing?'刷新中…':'立即刷新'}}</button></div></header><section id="view">
<template v-if="state.route==='overview'"><section class="stats"><article class="stat"><span class="stat-icon providers" aria-hidden="true">▦</span><p>已接入商家</p><strong>{{state.dashboard.stats.providers}}</strong></article><article class="stat"><span class="stat-icon monitors" aria-hidden="true">◉</span><p>已启用监控</p><strong>{{state.dashboard.stats.monitoredProviders}}</strong></article><article class="stat"><span class="stat-icon plans" aria-hidden="true">▤</span><p>监控套餐</p><strong>{{state.dashboard.stats.monitoredPlans}}</strong></article><article class="stat"><span class="stat-icon stock" aria-hidden="true">↗</span><p>当前有货</p><strong>{{state.dashboard.stats.inStock}}</strong><p v-if="state.dashboard.stats.orderable" class="hint">另有 {{state.dashboard.stats.orderable}} 个可订购，库存未公开</p></article></section><div class="section-head"><div><h2>商家套餐</h2><p>商家页面只展示套餐与分类信息。</p></div><a class="button secondary" href="#providers">查看商家 <span aria-hidden="true">→</span></a></div><section v-if="state.dashboard.providers.length" class="provider-grid"><ProviderCard v-for="p in state.dashboard.providers" :key="p.id" :provider="p" @plans="openPlans(p)"/></section><div v-else class="empty">还没有已接入商家。商家 Adapter 发布后会自动显示在这里。</div></template>
<template v-else-if="state.route==='providers'"><div class="section-head"><div><h2>已接入商家</h2><p>查看各商家的分类、套餐、有货与可订购数量。</p></div></div><section v-if="state.dashboard.providers.length" class="provider-grid"><ProviderCard v-for="p in state.dashboard.providers" :key="p.id" :provider="p" @plans="openPlans(p)"/></section><div v-else class="empty">暂无已接入商家。新增商家需要开发 Adapter 并随版本发布。</div></template>
<template v-else-if="state.route==='monitors'"><div class="section-head"><div><h2>监控任务</h2><p>监控状态、探测异常与库存事件统一在此查看。</p></div><button class="button" @click="openMonitor()">添加监控</button></div><section v-if="state.dashboard.monitors.length" class="monitor-grid"><article v-for="m in state.dashboard.monitors" :key="m.id" class="panel monitor-card"><div class="provider-top"><div><h3><span class="signal" :class="monitorState(m).key"></span> {{m.providerName}}</h3><p class="meta">{{m.scope==='all'?'全部套餐':m.scope==='categories'?'已选分类':'已选套餐'}} · {{m.planCount}} 个套餐 · 每 {{m.intervalSeconds}} 秒</p></div><span class="badge monitor-state" :class="monitorState(m).key">{{monitorState(m).label}}</span></div><p class="meta">{{m.lastError?`最近失败：${m.lastError}`:`最后检测：${clock(m.lastRunAt)}`}}</p><div class="card-actions"><span class="meta">连续失败：{{m.consecutiveFailures||0}}</span><div class="button-pair"><button class="button ghost" @click="runMonitor(m.id)">立即运行</button><button class="button secondary" @click="openMonitor(null,m)">编辑</button><button class="button ghost" @click="removeMonitor(m.id)">删除</button></div></div></article></section><div v-else class="empty">还没有监控任务。添加任务后，系统会按设定间隔运行对应商家的 Adapter。</div><section class="monitor-events"><div class="section-head"><div><h2>库存事件</h2><p>新上架、补货、售罄和库存变化。</p></div></div><EventFeed ref="activePage"/></section></template>
<template v-else-if="state.route==='logs'"><LogsPage ref="activePage"/></template>
<PersonalCenter v-else-if="state.route==='account'&&state.settings" ref="activePage" :settings="state.settings"/>
<SettingsPage v-else-if="state.route==='settings'&&state.settings" :settings="state.settings" :update="state.update" :update-checking="updateChecking" @save-telegram="saveTelegram" @test-telegram="testTelegram" @send-preview="sendPreview" @check-update="checkUpdate" @apply-update="openUpdate"/>
</section></main><MonitorDialog v-if="dialog.open" :key="dialog.revision" :dialog="dialog" :saving="monitorSaving" :providers="state.dashboard.providers" :monitors="state.dashboard.monitors" @close="dialog.open=false" @save="saveMonitor" @change-provider="openMonitor($event,null)"/><UpdateDialog v-if="updateDialog.open" :update="state.update" :status="updateDialog.status" :phase="updateDialog.phase" :error="updateDialog.error" @confirm="applyUpdate" @close="updateDialog.open=false" @retry="retryUpdate"/><div v-if="removeDialog.open" class="dialog-backdrop"><section class="dialog-card update-dialog" role="dialog" aria-modal="true" aria-labelledby="remove-title"><h2 id="remove-title">删除监控任务？</h2><p class="hint">删除后将停止该商家的监控任务和待发送通知。</p><div class="controls modal-actions"><button class="button secondary" :disabled="removeDialog.busy" @click="removeDialog.open=false">取消</button><button class="button" :disabled="removeDialog.busy" @click="confirmRemove">{{removeDialog.busy?'正在删除…':'确定删除'}}</button></div></section></div><div class="toast" role="status" aria-live="polite" :class="{show:toast,error:toastError}">{{toast}}</div></div></template>

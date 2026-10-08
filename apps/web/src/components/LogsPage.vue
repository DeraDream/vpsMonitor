<script setup>
import {ref,onMounted,onUnmounted,nextTick,watch} from 'vue'
import {api} from '../api.js'
const logs=ref([]),live=ref(true),error=ref(''),loading=ref(false),box=ref(null),updated=ref('')
let cursor=null,timer,alive=true
const clock=v=>new Date(v).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})
async function load(){if(loading.value)return;loading.value=true;try{const result=await api(`/api/logs${cursor?'?cursor='+encodeURIComponent(cursor):''}`);if(!alive)return;cursor=result.cursor;const seen=new Set(logs.value.map(e=>e.id));logs.value=[...logs.value,...result.items.filter(e=>!seen.has(e.id))].slice(-1000);error.value='';updated.value=clock(new Date());await nextTick();if(live.value&&box.value)box.value.scrollTop=box.value.scrollHeight}catch(e){if(alive)error.value=e.message}finally{loading.value=false}}
defineExpose({refresh:async()=>{if(loading.value)await new Promise(resolve=>{const stop=watch(loading,value=>{if(!value){stop();resolve()}})});return load()}})
watch(live,value=>{if(value)load()})
onMounted(()=>{load();timer=setInterval(()=>{if(live.value)load()},2000)})
onUnmounted(()=>{alive=false;clearInterval(timer)})
</script>
<template><section class="logs-page"><div class="logs-toolbar"><div><h2>服务端日志</h2><p>API 与监控服务 · 北京时间 · 屏幕内保留最近 1000 条</p></div><div class="logs-controls"><span class="logs-status" :class="{live}">{{live?'● 实时滚动中':'Ⅱ 已暂停'}}</span><button class="button secondary" @click="live=!live">{{live?'暂停实时滚动':'开启实时滚动'}}</button><button class="button secondary" :disabled="loading" @click="load">刷新日志</button></div></div><p v-if="error" role="alert" class="logs-error">日志读取失败：{{error}}</p><div ref="box" class="logs-console" role="log" :aria-live="live?'polite':'off'" aria-label="服务端运行日志"><div v-for="entry in logs" :key="entry.id" class="log-line" :class="entry.level"><time>{{clock(entry.at)}}</time><span class="log-source">{{entry.source}}</span><span class="log-level">{{entry.level.toUpperCase()}}</span><pre>{{entry.message}}</pre></div><p v-if="!logs.length">{{loading?'正在连接服务端日志…':'暂无服务日志'}}</p></div><p class="logs-foot">{{live?'每 2 秒获取新日志并滚动到底部':'已暂停获取和自动滚动，开启后继续加载暂停期间的日志'}}<span v-if="updated"> · 更新于 {{updated}}</span></p></section></template>

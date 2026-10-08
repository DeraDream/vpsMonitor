<script setup>
import {computed,ref,onMounted,onUnmounted,nextTick,watch} from 'vue'
import {api} from '../api.js'
import {useActivityRefresh} from '../activity-refresh.js'
import EventList from './EventList.vue'
const props=defineProps({publicView:Boolean})
const items=ref([]),cursor=ref(null),type=ref(''),loading=ref(false),error=ref(''),sentinel=ref(null),ready=ref(false)
let observer,revision=0,alive=true
const draft=ref(10),saving=ref(false),saveMessage=ref(''),saveError=ref(false)
const {interval,apply}=useActivityRefresh(()=>load(false,true))
watch(interval,value=>{draft.value=value})
async function saveInterval(){saving.value=true;saveMessage.value='';saveError.value=false;try{const settings=await api('/api/activity/settings',{method:'PUT',body:JSON.stringify({refreshIntervalSeconds:draft.value})});apply(settings.refreshIntervalSeconds);saveMessage.value='已保存，前后台同步生效'}catch(e){saveMessage.value=e.message;saveError.value=true}finally{saving.value=false}}
const filters=[['','全部'],['restocked','补货'],['sold_out','售罄'],['new_plan','新上架'],['stock_changed','库存变化'],['delisted','下架']]
const emptyLabel=computed(()=>filters.find(([value])=>value===type.value)?.[1]||'全部')
async function load(more=false,refresh=false){
 if(loading.value||more&&!cursor.value)return
 const version=revision;loading.value=true;error.value=''
 try{const params=new URLSearchParams({limit:'30'});if(type.value)params.set('type',type.value);if(more)params.set('cursor',cursor.value)
 const result=await api(`${props.publicView?'/api/public/events':'/api/events'}?${params}`)
 if(!alive||version!==revision)return
 if(more){const seen=new Set(items.value.map(e=>e.id));items.value.push(...result.items.filter(e=>!seen.has(e.id)));cursor.value=result.nextCursor}
 else if(refresh&&items.value.length){const merged=new Map([...items.value,...result.items].map(e=>[e.id,e]));items.value=[...merged.values()].sort((a,b)=>b.at.localeCompare(a.at)||b.id.localeCompare(a.id));if(items.value.length<=30)cursor.value=result.nextCursor}
 else{items.value=result.items;cursor.value=result.nextCursor}
 ready.value=true
 }catch(e){if(version===revision)error.value=e.message}finally{if(version===revision)loading.value=false}
}
defineExpose({refresh:async()=>{if(loading.value)await new Promise(resolve=>{const stop=watch(loading,value=>{if(!value){stop();resolve()}})});return load(false,true)}})
watch(type,async()=>{revision++;loading.value=false;ready.value=false;items.value=[];cursor.value=null;await load();await nextTick();if(sentinel.value){observer?.unobserve(sentinel.value);observer?.observe(sentinel.value)}})
onMounted(async()=>{await load();if(!alive)return;observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)&&ready.value&&!error.value)load(true)},{rootMargin:'120px'});if(sentinel.value)observer.observe(sentinel.value)})
onUnmounted(()=>{alive=false;revision++;observer?.disconnect()})
</script>
<template><div class="event-feed"><div v-if="!publicView" class="section-head activity-heading"><div><h2>补货动态</h2><p>上架、补货与库存变化记录 · 北京时间</p></div><div class="activity-refresh-control"><form @submit.prevent="saveInterval"><label for="activity-refresh-seconds">补货动态刷新间隔</label><input id="activity-refresh-seconds" v-model.number="draft" type="number" min="1" max="3600" step="1" required><span>秒</span><button class="button secondary" :disabled="saving">{{saving?'保存中…':'保存'}}</button></form><small v-if="saveMessage" :class="{error:saveError}" role="status">{{saveMessage}}</small></div></div><div class="activity-filters" aria-label="动态类型"><button v-for="[value,label] in filters" :key="value" :class="{active:type===value}" :aria-pressed="type===value" @click="type=value">{{label}}</button></div><EventList v-if="ready" :events="items" :empty-label="emptyLabel"/><div ref="sentinel" class="activity-load"><span v-if="loading">正在加载动态…</span><template v-else-if="error"><span role="alert">{{error}}</span> <button @click="load(!!cursor)">重试</button></template><button v-else-if="cursor" @click="load(true)">加载更多</button><span v-else-if="ready&&items.length">已显示全部动态</span></div></div></template>

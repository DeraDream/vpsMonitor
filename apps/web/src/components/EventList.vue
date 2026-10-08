<script setup>
import {computed} from 'vue'
import {planLocation} from '../plan-location.js'
const props=defineProps({events:Array,clock:Function,emptyLabel:{type:String,default:"全部"}})
const labels={new_plan:'新上架',restocked:'补货',sold_out:'售罄',stock_changed:'库存变化',delisted:'下架'}
const date=v=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(v))
const time=v=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(v))
const groups=computed(()=>{const result=[];for(const event of props.events||[]){const day=date(event.at);let group=result.at(-1);if(group?.day!==day){group={day,events:[]};result.push(group)}group.events.push(event)}return result})
</script>
<template><div v-if="events?.length" class="activity-timeline public-events"><section v-for="group in groups" :key="group.day" class="activity-day"><header class="activity-date"><span>{{group.day}}</span><small>北京时间 · UTC+8</small></header><div class="activity-rows"><article v-for="e in group.events" :key="e.id" class="activity-row" :class="e.type"><span class="activity-dot" aria-hidden="true">{{e.type==='restocked'?'↑':e.type==='sold_out'?'↓':'·'}}</span><time :datetime="e.at">{{time(e.at)}}</time><div class="activity-body"><div class="activity-title"><span class="activity-badge" :class="e.type">{{labels[e.type]}}</span><a :href="`/#merchants/${encodeURIComponent(e.providerId||'')}`" class="activity-merchant">{{e.providerName||e.providerId||'未知商家'}}</a></div><p>{{e.snapshot?.name||e.message}}</p><small v-if="e.snapshot" class="activity-meta">{{[e.snapshot.price,e.snapshot.specs,planLocation({providerId:e.providerId,location:e.snapshot.location}),Number.isInteger(e.snapshot.quantity)?`库存 ${e.snapshot.quantity} 台`:null].filter(Boolean).join(' · ')}}</small></div></article></div></section></div><div v-else class="empty">暂无{{emptyLabel}}状态</div></template>

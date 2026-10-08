<script setup>
import {computed,ref,watch} from 'vue'
const props=defineProps({provider:Object,monitors:Array})
defineEmits(['monitor','plans'])
const monitor=computed(()=>props.monitors?.find(m=>m.providerId===props.provider.id))
const categories=computed(()=>(monitor.value?.categories?.length?monitor.value.categories:props.provider.categories||[]).filter(c=>!c.retired))
const selectedCategory=ref('')
watch(categories,value=>{if(!value.some(c=>c.id===selectedCategory.value))selectedCategory.value=value[0]?.id||''},{immediate:true})
const selected=computed(()=>categories.value.find(c=>c.id===selectedCategory.value))
const collected=computed(()=>categories.value.some(c=>Number.isInteger(c.planCount)))
const total=computed(()=>collected.value?categories.value.reduce((sum,c)=>sum+(c.planCount||0),0):null)
const available=computed(()=>collected.value?categories.value.reduce((sum,c)=>sum+(c.inStock||0)+(c.orderable||0),0):null)
const state=computed(()=>!monitor.value?'未配置':monitor.value.enabled?'监控中':'已暂停')
const categoryState=computed(()=>selected.value?.lastError?'探测异常':Number.isInteger(selected.value?.planCount)?'采集正常':'等待采集')
</script>
<template><article class="provider-card provider-unified"><header class="merchant-card-header"><div class="merchant-card-identity"><span class="merchant-avatar" aria-hidden="true">{{provider.name.slice(0,1)}}</span><div><h3 :title="provider.name">{{provider.name}}</h3><p>Adapter v{{provider.adapterVersion||'0.0.0'}}</p></div></div><span class="merchant-monitor-status" :class="{enabled:monitor?.enabled}"><i aria-hidden="true"></i>{{state}}</span></header><dl class="merchant-summary"><div><dt>分类</dt><dd>{{categories.length}}</dd></div><div><dt>当前套餐</dt><dd>{{total??'—'}}</dd></div><div><dt>有货 / 可订购</dt><dd>{{available??'—'}}</dd></div></dl><section class="merchant-category-area"><div class="merchant-category-heading"><label :for="`provider-category-${provider.id}`">浏览分类</label><span :class="{warning:selected?.lastError}" :title="selected?.lastError||categoryState">{{categories.length?categoryState:'暂无分类'}}</span></div><select :id="`provider-category-${provider.id}`" v-model="selectedCategory" :disabled="!categories.length"><option v-if="!categories.length" value="">尚未采集到分类</option><option v-for="category in categories" :key="category.id" :value="category.id">{{category.name}} · {{category.planCount===undefined?'等待采集':`${category.planCount} 个套餐`}}{{category.lastError?' · 探测异常':''}}</option></select><p class="merchant-category-detail"><template v-if="selected"><span>套餐 <strong>{{selected.planCount??'—'}}</strong></span><span>有货 <strong>{{selected.inStock??'—'}}</strong></span><span>可订购 <strong>{{selected.orderable??'—'}}</strong></span></template><span v-else>首次成功采集后显示分类与库存</span></p></section><footer class="merchant-card-actions"><button class="button ghost" @click="$emit('plans',selectedCategory||undefined)">{{categories.length?'查看分类套餐':'查看全部套餐'}}</button><button class="button secondary" @click="$emit('monitor')">{{monitor?'编辑监控':'添加监控'}}</button></footer></article></template>

<script setup>
import { computed } from 'vue'
const props=defineProps({provider:Object,monitors:Array});defineEmits(['monitor','plans'])
const monitor=computed(()=>props.monitors.find(m=>m.providerId===props.provider.id))
</script>
<template><article class="provider-card"><div class="provider-top"><h3>{{provider.name}}</h3><span class="badge">{{provider.adapterKey}}</span></div><p class="meta">Adapter {{provider.adapterVersion||'0.0.0'}}</p><div class="bar"><span :style="{width:monitor?.enabled?'100%':'0%'}"></span></div><div class="card-actions"><span class="meta">{{monitor?.enabled?'监控中':'未监控'}}</span><div class="button-pair"><button class="button ghost" @click="$emit('plans')">套餐</button><button class="button secondary" @click="$emit('monitor')">{{monitor?'编辑监控':'添加监控'}}</button></div></div></article></template>

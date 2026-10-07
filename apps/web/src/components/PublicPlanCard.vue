<script setup>
import {planLocation} from '../plan-location.js'
import PlanDetails from './PlanDetails.vue'
defineProps({plan:Object,providerName:String})
const stock=p=>!p.available?'已售罄':Number.isInteger(p.quantity)?`有货 · ${p.quantity} 台`:'可订购 · 数量未公开'
</script>
<template><article class="public-plan"><div class="public-plan-top"><a :href="`/#merchants/${encodeURIComponent(plan.providerId)}`">{{providerName}}</a><span class="public-stock" :class="{sold:!plan.available}">{{stock(plan)}}</span></div><h2>{{plan.name}}</h2><p class="public-location">{{planLocation(plan)||plan.categoryName||'地区未公开'}}</p><PlanDetails :plan="plan"/><footer><div class="public-price">{{plan.price||'价格未公开'}}<small v-if="plan.billingCycle"> / {{plan.billingCycle}}</small></div><a v-if="/^https?:\/\//i.test(plan.buyUrl)" :href="plan.buyUrl" target="_blank" rel="noopener noreferrer">购买页 ↗</a></footer></article></template>

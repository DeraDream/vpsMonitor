<script setup>
defineProps({events:Array,clock:Function})
</script>
<template>
<section v-if="events?.length" class="panel"><article v-for="e in events" :key="e.id" class="event"><time>{{clock(e.at)}}</time><div><p>{{e.message}}</p><small>{{e.providerName||'系统'}}</small></div></article></section>
<div v-else class="empty">还没有套餐动态。新上架、补货、售罄与库存变化后会显示在这里。</div>
</template>

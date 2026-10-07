<script setup>
defineProps({events:Array,clock:Function})
</script>
<template>
<section v-if="events?.length" class="panel"><article v-for="e in events" :key="e.id" class="event"><time>{{clock(e.at)}}</time><div><p>{{e.message}}</p><small>{{e.providerName||'系统'}}</small></div></article></section>
<div v-else class="empty">还没有事件。接入商家 Adapter 并启用监控后，补货与 TG 推送记录会显示在这里。</div>
</template>

<script setup>
import { computed } from 'vue'
const props=defineProps({plan:Object})
const fields=[['cpu','CPU'],['ram','RAM'],['storage','Disk'],['storageType','Disk type'],['nvme','NVMe'],['ipv4','IPv4'],['ipv6','IPv6'],['backups','Backups'],['runtime','Laufzeit / Runtime'],['bandwidth','Bandwidth'],['portSpeed','Port'],['os','OS'],['controlPanel','Control Panel'],['virtualization','Virtualization']]
const rows=computed(()=>props.plan.configuration?.length?props.plan.configuration:fields.filter(([key])=>props.plan[key]!==undefined&&props.plan[key]!==null&&props.plan[key]!=='').map(([key,label])=>({label,value:props.plan[key]})))
</script>
<template><dl v-if="rows.length" class="plan-details"><div v-for="(row,index) in rows" :key="`${row.label}-${index}`"><dt>{{row.label}}</dt><dd>{{row.value}}</dd></div></dl><p v-else-if="plan.specs" class="meta plan-legacy-specs">{{plan.specs}}</p><p v-else class="hint">商家尚未提供套餐配置</p></template>

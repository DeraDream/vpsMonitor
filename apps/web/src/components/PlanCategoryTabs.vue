<script setup>
defineProps({ groups: Array, active: String })
defineEmits(['change'])
</script>
<template>
  <div v-if="groups.length > 6" class="field category-selector"><label for="plan-category-select">套餐分类</label><select id="plan-category-select" :value="active" @change="$emit('change',$event.target.value)"><option v-for="group in groups" :key="group.id" :value="group.id">{{group.name}} · {{group.plans.length}} 个套餐{{group.retired?'（已移出目录）':''}}</option></select></div>
  <nav v-else-if="groups.length > 1" class="category-tabs" role="tablist" aria-label="套餐种类">
    <button v-for="group in groups" :key="group.id" class="button category-tab"
      :class="{ secondary: active !== group.id }" role="tab" :aria-selected="active === group.id"
      :aria-controls="`plans-${group.id}`" @click="$emit('change', group.id)">
      {{ group.name }} <span>{{ group.plans.length }}</span>
    </button>
  </nav>
</template>

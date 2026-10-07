<script setup>
defineProps({ groups: Array, active: String })
defineEmits(['change'])
</script>
<template>
  <nav v-if="groups.length > 1" class="category-tabs" role="tablist" aria-label="套餐种类">
    <button v-for="group in groups" :key="group.id" class="button category-tab"
      :class="{ secondary: active !== group.id }" role="tab" :aria-selected="active === group.id"
      :aria-controls="`plans-${group.id}`" @click="$emit('change', group.id)">
      {{ group.name }} <span>{{ group.plans.length }}</span>
    </button>
  </nav>
</template>

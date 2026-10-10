<script setup>
import {computed} from 'vue'
const props=defineProps({provider:Object})
defineEmits(['plans'])
const categories=computed(()=> (props.provider.categories||[]).filter(category=>!category.retired))
const total=computed(()=>categories.value.reduce((sum,category)=>sum+(category.planCount||0),0))
const inStock=computed(()=>categories.value.reduce((sum,category)=>sum+(category.inStock||0),0))
const orderable=computed(()=>categories.value.reduce((sum,category)=>sum+(category.orderable||0),0))
</script>

<template>
  <article class="provider-card provider-unified">
    <header class="merchant-card-header">
      <div class="merchant-card-identity">
        <span class="merchant-avatar" aria-hidden="true">{{provider.name.slice(0,1)}}</span>
        <div><h3 :title="provider.name">{{provider.name}}</h3><p>Adapter v{{provider.adapterVersion||'0.0.0'}}</p></div>
      </div>
    </header>
    <dl class="merchant-summary">
      <div><dt>分类</dt><dd>{{categories.length}}</dd></div>
      <div><dt>套餐</dt><dd>{{total}}</dd></div>
      <div><dt>有货</dt><dd>{{inStock}}</dd></div>
      <div><dt>可订购</dt><dd>{{orderable}}</dd></div>
    </dl>
    <p class="merchant-category-note">{{categories.length?`共 ${categories.length} 个分类，查看套餐时可在顶部切换分类。`:'首次成功采集后显示分类与套餐。'}}</p>
    <footer class="merchant-card-actions"><button class="button secondary" @click="$emit('plans')">查看套餐</button></footer>
  </article>
</template>

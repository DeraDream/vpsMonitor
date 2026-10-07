<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { groupPlans } from '../plan-groups.js'
import PlanCategoryTabs from './PlanCategoryTabs.vue'
const props = defineProps({ dialog: Object, providers: Array, monitors: Array })
const emit = defineEmits(['close', 'save', 'change-provider'])
const form = reactive({ providerId: props.dialog.providerId, enabled: props.dialog.monitor?.enabled !== false,
  scope: props.dialog.monitor?.scope || 'all', planIds: [...(props.dialog.monitor?.planIds || [])],
  intervalSeconds: props.dialog.monitor?.intervalSeconds || 60 })
const groups = computed(() => groupPlans(props.dialog.plans, props.dialog.provider?.categories))
const activeId = ref(props.dialog.categoryId || groups.value[0]?.id)
const active = computed(() => groups.value.find(group => group.id === activeId.value) || groups.value[0])
const categoryStatus = computed(() => props.monitors.find(monitor => monitor.providerId === props.dialog.providerId)?.categoryStatuses?.[active.value?.id])
watch(() => props.dialog.providerId, value => { form.providerId = value; form.planIds = []; activeId.value = groups.value[0]?.id })
function submit() { emit('save', { ...form, planIds: [...form.planIds] }) }
function selectCategory() {
  form.scope = 'selected'
  form.planIds = [...new Set([...form.planIds, ...active.value.plans.map(plan => plan.id)])]
}
</script>
<template>
  <div class="dialog-backdrop" @click.self="$emit('close')"><section class="dialog-card">
    <button class="close" aria-label="关闭弹窗" @click="$emit('close')">×</button>
    <template v-if="dialog.type === 'plans'">
      <h2>{{ dialog.provider?.name }} 套餐</h2>
      <PlanCategoryTabs :groups="groups" :active="active?.id" @change="activeId = $event" />
      <section v-if="active" :id="`plans-${active.id}`" role="tabpanel" :aria-label="active.name">
        <h3>{{ active.name }}</h3>
        <p class="hint">{{ active.plans.length }} 个套餐 · {{ active.plans.filter(plan => plan.available).length }} 个有货</p>
        <p v-if="categoryStatus?.lastError" class="category-warning">本系列探测失败，以下保留上次状态：{{ categoryStatus.lastError }}</p>
        <p v-if="categoryStatus?.lastSuccessAt" class="hint">最后成功更新：{{ new Date(categoryStatus.lastSuccessAt).toLocaleString('zh-CN') }}</p>
        <section v-if="active.plans.length" class="plan-grid modal-plans">
          <article v-for="plan in active.plans" :key="plan.id" class="plan-card">
            <p class="meta">{{ plan.location || '未标注地区' }}</p><h3>{{ plan.name }}</h3>
            <p class="meta">{{ plan.specs }}</p><p class="price">{{ plan.price || '价格未知' }}{{ plan.billingCycle ? ` / ${plan.billingCycle}` : '' }}</p>
            <p class="status" :class="{ available: plan.available }">{{ categoryStatus?.lastError ? '上次状态：' : '' }}{{ plan.available ? '有货' : '缺货' }}</p>
            <a v-if="plan.buyUrl" class="button secondary" :href="plan.buyUrl" target="_blank" rel="noopener noreferrer">查看商家页面</a>
          </article>
        </section>
        <div v-else class="empty">该系列尚未抓取到套餐，成功探测后会自动显示。</div>
      </section>
      <div v-else class="empty">尚未抓取到套餐，成功探测后会自动显示。</div>
      <div class="controls modal-actions"><button class="button ghost" @click="$emit('close')">关闭</button></div>
    </template>
    <template v-else>
      <h2>{{ dialog.monitor ? '编辑' : '添加' }}监控任务</h2>
      <p class="hint">每个商家一个任务，可同时监控不同系列。</p>
      <div class="field"><label>商家</label><select v-model="form.providerId" :disabled="!!dialog.monitor" @change="$emit('change-provider', form.providerId)">
        <option v-for="provider in providers.filter(p => !monitors.some(m => m.providerId === p.id) || p.id === dialog.monitor?.providerId)" :key="provider.id" :value="provider.id">{{ provider.name }}</option>
      </select></div>
      <label class="check"><input type="checkbox" v-model="form.enabled"> 启用监控</label>
      <label class="scope-option"><input type="radio" value="all" v-model="form.scope"><span><b>监控全部套餐</b><br>包含所有系列，商家新增的套餐也自动纳入。</span></label>
      <label class="scope-option"><input type="radio" value="selected" v-model="form.scope"><span><b>只监控指定套餐</b><br>在不同系列中分别勾选，切换系列保留选择。</span></label>
      <PlanCategoryTabs :groups="groups" :active="active?.id" @change="activeId = $event" />
      <section v-if="active" :id="`plans-${active.id}`" role="tabpanel" :aria-label="active.name">
        <h3>{{ active.name }}</h3>
        <p v-if="categoryStatus?.lastError" class="category-warning">本系列探测失败，保留上次套餐列表。</p>
        <button v-if="active.plans.length" class="button ghost" @click="selectCategory">选择此系列全部套餐</button>
        <div class="monitor-plans">
          <label v-for="plan in active.plans" :key="plan.id" class="check"><input type="checkbox" :value="plan.id" v-model="form.planIds" @change="form.scope = 'selected'"> {{ plan.name }} <span class="meta">{{ plan.price }}</span></label>
          <p v-if="!active.plans.length" class="hint">该系列尚未抓取到套餐；保存“全部套餐”监控后会自动发现。</p>
        </div>
      </section>
      <p class="hint" v-if="form.scope === 'selected'">共选择 {{ form.planIds.length }} 个套餐</p>
      <div class="field"><label>轮询间隔（秒）</label><input type="number" min="30" max="3600" v-model.number="form.intervalSeconds"></div>
      <div class="controls"><button class="button" @click="submit">保存任务</button><button class="button ghost" @click="$emit('close')">取消</button></div>
    </template>
  </section></div>
</template>

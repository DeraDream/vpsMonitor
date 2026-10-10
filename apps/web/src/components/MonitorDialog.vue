<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { groupPlans } from '../plan-groups.js'
import PlanCategoryTabs from './PlanCategoryTabs.vue'
import PlanDetails from './PlanDetails.vue'
import { onMounted,onUnmounted } from 'vue'
const props = defineProps({ dialog: Object, providers: Array, monitors: Array, saving: Boolean })
const emit = defineEmits(['close', 'save', 'change-provider'])
const form = reactive({ providerId: props.dialog.providerId, enabled: props.dialog.monitor?.enabled !== false,
  scope: props.dialog.monitor?.scope || 'all', planIds: [...(props.dialog.monitor?.planIds || [])],
  categoryIds:[...(props.dialog.monitor?.categoryIds||[])],
  intervalSeconds: props.dialog.monitor?.intervalSeconds || props.dialog.provider?.defaultIntervalSeconds || 60 })
const groups = computed(() => groupPlans(props.dialog.plans, props.dialog.provider?.categories))
const displayedGroups=computed(()=>props.dialog.type==='monitor'&&form.scope==='categories'?groups.value.filter(group=>form.categoryIds.includes(group.id)):groups.value)
const activeId = ref(props.dialog.categoryId || groups.value[0]?.id)
const isDmit=computed(()=>props.dialog.provider?.adapterKey==='dmit')
const dmitLocationKey=plan=>String(plan.externalId||plan.name||'').split('.')[0]||plan.location||'other'
const isThreeLevelPlans=computed(()=>props.dialog.type==='plans'&&['dmit','vps-hosting'].includes(props.dialog.provider?.adapterKey))
const topLevelId=ref('')
const threeLevelOuterGroups=computed(()=>{
 if(!isThreeLevelPlans.value)return []
 if(isDmit.value){const byLocation=new Map();for(const plan of props.dialog.plans){const id=dmitLocationKey(plan);if(!byLocation.has(id))byLocation.set(id,{id,name:id==='other'?'未标注地区':id,plans:[]});byLocation.get(id).plans.push(plan)}return [...byLocation.values()]}
 return groups.value
})
const threeLevelInnerGroups=computed(()=>{
 if(!isThreeLevelPlans.value)return []
 if(isDmit.value)return groups.value.map(group=>({...group,plans:group.plans.filter(plan=>dmitLocationKey(plan)===topLevelId.value)})).filter(group=>group.plans.length)
 const outer=groups.value.find(group=>group.id===topLevelId.value)
 if(!outer)return []
 const byLocation=new Map();for(const plan of outer.plans){const id=plan.location||'other';if(!byLocation.has(id))byLocation.set(id,{id,name:id==='other'?'未标注地区':id,plans:[]});byLocation.get(id).plans.push(plan)}return [...byLocation.values()]
})
const active = computed(() => isThreeLevelPlans.value ? (threeLevelInnerGroups.value.find(group => group.id === activeId.value) || threeLevelInnerGroups.value[0]) : (displayedGroups.value.find(group => group.id === activeId.value) || displayedGroups.value[0]))
const categoryStatus = computed(() => props.monitors.find(monitor => monitor.providerId === props.dialog.providerId)?.categoryStatuses?.[active.value?.id])
watch(() => props.dialog.providerId, value => { form.providerId = value; form.planIds = []; activeId.value = groups.value[0]?.id })
const search=ref(''),locationFilter=ref(''),page=ref(1),pageSize=20
const hardwareFilter=ref('')
const locations=computed(()=>[...new Set((active.value?.plans||[]).map(plan=>plan.location).filter(Boolean))].sort())
const hardwares=computed(()=>[...new Set((active.value?.plans||[]).filter(plan=>!locationFilter.value||plan.location===locationFilter.value).map(plan=>plan.tags?.find(tag=>/^(as3|an4|an5)$/i.test(tag))?.toUpperCase()).filter(Boolean))])
const dmitGroups=computed(()=>displayedGroups.value.filter(group=>!locationFilter.value||group.plans.some(plan=>plan.location===locationFilter.value)))
const dmitRouteLabel=group=>({premium:'Pro',eyeball:'EB','tier-1':'T1'})[group?.id]||group?.name
const filteredPlans=computed(()=>(active.value?.plans||[]).filter(plan=>{
 const hardware=plan.tags?.find(tag=>/^(as3|an4|an5)$/i.test(tag))?.toUpperCase()
 return (!locationFilter.value||plan.location===locationFilter.value)&&(!hardwareFilter.value||hardware===hardwareFilter.value)&&(!search.value||[plan.name,plan.specs,plan.location,...(plan.configuration||[]).map(row=>row.value)].join(' ').toLowerCase().includes(search.value.toLowerCase()))
}))
const pageCount=computed(()=>Math.max(1,Math.ceil(filteredPlans.value.length/pageSize)))
const visiblePlans=computed(()=>filteredPlans.value.slice((Math.min(page.value,pageCount.value)-1)*pageSize,Math.min(page.value,pageCount.value)*pageSize))
watch(activeId,()=>{locationFilter.value='';hardwareFilter.value='';search.value='';page.value=1})
watch(locationFilter,()=>{if(isDmit.value){hardwareFilter.value='';if(!dmitGroups.value.some(group=>group.id===activeId.value))activeId.value=dmitGroups.value[0]?.id}})
watch([()=>form.scope,()=>form.categoryIds.join(',')],()=>{if(!displayedGroups.value.some(group=>group.id===activeId.value))activeId.value=displayedGroups.value[0]?.id})
watch(threeLevelOuterGroups,value=>{if(!value.some(group=>group.id===topLevelId.value))topLevelId.value=value[0]?.id||''},{immediate:true})
watch(threeLevelInnerGroups,value=>{if(!value.some(group=>group.id===activeId.value))activeId.value=value[0]?.id},{immediate:true})
watch([search,locationFilter,hardwareFilter],()=>page.value=1)
function statusLabel(plan){return !plan.available?'缺货':plan.availabilitySource==='order-button'?'可订购 · 数量未公开':'有货'}
const intervalInput=ref(null),formError=ref('')
function submit() { if(!form.providerId||props.dialog.loading||props.dialog.error||props.saving)return;formError.value='';if(!intervalInput.value?.checkValidity()||!Number.isInteger(form.intervalSeconds)||form.intervalSeconds<=0){formError.value='轮询间隔请输入正整数秒数（最多 3600 秒）';intervalInput.value?.reportValidity();return;} emit('save', { ...form, planIds: [...form.planIds], categoryIds:[...form.categoryIds] }) }
function selectCategory() {
  form.scope = 'selected'
  form.planIds = [...new Set([...form.planIds, ...active.value.plans.map(plan => plan.id)])]
}
function onKey(event){if(event.key==='Escape')emit('close')}
onMounted(()=>{window.addEventListener('keydown',onKey);document.body.style.overflow='hidden'})
onUnmounted(()=>{window.removeEventListener('keydown',onKey);document.body.style.overflow=''})
</script>
<template>
  <div class="dialog-backdrop" @click.self="$emit('close')"><section class="dialog-card" role="dialog" aria-modal="true" aria-labelledby="monitor-dialog-title">
    <button class="close" aria-label="关闭弹窗" @click="$emit('close')">×</button>
    <template v-if="dialog.type === 'plans'">
      <h2 id="monitor-dialog-title">{{ dialog.provider?.name }} 套餐</h2>
      <p v-if="dialog.loading" class="hint" role="status">正在加载套餐…</p>
      <p v-if="dialog.error" class="category-warning" role="alert">{{dialog.error}}</p>
      <template v-if="!dialog.loading && !dialog.error">
      <template v-if="isThreeLevelPlans">
        <h3>1. {{ isDmit ? '地区' : '套餐类型' }}</h3>
        <PlanCategoryTabs :groups="threeLevelOuterGroups" :active="topLevelId" @change="topLevelId = $event" />
        <h3>2. {{ isDmit ? '线路' : '地区' }}</h3>
        <PlanCategoryTabs :groups="threeLevelInnerGroups" :active="active?.id" @change="activeId = $event" />
      </template>
      <div v-else-if="isDmit" class="plan-filters dmit-cascades">
        <div class="field"><label for="dmit-plan-location">1. 地区</label><select id="dmit-plan-location" v-model="locationFilter"><option value="">全部地区</option><option v-for="location in locations" :key="location" :value="location">{{location}}</option></select></div>
        <div class="field"><label for="dmit-plan-route">2. 线路</label><select id="dmit-plan-route" :value="active?.id" @change="activeId=$event.target.value"><option v-for="group in dmitGroups" :key="group.id" :value="group.id">{{dmitRouteLabel(group)}}</option></select></div>
        <div class="field"><label for="dmit-plan-hardware">3. 硬件平台</label><select id="dmit-plan-hardware" v-model="hardwareFilter"><option value="">全部平台</option><option v-for="hardware in hardwares" :key="hardware" :value="hardware">{{hardware}}</option></select></div>
      </div>
      <PlanCategoryTabs v-else :groups="groups" :active="active?.id" @change="activeId = $event" />
      <section v-if="active" :id="`plans-${active.id}`" role="tabpanel" :aria-label="active.name">
        <h3>{{ isDmit ? dmitRouteLabel(active) : active.name }}</h3>
        <p v-if="active.retired" class="category-warning">该分类已移出商家当前目录，以下为历史记录。</p>
        <div v-if="!isDmit && !isThreeLevelPlans && (dialog.provider?.dynamicCategories || active.plans.length>20)" class="plan-filters"><div class="field"><label for="plan-search">搜索套餐</label><input id="plan-search" v-model="search" placeholder="搜索套餐名称、配置"></div><div v-if="locations.length" class="field"><label for="plan-location">地区</label><select id="plan-location" v-model="locationFilter"><option value="">全部地区</option><option v-for="location in locations" :key="location" :value="location">{{location}}</option></select></div></div>
        <p class="hint">{{ active.plans.length }} 个套餐 · {{ active.plans.filter(plan => plan.available && plan.availabilitySource!=='order-button').length }} 个有货<span v-if="active.plans.some(plan=>plan.availabilitySource==='order-button'&&plan.available)"> · {{active.plans.filter(plan=>plan.availabilitySource==='order-button'&&plan.available).length}} 个可订购，库存未公开</span></p>
        <p v-if="categoryStatus?.lastError" class="category-warning">本系列探测失败，以下保留上次状态：{{ categoryStatus.lastError }}</p>
        <p v-if="categoryStatus?.lastSuccessAt" class="hint">最后成功更新：{{ new Date(categoryStatus.lastSuccessAt).toLocaleString('zh-CN') }}</p>
        <section v-if="active.plans.length" class="plan-grid modal-plans">
          <article v-for="plan in visiblePlans" :key="plan.id" class="plan-card">
            <p class="meta">{{ plan.location || '未标注地区' }}</p><h3>{{ plan.name }}</h3>
            <PlanDetails :plan="plan"/><p class="price">{{ plan.price || '价格未知' }}{{ plan.billingCycle ? ` / ${plan.billingCycle}` : '' }}</p>
            <p v-if="Number.isInteger(plan.quantity)" class="meta">库存：{{plan.quantity}} 台</p><p class="status" :class="{ available: plan.available }">{{ categoryStatus?.lastError ? '上次状态：' : '' }}{{statusLabel(plan)}}</p>
            <a v-if="plan.buyUrl" class="button secondary" :href="plan.buyUrl" target="_blank" rel="noopener noreferrer">{{dialog.providerId==='greencloud'?'查看套餐购买页':'查看商家页面'}}</a>
          </article>
        </section>
        <div v-else class="empty">{{categoryStatus?.lastSuccessAt?'该分类当前没有公开套餐。':'该系列尚未抓取到套餐，成功探测后会自动显示。'}}</div>
      <p v-if="active.plans.length&&!filteredPlans.length" class="hint">没有匹配的套餐，请调整搜索或地区。</p>
      <div v-if="pageCount>1" class="plan-pagination"><button class="button ghost" :disabled="page<=1" @click="page--">上一页</button><span class="hint">第 {{Math.min(page,pageCount)}} / {{pageCount}} 页 · {{filteredPlans.length}} 个套餐</span><button class="button ghost" :disabled="page>=pageCount" @click="page++">下一页</button></div>
      </section>
      <div v-else class="empty">尚未抓取到套餐，成功探测后会自动显示。</div>
      </template>
      <div class="controls modal-actions"><button class="button ghost" @click="$emit('close')">关闭</button></div>
    </template>
    <template v-else>
      <h2 id="monitor-dialog-title">{{ dialog.monitor ? `编辑 ${dialog.provider?.name || ''} 监控任务` : '添加监控任务' }}</h2>
      <p class="hint">每个商家一个任务，可同时监控不同系列。</p>
      <div v-if="!dialog.monitor" class="field"><label for="monitor-provider">1. 选择商家</label><select id="monitor-provider" v-model="form.providerId" @change="$emit('change-provider', form.providerId)">
        <option :value="null" disabled>请选择商家</option>
        <option v-for="provider in providers" :key="provider.id" :value="provider.id">{{ provider.name }}{{monitors.some(m=>m.providerId===provider.id)?'（已建立监控，选择后编辑）':''}}</option>
      </select></div>
      <p v-if="!providers.length" class="hint">暂无已接入商家，请先接入商家后添加监控。</p>
      <p v-if="dialog.loading" class="hint" role="status">正在加载商家套餐…</p>
      <p v-if="dialog.error" class="category-warning" role="alert">套餐加载失败：{{dialog.error}}，请关闭后重试。</p>
      <template v-if="form.providerId && !dialog.loading && !dialog.error">
      <h3>{{ dialog.monitor ? '1. 选择套餐' : '2. 选择套餐' }}</h3>
      <label class="check"><input type="checkbox" v-model="form.enabled"> 启用监控</label>
      <div class="field"><label for="monitor-interval">轮询间隔（秒）</label><input id="monitor-interval" ref="intervalInput" type="number" max="3600" step="1" required :disabled="saving" v-model.number="form.intervalSeconds"><small class="hint">输入正整数秒数，点击“保存任务”后生效。</small></div>
      <label class="scope-option"><input type="radio" value="all" v-model="form.scope"><span><b>监控全部套餐</b><br>包含所有系列，商家新增的套餐也自动纳入。</span></label>
      <label v-if="groups.length" class="scope-option"><input type="radio" value="categories" v-model="form.scope"><span><b>只监控指定分类</b><br>所选分类的新增套餐也自动纳入。</span></label>
      <div v-if="form.scope==='categories'" class="category-checks"><label v-for="group in groups" :key="group.id" class="check"><input type="checkbox" :value="group.id" v-model="form.categoryIds">{{isDmit?dmitRouteLabel(group):group.name}}</label></div>
      <label class="scope-option"><input type="radio" value="selected" v-model="form.scope"><span><b>只监控指定套餐</b><br>在不同系列中分别勾选，切换系列保留选择。</span></label>
      <h3>{{ dialog.monitor ? (form.scope==='selected' ? '2. 选择具体套餐' : '2. 套餐列表') : (form.scope==='selected' ? '3. 选择具体套餐' : '3. 套餐列表') }}</h3>
      <p v-if="form.scope === 'categories' && !displayedGroups.length" class="hint">请先在上方选择至少一个套餐分类。</p>
      <div v-if="isDmit" class="plan-filters dmit-cascades">
        <div class="field"><label for="dmit-monitor-location">1. 地区</label><select id="dmit-monitor-location" v-model="locationFilter"><option value="">全部地区</option><option v-for="location in locations" :key="location" :value="location">{{location}}</option></select></div>
        <div class="field"><label for="dmit-monitor-route">2. 线路</label><select id="dmit-monitor-route" :value="active?.id" @change="activeId=$event.target.value"><option v-for="group in dmitGroups" :key="group.id" :value="group.id">{{dmitRouteLabel(group)}}</option></select></div>
        <div class="field"><label for="dmit-monitor-hardware">3. 硬件平台</label><select id="dmit-monitor-hardware" v-model="hardwareFilter"><option value="">全部平台</option><option v-for="hardware in hardwares" :key="hardware" :value="hardware">{{hardware}}</option></select></div>
      </div>
      <PlanCategoryTabs v-else :groups="displayedGroups" :active="active?.id" @change="activeId = $event" />
      <section v-if="active" :id="`plans-${active.id}`" role="tabpanel" :aria-label="active.name">
        <h3>{{ isDmit ? dmitRouteLabel(active) : active.name }}</h3>
        <p v-if="active.retired" class="category-warning">该分类已移出商家当前目录，以下为历史记录。</p>
        <div v-if="!isDmit && (dialog.provider?.dynamicCategories || active.plans.length>20)" class="plan-filters"><div class="field"><label for="plan-search">搜索套餐</label><input id="plan-search" v-model="search" placeholder="搜索套餐名称、配置"></div><div v-if="locations.length" class="field"><label for="plan-location">地区</label><select id="plan-location" v-model="locationFilter"><option value="">全部地区</option><option v-for="location in locations" :key="location" :value="location">{{location}}</option></select></div></div>
        <p v-if="categoryStatus?.lastError" class="category-warning">本系列探测失败，保留上次套餐列表。</p>
        <button v-if="form.scope==='selected'&&active.plans.length" class="button ghost" @click="selectCategory">选择此系列全部套餐</button>
        <section v-if="active.plans.length" class="plan-grid modal-plans monitor-plan-grid">
          <article v-for="plan in visiblePlans" :key="plan.id" class="plan-card" :class="{selected:form.planIds.includes(plan.id)}">
            <label v-if="form.scope==='selected'" class="check monitor-plan-select"><input type="checkbox" :value="plan.id" v-model="form.planIds"><span>选择此套餐</span></label>
            <p class="meta">{{ plan.location || '未标注地区' }}</p><h3>{{ plan.name }}</h3>
            <PlanDetails :plan="plan"/><p class="price">{{ plan.price || '价格未知' }}{{ plan.billingCycle ? ` / ${plan.billingCycle}` : '' }}</p>
            <p v-if="Number.isInteger(plan.quantity)" class="meta">库存：{{plan.quantity}} 台</p><p class="status" :class="{ available: plan.available }">{{statusLabel(plan)}}</p>
            <a v-if="plan.buyUrl" class="button secondary" :href="plan.buyUrl" target="_blank" rel="noopener noreferrer">{{dialog.providerId==='greencloud'?'查看套餐购买页':'查看商家页面'}}</a>
          </article>
        </section>
        <p v-else class="hint">{{categoryStatus?.lastSuccessAt?'该分类当前没有公开套餐。':'该系列尚未抓取到套餐；保存“全部套餐”监控后会自动发现。'}}</p>
      <p v-if="active.plans.length&&!filteredPlans.length" class="hint">没有匹配的套餐，请调整搜索或地区。</p>
      <div v-if="pageCount>1" class="plan-pagination"><button class="button ghost" :disabled="page<=1" @click="page--">上一页</button><span class="hint">第 {{Math.min(page,pageCount)}} / {{pageCount}} 页 · {{filteredPlans.length}} 个套餐</span><button class="button ghost" :disabled="page>=pageCount" @click="page++">下一页</button></div>
      </section>
      <p class="hint" v-if="form.scope === 'selected'">共选择 {{ form.planIds.length }} 个套餐</p>
      <p v-if="formError" class="category-warning" role="alert">{{formError}}</p>
      </template>
      <div class="controls modal-actions"><button class="button" :disabled="!form.providerId||dialog.loading||!!dialog.error||saving" @click="submit">{{saving?'保存中…':'保存任务'}}</button><button class="button ghost" @click="$emit('close')">取消</button></div>
    </template>
  </section></div>
</template>

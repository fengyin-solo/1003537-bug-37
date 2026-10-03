<template>
  <section class="page" data-module="disposal">
    <header class="page-head">
      <div>
        <h2>问题处理</h2>
        <p class="page-desc">
          汇总巡检发现的未处置问题，按站点勾选整组生成处置任务；不同单位的问题不能混入同组，失败项保留原状态可重试。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openBatch">整组生成处置任务</button>
        <RouterLink class="btn" to="/stationhouse">查看站房待办接收情况</RouterLink>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="card in summaryCards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.value }}</strong>
      </article>
    </div>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>站点编号</span>
        <input v-model="filters.stationNo" placeholder="按站点编号筛选" />
      </label>
      <label class="filter-item">
        <span>归属单位</span>
        <select v-model="filters.org">
          <option value="">全部单位</option>
          <option v-for="org in orgs" :key="org" :value="org">{{ org }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>问题类别</span>
        <select v-model="filters.category">
          <option value="">全部类别</option>
          <option v-for="cat in categories" :key="cat" :value="cat">{{ cat }}</option>
        </select>
      </label>
      <label class="filter-item grow-filter">
        <span>关键字</span>
        <input v-model="filters.keyword" placeholder="记录编号 / 站点 / 问题描述" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <h3 class="block-title">未处置问题</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th class="check-col">
            <input
              type="checkbox"
              :checked="allChecked"
              :indeterminate.prop="someChecked && !allChecked"
              @change="toggleAll"
            />
          </th>
          <th v-for="column in problemColumns" :key="column">{{ column }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in problems" :key="item.id">
          <td class="check-col">
            <input
              type="checkbox"
              :value="item.id"
              :disabled="!isSelectable(item)"
              v-model="selectedIds"
            />
          </td>
          <td>{{ item.recordNo }}</td>
          <td>{{ item.stationNo }}</td>
          <td>{{ item.stationName }}</td>
          <td>{{ item.org }}</td>
          <td>{{ item.category }}</td>
          <td>{{ item.problem }}</td>
          <td>{{ item.inspector }}</td>
          <td>{{ item.inspectedAt }}</td>
        </tr>
        <tr v-if="!problems.length">
          <td :colspan="problemColumns.length + 1" class="empty-state">当前筛选条件下没有未处置问题</td>
        </tr>
      </tbody>
    </table>
    <p v-if="groupHint" class="group-hint" :class="{ invalid: !groupValid }">
      {{ groupHint }}
    </p>

    <h3 class="block-title">处置任务（{{ tasks.length }}）</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>任务编号</th>
          <th>站点</th>
          <th>归属单位</th>
          <th>问题数</th>
          <th>已处置/跳过/失败</th>
          <th>处理措施</th>
          <th>状态</th>
          <th>建单时间</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="task in tasks" :key="task.id">
          <td>{{ task.taskNo }}</td>
          <td>{{ task.stationName }}（{{ task.stationNo }}）</td>
          <td>{{ task.org }}</td>
          <td>{{ task.items.length }}</td>
          <td>{{ countByState(task, 'success') }} / {{ countByState(task, 'skipped') }} / {{ countByState(task, 'failed') }}</td>
          <td class="measure-cell">{{ task.measure || '—' }}</td>
          <td>
            <span class="state-tag" :class="task.status === 'done' ? 'state-success' : 'state-pending'">
              {{ task.status === 'done' ? '已完成' : '处置中' }}
            </span>
          </td>
          <td>{{ task.createdAt }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="openTask(task.id)">
              {{ task.status === 'done' ? '查看结果' : '继续处理' }}
            </button>
          </td>
        </tr>
        <tr v-if="!tasks.length">
          <td colspan="9" class="empty-state">还没有处置任务，勾选上方问题整组生成</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-else>处置结果只按问题保存一次，重复提交不会重复显示；站房类问题会自动移交站房待办。</span>
    </footer>

    <DisposalDialog
      ref="dialogRef"
      v-model:task-id="activeTaskId"
      @changed="onChanged"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  listDisposalTasks,
  listOpenProblems,
} from '@/api/disposal'
import DisposalDialog from '@/components/DisposalDialog.vue'
import type { DisposalTask, ProblemOption } from '@/data/types'

const problemColumns = [
  '记录编号',
  '站点编号',
  '站点名称',
  '归属单位',
  '问题类别',
  '发现问题',
  '巡检人员',
  '巡检日期',
]

const problems = ref<ProblemOption[]>([])
const tasks = ref<DisposalTask[]>([])
const selectedIds = ref<number[]>([])
const filters = ref({ stationNo: '', org: '', category: '', keyword: '' })
const errorMessage = ref('')
const dialogRef = ref<InstanceType<typeof DisposalDialog> | null>(null)
const activeTaskId = ref<number | null>(null)

const orgs = computed(() => [...new Set(problems.value.map((item) => item.org))])
const categories = computed(() => [...new Set(problems.value.map((item) => item.category))])

const summaryCards = computed(() => [
  { label: '待处置问题', value: problems.value.length },
  {
    label: '涉及站点',
    value: new Set(problems.value.map((item) => item.stationNo)).size,
  },
  { label: '处置中任务', value: tasks.value.filter((task) => task.status === 'processing').length },
  { label: '已完成任务', value: tasks.value.filter((task) => task.status === 'done').length },
])

const allChecked = computed(
  () => problems.value.length > 0 &&
    problems.value.every((item) => isSelectable(item) && selectedIds.value.includes(item.id)),
)
const someChecked = computed(() => selectedIds.value.length > 0)

const groupInfo = computed(() => {
  const picked = problems.value.filter((item) => selectedIds.value.includes(item.id))
  if (!picked.length) {
    return null
  }
  const first = picked[0]
  return {
    stationNo: first.stationNo,
    stationName: first.stationName,
    org: first.org,
    sameSite: picked.every((item) => item.stationNo === first.stationNo),
    sameOrg: picked.every((item) => item.org === first.org),
  }
})
const groupValid = computed(
  () => Boolean(groupInfo.value?.sameSite && groupInfo.value?.sameOrg),
)
const groupHint = computed(() => {
  if (!groupInfo.value) {
    return ''
  }
  if (!groupInfo.value.sameSite) {
    return '所选问题不属于同一站点，不能混入同一张处置任务'
  }
  if (!groupInfo.value.sameOrg) {
    return '所选问题归属单位不同，不能混入同一张处置任务'
  }
  return `已选中同一站点「${groupInfo.value.stationName}」、同一单位「${groupInfo.value.org}」的 ${selectedIds.value.length} 个问题，可整组生成任务`
})

function isSelectable(item: ProblemOption): boolean {
  if (selectedIds.value.length === 0) {
    return true
  }
  const first = problems.value.find((row) => row.id === selectedIds.value[0])
  if (!first) {
    return true
  }
  return item.stationNo === first.stationNo && item.org === first.org
}

function toggleAll(event: Event) {
  const checked = (event.target as HTMLInputElement).checked
  selectedIds.value = checked ? problems.value.filter(isSelectable).map((item) => item.id) : []
}

function countByState(task: DisposalTask, state: 'success' | 'skipped' | 'failed'): number {
  return task.items.filter((item) => item.state === state).length
}

function reload() {
  errorMessage.value = ''
  problems.value = listOpenProblems({
    stationNo: filters.value.stationNo.trim(),
    org: filters.value.org,
    category: filters.value.category,
    keyword: filters.value.keyword,
  })
  tasks.value = listDisposalTasks()
  const openIds = new Set(problems.value.map((item) => item.id))
  selectedIds.value = selectedIds.value.filter((id) => openIds.has(id))
}

function resetFilters() {
  filters.value = { stationNo: '', org: '', category: '', keyword: '' }
  reload()
}

function openBatch() {
  errorMessage.value = ''
  if (!selectedIds.value.length) {
    errorMessage.value = '请先勾选未处置问题'
    return
  }
  if (!groupValid.value) {
    errorMessage.value = groupHint.value || '所选问题不能混入同组'
    return
  }
  void dialogRef.value?.open([...selectedIds.value])
}

function openTask(id: number) {
  activeTaskId.value = id
  void dialogRef.value?.openTask(id)
}

function onChanged() {
  selectedIds.value = []
  reload()
}

onMounted(reload)
</script>

<style scoped>
.grow-filter { flex: 1; min-width: 200px; }
.block-title { font-size: 15px; margin: 18px 0 8px; }
.check-col { width: 40px; text-align: center; }
.group-hint {
  margin: 8px 0 0;
  font-size: 13px;
  color: #157347;
}
.group-hint.invalid { color: #b42318; }
.measure-cell { max-width: 220px; color: var(--muted); }
.state-tag {
  border-radius: 999px;
  padding: 1px 9px;
  font-size: 12px;
  background: #e0ecff;
  color: #1d4ed8;
}
.state-success { background: #dcfce7; color: #157347; }
</style>

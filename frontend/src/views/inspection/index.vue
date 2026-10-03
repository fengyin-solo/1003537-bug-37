<template>
  <section class="page" data-module="inspection">
    <header class="page-head">
      <div>
        <h2>巡检记录管理</h2>
        <p class="page-desc">维护巡检记录，发现故障可在本页勾选同站点未处置问题，整组生成一张处置任务一次提交。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openBatch">批量处置选中问题</button>
        <RouterLink class="btn" to="/disposal">问题处理工作台</RouterLink>
        <button class="btn" type="button" @click="exportRows">导出巡检记录清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

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
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td class="check-col">
            <input
              v-if="String(row.status) === '发现故障'"
              type="checkbox"
              :value="Number(row.id)"
              v-model="selectedIds"
            />
          </td>
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in availableActions(row)"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无巡检记录数据，可先登记巡检记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>
        共 {{ total }} 条巡检记录，已勾选待处置问题
        <strong>{{ selectedIds.length }}</strong> 个（自动去重，须同站点同单位）
      </span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <DisposalDialog
      ref="dialogRef"
      v-model:task-id="activeTaskId"
      @changed="onDisposalChanged"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import DisposalDialog from '@/components/DisposalDialog.vue'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('inspection')
const columns = [
  '记录编号',
  '站点编号',
  '归属单位',
  '问题类别',
  '巡检日期',
  '巡检人员',
  '检查项目',
  '发现问题',
  '处理措施',
  '巡检状态',
]
const statuses = ['待巡检', '已巡检', '发现故障', '已处置']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = ['记录编号', '站点编号', '归属单位']
const selectedIds = ref<number[]>([])
const dialogRef = ref<InstanceType<typeof DisposalDialog> | null>(null)
const activeTaskId = ref<number | null>(null)

const faultRows = computed(() =>
  rows.value.filter((row) => String(row.status) === '发现故障' && row.pending),
)
const allChecked = computed(
  () => faultRows.value.length > 0 &&
    faultRows.value.every((row) => selectedIds.value.includes(Number(row.id))),
)
const someChecked = computed(() => selectedIds.value.length > 0)

const stats = computed(() => [
  {
    label: '本月巡检次数',
    value: rows.value.filter((row) => String(row['巡检日期'] ?? '').startsWith('2026-10')).length,
  },
  {
    label: '已巡检站点',
    value: new Set(
      rows.value
        .filter((row) => ['已巡检', '发现故障', '已处置'].includes(String(row.status)))
        .map((row) => String(row['站点编号'] ?? '')),
    ).size,
  },
  {
    label: '待处置故障',
    value: faultRows.value.length,
  },
])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

// 已关闭的记录不再给出「确认处置」动作，避免对终态重复操作。
function availableActions(row: EntryRow): string[] {
  const status = String(row.status)
  if (status === '待巡检') {
    return ['完成巡检', '报告故障']
  }
  if (status === '已巡检') {
    return ['报告故障']
  }
  if (status === '发现故障') {
    return ['确认处置（单条）']
  }
  return []
}

function toggleAll(event: Event) {
  const checked = (event.target as HTMLInputElement).checked
  selectedIds.value = checked ? faultRows.value.map((row) => Number(row.id)) : []
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openBatch() {
  errorMessage.value = ''
  if (!selectedIds.value.length) {
    errorMessage.value = '请先勾选同一站点、同一归属单位的未处置问题'
    return
  }
  void dialogRef.value?.open([...selectedIds.value])
}

function onDisposalChanged() {
  selectedIds.value = []
  reload()
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  if (action === '确认处置（单条）') {
    // 单条处置走同一张弹窗，整组一张任务的规则不变。
    void dialogRef.value?.open([Number(row.id)])
    return
  }
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    const openIds = new Set(
      rows.value
        .filter((row) => String(row.status) === '发现故障' && row.pending)
        .map((row) => Number(row.id)),
    )
    selectedIds.value = selectedIds.value.filter((id) => openIds.has(id))
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '巡检记录列表读取失败'
  }
}

onMounted(reload)
</script>

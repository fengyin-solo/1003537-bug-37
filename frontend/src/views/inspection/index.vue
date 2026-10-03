<template>
  <section class="page" data-module="inspection">
    <header class="page-head">
      <div>
        <h2>巡检记录管理</h2>
        <p class="page-desc">维护巡检记录，围绕记录编号、站点编号、归属单位、巡检日期做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记巡检记录</button>
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

    <section class="batch-panel">
      <div class="batch-head">
        <h3>问题处理</h3>
        <p class="hint-text">
          勾选同一站点、同一单位的未处置问题，整组生成一张处置任务后一次提交处理措施；不同单位的问题不能混入同组。
        </p>
      </div>
      <div v-if="pendingIssues.length" class="issue-picker">
        <label
          v-for="issue in pendingIssues"
          :key="String(issue.id)"
          class="issue-chip"
          :class="{ checked: isSelected(issue.id) }"
        >
          <input type="checkbox" :checked="isSelected(issue.id)" @change="toggleIssue(issue)" />
          <span>{{ issue['记录编号'] }} · {{ issue['站点编号'] }} · {{ issue['归属单位'] || '未回填单位' }}</span>
          <span class="issue-problem">{{ issue['发现问题'] || '—' }}</span>
        </label>
      </div>
      <p v-else class="empty-state">当前没有待处置问题</p>
      <div class="batch-bar">
        <span v-if="selectedRows.length">
          已选 {{ selectedRows.length }} 项（{{ groupSite }} · {{ groupUnit || '未回填单位' }}）
        </span>
        <span v-else>尚未选择问题，可在上方问题处理区或下方巡检列表勾选</span>
        <span class="batch-actions">
          <button class="btn primary" type="button" :disabled="!selectedRows.length" @click="generateTask">
            生成处置任务
          </button>
          <button class="btn ghost" type="button" :disabled="!selectedRows.length" @click="clearSelection">
            清空选择
          </button>
        </span>
      </div>
    </section>

    <section v-if="tasks.length" class="task-list">
      <article v-for="task in tasks" :key="task.id" class="task-card">
        <header class="task-head">
          <strong>{{ task.任务编号 }}</strong>
          <span>{{ task.站点编号 }} · {{ task.归属单位 || '未回填单位' }} · {{ task.问题ID列表.length }} 项问题</span>
          <span class="task-status">{{ task.status }}</span>
        </header>
        <p class="task-meta">
          创建：{{ task.创建时间 }}（{{ task.提交人 }}）
          <template v-if="task.提交时间"> · 提交：{{ task.提交时间 }}</template>
          <template v-if="task.站房待办编号"> · 站房待办：{{ task.站房待办编号 }}</template>
        </p>
        <p v-if="task.处理措施" class="task-meta">处理措施：{{ task.处理措施 }}</p>
        <div v-if="task.status === '待提交'" class="task-submit">
          <textarea
            v-model="measures[task.id]"
            class="measure-input"
            rows="2"
            placeholder="填写本组问题统一的处理措施"
          ></textarea>
          <button class="btn primary" type="button" @click="submitTask(task)">提交处置</button>
        </div>
        <ul v-if="task.处置结果.length" class="result-list">
          <li
            v-for="item in task.处置结果"
            :key="item.issueId"
            :class="item.ok ? 'result-ok' : 'result-skip'"
          >
            {{ item.记录编号 }}：{{ item.message }}
          </li>
        </ul>
      </article>
    </section>

    <table class="data-table">
      <thead>
        <tr>
          <th class="check-cell">选择</th>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td class="check-cell">
            <input
              v-if="row.status === '发现故障'"
              type="checkbox"
              :checked="isSelected(row.id)"
              @change="toggleIssue(row)"
            />
          </td>
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
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
      <span>共 {{ total }} 条巡检记录记录</span>
      <span v-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  createDisposalTask,
  downloadEntries,
  listDisposalTasks,
  listEntries,
  listPendingIssues,
  moduleMeta,
  runAction as applyAction,
  submitDisposalTask,
} from '@/api/local-service'
import type { DisposalTask, EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const meta = moduleMeta('inspection')
const columns = ["记录编号", "站点编号", "归属单位", "巡检日期", "巡检人员", "检查项目", "发现问题", "处理措施", "巡检状态"]
const actions = ["完成巡检", "报告故障", "确认处置"]
const statuses = ["待巡检", "已巡检", "发现故障", "已处置"]
const stats = [{"label": "本月巡检次数", "value": 0}, {"label": "已巡检站点", "value": 0}, {"label": "待处置故障", "value": 0}]

const store = useSessionStore()

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const pendingIssues = ref<EntryRow[]>([])
const tasks = ref<DisposalTask[]>([])
const selectedIds = ref<number[]>([])
const measures = ref<Record<number, string>>({})

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

// 勾选状态按记录编号去重存放，列表和问题处理入口勾选同一问题只会进组一次。
const issueById = computed(() => {
  const map = new Map<number, EntryRow>()
  for (const row of rows.value) {
    map.set(Number(row.id), row)
  }
  for (const issue of pendingIssues.value) {
    map.set(Number(issue.id), issue)
  }
  return map
})
const selectedRows = computed(() =>
  selectedIds.value
    .map((id) => issueById.value.get(id))
    .filter((row): row is EntryRow => Boolean(row)),
)
const groupSite = computed(() => String(selectedRows.value[0]?.['站点编号'] ?? ''))
const groupUnit = computed(() => String(selectedRows.value[0]?.['归属单位'] ?? ''))

function isSelected(id: number | string) {
  return selectedIds.value.includes(Number(id))
}

function toggleIssue(issue: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  const id = Number(issue.id)
  if (isSelected(id)) {
    selectedIds.value = selectedIds.value.filter((item) => item !== id)
    return
  }
  if (selectedRows.value.length) {
    if (String(issue['站点编号'] ?? '') !== groupSite.value) {
      errorMessage.value = '只能勾选同一站点的问题，不能跨站点混入同组'
      return
    }
    if (String(issue['归属单位'] ?? '') !== groupUnit.value) {
      errorMessage.value = '不同单位的问题不能混入同组'
      return
    }
  }
  selectedIds.value = [...selectedIds.value, id]
}

function clearSelection() {
  selectedIds.value = []
}

function generateTask() {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = createDisposalTask(selectedIds.value, store.operator)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  selectedIds.value = []
  noticeMessage.value = result.message
  reload()
}

function submitTask(task: DisposalTask) {
  errorMessage.value = ''
  noticeMessage.value = ''
  const token =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `submit-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const result = submitDisposalTask(task.id, measures.value[task.id] ?? '', token, store.operator)
  reload()
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '巡检记录登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    pendingIssues.value = listPendingIssues()
    tasks.value = listDisposalTasks()
    // 已处置或已删除的问题不再留在勾选组里
    const selectable = new Set(pendingIssues.value.map((issue) => Number(issue.id)))
    selectedIds.value = selectedIds.value.filter((id) => selectable.has(id))
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '巡检记录列表读取失败'
  }
}

onMounted(reload)
</script>

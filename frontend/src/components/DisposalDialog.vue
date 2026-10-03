<template>
  <div v-if="visible" class="modal-mask" @click.self="close">
    <div class="modal-card">
      <header class="modal-head">
        <h3>
          {{ mode === 'task' ? `处置任务 ${task?.taskNo ?? ''}` : '问题批量处置' }}
        </h3>
        <button class="link" type="button" @click="close">关闭</button>
      </header>

      <p v-if="error" class="error-text">{{ error }}</p>
      <p v-if="notice" class="ok-text">{{ notice }}</p>

      <!-- 选择分组：同一站点、同一归属单位的问题才能整组成一张任务 -->
      <template v-if="mode === 'select'">
        <div class="select-summary">
          <span>已勾选 <strong>{{ selectedIds.length }}</strong> 个问题</span>
          <span v-if="groupInfo">{{ groupInfo.stationName }}（{{ groupInfo.org }}）</span>
          <span v-else-if="selectedIds.length" class="error-text">
            {{ validateMessage || '请保持同站点同单位' }}
          </span>
        </div>

        <div class="candidate-head">
          <label class="check-cell">
            <input
              type="checkbox"
              :checked="allChecked"
              :indeterminate.prop="someChecked && !allChecked"
              @change="toggleAll"
            />
          </label>
          <span>待处置问题（{{ candidates.length }}），勾选自动按编号去重</span>
        </div>
        <div class="candidate-list">
          <label
            v-for="item in candidates"
            :key="item.id"
            class="candidate-row"
            :class="{ disabled: !isSelectable(item) }"
          >
            <input
              v-if="isSelectable(item)"
              v-model="selectedIds"
              type="checkbox"
              :value="item.id"
            />
            <input v-else type="checkbox" disabled />
            <span class="candidate-main">
              <strong>{{ item.recordNo }}</strong>
              {{ item.stationName }} · {{ item.category }}
              <em class="candidate-problem">{{ item.problem }}</em>
            </span>
            <span class="candidate-meta">{{ item.org }}</span>
          </label>
          <p v-if="!candidates.length" class="empty-state">没有待处置问题</p>
        </div>

        <footer class="modal-foot">
          <button class="btn" type="button" @click="close">取消</button>
          <button
            class="btn primary"
            type="button"
            :disabled="!selectedIds.length"
            @click="generate"
          >
            整组生成处置任务
          </button>
        </footer>
      </template>

      <!-- 任务面板：一次提交处理措施，逐项可跳过，失败项保留原状态重试 -->
      <template v-else-if="mode === 'task' && task">
        <div class="task-meta">
          <span>站点：{{ task.stationName }}（{{ task.stationNo }}）</span>
          <span>归属单位：{{ task.org }}</span>
          <span>任务状态：{{ task.status === 'done' ? '已完成' : '处置中' }}</span>
          <span>建单：{{ task.createdAt }}</span>
        </div>

        <div class="item-list">
          <div v-for="item in task.items" :key="item.problemId" class="item-row">
            <div class="item-line">
              <span class="state-tag" :class="`state-${item.state}`">
                {{ stateLabel(item.state) }}
              </span>
              <strong>{{ item.recordNo }}</strong>
              <em class="candidate-problem">{{ item.problem }}</em>
            </div>
            <p v-if="item.state === 'success'" class="item-sub ok-text">
              处理措施：{{ item.measure }}
            </p>
            <p v-if="item.state === 'skipped'" class="item-sub skip-text">
              跳过原因：{{ item.skipReason }}
            </p>
            <p v-if="item.state === 'failed'" class="item-sub error-text">
              失败原因：{{ item.failReason }}
            </p>

            <div
              v-if="task.status !== 'done' && item.state !== 'success'"
              class="item-ops"
            >
              <template v-if="item.state === 'failed' || item.state === 'skipped'">
                <input
                  v-model="retryMeasures[item.problemId]"
                  class="grow"
                  placeholder="填写处理措施后重试"
                />
                <button
                  class="btn"
                  type="button"
                  @click="retry(item.problemId, 'handle')"
                >
                  重试处置
                </button>
                <input
                  v-model="retryReasons[item.problemId]"
                  placeholder="跳过原因"
                />
                <button
                  class="btn ghost"
                  type="button"
                  @click="retry(item.problemId, 'skip')"
                >
                  改为跳过
                </button>
              </template>
              <template v-else>
                <input
                  v-model="skipReasons[item.problemId]"
                  placeholder="跳过该项须填写原因（不填则按整组措施处置）"
                />
              </template>
            </div>
          </div>
        </div>

        <div v-if="task.houseHandover" class="handover-box">
          站房待办已接收处置结果：更新待办 {{ task.houseHandover.updated }} 条，
          自动移交新建 {{ task.houseHandover.created }} 条（按问题去重，不重复反馈）。
        </div>

        <footer v-if="task.status !== 'done'" class="modal-foot stack">
          <label class="measure-box">
            <span>整组处理措施（一次提交，适用于未跳过的各项）</span>
            <textarea v-model="measure" rows="2" placeholder="例如：现场修复并复测正常；涉及配件的须写明配件调拨/到场安排"></textarea>
          </label>
          <div class="foot-right">
            <button class="btn" type="button" @click="close">稍后处理</button>
            <button class="btn primary" type="button" @click="submit">一次提交处理措施</button>
          </div>
        </footer>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import {
  createDisposalTask,
  listOpenProblems,
  readDisposalTask,
  retryDisposalItem,
  submitDisposalTask,
} from '@/api/disposal'
import type { DisposalItemState, DisposalTask, ProblemOption } from '@/data/types'

const props = defineProps<{ taskId?: number | null }>()
const emit = defineEmits<{
  (e: 'changed'): void
  (e: 'update:taskId', value: number | null): void
}>()

const visible = ref(false)
const mode = ref<'select' | 'task'>('select')
const task = ref<DisposalTask | null>(null)
const candidates = ref<ProblemOption[]>([])
const selectedIds = ref<number[]>([])
const measure = ref('')
const skipReasons = ref<Record<number, string>>({})
const retryMeasures = ref<Record<number, string>>({})
const retryReasons = ref<Record<number, string>>({})
const error = ref('')
const notice = ref('')

function stateLabel(state: DisposalItemState): string {
  return { pending: '待提交', success: '已处置', skipped: '已跳过', failed: '处置失败' }[state]
}

const groupInfo = computed(() => {
  const picked = candidates.value.filter((item) => selectedIds.value.includes(item.id))
  if (!picked.length) {
    return null
  }
  const first = picked[0]
  const sameSite = picked.every((item) => item.stationNo === first.stationNo)
  const sameOrg = picked.every((item) => item.org === first.org)
  if (sameSite && sameOrg) {
    return { stationNo: first.stationNo, stationName: first.stationName, org: first.org }
  }
  return null
})

const validateMessage = computed(() => {
  const picked = candidates.value.filter((item) => selectedIds.value.includes(item.id))
  if (!picked.length) {
    return ''
  }
  const first = picked[0]
  if (picked.some((item) => item.stationNo !== first.stationNo)) {
    return '包含不同站点的问题，不能混入同组'
  }
  if (picked.some((item) => item.org !== first.org)) {
    return '包含不同单位的问题，不能混入同组'
  }
  return ''
})

const allChecked = computed(
  () => candidates.value.length > 0 &&
    candidates.value.every((item) => isSelectable(item) && selectedIds.value.includes(item.id)),
)
const someChecked = computed(() => selectedIds.value.length > 0)

function isSelectable(item: ProblemOption): boolean {
  // 未选择时全部可选；已选了一个站点/单位后，非同组的禁用，引导按站点成组。
  if (selectedIds.value.length === 0) {
    return true
  }
  const first = candidates.value.find((row) => row.id === selectedIds.value[0])
  if (!first) {
    return true
  }
  return item.stationNo === first.stationNo && item.org === first.org
}

function toggleAll(event: Event) {
  const checked = (event.target as HTMLInputElement).checked
  if (checked) {
    selectedIds.value = candidates.value.filter(isSelectable).map((item) => item.id)
  } else {
    selectedIds.value = []
  }
}

function syncForm() {
  if (!task.value) {
    return
  }
  measure.value = task.value.measure
  const reasons: Record<number, string> = {}
  const retries: Record<number, string> = {}
  for (const item of task.value.items) {
    if (item.state === 'skipped') {
      reasons[item.problemId] = item.skipReason ?? ''
    }
    if (item.state === 'failed') {
      retries[item.problemId] = item.measure ?? ''
    }
  }
  skipReasons.value = reasons
  retryMeasures.value = retries
}

async function open(preselected: number[] = []) {
  error.value = ''
  notice.value = ''
  candidates.value = listOpenProblems()
  // 重复勾选同一问题在这里去重；已不在待处置列表里的预选自动丢弃。
  const openIds = new Set(candidates.value.map((item) => item.id))
  selectedIds.value = [...new Set(preselected.map(Number))].filter((id) => openIds.has(id))
  mode.value = 'select'
  task.value = null
  visible.value = true
}

async function openTask(id: number) {
  error.value = ''
  notice.value = ''
  const found = readDisposalTask(id)
  if (!found) {
    error.value = '处置任务不存在'
    visible.value = true
    mode.value = 'task'
    return
  }
  task.value = found
  syncForm()
  mode.value = 'task'
  visible.value = true
}

function close() {
  visible.value = false
  emit('update:taskId', null)
}

function afterChanged() {
  emit('changed')
}

async function generate() {
  error.value = ''
  notice.value = ''
  const result = createDisposalTask(selectedIds.value)
  if (!result.ok) {
    error.value = result.message
    return
  }
  task.value = result.task
  syncForm()
  mode.value = 'task'
  emit('update:taskId', result.task.id)
  notice.value = result.reused
    ? `这组问题已生成过任务 ${result.task.taskNo}，直接返回原任务，不重复建单`
    : `已生成处置任务 ${result.task.taskNo}，请填写整组处理措施后提交`
}

async function submit() {
  if (!task.value) {
    return
  }
  error.value = ''
  notice.value = ''
  const skips: Record<number, string> = {}
  for (const item of task.value.items) {
    const reason = skipReasons.value[item.problemId]
    if (reason && reason.trim()) {
      skips[item.problemId] = reason.trim()
    }
  }
  const result = submitDisposalTask(task.value.id, { measure: measure.value, skips })
  if (!result.ok) {
    error.value = result.message
    return
  }
  task.value = result.task
  syncForm()
  notice.value = summarize(result.task)
  afterChanged()
}

function summarize(value: DisposalTask): string {
  const counts = value.items.reduce(
    (acc, item) => {
      acc[item.state] += 1
      return acc
    },
    { success: 0, skipped: 0, failed: 0, pending: 0 },
  )
  return `提交完成：成功处置 ${counts.success} 项，跳过 ${counts.skipped} 项，失败保留 ${counts.failed} 项（可重试）`
}

async function retry(problemId: number, action: 'handle' | 'skip') {
  if (!task.value) {
    return
  }
  error.value = ''
  notice.value = ''
  const result = retryDisposalItem(task.value.id, problemId, {
    action,
    measure: (retryMeasures.value[problemId] ?? '').trim() || measure.value,
    skipReason: retryReasons.value[problemId] ?? skipReasons.value[problemId],
  })
  if (!result.ok) {
    error.value = result.message
    return
  }
  task.value = result.task
  syncForm()
  notice.value = summarize(result.task)
  afterChanged()
}

watch(
  () => props.taskId,
  (id) => {
    if (id) {
      void openTask(id)
    }
  },
)

defineExpose({ open, openTask, close })
</script>

<style scoped>
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}
.modal-card {
  width: min(860px, 92vw);
  max-height: 88vh;
  overflow: auto;
  background: #fff;
  border-radius: 10px;
  padding: 18px 20px;
  box-shadow: 0 18px 48px rgba(15, 23, 42, 0.25);
}
.modal-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}
.modal-head h3 { margin: 0; font-size: 16px; }
.ok-text { color: #157347; }
.skip-text { color: #b45309; }
.select-summary {
  display: flex;
  gap: 14px;
  font-size: 13px;
  color: var(--muted);
  margin-bottom: 8px;
}
.candidate-head {
  display: flex;
  gap: 10px;
  align-items: center;
  font-size: 13px;
  padding: 6px 8px;
  background: #f1f5f9;
  border: 1px solid var(--border);
}
.candidate-list {
  border: 1px solid var(--border);
  border-top: none;
  max-height: 320px;
  overflow: auto;
}
.candidate-row {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 8px 10px;
  border-bottom: 1px solid #eef2f7;
  font-size: 13px;
}
.candidate-row.disabled { opacity: 0.45; }
.candidate-main { flex: 1; display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
.candidate-problem { color: var(--muted); font-style: normal; }
.candidate-meta { color: var(--muted); font-size: 12px; white-space: nowrap; }
.modal-foot {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 14px;
}
.modal-foot.stack { flex-direction: column; align-items: stretch; }
.foot-right { display: flex; justify-content: flex-end; gap: 10px; }
.measure-box span { display: block; font-size: 12px; color: var(--muted); margin-bottom: 4px; }
.measure-box textarea {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px;
  font: inherit;
  resize: vertical;
}
.task-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  font-size: 13px;
  color: var(--muted);
  margin-bottom: 10px;
}
.item-list { display: flex; flex-direction: column; gap: 8px; }
.item-row { border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; }
.item-line { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; font-size: 13px; }
.item-sub { margin: 6px 0 0; font-size: 12px; }
.item-ops { display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
.item-ops input {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 5px 8px;
  font: inherit;
  font-size: 13px;
}
.item-ops .grow { flex: 1; min-width: 220px; }
.state-tag {
  border-radius: 999px;
  padding: 1px 9px;
  font-size: 12px;
  background: #e2e8f0;
  color: #334155;
}
.state-success { background: #dcfce7; color: #157347; }
.state-failed { background: #fee2e2; color: #b42318; }
.state-skipped { background: #fef3c7; color: #b45309; }
.state-pending { background: #e0ecff; color: #1d4ed8; }
.handover-box {
  margin-top: 12px;
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  color: #157347;
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 13px;
}
</style>

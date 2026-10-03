import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type {
  ActionResult,
  DisposalItemResult,
  DisposalTask,
  DisposalTaskResult,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  if (key === INSPECTION_KEY) {
    normalizeInspectionRows()
  }
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  normalizeInspectionRows()
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}

// ---------- 巡检批量处置 ----------

const INSPECTION_KEY = 'inspection'
const DISPOSAL_TASK_KEY = 'inspection-disposal-tasks'
const ISSUE_STATUS = '发现故障'
const DISPOSED_STATUS = '已处置'

function nowText(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  return `${date} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}

// 旧数据规整：缺问题归属的按站点回填管理单位；已关闭故障残留的待处理标记清掉。
// 幂等，只有真的改了数据才写回，读取巡检列表和运营概览时都会先过一遍。
export function normalizeInspectionRows(): void {
  const rows = listRows(INSPECTION_KEY)
  if (!rows.length) {
    return
  }
  const unitBySite = new Map(
    listRows('station').map((station) => [
      String(station['站点编号'] ?? ''),
      String(station['管理单位'] ?? ''),
    ]),
  )
  let changed = false
  const next = rows.map((row) => {
    let current = row
    if (String(current.status) === DISPOSED_STATUS && current.pending) {
      current = { ...current, pending: false }
      changed = true
    }
    if (!String(current['归属单位'] ?? '').trim()) {
      const unit = unitBySite.get(String(current['站点编号'] ?? '')) ?? ''
      if (unit) {
        current = { ...current, ['归属单位']: unit }
        changed = true
      }
    }
    return current
  })
  if (changed) {
    saveRows(INSPECTION_KEY, next)
  }
}

// 问题处理入口的数据源：还没处置的故障问题。
export function listPendingIssues(): EntryRow[] {
  normalizeInspectionRows()
  return listRows(INSPECTION_KEY).filter((row) => String(row.status) === ISSUE_STATUS)
}

export function listDisposalTasks(): DisposalTask[] {
  return listRows<DisposalTask>(DISPOSAL_TASK_KEY)
}

// 整组生成一张处置任务：重复勾选去重，只允许同一站点、同一单位的未处置问题进同组。
export function createDisposalTask(issueIds: number[], operator: string): DisposalTaskResult {
  normalizeInspectionRows()
  const ids = [...new Set(issueIds.map((id) => Number(id)))]
  if (!ids.length) {
    return { ok: false, message: '请先勾选要处置的问题', task: null }
  }
  const rows = listRows(INSPECTION_KEY)
  const picked: EntryRow[] = []
  for (const id of ids) {
    const row = rows.find((item) => Number(item.id) === id)
    if (!row) {
      return { ok: false, message: `没有找到编号为 ${id} 的巡检记录`, task: null }
    }
    if (String(row.status) !== ISSUE_STATUS) {
      return {
        ok: false,
        message: `${row['记录编号']} 当前状态为「${row.status}」，不是待处置问题`,
        task: null,
      }
    }
    picked.push(row)
  }
  const sites = new Set(picked.map((row) => String(row['站点编号'] ?? '')))
  if (sites.size > 1) {
    return { ok: false, message: '只能勾选同一站点的问题，不能跨站点混入同组', task: null }
  }
  const units = new Set(picked.map((row) => String(row['归属单位'] ?? '')))
  if (units.size > 1) {
    return { ok: false, message: '不同单位的问题不能混入同一张处置任务', task: null }
  }
  const tasks = listDisposalTasks()
  const id = tasks.reduce((max, task) => Math.max(max, task.id), 0) + 1
  const task: DisposalTask = {
    id,
    status: '待提交',
    pending: true,
    abnormal: false,
    任务编号: `DISP-${String(id).padStart(4, '0')}`,
    站点编号: [...sites][0],
    归属单位: [...units][0],
    问题ID列表: ids,
    处理措施: '',
    提交人: operator,
    创建时间: nowText(),
    提交时间: '',
    提交令牌: '',
    处置结果: [],
    站房待办编号: '',
  }
  saveRows(DISPOSAL_TASK_KEY, [...tasks, task])
  return { ok: true, message: `已生成处置任务 ${task.任务编号}，共 ${ids.length} 项问题`, task }
}

// 一次提交整组处理措施：逐项落库并说明跳过原因，失败项保留原状态供重试；
// 重复提交（同一任务再次提交）直接返回首次结果，不重复写巡检记录和站房待办。
export function submitDisposalTask(
  taskId: number,
  measure: string,
  submitToken: string,
  operator: string,
): DisposalTaskResult {
  const tasks = listDisposalTasks()
  const index = tasks.findIndex((task) => task.id === taskId)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${taskId} 的处置任务`, task: null }
  }
  const task = tasks[index]
  if (task.status === DISPOSED_STATUS) {
    return { ok: true, message: `任务 ${task.任务编号} 已提交过，保留首次处置结果`, task }
  }
  const trimmed = measure.trim()
  if (!trimmed) {
    return { ok: false, message: '请先填写处理措施再提交', task: null }
  }
  normalizeInspectionRows()
  const rows = listRows(INSPECTION_KEY)
  const nextRows = [...rows]
  const results: DisposalItemResult[] = []
  const disposed: EntryRow[] = []
  for (const issueId of [...new Set(task.问题ID列表)]) {
    const rowIndex = nextRows.findIndex((row) => Number(row.id) === Number(issueId))
    if (rowIndex < 0) {
      results.push({ issueId, 记录编号: `#${issueId}`, ok: false, message: '未找到该问题对应的巡检记录，可能已被删除' })
      continue
    }
    const row = nextRows[rowIndex]
    const code = String(row['记录编号'] ?? `#${issueId}`)
    if (String(row.status) === DISPOSED_STATUS) {
      results.push({ issueId, 记录编号: code, ok: false, message: '该问题已处置，无需重复提交' })
      continue
    }
    if (String(row.status) !== ISSUE_STATUS) {
      results.push({ issueId, 记录编号: code, ok: false, message: `当前状态为「${row.status}」，不是待处置问题` })
      continue
    }
    if (String(row['站点编号'] ?? '') !== task.站点编号) {
      results.push({ issueId, 记录编号: code, ok: false, message: '问题站点与任务站点不一致，不能混入同组' })
      continue
    }
    if (String(row['归属单位'] ?? '') !== task.归属单位) {
      results.push({ issueId, 记录编号: code, ok: false, message: '归属单位与任务不一致，不同单位不能混入同组' })
      continue
    }
    const updated: EntryRow = {
      ...row,
      status: DISPOSED_STATUS,
      pending: false,
      abnormal: false,
      处理措施: trimmed,
    }
    nextRows[rowIndex] = updated
    disposed.push(updated)
    results.push({ issueId, 记录编号: code, ok: true, message: '已处置' })
  }
  if (disposed.length === 0) {
    // 整组都没有可处置项：任务保持待提交，问题保留原状态，修正后可重新提交。
    const failedTask: DisposalTask = { ...task, 处置结果: results }
    const nextTasks = [...tasks]
    nextTasks[index] = failedTask
    saveRows(DISPOSAL_TASK_KEY, nextTasks)
    return { ok: false, message: '没有可处置的问题，逐项原因见任务明细，问题保留原状态可重试', task: failedTask }
  }
  saveRows(INSPECTION_KEY, nextRows)
  const doneTask: DisposalTask = {
    ...task,
    status: DISPOSED_STATUS,
    pending: false,
    处理措施: trimmed,
    提交人: operator || task.提交人,
    提交时间: nowText(),
    提交令牌: submitToken,
    处置结果: results,
  }
  doneTask.站房待办编号 = syncStationhouseTodo(doneTask, disposed)
  const nextTasks = [...tasks]
  nextTasks[index] = doneTask
  saveRows(DISPOSAL_TASK_KEY, nextTasks)
  const skipped = results.length - disposed.length
  const parts = [`任务 ${doneTask.任务编号} 已提交：处置 ${disposed.length} 项`]
  if (skipped > 0) {
    parts.push(`跳过 ${skipped} 项（原因见任务明细）`)
  }
  parts.push(`站房待办 ${doneTask.站房待办编号} 已生成`)
  return { ok: true, message: parts.join('，'), task: doneTask }
}

// 站房待办接收处置结果：一张任务只落一条待安排待办，按来源任务编号去重，重复提交不会重复生成。
function syncStationhouseTodo(task: DisposalTask, disposed: EntryRow[]): string {
  const rows = listRows('stationhouse')
  const existing = rows.find((row) => String(row['来源任务编号'] ?? '') === task.任务编号)
  if (existing) {
    return String(existing['记录编号'])
  }
  const id = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const code = `STAH-${String(id).padStart(4, '0')}`
  const codes = disposed.map((row) => String(row['记录编号'])).join('、')
  const todo: EntryRow = {
    id,
    status: '待安排',
    pending: true,
    abnormal: false,
    记录编号: code,
    站点编号: task.站点编号,
    维护类型: '巡检故障处置',
    维护内容: `处置任务 ${task.任务编号} 已提交，${disposed.length} 项问题（${codes}）已处置。处理措施：${task.处理措施}`,
    维护单位: task.归属单位,
    维护日期: task.提交时间.slice(0, 10),
    费用支出: 0,
    维护状态: '待安排',
    来源任务编号: task.任务编号,
  }
  saveRows('stationhouse', [...rows, todo])
  return code
}

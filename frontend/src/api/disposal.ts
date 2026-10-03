import { listRows, saveRows } from '@/data/local-store'
import {
  allTasks,
  findTask,
  getTask,
  nextTaskId,
  upsertTask,
} from '@/data/disposal-store'
import type {
  DisposalItem,
  DisposalTask,
  EntryRow,
  ProblemOption,
} from '@/data/types'

// 巡检问题批量处置服务：
// 1. 只有「发现故障」的巡检记录才算未处置问题，勾选按问题编号去重；
// 2. 一张处置任务只装同一站点、同一归属单位的问题，整组共用一份处理措施；
// 3. 逐项可跳过（必须写原因），【待配件】问题的措施没写清配件去向按失败保留原状态；
// 4. 同站点同问题集合只生成一张任务，重复提交只更新不新增；
// 5. 站房类处置结果移交站房维护待办，按问题编号去重反馈。

const FAULT_STATUS = '发现故障'
const CLOSED_STATUS = '已处置'
const HOUSE_CATEGORY = '站房'
const HOUSE_CLOSED_STATUSES = new Set(['已完成', '已验收'])

export type GroupValidateResult =
  | { ok: true; stationNo: string; stationName: string; org: string }
  | { ok: false; message: string }

export type SubmitRequest = {
  measure: string
  // 跳过的问题编号 -> 跳过原因；不在表里的问题按处理措施逐项提交。
  skips?: Record<number, string>
}

export type RetryRequest = {
  action: 'handle' | 'skip'
  measure: string
  skipReason?: string
}

function nowText(): string {
  return new Date().toLocaleString('zh-CN', { hour12: false })
}

function toOption(row: EntryRow): ProblemOption {
  return {
    id: Number(row.id),
    recordNo: String(row['记录编号'] ?? ''),
    stationNo: String(row['站点编号'] ?? ''),
    stationName: String(row['站点名称'] ?? ''),
    org: String(row['归属单位'] ?? '未归属单位'),
    category: String(row['问题类别'] ?? '其他'),
    problem: String(row['发现问题'] ?? ''),
    inspector: String(row['巡检人员'] ?? ''),
    inspectedAt: String(row['巡检日期'] ?? ''),
  }
}

export function listOpenProblems(filters: {
  stationNo?: string
  org?: string
  category?: string
  keyword?: string
} = {}): ProblemOption[] {
  const keyword = (filters.keyword ?? '').trim()
  return listRows('inspection')
    .filter((row) => String(row.status) === FAULT_STATUS && row.pending)
    .map(toOption)
    .filter((item) => {
      if (filters.stationNo && item.stationNo !== filters.stationNo) {
        return false
      }
      if (filters.org && item.org !== filters.org) {
        return false
      }
      if (filters.category && item.category !== filters.category) {
        return false
      }
      if (
        keyword &&
        !`${item.recordNo}${item.stationNo}${item.stationName}${item.problem}${item.org}`.includes(
          keyword,
        )
      ) {
        return false
      }
      return true
    })
}

function validateGroup(problemIds: number[]): {
  result: GroupValidateResult
  options: ProblemOption[]
} {
  // 勾选去重：重复选择同一问题只参与一次，结果自然不会重复显示。
  const uniqueIds = [...new Set(problemIds.map((id) => Number(id)))]
  const options = listOpenProblems()
  const picked = uniqueIds
    .map((id) => options.find((item) => item.id === id))
    .filter((item): item is ProblemOption => Boolean(item))

  if (picked.length === 0) {
    return {
      result: { ok: false, message: '所选问题均已处置或已被其他任务处理，请刷新后重试' },
      options: [],
    }
  }
  const stationNo = picked[0].stationNo
  const org = picked[0].org
  const stationName = picked[0].stationName
  const otherStation = picked.find((item) => item.stationNo !== stationNo)
  if (otherStation) {
    return {
      result: {
        ok: false,
        message: `一张处置任务只能包含同一站点的问题：${stationNo} 与 ${otherStation.stationNo} 不能混入同组`,
      },
      options: picked,
    }
  }
  const otherOrg = picked.find((item) => item.org !== org)
  if (otherOrg) {
    return {
      result: {
        ok: false,
        message: `不同单位的问题不能混入同组：${org} 与 ${otherOrg.org} 需分组处置`,
      },
      options: picked,
    }
  }
  return {
    result: { ok: true, stationNo, stationName, org },
    options: picked,
  }
}

function buildResultKey(stationNo: string, options: ProblemOption[]): string {
  const ids = options.map((item) => item.id).sort((a, b) => a - b)
  return `${stationNo}::${ids.join(',')}`
}

function taskNoOf(id: number): string {
  return `TASK-${String(id).padStart(4, '0')}`
}

function buildItem(option: ProblemOption): DisposalItem {
  return {
    problemId: option.id,
    recordNo: option.recordNo,
    stationNo: option.stationNo,
    stationName: option.stationName,
    org: option.org,
    category: option.category,
    problem: option.problem,
    inspector: option.inspector,
    inspectedAt: option.inspectedAt,
    state: 'pending',
  }
}

// 整组生成一张处置任务；同站点同问题集合已生成过任务时直接返回原任务，不重复建单。
export function createDisposalTask(problemIds: number[]):
  | { ok: true; task: DisposalTask; reused: boolean }
  | { ok: false; message: string } {
  const { result, options } = validateGroup(problemIds)
  if (!result.ok) {
    return { ok: false, message: result.message }
  }
  const resultKey = buildResultKey(result.stationNo, options)
  const existing = findTask(resultKey)
  if (existing) {
    return { ok: true, task: existing, reused: true }
  }
  const id = nextTaskId()
  const task: DisposalTask = {
    id,
    taskNo: taskNoOf(id),
    stationNo: result.stationNo,
    stationName: result.stationName,
    org: result.org,
    measure: '',
    status: 'processing',
    items: options.map(buildItem),
    createdAt: nowText(),
    submittedAt: '',
    resultKey,
  }
  return { ok: true, task: upsertTask(task), reused: false }
}

export function listDisposalTasks(): DisposalTask[] {
  return allTasks()
}

function failReasonOf(option: ProblemOption, measure: string): string {
  // 【待配件】类问题：处理措施不写清配件去向视为处置失败，原状态保留，允许重试。
  if (option.problem.includes('【待配件】') && !measure.includes('配件')) {
    return '该问题待配件处理，处理措施未写明配件调拨/到场安排，暂不能关闭'
  }
  return ''
}

// 站房类成功处置结果同步到站房维护：同站点有未关闭待办就追加反馈，没有就自动移交一条新待办。
function handoverToStationHouse(
  task: DisposalTask,
  succeeded: DisposalItem[],
): DisposalTask['houseHandover'] {
  const houseItems = succeeded.filter((item) => item.category === HOUSE_CATEGORY)
  if (houseItems.length === 0) {
    return task.houseHandover
  }
  const rows = listRows('stationhouse')
  const previous = new Set(task.houseHandover?.problemIds ?? [])

  let updated = task.houseHandover?.updated ?? 0
  let created = task.houseHandover?.created ?? 0
  const touchedIds = new Set<number>(previous)

  for (const item of houseItems) {
    if (previous.has(item.problemId)) {
      continue
    }
    const feedback = `[${task.taskNo} 巡检处置 ${nowText().split(' ')[0]}] ${item.recordNo}：${item.measure ?? task.measure}`
    const sameStation = rows
      .map((row, index) => ({ row, index }))
      .filter(
        ({ row }) =>
          String(row['站点编号'] ?? '') === item.stationNo &&
          !HOUSE_CLOSED_STATUSES.has(String(row.status)),
      )
    // 优先挂到仍待处理的待办上，其次任一未关闭记录；都没有就新建一条待办。
    const target =
      sameStation
        .slice()
        .sort((a, b) => Number(b.row.pending) - Number(a.row.pending))[0] ?? null

    if (target) {
      const existed = String(target.row['巡检处置反馈'] ?? '')
      const merged = existed ? `${existed}\n${feedback}` : feedback
      rows[target.index] = { ...rows[target.index], 巡检处置反馈: merged }
      updated += 1
    } else {
      const id = rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
      rows.push({
        id,
        status: '待安排',
        pending: true,
        abnormal: false,
        记录编号: `HOUS-XFER-${String(id).padStart(4, '0')}`,
        站点编号: item.stationNo,
        维护类型: '巡检移交',
        维护内容: item.problem.replace(/【待配件】/g, ''),
        维护单位: item.org,
        维护日期: '',
        费用支出: 0,
        维护状态: '待安排',
        巡检处置反馈: feedback,
      })
      created += 1
    }
    touchedIds.add(item.problemId)
  }

  if (updated !== (task.houseHandover?.updated ?? 0) ||
      created !== (task.houseHandover?.created ?? 0)) {
    saveRows('stationhouse', rows)
  }
  return { updated, created, problemIds: [...touchedIds] }
}

// 一次提交整组处理措施：逐项落处置/跳过/失败，成功项回写巡检记录，失败项保留「发现故障」。
export function submitDisposalTask(
  taskId: number,
  request: SubmitRequest,
):
  | { ok: true; task: DisposalTask }
  | { ok: false; message: string } {
  const task = getTask(taskId)
  if (!task) {
    return { ok: false, message: '处置任务不存在或已被删除' }
  }
  const measure = request.measure.trim()
  if (!measure) {
    return { ok: false, message: '请填写整组统一的处理措施' }
  }

  const skips = request.skips ?? {}
  const current = new Map(
    listRows('inspection')
      .filter((row) => String(row.status) === FAULT_STATUS)
      .map((row) => [Number(row.id), row]),
  )

  const succeeded: DisposalItem[] = []
  const items = task.items.map((item) => {
    // 已成功的不重跑：重复提交只保留一次结果。
    if (item.state === 'success') {
      succeeded.push(item)
      return item
    }
    // 此前跳过的项保持跳过：只能在任务面板里用「重试处置」解除，整组重提不会误改。
    if (item.state === 'skipped' && !(item.problemId in skips)) {
      return item
    }
    const rawReason = skips[item.problemId]
    const skipReason = typeof rawReason === 'string' ? rawReason.trim() : ''
    if (skipReason) {
      return { ...item, state: 'skipped' as const, skipReason }
    }
    if (!current.has(item.problemId)) {
      return {
        ...item,
        state: 'failed' as const,
        failReason: '问题状态已变化（可能已在其他入口处置），刷新后可从任务中移除',
      }
    }
    const option = listOpenProblems().find((opt) => opt.id === item.problemId)
    if (option) {
      const reason = failReasonOf(option, measure)
      if (reason) {
        return { ...item, state: 'failed' as const, failReason: reason, measure }
      }
    }
    const done: DisposalItem = {
      ...item,
      state: 'success',
      measure,
      failReason: undefined,
    }
    succeeded.push(done)
    return done
  })

  // 成功项回写巡检记录：状态关闭、待处理标记清除，不会再残留。
  if (succeeded.length > 0) {
    const rows = listRows('inspection')
    const successIds = new Set(succeeded.map((item) => item.problemId))
    saveRows(
      'inspection',
      rows.map((row) =>
        successIds.has(Number(row.id))
          ? {
              ...row,
              status: CLOSED_STATUS,
              pending: false,
              abnormal: false,
              处理措施: measure,
              巡检状态: CLOSED_STATUS,
            }
          : row,
      ),
    )
  }

  const hasOpen = items.some((item) => item.state !== 'success')
  const next: DisposalTask = {
    ...task,
    measure,
    status: hasOpen ? 'processing' : 'done',
    items,
    submittedAt: task.submittedAt || nowText(),
  }
  next.houseHandover = handoverToStationHouse(next, succeeded)
  return { ok: true, task: upsertTask(next) }
}

// 失败/跳过项的单项重试：仍待处置时按新措施处理，或补原因跳过。
export function retryDisposalItem(
  taskId: number,
  problemId: number,
  request: RetryRequest,
):
  | { ok: true; task: DisposalTask }
  | { ok: false; message: string } {
  const task = getTask(taskId)
  if (!task) {
    return { ok: false, message: '处置任务不存在或已被删除' }
  }
  const index = task.items.findIndex((item) => item.problemId === problemId)
  if (index < 0) {
    return { ok: false, message: '该问题不在此处置任务中' }
  }
  const item = task.items[index]
  if (item.state === 'success') {
    return { ok: false, message: '该问题已处置完成，无需重试' }
  }

  if (request.action === 'skip') {
    const reason = (request.skipReason ?? '').trim()
    if (!reason) {
      return { ok: false, message: '跳过问题必须逐项填写跳过原因' }
    }
    task.items[index] = {
      ...item,
      state: 'skipped',
      skipReason: reason,
      failReason: undefined,
    }
  } else {
    const measure = request.measure.trim()
    if (!measure) {
      return { ok: false, message: '请填写该项的处理措施' }
    }
    const option = listOpenProblems().find((opt) => opt.id === problemId)
    if (!option) {
      return { ok: false, message: '该问题已不在待处置列表中，请刷新后查看' }
    }
    const reason = failReasonOf(option, measure)
    if (reason) {
      task.items[index] = {
        ...item,
        state: 'failed',
        measure,
        failReason: reason,
        skipReason: undefined,
      }
    } else {
      task.items[index] = {
        ...item,
        state: 'success',
        measure,
        failReason: undefined,
        skipReason: undefined,
      }
    }
  }

  const items = task.items
  if (items[index].state === 'success') {
    // 只回写本轮新成功的：此前已关闭的巡检记录不能被重复覆盖。
    const rows = listRows('inspection')
    const freshId = problemId
    saveRows(
      'inspection',
      rows.map((row) =>
        Number(row.id) === freshId
          ? {
              ...row,
              status: CLOSED_STATUS,
              pending: false,
              abnormal: false,
              处理措施: items[index].measure || task.measure,
              巡检状态: CLOSED_STATUS,
            }
          : row,
      ),
    )
  }

  const hasOpen = items.some((entry) => entry.state !== 'success')
  const next: DisposalTask = {
    ...task,
    status: hasOpen ? 'processing' : 'done',
    submittedAt: task.submittedAt || nowText(),
  }
  const currentSucceeded = next.items.filter((entry) => entry.state === 'success')
  next.houseHandover = handoverToStationHouse(next, currentSucceeded)
  return { ok: true, task: upsertTask(next) }
}

export function readDisposalTask(taskId: number): DisposalTask | undefined {
  return getTask(taskId)
}

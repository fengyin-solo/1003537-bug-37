/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

// 巡检问题批量处置：候选问题、处置任务与逐项结果都在这里约定。
export type DisposalItemState = 'pending' | 'success' | 'skipped' | 'failed'

export type DisposalItem = {
  problemId: number
  recordNo: string
  stationNo: string
  stationName: string
  org: string
  category: string
  problem: string
  inspector: string
  inspectedAt: string
  state: DisposalItemState
  measure?: string
  skipReason?: string
  failReason?: string
}

export type DisposalTask = {
  id: number
  taskNo: string
  stationNo: string
  stationName: string
  org: string
  measure: string
  status: 'processing' | 'done'
  items: DisposalItem[]
  createdAt: string
  submittedAt: string
  // 同站点同问题集合只对应一张任务，重复勾选整组直接返回原任务。
  resultKey: string
  // 站房待办接收情况：按问题编号去重，重复提交不重复反馈。
  houseHandover?: { updated: number; created: number; problemIds: number[] }
}

export type ProblemOption = {
  id: number
  recordNo: string
  stationNo: string
  stationName: string
  org: string
  category: string
  problem: string
  inspector: string
  inspectedAt: string
}

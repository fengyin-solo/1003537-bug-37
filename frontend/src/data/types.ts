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

// 巡检批量处置：一张任务对应一组同站点、同单位的未处置问题。
export type DisposalItemResult = {
  issueId: number
  记录编号: string
  ok: boolean
  message: string
}

export type DisposalTask = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  任务编号: string
  站点编号: string
  归属单位: string
  问题ID列表: number[]
  处理措施: string
  提交人: string
  创建时间: string
  提交时间: string
  提交令牌: string
  处置结果: DisposalItemResult[]
  站房待办编号: string
}

export type DisposalTaskResult = {
  ok: boolean
  message: string
  task: DisposalTask | null
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

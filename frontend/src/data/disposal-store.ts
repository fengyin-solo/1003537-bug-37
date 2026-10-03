import type { DisposalTask } from './types'

// 处置任务单独存一份 localStorage：巡检记录是业务数据，任务是批量处置过程，互不覆盖。

const TASK_KEY = 'hydrology-monitor-station:disposal-tasks'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

let cache: DisposalTask[] | null = null

function read(): DisposalTask[] {
  if (cache !== null) {
    return cache
  }
  if (typeof window === 'undefined' || !window.localStorage) {
    cache = []
    return cache
  }
  const raw = window.localStorage.getItem(TASK_KEY)
  if (!raw) {
    cache = []
    return cache
  }
  try {
    cache = JSON.parse(raw) as DisposalTask[]
  } catch {
    cache = []
  }
  return cache
}

function persist(tasks: DisposalTask[]): void {
  cache = tasks
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(TASK_KEY, JSON.stringify(tasks))
  }
}

export function allTasks(): DisposalTask[] {
  return read()
}

export function findTask(resultKey: string): DisposalTask | undefined {
  return read().find((task) => task.resultKey === resultKey)
}

export function getTask(id: number): DisposalTask | undefined {
  return read().find((task) => task.id === id)
}

export function upsertTask(task: DisposalTask): DisposalTask {
  const tasks = read()
  const index = tasks.findIndex((item) => item.id === task.id)
  const next = clone(task)
  if (index >= 0) {
    tasks[index] = next
  } else {
    tasks.unshift(next)
  }
  persist(tasks)
  return clone(next)
}

export function nextTaskId(): number {
  return read().reduce((max, task) => Math.max(max, task.id), 0) + 1
}

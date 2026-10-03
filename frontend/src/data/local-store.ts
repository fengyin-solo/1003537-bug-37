import { SEED_ROWS } from './seed'
import { normalizeStore } from './normalize'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'hydrology-monitor-station:entries'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function persist(data: Record<string, EntryRow[]>): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  }
}

function prepare(data: Record<string, EntryRow[]>): Record<string, EntryRow[]> {
  const normalized = normalizeStore(data)
  persist(normalized)
  return normalized
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = () => prepare(clone(SEED_ROWS))
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback()
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    return fallback()
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    // 缺模块时用种子补齐：新增模块后旧缓存也能直接打开。
    return prepare({ ...clone(SEED_ROWS), ...parsed })
  } catch {
    return fallback()
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  normalizeStore({ [key]: rows })
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}

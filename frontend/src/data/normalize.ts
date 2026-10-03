import { MODULE_BY_KEY } from './modules'
import type { EntryRow } from './types'

// 读库后统一做一次数据规范化：历史脏数据在这里就地修掉，页面就不用各自兜底。

const PLACEHOLDERS = new Set([
  '',
  'undefined',
  'null',
  '—',
  '-',
])

const CATEGORY_RULES: { match: RegExp; category: string }[] = [
  { match: /站房|屋面|门窗|围墙|配电|电路|防水/, category: '站房' },
  { match: /通信|通讯|天线|卫星|信道|信号/, category: '通信' },
  { match: /雨量/, category: '监测设备' },
  { match: /水位|缆道/, category: '监测设备' },
  { match: /院落|排水|观测场/, category: '站场环境' },
]

function isMissing(value: unknown): boolean {
  return value === undefined || PLACEHOLDERS.has(String(value).trim())
}

function guessCategory(row: EntryRow): string {
  const text = `${String(row['检查项目'] ?? '')} ${String(row['发现问题'] ?? '')}`
  const hit = CATEGORY_RULES.find((rule) => rule.match.test(text))
  return hit ? hit.category : '其他'
}

// 旧巡检记录缺少问题归属时，按站点编号到监测站点里回填；归属单位仍查不到则挂「未归属单位」。
function backfillInspection(
  rows: EntryRow[],
  stationLookup: Map<string, EntryRow>,
): boolean {
  let changed = false
  for (const row of rows) {
    const stationNo = String(row['站点编号'] ?? '').trim()
    const station = stationLookup.get(stationNo)

    if (isMissing(row['归属单位'])) {
      const org = station && !isMissing(station['管理单位'])
        ? String(station['管理单位'])
        : '未归属单位'
      row['归属单位'] = org
      changed = true
    }
    if (isMissing(row['问题类别'])) {
      row['问题类别'] = guessCategory(row)
      changed = true
    }
    if (isMissing(row['站点名称'])) {
      const name = station && !isMissing(station['站点名称'])
        ? String(station['站点名称'])
        : stationNo || '未知站点'
      row['站点名称'] = name
      changed = true
    }
  }
  return changed
}

// 已关闭（末态）的记录会残留待处理/异常标记，发现故障这类脏数据最典型。
function cleanFlags(rows: EntryRow[], terminalStatus: string): boolean {
  let changed = false
  for (const row of rows) {
    if (String(row.status) === terminalStatus && (row.pending || row.abnormal)) {
      row.pending = false
      row.abnormal = false
      changed = true
    }
  }
  return changed
}

export function normalizeStore(
  data: Record<string, EntryRow[]>,
): Record<string, EntryRow[]> {
  let changed = false
  const stationRows = data.station ?? []
  const stationLookup = new Map(
    stationRows.map((row) => [String(row['站点编号'] ?? '').trim(), row]),
  )

  for (const [key, rows] of Object.entries(data)) {
    const meta = MODULE_BY_KEY.get(key)
    if (!meta || !Array.isArray(rows)) {
      continue
    }
    const terminalStatus = meta.statuses[meta.statuses.length - 1]
    if (cleanFlags(rows, terminalStatus)) {
      changed = true
    }
    if (key === 'inspection' && backfillInspection(rows, stationLookup)) {
      changed = true
    }
  }
  return changed ? data : data
}

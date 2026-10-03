// 端到端逻辑校验：mock localStorage 后直接跑数据层与处置服务。
// 用 tsx 之外的方式运行：node 20 通过 --import + tsx 不现实，这里用 vite-node 没有装，
// 改用 esbuild 把用到的 TS 打成一个临时 cjs 再执行。
import { build } from 'esbuild'
import { writeFileSync, mkdirSync } from 'node:fs'

const ENTRY = 'scripts/__e2e_entry.ts'
mkdirSync('scripts', { recursive: true })
writeFileSync(
  ENTRY,
  `
import { listRows } from '../src/data/local-store'
import {
  createDisposalTask,
  listOpenProblems,
  listDisposalTasks,
  retryDisposalItem,
  submitDisposalTask,
} from '../src/api/disposal'

function assert(cond: boolean, message: string) {
  if (!cond) {
    console.error('✗ ' + message)
    process.exitCode = 1
  } else {
    console.log('✓ ' + message)
  }
}

const problems = listOpenProblems()
console.log('待处置问题数:', problems.length)

// 1. 脏数据清理：INSP-0010 已处置，pending/abnormal 必须被清掉
const insp10 = listRows('inspection').find((r) => r['记录编号'] === 'INSP-0010')
assert(insp10?.pending === false && insp10?.abnormal === false, '已处置故障不残留待处理/异常标记')
assert(!problems.some((p) => p.recordNo === 'INSP-0010'), '已处置故障不出现在待处置列表')

// 2. 旧记录回填：INSP-0011 缺归属单位/问题类别
const insp11 = listRows('inspection').find((r) => r['记录编号'] === 'INSP-0011')
assert(insp11?.['归属单位'] === '恩施水文水资源勘测局', '旧记录按站点回填归属单位')
assert(String(insp11?.['问题类别']) === '监测设备', '旧记录按检查内容回填问题类别（雨量计→监测设备）')
assert(String(insp11?.['站点名称']) === '清江恩施水文站', '旧记录回填站点名称')

const byNo = Object.fromEntries(problems.map((p) => [p.recordNo, p]))

// 3. 不同站点不能混组
const crossSite = createDisposalTask([byNo['INSP-0004'].id, byNo['INSP-0008'].id])
assert(crossSite.ok === false, '不同站点的问题不能生成同一张任务')

// 4. 同站点不同单位混组（先篡改一条造数据，再还原）
// INSP-0006 在 STAT-0002 襄阳；改其归属为其他单位，与 STAT-0002 真实单位冲突。
// 直接用伪造 id 不行，因此用同站点全部同单位的情况下，改数据后测试。
const rows002 = listRows('inspection')
const target = rows002.find((r) => r['记录编号'] === 'INSP-0006')
const originalOrg = target!['归属单位']
target!['归属单位'] = '武汉水文水资源勘测局'
const { saveRows } = await import('../src/data/local-store')
saveRows('inspection', [...rows002])
const crossOrg = createDisposalTask([byNo['INSP-0006'].id, byNo['INSP-0007'].id])
assert(crossOrg.ok === false && /不同单位/.test(crossOrg.ok ? '' : crossOrg.message), '不同单位的问题不能混入同组')
target!['归属单位'] = originalOrg
saveRows('inspection', [...rows002])

// 5. 重复勾选去重 + 整组建单 + 幂等
const first = createDisposalTask([
  byNo['INSP-0004'].id,
  byNo['INSP-0005'].id,
  byNo['INSP-0009'].id,
  byNo['INSP-0004'].id,
])
assert(first.ok === true && first.reused === false, '同站点同单位问题整组生成一张任务（重复id去重）')
const taskId = first.ok ? first.task.id : -1
const second = createDisposalTask([byNo['INSP-0009'].id, byNo['INSP-0005'].id, byNo['INSP-0004'].id])
assert(second.ok === true && second.reused === true && second.ok && second.task.id === taskId, '同站点同问题集合重复生成只返回原任务')
assert(listDisposalTasks().filter((t) => t.id === taskId).length === 1, '重复提交不产生第二张任务')

// 6. 措施不提配件 → 0004 失败保留；0005 跳过需原因；0009 成功
const noSkipReason = submitDisposalTask(taskId, { measure: '现场维修处理完毕' })
assert(noSkipReason.ok === true, '整组一次提交处理措施')
const t1 = listDisposalTasks().find((t) => t.id === taskId)!
const s4 = t1.items.find((i) => i.recordNo === 'INSP-0004')!
const s5 = t1.items.find((i) => i.recordNo === 'INSP-0005')!
const s9 = t1.items.find((i) => i.recordNo === 'INSP-0009')!
assert(s4.state === 'failed' && !!s4.failReason, '【待配件】问题措施未写配件去向 → 失败并保留原因')
assert(s5.state === 'success', '未跳过项按整组措施处置成功')
assert(s9.state === 'success', '另一项同样成功')
const stillOpen = listOpenProblems().map((p) => p.recordNo)
assert(stillOpen.includes('INSP-0004'), '失败项保留发现故障原状态，仍可重试')
assert(!stillOpen.includes('INSP-0005') && !stillOpen.includes('INSP-0009'), '成功项不再出现在待处置列表')
const row5 = listRows('inspection').find((r) => r['记录编号'] === 'INSP-0005')
assert(row5?.status === '已处置' && row5?.pending === false, '成功项巡检记录关闭并清标记')

// 7. 带跳过原因重新提交：0005 已成功不受影响；单独把失败的 0004 改为跳过
const skipIt = retryDisposalItem(taskId, s4.problemId, { action: 'skip', skipReason: '需等专项经费，转下月计划' })
assert(skipIt.ok === true, '失败项可逐项跳过并填写原因')
const t2 = listDisposalTasks().find((t) => t.id === taskId)!
const s4b = t2.items.find((i) => i.recordNo === 'INSP-0004')!
assert(s4b.state === 'skipped' && /专项经费/.test(s4b.skipReason ?? ''), '跳过项保留跳过原因')

// 8. 失败重试成功（措施写配件）
const retry = retryDisposalItem(taskId, s4.problemId, { action: 'handle', measure: '已申请配件，支撑件到场后完成更换加固' })
assert(retry.ok === true, '跳过项可再重试处置')
const t3 = listDisposalTasks().find((t) => t.id === taskId)!
const s4c = t3.items.find((i) => i.recordNo === 'INSP-0004')!
assert(s4c.state === 'success', '措施写明配件后重试成功')
assert(t3.status === 'done', '全部成功后任务变为已完成')

// 9. 站房待办接收：0004/0005 属站房类，应更新 STAT-0001 的未关闭待办且按问题去重
const house1 = listRows('stationhouse').filter((r) => r['站点编号'] === 'STAT-0001')
const feedbackRows = house1.filter((r) => String(r['巡检处置反馈'] ?? '').includes('TASK-'))
const feedbackText = feedbackRows.map((r) => String(r['巡检处置反馈'])).join('\\n')
assert(feedbackText.includes('INSP-0004') && feedbackText.includes('INSP-0005'), '站房待办接收到站房类处置结果')
assert(t3.houseHandover!.problemIds.length === 2, '按问题编号移交两条结果')
// 重复提交不应再追加
const repeat = submitDisposalTask(taskId, { measure: '再次提交试试' })
assert(repeat.ok === true, '任务完成后重复提交被幂等接收')
const t4 = listDisposalTasks().find((t) => t.id === taskId)!
assert(t4.houseHandover!.problemIds.length === 2 && t4.houseHandover!.updated === t3.houseHandover!.updated, '重复提交不重复反馈站房待办')

// 10. 无待办站点的站房问题 → 自动移交新建待办
const task2 = createDisposalTask([byNo['INSP-0008'].id])
assert(task2.ok === true, 'STAT-0003 站房问题单独成组')
const id2 = task2.ok ? task2.task.id : -1
submitDisposalTask(id2, { measure: '重做屋面防水层并验收' })
const newHouse = listRows('stationhouse').find((r) => r['站点编号'] === 'STAT-0003' && String(r['维护类型']) === '巡检移交')
// STAT-0003 已有施工中待办 → 挂到它上面；只有不存在未关闭待办时才新建
const stat3Open = listRows('stationhouse').filter((r) => r['站点编号'] === 'STAT-0003' && !['已完成','已验收'].includes(String(r.status)))
const stat3Fb = stat3Open.some((r) => String(r['巡检处置反馈'] ?? '').includes('INSP-0008'))
assert(stat3Fb, '同站点有未关闭待办时追加反馈到该待办')
assert(!newHouse, '已有未关闭待办时不重复新建')

console.log('\\n全部校验结束')
`,
)

await build({
  entryPoints: [ENTRY],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: 'scripts/__e2e_bundle.mjs',
  logLevel: 'silent',
})

// 注入 localStorage mock 后执行
const { readFileSync } = await import('node:fs')
const code = readFileSync('scripts/__e2e_bundle.mjs', 'utf8')
const store = new Map()
const localStorageMock = `
const __store = new Map();
globalThis.localStorage = {
  getItem: (k) => (__store.has(k) ? __store.get(k) : null),
  setItem: (k, v) => __store.set(k, String(v)),
  removeItem: (k) => __store.delete(k),
};
`
const { pathToFileURL } = await import('node:url')
const tmp = 'scripts/__e2e_run.mjs'
writeFileSync(tmp, localStorageMock + code)
await import(pathToFileURL(tmp).href)

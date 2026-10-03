// 冒烟脚本：在 node 里直接跑 local-service 的巡检批量处置逻辑（node 环境没有
// localStorage，local-store 会自动退化为内存态，正好隔离测试）。
// 运行：npm run smoke
import {
  createDisposalTask,
  listDisposalTasks,
  listPendingIssues,
  loadOverview,
  normalizeInspectionRows,
  submitDisposalTask,
} from '@/api/local-service'
import { listRows, saveRows } from '@/data/local-store'
import type { EntryRow } from '@/data/types'

let passed = 0
let failed = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    passed += 1
    console.log(`PASS ${name}`)
  } else {
    failed += 1
    console.log(`FAIL ${name}`, extra ?? '')
  }
}

// 1. 旧数据规整：已关闭故障清掉残留待处理标记，缺归属按站点回填
normalizeInspectionRows()
const rows1 = listRows('inspection')
const r3 = rows1.find((r) => Number(r.id) === 3)!
const r2 = rows1.find((r) => Number(r.id) === 2)!
const r6 = rows1.find((r) => Number(r.id) === 6)!
check('已处置故障不再残留待处理标记', r3.status === '已处置' && r3.pending === false, r3)
check('缺归属旧记录按站点回填管理单位', r2['归属单位'] === '城东巡测中心', r2['归属单位'])
check('另一站点缺归属记录回填对应单位', r6['归属单位'] === '城东巡测中心', r6['归属单位'])

// 2. 待处置问题清单
const issues = listPendingIssues()
check('待处置问题为发现故障的 4 条', issues.map((r) => Number(r.id)).join(',') === '1,2,4,6', issues.map((r) => r.id))

// 3. 生成任务：重复勾选去重
const t1 = createDisposalTask([1, 2, 1, 2], '测试员')
check('整组生成一张任务', t1.ok && t1.task!.问题ID列表.join(',') === '1,2', t1)
check('任务编号与站点单位正确', t1.task!.任务编号 === 'DISP-0001' && t1.task!.站点编号 === 'STAT-0001' && t1.task!.归属单位 === '城东巡测中心')

// 4. 跨站点 / 跨单位不能成组
const crossSite = createDisposalTask([1, 4], '测试员')
check('跨站点问题不能混入同组', !crossSite.ok && crossSite.message.includes('同一站点'), crossSite.message)
// 人为制造同站点不同单位（站点划归调整后留下的旧归属）
const mutated = listRows('inspection').map((r) =>
  Number(r.id) === 2 ? { ...r, ['归属单位']: '城西巡测中心' } : r,
)
saveRows('inspection', mutated)
const crossUnit = createDisposalTask([1, 2], '测试员')
check('不同单位问题不能混入同组', !crossUnit.ok && crossUnit.message.includes('不同单位'), crossUnit.message)
saveRows('inspection', listRows('inspection').map((r) => (Number(r.id) === 2 ? { ...r, ['归属单位']: '城东巡测中心' } : r)))

// 5. 提交：逐项落库 + 站房待办联动
const s1 = submitDisposalTask(t1.task!.id, '清理探头漂浮物并更换蓄电池', 'token-1', '测试员')
check('一次提交整组处理措施', s1.ok && s1.message.includes('处置 2 项'), s1.message)
const after1 = listRows('inspection')
const d1 = after1.find((r) => Number(r.id) === 1)!
const d2 = after1.find((r) => Number(r.id) === 2)!
check(
  '处置项状态/待处理/措施全部落库',
  d1.status === '已处置' && d1.pending === false && d1.abnormal === false && d1['处理措施'] === '清理探头漂浮物并更换蓄电池'
    && d2.status === '已处置' && d2.pending === false,
  [d1, d2],
)
const todos1 = listRows('stationhouse').filter((r) => r['来源任务编号'] === 'DISP-0001')
check(
  '站房待办接收处置结果',
  todos1.length === 1 && todos1[0].status === '待安排' && todos1[0].pending === true
    && todos1[0]['维护类型'] === '巡检故障处置' && todos1[0]['维护单位'] === '城东巡测中心'
    && String(todos1[0]['维护内容']).includes('INSP-0001'),
  todos1,
)
check('任务记录站房待办编号', listDisposalTasks()[0].站房待办编号 === todos1[0]['记录编号'])

// 6. 重复提交只保留一次结果
const s2 = submitDisposalTask(t1.task!.id, '换个措施重复提交', 'token-2', '测试员')
const todos2 = listRows('stationhouse').filter((r) => r['来源任务编号'] === 'DISP-0001')
const stillOne = listRows('inspection').find((r) => Number(r.id) === 1)!
check('重复提交返回首次结果', s2.ok && s2.message.includes('已提交过'), s2.message)
check('重复提交不重复生成站房待办', todos2.length === 1, todos2.length)
check('重复提交不覆盖首次处理措施', stillOne['处理措施'] === '清理探头漂浮物并更换蓄电池', stillOne['处理措施'])

// 7. 已处置问题不能再进新组
const again = createDisposalTask([1], '测试员')
check('已处置问题不能重复组批', !again.ok && again.message.includes('不是待处置问题'), again.message)

// 8. 逐项跳过原因 + 失败项保留原状态供重试
const t2 = createDisposalTask([6], '测试员')
check('第二组任务生成', t2.ok, t2)
// 提交前问题被别的入口改状态 → 提交时逐项跳过
saveRows('inspection', listRows('inspection').map((r) => (Number(r.id) === 6 ? { ...r, status: '已巡检' } : r)))
const s3 = submitDisposalTask(t2.task!.id, '疏通承水口', 'token-3', '测试员')
check('整组无可处置项时提交失败并说明', !s3.ok && s3.message.includes('保留原状态'), s3.message)
const skipItem = s3.task!.处置结果[0]
check('逐项说明跳过原因', skipItem.ok === false && skipItem.记录编号 === 'INSP-0006' && skipItem.message.includes('已巡检'), skipItem)
check('任务保持待提交可重试', s3.task!.status === '待提交', s3.task!.status)
const kept = listRows('inspection').find((r) => Number(r.id) === 6)!
check('失败项保留原状态', kept.status === '已巡检' && kept.pending === true, kept)
// 恢复为待处置后重试成功
saveRows('inspection', listRows('inspection').map((r) => (Number(r.id) === 6 ? { ...r, status: '发现故障' } : r)))
const s4 = submitDisposalTask(t2.task!.id, '疏通承水口', 'token-4', '测试员')
check('重试后处置成功', s4.ok && listRows('inspection').find((r) => Number(r.id) === 6)!.status === '已处置', s4.message)

// 9. 部分跳过：建组后其中一项被别的入口关闭，提交时跳过它、其余正常落库
const extra: EntryRow = {
  id: 8, status: '发现故障', pending: true, abnormal: true,
  记录编号: 'INSP-0008', 站点编号: 'STAT-0002', 归属单位: '城西巡测中心',
  巡检日期: '2026-09-08', 巡检人员: '王工', 检查项目: '天线检查', 发现问题: '天线松动', 处理措施: '', 巡检状态: '发现故障',
}
saveRows('inspection', [...listRows('inspection'), extra])
const t4 = createDisposalTask([4, 8], '测试员')
check('同站同单位的两项问题可成组', t4.ok, t4)
saveRows('inspection', listRows('inspection').map((r) => (Number(r.id) === 4 ? { ...r, status: '已处置', pending: false } : r)))
const s5 = submitDisposalTask(t4.task!.id, '紧固天线', 'token-5', '测试员')
check('部分成功：处置 1 项跳过 1 项', s5.ok && s5.message.includes('处置 1 项') && s5.message.includes('跳过 1 项'), s5.message)
const skip5 = s5.task!.处置结果.find((i) => i.记录编号 === 'INSP-0004')!
check('跳过项说明已处置原因', skip5.ok === false && skip5.message.includes('已处置'), skip5)

// 10. 概览待处理数与残留清理一致
const overview = loadOverview()
const insp = overview.modules.find((m) => m.name === '巡检记录')!
check('概览待处理只统计未关闭项', insp.pending === listRows('inspection').filter((r) => r.pending).length, insp)

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)

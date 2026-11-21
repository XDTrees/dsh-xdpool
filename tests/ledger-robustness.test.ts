/**
 * 数据缺失时必须能渲染，不能白屏。
 *
 * 用户报的「点数据面板直接空白」查下来是两处：
 *   1. `fmtInt(undefined)` → `.toLocaleString()` 抛 TypeError
 *   2. `row.topModels.join()` → 老样本没有这个聚合，undefined 抛错
 *
 * 两者都是「一条记录缺字段就让整页消失」。这类问题静态检查抓不到
 * （类型上 `topModels` 是必填，实际数据里可以缺），所以钉成测试。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const page = readFileSync(new URL('../src/client/LedgerPage.tsx', import.meta.url), 'utf8')

/** 取一个函数/表达式的源码片段。 */
function slice(from: string, len = 400): string {
  const at = page.indexOf(from)
  if (at < 0) throw new Error(`找不到: ${from}`)
  return page.slice(at, at + len)
}

describe('the ledger survives records with missing fields', () => {
  it('formats numbers without throwing on undefined', () => {
    const fn = slice('function fmtInt')
    // 必须先判空再格式化。
    expect(fn).toMatch(/value === null \|\| value === undefined/)
    expect(fn).toContain('—')
  })

  it('formats durations without throwing on undefined', () => {
    const fn = slice('function fmtMs')
    expect(fn).toMatch(/ms === null \|\| ms === undefined/)
  })

  it('joins the top-models column defensively', () => {
    // 老样本没有 topModels 这个聚合，直接 .join 会让整页消失。
    expect(page).toContain('(row.topModels ?? [])')
  })

  it('renders a chart when the day series is absent', () => {
    // 老样本没有按天聚合，days 会是 undefined —— 直接 days.length 会崩。
    const charts = readFileSync(new URL('../src/client/ledger-charts.tsx', import.meta.url), 'utf8')
    expect(charts).toMatch(/days === undefined \|\| days\.length === 0/)
  })

  it('renders a rank list when the items are absent', () => {
    const charts = readFileSync(new URL('../src/client/ledger-charts.tsx', import.meta.url), 'utf8')
    expect(charts).toContain('const list = items ?? []')
    // 循环必须走 list，不能走 items
    expect(charts).not.toMatch(/items\.map\(/)
  })

  it('never calls .join directly on a possibly-absent array', () => {
    // 只查 .join( 前面没有 ?? 的那几处：导出 CSV 那两行是自造的数组，安全。
    const bad = [...page.matchAll(/(\w+)\.join\(/gu)]
      .filter(m => !page.slice(Math.max(0, m.index - 20), m.index).includes('??'))
      .filter(m => !['line', 'head'].includes(m[1] ?? ''))
      .map(m => m[1])
    expect(bad, `可疑的 .join 调用: ${bad.join(', ')}`).toEqual([])
  })
})

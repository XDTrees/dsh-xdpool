/**
 * The data dashboard page.
 *
 * The dashboard is the one page in this plugin whose failure mode is not a crash
 * but a lie. A wrong number renders just as smoothly as a right one, so the
 * tests below are about the distinctions a reader could otherwise not make:
 * turns versus calls, "no tokens" versus "no report", and the fact that every
 * total is summed from the rows it sits above rather than fetched separately.
 *
 * The React tree is not rendered: the card bundle is CommonJS consumed by a host
 * dialog with no DOM in this process, so the React-specific assertions are on
 * the source contract (the same approach `card-shell.test.ts` takes) while every
 * derived figure is checked against the real `UsageRecorder`.
 *
 * @module dsh-xdpool/tests/ledger-page
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { UsageRecorder } from '../src/stats.ts'
const page = readFileSync(new URL('../src/client/LedgerPage.tsx', import.meta.url), 'utf8')
const charts = readFileSync(new URL('../src/client/ledger-charts.tsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../src/client/styles.ts', import.meta.url), 'utf8')
const card = readFileSync(new URL('../src/client/PoolCard.tsx', import.meta.url), 'utf8')
const locales = readFileSync(new URL('../src/client/locales.ts', import.meta.url), 'utf8')
/** Two calls for one turn on one model, with usage, as the shim records them. */
function recorderWithTurns(): UsageRecorder {
  const recorder = new UsageRecorder()
  recorder.record({
    region: 'cn',
    model: 'deepseek-v4.1-flash',
    account: 'alice#a1',
    turnId: 'turn-1',
    at: Date.UTC(2026, 8, 7, 2, 35, 0),
    ok: true,
    ttftMs: 340,
    decodeMs: 1200,
    usage: { inputTokens: 900, outputTokens: 120, cachedTokens: 800 },
  })
  // A rotation: same turn, second account, after the first was cooling.
  recorder.record({
    region: 'cn',
    model: 'deepseek-v4.1-flash',
    account: 'bob#b2',
    turnId: 'turn-1',
    at: Date.UTC(2026, 8, 7, 2, 35, 4),
    ok: true,
    ttftMs: 410,
    decodeMs: 900,
    usage: { inputTokens: 950, outputTokens: 80, cachedTokens: 950 },
  })
  return recorder
}
describe('ledger page: totals derived from the rows on screen', () => {
  it('sums tokens across the model rows it renders', () => {
    const summary = recorderWithTurns().summary()
    // Both calls share a model, so the per-model row is their sum — which is
    // exactly the figure the page's `useMemo` recomputes for the KPI.
    expect(summary.rows).toHaveLength(1)
    expect(summary.rows[0]?.inputTokens).toBe(1850)
    expect(summary.rows[0]?.outputTokens).toBe(200)
    expect(summary.rows[0]?.cachedTokens).toBe(1750)
  })
  it('weights tps by calls rather than averaging per model', () => {
    // A model with one fast call must not move the fleet average as hard as one
    // running a thousand turns, so the page multiplies by `calls` and divides by
    // the call total. Source-level because the recorder does not publish a
    // weighted figure to compare against.
    expect(page).toMatch(/tpsWeighted\s*\+=\s*row\.tps\s*\*\s*row\.calls/)
    expect(page).toMatch(/tpsWeight\s*\+=\s*row\.calls/)
    expect(page).toMatch(/Math\.round\(tpsWeighted\s*\/\s*tpsWeight\)/)
  })
  it('keeps the KPI and the rank share reading the same rows', () => {
    // 按设计稿重做后没有「按模型」表格的占比列了，占比在榜单的 .rank-pct 里：
    // 榜单和 KPI 都从同一份 summary.rows 来，占比的分母是榜单自己的合计。
    expect(page).toContain('items={byChannel(summary.rows)}')
    expect(page).toContain('items={byModel(summary.rows)}')
    expect(charts).toMatch(/const total = sorted\.reduce/)
  })
  it('never divides by zero when no call was ever counted', () => {
    // 空看板时合计是 0：占比写「—」，进度条峰值至少取 1，渲染里不会除以 0。
    const summary = new UsageRecorder().summary()
    expect(summary.rows).toHaveLength(0)
    expect(charts).toContain("total <= 0 ? '—'")
    expect(charts).toContain('const peak = Math.max(1,')
  })
})
describe('ledger page: turns are not calls', () => {
  it('publishes one turn and two calls for a rotated turn', () => {
    const summary = recorderWithTurns().summary()
    expect(summary.turns).toBe(1)
    expect(summary.calls).toBe(2)
  })
  it('renders them as two separate KPI cards', () => {
    // Collapsing them into one "requests" number is the specific mistake this
    // page exists to avoid: rotation is a feature, and a reader who cannot see
    // it will read the call count as inefficiency.
    expect(page).toContain("t?.('ledger.turns')")
    // 设计稿这一格叫「调用」（ledger.requests 的中文是「请求数」，和设计稿不一致），直接写中文
    expect(page).toContain('label="调用"')
    expect(page).toContain('value={fmtInt(summary.turns)}')
    expect(page).toContain('value={fmtInt(summary.calls)}')
  })
})
describe('ledger page: a missing report is never a zero', () => {
  it('says "not reported" instead of printing 0', () => {
    expect(page).toContain("t?.('ledger.notReported')")
    // The literal `? fmtInt(...) : notReported` pairing: when the flag is false
    // the number must not render at all.
    expect(page).toMatch(/summary\.usageReported \? fmtInt\(totals\?\.input \?\? 0\)/)
  })
  it('refuses to publish a cache rate derived from absent numbers', () => {
    // `cacheHitRate` returns null when no input was ever counted, and the KPI
    // turns that into an em dash. Printing 0% there would claim the cache never
    // helped when the truth is that nothing was measured.
    expect(page).toMatch(/function cacheHitRate[\s\S]*?return total === 0 \? null/)
    expect(page).toContain("!summary.usageReported ? '—'")
  })
  it('shows a dash in a row whose call carried no usage block', () => {
    expect(page).toMatch(/function tokenCells\(call: UsageCall\)/)
    expect(page).toContain("if (call.usage === undefined) return ['—', '—', '—']")
  })
})
describe('ledger page: honesty about what the recorder is', () => {
  it('labels the totals as in-memory on the hero itself', () => {
    // Not buried in a footnote: a dashboard that looks durable and resets at
    // midnight is the thing users stop trusting after exactly one midnight.
    // 设计稿把这句写在 .mhead-org 里：「全部渠道汇总 · 内存中保留最近 2000 次调用」
    expect(page).toContain('className="mhead-org"')
    expect(page).toContain('内存中保留最近 ${String(USAGE_MAX_SAMPLES)} 次调用')
  })
  it('keeps the pool card polling for usage so the page shares one fetch', () => {
    // Two components polling the same endpoint would double the request count
    // for no benefit; the page adopts the parent's copy when it has one.
    expect(card).toContain('POOL_USAGE_PATH')
    expect(page).toMatch(/if \(shared !== undefined\) return/)
    // 共享的 usage 进来时也走一遍归一化 —— 后端字段类型不对时整页会白掉
    expect(page).toMatch(/setOwn\(normalizeSummary\(shared\)\)/)
  })
})
describe('ledger page: wiring', () => {
  it('is a tab in the shell, not a section inside the pool page', () => {
    expect(card).toContain("{ id: 'ledger', label: t?.('shell.tabLedger')")
    expect(card).toMatch(/page === 'ledger' \? <LedgerPage t=\{t\} usage=\{usage\} \/>/)
  })
  it('translates every string it renders', () => {
    for (const key of ['ledger.title', 'ledger.tokens', 'ledger.turns', 'ledger.cache']) {
      expect(enHas(key), `${key} missing from en`).toBe(true)
    }
    expect(enHas('shell.tabLedger')).toBe(true)
    // zh is typed against en's key set, so a missing zh key is a build error.
    const zhStart = locales.indexOf('export const zh')
    expect(locales.slice(zhStart)).toContain("'ledger.turns'")
  })
  it('carries its own stylesheet and every class it renders is defined', () => {
    // 样式由 installDesignCss() 统一注入，页面组件不再自带 <style>
    expect(page).not.toContain('<style>{')
    const ledgerCss = styles.slice(styles.indexOf('export const LEDGER_CARD_CSS'))
    const used = new Set([...page.matchAll(/dsm-xdpool-(?:sec|sectitle|table|tablewrap|num|ellipsis|kpis)\b/g)].map(m => m[0]))
    const missing = [...used].filter(name => !ledgerCss.includes(`.${name}`))
    expect(missing, 'LedgerPage renders classes with no CSS rule').toEqual([])
  })
})
function enHas(key: string): boolean {
  const start = locales.indexOf('export const en = {')
  const end = locales.indexOf('} as const', start)
  return locales.slice(start, end).includes(`'${key}':`)
}
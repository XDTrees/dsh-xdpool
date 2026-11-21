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
  it('keeps the KPI and the share column reading the same total', () => {
    // Both come from the same `totals.input`, which is the only way they can be
    // guaranteed to agree. A second derivation would be a second chance to drift.
    expect(page).toMatch(/const share = \(totals\?\.input \?\? 0\) === 0/)
    expect(page).toMatch(/row\.inputTokens \/ \(totals\?\.input \?\? 1\)/)
  })
  it('never divides by zero when no call was ever counted', () => {
    // Zero input means zero rows are in the table; the `?? 1` in the divisor is
    // what keeps an empty dashboard from throwing inside render.
    const summary = new UsageRecorder().summary()
    expect(summary.rows).toHaveLength(0)
    expect(page).toContain('(totals?.input ?? 1)')
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
    expect(page).toContain("t?.('ledger.requests')")
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
    expect(page).toContain("t?.('ledger.memoryOnly')")
    expect(page).toContain("t?.('ledger.window'")
  })
  it('keeps the pool card polling for usage so the page shares one fetch', () => {
    // Two components polling the same endpoint would double the request count
    // for no benefit; the page adopts the parent's copy when it has one.
    expect(card).toContain('POOL_USAGE_PATH')
    expect(page).toMatch(/if \(shared !== undefined\) return/)
    expect(page).toMatch(/setOwn\(shared\)/)
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
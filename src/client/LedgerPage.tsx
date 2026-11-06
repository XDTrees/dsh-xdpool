/**
 * The 数据看板 (ledger) page.
 *
 * Five numbers across the top, three tables below: recent calls, accounts,
 * models. Every figure is read straight out of {@link UsageSummary} — this
 * page re-derives nothing, because a dashboard whose KPI disagrees with the
 * table under it is worse than no dashboard, because it gets trusted.
 *
 * Two distinctions this page is built around, both of which are easy to lose in
 * a rewrite and both of which are the whole reason the numbers are trustworthy:
 *
 * - **A turn is not a call.** One question that rotated three accounts is one
 *   turn and three calls. Both appear, always as separate numbers.
 * - **"no tokens" is not "no report".** A gateway that ignored
 *   `stream_options` produces the same zeroes as a gateway that reported zero,
 *   and only `usageReported` separates them. When it is false the KPI says the
 *   gateway said nothing — it never prints a confident `0` it cannot back up.
 *
 * The recorder is in-memory (see `UsageRecorder`), so the totals describe this
 * process only. The page says so rather than implying a history that does not
 * exist: a dashboard that looks durable and resets at midnight is the kind of
 * thing users stop trusting after exactly one midnight.
 *
 * @module dsh-xdpool/client/LedgerPage
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { POOL_USAGE_PATH } from '../status-paths.ts'
import type { UsageAccountRow, UsageCall, UsageSummary } from '../stats.ts'
import type { XdPoolSettingsKey } from './locales.ts'
import { LEDGER_CARD_CSS } from './styles.ts'
import { KpiCard, PageHero } from './shell.tsx'
/** The translator the settings section injects. */
type Translate = (key: XdPoolSettingsKey, params?: Record<string, unknown>) => string
export interface LedgerPageProps {
  t?: Translate | undefined
  /**
   * The aggregate, if the parent already has it.
   *
   * The pool card polls usage for its own compact panel; passing that down
   * means this page renders from the first paint and keeps sharing one fetch
   * rather than opening a second identical one.
   */
  usage?: UsageSummary | undefined
}
/** How many recent calls the detail table lists. */
const DETAIL_ROWS = 12
function fmtInt(value: number): string {
  return value.toLocaleString('en-US')
}
/** Milliseconds as `1.2s` / `340ms`, because `1200ms` is not a unit anyone reads. */
function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${String(ms)}ms`
}
/** Tokens per second, kept integer: 12.4 tok/s reads as false precision. */
function fmtTps(value: number | null): string {
  return value === null ? '—' : `${fmtInt(value)}`
}
function fmtClock(at: number): string {
  const d = new Date(at)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}
/**
 * Cache hit rate, or null when no input tokens were ever counted.
 *
 * Null rather than zero: with `usageReported === false` the numerator and
 * denominator are both absent, and printing `0%` there would claim the cache
 * never helped when the truth is that nothing was measured.
 */
function cacheHitRate(summary: UsageSummary): number | null {
  let input = 0
  let cached = 0
  for (const row of summary.rows) {
    input += row.inputTokens
    cached += row.cachedTokens
  }
  const total = input + cached
  return total === 0 ? null : cached / total
}
function regionLabel(region: string, t?: Translate): string {
  return region === 'global' ? (t?.('ledger.global') ?? 'Global') : (t?.('ledger.cn') ?? 'CN')
}
/**
 * The channel a call went through, as the table's first column.
 *
 * A provider id (`opencode`, `raccoon`, `codearts`) is printed as-is, because that
 * is the same spelling the aggregate page and the model picker use — inventing a
 * second name here would make one vendor look like two. `workbuddy` and `free` get
 * a translated label since they are lanes of this plugin rather than vendors.
 *
 * Falls back to the region for a sample filed before this field existed, so an old
 * in-memory window still renders something true instead of a blank cell.
 */
function channelLabel(call: { channel?: string; region: string }, t?: Translate): string {
  const channel = call.channel ?? ''
  if (channel === 'workbuddy' || channel === '') return regionLabel(call.region, t)
  if (channel === 'free') return t?.('ledger.channelFree') ?? 'Free lane'
  return channel
}
/**
 * In / out / cached for one call, or `—` when that call reported no usage.
 *
 * `—` rather than `0`: a call that never received a usage block is a missing
 * measurement, and the model table's share column would then divide a total by
 * rows that contributed nothing and quietly shrink it.
 */
/**
 * The three numeric cells for one call: input, output, cached.
 *
 * A fixed-length TUPLE, not `string[]`, so the header can never drift out of step
 * with the body. The table renders these through `.map`, which means a fourth
 * header added without a fourth value here — or a third value dropped — would
 * silently shift every numeric column against its title. That is precisely the
 * misalignment this was rebuilt to fix, and a `string[]` type cannot see it.
 */
function tokenCells(call: UsageCall): readonly [string, string, string] {
  if (call.usage === undefined) return ['—', '—', '—']
  return [fmtInt(call.usage.inputTokens), fmtInt(call.usage.outputTokens), fmtInt(call.usage.cachedTokens)]
}
export function LedgerPage({ t, usage: shared }: LedgerPageProps) {
  const [own, setOwn] = useState<UsageSummary | undefined>(shared)
  const [failed, setFailed] = useState(false)
  const mounted = useRef(true)
  // Adopt the parent's copy whenever it arrives, so opening this page shows the
  // numbers that already exist instead of a skeleton for one poll interval.
  useEffect(() => {
    if (shared !== undefined) setOwn(shared)
  }, [shared])
  useEffect(() => () => { mounted.current = false }, [])
  /**
   * Poll only while this page is mounted.
   *
   * The pool card already polls for its own panel, so when a copy is shared
   * there is nothing to fetch here. Without one this page owns the timer, and
   * unmounting it stops the timer — a hidden dashboard must not keep a 30s
   * request alive for a tab nobody is looking at.
   */
  const load = useCallback(async (signal?: AbortSignal): Promise<void> => {
    try {
      const response = await fetch(POOL_USAGE_PATH, {
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
        ...signal === undefined ? {} : { signal },
      })
      if (!response.ok) {
        if (mounted.current) setFailed(true)
        return
      }
      const value = await response.json().catch(() => undefined)
      if (mounted.current && signal?.aborted !== true) {
        setOwn(value as UsageSummary)
        setFailed(false)
      }
    } catch {
      if (mounted.current && signal?.aborted !== true) setFailed(true)
    }
  }, [])
  useEffect(() => {
    if (shared !== undefined) return
    const controller = new AbortController()
    void load(controller.signal)
    const timer = window.setInterval(() => { void load(controller.signal) }, 30_000)
    return () => {
      window.clearInterval(timer)
      controller.abort()
    }
  }, [load, shared])
  const summary = own
  /**
   * Totals are summed here rather than read from a server-side total, because
   * the server publishes per-model rows and the page is the only place that
   * knows which rows are on screen. Summing the rows it is about to render is
   * what keeps the KPI and the table from being able to disagree.
   */
  const totals = useMemo(() => {
    if (summary === undefined) return undefined
    let input = 0
    let output = 0
    let reasoning = 0
    let cached = 0
    let tpsWeighted = 0
    let tpsWeight = 0
    let ttftWeighted = 0
    let ttftWeight = 0
    for (const row of summary.rows) {
      input += row.inputTokens
      output += row.outputTokens
      reasoning += row.reasoningTokens
      cached += row.cachedTokens
      // Weight by calls, never averaged: one model with a single fast call must
      // not move the fleet average as hard as one running a thousand turns.
      if (row.tps !== null) {
        tpsWeighted += row.tps * row.calls
        tpsWeight += row.calls
      }
      if (row.avgTtftMs !== null) {
        ttftWeighted += row.avgTtftMs * row.calls
        ttftWeight += row.calls
      }
    }
    return {
      input,
      output,
      reasoning,
      cached,
      avgTps: tpsWeight === 0 ? null : Math.round(tpsWeighted / tpsWeight),
      avgTtftMs: ttftWeight === 0 ? null : Math.round(ttftWeighted / ttftWeight),
    }
  }, [summary])
  const details = useMemo(() => summary?.entries.slice(0, DETAIL_ROWS) ?? [], [summary])
  const accounts: readonly UsageAccountRow[] = summary?.accounts ?? []
  return (
    <>
      <style>{LEDGER_CARD_CSS}</style>
      <PageHero
        title={t?.('ledger.title') ?? 'Data dashboard'}
        sub={t?.('ledger.sub') ?? 'What this machine actually sent and got back, since the pool last started.'}
        pills={(
          <>
            <span className="dsm-xdpool-pill">
              {t?.('ledger.window', { count: summary?.samples ?? 0 }) ?? `last ${summary?.samples ?? 0} calls`}
            </span>
            <span className="dsm-xdpool-pill" data-tone="off">
              {t?.('ledger.memoryOnly') ?? 'cleared on restart'}
            </span>
          </>
        )}
      />
      {failed
        ? <p className="dsm-xdpool-note" role="alert">
            {t?.('ledger.failed') ?? 'Could not read the usage numbers. The pool itself is unaffected.'}
          </p>
        : null}
      {summary === undefined
        ? <p className="dsm-xdpool-note">
            {t?.('ledger.loading') ?? 'Reading the recorded calls…'}
          </p>
        : <>
            <div className="dsm-xdpool-kpis">
              <KpiCard
                label={t?.('ledger.tokens') ?? 'Tokens'}
                value={summary.usageReported ? fmtInt(totals?.input ?? 0) : (t?.('ledger.notReported') ?? 'not reported')}
                sub={summary.usageReported
                  ? (t?.('ledger.tokenSplit', {
                      input: fmtInt(totals?.input ?? 0),
                      output: fmtInt(totals?.output ?? 0),
                    }) ?? `in ${fmtInt(totals?.input ?? 0)} · out ${fmtInt(totals?.output ?? 0)}`)
                  : (t?.('ledger.notReportedHint') ?? 'the gateway ignored stream_options.include_usage')}
              />
              <KpiCard
                label={t?.('ledger.turns') ?? 'Turns'}
                value={fmtInt(summary.turns)}
                sub={(t?.('ledger.callsSub', { calls: summary.calls }) ?? `${summary.calls} upstream calls`)}
              />
              <KpiCard
                label={t?.('ledger.speed') ?? 'Speed'}
                value={totals?.avgTps === null || totals?.avgTps === undefined ? '—' : `${fmtInt(totals.avgTps)} tok/s`}
                sub={totals?.avgTtftMs === null || totals?.avgTtftMs === undefined
                  ? (t?.('ledger.speedNone') ?? 'no timing reported')
                  : (t?.('ledger.ttft', { ms: fmtMs(totals.avgTtftMs) }) ?? `ttft ${fmtMs(totals.avgTtftMs)}`)}
              />
              <KpiCard
                label={t?.('ledger.cache') ?? 'Cache hit'}
                value={(() => {
                  const rate = cacheHitRate(summary)
                  return rate === null || !summary.usageReported ? '—' : `${Math.round(rate * 100)}%`
                })()}
                sub={summary.usageReported
                  ? (t?.('ledger.cacheSub', { cached: fmtInt(summary.rows.reduce((n, r) => n + r.cachedTokens, 0)) }) ?? '')
                  : ''}
              />
              <KpiCard
                label={t?.('ledger.requests') ?? 'Requests'}
                value={fmtInt(summary.calls)}
                sub={summary.failedTurns === 0
                  ? (t?.('ledger.allOk') ?? 'no turn failed outright')
                  : (t?.('ledger.failedSub', { failed: summary.failedTurns, recovered: summary.recoveredTurns })
                    ?? `${summary.failedTurns} failed · ${summary.recoveredTurns} recovered`)}
              />
            </div>
            {details.length === 0
              ? <p className="dsm-xdpool-note">
                  {t?.('ledger.empty') ?? 'No calls recorded yet. Start a conversation and this fills in.'}
                </p>
              : <>
                  <section className="dsm-xdpool-sec">
                    <h3 className="dsm-xdpool-sectitle">{t?.('ledger.recent') ?? 'Recent calls'}</h3>
                    <div className="dsm-xdpool-tablewrap">
                      <table className="dsm-xdpool-table">
                        <thead>
                          <tr>
                            <th>{t?.('ledger.colTime') ?? 'Time'}</th>
                            <th>{t?.('ledger.colChannel') ?? 'Channel'}</th>
                            <th>{t?.('ledger.colModel') ?? 'Model'}</th>
                            <th>{t?.('ledger.colAccount') ?? 'Account'}</th>
                            <th className="dsm-xdpool-num">{t?.('ledger.colIn') ?? 'In'}</th>
                            <th className="dsm-xdpool-num">{t?.('ledger.colOut') ?? 'Out'}</th>
                            <th className="dsm-xdpool-num">{t?.('ledger.colCached') ?? 'Cached'}</th>
                            <th className="dsm-xdpool-num">{t?.('ledger.colTtft') ?? 'TTFT'}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {details.map((entry, index) => (
                            <tr key={`${entry.turnId}:${String(entry.at)}:${String(index)}`} data-ok={entry.ok}>
                              <td>{fmtClock(entry.at)}</td>
                              <td>{channelLabel(entry, t)}</td>
                              <td className="dsm-xdpool-ellipsis" title={entry.model}>{entry.model}</td>
                              <td className="dsm-xdpool-ellipsis" title={entry.account ?? ''}>
                                {entry.account ?? (t?.('ledger.noAccount') ?? '—')}
                              </td>
                              {tokenCells(entry).map((cell, cellIndex) => (
                                <td className="dsm-xdpool-num" key={String(cellIndex)}>{cell}</td>
                              ))}
                              <td className="dsm-xdpool-num">
                                {entry.ttftMs === undefined ? '—' : fmtMs(entry.ttftMs)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                  <section className="dsm-xdpool-sec">
                    <h3 className="dsm-xdpool-sectitle">{t?.('ledger.accounts') ?? 'By account'}</h3>
                    <div className="dsm-xdpool-tablewrap">
                      <table className="dsm-xdpool-table">
                        <thead>
                          <tr>
                            <th>{t?.('ledger.colAccount') ?? 'Account'}</th>
                            <th>{t?.('ledger.colChannel') ?? 'Channel'}</th>
                            <th className="dsm-xdpool-num">{t?.('ledger.colTurns') ?? 'Turns'}</th>
                            <th className="dsm-xdpool-num">{t?.('ledger.colCalls') ?? 'Calls'}</th>
                            <th className="dsm-xdpool-num">{t?.('ledger.colIn') ?? 'In'}</th>
                            <th className="dsm-xdpool-num">{t?.('ledger.colOut') ?? 'Out'}</th>
                            <th>{t?.('ledger.colModels') ?? 'Usually runs'}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {accounts.map(row => (
                            <tr key={`${row.region}:${row.account}`}>
                              <td className="dsm-xdpool-ellipsis" title={row.account}>
                                {row.account === '' ? (t?.('ledger.unattributed') ?? '(unattributed)') : row.account}
                              </td>
                              <td>{channelLabel(row, t)}</td>
                              <td className="dsm-xdpool-num">{fmtInt(row.turns)}</td>
                              <td className="dsm-xdpool-num">{fmtInt(row.calls)}</td>
                              <td className="dsm-xdpool-num">{fmtInt(row.inputTokens)}</td>
                              <td className="dsm-xdpool-num">{fmtInt(row.outputTokens)}</td>
                              <td className="dsm-xdpool-ellipsis" title={row.topModels.join(', ')}>
                                {row.topModels.join(', ') || '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                  <section className="dsm-xdpool-sec">
                    <h3 className="dsm-xdpool-sectitle">{t?.('ledger.models') ?? 'By model'}</h3>
                    <div className="dsm-xdpool-tablewrap">
                      <table className="dsm-xdpool-table">
                        <thead>
                          <tr>
                            <th>{t?.('ledger.colChannel') ?? 'Channel'}</th>
                            <th>{t?.('ledger.colModel') ?? 'Model'}</th>
                            <th className="dsm-xdpool-num">{t?.('ledger.colCalls') ?? 'Calls'}</th>
                            <th className="dsm-xdpool-num">{t?.('ledger.colTps') ?? 'tok/s'}</th>
                            <th className="dsm-xdpool-num">{t?.('ledger.colTtft') ?? 'TTFT'}</th>
                            <th className="dsm-xdpool-num">{t?.('ledger.colShare') ?? 'Share'}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {summary.rows.map(row => {
                            const share = (totals?.input ?? 0) === 0
                              ? 0
                              : Math.round((row.inputTokens / (totals?.input ?? 1)) * 100)
                            return (
                              <tr key={`${row.channel}:${row.region}:${row.model}`}>
                                {/*
                                  Channel FIRST, then the model. The same id can be
                                  served by several vendors, so a table led by the
                                  model name silently merged them and the share
                                  column then divided one vendor's tokens by a total
                                  that included another's.
                                */}
                                <td>{channelLabel(row, t)}</td>
                                <td className="dsm-xdpool-ellipsis" title={row.model}>{row.model}</td>
                                <td className="dsm-xdpool-num">{fmtInt(row.calls)}</td>
                                <td className="dsm-xdpool-num">{fmtTps(row.tps)}</td>
                                <td className="dsm-xdpool-num">
                                  {row.avgTtftMs === null ? '—' : fmtMs(row.avgTtftMs)}
                                </td>
                                <td className="dsm-xdpool-num">{summary.usageReported ? `${share}%` : '—'}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </>}
          </>}
    </>
  )
}
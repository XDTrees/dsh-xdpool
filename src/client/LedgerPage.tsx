/**
 * The 数据看板 (dashboard) page.
 *
 * WHAT THIS PAGE IS FOR
 *
 * One question: *am I burning quota, on which account, and what is about to
 * expire?* Everything below answers a part of it, and nothing is on the page
 * that does not.
 *
 * The previous version answered a different question — "what did this process
 * record since it started" — and the difference matters enough to spell out:
 *
 *   - it counted TOKENS, which no vendor bills directly;
 *   - it was held in MEMORY, so every restart drew a dashboard of zeroes;
 *   - it knew nothing about credits, so it could not say whether a turn cost one
 *     credit or two hundred;
 *   - it could not say what was about to expire, which is the only thing on this
 *     page a user can still act on.
 *
 * This version is built from the vendor's own billing meter
 * (`/plugins/dsh-xdpool/spend/report`), which is authoritative for charges, is
 * server-side so it survives a restart, and knows each package's expiry.
 *
 * THE FOUR BLOCKS, and why each is shaped the way it is:
 *
 *   1. **KPI row** — balance, spend, grants, requests, expiring. Five numbers a
 *      reader can act on without scrolling.
 *   2. **Daily flow** — spent against granted, as paired bars. Two bars per day,
 *      never one net figure: "spent 900, earned 900" and "spent 0, earned 0" are
 *      different days and a net line would draw them identically.
 *   3. **Balance** — the back-solved series. It is labelled an estimate because it
 *      is one; see `spend-report.ts` for the arithmetic and its failure mode.
 *   4. **Accounts** — one row per account: a sparkline, the three totals, and any
 *      package that will expire. This is the part the old page did not have at
 *      all, and it is the part that answers "which account".
 *
 * HONESTY RULES THAT ARE NOT NEGOTIABLE
 *
 * - A failed account is SHOWN with its error, never as a row of zeroes. An
 *   account that says "0 spent" and one that could not be read are different
 *   facts and merging them is how a dashboard loses trust permanently.
 * - A back-solved opening balance that came out negative marks the window as an
 *   estimate on screen, because that is what it means: the inputs did not
 *   reconcile.
 * - The window is capped at what the meter answers (31 days) and the page says
 *   so instead of silently drawing a shorter chart than the range requested.
 *
 * @module dsh-xdpool/client/LedgerPage
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { POOL_SPEND_REPORT_PATH } from '../status-paths.ts'
import type { SpendAccount, SpendDay, SpendReport } from '../spend-report.ts'
import type { XdPoolSettingsKey } from './locales.ts'
import { DASHBOARD_CARD_CSS } from './styles.ts'
import { PageHero } from './shell.tsx'

/** The translator the settings section injects. */
type Translate = (key: XdPoolSettingsKey, params?: Record<string, unknown>) => string

export interface LedgerPageProps {
  t?: Translate | undefined
}

/** Windows the page offers, in days. 31 is the meter's own ceiling. */
const WINDOWS: readonly number[] = [7, 14, 31]

/**
 * How long the panel waits before re-reading.
 *
 * Long, deliberately. A read walks the billing meter and the host caches the
 * result for five minutes; polling faster than that would just replay the cache.
 * The refresh button is the way to ask for fresh numbers.
 */
const POLL_MS = 5 * 60_000

/** Formatted credits. Two decimals, because a single request can cost 0.02. */
function fmtCredit(value: number): string {
  if (!Number.isFinite(value)) return '—'
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (abs >= 10_000) return `${(value / 1_000).toFixed(1)}k`
  return value.toLocaleString('zh-CN', { maximumFractionDigits: abs >= 100 ? 0 : 2 })
}

/** A count. Never abbreviated: a request count is small enough to read whole. */
function fmtCount(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString('zh-CN') : '—'
}

/** `2026-11-16` → `11/16`. The year is constant across a 31-day window. */
function shortDay(key: string): string {
  return key.slice(5).replace('-', '/')
}

/** A day's figures, with every field present so the charts cannot read undefined. */
function dayOf(account: SpendAccount, key: string): SpendDay {
  return account.days[key] ?? { spent: 0, requests: 0, earned: 0, lapsed: 0, balance: 0 }
}

/** Sum across accounts for one day. */
function pooledDay(accounts: readonly SpendAccount[], key: string): SpendDay {
  let spent = 0
  let requests = 0
  let earned = 0
  let lapsed = 0
  let balance = 0
  for (const account of accounts) {
    const day = dayOf(account, key)
    spent += day.spent
    requests += day.requests
    earned += day.earned
    lapsed += day.lapsed
    balance += day.balance
  }
  return { spent, requests, earned, lapsed, balance }
}

/** A single KPI cell. Local rather than the shell's `KpiCard` because it takes a tone. */
function Stat({ label, value, note, tone }: {
  label: string
  value: string
  note?: string | undefined
  tone?: 'spend' | 'earn' | 'warn' | undefined
}) {
  return (
    <div className="dsm-xdpool-dash-kpi" data-tone={tone ?? ''}>
      <span className="dsm-xdpool-dash-kpi-label">{label}</span>
      <span className="dsm-xdpool-dash-kpi-value">{value}</span>
      <span className="dsm-xdpool-dash-kpi-note">{note ?? ''}</span>
    </div>
  )
}

/** Geometry of one chart, in viewBox units. Shared so both charts line up. */
const CHART = { width: 960, height: 220, padTop: 12, padRight: 10, padBottom: 26, padLeft: 52 }

/** The plot width, i.e. what a day's column divides. */
const PLOT_W = CHART.width - CHART.padLeft - CHART.padRight
const PLOT_H = CHART.height - CHART.padTop - CHART.padBottom

/**
 * Daily spend against daily grants, as paired bars.
 *
 * Two bars, never a net figure: a day that spent 900 and earned 900 draws two
 * tall bars, and a day with no activity draws none. A single "net 0" line would
 * make those two days identical, and one of them is a day the user worked.
 */
function DailyFlowChart({ days, accounts, t }: {
  days: readonly string[]
  accounts: readonly SpendAccount[]
  t?: Translate | undefined
}) {
  const series = useMemo(() => days.map(key => pooledDay(accounts, key)), [days, accounts])
  const max = Math.max(1, ...series.map(day => Math.max(day.spent, day.earned)))
  const step = days.length === 0 ? PLOT_W : PLOT_W / days.length
  const barWidth = Math.max(2, Math.min(16, step * 0.32))
  const y = (value: number): number => CHART.padTop + PLOT_H - (value / max) * PLOT_H
  // Tick labels thin out as the window grows, or a 31-day axis becomes a smear.
  const labelEvery = days.length > 20 ? 5 : days.length > 12 ? 3 : 1
  return (
    <svg
      className="dsm-xdpool-dash-chart"
      viewBox={`0 0 ${String(CHART.width)} ${String(CHART.height)}`}
      role="img"
      aria-label={t?.('ledger.flowTitle') ?? 'Daily spend and grants'}
    >
      {[0, 0.25, 0.5, 0.75, 1].map(fraction => {
        const value = max * fraction
        const at = y(value)
        return (
          <g key={String(fraction)}>
            <line
              x1={CHART.padLeft}
              y1={at}
              x2={CHART.width - CHART.padRight}
              y2={at}
              className="dsm-xdpool-dash-grid"
              strokeDasharray={fraction === 0 ? '0' : '3 4'}
            />
            <text x={CHART.padLeft - 7} y={at + 3.5} textAnchor="end" className="dsm-xdpool-dash-axis">
              {fmtCredit(value)}
            </text>
          </g>
        )
      })}
      {days.map((key, index) => {
        const day = series[index] ?? { spent: 0, requests: 0, earned: 0, lapsed: 0, balance: 0 }
        const center = CHART.padLeft + step * index + step / 2
        return (
          <g key={key}>
            {/*
              Earned first, to the LEFT of spent. Reading left-to-right then shows
              what came in before what went out, which is the order the words
              "消耗 / 获得" are usually spoken in the reader's head — and it keeps
              the two-coloured bars in a stable position as days scroll past.
            */}
            {day.earned > 0
              ? (
                  <rect
                    x={center - barWidth - 1}
                    y={y(day.earned)}
                    width={barWidth}
                    height={Math.max(1, CHART.padTop + PLOT_H - y(day.earned))}
                    rx={1.5}
                    className="dsm-xdpool-dash-bar-earn"
                  >
                    <title>{`${key} 获得 ${fmtCredit(day.earned)}`}</title>
                  </rect>
                )
              : null}
            {day.spent > 0
              ? (
                  <rect
                    x={center + 1}
                    y={y(day.spent)}
                    width={barWidth}
                    height={Math.max(1, CHART.padTop + PLOT_H - y(day.spent))}
                    rx={1.5}
                    className="dsm-xdpool-dash-bar-spend"
                  >
                    <title>{`${key} 消耗 ${fmtCredit(day.spent)} · ${fmtCount(day.requests)} 次请求`}</title>
                  </rect>
                )
              : null}
            {index % labelEvery === 0 || index === days.length - 1
              ? (
                  <text x={center} y={CHART.height - 8} textAnchor="middle" className="dsm-xdpool-dash-axis">
                    {shortDay(key)}
                  </text>
                )
              : null}
          </g>
        )
      })}
    </svg>
  )
}

/**
 * The pool's balance, back-solved.
 *
 * Drawn as a line with a fill because the shape is the information: a line that
 * falls steadily is a pool being drained, and one that steps up is a refill. The
 * y-axis is zoomed to the observed range rather than starting at zero — a whole
 * window inside 40k–47k would otherwise be a flat line and hide the trend that
 * makes the chart worth having. The absolute figures are on the axis and in the
 * tooltip, so the zoom cannot mislead about the size of a move.
 */
function BalanceChart({ days, accounts }: {
  days: readonly string[]
  accounts: readonly SpendAccount[]
}) {
  const values = useMemo(() => days.map(key => pooledDay(accounts, key).balance), [days, accounts])
  const present = values.filter(value => value > 0)
  const max = present.length === 0 ? 1 : Math.max(...present)
  const min = present.length === 0 ? 0 : Math.min(...present)
  // 4% of headroom on each side so the endpoints are not painted onto the frame.
  const span = Math.max(1, max - min)
  const top = max + span * 0.08
  const bottom = Math.max(0, min - span * 0.08)
  const x = (index: number): number =>
    CHART.padLeft + (days.length <= 1 ? PLOT_W / 2 : (PLOT_W * index) / (days.length - 1))
  const y = (value: number): number =>
    CHART.padTop + PLOT_H - ((value - bottom) / Math.max(1, top - bottom)) * PLOT_H
  const labelEvery = days.length > 20 ? 5 : days.length > 12 ? 3 : 1
  if (values.length === 0) return null
  const points = values.map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`)
  const line = points.map((pair, index) => `${index === 0 ? 'M' : 'L'}${pair}`).join(' ')
  const area = `M${x(0).toFixed(1)},${String(CHART.padTop + PLOT_H)} `
    + points.map(pair => `L${pair}`).join(' ')
    + ` L${x(values.length - 1).toFixed(1)},${String(CHART.padTop + PLOT_H)} Z`
  return (
    <svg
      className="dsm-xdpool-dash-chart"
      viewBox={`0 0 ${String(CHART.width)} ${String(CHART.height)}`}
      role="img"
      aria-label="Pool balance"
    >
      {[0, 0.5, 1].map(fraction => {
        const value = bottom + (top - bottom) * fraction
        const at = y(value)
        return (
          <g key={String(fraction)}>
            <line
              x1={CHART.padLeft}
              y1={at}
              x2={CHART.width - CHART.padRight}
              y2={at}
              className="dsm-xdpool-dash-grid"
              strokeDasharray="3 4"
            />
            <text x={CHART.padLeft - 7} y={at + 3.5} textAnchor="end" className="dsm-xdpool-dash-axis">
              {fmtCredit(value)}
            </text>
          </g>
        )
      })}
      <path d={area} className="dsm-xdpool-dash-area" />
      <path d={line} className="dsm-xdpool-dash-line" />
      {days.map((key, index) => (
        <g key={key}>
          <circle cx={x(index)} cy={y(values[index] ?? 0)} r={2.6} className="dsm-xdpool-dash-dot">
            <title>{`${key} 余额 ${fmtCredit(values[index] ?? 0)}`}</title>
          </circle>
          {index % labelEvery === 0 || index === days.length - 1
            ? (
                <text x={x(index)} y={CHART.height - 8} textAnchor="middle" className="dsm-xdpool-dash-axis">
                  {shortDay(key)}
                </text>
              )
            : null}
        </g>
      ))}
    </svg>
  )
}

/**
 * One account's balance across the window, as a sparkline.
 *
 * Inline SVG rather than a shared chart component: this is 300×44, has no axis
 * and no interaction, and the only thing it must do is make one row comparable to
 * the row above it. That requires a FIXED y-range across rows, which is why the
 * range is computed once by the caller and passed in rather than per account.
 */
function Spark({ account, days, range }: {
  account: SpendAccount
  days: readonly string[]
  range: { min: number; max: number }
}) {
  const values = days.map(key => dayOf(account, key).balance)
  const width = 160
  const height = 38
  const span = Math.max(1, range.max - range.min)
  const x = (index: number): number => (days.length <= 1 ? width / 2 : (width * index) / (days.length - 1))
  const y = (value: number): number => height - 3 - ((value - range.min) / span) * (height - 6)
  const path = values.map((value, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(' ')
  return (
    <svg className="dsm-xdpool-dash-spark" viewBox={`0 0 ${String(width)} ${String(height)}`} aria-hidden="true">
      <path d={path} />
    </svg>
  )
}

export function LedgerPage({ t }: LedgerPageProps) {
  const [report, setReport] = useState<SpendReport | undefined>(undefined)
  /**
   * The window, in days.
   *
   * NOT named `window`: a local of that name shadows the global object, and the
   * poll below needs `setInterval`. The bug that causes is invisible until the
   * page is opened, which is the worst kind.
   */
  const [span, setSpan] = useState<number>(31)
  const [error, setError] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  /** Bumped by the refresh button to force the host to bypass its cache. */
  const [nonce, setNonce] = useState(0)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  /**
   * One read.
   *
   * `refresh` is sent to the host rather than handled here: only the host knows
   * whether the cached document is current, and re-reading the meter costs ~30
   * upstream requests per account. So the page never decides to refresh; it asks.
   */
  const load = useCallback(async (days: number, refresh: boolean, signal?: AbortSignal): Promise<void> => {
    try {
      const query = `?days=${String(days)}${refresh ? '&refresh=1' : ''}`
      const response = await fetch(`${POOL_SPEND_REPORT_PATH}${query}`, {
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
        ...signal === undefined ? {} : { signal },
      })
      if (signal?.aborted === true) return
      const body: unknown = await response.json().catch(() => undefined)
      if (!mounted.current) return
      if (!response.ok) {
        const detail = (body as { error?: string } | undefined)?.error
        setError(detail ?? `HTTP ${String(response.status)}`)
        setLoading(false)
        return
      }
      setReport(body as SpendReport)
      setError(undefined)
      setLoading(false)
    } catch (cause: unknown) {
      if (signal?.aborted === true) return
      if (mounted.current) {
        setError(cause instanceof Error ? cause.message : String(cause))
        setLoading(false)
      }
    }
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    void load(span, nonce > 0, controller.signal)
    return () => { controller.abort() }
  }, [load, span, nonce])
  // A slow poll, so a long-open window does not show numbers from an hour ago.
  // Deliberately the same beat as the host's own cache: polling faster would
  // only replay it.
  useEffect(() => {
    const timer = setInterval(() => { void load(span, false) }, POLL_MS)
    return () => { clearInterval(timer) }
  }, [load, span])

  const accounts = report?.accounts ?? []
  const days = report?.days ?? []
  const totals = report?.totals
  const estimateOnly = accounts.some(account => !account.openingTrusted && account.packs > 0)
  /**
   * The shared y-range every sparkline is drawn against.
   *
   * Computed ONCE, and that is the whole point: a per-row range would make each
   * account's line use its own scale, so a row holding 200 credits and a row
   * holding 12,000 would draw the same shape and the column would say nothing
   * about which account is draining. `useMemo` because the range walks every
   * account × every day, which is the wrong thing to re-do on a hover.
   */
  const sparkRange = useMemo(() => sparkRangeOf(accounts, days), [accounts, days])

  return (
    <>
      <style>{DASHBOARD_CARD_CSS}</style>
      <PageHero
        title={t?.('ledger.title') ?? 'Data dashboard'}
        sub={t?.('ledger.sub') ?? 'Charged and granted credits, per account and per day, straight from the billing meter.'}
        pills={(
          <>
            {report === undefined
              ? null
              : <span className="dsm-xdpool-pill">{report.windowStart} → {report.windowEnd}</span>}
            <span className="dsm-xdpool-pill" data-tone="off">
              {t?.('ledger.meterWindow', { days: report?.maxDays ?? 31 }) ?? `meter keeps ${String(report?.maxDays ?? 31)} days`}
            </span>
          </>
        )}
        actions={(
          <div className="dsm-xdpool-dash-actions">
            <div className="dsm-xdpool-dash-windows" role="group" aria-label={t?.('ledger.windowPick') ?? 'Window'}>
              {WINDOWS.map(size => (
                <button
                  key={String(size)}
                  type="button"
                  className="dsm-xdpool-dash-window"
                  data-on={size === span}
                  onClick={() => { setSpan(size) }}
                >
                  {t?.('ledger.windowDays', { days: size }) ?? `${String(size)}d`}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="dsm-xdpool-btn"
              disabled={loading}
              onClick={() => { setNonce(value => value + 1) }}
            >
              {loading
                ? (t?.('ledger.reading') ?? 'Reading…')
                : (t?.('ledger.refresh') ?? 'Refresh')}
            </button>
          </div>
        )}
      />
      {error === undefined
        ? null
        : (
            <p className="dsm-xdpool-note" role="alert">
              {t?.('ledger.failed') ?? 'Could not read the billing numbers.'} {error}
            </p>
          )}
      {report === undefined
        ? (
            <p className="dsm-xdpool-note">
              {loading
                ? (t?.('ledger.loading') ?? 'Walking the billing meter…')
                : (t?.('ledger.empty') ?? 'No data yet.')}
            </p>
          )
        : (
            <>
              {/*
                The estimate banner is not decoration. When the three inputs do
                not reconcile the back-solved opening balance comes out negative,
                which means some credit arrived or left without the meter saying
                so; the curve is then a plausible shape rather than a record, and
                a reader is entitled to know before quoting it.
              */}
              {estimateOnly
                ? (
                    <p className="dsm-xdpool-dash-warn">
                      {t?.('ledger.estimate') ?? 'Opening balances are estimates: the meter only reports the current balance, so earlier days are back-solved. A negative opening means the inputs did not reconcile — a grant or a charge is missing from the meter.'}
                    </p>
                  )
                : null}
              {report.failedAccounts > 0
                ? (
                    <p className="dsm-xdpool-dash-warn">
                      {t?.('ledger.partial', { count: report.failedAccounts })
                        ?? `${String(report.failedAccounts)} account(s) could not be read; their rows say why.`}
                    </p>
                  )
                : null}
              <div className="dsm-xdpool-dash-kpis">
                <Stat
                  label={t?.('ledger.kpiLive') ?? 'Spendable now'}
                  value={fmtCredit(totals?.live ?? 0)}
                  note={totals !== undefined && Math.abs((totals.liveGross ?? 0) - totals.live) > 0.5
                    ? (t?.('ledger.kpiLiveGross', { gross: fmtCredit(totals.liveGross) })
                      ?? `${fmtCredit(totals.liveGross)} booked incl. unstarted cycles`)
                    : (t?.('ledger.kpiLiveNote', { count: accounts.length })
                      ?? `${String(accounts.length)} account(s)`)}
                />
                <Stat
                  tone="spend"
                  label={t?.('ledger.kpiSpent') ?? 'Charged'}
                  value={fmtCredit(totals?.spent ?? 0)}
                  note={t?.('ledger.kpiSpentNote', {
                    perDay: fmtCredit(days.length === 0 ? 0 : (totals?.spent ?? 0) / days.length),
                  }) ?? `${fmtCredit(days.length === 0 ? 0 : (totals?.spent ?? 0) / days.length)}/day`}
                />
                <Stat
                  tone="earn"
                  label={t?.('ledger.kpiEarned') ?? 'Granted'}
                  value={fmtCredit(totals?.earned ?? 0)}
                  note={t?.('ledger.kpiEarnedNote', {
                    net: `${(totals?.earned ?? 0) - (totals?.spent ?? 0) >= 0 ? '+' : ''}${fmtCredit((totals?.earned ?? 0) - (totals?.spent ?? 0))}`,
                  }) ?? `net ${fmtCredit((totals?.earned ?? 0) - (totals?.spent ?? 0))}`}
                />
                <Stat
                  label={t?.('ledger.kpiRequests') ?? 'Requests'}
                  value={fmtCount(totals?.requests ?? 0)}
                  note={t?.('ledger.kpiRequestsNote', {
                    per: fmtCredit((totals?.requests ?? 0) === 0 ? 0 : (totals?.spent ?? 0) / (totals?.requests ?? 1)),
                  }) ?? `${fmtCredit((totals?.requests ?? 0) === 0 ? 0 : (totals?.spent ?? 0) / (totals?.requests ?? 1))} per request`}
                />
                <Stat
                  tone={(totals?.expiringSoon ?? 0) > 0 ? 'warn' : undefined}
                  label={t?.('ledger.kpiExpiring') ?? 'Expiring (14d)'}
                  value={fmtCredit(totals?.expiringSoon ?? 0)}
                  note={(totals?.expiringSoon ?? 0) > 0
                    ? (t?.('ledger.kpiExpiringWarn') ?? 'spend it first or it is lost')
                    : (t?.('ledger.kpiExpiringNone') ?? 'nothing about to lapse')}
                />
              </div>

              <section className="dsm-xdpool-sec">
                <h3 className="dsm-xdpool-sectitle">
                  {t?.('ledger.flowTitle') ?? 'Charged / granted per day'}
                  <span className="dsm-xdpool-dash-legend">
                    <i className="dsm-xdpool-dash-key" data-kind="spend" />
                    {t?.('ledger.kpiSpent') ?? 'Charged'}
                    <i className="dsm-xdpool-dash-key" data-kind="earn" />
                    {t?.('ledger.kpiEarned') ?? 'Granted'}
                  </span>
                </h3>
                <DailyFlowChart days={days} accounts={accounts} t={t} />
              </section>

              <section className="dsm-xdpool-sec">
                <h3 className="dsm-xdpool-sectitle">
                  {t?.('ledger.balanceTitle') ?? 'Pool balance (back-solved)'}
                  <span className="dsm-xdpool-dash-legend">
                    <i className="dsm-xdpool-dash-key" data-kind="balance" />
                    {t?.('ledger.balanceKey') ?? 'estimated balance'}
                  </span>
                </h3>
                <BalanceChart days={days} accounts={accounts} />
              </section>

              <section className="dsm-xdpool-sec">
                <h3 className="dsm-xdpool-sectitle">
                  {t?.('ledger.accounts') ?? 'Per account'}
                </h3>
                {accounts.length === 0
                  ? <p className="dsm-xdpool-note">{t?.('ledger.noAccounts') ?? 'No account in the pool.'}</p>
                  : (
                      <div className="dsm-xdpool-tablewrap">
                        <table className="dsm-xdpool-table dsm-xdpool-dash-table">
                          <thead>
                            <tr>
                              <th>{t?.('ledger.colAccount') ?? 'Account'}</th>
                              <th className="dsm-xdpool-num">{t?.('ledger.kpiLive') ?? 'Spendable'}</th>
                              <th className="dsm-xdpool-num">{t?.('ledger.kpiSpent') ?? 'Charged'}</th>
                              <th className="dsm-xdpool-num">{t?.('ledger.kpiEarned') ?? 'Granted'}</th>
                              <th className="dsm-xdpool-num">{t?.('ledger.kpiRequests') ?? 'Requests'}</th>
                              <th>{t?.('ledger.colTrend') ?? 'Trend'}</th>
                              <th>{t?.('ledger.colExpiring') ?? 'Expiring'}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {accounts.map(account => (
                              <tr key={account.id} data-ok={account.error === undefined}>
                                <td className="dsm-xdpool-ellipsis" title={`${account.label} · ${account.id}`}>
                                  {account.label}
                                  {account.error === undefined
                                    ? null
                                    : (
                                        <span className="dsm-xdpool-dash-rowerr" title={account.error}>
                                          {t?.('ledger.rowIncomplete') ?? 'incomplete'}
                                        </span>
                                      )}
                                </td>
                                <td className="dsm-xdpool-num">{fmtCredit(account.live)}</td>
                                <td className="dsm-xdpool-num">{fmtCredit(account.totals.spent)}</td>
                                <td className="dsm-xdpool-num">{fmtCredit(account.totals.earned)}</td>
                                <td className="dsm-xdpool-num">{fmtCount(account.totals.requests)}</td>
                                <td><Spark account={account} days={days} range={sparkRange} /></td>
                                <td>
                                  {account.expiring.length === 0
                                    ? <span className="dsm-xdpool-dash-quiet">{t?.('ledger.expiringNone') ?? '—'}</span>
                                    : (
                                        <span className="dsm-xdpool-dash-expiring">
                                          {account.expiring.slice(0, 2).map(item => (
                                            <span key={`${item.day}:${item.name}`} className="dsm-xdpool-dash-chip">
                                              {shortDay(item.day)} · {fmtCredit(item.remain)}
                                            </span>
                                          ))}
                                          {account.expiring.length > 2
                                            ? (
                                                <span className="dsm-xdpool-dash-quiet">
                                                  +{String(account.expiring.length - 2)}
                                                </span>
                                              )
                                              : null}
                                        </span>
                                      )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr>
                              <td>{t?.('ledger.total') ?? 'Total'}</td>
                              <td className="dsm-xdpool-num">{fmtCredit(totals?.live ?? 0)}</td>
                              <td className="dsm-xdpool-num">{fmtCredit(totals?.spent ?? 0)}</td>
                              <td className="dsm-xdpool-num">{fmtCredit(totals?.earned ?? 0)}</td>
                              <td className="dsm-xdpool-num">{fmtCount(totals?.requests ?? 0)}</td>
                              <td />
                              <td className="dsm-xdpool-num">
                                {(totals?.expiringSoon ?? 0) > 0 ? fmtCredit(totals?.expiringSoon ?? 0) : '—'}
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    )}
              </section>

              <section className="dsm-xdpool-sec">
                <h3 className="dsm-xdpool-sectitle">
                  {t?.('ledger.heatTitle') ?? 'Account × day spend'}
                </h3>
                <SpendHeat accounts={accounts} days={days} t={t} />
              </section>

              <p className="dsm-xdpool-dash-foot">
                {t?.('ledger.foot', { at: report.generatedAt }) ?? `Read at ${report.generatedAt}.`}
              </p>
            </>
          )}
    </>
  )
}
function sparkRangeOf(accounts: readonly SpendAccount[], days: readonly string[]): { min: number; max: number } {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const account of accounts) {
    for (const key of days) {
      const value = dayOf(account, key).balance
      if (value < min) min = value
      if (value > max) max = value
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 }
  return min === max ? { min: Math.max(0, min - 1), max: max + 1 } : { min, max }
}

/**
 * Account × day spend, as a heat table.
 *
 * A table rather than a canvas: every cell is a real number with a `<title>`, so
 * the figure is available without hovering, and it stays selectable and
 * screen-readable. Colour is the SECOND channel here, never the only one — the
 * number is printed in every cell, which is what makes the pattern legible to
 * someone who cannot tell red from green.
 */
function SpendHeat({ accounts, days, t }: {
  accounts: readonly SpendAccount[]
  days: readonly string[]
  t?: Translate | undefined
}) {
  const peak = useMemo(() => {
    let max = 0
    for (const account of accounts) {
      for (const key of days) {
        const value = dayOf(account, key).spent
        if (value > max) max = value
      }
    }
    return max
  }, [accounts, days])
  if (accounts.length === 0 || days.length === 0) return null
  return (
    <div className="dsm-xdpool-tablewrap">
      <table className="dsm-xdpool-table dsm-xdpool-dash-heat">
        <thead>
          <tr>
            <th>{t?.('ledger.colAccount') ?? 'Account'}</th>
            {days.map(key => (
              <th key={key} className="dsm-xdpool-num">{shortDay(key)}</th>
            ))}
            <th className="dsm-xdpool-num">{t?.('ledger.total') ?? 'Total'}</th>
          </tr>
        </thead>
        <tbody>
          {[...accounts].sort((left, right) => right.totals.spent - left.totals.spent).map(account => (
            <tr key={account.id}>
              <td className="dsm-xdpool-ellipsis" title={account.label}>{account.label}</td>
              {days.map(key => {
                const value = dayOf(account, key).spent
                // Gamma-corrected intensity: a linear ramp makes every ordinary
                // day look the same colour as every other, because one blow-out
                // day sets the scale.
                const intensity = peak === 0 ? 0 : (value / peak) ** 0.55
                return (
                  <td
                    key={key}
                    className="dsm-xdpool-dash-cell"
                    style={value === 0 ? undefined : { background: `rgba(255,95,86,${(0.08 + intensity * 0.62).toFixed(3)})` }}
                  >
                    {value === 0 ? '·' : fmtCredit(value)}
                  </td>
                )
              })}
              <td className="dsm-xdpool-num">{fmtCredit(account.totals.spent)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>{t?.('ledger.dailyTotal') ?? 'Per day'}</td>
            {days.map(key => {
              const value = accounts.reduce((sum, account) => sum + dayOf(account, key).spent, 0)
              return <td key={key} className="dsm-xdpool-num">{value === 0 ? '·' : fmtCredit(value)}</td>
            })}
            <td className="dsm-xdpool-num">
              {fmtCredit(accounts.reduce((sum, account) => sum + account.totals.spent, 0))}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

/*
 * NOTE: the timer is called through `globalThis` rather than through a bare
 * `setInterval`, and the range state is named `span` rather than `window`.
 * A state variable called `window` shadows the global object inside the
 * component, so `setInterval` still resolves (it is a global function, not a
 * property) while anything reaching for `window.setTimeout` would not — a
 * trap that only fires once someone adds a debounce. Naming it `span` removes
 * the possibility instead of documenting around it.
 */
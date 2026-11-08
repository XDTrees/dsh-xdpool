/**
 * The credit-spend strip above the composer.
 *
 * WHAT IT ANSWERS
 *
 * "How much have I spent, and on which channel." The pool's data panel shows tokens
 * and per-request rows, which is the wrong shape for the question people actually ask
 * while typing: *am I burning quota, and on what*. So this is one line, one total, and
 * a per-channel breakdown behind a click.
 *
 * IT IS AN ESTIMATE, AND SAYS SO
 *
 * No channel publishes a credit counter we can read per request; the pack records
 * tokens. The figure is `tokens ÷ 1e6 × the model's multiplier`, and the multiplier is
 * parsed from the model's display name (`Hy3 · x0.05`) — the same number the user sees
 * in their picker. A model whose name carries no multiplier is counted in tokens and
 * reported as unpriced, never billed at zero: "we do not know the price" and "this was
 * free" are different facts and the panel must not merge them.
 *
 * WHY IT POLLS SLOWLY
 *
 * Every turn changes the ledger, but the ledger is a file on disk read by the host —
 * polling on each keystroke would be pure cost for a number that moves once per
 * request. Thirty seconds matches the pool card and is comfortably faster than a
 * person notices.
 *
 * @module dsh-xdpool/client/credit-strip
 */
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { POOL_CREDITS_SPEND_PATH } from '../status-paths.ts'
import type { XdPoolSettingsKey } from './locales.ts'

type Translate = (key: XdPoolSettingsKey, params?: Record<string, unknown>) => string

/** One channel's line in the breakdown. */
interface ChannelTotal {
  channel: string
  requests: number
  inputTokens: number
  outputTokens: number
  credits: number
  unpricedModels: number
}

/** What the host answers on {@link POOL_CREDITS_SPEND_PATH}. */
interface SpendReport {
  windowDays?: number | undefined
  from: string
  to: string
  channels: readonly ChannelTotal[]
  unreadable: number
  /** Relay traffic, deliberately excluded from the totals above. */
  gatewayRequests: number
  empty: boolean
}

/** Poll interval. Slower than the pool card: the ledger changes once per request. */
const POLL_MS = 30_000

/**
 * The window this strip reports.
 *
 * Today, not the retained 90 days: the composer strip is a running gauge, and a
 * three-month total next to the textbox would read as "this session". The full history
 * stays available in the data panel, which is where someone goes to look back.
 */
const WINDOW_DAYS = 1

/** Trim a credit figure to something a single line can hold. */
function compact(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0'
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`
  if (value >= 10) return value.toFixed(0)
  if (value >= 1) return value.toFixed(1)
  return value.toFixed(2)
}

/** 1234567 → `1.2M`, so a token count fits the same line as the credits. */
function tokens(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`
  return String(Math.round(value))
}

function reportFrom(value: unknown): SpendReport | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const channels = Array.isArray(record['channels'])
    ? (record['channels'] as unknown[]).flatMap(raw => {
      if (raw === null || typeof raw !== 'object') return []
      const row = raw as Record<string, unknown>
      const channel = row['channel']
      if (typeof channel !== 'string' || channel === '') return []
      const num = (key: string): number =>
        typeof row[key] === 'number' && Number.isFinite(row[key]) ? (row[key] as number) : 0
      return [{
        channel,
        requests: num('requests'),
        inputTokens: num('inputTokens'),
        outputTokens: num('outputTokens'),
        credits: num('credits'),
        unpricedModels: num('unpricedModels'),
      }]
    })
    : []
  return {
    windowDays: typeof record['windowDays'] === 'number' ? record['windowDays'] as number : undefined,
    from: typeof record['from'] === 'string' ? record['from'] : '',
    to: typeof record['to'] === 'string' ? record['to'] : '',
    channels,
    unreadable: typeof record['unreadable'] === 'number' ? record['unreadable'] as number : 0,
    gatewayRequests: typeof record['gatewayRequests'] === 'number' ? record['gatewayRequests'] as number : 0,
    empty: record['empty'] === true,
  }
}

export function CreditStrip({ t }: { readonly t?: Translate | undefined }): ReactElement | null {
  const [report, setReport] = useState<SpendReport | undefined>(undefined)
  const [open, setOpen] = useState(false)
  const [failed, setFailed] = useState(false)
  const mounted = useRef(true)

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(`${POOL_CREDITS_SPEND_PATH}?days=${String(WINDOW_DAYS)}`, {
        headers: { accept: 'application/json' },
      })
      if (!res.ok) throw new Error(String(res.status))
      const next = reportFrom(await res.json())
      if (!mounted.current) return
      setReport(next)
      setFailed(false)
    } catch {
      // A strip that cannot read the ledger must go quiet, not shout: this sits in
      // the composer and a red error every 30 seconds would be worse than no number.
      if (mounted.current) setFailed(true)
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    void load()
    const timer = window.setInterval(() => { void load() }, POLL_MS)
    return () => {
      mounted.current = false
      window.clearInterval(timer)
    }
  }, [load])

  // Nothing to show and nothing broken: render nothing at all, so a fresh install
  // does not get an empty bar above its textbox.
  if (failed || report === undefined) return null
  const channels = report.channels.filter(row => row.requests > 0 || row.inputTokens + row.outputTokens > 0)
  if (channels.length === 0) return null

  const total = channels.reduce((sum, row) => sum + row.credits, 0)
  const totalTokens = channels.reduce((sum, row) => sum + row.inputTokens + row.outputTokens, 0)
  const unpriced = channels.reduce((sum, row) => sum + row.unpricedModels, 0)

  return (
    <div className="dsm-xdpool-strip">
      <button
        type="button"
        className="dsm-xdpool-strip-main"
        aria-expanded={open}
        onClick={() => { setOpen(current => !current) }}
        title={t?.('strip.hint') ?? '今日估算消耗，按渠道拆分；数字是 token × 模型倍率的估算'}
      >
        <span className="dsm-xdpool-strip-k">{t?.('strip.today') ?? '今日消耗'}</span>
        <span className="dsm-xdpool-strip-v">{compact(total)}</span>
        <span className="dsm-xdpool-strip-u">{t?.('strip.credits') ?? '积分'}</span>
        <span className="dsm-xdpool-strip-sep">·</span>
        <span className="dsm-xdpool-strip-tok">{tokens(totalTokens)} tokens</span>
        {unpriced > 0
          ? (
            <>
              <span className="dsm-xdpool-strip-sep">·</span>
              <span className="dsm-xdpool-strip-warn" title={t?.('strip.unpricedHint') ?? '这些模型没有公布倍率，只统计 token 不计积分'}>
                {t?.('strip.unpriced', { count: unpriced }) ?? `${String(unpriced)} 个未定价`}
              </span>
            </>
          )
          : null}
        <span className="dsm-xdpool-strip-caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>
      {!open ? null : (
        <div className="dsm-xdpool-strip-list">
          {channels.map(row => (
            <div className="dsm-xdpool-strip-row" key={row.channel}>
              <span className="dsm-xdpool-strip-ch">{row.channel}</span>
              {/* Credits first: the strip's whole purpose is "who is expensive". A
                  channel with no priced model shows a dash rather than 0. */}
              <span className="dsm-xdpool-strip-n">
                {row.credits > 0 ? compact(row.credits) : '—'}
              </span>
              <span className="dsm-xdpool-strip-meta">
                {tokens(row.inputTokens + row.outputTokens)} · {String(row.requests)} {t?.('strip.calls') ?? '次'}
              </span>
            </div>
          ))}
          {/* Only shown when there IS relay traffic, and phrased as an exclusion: the
              user opening the breakdown while sharing the gateway would otherwise
              wonder why the ledger has more rows than this list. */}
          {report.gatewayRequests > 0
            ? (
              <div className="dsm-xdpool-strip-note">
                {t?.('strip.gatewayExcluded', { count: report.gatewayRequests })
                  ?? `另有 ${String(report.gatewayRequests)} 次来自网关（其他设备），未计入`}
              </div>
            )
            : null}
        </div>
      )}
    </div>
  )
}

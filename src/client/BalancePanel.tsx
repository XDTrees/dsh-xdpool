/**
 * The balance panel, shaped like the one users compare against.
 *
 * WHAT THIS SHOWS, AND WHY IT IS NOT THE SPEND STRIP
 *
 * The spend strip answers "how much have I used today". This answers a different and
 * more pressing question: **how much is left**. They are different numbers with
 * different urgency — a remainder tells you whether to start a long task, a spend
 * figure tells you what it cost after the fact — so they are separate surfaces rather
 * than one panel with a toggle.
 *
 * THE SHAPE
 *
 * One row per channel: icon, name, remaining credits, a star (preferred), a chevron.
 * Expanding shows every ACCOUNT under it, and each account's own packages — because a
 * channel's 21,887 is not one number the user can act on, it is 99 + 4559 + 3648 + …
 * across accounts that expire on different days.
 *
 * The footer repeats the two totals that matter at a glance: how many accounts are
 * counted, and the grand total.
 *
 * DATA
 *
 * Everything comes from the status document the pool already publishes: each account
 * carries `credits.total` plus its `packages[]`. No new endpoint, and no derivation —
 * these are the vendor's own figures.
 *
 * @module dsh-xdpool/client/BalancePanel
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { POOL_STATUS_PATH } from '../status-paths.ts'
import type { XdPoolSettingsKey } from './locales.ts'

type Translate = (key: XdPoolSettingsKey, params?: Record<string, unknown>) => string

/** One package behind an account's balance. */
interface PackageInfo {
  packageName: string
  remain: number
  size: number
  /** One-off packs expire; monthly ones refresh. */
  expiresAtMs?: number | undefined
  refreshAtMs?: number | undefined
}

/** One account's balance. */
export interface AccountBalance {
  id: string
  label: string
  total: number
  packages: readonly PackageInfo[]
}

/** One channel's row. */
export interface ChannelRow {
  /** `buddy`, `workbuddy`, or a pack channel id. */
  id: string
  name: string
  accounts: readonly AccountBalance[]
  total: number
  /** The channel the user pinned first, when one is pinned. */
  preferred: boolean
}

/** Poll interval: a balance moves only when a request spends, so this is generous. */
const POLL_MS = 60_000

/** `21887` → `21,887`; the screenshot's own grouping, which reads faster than raw digits. */
function grouped(value: number): string {
  if (!Number.isFinite(value)) return '0'
  return Math.round(value).toLocaleString('en-US')
}

/** A machine, not a dot: the digits line up, and a column of them stays scannable. */
function compact(value: number): string {
  if (!Number.isFinite(value)) return '0'
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}k`
  return String(Math.round(value))
}

function packagesOf(value: unknown): PackageInfo[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(raw => {
    if (raw === null || typeof raw !== 'object') return []
    const row = raw as Record<string, unknown>
    const name = row['packageName']
    if (typeof name !== 'string' || name === '') return []
    const num = (key: string): number =>
      typeof row[key] === 'number' && Number.isFinite(row[key]) ? (row[key] as number) : 0
    return [{
      packageName: name,
      remain: num('remain'),
      size: num('size'),
      expiresAtMs: typeof row['expiresAtMs'] === 'number' ? row['expiresAtMs'] as number : undefined,
      refreshAtMs: typeof row['refreshAtMs'] === 'number' ? row['refreshAtMs'] as number : undefined,
    }]
  })
}

/** Build the channel rows from the pool status document. */
export function channelsFromStatus(value: unknown): readonly ChannelRow[] {
  if (value === null || typeof value !== 'object') return []
  const accounts = (value as { accounts?: unknown }).accounts
  if (!Array.isArray(accounts)) return []

  // Grouped by the credential's DOMAIN region, which is what actually distinguishes
  // the two pools: `buddy` talks to copilot.tencent.com and `workbuddy` to
  // workbuddy.ai. Grouping by display label would split one pool in two the moment a
  // user renamed an account.
  const byChannel = new Map<string, AccountBalance[]>()
  for (const raw of accounts) {
    if (raw === null || typeof raw !== 'object') continue
    const row = raw as Record<string, unknown>
    const id = row['id']
    const label = row['label']
    if (typeof id !== 'string' || typeof label !== 'string') continue
    const credits = row['credits']
    if (credits === null || typeof credits !== 'object') continue
    const record = credits as Record<string, unknown>
    const total = typeof record['total'] === 'number' ? record['total'] : undefined
    // An account with no reading yet is not a zero balance; it is unknown, and the
    // panel would misreport a total if it counted it as empty.
    if (total === undefined) continue
    const domain = typeof row['domain'] === 'string' ? row['domain'].toLowerCase() : ''
    const channel = domain.includes('workbuddy.ai') ? 'workbuddy' : 'buddy'
    const list = byChannel.get(channel) ?? []
    list.push({ id, label, total, packages: packagesOf(record['packages']) })
    byChannel.set(channel, list)
  }

  return [...byChannel.entries()].map(([id, list]) => ({
    id,
    name: id === 'workbuddy' ? 'WorkBuddy 国际版' : 'WorkBuddy 国内版',
    // Largest balance first inside a channel: the account that can carry a long task
    // should not be buried under a nearly-empty one.
    accounts: [...list].sort((a, b) => b.total - a.total),
    total: list.reduce((sum, account) => sum + account.total, 0),
    preferred: false,
  }))
}

export function BalancePanel({ t }: { readonly t?: Translate | undefined }): ReactElement | null {
  const [channels, setChannels] = useState<readonly ChannelRow[]>([])
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const [failed, setFailed] = useState(false)
  const mounted = useRef(true)

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(POOL_STATUS_PATH, { headers: { accept: 'application/json' } })
      if (!res.ok) throw new Error(String(res.status))
      const next = channelsFromStatus(await res.json())
      if (!mounted.current) return
      setChannels(next)
      setFailed(false)
    } catch {
      // Silent: this sits in the settings card, and a failing poll should not shout.
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

  const totals = useMemo(() => {
    const accounts = channels.reduce((sum, row) => sum + row.accounts.length, 0)
    const credits = channels.reduce((sum, row) => sum + row.total, 0)
    return { accounts, credits }
  }, [channels])

  if (failed || channels.length === 0) return null

  const toggle = (id: string): void => {
    setOpen(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="dsm-xdpool-bal">
      <div className="dsm-xdpool-bal-head">
        <span className="dsm-xdpool-bal-title">{t?.('bal.title') ?? '渠道积分'}</span>
        <button
          type="button"
          className="dsm-xdpool-bal-refresh"
          aria-label={t?.('bal.refresh') ?? '刷新'}
          onClick={() => { void load() }}
        >
          ↻
        </button>
      </div>
      <div className="dsm-xdpool-bal-list">
        {channels.map(row => {
          const expanded = open.has(row.id)
          return (
            <div className="dsm-xdpool-bal-group" key={row.id}>
              <button
                type="button"
                className="dsm-xdpool-bal-row"
                aria-expanded={expanded}
                onClick={() => { toggle(row.id) }}
              >
                <span className="dsm-xdpool-bal-avatar" data-ch={row.id}>
                  {row.id === 'workbuddy' ? 'W' : 'X'}
                </span>
                <span className="dsm-xdpool-bal-name">{row.name}</span>
                {/* Account count, then the balance: the count explains how the total
                    was reached, which is the question a bare number invites. */}
                <span className="dsm-xdpool-bal-count">{compact(row.accounts.length)}</span>
                <span className="dsm-xdpool-bal-total">{grouped(row.total)}</span>
                <span className="dsm-xdpool-bal-star" data-on={row.preferred ? 'true' : 'false'}>★</span>
                <span className="dsm-xdpool-bal-caret" aria-hidden="true">{expanded ? '⌄' : '›'}</span>
              </button>
              {!expanded ? null : (
                <div className="dsm-xdpool-bal-accounts">
                  {row.accounts.map(account => (
                    <div className="dsm-xdpool-bal-account" key={account.id}>
                      <span className="dsm-xdpool-bal-account-name">{account.label}</span>
                      <span className="dsm-xdpool-bal-account-total">{grouped(account.total)}</span>
                      {account.packages.length === 0 ? null : (
                        <div className="dsm-xdpool-bal-packs">
                          {/* Each package shows remain/size: a pack that is 100/100 is
                              untouched, and one at 5/500 is the one to spend first. */}
                          {account.packages.slice(0, 6).map((pack, index) => (
                            <div className="dsm-xdpool-bal-pack" key={`${pack.packageName}-${String(index)}`}>
                              <span className="dsm-xdpool-bal-pack-name">{pack.packageName}</span>
                              <span className="dsm-xdpool-bal-pack-amount">
                                {grouped(pack.remain)}{pack.size > 0 ? ` / ${grouped(pack.size)}` : ''}
                              </span>
                            </div>
                          ))}
                          {account.packages.length > 6
                            ? (
                              <div className="dsm-xdpool-bal-pack">
                                <span className="dsm-xdpool-bal-pack-name">
                                  {t?.('bal.morePacks', { count: account.packages.length - 6 })
                                    ?? `还有 ${String(account.packages.length - 6)} 个包`}
                                </span>
                              </div>
                            )
                            : null}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div className="dsm-xdpool-bal-foot">
        <span className="dsm-xdpool-bal-foot-meta">
          {t?.('bal.accounts', { count: totals.accounts }) ?? `${String(totals.accounts)} 个账号`}
        </span>
        <span className="dsm-xdpool-bal-foot-total">{grouped(totals.credits)}</span>
      </div>
    </div>
  )
}

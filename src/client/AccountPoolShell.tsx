/**
 * The account pool's shell: a raildown the left, one channel's detail on the right.
 *
 * WHY THIS SHAPE REPLACES THE SCROLLING LIST
 *
 * The column of cards grew with every channel — twenty-two of them, each with accounts, models,
 * balances and automation — so the page became an infinite scroll where the thing you wanted
 * was always somewhere else, and the summary (what do I have, what is about to expire) sat at the
 * top and scrolled away. A fixed two-column frame keeps the rail and the header still while the
 * detail scrolls on its own: nothing is ever "further down", it is one click sideways.
 *
 * MOBILE IS NOT AN AFTERTHOUGHT
 *
 * At 640px and below the rail becomes a horizontal strip above the detail rather than a narrow
 * column: a 200px rail on a 360px screen leaves 160px for the content, which truncates every
 * model name and squeezes the buttons into two-line labels. The media query is in the stylesheet;
 * the markup is identical either way.
 *
 * @module dsh-xdpool/client/AccountPoolShell
 */
import { type ReactElement, type ReactNode } from 'react'

/** One rail row's height, including its gap. The indicator steps by this. */
const ROW_HEIGHT = 32

/** One entry in the rail. */
export interface RailEntry {
  id: string
  name: string
  /** The vendor's mark, as a data URL. Absent means the letters tile is drawn instead. */
  icon?: string
  /** Two characters for the fallback tile. */
  initials: string
  /** How many accounts are signed in; 0 means the channel is not bound yet. */
  accountCount: number
  /** Whether anything about this channel is worth a badge — an expiry, an error. */
  attention?: 'expiring' | 'error' | undefined
  /** Whether the channel is signed in at all. Bound channels sort first. */
  bound: boolean
}

/** What the header states, across every channel. */
export interface PoolSummary {
  /** Total credit held, per unit. Several units are shown apart — never added together. */
  totals: readonly { unit: string; amount: number }[]
  /** What is about to expire, as one line; absent when nothing is. */
  expiring?: string | undefined
  accountCount: number
  boundChannels: number
  totalChannels: number
}

/**
 * The header's three figures.
 *
 * Three, not five: the question a user opens this with is "how much do I have, how much is going,
 * and how many accounts is that spread over". Anything else is a number they have to interpret
 * before it means anything.
 */
export function PoolSummaryBar({ summary, labels }: {
  summary: PoolSummary
  labels: { total: string; expiring: string; accounts: string }
}): ReactElement {
  return (
    <div className="list-stats" role="group" aria-label={labels.total}>
      <div className="ls ls">
        <span className="ls-k">{labels.total}</span>
        <span className="ls-v">
          {summary.totals.length === 0
            ? '—'
            : summary.totals.map(total => (
              <span key={total.unit} className="ls-v">
                {formatAmount(total.amount)}
                <span className="ls-u">{total.unit}</span>
              </span>
            ))}
        </span>
      </div>
      <div className="ls">
        <span className="ls-k">{labels.expiring}</span>
        <span className="ls-v ls-u">
          {summary.expiring ?? '—'}
        </span>
      </div>
      <div className="ls">
        <span className="ls-k">{labels.accounts}</span>
        <span className="ls-v">
          {`${String(summary.accountCount)} 个`}
          <span className="ls-u">
            {`/ ${String(summary.boundChannels)} 个渠道`}
          </span>
        </span>
      </div>
    </div>
  )
}

/** A number with a thin thousands separator, so five figures stay readable. */
export function formatAmount(value: number): string {
  if (!Number.isFinite(value)) return '—'
  const rounded = Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 100) / 100
  const [whole, fraction] = String(rounded).split('.')
  const grouped = (whole ?? '0').replace(/\B(?=(\d{3})+(?!\d))/gu, ',')
  return fraction === undefined ? grouped : `${grouped}.${fraction}`
}

/**
 * The rail: one row per channel, bound ones first.
 *
 * Sorting happens here rather than in the caller because the ORDER IS THE FEATURE: a user opening
 * this wants their working channels at the top, and every caller that had to repeat the rule
 * would eventually drift from it.
 */

/**
 * 侧栏顶部的三个数字：账号总数 / 已连 / 积分。
 *
 * 设计稿把这三个并排放在中间栏第一格，而不是页面头上。三个都是「这一池有多少」，
 * 属于同一个问题，所以并排；分成三行会让中间空出一大截，还分不清哪个是总量。
 *
 * 总积分只在有一个单位时才印 —— 多个单位（积分 + token）并排会让这一格
 * 比另外两格高出一行，反而难扫。
 */
export function ChannelRailHead({ total, connected, credits }: {
  total: number
  connected: number
  credits: readonly { unit: string; amount: number }[]
}): ReactElement {
  const first = credits[0]
  return (
    <div className="list-head">
      <div className="ls">
        <span className="ls-v">{String(total)}</span>
        <span className="ls-k">账号总数</span>
      </div>
      <div className="ls">
        <span className="ls-v">{String(connected)}</span>
        <span className="ls-k">已连</span>
      </div>
      <div className="ls">
        <span className="ls-v">
          {first === undefined ? '—' : formatAmount(first.amount)}
          {first === undefined ? null : <span className="ls-u">{first.unit}</span>}
        </span>
        <span className="ls-k">积分</span>
      </div>
    </div>
  )
}

export function ChannelRail({ entries, active, onSelect, labels, head }: {
  entries: readonly RailEntry[]
  active: string
  onSelect: (id: string) => void
  labels: { bound: string; unbound: string }
  /**
   * 列表上方的汇总。

  侧栏里（embedded）没有单独放汇总的那一行，所以要塞进 rail 自己 ——
  设计稿的中间栏第一屏就是三个数字格，它属于这一栏，不属于页面头。
   */
  head?: ReactNode
}): ReactElement {
  const bound = entries.filter(entry => entry.bound)
  const unbound = entries.filter(entry => !entry.bound)
  const render = (entry: RailEntry): ReactElement => (
    <button
      key={entry.id}
      type="button"
      className="ch"
      data-active={entry.id === active}
      data-state={entry.bound ? 'ok' : 'idle'}
      onClick={() => { onSelect(entry.id) }}
    >
      <span className="ch-mark" aria-hidden="true">
        {entry.icon === undefined
          ? entry.initials
          : <img src={entry.icon} alt="" width={20} height={20} />}
      </span>
      <span className="ch-name" title={entry.name}>{entry.name}</span>
      {entry.attention === undefined ? null : (
        <span className="ch-dot" data-tone={entry.attention} aria-label={entry.attention} />
      )}
      <span className="ch-n">{entry.accountCount === 0 ? '' : String(entry.accountCount)}</span>
    </button>
  )

  /**
   * Where the indicator sits, as a row index.
   *
   * A single element travels between rows rather than each row lighting itself: the moving bar is
   * what makes a rail read as one control with a position, instead of a list of independent
   * buttons that happen to look pressed.
   */
  const order = [...bound, ...unbound]
  const activeIndex = order.findIndex(entry => entry.id === active)

  return (
    <nav className="list dsm-xdpool-rail" aria-label={labels.bound}>
      {head}
      {activeIndex < 0 ? null : (
        <span
          className=""
          aria-hidden="true"
          style={{ transform: `translateY(${String(activeIndex * ROW_HEIGHT)}px)` }}
        />
      )}
      {bound.length === 0 ? null : (
        <>
          <p className="list-group">{labels.bound}</p>
          {bound.map(render)}
        </>
      )}
      {unbound.length === 0 ? null : (
        <>
          <p className="list-group" data-empty="true">{labels.unbound}</p>
          {unbound.map(render)}
        </>
      )}
    </nav>
  )
}

/**
 * One channel's detail panel.
 *
 * A wrapper rather than a component that knows about accounts: the detail content differs per
 * feature page, and what is shared is the frame — the sticky header, the scroll area, and the
 * fact that only this part scrolls.
 */
export function ChannelDetail({ title, subtitle, icon, initials, state, actions, children }: {
  title: string
  subtitle?: ReactNode
  /** The vendor's mark, as a data URL. */
  icon?: string | undefined
  /** Two characters for the fallback tile. */
  initials?: string | undefined
  /** The connected / not-connected pill. */
  state?: { on: boolean; label: string } | undefined
  actions?: ReactNode
  children: ReactNode
}): ReactElement {
  return (
    <section className="main dsm-xdpool-detail dsm-xdpool-regions">
      <header className="mhead">
        <div className="mhead-title">
          {icon === undefined && initials === undefined ? null : (
            <span className="ch-mark" aria-hidden="true">
              {icon === undefined ? initials : <img src={icon} alt="" width={22} height={22} />}
            </span>
          )}
          <h2>{title}</h2>
          {state === undefined ? null : (
            <span className="pill" data-on={state.on}>{state.label}</span>
          )}
          {subtitle === undefined ? null : (
            <span className="mhead-org">{subtitle}</span>
          )}
        </div>
        {actions === undefined ? null : (
          <div className="mhead-actions">{actions}</div>
        )}
      </header>
      <div className="mbody">{children}</div>
    </section>
  )
}

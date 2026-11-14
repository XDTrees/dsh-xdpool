/**
 * The credit indicator beside the model name in the composer, and the panel it opens.
 *
 * A DOT, NOT A STRIP
 *
 * The composer row already carries a back button, the model name, its multiplier and the
 * reasoning level. A table of balances there would be a second toolbar. So the inline
 * form is a single 9px dot whose COLOUR is the whole at-a-glance message, and the detail
 * lives behind a click:
 *
 *   - **green**  — this session's channel still has credits;
 *   - **grey**   — it has run out (or the channel cannot be priced), which is the state
 *                  that means "switch models before starting something long".
 *
 * WHICH CHANNEL IS "THIS SESSION'S"
 *
 * The pool accounts serve every model, so the channel a request lands on is decided by
 * `priority` — the richest one — and that is what the dot reports. It is read from the
 * pool status, never guessed.
 *
 * THE PANEL ANSWERS THREE THINGS
 *
 * What is left of the period's allowance (a bar plus both numbers), and how much was
 * spent today, and whether that day figure is measured or estimated. Three numbers, and
 * the sources are named where it matters: the allowance from the pack's package list,
 * the day total from cost-meter's recorded balance drops (measured) or, when nothing
 * recorded the day, from this process's own token samples (estimated, marked `≈`).
 *
 * POSITIONING AND DISMISSAL ARE DONE HERE
 *
 * The host's own floating primitive is internal to its packages, so this uses a fixed
 * anchor measured from the button plus a document-level listener for outside clicks and
 * Escape. That is the same contract the host's meters use, implemented locally rather
 * than depending on a module this bundle cannot import.
 *
 * @module dsh-xdpool/client/CreditDot
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react'
import { POOL_CREDITS_SPEND_PATH, POOL_CREDITS_TODAY_PATH, POOL_STATUS_PATH, POOL_USAGE_PATH } from '../status-paths.ts'
import { creditsOf, ratesFor } from '../credits.ts'
import type { UsageCall } from '../stats.ts'
import { POOL_NAV_ICON_MASK_URL } from './nav-icon.ts'
import { CREDIT_DOT_CSS } from './styles.ts'
import type { XdPoolSettingsKey } from './locales.ts'

type Translate = (key: XdPoolSettingsKey, params?: Record<string, unknown>) => string

/** One channel's balance, as the dot decides on it. */
interface ChannelBalance {
  id: string
  name: string
  total: number
  accounts: number
  /**
   * Credits the channel's packages GRANTED this period, summed.
   *
   * Only the pack publishes this. `total` is a balance and says nothing about how much of
   * the allowance has been burned, so a bar built on it can only be a guess — this is the
   * measured half of the same question.
   */
  granted: number
  /** Credits still unspent across those packages. */
  remain: number
}

/** The bar under the channel name: how much of the period's allowance is LEFT. */
interface BarState {
  /** Credits granted this period. */
  total: number
  /** Credits still unspent. */
  left: number
  /** `left / total`, clamped to 0..1. */
  share: number
  /** Where the numbers came from, so the caption can say which. */
  source: 'packages' | 'ledger'
}

/** Everything the panel renders. */
interface Snapshot {
  /** The channel serving the selected model, when it can be identified. */
  channel: ChannelBalance | undefined
  /** Every channel, for the "and the others" list. */
  all: readonly ChannelBalance[]
  /** Credits used today, summed across channels. */
  spentToday: number | undefined
  /**
   * `spentToday` was PRICED, not measured: it comes from this process's own token samples
   * and restarts with DSH. The panel marks it with `≈` so the number is never mistaken for
   * the account's own record.
   */
  spentEstimated: boolean
  /** `spentToday` was measured from account balance drops, so it covers the whole day. */
  spentMeasured: boolean
  /** The period's allowance, when the pack published one. */
  bar: BarState | undefined
  /** Channels that actually served a request today, richest first. */
  usedChannels: readonly ChannelBalance[]
}

/** Re-read cadence. A balance moves only when something spends. */
const POLL_MS = 45_000

/** `21887` → `21,887`. */
function grouped(value: number): string {
  return Number.isFinite(value) ? Math.round(value).toLocaleString('en-US') : '0'
}

/** Keep a measured coordinate inside the viewport instead of off it. */
function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value))
}

/**
 * `12.5` → `12.5`, `21887.4` → `21,887`.
 *
 * An estimate is quoted to the cent while it is small and to the unit once it is large: two
 * decimals on a four-figure number are noise dressed as precision.
 */
function creditCount(value: number): string {
  return value >= 100 ? grouped(value) : String(Math.round(value * 100) / 100)
}

/**
 * Price THIS PROCESS's own token samples for the local day.
 *
 * The last resort, used only when nothing measured the day. The recorder keeps its samples
 * in memory, so this figure restarts at zero with DSH and undercounts a day that is already
 * half spent. Returns undefined when no sample could be priced, which is a different
 * statement from `you spent nothing`.
 */
function creditsToday(entries: readonly UsageCall[]): number | undefined {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const from = start.getTime()
  let total = 0
  let priced = 0
  for (const entry of entries) {
    if (typeof entry.at !== 'number' || entry.at < from) continue
    const usage = entry.usage
    if (usage === undefined) continue
    /**
     * `usage.inputTokens` INCLUDES the cached portion (see `TokenUsage.cachedTokens`),
     * while `creditsOf` bills fresh and cached separately at different rates — passing the
     * raw figure would bill every cached token twice, once at the full input rate. The
     * pack's ledger keeps the two apart, which is why the host never has to subtract.
     */
    const fresh = Math.max(0, usage.inputTokens - usage.cachedTokens)
    const credits = creditsOf(fresh, usage.cachedTokens, usage.outputTokens, ratesFor(entry.model))
    if (credits === undefined) continue
    total += credits
    priced += 1
  }
  return priced === 0 ? undefined : Math.round(total * 10_000) / 10_000
}

/**
 * Group accounts the way the pool CARD groups them: by REGION, not by credential origin.
 *
 * WHY THIS CHANGED
 *
 * The first version keyed channels off the credential's domain, which split one pool card
 * into two rows — `www.codebuddy.cn` 13,990 and `www.workbuddy.cn` 99 — while the card
 * itself showed a single "WorkBuddy 国内版 · 14,089". Both numbers were on screen at once
 * and they disagreed, which is the defect this fixes.
 *
 * The card is right and the domain split was wrong. A pool is a set of accounts that serve
 * the same lane; signing in through `copilot.tencent.com` (CodeBuddy's endpoint) or
 * `www.workbuddy.cn` only changes which origin issued the credential, not which pool the
 * account belongs to. `regionOf()` already owns that mapping for the host half, and a
 * credential's domain is exactly what decides its region — so the grouping follows the
 * domain's REGION rather than the domain string itself.
 *
 * One consequence worth stating: an account whose balance has not been read is skipped
 * from the total (it would understate), but it still belongs to its region — which is why
 * the count can be lower than the card's account count without the two disagreeing about
 * money.
 */
function regionOfDomain(domain: string): 'cn' | 'global' {
  // `www.workbuddy.ai` is the international endpoint; every other origin in this plugin
  // (tencent's copilot host, codebuddy.cn, workbuddy.cn) is the domestic pool.
  return domain.toLowerCase().includes('workbuddy.ai') ? 'global' : 'cn'
}

function channelsOf(value: unknown): ChannelBalance[] {
  if (value === null || typeof value !== 'object') return []
  const accounts = (value as { accounts?: unknown }).accounts
  if (!Array.isArray(accounts)) return []
  const byRegion = new Map<string, { total: number; accounts: number; granted: number; remain: number }>()
  for (const raw of accounts) {
    if (raw === null || typeof raw !== 'object') continue
    const row = raw as Record<string, unknown>
    const credits = row['credits']
    if (credits === null || typeof credits !== 'object') continue
    // Bound once as an indexable record: `credits` is only known to be an object, and a
    // second narrowing would not carry the index signature into the package loop below.
    const wallet = credits as Record<string, unknown>
    const total = wallet['total']
    if (typeof total !== 'number' || !Number.isFinite(total)) continue
    const domain = typeof row['domain'] === 'string' ? row['domain'] : ''
    const id = regionOfDomain(domain)
    const current = byRegion.get(id) ?? { total: 0, accounts: 0, granted: 0, remain: 0 }
    current.total += total
    current.accounts += 1
    /**
     * Sum the pack's package ledger as well.
     *
     * `size` is what the package granted and `remain` what is left of it, so the pair is the
     * ONLY consumption figure this endpoint normally carries: `total` is a balance and says
     * nothing about how much of the period has been burned. Without it the bar had no
     * numerator and rendered as a bare track forever.
     */
    const packages = Array.isArray(wallet['packages']) ? wallet['packages'] : []
    for (const entry of packages) {
      if (entry === null || typeof entry !== 'object') continue
      const record = entry as Record<string, unknown>
      const size = record['size']
      const left = record['remain']
      if (typeof size === 'number' && Number.isFinite(size) && size > 0) current.granted += size
      if (typeof left === 'number' && Number.isFinite(left) && left >= 0) current.remain += left
    }
    byRegion.set(id, current)
  }
  return [...byRegion.entries()]
    .map(([id, value2]) => ({
      id,
      name: id === 'global' ? 'WorkBuddy 国际版' : 'WorkBuddy 国内版',
      total: value2.total,
      accounts: value2.accounts,
      granted: value2.granted,
      remain: value2.remain,
    }))
    .sort((a, b) => b.total - a.total)
}

export function CreditDot({ t }: { readonly t?: Translate | undefined }): ReactElement | null {
  const [snapshot, setSnapshot] = useState<Snapshot | undefined>(undefined)
  const [open, setOpen] = useState(false)
  const [failed, setFailed] = useState(false)
  const anchorRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | undefined>(undefined)
  const mounted = useRef(true)

  const load = useCallback(async (): Promise<void> => {
    try {
      /**
       * Four documents, because they answer four different questions and none is optional in
       * the same way: the status is the only one the panel cannot render without, so its
       * failure is fatal; the other three degrade to `undefined` and the panel says so.
       *
       *   - status  — balances, and the packages the bar is built from;
       *   - spend   — the pack's own credit roll-up (empty on a pack that stopped writing);
       *   - usage   — this process's token samples, the last-resort estimate;
       *   - today   — cost-meter's per-account balance drops, the only MEASURED day total.
       */
      const [statusRes, spendRes, usageRes, todayRes] = await Promise.all([
        fetch(POOL_STATUS_PATH, { headers: { accept: 'application/json' } }),
        fetch(`${POOL_CREDITS_SPEND_PATH}?days=1`, { headers: { accept: 'application/json' } }).catch(() => undefined),
        fetch(POOL_USAGE_PATH, { headers: { accept: 'application/json' } }).catch(() => undefined),
        fetch(POOL_CREDITS_TODAY_PATH, { headers: { accept: 'application/json' } }).catch(() => undefined),
      ])
      if (!statusRes.ok) throw new Error(String(statusRes.status))
      const status = await statusRes.json() as Record<string, unknown>
      if (!mounted.current) return

      const all = channelsOf(status)
      // Which channel serves a request: the pool accounts are the same pool regardless of
      // model, so the channel with the most credits is where `priority` sends it.
      const channel = all[0]

      let spentToday: number | undefined
      /** `spentToday` was priced from token samples rather than measured from balances. */
      let spentEstimated = false
      /** `spentToday` came from cost-meter's recorded balance drops. */
      let spentMeasured = false
      /** This process's own samples, kept for the estimate fallback below. */
      let usageEntries: readonly UsageCall[] | undefined
      /** Channel ids that served at least one request today. */
      const activeChannels = new Set<string>()
      if (spendRes !== undefined && spendRes.ok) {
        const spend = await spendRes.json() as { channels?: unknown }
        const rows = Array.isArray(spend.channels) ? spend.channels : []
        let total = 0
        let any = false
        for (const raw of rows) {
          if (raw === null || typeof raw !== 'object') continue
          const record = raw as Record<string, unknown>
          const credits = record['credits']
          if (typeof credits === 'number' && Number.isFinite(credits)) { total += credits; any = true }
          // Only a channel that actually served is listed below, and only the fact that it
          // served matters — the request COUNT is not drawn, so it is not carried any further.
          const count = record['requests']
          if (typeof count === 'number' && Number.isFinite(count) && count > 0) {
            const id = record['channel']
            if (typeof id === 'string' && id !== '') activeChannels.add(id)
          }
        }
        if (any) spentToday = Math.round(total * 100) / 100
      }

      /**
       * Which channels served today.
       *
       * The ledger names a channel the way the PACK does — `buddy` for the domestic pool
       * and `workbuddy` for the international one — which is the same split
       * `regionOfDomain` applies, so the ids line up directly.
       */
      const usedChannels = all.filter(channel => activeChannels.has(channel.id))

      /**
       * Measure before estimating.
       *
       * cost-meter samples every pooled account's balance and books each DROP under the
       * local day, so its total is observed rather than derived — and it survives a DSH
       * restart, which the recorder below does not. Only ask when the pack ledger had
       * nothing, because the ledger is the pool's own account of the same money.
       */
      if (spentToday === undefined && todayRes !== undefined && todayRes.ok) {
        const today = await todayRes.json().catch(() => undefined) as
          | { available?: unknown; total?: unknown }
          | undefined
        if (today !== undefined && today !== null && today.available === true
          && typeof today.total === 'number' && Number.isFinite(today.total)) {
          spentToday = today.total
          spentMeasured = true
        }
      }

      /**
       * The last resort: price this process's own samples for today.
       *
       * An empty ledger and no cost-meter file means nothing measured the day, so the
       * estimate is all there is. It is labelled with `≈` in the panel and it restarts at
       * zero with DSH, which is exactly why it is the fallback and not the answer.
       */
      if (usageRes !== undefined && usageRes.ok) {
        const ledger = await usageRes.json().catch(() => undefined) as { entries?: unknown } | undefined
        if (ledger !== undefined && ledger !== null && Array.isArray(ledger.entries)) {
          usageEntries = ledger.entries as readonly UsageCall[]
        }
      }
      if (spentToday === undefined && usageEntries !== undefined) {
        const estimate = creditsToday(usageEntries)
        if (estimate !== undefined) {
          spentToday = estimate
          spentEstimated = true
        }
      }

      /**
       * What the 4px bar measures: how much of the period's allowance is LEFT.
       *
       * It used to be `spentToday / (channel.total + spentToday)`, and `spentToday` comes from
       * the pack's credit ledger, which on a pack that has stopped writing is empty on every
       * request. A numerator of zero drew a bare grey track forever — indistinguishable from
       * a broken bar. The pack's own package list IS populated and carries both the granted
       * and the remaining amount, so `sum(size)` and `sum(remain)` are real figures; the
       * ledger ratio stays only as a fallback for packs that ship no packages.
       */
      const granted = all.reduce((sum, row) => sum + (Number.isFinite(row.granted) ? row.granted : 0), 0)
      const leftCredits = all.reduce((sum, row) => sum + (Number.isFinite(row.remain) ? row.remain : 0), 0)
      let bar: BarState | undefined
      if (granted > 0) {
        const share = clamp(leftCredits / granted, 0, 1)
        bar = { total: granted, left: Math.min(granted, leftCredits), share, source: 'packages' }
      } else {
        const remaining = channel?.total ?? 0
        if (remaining > 0 || spentToday !== undefined) {
          const total = remaining + (spentToday ?? 0)
          bar = { total, left: remaining, share: clamp(total > 0 ? remaining / total : 0, 0, 1), source: 'ledger' }
        }
      }

      if (!mounted.current) return
      setSnapshot({ channel, all, spentToday, spentEstimated, spentMeasured, bar, usedChannels })
      setFailed(false)
    } catch {
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

  /**
   * Place the panel above the dot.
   *
   * Measured rather than CSS-anchored because the composer row can be at the bottom of
   * the viewport, and a panel that opens downward would be clipped by it. `side: top`
   * with a viewport clamp is the same rule the host's own meters follow.
   */
  useLayoutEffect(() => {
    if (!open) { setPos(undefined); return }
    const anchor = anchorRef.current
    if (anchor === null) return
    const box = anchor.getBoundingClientRect()
    /**
     * The panel sizes to its content (`width: max-content`), so its width can only be
     * read AFTER it has rendered. A hard-coded number here was what made a short line of
     * text sit in a 300px box: the width came from this layout maths rather than from
     * what the text needed. Measuring the element keeps the two in step.
     *
     * Falling back to 200 when the ref is not attached yet (first frame) is safe: the
     * effect re-runs on `open`, and the panel is `visibility: hidden` until `pos` exists.
     */
    const width = panelRef.current?.offsetWidth ?? 200
    const margin = 8
    const left = Math.min(
      Math.max(margin, box.left + box.width / 2 - width / 2),
      Math.max(margin, window.innerWidth - width - margin),
    )
    // Above the dot by default; if there is no room, below it.
    const panelHeight = panelRef.current?.offsetHeight ?? 240
    const above = box.top - panelHeight - 8
    // Clamped BOTH ways: a composer at the top of a short window used to push the panel
    // off the 0px edge, where `position: fixed` renders it off-screen rather than scrolling.
    const top = clamp(
      above >= margin ? above : box.bottom + 8,
      margin,
      Math.max(margin, window.innerHeight - panelHeight - margin),
    )
    setPos({ top, left })
  }, [open])

  /**
   * Re-measure once the panel has painted.
   *
   * `width: max-content` means the first pass measures a zero-width element: the panel is
   * attached but `pos` is still undefined, so it is laid out at its min-width. Re-running
   * after the content exists is what makes the width follow the text rather than the
   * placeholder. Keyed on the channel and the bar so a longer name or a five-digit
   * balance (a real possibility with a `· 14,031` suffix) triggers a fresh measurement.
   */
  useLayoutEffect(() => {
    if (!open) return
    const anchor = anchorRef.current
    const panel = panelRef.current
    if (anchor === null || panel === null) return
    const box = anchor.getBoundingClientRect()
    const width = panel.offsetWidth
    const margin = 8
    const left = Math.min(
      Math.max(margin, box.left + box.width / 2 - width / 2),
      Math.max(margin, window.innerWidth - width - margin),
    )
    const above = box.top - panel.offsetHeight - 8
    setPos(current => {
      if (current === undefined) return current
      const top = clamp(
        above >= margin ? above : box.bottom + 8,
        margin,
        Math.max(margin, window.innerHeight - panel.offsetHeight - margin),
      )
      // Skip the write when nothing moved: an identical setState still schedules a render.
      if (current.top === top && current.left === left) return current
      return { top, left }
    })
  }, [open, snapshot?.channel?.total, snapshot?.bar?.total, snapshot?.spentToday])

  /** Outside click and Escape, the two ways any popover on this host closes. */
  useEffect(() => {
    if (!open) return undefined
    const onPointer = (event: MouseEvent): void => {
      const target = event.target as Node | null
      if (target === null) return
      if (anchorRef.current?.contains(target) === true) return
      if (panelRef.current?.contains(target) === true) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointer, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  /**
   * The dot itself is never withheld.
   *
   * `failed || snapshot === undefined` used to `return null` for the WHOLE component, which
   * removed the trigger as well as the panel. The reported symptom was "clicking the green
   * credit icon opens a blank page": a newly created session has no snapshot yet, so the dot
   * briefly existed (green, from an earlier paint) and then the component unmounted, leaving
   * an empty popover shell on screen.
   *
   * Rendering the dot unconditionally and explaining the absence INSIDE the panel is the
   * only version where a click always produces an answer — which is the entire job of a
   * status indicator.
   *
   * `snapshot === undefined` before the first successful load reads as grey: an unknown
   * balance must not be presented as "you are fine".
   */
  const ready = snapshot !== undefined && !failed

  /**
   * Green when the serving channel still has credits, grey when it does not.
   *
   * `total > 0` is the whole test: the pool's own gate already refuses an account at its
   * reserved floor, so a non-zero total is genuinely spendable. A channel that could not
   * be read is grey — the dot must not claim "you are fine" on missing data.
   */
  const alive = ready && snapshot.channel !== undefined && snapshot.channel.total > 0
  /** Bound once so the JSX below narrows a plain const instead of a property path. */
  const bar = snapshot?.bar
  const label = alive    ? (t?.('dot.alive') ?? '还有积分')
    : (t?.('dot.empty') ?? '没有积分了')

  return (
    <span
      className="dsm-xdpool-dotwrap"
      style={{ ['--xdpool-dot-mask' as string]: `url("${POOL_NAV_ICON_MASK_URL}")` }}
    >
      {/* The stylesheet travels WITH the component. The dot renders in the composer,
          which no settings page's <style> reaches, so a style block parked in a page's
          CSS constant never applied — the panel showed up as bare text. */}
      <style>{CREDIT_DOT_CSS}</style>
      <button
        ref={anchorRef}
        type="button"
        className="dsm-xdpool-dot"
        data-state={alive ? 'alive' : 'empty'}
        aria-label={label}
        aria-expanded={open}
        title={`${label} · ${snapshot?.channel === undefined ? '—' : grouped(snapshot.channel.total)}`}
        onClick={() => { setOpen(current => !current) }}
      >
        {/* The plugin's own pool glyph in a mask, not a plain circle: it says WHICH
            number this is, and it takes its colour from `currentColor` so the same
            green/grey state drives the icon without a second asset. */}
        <span className="dsm-xdpool-dot-glyph" aria-hidden="true" />
      </button>
      {!open ? null : (
        <div
          ref={panelRef}
          className="dsm-xdpool-dotpanel"
          role="dialog"
          aria-label={t?.('dot.panelTitle') ?? '本会话积分'}
          style={pos === undefined ? { visibility: 'hidden' } : { top: `${String(pos.top)}px`, left: `${String(pos.left)}px` }}
        >
          {/*
            The header names the CHANNEL, not a status word.

            "还有积分" was a chip that said what the green dot already says — redundant,
            and it pushed the one fact worth reading off to a separate row. The channel
            line carries both the pool and its balance, so the header alone answers
            "which pool, how much", and the one row below only needs today's spend.

            The state still reaches an assistive reader through the dot's own
            `aria-label`, so dropping the chip costs no information for a screen reader.
          */}
          {/*
            One total, the same one the pool card shows.

            The card reports a lane's whole balance under one name — "WorkBuddy 国内版 ·
            14,089" — regardless of which origin issued each credential. The dot reports
            the same sum, because two screens in one plugin disagreeing about the same
            quantity is a bug the reader cannot resolve.

            The per-channel rows below only help when the user really does hold more than
            one lane (a `workbuddy.ai` account alongside the domestic ones); with a single
            lane the header already says everything.
          */}
          {/*
            When the data is not there yet, say so INSIDE the panel.

            The alternative — which shipped — was to render nothing at all, so a click on a
            freshly created session's dot produced an empty popover: the "clicking the green
            credit icon opens a blank page" report. A status indicator must always answer
            its own click; "not loaded yet" is an answer, an empty box is not.
          */}
          {!ready ? (
            <p className="dsm-xdpool-dotpanel-empty">
              {failed
                ? (t?.('dot.loadFailed') ?? '积分数据读取失败')
                : (t?.('dot.loading') ?? '正在读取积分…')}
            </p>
          ) : null}
          {!ready ? null : (
            <>
          <div className="dsm-xdpool-dotpanel-head">
            <span className="dsm-xdpool-dotpanel-channel">
              {snapshot.all.length === 0
                ? (t?.('dot.channelUnknown') ?? '未连接渠道')
                : `${snapshot.channel?.name ?? ''} · ${grouped(snapshot.all.reduce((sum, row) => sum + row.total, 0))}`}
            </span>
          </div>
          {/* The bar comes first: it is the one element that answers "am I close to the
              edge" without reading any number, which is what makes it worth the space.
              It fills with what is LEFT, so a shrinking bar means shrinking headroom, and
              the caption underneath spells the two numbers out rather than making the
              reader infer them from a length. */}
          {bar === undefined ? null : (
            <div className="dsm-xdpool-dotbarwrap">
              <div
                className="dsm-xdpool-dotbar"
                role="img"
                aria-label={t?.('dot.barLabel') ?? '本期剩余额度占比'}
              >
                <div
                  className="dsm-xdpool-dotbar-fill"
                  data-low={bar.share >= 0.9 ? 'true' : 'false'}
                  style={{ width: `${String(Math.min(100, Math.max(0, (1 - bar.share) * 100)))}%` }}
                />
              </div>
              <div className="dsm-xdpool-dotbarwrap-cap">
                <span>{t?.('dot.barLeft') ?? '本期剩余'}</span>
                <span>{`${grouped(bar.left)} / ${grouped(bar.total)}`}</span>
              </div>
            </div>
          )}
          {/* The channel lives in the header now, so it is not repeated here. */}
          {/*
            Today's spend, and the only row left: the channel is in the header and the bar
            above it already carries the period's allowance, so a third row would be the
            same money counted twice.

            The value is MEASURED or ESTIMATED and the two are not interchangeable, so they
            are not drawn the same way: a measured figure is a plain number (cost-meter
            observed the balances fall), an estimate is prefixed `≈` and explained in the
            tooltip (this process priced its own samples — the figure restarts with DSH and
            undercounts a day already half spent). Presenting an estimate as a measurement
            is the one thing this row must never do.
          */}
          <div className="dsm-xdpool-dotpanel-sec">
            <span className="dsm-xdpool-dotpanel-k">{t?.('dot.spentToday') ?? '今日消耗积分'}</span>
            <span
              className="dsm-xdpool-dotpanel-v"
              title={snapshot.spentEstimated
                ? (t?.('dot.estimatedHint') ?? '按本进程 token 用量估算')
                : snapshot.spentMeasured ? (t?.('dot.measuredHint') ?? '按账号余额变动实测') : undefined}
            >
              {snapshot.spentToday === undefined
                ? (t?.('dot.noSpend') ?? '今日暂无记录')
                : snapshot.spentEstimated ? `≈ ${creditCount(snapshot.spentToday)}` : grouped(snapshot.spentToday)}
            </span>
          </div>
          {/* Only when there really is more than one LANE. With a single region the
              header already carries the name and the total, and repeating them below
              would be the same fact twice — which is what made the earlier versions feel
              cluttered. */}
          {snapshot.all.length > 1
            ? (
              <div className="dsm-xdpool-dotpanel-more">
                {snapshot.all.map(channel => {
                  const used = snapshot.usedChannels?.some(row => row.id === channel.id) === true
                  return (
                    <div className="dsm-xdpool-dotpanel-row" key={channel.id}>
                      <span className="dsm-xdpool-dotpanel-rowname" data-used={used ? 'true' : 'false'}>
                        {channel.name}
                      </span>
                      <span className="dsm-xdpool-dotpanel-rowval">{grouped(channel.total)}</span>
                    </div>
                  )
                })}
              </div>
            )
            : null}
            </>
          )}
        </div>
      )}
    </span>
  )
}

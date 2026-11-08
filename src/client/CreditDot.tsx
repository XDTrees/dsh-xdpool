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
 * The channel that serves the model the composer currently has selected. That is read
 * from the pool status (`selection` / the active account) rather than guessed, because
 * the dot is a claim about the model the user is about to send to; a dot describing some
 * other channel would be worse than no dot.
 *
 * THE PANEL ANSWERS THREE THINGS
 *
 * Remaining credits for that channel, credits used today, and how much of the model is
 * being consumed (its multiplier and the token totals). Those are the three numbers a
 * person checks before starting a long task, and they come from two sources: the balance
 * from the status document, the spend from the token ledger.
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
import { POOL_CREDITS_SPEND_PATH, POOL_STATUS_PATH } from '../status-paths.ts'
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
}

/** Everything the panel renders. */
interface Snapshot {
  /** The channel serving the selected model, when it can be identified. */
  channel: ChannelBalance | undefined
  /** Every channel, for the "and the others" list. */
  all: readonly ChannelBalance[]
  /** Credits used today, summed across channels. */
  spentToday: number | undefined
  /** Requests made today, summed across channels. */
  requestsToday: number | undefined
  /** The model the composer has selected, read from the host's own selection. */
  model: string
  /** Its multiplier, when the catalog publishes one. */
  multiplier: number | undefined
  /** Credits that were available at the START of today, for the progress bar. */
  baseline: number
  /** Channels that actually served a request today, richest first. */
  usedChannels: readonly ChannelBalance[]
}

/** Re-read cadence. A balance moves only when something spends. */
const POLL_MS = 45_000

/** `21887` → `21,887`. */
function grouped(value: number): string {
  return Number.isFinite(value) ? Math.round(value).toLocaleString('en-US') : '0'
}

/** `0.11` → `0.11`, `0` → `0`. Kept exact: a multiplier is a price, not a count. */
function rate(value: number): string {
  return Number.isFinite(value) ? String(value) : '—'
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
  const byRegion = new Map<string, { total: number; accounts: number }>()
  for (const raw of accounts) {
    if (raw === null || typeof raw !== 'object') continue
    const row = raw as Record<string, unknown>
    const credits = row['credits']
    if (credits === null || typeof credits !== 'object') continue
    const total = (credits as Record<string, unknown>)['total']
    if (typeof total !== 'number' || !Number.isFinite(total)) continue
    const domain = typeof row['domain'] === 'string' ? row['domain'] : ''
    const id = regionOfDomain(domain)
    const current = byRegion.get(id) ?? { total: 0, accounts: 0 }
    current.total += total
    current.accounts += 1
    byRegion.set(id, current)
  }
  return [...byRegion.entries()]
    .map(([id, value2]) => ({
      id,
      name: id === 'global' ? 'WorkBuddy 国际版' : 'WorkBuddy 国内版',
      total: value2.total,
      accounts: value2.accounts,
    }))
    .sort((a, b) => b.total - a.total)
}

/**
 * The model the composer currently has selected.
 *
 * WHY THIS READS THE DOM
 *
 * The pool's status document has no "current model" field — only `selection`, which lists
 * the models the user has ENABLED. Reading its first entry always reported `hy4-preview`
 * no matter what was selected, which is the reported bug.
 *
 * The live choice lives in the host's model-selection store, which is owned by the
 * `conversation.input.model` slot's `inject`. A plugin cannot reach that service, but the
 * trigger it renders is right next to this dot and displays exactly the answer we want —
 * `DeepSeek-V4.1-Flash · x0.11 High`. Reading it means the dot and the row can never
 * disagree, which is the whole requirement.
 *
 * The multiplier and effort are stripped off, because only the model id is used: the
 * caption appends them with a middle dot, and they must not end up inside the id.
 *
 * Returns '' when the row is not rendered yet (a fresh session, or the hero screen), and
 * the panel then shows an em dash rather than naming a model it cannot see.
 */
function readSelectedModel(): string {
  if (typeof document === 'undefined') return ''
  // The trigger lives in the composer's own row. Scoped to the composer so a model name
  // in the message transcript cannot be picked up instead.
  const roots = document.querySelectorAll('[data-composer-seat], [data-composer-dock]')
  for (const root of roots) {
    // The model trigger is a button whose caption reads `<model> · x<rate> <effort>`.
    for (const button of root.querySelectorAll('button')) {
      const text = (button.textContent ?? '').trim()
      if (text === '') continue
      // A caption carries the rate suffix; that is what distinguishes the model trigger
      // from the back button or the send button beside it.
      if (!/·\s*x\d/u.test(text)) continue
      const model = text.split('·')[0]?.trim() ?? ''
      if (model !== '') return model
    }
  }
  return ''
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
      const [statusRes, spendRes] = await Promise.all([
        fetch(POOL_STATUS_PATH, { headers: { accept: 'application/json' } }),
        fetch(`${POOL_CREDITS_SPEND_PATH}?days=1`, { headers: { accept: 'application/json' } }).catch(() => undefined),
      ])
      if (!statusRes.ok) throw new Error(String(statusRes.status))
      const status = await statusRes.json() as Record<string, unknown>
      if (!mounted.current) return

      const all = channelsOf(status)
      /**
       * The model the composer is actually on.
       *
       * NOT the first entry of `selection`'s enabled list — that is the set of models the
       * user has ENABLED, in picker order, so reading its first item always reported
       * `hy4-preview` no matter what was selected. The reported symptom was exactly that:
       * the panel said hy4-preview while the composer said DeepSeek-V4.1-Flash.
       *
       * The host keeps the live choice in `localStorage` under the model-selection
       * store; its `current` field is what the composer renders. Reading it is the only
       * way to see the same answer the row shows, because the pool's own status document
       * does not carry a "currently selected" field at all.
       */
      const chosen = readSelectedModel()
      const models = Array.isArray(status['models']) ? status['models'] as Record<string, unknown>[] : []
      const row = chosen === '' ? undefined : models.find(candidate => candidate['id'] === chosen)
      const multiplier = typeof row?.['multiplier'] === 'number' ? row['multiplier'] as number : undefined
      // Which channel serves it: the pool accounts are the same pool regardless of model,
      // so the channel with the most credits is the one a request would land on — that is
      // exactly how `priority` distributes.
      const channel = all[0]

      let spentToday: number | undefined
      let requestsToday: number | undefined
      /** Channel ids that served at least one request today. */
      const activeChannels = new Set<string>()
      if (spendRes !== undefined && spendRes.ok) {
        const spend = await spendRes.json() as { channels?: unknown }
        const rows = Array.isArray(spend.channels) ? spend.channels : []
        let total = 0
        let requests = 0
        let any = false
        for (const raw of rows) {
          if (raw === null || typeof raw !== 'object') continue
          const record = raw as Record<string, unknown>
          const credits = record['credits']
          if (typeof credits === 'number' && Number.isFinite(credits)) { total += credits; any = true }
          const count = record['requests']
          if (typeof count === 'number' && Number.isFinite(count) && count > 0) {
            requests += count
            const id = record['channel']
            if (typeof id === 'string' && id !== '') activeChannels.add(id)
          }
        }
        if (any) spentToday = Math.round(total * 100) / 100
        if (requests > 0) requestsToday = requests
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
       * The bar's denominator: what was available at the start of the period.
       *
       * `remaining + spent` is the only baseline the data supports. The vendor reports a
       * remainder, the ledger reports a flow, and adding them reconstructs the opening
       * balance without inventing an allocation the vendor never published. A remainder
       * that has been topped up mid-period makes the bar conservative, which is the
       * honest direction for a "how much is left" gauge.
       */
      const remaining = channel?.total ?? 0
      const baseline = remaining + (spentToday ?? 0)

      if (!mounted.current) return
      setSnapshot({ channel, all, spentToday, requestsToday, model: chosen, multiplier, baseline, usedChannels })
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
   * Watch the composer's model caption and follow it.
   *
   * The 60s poll is right for a BALANCE (it moves only when something spends) and wrong
   * for the MODEL (it changes the moment the user picks another one). Re-reading the
   * caption on a MutationObserver keeps the panel honest without polling the network:
   * a caption swap is a DOM change, so the observer fires exactly when there is news.
   *
   * Debounced to the next frame so a burst of mutations during a re-render collapses into
   * one read.
   */
  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return undefined
    let scheduled = false
    const sync = (): void => {
      scheduled = false
      if (!mounted.current) return
      const next = readSelectedModel()
      if (next === '') return
      setSnapshot(current => {
        if (current === undefined || current.model === next) return current
        // The multiplier is looked up from the catalog already in the snapshot's channel
        // data; leaving it as-is until the next poll is fine, because it only labels the
        // caption and never enters the arithmetic.
        return { ...current, model: next }
      })
    }
    const observer = new MutationObserver(() => {
      if (scheduled) return
      scheduled = true
      // One frame: a composer re-render mutates several nodes in a row.
      window.requestAnimationFrame(sync)
    })
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    return () => { observer.disconnect() }
  }, [])

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
    const top = above >= margin ? above : box.bottom + 8
    setPos({ top, left })
  }, [open])

  /**
   * Re-measure once the panel has painted.
   *
   * `width: max-content` means the first pass measures a zero-width element: the panel is
   * attached but `pos` is still undefined, so it is laid out at its min-width. Re-running
   * after the content exists is what makes the width follow the text rather than the
   * placeholder. Keyed on the model and the channel so a longer name (a real possibility
   * with a `· 14,031` suffix) triggers a fresh measurement.
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
      const top = above >= margin ? above : box.bottom + 8
      // Skip the write when nothing moved: an identical setState still schedules a render.
      if (current.top === top && current.left === left) return current
      return { top, left }
    })
  }, [open, snapshot?.model, snapshot?.channel?.total, snapshot?.spentToday])

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

  if (failed || snapshot === undefined) return null

  /**
   * Green when the serving channel still has credits, grey when it does not.
   *
   * `total > 0` is the whole test: the pool's own gate already refuses an account at its
   * reserved floor, so a non-zero total is genuinely spendable. A channel that could not
   * be read is grey — the dot must not claim "you are fine" on missing data.
   */
  const alive = snapshot.channel !== undefined && snapshot.channel.total > 0
  const label = alive
    ? (t?.('dot.alive') ?? '还有积分')
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
        title={`${label} · ${snapshot.channel === undefined ? '—' : grouped(snapshot.channel.total)}`}
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
            "which pool, how much", and the rows below only need today's spend and the
            model.

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
          <div className="dsm-xdpool-dotpanel-head">
            <span className="dsm-xdpool-dotpanel-channel">
              {snapshot.all.length === 0
                ? (t?.('dot.channelUnknown') ?? '未连接渠道')
                : `${snapshot.channel?.name ?? ''} · ${grouped(snapshot.all.reduce((sum, row) => sum + row.total, 0))}`}
            </span>
          </div>
          {/* The bar comes first: it is the one element that answers "am I close to the
              edge" without reading any number, which is what makes it worth the space.
              The width is the SPENT share, so a fuller bar means more has been used. */}
          {snapshot.baseline <= 0 ? null : (
            <div className="dsm-xdpool-dotbar" role="img" aria-label={t?.('dot.barLabel') ?? '今日已用占比'}>
              <div
                className="dsm-xdpool-dotbar-fill"
                data-full={snapshot.spentToday !== undefined && snapshot.baseline > 0
                  && (snapshot.spentToday / snapshot.baseline) >= 0.9 ? 'true' : 'false'}
                style={{ width: `${String(Math.min(100, Math.max(0, snapshot.baseline > 0 ? (snapshot.spentToday ?? 0) / snapshot.baseline * 100 : 0)))}%` }}
              />
            </div>
          )}
          {/* The channel lives in the header now, so it is not repeated here. This row
              and the one below are the two things the header does not carry. */}
          <div className="dsm-xdpool-dotpanel-sec">
            <span className="dsm-xdpool-dotpanel-k">{t?.('dot.spentToday') ?? '今日已用'}</span>
            <span className="dsm-xdpool-dotpanel-v">
              {snapshot.spentToday === undefined ? '—' : grouped(snapshot.spentToday)}
            </span>
          </div>
          <div className="dsm-xdpool-dotpanel-sec">
            <span className="dsm-xdpool-dotpanel-k">{t?.('dot.model') ?? '模型'}</span>
            <span className="dsm-xdpool-dotpanel-v">
              {snapshot.model === '' ? '—' : snapshot.model}
              {snapshot.multiplier === undefined ? '' : ` · x${rate(snapshot.multiplier)}`}
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
        </div>
      )}
    </span>
  )
}

/**
 * The card shell: brand bar, page tabs, per-page hero.
 *
 * Everything here is chrome. The pages themselves own their data and their
 * actions, so this module never fetches anything — it is handed the tab list,
 * the current tab and a setter, and it draws.
 *
 * Three decisions worth stating, because they are the ones a rewrite usually
 * gets wrong:
 *
 * 1. **The active page is remembered in `localStorage`.** This card lives
 *    inside the host's Settings dialog, which the user opens to go look at one
 *    specific thing. Forgetting the page on every reopen turns "open Settings"
 *    into "re-orient", and a settings panel you always land at the top of is a
 *    settings panel people stop opening. A missing key (first run, private
 *    window with storage blocked, a quota error) falls back to the first tab
 *    rather than throwing: the shell must render even when storage does not.
 *
 * 2. **The glider tracks the button's real box, on both axes.** It is measured
 *    with `offsetLeft/offsetTop/offsetWidth/offsetHeight` and absolutely
 *    positioned, because the tab strip wraps to a second row in a narrow
 *    settings panel. A `translate` only — the usual choice — lands the
 *    highlight on the correct button at the correct x, in the wrong row.
 *
 * 3. **Nothing here is a gate.** The star button opens the repository in a new
 *    tab and nothing else, and the group button beside it opens a dialog with
 *    the WeChat invite code. A settings card that can refuse to render is a card
 *    that, on a machine without outbound network, looks exactly like a broken
 *    plugin.
 *
 * @module dsh-xdpool/client/shell
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { XdPoolSettingsKey } from './locales.ts'
import { SHARED_CARD_CSS, SHELL_CSS } from './styles.ts'
import { COMMUNITY_QR_DATA_URI } from './community-qr.ts'
/** The translator the settings section injects. */
type Translate = (key: XdPoolSettingsKey, params?: Record<string, unknown>) => string
/** One page in the tab strip. `num` renders the OFM-style corner count. */
export interface ShellTab {
  id: string
  label: string
  num?: number | undefined
}
export interface PoolShellProps {
  t?: Translate | undefined
  /** Plugin version, shown next to the product name. Never a "latest" claim. */
  version?: string | undefined
  /** The user's avatar, as a data URI. */
  avatar: string
  tabs: readonly ShellTab[]
  /** Id of the page on screen. */
  active: string
  onSelect: (id: string) => void
  /**
   * Page header. Every page gets one: the tab label alone does not say what
   * the page is for, and the card's copy is the only place that does.
   */
  hero?: ReactNode | undefined
  children: ReactNode
}
/** localStorage key for the remembered page. */
const SHELL_TAB_KEY = 'xdpool.tab'
/**
 * Read the remembered page, tolerating every way storage can refuse.
 *
 * `getItem` throws in a partitioned third-party context and when cookies are
 * blocked; JSON.parse throws on anything a previous version (or another plugin)
 * wrote under this key. Both mean "start at the beginning", not "fail".
 */
function readRememberedTab(): string | undefined {
  try {
    const raw = window.localStorage.getItem(SHELL_TAB_KEY)
    return raw === null || raw === '' ? undefined : raw
  } catch {
    return undefined
  }
}
function rememberTab(id: string): void {
  try {
    window.localStorage.setItem(SHELL_TAB_KEY, id)
  } catch {
    // A failed write costs the user their place on the next reopen. Nothing
    // else, so it is not worth a console warning on every click.
  }
}
/** A single statistic above the usage tables. */
export function KpiCard({
  label,
  value,
  sub,
}: {
  label: string
  /** Pre-formatted. The caller owns the formatting so a missing measurement can say so. */
  value: string
  sub?: string | undefined
}) {
  return (
    <div className="dsm-xdpool-kpi dsm-xdpool-glass">
      <span className="dsm-xdpool-kpi-label">{label}</span>
      <span className="dsm-xdpool-kpi-value">{value}</span>
      <span className="dsm-xdpool-kpi-sub">{sub ?? ''}</span>
    </div>
  )
}
/**
 * A page's own header: title, one line of "what is this for", and whatever
 * pills or actions the page needs on the right.
 *
 * The actions slot is page-owned. The pool page re-detects accounts, the
 * channels page opens a login window, and neither belongs in the brand bar
 * above the tabs, where they would apply to whichever page you are not on.
 */
export function PageHero({
  title,
  sub,
  actions,
  pills,
}: {
  title: string
  sub?: string | undefined
  actions?: ReactNode | undefined
  pills?: ReactNode | undefined
}) {
  return (
    <div className="dsm-xdpool-hero dsm-xdpool-glass">
      <div className="dsm-xdpool-pagehead">
        <span className="dsm-xdpool-pagecopy">
          <h2 className="dsm-xdpool-pagetitle">{title}</h2>
          {sub === undefined || sub === '' ? null : <p className="dsm-xdpool-pagesub">{sub}</p>}
        </span>
        {pills === undefined ? null : <div className="dsm-xdpool-pills">{pills}</div>}
        {actions === undefined ? null : <div className="dsm-xdpool-pageactions">{actions}</div>}
      </div>
    </div>
  )
}
/**
 * Brand bar + tab strip + page body.
 *
 * The remembered tab is resolved once on mount and then owned by the caller:
 * after that the parent is the only thing allowed to move the selection, so a
 * `storage` event from another window cannot fight a click in this one.
 */
export function PoolShell({
  t,
  version,
  avatar,
  tabs,
  active,
  onSelect,
  hero,
  children,
}: PoolShellProps) {
  /** Measured box of the active tab's button, in tab-strip coordinates. */
  const [glider, setGlider] = useState<{ left: number; top: number; width: number; height: number } | undefined>(undefined)
  /** Whether the group-invite dialog is open. Local: nothing outside needs it. */
  const [groupOpen, setGroupOpen] = useState(false)
  /**
   * Close the dialog on Escape.
   *
   * The overlay's own click handler covers the pointer, but a keyboard user who
   * opened this with Enter has no other way out — and a modal with no key exit
   * is a trap. Bound only while open, so the listener is not paid for on every
   * page of a card that is mostly not showing a dialog.
   */
  useEffect(() => {
    if (!groupOpen) return undefined
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setGroupOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [groupOpen])
  const tabRefs = useRef(new Map<string, HTMLButtonElement | null>())
  const tabsRef = useRef<HTMLDivElement | null>(null)
  const measure = useCallback((): void => {
    const strip = tabsRef.current
    const button = tabRefs.current.get(active)
    // A tab that has never been rendered (the caller switched to an id the
    // list does not carry) has no box to copy; leaving the previous glider
    // would highlight a page that is no longer on screen.
    if (strip === null || button === null || button === undefined) {
      setGlider(undefined)
      return
    }
    setGlider({
      left: button.offsetLeft,
      top: button.offsetTop,
      width: button.offsetWidth,
      height: button.offsetHeight,
    })
  }, [active])
  // Layout effect, not effect: the glider must not be painted at its default
  // position for one frame on every tab change.
  useLayoutEffect(measure, [measure, tabs])
  useEffect(() => {
    window.addEventListener('resize', measure)
    return () => { window.removeEventListener('resize', measure) }
  }, [measure])
  const select = useCallback((id: string): void => {
    rememberTab(id)
    onSelect(id)
  }, [onSelect])
  return (
    <div className="dsm-xdpool-shell">
      {/*
        Two sheets, in this order. Every page injects its own stylesheet from
        inside this shell, so the shared primitives have to be declared here —
        and first — or the page's own block would lose to them on equal
        specificity. The shell is the only component every page renders inside,
        which is what makes it the one place a shared rule can live.
      */}
      <style>{SHARED_CARD_CSS}</style>
      <style>{SHELL_CSS}</style>
      <div className="dsm-xdpool-aurora" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <nav className="dsm-xdpool-nav">
        <div className="dsm-xdpool-brand">
          <img className="dsm-xdpool-avatar" src={avatar} alt="" />
          <span className="dsm-xdpool-brand-copy">
            <span className="dsm-xdpool-brand-title">
              {t?.('shell.brand') ?? 'XD Pool'}
              {version === undefined || version === ''
                ? null
                : <span className="dsm-xdpool-version">v{version}</span>}
            </span>
          </span>
        </div>
        <a
          className="dsm-xdpool-star"
          href="https://github.com/XDTrees/dsh-xdpool"
          target="_blank"
          rel="noreferrer"
          title={t?.('shell.starHint') ?? 'Open this plugin on GitHub'}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path
              fill="currentColor"
              d="M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3-5.8 3 1.1-6.5L2.6 9.4l6.5-.9z"
            />
          </svg>
          <span>{t?.('shell.star') ?? 'Star on GitHub'}</span>
        </a>
        {/*
          The group invite, next to the star and in the same slot.
          
          A `<button>`, not an `<a>`: this opens a dialog in place. Sending the
          user to an external page to look at a picture is worse than showing
          the picture — a WeChat group code has to be scanned from the screen
          it is displayed on, and a new tab steals focus from the very device
          doing the scanning.
        */}
        <button
          type="button"
          className="dsm-xdpool-star dsm-xdpool-group"
          title={t?.('shell.groupHint') ?? '扫码加入 XD 交流群'}
          onClick={() => { setGroupOpen(true) }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            {/* Two overlapping speech bubbles: the WeChat-group read at 15px,
                without copying the trademark's exact silhouette. */}
            <path
              fill="currentColor"
              d="M9.1 3.4c-3.6 0-6.5 2.4-6.5 5.4 0 1.7 1 3.2 2.6 4.2l-.7 2.1 2.4-1.2c.7.2 1.4.3 2.2.3h.4a5.6 5.6 0 0 1-.2-1.5c0-3 2.9-5.4 6.5-5.4h.5C15.7 5.1 12.7 3.4 9.1 3.4zm-2.3 2.9a.9.9 0 1 1 0 1.8.9.9 0 0 1 0-1.8zm4.6 0a.9.9 0 1 1 0 1.8.9.9 0 0 1 0-1.8z"
            />
            <path
              fill="currentColor"
              d="M21.4 12.7c0-2.5-2.4-4.5-5.4-4.5s-5.4 2-5.4 4.5 2.4 4.5 5.4 4.5c.6 0 1.2-.1 1.8-.2l2 1-.6-1.7c1.4-.9 2.2-2.2 2.2-3.6zm-7.2-1.4a.8.8 0 1 1 0 1.6.8.8 0 0 1 0-1.6zm3.6 0a.8.8 0 1 1 0 1.6.8.8 0 0 1 0-1.6z"
            />
          </svg>
          <span>{t?.('shell.group') ?? '交流群'}</span>
        </button>
        <div className="dsm-xdpool-navtabs" role="tablist" ref={tabsRef}>
          {glider === undefined ? null
            : <span
                className="dsm-xdpool-navglider"
                style={{
                  transform: `translate(${String(glider.left)}px, ${String(glider.top)}px)`,
                  width: `${String(glider.width)}px`,
                  height: `${String(glider.height)}px`,
                }}
              />}
          {tabs.map(tab => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={tab.id === active}
              ref={(element) => { tabRefs.current.set(tab.id, element) }}
              className={`dsm-xdpool-navtab${tab.id === active ? ' dsm-xdpool-navtab-on' : ''}`}
              onClick={() => { select(tab.id) }}
            >
              {tab.label}
              {tab.num === undefined ? null : <span className="dsm-xdpool-navtabnum">{tab.num}</span>}
            </button>
          ))}
        </div>
      </nav>
      {hero === undefined ? null : hero}
      <div className="dsm-xdpool-body">{children}</div>
      {/*
        The group invite, as a dialog over the card rather than a new tab.

        Rendered last and inside the shell so it is positioned against the card
        (`.dsm-xdpool-shell` is the containing block), which keeps it off the
        host dialog's own chrome. The overlay swallows clicks on itself only —
        the panel stops propagation — so clicking the dim area closes and
        clicking the code does not.
      */}
      {!groupOpen ? null : (
        <div
          className="dsm-xdpool-groupmask"
          role="dialog"
          aria-modal="true"
          aria-label={t?.('shell.groupTitle') ?? 'XD 交流群'}
          onClick={() => { setGroupOpen(false) }}
        >
          <div className="dsm-xdpool-groupcard" onClick={(event) => { event.stopPropagation() }}>
            <div className="dsm-xdpool-groupcardhead">
              <b>{t?.('shell.groupTitle') ?? 'XD 交流群'}</b>
              <button
                type="button"
                className="dsm-xdpool-groupclose"
                aria-label={t?.('shell.groupClose') ?? '关闭'}
                onClick={() => { setGroupOpen(false) }}
              >
                ×
              </button>
            </div>
            {/*
              `alt` carries the instruction, not a description: someone using a
              screen reader cannot scan a code, so the honest thing to say is
              what the code is for and that it expires.
            */}
            <img
              className="dsm-xdpool-groupqr"
              src={COMMUNITY_QR_DATA_URI}
              alt={t?.('shell.groupAlt') ?? '微信群二维码：用微信扫一扫加入 XD 交流群'}
              width={260}
              height={260}
            />
            <p className="dsm-xdpool-groupnote">
              {t?.('shell.groupNote')
                ?? '用微信「扫一扫」加入 XD 交流群。二维码 7 天内有效，过期了在 GitHub 提 issue 说一声，会更新。'}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
/**
 * Pick the initial page from a remembered id, the tab list and a fallback.
 *
 * Exported so the parent can run exactly the same check while hydrating: a
 * remembered id that this build no longer carries must land on the first tab
 * instead of rendering a page whose component does not exist.
 */
export function initialShellTab(remembered: string | undefined, tabs: readonly ShellTab[]): string {
  const first = tabs[0]?.id
  if (first === undefined) return ''
  return remembered !== undefined && tabs.some(tab => tab.id === remembered) ? remembered : first
}
/** Read the remembered page id, tolerating storage being unavailable. */
export function rememberedShellTab(): string | undefined {
  return typeof window === 'undefined' ? undefined : readRememberedTab()
}
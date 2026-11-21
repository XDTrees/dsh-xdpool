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
import { COMMUNITY_QR_QQ, COMMUNITY_QR_WECHAT } from './community-qr.ts'
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
    <div className="sum-cell dsm-xdpool-glass">
      <span className="sum-k">{label}</span>
      <span className="sum-v">{value}</span>
      <span className="sum-sub">{sub ?? ''}</span>
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
    <div >
      <div className="mhead">
        <span className="mhead-title">
          <h2 className="mhead-name">{title}</h2>
          {sub === undefined || sub === '' ? null : <p className="mhead-org">{sub}</p>}
        </span>
        {pills === undefined ? null : <div className="chip">{pills}</div>}
        {actions === undefined ? null : <div className="mhead-actions">{actions}</div>}
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
  return (
    <div className="app">
      <nav className="rail" aria-label={t?.('shell.tabs') ?? 'Pages'} ref={railRef} onKeyDown={onKeyDown}>
        {brand}
        {tabs.map(tab => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={tab.id === active}
            className="rail-item"
            onClick={() => { onSelect(tab.id) }}
          >
            {RAIL_ICONS[tab.id as RailIconName] === undefined ? null : (
              <RailIcon name={tab.id as RailIconName} />
            )}
            <span>{tab.label}</span>
          </button>
        ))}
        <div className="rail-foot">
          <a className="rail-item" href="https://github.com/XDTrees/dsh-xdpool" target="_blank" rel="noreferrer"
            title={t?.('shell.starHint') ?? 'Open this plugin on GitHub'}>
            <RailIcon name="star" />
            <span>{t?.('shell.star') ?? '点 Star'}</span>
          </a>
          <button type="button" className="rail-item"
            title={t?.('shell.groupHint') ?? '扫码加入 XD 交流群'}
            onClick={() => { setGroupOpen(true) }}>
            <RailIcon name="group" />
            <span>{t?.('shell.group') ?? '交流群'}</span>
          </button>
          {links}
        </div>
        {updateOpen ? (
          <div className="pop" role="dialog" aria-label={t?.('update.title') ?? '检查更新'}>
            <div className="pop-head">
              <span className="pop-name">{t?.('update.title') ?? '检查更新'}</span>
              <button type="button" className="pop-close"
                aria-label={t?.('common.close') ?? '关闭'}
                onClick={() => { setUpdateOpen(false) }}>×</button>
            </div>
            <UpdatePanel t={t} />
          </div>
        ) : null}
      </nav>

      {!groupOpen ? null : (
        <div className="pop" role="dialog" aria-modal="false"
          aria-label={t?.('shell.groupTitle') ?? 'XD 交流群'}>
          <div className="pop-head">
            <span className="pop-name">{t?.('shell.groupTitle') ?? 'XD 交流群'}</span>
            <button type="button" className="pop-close"
              aria-label={t?.('shell.groupClose') ?? '关闭'}
              onClick={() => { setGroupOpen(false) }}>×</button>
          </div>
          <div className="qr-grid">
            <div className="qr-item">
              <div className="qr" />
              <span className="qr-label">{t?.('shell.groupWx') ?? '微信群'}</span>
              <span className="qr-step">{t?.('shell.groupWxStep') ?? '扫码添加机器人后发送「XD」拉你进群'}</span>
            </div>
            <div className="qr-item">
              <div className="qr" />
              <span className="qr-label">{t?.('shell.groupQq') ?? 'QQ 群'}</span>
              <span className="qr-step">{t?.('shell.groupQqStep') ?? '直接扫码即可加入'}</span>
            </div>
          </div>
          <p className="note">
            {t?.('shell.groupNote') ?? '两个群都在；哪个方便用哪个。'}
          </p>
        </div>
      )}

      {/*
        .app 的直接子元素必须正好是 rail / list / main。这一层 display:contents
        不参与布局，只承载 dsm-xdpool-body 这个测试锚点。
      */}
      {hero === undefined ? null : hero}
      <div className="dsm-xdpool-body" style={{ display: 'contents' }}>{children}</div>
      {footer}
    </div>
  )
}
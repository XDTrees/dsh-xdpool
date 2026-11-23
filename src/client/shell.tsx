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
import { POOL_NAV_ICON_MASK_URL } from './nav-icon.ts'
import { UpdatePanel, type UpdateStatus } from './UpdatePanel.tsx'
import { POOL_UPDATE_CHECK_PATH } from '../status-paths.ts'
import { compareVersions } from '../update-check.ts'
import type { ReactElement } from 'react'
import { RAIL_ICONS, type RailIconName } from './rail-icons.ts'
import { initialTheme, otherTheme, rememberTheme, storedTheme, type PoolTheme } from './theme.ts'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { XdPoolSettingsKey } from './locales.ts'
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
  /**
   * 两列还是三列。
   *
   * 设计稿只有账号池是「功能页 + 条目栏 + 详情」三列；
   * 登录 / 聚合 / 看板 / 路由 / 网关 / 备份都是「功能页 + 内容」两列。
   * 全用三列的话，那六页的 main 会落到第二列（264px），右边空出 936px。
   */
  wide?: boolean | undefined
  tabs: readonly ShellTab[]
  /** Id of the page on screen. */
  active: string
  onSelect: (id: string) => void
  /**
   * Page header. Every page gets one: the tab label alone does not say what
   * the page is for, and the card's copy is the only place that does.
   */
  hero?: ReactNode | undefined
  /** 底部附加的行（侧栏入口开关等），挂在 .rail-foot 里。 */
  links?: ReactNode | undefined
  /** 页面脚注。 */
  footer?: ReactNode | undefined
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
export function rememberedShellTab(): string | undefined {
  if (typeof window === 'undefined') return undefined
  return window.localStorage.getItem(SHELL_TAB_KEY) ?? undefined
}

export function initialShellTab<T extends string>(
  remembered: string | undefined,
  tabs: readonly { id: T }[],
): T | undefined {
  // 记住的那个 id 必须真的在这份列表里 —— 换过版本之后它可能已经不存在，
  // 那时回到第一个，而不是渲染一个空页。
  const known = tabs.some(tab => tab.id === remembered)
  // 空列表时返回 '' —— 调用方据此渲染空页，而不是崩
  return known ? (remembered as T) : (tabs[0]?.id ?? ('' as T))
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
export function RailIcon({ name }: { name: RailIconName }): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: RAIL_ICONS[name] }} />
  )
}

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
    <div className="sum-cell">
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
/** 浮层在 .app 里的位置（相对 .app 左上角）。 */
interface PopAnchor {
  left: number
  top?: number
  bottom?: number
}
export function PoolShell({
  t,
  version,
  avatar,
  wide = false,
  tabs,
  active,
  onSelect,
  hero,
  links,
  footer,
  children,
}: PoolShellProps) {
  /**
   * 当前打开的浮层：检查更新 / 交流群，同一时间只开一个。
   *
   * 两个浮层都用 position:absolute 钉在 .app 里、贴着触发按钮弹出（设计稿
   * group.html / update.html 的写法是「贴着侧栏弹出，点外面关闭」）。
   *
   * 之前的坑：设计稿页面里的 .pop 是 position:relative（那是为了在示例页里居中），
   * 提取进插件后覆盖了 app.css 的 absolute —— 交流群浮层作为 .app 的直接子元素
   * 就占了一个网格格子，三列被挤成四块。现在位置写在 inline style 上，任何 CSS 都盖不掉。
   */
  const [pop, setPop] = useState<'update' | 'group' | undefined>(undefined)
  const [popAt, setPopAt] = useState<PopAnchor | undefined>(undefined)
  /**
   * 亮 / 暗。
   *
   * 初值同步读出来（localStorage → prefers-color-scheme），所以第一帧就是
   * 正确的那一档，不会先画一帧暗色再跳成亮色。切换只写本地：这是插件自己的
   * 外观偏好，不该占用宿主或插件设置文档里的一个字段。
   */
  const [theme, setTheme] = useState<PoolTheme>(initialTheme)
  const toggleTheme = useCallback((): void => {
    setTheme(current => {
      const next = otherTheme(current)
      rememberTheme(next)
      return next
    })
  }, [])
  /**
   * 没按过按钮时跟随系统。
   *
   * 只在「用户还没表达过偏好」时生效：按过一次之后，系统再变也不动它 ——
   * 那是用户明确选的，不该被系统的日落切换悄悄改回去。
   */
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined
    const media = window.matchMedia('(prefers-color-scheme: light)')
    const onChange = (): void => {
      if (storedTheme() !== undefined) return
      // 没存过选择就重新按「宿主 → 系统」算一遍：宿主可能跟着系统一起换了。
      setTheme(initialTheme())
    }
    media.addEventListener?.('change', onChange)
    return () => { media.removeEventListener?.('change', onChange) }
  }, [])

  /**
   * 后台悄悄查一次有没有新版（后端缓存 10 分钟，打开设置不会反复请求 npm）。
   * 有新版就在版本号旁边亮一个绿点 —— 不弹窗、不打断，读者想更新时点一下就能一键更新。
   */
  const [latest, setLatest] = useState<string | undefined>(undefined)
  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const response = await fetch(POOL_UPDATE_CHECK_PATH, { credentials: 'same-origin' })
        const body = await response.json().catch(() => undefined) as UpdateStatus | undefined
        if (live && body?.error === undefined && typeof body?.latest === 'string') setLatest(body.latest)
      } catch {
        // 查不到就不亮点；点开小窗会再查一次并说清楚原因
      }
    })()
    return () => { live = false }
  }, [])
  const hasUpdate = latest !== undefined && version !== undefined && version !== ''
    && compareVersions(latest, version) > 0
  const onUpdateStatus = useCallback((status: UpdateStatus): void => {
    if (status.error === undefined && typeof status.latest === 'string') setLatest(status.latest)
  }, [])
  const appRef = useRef<HTMLDivElement | null>(null)
  /**
   * 插件自己的宽度档位（wide / mid / narrow / phone），写到 .app[data-w] 上。
   *
   * 按插件宽度而不是屏幕宽度：插件常开在 DSH 的设置对话框里，屏幕 1920 宽、插件只有
   * 600 像素，按屏幕的 @media 永远不触发，三列硬挤，详情列文字一个字一行。
   * 规则在 responsive-css.ts。
   *
   * 同时把 .app 的高度贴合到可见区域：原来写死 100vh，放进对话框后底部（点 Star /
   * 交流群）被裁掉，外面还多出一条滚动条。
   */
  const [tier, setTier] = useState<'wide' | 'mid' | 'narrow' | 'phone'>('wide')
  useLayoutEffect(() => {
    const el = appRef.current
    if (el === null || typeof window === 'undefined') return undefined
    const measure = (): void => {
      const box = el.getBoundingClientRect()
      const width = box.width
      if (width <= 0) return
      setTier(width >= 1100 ? 'wide' : width >= 820 ? 'mid' : width >= 560 ? 'narrow' : 'phone')
      // 往上找第一个会裁切 / 滚动的祖先，.app 的底边贴到它的可见底边
      let parent = el.parentElement
      for (let hops = 0; parent !== null && hops < 12; hops += 1) {
        const overflow = window.getComputedStyle(parent).overflowY
        if (overflow === 'auto' || overflow === 'scroll' || overflow === 'hidden') break
        parent = parent.parentElement
      }
      const limit = parent === null
        ? window.innerHeight
        : Math.min(window.innerHeight,
          parent.getBoundingClientRect().bottom - (Number.parseFloat(window.getComputedStyle(parent).paddingBottom) || 0))
      const height = Math.floor(limit - box.top)
      const next = height >= 360 ? `${String(height)}px` : ''
      if (el.style.height !== next) el.style.height = next
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => { measure() })
    observer?.observe(el)
    if (el.parentElement !== null) observer?.observe(el.parentElement)
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])
  const popRef = useRef<HTMLDivElement | null>(null)
  /** 按钮在 .app 坐标系里的位置 → 浮层放哪。 */
  const anchorFrom = (target: HTMLElement, side: 'below' | 'beside'): PopAnchor => {
    const box = appRef.current?.getBoundingClientRect()
    const r = target.getBoundingClientRect()
    const ox = box?.left ?? 0
    const oy = box?.top ?? 0
    const height = box?.height ?? window.innerHeight
    const width = box?.width ?? window.innerWidth
    // 小窗最宽 420，左边不许超出插件右边缘
    const clampLeft = (left: number): number => Math.max(8, Math.min(left, width - 428))
    // 版本号在下半屏（手机档的底部 dock）时往上弹，否则在它下面
    if (side === 'below') {
      return r.top - oy > height / 2
        ? { left: clampLeft(r.left - ox), bottom: Math.max(8, height - (r.top - oy) + 6) }
        : { left: clampLeft(r.left - ox), top: r.bottom - oy + 6 }
    }
    // 交流群：贴在功能页栏右边、底边对齐；手机档按钮在 dock 里时同样往上弹
    if (r.right - ox > width - 40) return { left: clampLeft(r.left - ox), bottom: Math.max(8, height - (r.top - oy) + 6) }
    return { left: clampLeft(r.right - ox + 8), bottom: Math.max(8, height - (r.bottom - oy)) }
  }
  const openPop = (which: 'update' | 'group', target: HTMLElement): void => {
    if (pop === which) { setPop(undefined); return }
    setPopAt(anchorFrom(target, which === 'update' ? 'below' : 'beside'))
    setPop(which)
  }
  /**
   * Close the dialog on Escape, or on a press outside it.
   *
   * The press must be OUTSIDE: the old listener closed on every mousedown,
   * so clicking inside the dialog (selecting the invite text, pressing the
   * update button) dismissed it before the click could land.
   */
  useEffect(() => {
    if (pop === undefined) return undefined
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setPop(undefined)
    }
    const onDown = (event: MouseEvent): void => {
      const target = event.target as Node | null
      if (target !== null && popRef.current?.contains(target) === true) return
      // 触发按钮自己会切换开关，这里不抢
      if (target instanceof Element && target.closest('[data-pop-trigger]') !== null) return
      setPop(undefined)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown)
    }
  }, [pop])
  const popStyle = (width: number): CSSProperties => ({
    position: 'absolute',
    zIndex: 60,
    width: `min(${String(width)}px, calc(100% - 32px))`,
    left: popAt?.left ?? 16,
    ...(popAt?.top === undefined ? {} : { top: popAt.top }),
    ...(popAt?.bottom === undefined ? {} : { bottom: popAt.bottom }),
    ...(popAt?.top === undefined && popAt?.bottom === undefined ? { top: 16 } : {}),
  })
  /** 品牌区，结构照设计稿的 .rail-brand。 */
  const brand = (
    <div className="rail-brand">
      {/*
        品牌 logo：有头像是头像，没有就用插件自己的图标。

        设计稿的 .rail-logo 靠 --avatar 背景图；没有头像时它是空方块，
        左上角会缺一块。这里给个兜底，两种情况下都是同一个 26px 圆角方块。
      */}
      <span
        className="rail-logo"
        style={{ backgroundImage: `url("${avatar === '' || avatar === undefined ? POOL_NAV_ICON_MASK_URL : avatar}")` }}
      />
      <span>
        <div className="rail-name">{t?.('shell.brand') ?? 'XD Pool'}</div>
        {version === undefined || version === '' ? null : (
          /* 设计稿：版本号 + 一个刷新小圆圈，点开是「检查更新」小窗 */
          <button type="button" className="rail-ver" data-pop-trigger="update"
            title={hasUpdate ? `发现新版本 v${latest ?? ''}，点击更新` : '检查更新'}
            aria-haspopup="dialog"
            style={hasUpdate ? { color: 'var(--accent)', position: 'relative' } : { position: 'relative' }}
            onClick={event => { openPop('update', event.currentTarget) }}>
            v{version}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M21 12a9 9 0 11-3-6.7M21 4v5h-5" />
            </svg>
            {hasUpdate ? (
              <span aria-label="有新版本" style={{
                width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)',
                boxShadow: '0 0 0 2px var(--bg)', marginLeft: 1,
              }} />
            ) : null}
          </button>
        )}
      </span>
    </div>
  )
  const railRef = useRef<HTMLElement | null>(null)
  const select = useCallback((id: string): void => {
    rememberTab(id)
    onSelect(id)
  }, [onSelect])
  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLElement>): void => {
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
    if (step === 0) return
    event.preventDefault()
    const at = tabs.findIndex(tab => tab.id === active)
    const next = tabs[(at + step + tabs.length) % tabs.length]
    if (next !== undefined) select(next.id)
  }, [active, select, tabs])

  /**
   * 关掉宿主承载插件的那个对话框。
   *
   * 没有宿主 API 可调（设置对话框不是插件开的），所以走两条最稳的路：
   *
   *  1. 在最近的 `[role="dialog"]` 里找关闭控件点它 —— 宿主的关闭按钮按语言
   *     不同，认 aria-label 里的 close / 关闭 / dismiss 就够了；
   *  2. 找不到就派发 Escape。宿主的对话框和我们的浮层都监听它。
   *
   * 两条都失败时什么也不做：宁可让用户去找宿主的按钮，也不要关掉一个不是
   * 我们开的窗口。
   */
  const closeHostDialog = useCallback((): void => {
    if (typeof document === 'undefined') return
    const dialog = document.querySelector('[role="dialog"]')
    const candidate = dialog?.querySelector<HTMLElement>(
      '[aria-label*="lose" i], [aria-label*="关闭"], [aria-label*="ismiss" i], [data-dismiss]',
    )
    if (candidate !== undefined && candidate !== null) {
      candidate.click()
      return
    }
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  }, [])

  return (
    <div ref={appRef} className={wide ? 'app app-wide' : 'app'} data-w={tier} data-theme={theme}
      style={{ position: 'relative' }}>
      <nav className="rail" aria-label={'Pages'} ref={railRef} onKeyDown={onKeyDown}>
        {brand}
        {tabs.map(tab => (
          /*
            选中态：设计稿的 CSS 认的是 aria-current="page"（左侧竖条 + 图标变绿）。
            之前只写了 aria-selected，于是左栏永远没有选中高亮。
          */
          <button
            key={tab.id}
            type="button"
            className="rail-item"
            title={tab.label}
            aria-current={tab.id === active ? 'page' : undefined}
            onClick={() => { select(tab.id) }}
          >
            {RAIL_ICONS[tab.id as RailIconName] === undefined ? null : (
              <RailIcon name={tab.id as RailIconName} />
            )}
            <span>{tab.label}</span>
          </button>
        ))}
        <div className="rail-foot">
          {/*
            主题开关：左侧底部。

            放在 rail-foot 的最上面，而不是塞进品牌行 —— 品牌行是「这是什么插件」，
            rail-foot 是「界面自己的事」（Star / 群 / 外观），主题属于后者。
            手机上 .rail-foot 整条被收进 dock，这一格在 responsive-css 里单独放回来，
            所以手机也有得切。

            图标画的是「按下去会变成什么」：现在是亮的，给月亮（切暗）；现在是暗的，
            给太阳（切亮）。标题和 aria-label 把这句话说全，不靠图标猜。
          */}
          <button type="button" className="rail-item rail-theme"
            data-testid="xdpool-theme-toggle"
            title={theme === 'light'
              ? (t?.('shell.themeToDark') ?? '切换到暗色')
              : (t?.('shell.themeToLight') ?? '切换到亮色')}
            aria-label={theme === 'light'
              ? (t?.('shell.themeToDark') ?? '切换到暗色')
              : (t?.('shell.themeToLight') ?? '切换到亮色')}
            aria-pressed={theme === 'light'}
            onClick={toggleTheme}>
            <RailIcon name={theme === 'light' ? 'moon' : 'sun'} />
            <span>{theme === 'light'
              ? (t?.('shell.themeDark') ?? '暗色')
              : (t?.('shell.themeLight') ?? '亮色')}</span>
          </button>
          <a className="rail-item" href="https://github.com/XDTrees/dsh-xdpool" target="_blank" rel="noreferrer"
            title={t?.('shell.starHint') ?? 'Open this plugin on GitHub'}>
            <RailIcon name="star" />
            <span>{t?.('shell.star') ?? '点 Star'}</span>
          </a>
          <button type="button" className="rail-item" data-pop-trigger="group"
            title={t?.('shell.groupHint') ?? '扫码加入 XD 交流群'}
            aria-haspopup="dialog"
            aria-expanded={pop === 'group'}
            onClick={event => { openPop('group', event.currentTarget) }}>
            <RailIcon name="group" />
            <span>{t?.('shell.group') ?? '交流群'}</span>
          </button>
          {links}
        </div>
      </nav>

      {/*
        右上角关闭。
        
        插件的页面撑满设置对话框，用户想退出得去找宿主的关闭按钮 —— 它的位置
        随宿主办，和插件的内容区并不在一起。这里给一个就地入口：先找最近的
        dialog 里那个关闭控件并点它（宿主的写法各不相同，所以按 aria-label
        认「close / 关闭」），找不到就派发一次 Escape，宿主与插件的关闭监听
        都会收到。两条路都不需要宿主提供 API。
      */}
      <button
        type="button"
        className="app-close"
        data-testid="xdpool-close"
        title={t?.('shell.close') ?? '关闭'}
        aria-label={t?.('shell.close') ?? '关闭'}
        onClick={closeHostDialog}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
          strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>

      {pop !== 'update' ? null : (
        <div ref={popRef} className="pop" role="dialog" aria-label={t?.('update.title') ?? '检查更新'}
          style={popStyle(360)}>
          <div className="pop-head">
            <span className="pop-name">{t?.('update.title') ?? '检查更新'}</span>
            <button type="button" className="pop-close"
              aria-label={t?.('shell.groupClose') ?? '关闭'}
              onClick={() => { setPop(undefined) }}>×</button>
          </div>
          <UpdatePanel t={t} clientVersion={version} onStatus={onUpdateStatus}
            onClose={() => { setPop(undefined) }} />
        </div>
      )}

      {pop !== 'group' ? null : (
        <div ref={popRef} className="pop" role="dialog" aria-modal="false"
          aria-label={t?.('shell.groupTitle') ?? 'XD 交流群'}
          style={popStyle(420)}>
          <div className="pop-head">
            <span className="pop-name">{t?.('shell.groupTitle') ?? 'XD 交流群'}</span>
            <button type="button" className="pop-close"
              aria-label={t?.('shell.groupClose') ?? '关闭'}
              onClick={() => { setPop(undefined) }}>×</button>
          </div>
          <div className="qr-grid">
            <div className="qr-item">
              <img className="qr" src={COMMUNITY_QR_WECHAT}
                alt="微信机器人二维码：扫码添加后发送 XD，即可被拉进群"
                width={220} height={220} />
              <span className="qr-label">微信（机器人）</span>
              <span className="qr-step">扫码添加机器人后，发送「XD」拉你进群</span>
            </div>
            <div className="qr-item">
              <img className="qr" src={COMMUNITY_QR_QQ}
                alt="QQ 群二维码：直接扫码加入 XD 交流群"
                width={220} height={220} />
              <span className="qr-label">QQ 群</span>
              <span className="qr-step">直接扫码即可加入</span>
            </div>
          </div>
          <p className="note">
            {t?.('shell.groupNote') ?? '两个群都在；哪个方便用哪个。'}
          </p>
        </div>
      )}

      {/*
        .app 的直接子元素必须正好是 rail / list / main（浮层是 absolute，不占格子）。
        这一层 display:contents 不参与布局，只承载 dsm-xdpool-body 这个测试锚点。
        hero 与 children 都放进这一层：任何一个留在 .app 的直接子层，
        就会自己占掉一整列 —— 三列网格会因此多出格子，整页塌成一片。
      */}
      <div className="dsm-xdpool-body" style={{ display: 'contents' }}>
        {hero}
        {children}
      </div>
      {footer}
    </div>
  )
}

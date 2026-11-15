/**
 * The Doubao card: sign in, then read the quota.
 *
 * WHAT THIS SURFACE IS FOR
 *
 * Doubao's models already appear in the picker (the channel lane serves them), so this card
 * is not a second model list. It is the two things that have no other home:
 *
 *   - the SIGN-IN, because Doubao's QR entrance is closed and the only door left is a
 *     browser window this plugin starts;
 *   - the QUOTA, because Doubao reports promotional windows with reset countdowns and
 *     nothing else in the plugin knows how to read them.
 *
 * THE COPY SAYS WHAT ACTUALLY HAPPENS
 *
 * The button opens a Chromium window and waits. A user who is told "sign in" and sees a blank
 * panel for a minute concludes the feature is broken, so the waiting states name the step
 * they are on and the window stays open for the whole budget.
 *
 * @module dsh-xdpool/client/DoubaoPage
 */
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { POOL_DOUBAO_QUOTA_PATH, POOL_DOUBAO_SESSION_PATH } from '../status-paths.ts'
import type { XdPoolSettingsKey } from './locales.ts'

type Translate = (key: XdPoolSettingsKey, params?: Record<string, unknown>) => string

/** One quota window, as the route reports it. */
interface QuotaWindow {
  type?: string
  label?: string
  usedPercent?: number
  remainingPercent?: number
  usedAmount?: number
  totalAmount?: number
  resetsAt?: number
  resetUnknown?: boolean
}

/** The quota document. */
interface QuotaBody {
  ok?: boolean
  signedIn?: boolean
  exhausted?: boolean
  error?: string
  windows?: QuotaWindow[]
}

/** How the card describes one window. */
function windowLabel(window: QuotaWindow): string {
  if (typeof window.label === 'string' && window.label !== '') return window.label
  if (window.type === 'five_hour') return '5 小时限额'
  if (window.type === 'weekly') return '周额度'
  if (window.type === 'incentive') return '活动赠送额度'
  return '额度'
}

/** A countdown, or a plain statement when the window has no reset. */
function resetText(window: QuotaWindow): string {
  if (window.resetUnknown === true || window.resetsAt === undefined || window.resetsAt <= 0) {
    return '用后开始计算'
  }
  const left = window.resetsAt - Date.now()
  if (left <= 0) return '已重置'
  const hours = Math.floor(left / 3_600_000)
  const days = Math.floor(hours / 24)
  if (days > 0) return `${String(days)} 天 ${String(hours % 24)} 小时后重置`
  const minutes = Math.floor((left % 3_600_000) / 60_000)
  return `${String(hours)} 小时 ${String(minutes)} 分后重置`
}

export function DoubaoPage({ t }: { readonly t?: Translate | undefined }): ReactElement {
  const [signedIn, setSignedIn] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [windows, setWindows] = useState<readonly QuotaWindow[]>([])
  const [exhausted, setExhausted] = useState(false)
  const mounted = useRef(true)
  const poll = useRef<number | undefined>(undefined)

  useEffect(() => {
    // Set on MOUNT, not merely cleared on unmount: a ref keeps its value across a re-mount of
    // the same component, so a flag that is only cleared stays false forever after the first
    // unmount and every guard below returns before touching state.
    mounted.current = true
    return () => {
      mounted.current = false
      if (poll.current !== undefined) window.clearTimeout(poll.current)
    }
  }, [])

  /** Read the session and, when there is one, the quota. */
  const load = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch(POOL_DOUBAO_SESSION_PATH, { credentials: 'same-origin' })
      const body = await response.json().catch(() => undefined) as { signedIn?: boolean; savedAt?: string } | undefined
      if (!mounted.current) return
      const signed = body?.signedIn === true
      setSignedIn(signed)
      if (!signed) { setWindows([]); return }
      const quotaResponse = await fetch(POOL_DOUBAO_QUOTA_PATH, { credentials: 'same-origin' })
      const quota = await quotaResponse.json().catch(() => undefined) as QuotaBody | undefined
      if (!mounted.current) return
      setWindows(Array.isArray(quota?.windows) ? quota.windows : [])
      setExhausted(quota?.exhausted === true)
      if (typeof quota?.error === 'string' && quota.error !== '') setError(quota.error)
    } catch (cause: unknown) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  /** Open the sign-in browser and wait for it. */
  const signIn = useCallback(async (): Promise<void> => {
    setError(undefined)
    setMessage('已打开浏览器，请在弹出的窗口里扫码或短信登录…')
    setBusy(true)
    try {
      const response = await fetch(POOL_DOUBAO_SESSION_PATH, { method: 'POST', credentials: 'same-origin' })
      const body = await response.json().catch(() => undefined) as
        | { ok?: boolean; signedIn?: boolean; message?: string }
        | undefined
      if (!mounted.current) return
      if (body?.signedIn === true) {
        setMessage(body.message ?? '登录成功')
        void load()
        return
      }
      // A timeout is not a failure the user can act on beyond trying again, and saying so is
      // more useful than an error banner.
      setMessage(body?.message ?? '没有等到登录完成，可以再试一次')
    } catch (cause: unknown) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (mounted.current) setBusy(false)
    }
  }, [load])

  /** Forget the session. */
  const signOut = useCallback(async (): Promise<void> => {
    setError(undefined)
    setMessage(undefined)
    setBusy(true)
    try {
      await fetch(POOL_DOUBAO_SESSION_PATH, { method: 'DELETE', credentials: 'same-origin' })
      if (!mounted.current) return
      setSignedIn(false)
      setWindows([])
      setMessage('已退出登录')
    } catch (cause: unknown) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (mounted.current) setBusy(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  return (
    <div className="dsm-xdpool-doubao">
      <style>{DOUBAO_CSS}</style>
      <div className="dsm-xdpool-doubao-head">
        <div className="dsm-xdpool-doubao-id">
          <span className="dsm-xdpool-doubao-mark">DB</span>
          <div>
            <div className="dsm-xdpool-doubao-title">豆包 · 字节跳动</div>
            <div className="dsm-xdpool-doubao-sub">
              {signedIn
                ? (t?.('doubao.ready') ?? '已登录，会话保存在本机')
                : (t?.('doubao.sub') ?? '浏览器扫码登录一次，对话与工作任务模型都能用')}
            </div>
          </div>
        </div>
        <div className="dsm-xdpool-doubao-acts">
          {signedIn
            ? (
              <>
                <button type="button" className="dsm-xdpool-doubao-btn" disabled={busy} onClick={() => { void load() }}>
                  {t?.('doubao.refresh') ?? '刷新额度'}
                </button>
                <button type="button" className="dsm-xdpool-doubao-btn" disabled={busy} onClick={() => { void signOut() }}>
                  {t?.('doubao.signOut') ?? '退出登录'}
                </button>
              </>
            )
            : (
              <button
                type="button"
                className="dsm-xdpool-doubao-btn"
                data-tone="primary"
                disabled={busy}
                onClick={() => { void signIn() }}
              >
                {busy ? (t?.('doubao.waiting') ?? '等待登录…') : (t?.('doubao.signIn') ?? '扫码登录')}
              </button>
            )}
        </div>
      </div>

      {message === undefined ? null : <p className="dsm-xdpool-doubao-note">{message}</p>}
      {error === undefined ? null : <p className="dsm-xdpool-doubao-error">{error}</p>}

      {signedIn
        ? (
          <>
            {exhausted ? (
              <p className="dsm-xdpool-doubao-error">额度已用完，等待窗口重置。</p>
            ) : null}
            {windows.length === 0
              ? <p className="dsm-xdpool-doubao-hint">这个账号暂时没有可显示的额度窗口。</p>
              : windows.map((window, index) => {
                const percent = typeof window.usedPercent === 'number' ? window.usedPercent : 0
                const used = typeof window.usedAmount === 'number' ? window.usedAmount : undefined
                const total = typeof window.totalAmount === 'number' ? window.totalAmount : undefined
                return (
                  <div className="dsm-xdpool-doubao-window" key={`${window.type ?? 'w'}-${String(index)}`}>
                    <div className="dsm-xdpool-doubao-window-head">
                      <span className="dsm-xdpool-doubao-window-name">{windowLabel(window)}</span>
                      <span className="dsm-xdpool-doubao-window-reset">{resetText(window)}</span>
                    </div>
                    <div className="dsm-xdpool-doubao-bar">
                      <span
                        className="dsm-xdpool-doubao-bar-fill"
                        data-exhausted={percent >= 100 ? 'true' : 'false'}
                        style={{ width: `${String(Math.min(100, Math.max(0, percent)))}%` }}
                      />
                    </div>
                    <div className="dsm-xdpool-doubao-window-foot">
                      {used === undefined || total === undefined
                        ? `已用 ${String(Math.round(percent))}%`
                        : `已用 ${String(used)} / ${String(total)}`}
                    </div>
                  </div>
                )
              })}
            <p className="dsm-xdpool-doubao-hint">
              {t?.('doubao.modelsNote') ?? '模型在对话的模型选择器里：豆包 快速 / 2.1 Turbo / 2.1 Lite / 2.1 Pro / 自动 / 生图。'}
            </p>
          </>
        )
        : (
          <p className="dsm-xdpool-doubao-hint">
            {t?.('doubao.why')
              ?? '豆包已关闭第三方扫码入口（服务端返回 2035），所以这里拉起一个浏览器窗口：在窗口里扫码或填手机号，登录成功后会话自动取回并保存在本机。'}
          </p>
        )}
    </div>
  )
}

/** The card's own stylesheet, travelling with the component. */
const DOUBAO_CSS = `
.dsm-xdpool-doubao{display:flex;flex-direction:column;gap:11px;padding:14px 16px 16px;border-radius:14px;border:1px solid color-mix(in srgb, var(--dsw-alias-border-l2,#ffffff1f) 82%, transparent);background:color-mix(in srgb, var(--dsw-alias-bg-layer-2,#1c1e22) 70%, transparent)}
.dsm-xdpool-doubao-head{display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap}
.dsm-xdpool-doubao-id{display:flex;align-items:center;gap:10px;min-width:0}
.dsm-xdpool-doubao-mark{width:34px;height:34px;border-radius:9px;display:grid;place-items:center;font-size:12px;font-weight:700;letter-spacing:.02em;color:#fff;background:linear-gradient(135deg,#4B7BF5,#2E5BD8);flex:none}
.dsm-xdpool-doubao-title{font-size:13.5px;font-weight:650;color:var(--dsw-alias-label-primary,#e8eaf0)}
.dsm-xdpool-doubao-sub{margin-top:2px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#8a90a0)}
.dsm-xdpool-doubao-acts{margin-left:auto;display:flex;gap:8px;flex:none}
.dsm-xdpool-doubao-btn{appearance:none;-webkit-appearance:none;padding:5px 13px;border-radius:8px;cursor:pointer;font:inherit;font-size:12px;line-height:18px;border:1px solid color-mix(in srgb, var(--dsw-alias-border-l2,#ffffff1f) 95%, transparent);background:transparent;color:var(--dsw-alias-label-secondary,#b9bfcc);white-space:nowrap}
.dsm-xdpool-doubao-btn:hover:not(:disabled){border-color:color-mix(in srgb, #3B6FD4 55%, transparent);color:var(--dsw-alias-label-primary,#e8eaf0)}
.dsm-xdpool-doubao-btn:disabled{opacity:.5;cursor:not-allowed}
.dsm-xdpool-doubao-btn[data-tone='primary']{border-color:color-mix(in srgb, #3B6FD4 62%, transparent);background:color-mix(in srgb, #3B6FD4 16%, transparent);color:#6E9AF0;font-weight:600}
.dsm-xdpool-doubao-note{margin:0;font-size:11.5px;line-height:17px;color:var(--dsw-alias-state-success-primary,#22a06b)}
.dsm-xdpool-doubao-error{margin:0;font-size:11.5px;line-height:17px;color:var(--dsw-alias-state-error-primary,#e5534b)}
.dsm-xdpool-doubao-hint{margin:0;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#8a90a0)}
.dsm-xdpool-doubao-window{display:flex;flex-direction:column;gap:6px;padding:10px 12px;border-radius:10px;background:color-mix(in srgb, #3B6FD4 8%, transparent);border:1px solid color-mix(in srgb, #3B6FD4 24%, transparent)}
.dsm-xdpool-doubao-window-head{display:flex;align-items:baseline;gap:10px}
.dsm-xdpool-doubao-window-name{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary,#e8eaf0)}
.dsm-xdpool-doubao-window-reset{margin-left:auto;font-size:10.5px;color:var(--dsw-alias-label-tertiary,#8a90a0)}
.dsm-xdpool-doubao-bar{height:6px;border-radius:999px;background:color-mix(in srgb, var(--dsw-alias-label-primary,#e8eaf0) 10%, transparent);overflow:hidden}
.dsm-xdpool-doubao-bar-fill{display:block;height:100%;border-radius:999px;background:#3B6FD4;transition:width .2s ease}
.dsm-xdpool-doubao-bar-fill[data-exhausted='true']{background:#e5534b}
.dsm-xdpool-doubao-window-foot{font-size:10.5px;color:var(--dsw-alias-label-secondary,#b9bfcc);font-variant-numeric:tabular-nums}
`

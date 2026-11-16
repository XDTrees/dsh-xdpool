/**
 * The update check, above the backup controls.
 *
 * WHY IT SITS HERE
 *
 * "Is there a newer version" and "put this machine back how it was" are the same kind of task —
 * maintenance the user does occasionally, not part of running the pool. They belong on one page,
 * which is why the tab is now 「更新与备份」 rather than just 备份.
 *
 * WHAT IT SAYS
 *
 * Three outcomes, three sentences: newer, current, or could not check. The third is why `error`
 * is kept apart from "no update": telling a user they are current when the registry was
 * unreachable is the one wrong answer this panel could give.
 *
 * @module dsh-xdpool/client/UpdatePanel
 */
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { POOL_UPDATE_CHECK_PATH } from '../status-paths.ts'
import type { XdPoolSettingsKey } from './locales.ts'

type Translate = (key: XdPoolSettingsKey, params?: Record<string, unknown>) => string

/** What the route reports. */
interface UpdateStatus {
  current?: string
  latest?: string
  newer?: boolean
  publishedAt?: string
  error?: string
  checkedAt?: string
}

/** A short "3 分钟前" line for the last check. */
function agoText(iso: string | undefined): string | undefined {
  if (iso === undefined) return undefined
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return undefined
  const minutes = Math.floor((Date.now() - at) / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${String(minutes)} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${String(hours)} 小时前`
  return `${String(Math.floor(hours / 24))} 天前`
}

/** The published date, as a plain day. */
function dayText(iso: string | undefined): string | undefined {
  if (iso === undefined) return undefined
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return undefined
  return new Date(at).toISOString().slice(0, 10)
}

export function UpdatePanel({ t }: { readonly t?: Translate | undefined }): ReactElement {
  const [status, setStatus] = useState<UpdateStatus | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const mounted = useRef(true)

  useEffect(() => {
    // Set on MOUNT: a ref only cleared on unmount stays false across a React StrictMode remount,
    // and every guard below would then return before touching state.
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const check = useCallback(async (force: boolean): Promise<void> => {
    setBusy(true)
    try {
      const response = await fetch(POOL_UPDATE_CHECK_PATH, {
        method: force ? 'POST' : 'GET',
        credentials: 'same-origin',
      })
      const body = await response.json().catch(() => undefined) as UpdateStatus | undefined
      if (!mounted.current || body === undefined) return
      setStatus(body)
    } catch {
      if (!mounted.current) return
      setStatus({ error: '无法连接插件（请确认页面已连上宿主）', checkedAt: new Date().toISOString() })
    } finally {
      if (mounted.current) setBusy(false)
    }
  }, [])

  // One read on open: the cached answer is cheap, and a panel that shows nothing until pressed
  // makes the user press it every time to learn the same thing.
  useEffect(() => { void check(false) }, [check])

  const newer = status?.newer === true
  const checked = agoText(status?.checkedAt)
  const published = dayText(status?.publishedAt)
  return (
    <div className="dsm-xdpool-update">
      <div className="dsm-xdpool-update-head">
        <span className="dsm-xdpool-update-title">
          {t?.('update.title') ?? '检查更新'}
        </span>
        {status?.current === undefined ? null : (
          <span className="dsm-xdpool-update-versions">
            {t?.('update.current') ?? '当前'} <b>{status.current}</b>
            {status.latest === undefined ? null : (
              <>
                <span className="dsm-xdpool-update-sep" aria-hidden="true">·</span>
                {t?.('update.latest') ?? '最新'} <b>{status.latest}</b>
              </>
            )}
          </span>
        )}
        <button
          type="button"
          className="dsm-xdpool-btn"
          disabled={busy}
          onClick={() => { void check(true) }}
        >
          {busy ? (t?.('update.checking') ?? '检查中…') : (t?.('update.check') ?? '检查更新')}
        </button>
      </div>

      {status?.error === undefined ? null : (
        <p className="dsm-xdpool-update-error">
          {t?.('update.failed') ?? '没能检查更新'}：{status.error}
        </p>
      )}

      {status?.error !== undefined || status === undefined ? null : newer ? (
        <p className="dsm-xdpool-update-newer">
          {t?.('update.available', { version: status.latest ?? '' }) ?? `有新版本 ${status.latest ?? ''}`}
          {published === undefined ? '' : `（发布于 ${published}）`}
          {'. '}
          {t?.('update.howTo') ?? '在 DSH 的插件设置里把它更新到该版本即可；数据与账号不受影响。'}
        </p>
      ) : (
        <p className="dsm-xdpool-update-current">
          {t?.('update.upToDate') ?? '已是最新版本'}
          {checked === undefined ? '' : `（${checked}检查）`}
        </p>
      )}
    </div>
  )
}

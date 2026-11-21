/**
 * Doubao's automation pane, shaped like WorkBuddy's.
 *
 * WHY IT LOOKS LIKE THE OTHER ONE
 *
 * A user who has used the WorkBuddy card expects the same control in the same place: a row that
 * says 积分自动化 with an on/off pill, opening to a short description and a button that runs it
 * now. Drawing Doubao's differently because its mechanism differs would be surfacing an
 * implementation detail as a layout difference — the user's question is "does it collect my
 * points", not "which endpoint does it call".
 *
 * WHAT IT HONESTLY SAYS
 *
 * Doubao's own check-in endpoint is refused by the server (`710010702`), so this collects the
 * campaign tasks that ARE claimable — and one of those is the daily sign-in. The pane says that
 * rather than promising a check-in that cannot happen.
 *
 * @module dsh-xdpool/client/DoubaoAutomationPane
 */
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { POOL_DOUBAO_AUTOMATION_PATH } from '../status-paths.ts'
import type { XdPoolSettingsKey } from './locales.ts'

type Translate = (key: XdPoolSettingsKey, params?: Record<string, unknown>) => string

/** The automation state the route reports. */
interface AutomationState {
  enabled?: boolean
  lastRunAt?: string
  lastClaimed?: number
  lastNote?: string
}

/** A short "3 小时前" style line for the last pass. */
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

export function DoubaoAutomationPane({ t }: { readonly t?: Translate | undefined }): ReactElement {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<AutomationState>({ enabled: false })
  const [busy, setBusy] = useState(false)
  const mounted = useRef(true)

  useEffect(() => {
    // Set on MOUNT: a ref only cleared on unmount stays false across a React StrictMode
    // remount, and every guard below would then return before touching state.
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const load = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch(POOL_DOUBAO_AUTOMATION_PATH, { credentials: 'same-origin' })
      const body = await response.json().catch(() => undefined) as AutomationState | undefined
      if (!mounted.current || body === undefined) return
      setState(body)
    } catch {
      // A failed read leaves the pane on its last known state rather than blanking it.
    }
  }, [])

  useEffect(() => { void load() }, [load])

  /** Flip the switch, or run one pass. */
  const send = useCallback(async (body: Record<string, unknown>): Promise<void> => {
    setBusy(true)
    try {
      const response = await fetch(POOL_DOUBAO_AUTOMATION_PATH, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const answer = await response.json().catch(() => undefined) as AutomationState | undefined
      if (!mounted.current || answer === undefined) return
      setState(answer)
    } catch {
      // The state stays as it was; the next read corrects it.
    } finally {
      if (mounted.current) setBusy(false)
    }
  }, [])

  const enabled = state.enabled === true
  const lastRun = agoText(state.lastRunAt)
  return (
    <div className="dsm-xdpool-cpool-auto">
      <button
        type="button"
        className="field"
        aria-expanded={open}
        onClick={() => { setOpen(!open) }}
      >
        <span className="strip-caret" aria-hidden="true">▸</span>
        <span>{t?.('row.autoTitle') ?? '积分自动化'}</span>
        <span className="td-num">
          {enabled ? (t?.('row.autoOn') ?? '已开启') : (t?.('row.autoOff') ?? '未开启')}
        </span>
      </button>
      <div className="card" hidden={!open}>
        <p className="hint">
          豆包的签到自己点了会报系统错误（710010702），所以这里领的是「每日签到」等任务里
          已经完成、可以领的积分。开启后每 6 小时自动领一次。
        </p>
        <div className="dsm-xdpool-cpool-autorow">
          <button
            type="button"
            className="dsm-xdpool-btn"
            data-tone={enabled ? undefined : 'primary'}
            disabled={busy}
            onClick={() => { void send({ enabled: !enabled }) }}
          >
            {enabled
              ? (t?.('channelpool.autoOff') ?? '关闭自动化')
              : (t?.('channelpool.autoOn') ?? '开启自动化')}
          </button>
          <button
            type="button"
            className="dsm-xdpool-btn"
            disabled={busy}
            onClick={() => { void send({}) }}
          >
            {busy ? '执行中…' : '立即执行一次'}
          </button>
        </div>
        {lastRun === undefined ? null : (
          <p className="hint">
            上次执行：{lastRun}
            {typeof state.lastClaimed === 'number' ? `，领到 ${String(state.lastClaimed)} 项` : ''}
            {state.lastNote === undefined ? '' : `（${state.lastNote}）`}
          </p>
        )}
        {lastRun === undefined && state.lastNote === undefined ? null : null}
        {state.lastNote !== undefined && lastRun === undefined ? (
          <p className="hint">{state.lastNote}</p>
        ) : null}
      </div>
    </div>
  )
}

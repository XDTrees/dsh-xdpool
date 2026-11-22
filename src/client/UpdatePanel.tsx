/**
 * 「检查更新」小窗 —— 点左上角版本号旁的小圆圈弹出。
 *
 * 设计思路：一个状态一句话 + 一个主操作，不让读者自己拼「当前 / 最新 / 检查更新」三块信息。
 *
 *   正在检查      小圈 + 「正在检查更新…」
 *   有新版本      绿色横幅「发现新版本 vX」+ 更新内容 + 整行主按钮「立即更新」
 *   正在更新      四步进度（下载 · 校验 · 备份数据 · 写入配置），结果按后端实际执行的步骤打勾
 *   更新完成      「已更新到 vX，重启 DSH 生效」+ 备份放在哪
 *   更新失败      红色横幅 + 中文原因 +「你的数据和当前版本都没动」+ 重试 / 手动下载
 *   需要重启      界面已是新版但后台还在跑旧版（装完没重启）→ 黄色横幅提示重启
 *   已是最新      一行「已是最新版本」+ 上次检查时间 + 小按钮「重新检查」
 *   检查失败      黄色横幅（离线 / 代理），不假装「已是最新」
 *
 * 三条不能破的规矩：
 *   1. 检查失败绝不显示「已是最新」—— 那是这块面板唯一可能说错的话。
 *   2. 「立即更新」不把版本号传给后端：后端自己再问一次 registry，面板没法被骗去装别的东西。
 *   3. 更新前后端会先把账号和设置备份一份（update-install.ts），失败就不动 package.json。
 *
 * @module dsh-xdpool/client/UpdatePanel
 */
import { useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { POOL_UPDATE_CHECK_PATH, POOL_UPDATE_INSTALL_PATH } from '../status-paths.ts'
import { compareVersions } from '../update-check.ts'
import type { XdPoolSettingsKey } from './locales.ts'

type Translate = (key: XdPoolSettingsKey, params?: Record<string, unknown>) => string

/** 检查接口的回答。 */
export interface UpdateStatus {
  current?: string
  latest?: string
  newer?: boolean
  publishedAt?: string
  error?: string
  checkedAt?: string
  notes?: readonly string[]
  notesTitle?: string
}

/** 安装接口的回答（steps / backupPath 由更新前备份那一版后端提供，旧后端没有）。 */
interface InstallAnswer {
  ok?: boolean
  version?: string
  restartRequired?: boolean
  error?: string
  backupPath?: string
  previousVersion?: string
  steps?: readonly { id?: string; ok?: boolean; detail?: string }[]
}

/** 更新的四步，顺序就是后端执行的顺序。 */
const STEPS: readonly { id: string; label: string }[] = [
  { id: 'download', label: '下载新版本' },
  { id: 'verify', label: '校验安装包' },
  { id: 'backup', label: '备份账号和设置' },
  { id: 'write', label: '写入插件配置' },
]

const NPM_PAGE = 'https://www.npmjs.com/package/dsh-xdpool'
const RELEASES_PAGE = 'https://github.com/XDTrees/dsh-xdpool/releases'

/** 「3 分钟前」。 */
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

/** 后端可能给英文（网络错误原文），有中文就用，没中文换成一句能看懂的。 */
function chineseError(raw: string | undefined, fallback: string): string {
  if (raw === undefined || raw === '') return fallback
  if (/[\u4e00-\u9fff]/u.test(raw)) return raw
  if (/timeout|timed out|aborted/iu.test(raw)) return '连接超时，请检查网络后重试'
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|fetch failed|network/iu.test(raw)) return '连不上 npm（离线或代理没放行）'
  if (/EPERM|EACCES|permission/iu.test(raw)) return '没有权限写入插件目录（可能被杀毒软件拦了）'
  const status = /HTTP\s*(\d{3})/u.exec(raw)?.[1]
  if (status !== undefined) return `服务器返回 ${status}`
  return fallback
}

const ICON_REFRESH = 'M21 12a9 9 0 11-3-6.7M21 4v5h-5'
const ICON_CHECK = 'M5 12.5l4.5 4.5L19 7.5'
const ICON_ALERT = 'M12 8v5M12 16.5v.5M10.3 3.9L2.6 17.2A2 2 0 004.3 20h15.4a2 2 0 001.7-2.8L13.7 3.9a2 2 0 00-3.4 0z'
const ICON_SHIELD = 'M12 3l7 3v5c0 4.6-3 8.4-7 10-4-1.6-7-5.4-7-10V6z'
const ICON_DOWN = 'M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19h14'

function Icon({ d, size = 16 }: { d: string; size?: number }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

/** 设计稿的 .banner，带三种语气（主色 / 警告 / 危险）。 */
function Banner({ tone, icon, title, children }: {
  tone: 'ok' | 'warn' | 'err'
  icon: ReactNode
  title: ReactNode
  children?: ReactNode
}): ReactElement {
  const color = tone === 'ok' ? 'var(--accent)' : tone === 'warn' ? 'var(--warn)' : 'var(--danger)'
  return (
    <div className="banner" style={{
      borderColor: `color-mix(in oklch, ${color} 35%, transparent)`,
      background: `color-mix(in oklch, ${color} 7%, var(--surface))`,
    }}>
      <span className="banner-icon" style={{
        color,
        background: `color-mix(in oklch, ${color} 16%, transparent)`,
      }}>{icon}</span>
      <span className="banner-body">
        <span className="banner-t">{title}</span>
        {children === undefined ? null : <span className="banner-d">{children}</span>}
      </span>
    </div>
  )
}

export function UpdatePanel({ t, clientVersion, onStatus, onClose }: {
  readonly t?: Translate | undefined
  /** 界面（这个 bundle）自己的版本号。和后端答的 current 不一致 = 装完还没重启。 */
  readonly clientVersion?: string | undefined
  /** 每次检查有结果就告诉外壳，左上角的小红点跟着变。 */
  readonly onStatus?: ((status: UpdateStatus) => void) | undefined
  /** 「稍后」「好的」关掉小窗。 */
  readonly onClose?: (() => void) | undefined
}): ReactElement {
  void t
  const [status, setStatus] = useState<UpdateStatus | undefined>(undefined)
  const [checking, setChecking] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'installing' | 'done' | 'failed'>('idle')
  const [answer, setAnswer] = useState<InstallAnswer | undefined>(undefined)
  const [allNotes, setAllNotes] = useState(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const check = useCallback(async (force: boolean): Promise<void> => {
    setChecking(true)
    try {
      const response = await fetch(POOL_UPDATE_CHECK_PATH, {
        method: force ? 'POST' : 'GET',
        credentials: 'same-origin',
      })
      const body = await response.json().catch(() => undefined) as UpdateStatus | undefined
      if (!mounted.current || body === undefined) return
      setStatus(body)
      onStatus?.(body)
    } catch {
      if (!mounted.current) return
      const failed = { error: '连不上插件后台（请确认 DSH 还在运行）', checkedAt: new Date().toISOString() }
      setStatus(failed)
    } finally {
      if (mounted.current) setChecking(false)
    }
  }, [onStatus])

  const install = useCallback(async (): Promise<void> => {
    setPhase('installing')
    setAnswer(undefined)
    try {
      const response = await fetch(POOL_UPDATE_INSTALL_PATH, { method: 'POST', credentials: 'same-origin' })
      const body = await response.json().catch(() => undefined) as InstallAnswer | undefined
      if (!mounted.current) return
      setAnswer(body)
      setPhase(body?.ok === true ? 'done' : 'failed')
    } catch (cause: unknown) {
      if (!mounted.current) return
      setAnswer({ ok: false, error: cause instanceof Error ? cause.message : String(cause) })
      setPhase('failed')
    }
  }, [])

  // 打开就读一次（后端缓存 10 分钟，很便宜）；按钮才强制去问 npm。
  useEffect(() => { void check(false) }, [check])

  const backendVersion = status?.current
  const shownVersion = clientVersion ?? backendVersion
  const latest = status?.latest
  /* 以界面版本为准判断有没有新版：后台没重启时它答的 current 是旧的 */
  const newer = latest !== undefined && shownVersion !== undefined
    ? compareVersions(latest, shownVersion) > 0
    : status?.newer === true
  const restartPending = clientVersion !== undefined && backendVersion !== undefined
    && compareVersions(clientVersion, backendVersion) !== 0
  const devBuild = latest !== undefined && shownVersion !== undefined && compareVersions(shownVersion, latest) > 0
  const checked = agoText(status?.checkedAt)
  const published = agoText(status?.publishedAt)

  const stack = (children: ReactNode): ReactElement => (
    <div className="stack" style={{ gap: 'var(--s3)' }}>{children}</div>
  )
  const versionLine = (
    <div className="row" style={{ justifyContent: 'space-between', fontSize: 'var(--fs-xs)', color: 'var(--faint)' }}>
      <span>当前 <b className="num" style={{ color: 'var(--text)', fontWeight: 600 }}>v{shownVersion ?? '—'}</b></span>
      {latest === undefined ? null : (
        <span>npm 最新 <b className="num" style={{ color: 'var(--text)', fontWeight: 600 }}>v{latest}</b></span>
      )}
    </div>
  )

  /* ---------- 正在更新 / 更新完 / 更新失败 ---------- */
  if (phase !== 'idle') {
    const done = new Map((answer?.steps ?? []).map(step => [step.id ?? '', step.ok === true]))
    const failedAt = (answer?.steps ?? []).find(step => step.ok !== true)?.id
    return stack(<>
      {phase === 'installing' ? (
        <Banner tone="ok" icon={<span className="spinner" />} title={`正在更新到 v${latest ?? ''}`}>
          一般 10–30 秒，期间可以继续用，别关 DSH。
        </Banner>
      ) : phase === 'done' ? (
        <Banner tone="ok" icon={<Icon d={ICON_CHECK} />} title={`已更新到 v${answer?.version ?? latest ?? ''}`}>
          重启 DSH 后生效。
        </Banner>
      ) : (
        <Banner tone="err" icon={<Icon d={ICON_ALERT} />} title="更新没成功">
          {chineseError(answer?.error, '安装失败')}。你的数据和当前版本都没动。
        </Banner>
      )}

      <div className="steps" style={{ gap: 'var(--s2)' }}>
        {STEPS.map((step, index) => {
          const known = done.get(step.id)
          const state = phase === 'installing'
            ? 'wait'
            : known === true || (phase === 'done' && answer?.steps === undefined)
              ? 'done'
              : step.id === failedAt
                ? 'fail'
                : 'wait'
          return (
            <div className="step" key={step.id} style={{ alignItems: 'center' }}>
              <span className="step-n"
                data-done={state === 'done' ? 'true' : undefined}
                data-wait={state === 'wait' ? 'true' : undefined}
                style={state === 'fail' ? { background: 'var(--danger)', color: 'var(--accent-ink)' } : undefined}>
                {state === 'done' ? <Icon d={ICON_CHECK} size={12} /> : state === 'fail' ? '!' : String(index + 1)}
              </span>
              <span className="step-b">
                <span className="step-t" data-wait={state === 'wait' ? 'true' : undefined}
                  style={{ fontSize: 'var(--fs-sm)' }}>{step.label}</span>
              </span>
            </div>
          )
        })}
      </div>

      {phase === 'done' && answer?.backupPath !== undefined ? (
        <p className="hint" style={{ margin: 0 }}>
          <b>备份</b>
          <span style={{ wordBreak: 'break-all' }}>更新前的账号和设置已存到 {answer.backupPath}</span>
        </p>
      ) : null}

      <div className="row" style={{ gap: 'var(--s2)' }}>
        {phase === 'done' ? (
          <button type="button" className="btn btn-primary" style={{ flex: '1 1 auto' }}
            onClick={() => { onClose?.() }}>好的，稍后重启</button>
        ) : phase === 'failed' ? (
          <>
            <button type="button" className="btn btn-primary" style={{ flex: '1 1 auto' }}
              onClick={() => { void install() }}>重试</button>
            <a className="btn" href={NPM_PAGE} target="_blank" rel="noreferrer">手动下载</a>
            <button type="button" className="btn" onClick={() => { setPhase('idle') }}>返回</button>
          </>
        ) : null}
      </div>
    </>)
  }

  /* ---------- 还没有结果 ---------- */
  if (status === undefined) {
    return stack(<>
      <div className="row" style={{ gap: 'var(--s2)', color: 'var(--muted)', fontSize: 'var(--fs-sm)' }}>
        <span className="spinner" /> 正在检查更新…
      </div>
      {versionLine}
    </>)
  }

  /* ---------- 检查失败：不说「已是最新」 ---------- */
  if (status.error !== undefined) {
    return stack(<>
      <Banner tone="warn" icon={<Icon d={ICON_ALERT} />} title="没能检查更新">
        {chineseError(status.error, '暂时连不上 npm')}{checked === undefined ? '' : ` · ${checked}`}
      </Banner>
      {versionLine}
      <div className="row" style={{ gap: 'var(--s2)' }}>
        <button type="button" className="btn" disabled={checking} style={{ flex: '1 1 auto' }}
          onClick={() => { void check(true) }}>{checking ? '检查中…' : '重试'}</button>
        <a className="btn" href={RELEASES_PAGE} target="_blank" rel="noreferrer">去 GitHub 看</a>
      </div>
    </>)
  }

  /* ---------- 有新版本 ---------- */
  if (newer && latest !== undefined) {
    const notes = status.notes ?? []
    const visible = allNotes ? notes : notes.slice(0, 4)
    return stack(<>
      <Banner tone="ok" icon={<Icon d={ICON_DOWN} />} title={`发现新版本 v${latest}`}>
        当前 v{shownVersion ?? '—'}{published === undefined ? '' : ` · 发布于 ${published}`}
      </Banner>

      {notes.length === 0 ? null : (
        <div className="stack" style={{ gap: 6 }}>
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--faint)' }}>{status.notesTitle ?? '更新内容'}</span>
          <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4,
            fontSize: 'var(--fs-sm)', lineHeight: 1.55, color: 'var(--text)',
            maxHeight: allNotes ? 220 : undefined, overflowY: allNotes ? 'auto' : undefined }}>
            {visible.map((note, index) => <li key={`${String(index)}-${note.slice(0, 12)}`}>{note}</li>)}
          </ul>
          {notes.length <= 4 ? null : (
            <button type="button" className="tiny" style={{ alignSelf: 'flex-start' }}
              onClick={() => { setAllNotes(!allNotes) }}>
              {allNotes ? '收起' : `展开全部 ${String(notes.length)} 条`}
            </button>
          )}
        </div>
      )}

      <button type="button" className="btn btn-primary" style={{ width: '100%', minHeight: 34 }}
        onClick={() => { void install() }}>
        立即更新到 v{latest}
      </button>
      <div className="row" style={{ gap: 6, fontSize: 'var(--fs-xs)', color: 'var(--muted)', lineHeight: 1.5,
        flexWrap: 'nowrap', alignItems: 'flex-start' }}>
        <span style={{ color: 'var(--accent)', flex: '0 0 auto', marginTop: 1 }}><Icon d={ICON_SHIELD} size={13} /></span>
        <span>更新前会自动备份账号、设置和路由；装好后重启 DSH 生效，已登录的账号不用重新登录。</span>
      </div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <a className="tiny" href={RELEASES_PAGE} target="_blank" rel="noreferrer">完整更新日志</a>
        <button type="button" className="tiny" onClick={() => { onClose?.() }}>稍后</button>
      </div>
    </>)
  }

  /* ---------- 装完还没重启 ---------- */
  if (restartPending) {
    return stack(<>
      <Banner tone="warn" icon={<Icon d={ICON_REFRESH} />} title="还差一步：重启 DSH">
        界面已经是 v{clientVersion}，后台还在跑 v{backendVersion}。重启后两边一致，新功能才完整生效。
      </Banner>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="tiny" onClick={() => { onClose?.() }}>知道了</button>
      </div>
    </>)
  }

  /* ---------- 已是最新 ---------- */
  return stack(<>
    <Banner tone="ok" icon={<Icon d={ICON_CHECK} />} title="已是最新版本">
      {devBuild
        ? `你用的 v${shownVersion ?? ''} 比 npm 上的 v${latest ?? ''} 还新（开发版）`
        : `v${shownVersion ?? '—'}${checked === undefined ? '' : ` · ${checked}检查`}`}
    </Banner>
    <div className="row" style={{ justifyContent: 'space-between' }}>
      <a className="tiny" href={RELEASES_PAGE} target="_blank" rel="noreferrer">更新日志</a>
      <button type="button" className="tiny" disabled={checking}
        onClick={() => { void check(true) }}>
        {checking ? '检查中…' : '重新检查'}
      </button>
    </div>
  </>)
}

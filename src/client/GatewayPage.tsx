/**
 * 网关页：把账号池通过一个 OpenAI 兼容接口暴露给局域网里的其它设备。
 *
 * 布局严格对照设计稿 xdpool-design/gateway.html：
 *
 *   main
 *   ├── header.mhead   标题 + 状态 pill + 重启 / 关闭网关 / 复制地址
 *   └── div.mbody
 *       ├── .kpis            请求 / 平均延迟 / 输入 / 输出
 *       ├── section.sec      连接信息（地址 / 鉴权 / 监听 / 模型 + 共享哪些模型）
 *       ├── section.sec      客户端配置（.code）
 *       └── section.sec      健康检查（.table）
 *
 * 几个必须守住的事实（测试里有断言）：
 *
 * 1. 默认只绑本机 127.0.0.1；改成 0.0.0.0 是用户单独做的一步。
 * 2. 这里给出的是中继自己的密钥，不是 shim 每进程生成的秘密 —— DSH 重启后仍然有效。
 * 3. 「已开」和「在监听」是两件事：开了但没绑上端口要显示成警告，而不是「已关」。
 * 4. 密钥默认打码显示，但复制按钮复制的是真实密钥。
 *
 * 模型共享有两种方式：
 *   - 按账号池启用列表：不额外限制，账号池 / 渠道里启用了什么，网关就放行什么；
 *   - 自定义：按渠道勾选，只放行勾选的模型 id。
 * 旧配置没有 modelsMode 字段：shared 不存在视为「按账号池」，存在视为「自定义」。
 *
 * @module dsh-xdpool/client/GatewayPage
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { POOL_RELAY_PATH, type PoolWebRelayStatus } from '../status-paths.ts'
import { copyText } from './clipboard.ts'
import { isFreeChannelModel } from './channel-rpc.ts'
import { brandName, splitTokens } from './ledger-charts.tsx'
import type { XdPoolSettingsKey } from './locales.ts'
/** The translator the settings section injects. */
type Translate = (key: XdPoolSettingsKey, params?: Record<string, unknown>) => string
export interface GatewayPageProps {
  t?: Translate | undefined
}
/**
 * 只提供这两个绑定地址。
 *
 * 与 `src/relay.ts` 的 `RELAY_HOSTS` 保持一致（服务端模块引了 node:http，浏览器包不能 import），
 * `tests/relay-page.test.ts` 会检查两份列表不漂移。
 */
const HOSTS = [
  { value: '127.0.0.1', label: '仅本机' },
  { value: '0.0.0.0', label: '局域网内所有设备' },
] as const
/** 轮询间隔。网关不会自己变，比账号池卡片慢。 */
const POLL_MS = 15_000
/** 模型共享方式。 */
type ShareMode = 'pool' | 'custom'
/**
 * 打码显示的密钥，不直接渲染完整值。
 *
 * 设置面板截图是很常见的分享行为，截图不应该把凭据一起送出去。
 */
function maskOf(key: string): string {
  /* 后端把 key 写成对象时 .length/.slice 都会抛错，整页白掉。这里先确认它是字符串。 */
  const text = typeof key === 'string' ? key : ''
  if (text.length <= 8) return '•'.repeat(Math.max(4, text.length))
  return `${text.slice(0, 4)}${'•'.repeat(8)}${text.slice(-4)}`
}
/**
 * 当前生效的共享方式。
 *
 * 新后端会回 `modelsMode`；旧后端没有这个字段，就按 shared 是否存在推断，
 * 这与旧语义（absent = 全放行，有列表 = 白名单）一致。
 */
function modeOf(status: PoolWebRelayStatus | undefined): ShareMode {
  const raw = (status as unknown as { modelsMode?: unknown } | undefined)?.modelsMode
  if (raw === 'pool' || raw === 'custom') return raw
  return status?.shared === undefined ? 'pool' : 'custom'
}
/** 渠道 id → 界面上显示的名字。 */
function sourceName(source: string): string {
  if (source === 'combo') return '路由组合'
  return brandName(source)
}
/** 是否含中文：后端偶尔已经给的是中文提示，那就直接用。 */
const HAS_CJK = /[\u4e00-\u9fff]/u
/**
 * 后端 / 网络返回的英文错误 → 中文。映射不了的统一说「操作失败」，不把英文原样展示。
 */
function zhError(raw: string | undefined): string {
  const text = typeof raw === 'string' ? raw : ''
  if (text === '') return '操作失败'
  if (HAS_CJK.test(text)) return text
  if (/EADDRINUSE|in use/iu.test(text)) return '端口已被占用，换一个端口再试'
  if (/EACCES|permission/iu.test(text)) return '没有权限绑定这个端口'
  if (/not a port/iu.test(text)) return '这个端口不能用'
  if (/advertise/iu.test(text)) return '监听到的地址无法对外提供'
  if (/origin-not-trusted/iu.test(text)) return '请求来源不受信任，请在 DSH 里打开此页面'
  if (/not available in this build/iu.test(text)) return '当前版本没有网关功能'
  if (/cannot bind|bind/iu.test(text)) return '绑定端口失败'
  const http = /HTTP (\d+)/u.exec(text)
  if (http !== null) return `请求失败（HTTP ${http[1] ?? ''}）`
  if (/fetch|network|abort/iu.test(text)) return '连不上 DSH 后端'
  return '操作失败'
}
/** 平均延迟：不足 1 秒用 ms，否则用 s。 */
function latencyParts(ms: number | undefined): readonly [string, string] {
  if (ms === undefined || !Number.isFinite(ms)) return ['—', '']
  if (ms < 1000) return [String(Math.round(ms)), 'ms']
  return [(ms / 1000).toFixed(1), 's']
}
/** 健康检查一行的列宽，与设计稿一致（第二列改成「详情」）。 */
const HEALTH_COLS = { gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.4fr) 88px' } as const
export function GatewayPage({ t }: GatewayPageProps) {
  const [status, setStatus] = useState<PoolWebRelayStatus | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [flash, setFlash] = useState<string | undefined>(undefined)
  /**
   * 哪个字段刚被复制，让那个按钮自己显示「已复制」。
   *
   * 按字段记而不是一个全局布尔：否则复制完地址，密钥按钮也会显示「已复制」。
   */
  const [copiedField, setCopiedField] = useState<string | undefined>(undefined)
  const copyTimer = useRef<number | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [host, setHost] = useState<string>('127.0.0.1')
  const [port, setPort] = useState<string>('8326')
  /** 共享方式的草稿；undefined 表示跟随服务端。 */
  const [draftMode, setDraftMode] = useState<ShareMode | undefined>(undefined)
  /**
   * 自定义列表的草稿；undefined 表示跟随服务端。
   *
   * 保存是一个明确动作：取消勾选的模型，已经指向网关的设备会立刻开始收到 403。
   */
  const [draftShared, setDraftShared] = useState<ReadonlySet<string> | undefined>(undefined)
  const [query, setQuery] = useState('')
  const candidates = status?.candidates ?? []
  const serverMode = modeOf(status)
  const mode: ShareMode = draftMode ?? serverMode
  /**
   * 服务端记着的列表。
   *
   * `status.shared === undefined` 表示用户从没选过、网关全部放行 —— 切到「自定义」时
   * 要显示全部勾上，而不是空列表（那会被读成「什么都没共享」，一保存就把网关关上了）。
   */
  const serverShared = status?.shared ?? candidates.map(row => row.id)
  const shared = draftShared ?? new Set(serverShared)
  const sharedDirty = draftShared !== undefined
    && (draftShared.size !== serverShared.length
      || [...draftShared].some(id => !serverShared.includes(id)))
  const modeDirty = draftMode !== undefined && draftMode !== serverMode
  const shareDirty = modeDirty || (mode === 'custom' && sharedDirty)
  const sharedCount = candidates.filter(row => shared.has(row.id)).length
  const toggleShared = (id: string): void => {
    const next = new Set(shared)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setDraftShared(next)
  }
  const setManyShared = (ids: readonly string[], on: boolean): void => {
    const next = new Set(shared)
    for (const id of ids) {
      if (on) next.add(id)
      else next.delete(id)
    }
    setDraftShared(next)
  }
  /** 按渠道分组，并按搜索词过滤。同名模型在多个渠道下都有，平铺看不出勾的是哪一个。 */
  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const order: string[] = []
    const bySource = new Map<string, typeof candidates[number][]>()
    for (const row of candidates) {
      if (needle !== ''
        && !row.name.toLowerCase().includes(needle)
        && !row.id.toLowerCase().includes(needle)) continue
      const list = bySource.get(row.source)
      if (list === undefined) {
        bySource.set(row.source, [row])
        order.push(row.source)
      } else {
        list.push(row)
      }
    }
    /*
      每个渠道组里免费的排最前面：名字里写了「免费」/ x0.00，或是免 Key 的 free: 通道。
      同为免费或同为收费时保持后端给的顺序（sort 是稳定的）。
    */
    const freeRank = (row: { id: string; name: string }): number =>
      row.id.startsWith('free:') || isFreeChannelModel({ name: row.name }) ? 0 : 1
    return order.map(source => ({
      source,
      rows: [...(bySource.get(source) ?? [])].sort((a, b) => freeRank(a) - freeRank(b)),
    }))
  }, [candidates, query])
  /** 服务端的值只采纳一次，之后字段归用户，轮询不能覆盖正在编辑的端口。 */
  const seeded = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  const load = useCallback(async (signal?: AbortSignal): Promise<void> => {
    try {
      const response = await fetch(POOL_RELAY_PATH, {
        method: 'GET',
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
        ...signal === undefined ? {} : { signal },
      })
      const value: unknown = await response.json().catch(() => undefined)
      if (!response.ok) {
        const detail = value as { error?: string } | undefined
        if (mounted.current) setError(detail?.error ?? `HTTP ${response.status}`)
        return
      }
      if (mounted.current && signal?.aborted !== true) {
        const next = value as PoolWebRelayStatus
        setStatus(next)
        setError(undefined)
        // 只采纳一次存储的地址。之后字段归用户：轮询不能替换敲了一半的端口。
        if (!seeded.current) {
          seeded.current = true
          if (next.host !== '') setHost(next.host)
          if (next.port > 0) setPort(String(next.port))
        }
      }
    } catch (cause: unknown) {
      if (signal?.aborted === true) return
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    const timer = setInterval(() => { void load(controller.signal) }, POLL_MS)
    return () => {
      controller.abort()
      clearInterval(timer)
    }
  }, [load])
  /**
   * 发一个补丁。
   *
   * 响应就是新状态：被拒的端口、新生成的密钥、绑定失败，全部以服务端的回答为准，
   * 而不是本地的乐观修改。
   */
  const write = useCallback(async (patch: Record<string, unknown>): Promise<PoolWebRelayStatus | undefined> => {
    setBusy(true)
    try {
      const response = await fetch(POOL_RELAY_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(patch),
      })
      const value: unknown = await response.json().catch(() => undefined)
      if (!response.ok) {
        const detail = value as { error?: string } | undefined
        if (mounted.current) setFlash(`${t?.('gw.saveFailed') ?? '没能保存'}：${zhError(detail?.error ?? `HTTP ${response.status}`)}`)
        return undefined
      }
      if (!mounted.current) return undefined
      const next = value as PoolWebRelayStatus
      setStatus(next)
      setFlash(undefined)
      setError(undefined)
      // 新密钥是新秘密：复制完不该还亮在屏幕上，重新打码。
      setRevealed(false)
      return next
    } catch (cause: unknown) {
      if (mounted.current) setFlash(`${t?.('gw.saveFailed') ?? '没能保存'}：${zhError(cause instanceof Error ? cause.message : String(cause))}`)
      return undefined
    } finally {
      if (mounted.current) setBusy(false)
    }
  }, [t])
  /**
   * 复制客户端需要的字符串，并在那个按钮上提示「已复制」。失败要说出来，不能静默。
   */
  const copy = useCallback(async (field: string, value: string): Promise<void> => {
    const ok = await copyText(value)
    if (!mounted.current) return
    if (!ok) {
      setFlash(t?.('gw.copyFailed') ?? '复制失败，请手动选中文本复制。')
      return
    }
    setFlash(undefined)
    setCopiedField(field)
    if (copyTimer.current !== undefined) window.clearTimeout(copyTimer.current)
    copyTimer.current = window.setTimeout(() => {
      if (mounted.current) setCopiedField(undefined)
    }, 1600)
  }, [t])
  // 否则计时器会在卸载后触发。
  useEffect(() => () => {
    if (copyTimer.current !== undefined) window.clearTimeout(copyTimer.current)
  }, [])
  const enabled = status?.enabled === true
  const listening = status?.listening === true
  const key = status?.key ?? ''
  const parsedPort = Number(port)
  const portUsable = Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65_535
  /**
   * 客户端需要的地址，取自真正绑定上的 endpoint，而不是表单里填的端口：
   * 端口 0 由系统分配，0.0.0.0 在本机也拨不通。
   */
  const endpoint = status?.endpoint ?? ''
  /**
   * 不带 /v1 的 origin。
   *
   * 有的客户端自己拼 /v1（大多数 SDK），给它带 /v1 的地址会请求 /v1/v1/...；
   * 有的字段（OPENAI_BASE_URL）要完整前缀。所以两种都给，并写明各自适用哪种。
   */
  // endpoint 若不是字符串，.replace 会抛错 —— 类型声明是 string，运行时不一定
  const origin = (typeof endpoint === 'string' ? endpoint : '').replace(/\/+$/u, '')
  const baseUrl = origin === '' ? '' : `${origin}/v1`
  /** Base URL 和密钥两行带标签，粘进客户端或聊天里都看得懂。 */
  const configSnippet = baseUrl === '' || key === ''
    ? ''
    : `Base URL: ${baseUrl}\nAPI Key: ${key}`
  /** 客户端配置示例里的模型名：优先取一个已共享的。 */
  const sampleModel = (mode === 'custom'
    ? candidates.find(row => shared.has(row.id))
    : candidates[0])?.id ?? '模型 id'
  const jsonSnippet = baseUrl === '' || key === ''
    ? ''
    : JSON.stringify({ baseURL: baseUrl, apiKey: key, model: sampleModel }, null, 2)
  /**
   * 重启：先关再开。改了端口之后旧监听还在旧端口上，只写配置不重启，界面说「已开」实际还是旧端口。
   */
  const restart = useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
      await write({ enabled: false })
      await write({ enabled: true })
    } finally {
      setBusy(false)
    }
  }, [write])
  /** 保存共享设置。 */
  const saveShare = useCallback(async (): Promise<void> => {
    const next = mode === 'pool'
      ? await write({ modelsMode: 'pool' })
      : await write({ modelsMode: 'custom', models: [...shared] })
    if (next === undefined || !mounted.current) return
    setDraftMode(undefined)
    setDraftShared(undefined)
    if (mode === 'pool' && modeOf(next) !== 'pool') {
      // 旧后端不认 modelsMode：已经存过列表就回不到「按账号池」，如实告诉用户。
      setFlash('当前后端版本还不支持切回「按账号池启用列表」，请更新插件后再试。')
      return
    }
    setFlash(t?.('gw.shareSaved') ?? '网关共享设置已更新')
  }, [mode, shared, t, write])
  const discardShare = (): void => {
    setDraftMode(undefined)
    setDraftShared(undefined)
  }
  const [latency, latencyUnit] = latencyParts(status?.stats?.avgLatencyMs)
  const [inputNum, inputUnit] = splitTokens(status?.stats?.inputTokens ?? 0)
  const [outputNum, outputUnit] = splitTokens(status?.stats?.outputTokens ?? 0)
  const failed = status?.stats?.failed ?? 0
  const bindError = status?.error !== undefined && status.error !== '' ? zhError(status.error) : ''

  return (
    <main className="main">
      <header className="mhead">
        <div className="mhead-title">
          <span className="mhead-name">{t?.('gw.title') ?? '网关'}</span>
          <span className="mhead-org">把账号池暴露成 OpenAI 兼容接口</span>
          {/* 两种不同的状态：「开了但没监听」是用户必须看得见的故障，不能并进「已关」。 */}
          <span className="pill" data-tone={listening ? 'ok' : enabled ? 'warn' : 'off'}>
            {listening
              ? '运行中'
              : enabled
                ? (t?.('gw.notListening') ?? '已开但没监听')
                : '已关闭'}
          </span>
        </div>
        <div className="mhead-actions">
          <button
            type="button"
            className="btn"
            disabled={busy || !enabled}
            onClick={() => { void restart() }}
          >
            {t?.('gw.restart') ?? '重启'}
          </button>
          {enabled
            ? (
              <button
                type="button"
                className="btn btn-danger"
                disabled={busy}
                onClick={() => { void write({ enabled: false }) }}
              >
                关闭网关
              </button>
            )
            : (
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => { void write({ enabled: true }) }}
              >
                开启网关
              </button>
            )}
          <button
            type="button"
            className="btn btn-primary"
            disabled={baseUrl === ''}
            title={t?.('gw.copyV1Hint') ?? '要填完整前缀时用这个，例如 OPENAI_BASE_URL。'}
            onClick={() => { void copy('baseV1', baseUrl) }}
          >
            {copiedField === 'baseV1'
              ? (t?.('gw.copied') ?? '已复制')
              : (t?.('gw.copyAddress') ?? '复制地址')}
          </button>
        </div>
      </header>

      <div className="mbody">
        {/* 网关转过什么。计数是这个进程自己的，重启归零。 */}
        <div className="kpis">
          <div className="kpi">
            <span className="kpi-k">请求（本次启动）</span>
            <span className="kpi-v num">{String(status?.stats?.requests ?? 0)}</span>
            <span className="kpi-sub">{failed === 0 ? '没有失败' : `失败 ${String(failed)}`}</span>
          </div>
          <div className="kpi">
            <span className="kpi-k">平均延迟</span>
            <span className="kpi-v num">
              {latency}
              {latencyUnit === '' ? null : <span className="kpi-u">{latencyUnit}</span>}
            </span>
            <span className="kpi-sub">首 token</span>
          </div>
          <div className="kpi">
            <span className="kpi-k">输入</span>
            <span className="kpi-v num">
              {inputNum}
              {inputUnit === '' ? null : <span className="kpi-u">{inputUnit}</span>}
            </span>
            <span className="kpi-sub">token</span>
          </div>
          <div className="kpi">
            <span className="kpi-k">输出</span>
            <span className="kpi-v num">
              {outputNum}
              {outputUnit === '' ? null : <span className="kpi-u">{outputUnit}</span>}
            </span>
            <span className="kpi-sub">token</span>
          </div>
        </div>

        {status === undefined && error === undefined
          ? <div className="hint"><span>{t?.('gw.loading') ?? '正在读取中继状态……'}</span></div>
          : null}
        {error !== undefined
          ? <div className="hint"><b>读取失败</b><span>{zhError(error)}</span></div>
          : null}
        {flash !== undefined
          ? <div className="hint"><b>提示</b><span>{flash}</span></div>
          : null}

        <section className="sec">
          <div className="sec-head"><span className="sec-title">连接信息</span></div>
          <div className="card stack">
            <dl className="kv">
              <dt>地址</dt>
              <dd>
                <div className="row">
                  <span className="mono">{baseUrl === '' ? (enabled ? '等待监听…' : '网关未开启') : baseUrl}</span>
                  <button
                    type="button"
                    className="tiny"
                    disabled={origin === ''}
                    title={t?.('gw.copyOriginHint') ?? '客户端自己会补 /v1 时用这个（大多数 SDK）。'}
                    onClick={() => { void copy('base', origin) }}
                  >
                    {copiedField === 'base' ? (t?.('gw.copied') ?? '已复制') : '复制不含 /v1'}
                  </button>
                </div>
              </dd>
              <dt>鉴权</dt>
              <dd>
                <div className="row">
                  <span className="mono">
                    {key === '' ? (t?.('gw.noKey') ?? '还没有密钥 —— 打开网关时会顺手生成一把。') : `Bearer ${revealed ? key : maskOf(key)}`}
                  </span>
                  {key === ''
                    ? null
                    : (
                      <button
                        type="button"
                        className="tiny"
                        onClick={() => { setRevealed(current => !current) }}
                      >
                        {revealed ? (t?.('gw.hideKey') ?? '隐藏') : (t?.('gw.showKey') ?? '显示')}
                      </button>
                    )}
                </div>
              </dd>
              <dt>监听</dt>
              <dd>
                <div className="row">
                  <select
                    className="select"
                    style={{ width: 'auto' }}
                    aria-label={t?.('gw.host') ?? '绑定地址'}
                    value={host}
                    disabled={busy}
                    onChange={event => { setHost(event.target.value) }}
                  >
                    {HOSTS.map(option => (
                      <option key={option.value} value={option.value}>
                        {option.label}（{option.value}）
                      </option>
                    ))}
                  </select>
                  <input
                    className="input"
                    style={{ width: 96 }}
                    type="number"
                    aria-label={t?.('gw.port') ?? '端口'}
                    min={1}
                    max={65535}
                    value={port}
                    disabled={busy}
                    onChange={event => { setPort(event.target.value) }}
                  />
                  <button
                    type="button"
                    className="tiny"
                    disabled={busy || !portUsable}
                    onClick={() => { void write({ host, port: parsedPort }) }}
                  >
                    {t?.('gw.saveAddress') ?? '保存地址'}
                  </button>
                  {portUsable ? null : <span className="pill" data-tone="warn">端口要在 1–65535 之间</span>}
                </div>
              </dd>
              <dt>模型</dt>
              <dd>
                <div className="row">
                  <div className="seg" role="group" aria-label={t?.('gw.share') ?? '共享哪些模型'}>
                    <button
                      type="button"
                      aria-pressed={mode === 'pool' ? 'true' : 'false'}
                      disabled={busy}
                      onClick={() => { setDraftMode('pool') }}
                    >
                      按账号池启用列表
                    </button>
                    <button
                      type="button"
                      aria-pressed={mode === 'custom' ? 'true' : 'false'}
                      disabled={busy}
                      onClick={() => { setDraftMode('custom') }}
                    >
                      自定义
                    </button>
                  </div>
                  <span className="pick-sum">
                    {mode === 'pool'
                      ? `共 ${String(candidates.length)} 个可用模型`
                      : (t?.('gw.shareCount', { shared: sharedCount, total: candidates.length }) ?? `已共享 ${String(sharedCount)} / ${String(candidates.length)}`)}
                  </span>
                </div>
              </dd>
            </dl>
            <div className="row">
              <button
                type="button"
                className="btn"
                disabled={configSnippet === ''}
                title={t?.('gw.copyAllHint') ?? 'Base URL 和密钥分两行带标签，可直接粘进客户端。'}
                onClick={() => { void copy('all', configSnippet) }}
              >
                {copiedField === 'all' ? (t?.('gw.copied') ?? '已复制') : (t?.('gw.copyAll') ?? '复制全部')}
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy || key === ''}
                // 打码时复制的也是真实密钥：打码防的是旁人偷看，不是防用户自己。
                onClick={() => { void copy('key', key) }}
              >
                {copiedField === 'key'
                  ? (t?.('gw.copied') ?? '已复制')
                  : (t?.('gw.copyKey') ?? '复制密钥')}
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy}
                title={t?.('gw.keyHint') ?? '这把密钥在 DSH 重启后仍然有效。'}
                onClick={() => { void write({ key: '' }) }}
              >
                重置密钥
              </button>
              {enabled
                ? (
                  <button
                    type="button"
                    className="btn btn-danger"
                    disabled={busy}
                    onClick={() => { void write({ enabled: false }) }}
                  >
                    停止服务
                  </button>
                )
                : (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy}
                    onClick={() => { void write({ enabled: true }) }}
                  >
                    启动服务
                  </button>
                )}
            </div>
            {bindError === ''
              ? null
              : <div className="hint"><b>未监听</b><span>{bindError}</span></div>}
            <div className="hint">
              <b>注意</b>
              <span>
                {enabled
                  ? '停止后，正在用这个网关的客户端会立刻断开。账号池本身不受影响，重新启动就恢复。重置密钥会让所有还在用旧密钥的设备断线。'
                  : (t?.('gw.switchHint') ?? '打开后会为你的设备生成一把密钥，并绑定一个端口。')}
              </span>
            </div>

            {/* 共享哪些模型：并在连接信息里。自定义 = 按渠道勾选。 */}
            {mode === 'pool'
              ? (
                <p className="note">
                  账号池和已登录渠道里启用的模型全部可以通过网关调用；以后新启用的模型也会自动放行。
                </p>
              )
              : candidates.length === 0
                ? <p className="note">{t?.('gw.shareNone') ?? '暂时没有可共享的模型。'}</p>
                : (
                  <div className="stack" style={{ minWidth: 0 }}>
                    <div className="row">
                      <span className="pick-hint" style={{ flex: '1 1 160px' }}>
                        按渠道勾选要共享的模型，没勾的模型网关会直接拒绝。
                      </span>
                      <input
                        className="search"
                        type="search"
                        placeholder="搜索模型"
                        value={query}
                        onChange={event => { setQuery(event.target.value) }}
                      />
                      <button
                        type="button"
                        className="tiny"
                        disabled={busy}
                        onClick={() => { setManyShared(candidates.map(row => row.id), true) }}
                      >
                        {t?.('gw.shareAll') ?? '全选'}
                      </button>
                      <button
                        type="button"
                        className="tiny"
                        disabled={busy}
                        onClick={() => { setManyShared(candidates.map(row => row.id), false) }}
                      >
                        {t?.('gw.shareNoneBtn') ?? '全不选'}
                      </button>
                    </div>
                    {/* 长列表在区块内滚动，不撑高页面。 */}
                    <div
                      style={{
                        maxHeight: 360,
                        overflowY: 'auto',
                        overflowX: 'hidden',
                        minWidth: 0,
                        border: '1px solid var(--line)',
                        borderRadius: 'var(--r-md)',
                        padding: 'var(--s1) var(--s2) var(--s2)',
                        background: 'var(--bg)',
                      }}
                    >
                      {groups.length === 0
                        ? <p className="note" style={{ padding: 'var(--s2)' }}>没有匹配的模型</p>
                        : groups.map(group => {
                          const ids = group.rows.map(row => row.id)
                          const on = ids.filter(id => shared.has(id)).length
                          return (
                            <div key={group.source} style={{ minWidth: 0 }}>
                              <div
                                className="row"
                                style={{
                                  position: 'sticky',
                                  top: 0,
                                  zIndex: 1,
                                  background: 'var(--bg)',
                                  padding: 'var(--s2) var(--s2) 4px',
                                  flexWrap: 'nowrap',
                                }}
                              >
                                <span style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, color: 'var(--muted)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {sourceName(group.source)}
                                </span>
                                <span className="pick-sum">{String(on)} / {String(ids.length)}</span>
                                <span style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--s1)' }}>
                                  <button
                                    type="button"
                                    className="tiny"
                                    disabled={busy || on === ids.length}
                                    onClick={() => { setManyShared(ids, true) }}
                                  >
                                    全选
                                  </button>
                                  <button
                                    type="button"
                                    className="tiny"
                                    disabled={busy || on === 0}
                                    onClick={() => { setManyShared(ids, false) }}
                                  >
                                    清空
                                  </button>
                                </span>
                              </div>
                              {group.rows.map(row => (
                                <label className="mp-row" key={row.id}>
                                  <input
                                    type="checkbox"
                                    checked={shared.has(row.id)}
                                    disabled={busy}
                                    onChange={() => { toggleShared(row.id) }}
                                  />
                                  <span className="mp-main">
                                    {/* 先显示名（用户靠它挑），再是 id（客户端里要填的）。 */}
                                    <span className="mp-name">{row.name}</span>
                                    {/* id 是按钮：手抄 id 是 403 的来源。只复制 id，不复制显示名。 */}
                                    <button
                                      type="button"
                                      className="mp-id"
                                      style={{ border: 0, background: 'transparent', padding: 0, textAlign: 'left', cursor: 'copy', maxWidth: '100%' }}
                                      title={t?.('gw.copyModelIdHint') ?? '复制模型 id'}
                                      onClick={(event) => {
                                        // 行是 <label>：不拦的话点击会顺带切换勾选。
                                        event.preventDefault()
                                        event.stopPropagation()
                                        void copy(`id:${row.id}`, row.id)
                                      }}
                                    >
                                      {copiedField === `id:${row.id}`
                                        ? (t?.('gw.copied') ?? '已复制')
                                        : row.id}
                                    </button>
                                  </span>
                                </label>
                              ))}
                            </div>
                          )
                        })}
                    </div>
                  </div>
                )}
            {shareDirty
              ? (
                <div className="row">
                  <span className="pill" data-tone="warn">
                    {mode === 'custom'
                      ? (t?.('gw.shareDirty') ?? '尚未保存。')
                      : '尚未保存：保存后不再按勾选限制模型。'}
                  </span>
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--s2)' }}>
                    <button type="button" className="btn" disabled={busy} onClick={discardShare}>
                      撤销
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busy}
                      onClick={() => { void saveShare() }}
                    >
                      {t?.('gw.shareSave') ?? '保存共享设置'}
                    </button>
                  </span>
                </div>
              )
              : null}
          </div>
        </section>

        <section className="sec">
          <div className="sec-head">
            <span className="sec-title">客户端配置</span>
            <div className="sec-actions">
              <button
                type="button"
                className="tiny"
                disabled={jsonSnippet === ''}
                onClick={() => { void copy('json', jsonSnippet) }}
              >
                {copiedField === 'json' ? (t?.('gw.copied') ?? '已复制') : '复制'}
              </button>
            </div>
          </div>
          <div className="code">
            {'{\n  '}
            <b>"baseURL"</b>
            {`: "${baseUrl === '' ? 'http://127.0.0.1:端口/v1' : baseUrl}",\n  `}
            <b>"apiKey"</b>
            {`: "${key === '' ? '你的密钥' : maskOf(key)}",\n  `}
            <b>"model"</b>
            {`: "${sampleModel}"\n}`}
          </div>
          <div className="hint">
            <b>说明</b>
            <span>
              把这段填到任何支持 OpenAI 协议的客户端里即可，「复制」会带上真实密钥。模型名用上面已共享的任意一个 id。
              {t?.('gw.wire') ?? '只支持 Chat Completions（/v1/chat/completions 与 /v1/models）。'}
            </span>
          </div>
        </section>

        <section className="sec">
          <div className="sec-head"><span className="sec-title">健康检查</span></div>
          <div className="table">
            <div className="tr tr-head" style={HEALTH_COLS}>
              <span className="td">检查项</span><span className="td">详情</span><span className="td td-num">结果</span>
            </div>
            <div className="tr" style={HEALTH_COLS}>
              <span className="td">端口监听</span>
              <span className="td td-mono">{listening ? endpoint : enabled ? (bindError === '' ? '正在绑定' : bindError) : '网关未开启'}</span>
              <span className="td td-num">
                <span className="pill" data-tone={listening ? 'ok' : enabled ? 'err' : 'off'}>
                  {listening ? '通过' : enabled ? '失败' : '未启用'}
                </span>
              </span>
            </div>
            <div className="tr" style={HEALTH_COLS}>
              <span className="td">访问密钥</span>
              <span className="td td-mono">{key === '' ? '尚未生成' : maskOf(key)}</span>
              <span className="td td-num">
                <span className="pill" data-tone={key === '' ? 'warn' : 'ok'}>{key === '' ? '缺失' : '通过'}</span>
              </span>
            </div>
            <div className="tr" style={HEALTH_COLS}>
              <span className="td">账号池可读</span>
              <span className="td td-mono">{status === undefined ? '读取中' : `${String(candidates.length)} 个模型`}</span>
              <span className="td td-num">
                <span className="pill" data-tone={candidates.length > 0 ? 'ok' : 'warn'}>{candidates.length > 0 ? '通过' : '无模型'}</span>
              </span>
            </div>
            <div className="tr" style={HEALTH_COLS}>
              <span className="td">共享范围</span>
              <span className="td td-mono">
                {serverMode === 'pool'
                  ? '按账号池启用列表'
                  : `自定义 · ${String(candidates.filter(row => (status?.shared ?? []).includes(row.id)).length)} 个`}
              </span>
              <span className="td td-num">
                <span
                  className="pill"
                  data-tone={serverMode === 'custom' && (status?.shared ?? []).length === 0 ? 'warn' : 'ok'}
                >
                  {serverMode === 'custom' && (status?.shared ?? []).length === 0 ? '全部拒绝' : '通过'}
                </span>
              </span>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}

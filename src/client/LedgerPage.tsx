/**
 * 数据看板（ledger）页。
 *
 * 照设计稿 xdpool-design/ledger.html 的顺序：先给总数，再看变化，最后才是明细。
 *
 *   main.main
 *     header.mhead   标题「数据看板」· 说明 · 导出 CSV / 清空
 *     div.mbody
 *       .filters     今天 / 7 天 / 30 天 / 全部 · 全部渠道 · 全部模型 · 只看失败
 *       .summary     六格：轮次 / 调用 / Token / 缓存命中 / 费用 / 输出速度
 *       .trend       每天用量（按渠道堆叠，Token / 调用 切换）
 *       .ranks       按渠道 / 按模型 / 按账号
 *       section.sec  最近调用（搜索 + 五列明细表）+ 说明
 *
 * 两条区分是这一页存在的理由，改版时最容易丢：
 *
 * - **轮次不是调用。** 一次提问换了三个号，是一轮、三次调用。两个数字永远分开写。
 * - **「没有 token」不是「没上报」。** 网关不理 stream_options 时 token 全是 0，
 *   只有 `usageReported` 能把两者分开；为 false 时写「未上报」，绝不印一个底气十足的 0。
 *
 * 筛选全在前端做：后端把保留的每一次调用（entries）都发过来了，筛选后的统计
 * 用后端同一个 `UsageRecorder` 重新汇总 —— 同一套算法，KPI 和榜单不可能对不上。
 *
 * @module dsh-xdpool/client/LedgerPage
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import { POOL_USAGE_PATH } from '../status-paths.ts'
import { USAGE_MAX_SAMPLES, UsageRecorder, usageDayKey } from '../stats.ts'
import type { UsageAccountRow, UsageCall, UsageDay, UsageRow, UsageSummary } from '../stats.ts'
import type { XdPoolSettingsKey } from './locales.ts'
import {
  DayChart,
  RankList,
  brandIconStyle,
  brandKey,
  brandName,
  byChannel,
  byModel,
  fmtTokens,
  splitTokens,
} from './ledger-charts.tsx'
import type { DaySegment, RankItem, TrendMetric } from './ledger-charts.tsx'
/** The translator the settings section injects. */
type Translate = (key: XdPoolSettingsKey, params?: Record<string, unknown>) => string
export interface LedgerPageProps {
  t?: Translate | undefined
  /**
   * The aggregate, if the parent already has it.
   *
   * The pool card polls usage for its own compact panel; passing that down
   * means this page renders from the first paint and keeps sharing one fetch
   * rather than opening a second identical one.
   */
  usage?: UsageSummary | undefined
}
/** 最近调用表最多列几行。 */
const DETAIL_ROWS = 20
/** 明细表五列：模型 / 输入 / 输出 / 缓存 / 耗时 —— 与设计稿同一个网格。 */
const TABLE_GRID: CSSProperties = { gridTemplateColumns: 'minmax(0,1fr) 88px 88px 80px 72px' }
const DAY_MS = 86_400_000

type Range = 'today' | 'week' | 'month' | 'all'
/** 时间范围。days 为 0 表示不限。 */
const RANGES: readonly { id: Range; label: string; days: number }[] = [
  { id: 'today', label: '今天', days: 1 },
  { id: 'week', label: '7 天', days: 7 },
  { id: 'month', label: '30 天', days: 30 },
  { id: 'all', label: '全部', days: 0 },
]

/**
 * 一个整数，用逗号分千位。
 *
 * 收 undefined 时返回「—」而不是抛错：这个函数喂的是上游聚合出来的字段，
 * 一条记录缺字段（老样本、某渠道不报 cached）在真实数据里是常态。
 * 原来直接 .toLocaleString()，一个缺字段就让整页白屏 —— 用户报的
 * 「点数据面板直接空白」就是它。
 */
function fmtInt(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return value.toLocaleString('en-US')
}
/** 毫秒写成 `1.2s` / `340ms`。 */
function fmtMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—'
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${String(Math.round(ms))}ms`
}
function fmtClock(at: number): string {
  const d = new Date(at)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${String(d.getMonth() + 1)}/${String(d.getDate())} ${hh}:${mm}`
}
/** 往前数 offset 天那一天的本地零点。 */
function startOfDay(offset: number): number {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - offset).getTime()
}
function startOfDayAt(at: number): number {
  const d = new Date(at)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}
/**
 * 缓存命中率；一个输入 token 都没数到时返回 null。
 *
 * cachedTokens 是 inputTokens 的一部分（见 stats.ts 的 TokenUsage），所以分母是输入。
 * null 而不是 0：`usageReported === false` 时分子分母都不存在，印「0%」等于
 * 说缓存从没帮上忙，而实际是什么都没测到。
 */
function cacheHitRate(summary: UsageSummary): number | null {
  let input = 0
  let cached = 0
  for (const row of Array.isArray(summary.rows) ? summary.rows : []) {
    input += row.inputTokens
    cached += row.cachedTokens
  }
  const total = input
  return total === 0 ? null : Math.min(1, cached / total)
}
/**
 * 一次调用的三个数字：输入、输出、缓存。没有用量块时三个都是「—」。
 *
 * 固定长度的元组而不是 `string[]`：表格用 `.map` 渲染，少一个或多一个值
 * 会让后面每一列和表头错位，而 `string[]` 类型看不出来。
 */
function tokenCells(call: UsageCall): readonly [string, string, string] {
  if (call.usage === undefined) return ['—', '—', '—']
  return [
    fmtInt(call.usage.inputTokens),
    fmtInt(call.usage.outputTokens),
    call.usage.cachedTokens > 0 ? fmtInt(call.usage.cachedTokens) : '—',
  ]
}
/** 一次调用总耗时：首字 + 生成。两个都没有时返回 undefined。 */
function durationOf(call: UsageCall): number | undefined {
  if (call.ttftMs === undefined && call.decodeMs === undefined) return undefined
  return (call.ttftMs ?? 0) + (call.decodeMs ?? 0)
}

/* ---------------- 坏数据兜底 ---------------- */

const num = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : 0)
const numOrNull = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null)
const str = (x: unknown): string => (typeof x === 'string' ? x : '')
/** 数组里的 null / 非对象也要掉：读它的 .inputTokens 会直接抛错。 */
const objs = (x: unknown): Record<string, unknown>[] =>
  (Array.isArray(x) ? (x as unknown[]) : [])
    .filter((r): r is Record<string, unknown> => r !== null && typeof r === 'object' && !Array.isArray(r))

function sanitizeCall(v: Record<string, unknown>, index: number): UsageCall {
  const at = num(v.at)
  const turnId = str(v.turnId)
  const call: UsageCall = {
    channel: str(v.channel),
    region: str(v.region),
    model: str(v.model),
    turnId: turnId === '' ? `#${String(at)}:${String(index)}` : turnId,
    at,
    ok: v.ok !== false,
  }
  const account = str(v.account)
  if (account !== '') call.account = account
  const ttftMs = v.ttftMs
  if (typeof ttftMs === 'number' && Number.isFinite(ttftMs) && ttftMs >= 0) call.ttftMs = ttftMs
  const decodeMs = v.decodeMs
  if (typeof decodeMs === 'number' && Number.isFinite(decodeMs) && decodeMs >= 0) call.decodeMs = decodeMs
  const usage = v.usage
  if (usage !== null && typeof usage === 'object' && !Array.isArray(usage)) {
    const u = usage as Record<string, unknown>
    call.usage = {
      inputTokens: num(u.inputTokens),
      outputTokens: num(u.outputTokens),
      reasoningTokens: num(u.reasoningTokens),
      cachedTokens: num(u.cachedTokens),
    }
  }
  return call
}
function sanitizeRow(v: Record<string, unknown>): UsageRow {
  return {
    channel: str(v.channel),
    region: str(v.region),
    model: str(v.model),
    calls: num(v.calls),
    turns: num(v.turns),
    failed: num(v.failed),
    recovered: num(v.recovered),
    inputTokens: num(v.inputTokens),
    outputTokens: num(v.outputTokens),
    reasoningTokens: num(v.reasoningTokens),
    cachedTokens: num(v.cachedTokens),
    tps: numOrNull(v.tps),
    avgTtftMs: numOrNull(v.avgTtftMs),
    lastUsedAt: num(v.lastUsedAt),
  }
}
function sanitizeAccount(v: Record<string, unknown>): UsageAccountRow {
  return {
    account: str(v.account),
    channel: str(v.channel),
    region: str(v.region),
    calls: num(v.calls),
    turns: num(v.turns),
    failed: num(v.failed),
    inputTokens: num(v.inputTokens),
    outputTokens: num(v.outputTokens),
    cachedTokens: num(v.cachedTokens),
    lastUsedAt: num(v.lastUsedAt),
    topModels: Array.isArray(v.topModels) ? (v.topModels as unknown[]).filter((m): m is string => typeof m === 'string') : [],
  }
}
function sanitizeDay(v: Record<string, unknown>): UsageDay {
  return {
    day: str(v.day),
    calls: num(v.calls),
    failedTurns: num(v.failedTurns),
    inputTokens: num(v.inputTokens),
    outputTokens: num(v.outputTokens),
  }
}

/**
 * 把任何形状的用量应答整理成组件能直接用的样子。
 *
 * 后端的类型声明说这些是数组、是数字，但运行时可以给任何东西（应答被中间层改过、
 * 版本不匹配）。一个 `.reduce is not a function` 就能让整页白掉，
 * 读者看到的是「插件坏了」，不是「数据不对」。宁可少显示一个数字，不能整页空白。
 */
function normalizeSummary(raw: unknown): UsageSummary | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const v = raw as Record<string, unknown>
  return {
    samples: num(v.samples),
    turns: num(v.turns),
    failedTurns: num(v.failedTurns),
    recoveredTurns: num(v.recoveredTurns),
    calls: num(v.calls),
    usageReported: v.usageReported === true,
    entries: objs(v.entries).map((entry, index) => sanitizeCall(entry, index)),
    rows: objs(v.rows).map(sanitizeRow),
    accounts: objs(v.accounts).map(sanitizeAccount),
    days: objs(v.days).map(sanitizeDay).filter(day => day.day !== ''),
  }
}

/**
 * 用后端同一个汇总器，把筛过的调用重新汇总一遍。
 *
 * entries 是新的在前，记录器要按时间顺序喂，所以倒着放进去。
 */
function summarize(calls: readonly UsageCall[]): UsageSummary {
  const recorder = new UsageRecorder(Math.max(1, calls.length))
  for (let i = calls.length - 1; i >= 0; i -= 1) {
    const call = calls[i]
    if (call !== undefined) recorder.record(call)
  }
  return recorder.summary()
}

/** 汇总条的一格（设计稿的 .sum-cell）。 */
function SumCell({ label, value, unit, sub, tone, title }: {
  label: string
  value: string
  unit?: string | undefined
  sub: string
  tone?: 'ok' | 'warn' | 'err' | undefined
  title?: string | undefined
}): ReactElement {
  return (
    <div className="sum-cell" title={title}>
      <span className="sum-k">{label}</span>
      <span className="sum-v num">
        {value}
        {unit === undefined || unit === '' ? null : <span className="sum-u">{unit}</span>}
      </span>
      <span className="sum-sub" data-tone={tone}>{sub}</span>
    </div>
  )
}

/**
 * 「全部渠道」「全部模型」这种带下拉的筛选芯片。
 *
 * 弹层 position:absolute，挂在芯片自己的包装层里，不会跑到 main 外面去。
 */
function FilterPick({ allLabel, value, options, onPick }: {
  allLabel: string
  value: string
  options: readonly { key: string; label: string }[]
  onPick: (key: string) => void
}): ReactElement {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return undefined
    const onDown = (event: MouseEvent): void => {
      const target = event.target
      if (box.current !== null && target instanceof Node && box.current.contains(target)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  const current = options.find(option => option.key === value)
  return (
    <span ref={box} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        className="chip"
        aria-pressed={current !== undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={options.length === 0 && current === undefined}
        title={options.length === 0 ? '这段时间没有记录' : undefined}
        onClick={() => { setOpen(!open) }}
      >
        {current === undefined ? allLabel : current.label}
      </button>
      {open
        ? (
          <div
            role="listbox"
            aria-label={allLabel}
            style={{
              position: 'absolute',
              top: 'calc(100% + 4px)',
              left: 0,
              zIndex: 30,
              minWidth: 180,
              maxWidth: 300,
              maxHeight: 280,
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              padding: 4,
              background: 'var(--surface)',
              border: '1px solid var(--line-2)',
              borderRadius: 'var(--r-md)',
              /*
                投影走变量：亮色主题在 theme-css.ts 里给了柔化版（纯黑 35% 在
                浅底上比卡片自带的 --sh-* 重得多，会显脏）。暗色取不到这个变量，
                退回原值 —— 外观一个像素都不变。
              */
              boxShadow: 'var(--xd-pop-shadow, 0 8px 24px rgba(0,0,0,.35))',
            }}
          >
            {[{ key: '', label: allLabel }, ...options].map(option => (
              <button
                key={option.key === '' ? '*' : option.key}
                type="button"
                role="option"
                aria-selected={option.key === (current?.key ?? '')}
                className="chip"
                aria-pressed={option.key === (current?.key ?? '')}
                style={{
                  justifyContent: 'flex-start',
                  border: 0,
                  borderRadius: 'var(--r-sm)',
                  width: '100%',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                onClick={() => {
                  onPick(option.key)
                  setOpen(false)
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        )
        : null}
    </span>
  )
}

export function LedgerPage({ t, usage: shared }: LedgerPageProps) {
  const [own, setOwn] = useState<UsageSummary | undefined>(() => normalizeSummary(shared))
  const [clearing, setClearing] = useState(false)
  const [failed, setFailed] = useState(false)
  /** 时间范围。设计稿默认选中「7 天」。 */
  const [range, setRange] = useState<Range>('week')
  /** 渠道 / 模型筛选，空串表示全部。 */
  const [channelPick, setChannelPick] = useState('')
  const [modelPick, setModelPick] = useState('')
  /** 只看失败：保留「出过失败的那几轮」的全部调用，这样换号救回也看得见。 */
  const [failedOnly, setFailedOnly] = useState(false)
  const [metric, setMetric] = useState<TrendMetric>('tokens')
  const [query, setQuery] = useState('')
  const mounted = useRef(true)

  // Adopt the parent's copy whenever it arrives, so opening this page shows the
  // numbers that already exist instead of a skeleton for one poll interval.
  useEffect(() => {
    if (shared !== undefined) setOwn(normalizeSummary(shared))
  }, [shared])
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  /**
   * 只在这一页挂着时轮询。父组件已经在轮询并把数据传下来时，这里什么都不拉。
   */
  const load = useCallback(async (signal?: AbortSignal): Promise<void> => {
    try {
      const response = await fetch(POOL_USAGE_PATH, {
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
        ...signal === undefined ? {} : { signal },
      })
      if (!response.ok) {
        if (mounted.current) setFailed(true)
        return
      }
      const value: unknown = await response.json().catch(() => undefined)
      if (mounted.current && signal?.aborted !== true) {
        setOwn(normalizeSummary(value))
        setFailed(false)
      }
    } catch {
      if (mounted.current && signal?.aborted !== true) setFailed(true)
    }
  }, [])
  useEffect(() => {
    if (shared !== undefined) return
    const controller = new AbortController()
    void load(controller.signal)
    const timer = window.setInterval(() => { void load(controller.signal) }, 30_000)
    return () => {
      window.clearInterval(timer)
      controller.abort()
    }
  }, [load, shared])

  /** 清空记录。DELETE 之后重新读一次，免得界面还挂着旧数字。 */
  const clearUsage = useCallback(async () => {
    setClearing(true)
    try {
      await fetch(POOL_USAGE_PATH, { method: 'DELETE', credentials: 'same-origin' })
      const res = await fetch(POOL_USAGE_PATH, { headers: { accept: 'application/json' }, credentials: 'same-origin' })
      if (res.ok && mounted.current) setOwn(normalizeSummary(await res.json()))
    } catch { /* 失败时保留原有数字，读者能看出没清掉 */ }
    finally {
      if (mounted.current) setClearing(false)
    }
  }, [])

  /* ---------------- 筛选 ---------------- */

  const allEntries: readonly UsageCall[] = own?.entries ?? []
  /** 后端没给逐条记录（老版本）时，筛选无从做起，整页退回后端的汇总。 */
  const canFilter = allEntries.length > 0
  const rangeDays = RANGES.find(item => item.id === range)?.days ?? 0
  const rangeEntries = useMemo(() => {
    if (rangeDays === 0) return allEntries
    const since = startOfDay(rangeDays - 1)
    return allEntries.filter(entry => entry.at >= since)
  }, [allEntries, rangeDays])
  const channelOptions = useMemo(() => {
    const seen = new Map<string, number>()
    for (const entry of rangeEntries) {
      const key = brandKey(entry.channel, entry.region)
      seen.set(key, (seen.get(key) ?? 0) + 1)
    }
    return [...seen.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([key]) => ({ key, label: brandName(key) }))
  }, [rangeEntries])
  const channelSel = channelOptions.some(option => option.key === channelPick) ? channelPick : ''
  const channelEntries = useMemo(
    () => (channelSel === '' ? rangeEntries : rangeEntries.filter(entry => brandKey(entry.channel, entry.region) === channelSel)),
    [rangeEntries, channelSel],
  )
  const modelOptions = useMemo(() => {
    const seen = new Map<string, number>()
    for (const entry of channelEntries) seen.set(entry.model, (seen.get(entry.model) ?? 0) + 1)
    return [...seen.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([key]) => ({ key, label: key === '' ? '未知模型' : key }))
  }, [channelEntries])
  const modelSel = modelOptions.some(option => option.key === modelPick) ? modelPick : ''
  const scopeEntries = useMemo(
    () => (modelSel === '' ? channelEntries : channelEntries.filter(entry => entry.model === modelSel)),
    [channelEntries, modelSel],
  )
  /** 这个范围里失败的调用次数（决定「只看失败」能不能点）。 */
  const failedTotal = useMemo(() => scopeEntries.filter(entry => !entry.ok).length, [scopeEntries])
  const failedOn = failedOnly && failedTotal > 0
  const viewEntries = useMemo(() => {
    if (!failedOn) return scopeEntries
    const turnIds = new Set(scopeEntries.filter(entry => !entry.ok).map(entry => entry.turnId))
    return scopeEntries.filter(entry => turnIds.has(entry.turnId))
  }, [scopeEntries, failedOn])
  const filtered = range !== 'all' || channelSel !== '' || modelSel !== '' || failedOn

  /** 页面上所有数字都从这一份来。 */
  const summary = useMemo((): UsageSummary | undefined => {
    if (own === undefined) return undefined
    if (!canFilter || !filtered) return own
    return summarize(viewEntries)
  }, [own, canFilter, filtered, viewEntries])

  /**
   * 合计从 rows 加出来，不另取一个服务端合计 —— 加的就是下面榜单用的那几行，
   * KPI 和榜单就不可能对不上。
   */
  const totals = useMemo(() => {
    if (summary === undefined) return undefined
    let input = 0
    let output = 0
    let reasoning = 0
    let cached = 0
    let tpsWeighted = 0
    let tpsWeight = 0
    let ttftWeighted = 0
    let ttftWeight = 0
    for (const row of Array.isArray(summary.rows) ? summary.rows : []) {
      input += row.inputTokens
      output += row.outputTokens
      reasoning += row.reasoningTokens
      cached += row.cachedTokens
      // 按调用次数加权，不是简单平均：只有一次快调用的模型不该和跑了一千轮的模型一样拉动均值。
      if (row.tps !== null) {
        tpsWeighted += row.tps * row.calls
        tpsWeight += row.calls
      }
      if (row.avgTtftMs !== null) {
        ttftWeighted += row.avgTtftMs * row.calls
        ttftWeight += row.calls
      }
    }
    return {
      input,
      output,
      reasoning,
      cached,
      avgTps: tpsWeight === 0 ? null : Math.round(tpsWeighted / tpsWeight),
      avgTtftMs: ttftWeight === 0 ? null : Math.round(ttftWeighted / ttftWeight),
    }
  }, [summary])

  const todayKey = usageDayKey(Date.now())
  /**
   * 趋势图：连续的日期（没调用的那天也占一根空柱），每根按渠道分段。
   */
  const chart = useMemo((): { days: readonly UsageDay[]; segments: ReadonlyMap<string, readonly DaySegment[]> | undefined } => {
    if (summary === undefined) return { days: [], segments: undefined }
    if (!canFilter) return { days: summary.days, segments: undefined }
    if (viewEntries.length === 0) return { days: [], segments: undefined }
    let span = rangeDays
    if (span === 0) {
      let earliest = Number.POSITIVE_INFINITY
      for (const entry of viewEntries) if (entry.at < earliest) earliest = entry.at
      const diff = Math.round((startOfDay(0) - startOfDayAt(earliest)) / DAY_MS)
      span = Math.min(30, Math.max(1, diff + 1))
    }
    const keys: string[] = []
    for (let i = span - 1; i >= 0; i -= 1) keys.push(usageDayKey(startOfDay(i)))
    const dayAcc = new Map<string, { calls: number; input: number; output: number; failed: Set<string> }>()
    const segAcc = new Map<string, Map<string, DaySegment>>()
    for (const key of keys) {
      dayAcc.set(key, { calls: 0, input: 0, output: 0, failed: new Set<string>() })
      segAcc.set(key, new Map<string, DaySegment>())
    }
    const brandWeight = new Map<string, number>()
    let counted = 0
    for (const entry of viewEntries) {
      const key = usageDayKey(entry.at)
      const acc = dayAcc.get(key)
      const segs = segAcc.get(key)
      if (acc === undefined || segs === undefined) continue
      counted += 1
      const input = entry.usage?.inputTokens ?? 0
      const output = entry.usage?.outputTokens ?? 0
      acc.calls += 1
      acc.input += input
      acc.output += output
      if (!entry.ok) acc.failed.add(entry.turnId)
      const brand = brandKey(entry.channel, entry.region)
      const seg = segs.get(brand)
      segs.set(brand, { key: brand, tokens: (seg?.tokens ?? 0) + input + output, calls: (seg?.calls ?? 0) + 1 })
      brandWeight.set(brand, (brandWeight.get(brand) ?? 0) + input + output + 1)
    }
    if (counted === 0) return { days: [], segments: undefined }
    const days: UsageDay[] = []
    const segments = new Map<string, readonly DaySegment[]>()
    for (const key of keys) {
      const acc = dayAcc.get(key)
      const segs = segAcc.get(key)
      if (acc === undefined || segs === undefined) continue
      days.push({ day: key, calls: acc.calls, failedTurns: acc.failed.size, inputTokens: acc.input, outputTokens: acc.output })
      /* 小的在上、大的在下，和设计稿一样 */
      segments.set(key, [...segs.values()].sort((a, b) => (brandWeight.get(a.key) ?? 0) - (brandWeight.get(b.key) ?? 0)))
    }
    return { days, segments }
  }, [summary, canFilter, viewEntries, rangeDays])

  const accountItems = useMemo((): readonly RankItem[] => (summary?.accounts ?? []).map(row => {
    const brand = brandKey(row.channel, row.region)
    const models = (row.topModels ?? []).join('、')
    return {
      key: `${brand}\u0000${row.region}\u0000${row.account}`,
      label: row.account === '' ? '未归属到账号' : row.account,
      brand,
      tokens: row.inputTokens + row.outputTokens,
      calls: row.calls,
      title: `${brandName(brand)} · 轮次 ${String(row.turns)} · 调用 ${String(row.calls)}${models === '' ? '' : ` · 常跑 ${models}`}`,
    }
  }), [summary])

  /** 最近调用：筛选后的逐条记录，再按搜索词过滤。 */
  const details = useMemo(() => {
    const source = canFilter ? viewEntries : (summary?.entries ?? [])
    const q = query.trim().toLowerCase()
    const hit = q === ''
      ? source
      : source.filter(entry => {
        const brand = brandKey(entry.channel, entry.region)
        return entry.model.toLowerCase().includes(q)
          || brandName(brand).toLowerCase().includes(q)
          || brand.toLowerCase().includes(q)
          || (entry.account ?? '').toLowerCase().includes(q)
      })
    return Array.isArray(hit) ? hit.slice(0, DETAIL_ROWS) : []
  }, [canFilter, viewEntries, summary, query])

  /**
   * 导出 CSV：导出当前筛选下的按模型汇总。
   *
   * 前端生成 Blob，不经过后端：这份数据本来就在内存里。值原样输出 ——
   * 把数字格式化成 "1.2k" 会让它没法再算。BOM 是给 Excel 认 UTF-8 中文用的。
   */
  const exportCsv = useCallback(() => {
    const rows = summary?.rows ?? []
    if (rows.length === 0) return
    const head = ['渠道', '线路', '模型', '调用', '轮次', '失败', '换号救回',
      '输入 token', '输出 token', '推理 token', '缓存 token', '输出速度 tok/s', '平均首字毫秒', '最后使用']
    const esc = (v: unknown): string => {
      const s2 = v === null || v === undefined ? '' : String(v)
      return /[",\n]/.test(s2) ? `"${s2.replace(/"/g, '""')}"` : s2
    }
    const lines = [head.map(esc).join(',')]
    for (const r of rows) {
      lines.push([brandName(brandKey(r.channel, r.region)), r.region, r.model, r.calls, r.turns, r.failed, r.recovered,
        r.inputTokens, r.outputTokens, r.reasoningTokens, r.cachedTokens,
        r.tps, r.avgTtftMs, r.lastUsedAt > 0 ? new Date(r.lastUsedAt).toISOString() : '',
      ].map(esc).join(','))
    }
    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `xdpool-usage-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [summary])

  const tokenTotal = (totals?.input ?? 0) + (totals?.output ?? 0)
  const [tokNum, tokUnit] = splitTokens(tokenTotal)
  const rate = summary === undefined ? null : cacheHitRate(summary)
  const rankBy: 'tokens' | 'calls' = summary?.usageReported === true ? 'tokens' : 'calls'

  return (
    <main className="main">
      <header className="mhead">
        <div className="mhead-title">
          <span className="mhead-name">数据看板</span>
          <span className="mhead-org">{`全部渠道汇总 · 内存中保留最近 ${String(USAGE_MAX_SAMPLES)} 次调用`}</span>
        </div>
        <div className="mhead-actions">
          <button
            type="button"
            className="btn"
            disabled={summary === undefined || summary.rows.length === 0}
            onClick={() => { exportCsv() }}
          >
            导出 CSV
          </button>
          <button
            type="button"
            className="btn"
            disabled={clearing || (own?.calls ?? 0) === 0}
            onClick={() => { void clearUsage() }}
          >
            {clearing ? '清空中…' : '清空'}
          </button>
        </div>
      </header>
      <div className="mbody">
        {failed
          ? <div className="hint" role="alert"><b>提示</b><span>读不到用量数据，号池本身不受影响。</span></div>
          : null}

        <div className="filters">
          {RANGES.map(item => (
            <button
              key={item.id}
              type="button"
              className="chip"
              aria-pressed={range === item.id}
              disabled={!canFilter && item.id !== 'all'}
              onClick={() => { setRange(item.id) }}
            >
              {item.label}
            </button>
          ))}
          <span style={{ width: 8 }} />
          <FilterPick
            allLabel="全部渠道"
            value={channelSel}
            options={channelOptions}
            onPick={key => {
              setChannelPick(key)
              setModelPick('')
            }}
          />
          <FilterPick allLabel="全部模型" value={modelSel} options={modelOptions} onPick={setModelPick} />
          <button
            type="button"
            className="chip"
            aria-pressed={failedOn}
            disabled={failedTotal === 0}
            title={failedTotal === 0 ? '这段时间没有失败' : undefined}
            onClick={() => { setFailedOnly(!failedOn) }}
          >
            只看失败
            {failedTotal > 0 ? ` ${String(failedTotal)}` : ''}
          </button>
        </div>

        {summary === undefined
          ? <div className="hint"><span>正在读取记录下来的调用…</span></div>
          : (
            <>
              <div className="summary">
                <SumCell
                  label={t?.('ledger.turns') ?? '轮次'}
                  value={fmtInt(summary.turns)}
                  sub={`失败 ${fmtInt(summary.failedTurns)} · 换号救回 ${fmtInt(summary.recoveredTurns)}`}
                  tone={summary.failedTurns > 0 ? 'err' : 'ok'}
                />
                <SumCell
                  label="调用"
                  value={fmtInt(summary.calls)}
                  sub={summary.turns > 0 ? `每轮 ${(summary.calls / summary.turns).toFixed(1)} 次` : '还没有调用'}
                />
                <SumCell
                  label="Token"
                  value={summary.usageReported ? tokNum : (summary.calls === 0 ? '—' : (t?.('ledger.notReported') ?? '未上报'))}
                  unit={summary.usageReported ? tokUnit : undefined}
                  sub={summary.usageReported
                    ? `输入 ${fmtTokens(totals?.input ?? 0)} · 输出 ${fmtTokens(totals?.output ?? 0)}`
                    : (summary.calls === 0 ? '暂无数据' : '网关没有上报 token 数')}
                  title={summary.usageReported ? fmtInt(totals?.input ?? 0) + ' 输入 · ' + fmtInt(totals?.output ?? 0) + ' 输出' : undefined}
                />
                <SumCell
                  label="缓存命中"
                  value={rate === null || !summary.usageReported ? '—' : (rate * 100).toFixed(1)}
                  unit={rate === null || !summary.usageReported ? undefined : '%'}
                  sub={rate === null || !summary.usageReported ? '暂无数据' : `省 ${fmtTokens(totals?.cached ?? 0)}`}
                  tone={rate === null || !summary.usageReported ? undefined : 'ok'}
                />
                <SumCell
                  label="费用"
                  value="—"
                  sub="暂无数据"
                  title="没有各模型的价格表，算不出费用"
                />
                <SumCell
                  label="输出速度"
                  value={totals?.avgTps === null || totals?.avgTps === undefined ? '—' : fmtInt(totals.avgTps)}
                  unit={totals?.avgTps === null || totals?.avgTps === undefined ? undefined : 'tok/s'}
                  sub={totals?.avgTtftMs === null || totals?.avgTtftMs === undefined
                    ? '没有计时数据'
                    : `首 token 平均 ${(totals.avgTtftMs / 1000).toFixed(1)} 秒`}
                />
              </div>

              <DayChart
                title="每天用量"
                days={chart.days}
                segments={chart.segments}
                metric={metric}
                onMetric={setMetric}
                todayKey={todayKey}
                emptyLabel="暂无数据"
              />

              <div className="ranks">
                <RankList title="按渠道" unit="渠道" items={byChannel(summary.rows)} by={rankBy} emptyLabel="暂无数据" />
                <RankList title="按模型" unit="模型" items={byModel(summary.rows)} by={rankBy} emptyLabel="暂无数据" />
                <RankList title="按账号" unit="账号" items={accountItems} by={rankBy} emptyLabel="暂无数据" />
              </div>

              <section className="sec">
                <div className="sec-head">
                  <span className="sec-title">最近调用</span>
                  <span className="sec-actions">
                    <input
                      className="search"
                      type="search"
                      placeholder="搜索模型或渠道"
                      aria-label="搜索模型或渠道"
                      value={query}
                      onChange={event => { setQuery(event.target.value) }}
                    />
                  </span>
                </div>
                <div className="table">
                  <div className="table-scroll">
                    <div className="tr tr-head" style={TABLE_GRID}>
                      <span className="td" style={{ whiteSpace: 'nowrap' }}>模型</span>
                      <span className="td td-num">输入</span>
                      <span className="td td-num">输出</span>
                      <span className="td td-num">缓存</span>
                      <span className="td td-num">耗时</span>
                    </div>
                    {details.length === 0
                      ? (
                        <div className="tr" style={{ gridTemplateColumns: 'minmax(0,1fr)' }}>
                          <span className="td" style={{ color: 'var(--faint)', fontSize: 'var(--fs-xs)' }}>
                            {query.trim() === '' ? '暂无数据' : '没有匹配的调用'}
                          </span>
                        </div>
                      )
                      : details.map((entry, index) => {
                        const brand = brandKey(entry.channel, entry.region)
                        return (
                          <div
                            className="tr"
                            style={TABLE_GRID}
                            key={`${entry.turnId}:${String(entry.at)}:${String(index)}`}
                            data-ok={entry.ok}
                            title={`${fmtClock(entry.at)} · ${brandName(brand)}${entry.account === undefined ? '' : ` · ${entry.account}`}${entry.ok ? '' : ' · 失败'}`}
                          >
                            <span className="td" style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                              <span className="td-ch"><span className="m" style={brandIconStyle(brand)} /></span>
                              <span className="td-mono" style={{ minWidth: 0 }}>{entry.model === '' ? '—' : entry.model}</span>
                              {entry.ok ? null : <span className="pill" data-tone="err" style={{ flex: '0 0 auto' }}>失败</span>}
                            </span>
                            {tokenCells(entry).map((cell, cellIndex) => (
                              <span className="td td-num" key={String(cellIndex)}>{cell}</span>
                            ))}
                            <span
                              className="td td-dim"
                              title={entry.ttftMs === undefined ? undefined : `首 token ${fmtMs(entry.ttftMs)}`}
                            >
                              {fmtMs(durationOf(entry))}
                            </span>
                          </div>
                        )
                      })}
                  </div>
                </div>
                <div className="hint">
                  <b>说明</b>
                  <span>汇总覆盖全部渠道。轮次是一次提问，调用是打到上游的次数——换号会多出调用，两个数字不该合并。</span>
                </div>
              </section>
            </>
          )}
      </div>
    </main>
  )
}

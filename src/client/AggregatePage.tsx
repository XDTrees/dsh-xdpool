/**
 * 聚合渠道页 —— 按 xdpool-design/aggregate.html 与 aggregate-models.html 重写。
 *
 * 结构（与设计稿逐块对应）：
 *
 *   main.main
 *   ├─ header.mhead            标题「聚合渠道」+ 副标题 + 右侧 .search「搜索厂商」
 *   └─ div.mbody
 *      ├─ .lane                聚合总开关（.sw + .lane-t + .lane-d）
 *      ├─ p.note               一句话说明
 *      ├─ .tabs > .tab         全部 / 免费 / 有免费额度 / 填 Key / 需授权 / 本地，数字在 .n 里
 *      ├─ .vendors > article.vd 每家一张卡：
 *      │    .vd-head            图标 + .vd-name + .vd-cat
 *      │    .vd-models-line     「N 个模型 · A · B · C 等 N 个」
 *      │    .vd-key-row         .vd-input + .tiny 保存/更新（授权类 / 免 Key 类换成一行 .vd-n 说明）
 *      │    .vd-foot            .vd-state + .vd-actions（.tiny 发现模型 + .sw 开关）
 *      ├─ .hint                「说明」
 *      └─ 选择模型浮层（.pick）  position:fixed 写在 inline style 上，不占 .app 网格格子
 *
 * 设计稿之外、为了不丢功能而保留的：卡片 .vd-actions 里多一个 .tiny「更多」，展开后是
 * 接口地址、追加 Key、多 Key 使用方式、测试连接、去获取 Key、官网、清除设置，以及已接入
 * 模型的参数和逐个测试。
 *
 * 文字一律中文字面量；后端/上游返回的英文提示不上界面（见 {@link zhOnly}）。厂商说明
 * provider.notes 由 web-status 换成了 PROVIDER_NOTES_ZH 的中文，只在确实是中文时才用。
 *
 * 这一页有自己的读写周期（读 POOL_AGGREGATE_PATH），不挂在账号池 30 秒的轮询上。
 *
 * @module dsh-xdpool/client/AggregatePage
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  POOL_AGGREGATE_DISCOVER_PATH,
  POOL_AGGREGATE_PATH,
  POOL_AGGREGATE_SAVE_PATH,
  POOL_AGGREGATE_TEST_PATH,
  POOL_MODEL_PROBE_PATH,
  type PoolWebAggregatePatch,
  type PoolWebAggregateProbe,
  type PoolWebAggregateProvider,
  type PoolWebAggregateStatus,
  type PoolWebModelProbeResult,
} from '../status-paths.ts'
import type { XdPoolSettingsKey } from './locales.ts'
import { DIST_OPTIONS, distLabel } from './distribution.ts'
import { BrandTile } from './brand-tile.tsx'
import { channelIcon, channelInitials } from './channel-icons.ts'
import { providerIcon } from './provider-icons.ts'
import { ModelFactsRow } from './model-facts-row.tsx'
import { modelFactsFor, type ModelFacts, type ModelProbeReading } from './model-facts.ts'
import { knownCapabilities, isFreeLane } from '../free-catalog.ts'
import { recommendUse } from './recommend-use.ts'
/** The translator the settings section injects. */
type Translate = (key: XdPoolSettingsKey, params?: Record<string, unknown>) => string
/** Props delivered by the slot wrapper in {@link ./PoolCard}. */
export interface AggregatePageProps {
  t?: Translate | undefined
}
/** 筛选条的顺序 —— 与设计稿 .tabs 一致。 */
const CATEGORIES = ['free', 'free-tier', 'apikey', 'oauth', 'local'] as const
type Category = (typeof CATEGORIES)[number]
/** 类别的中文名，筛选条和卡片右上角的 .vd-cat 共用。 */
const CATEGORY_ZH: Readonly<Record<Category, string>> = Object.freeze({
  free: '免费',
  'free-tier': '有免费额度',
  apikey: '填 Key',
  oauth: '需授权',
  local: '本地',
})
/** 设计稿给了专门配色的三种类别；其余类别不带 data-cat，走默认描边。 */
const TINTED_CATEGORIES: ReadonlySet<string> = new Set(['free', 'free-tier', 'oauth'])
/**
 * Tile accents for the roster.
 *
 * The registry carries no colour of its own, so a vendor's tint is derived from
 * its id. It only shows behind initials (vendors with no artwork); it is stable
 * across reloads, which is what matters for recognition.
 */
const VENDOR_ACCENTS = [
  '#5686fe',
  '#7a5cf0',
  '#10a5a0',
  '#e8843d',
  '#d9578a',
  '#4aa3e8',
  '#6aa84f',
  '#c05ce0',
] as const
/** A stable tint for one vendor id. */
function accentFor(id: string): string {
  let hash = 0
  for (let at = 0; at < id.length; at += 1) hash = (hash * 31 + id.charCodeAt(at)) >>> 0
  return VENDOR_ACCENTS[hash % VENDOR_ACCENTS.length] as string
}
/** 模型行里直接列出名字的个数，其余折成「等 N 个」—— 与设计稿一致。 */
const MODEL_PREVIEW = 3
const HAN = /[\u4e00-\u9fff]/u
/**
 * 后端 / 上游返回的提示只在本身是中文时才显示。
 *
 * 上游错误基本是英文（"Unauthorized"、"Failed to fetch"），原样贴到界面上会让
 * 整页中文里冒出一句英文；看不懂的原文不如不显示，状态码另外单独给。
 */
function zhOnly(text: string | undefined): string {
  return text !== undefined && HAN.test(text) ? text.trim() : ''
}
/** 「连接失败（HTTP 401）：……」—— 只带状态码和中文原因。 */
function failLine(head: string, status: number | undefined, message: string | undefined): string {
  const code = status === undefined || status === 0 ? '' : `（HTTP ${String(status)}）`
  const why = zhOnly(message)
  return `${head}${code}${why === '' ? '' : `：${why}`}`
}
/** 一个抛出来的异常 → 中文说明。网络层的英文报错一律说成「请求没有发出去」。 */
function causeLine(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause)
  return zhOnly(message) || '请求没有发出去，请检查网络或稍后再试'
}
/**
 * Per-provider edit buffer.
 *
 * The key is never echoed back by the read route — `aggregateStatusOf` reports
 * only whether one is present — so the field starts empty and an empty field on
 * save means "leave the stored key alone". Clearing is its own action.
 */
interface ProviderDraft {
  apiKey: string
  baseUrl: string
  /**
   * A new key being appended to a vendor that already holds one. The host never
   * echoes keys back, so appending is the only honest shape.
   */
  extraKey: string
}
type ModelRow = PoolWebAggregateStatus['models'][number]
/**
 * Whether this vendor's rows may fall back to the local capability table.
 *
 * Only the two keyless lanes qualify. Every other vendor has a registry, and a
 * locally-guessed window for a paid id would contradict whatever it serves.
 */
function usesLocalCapabilities(vendor: PoolWebAggregateProvider): boolean {
  return isFreeLane(vendor.id) || vendor.id === 'opencode'
}
/**
 * Capabilities for one model id, or undefined when it is not being served.
 *
 * `modelRows` carries the registry's declared figures. Where it declares none,
 * the row gets nothing invented for it: the local capability table is consulted
 * only for the keyless lanes, and only for ids it actually covers.
 */
function factsLookup(
  provider: PoolWebAggregateProvider,
  modelRows: readonly ModelRow[],
): (modelId: string) => ModelFacts | undefined {
  return (modelId: string): ModelFacts | undefined => {
    const row = modelRows.find(candidate => candidate.modelId === modelId)
    if (row === undefined) return undefined
    const declared = modelFactsFor(row)
    if (declared.contextWindow !== undefined) return declared
    if (!usesLocalCapabilities(provider)) return declared
    const local = knownCapabilities(modelId)
    if (local === undefined) return declared
    return {
      ...declared,
      contextWindow: local.contextWindow,
      maxOutputTokens: declared.maxOutputTokens ?? local.maxOutput,
      vision: local.vision,
      ...(local.reasoning
        ? { supportedEfforts: [...(declared.supportedEfforts ?? ['thinking'])] }
        : {}),
    }
  }
}
/**
 * The ranking every model list on this page uses: free first, then the widest
 * window, then image support, then name.
 */
function rankModels(factsOf: (modelId: string) => ModelFacts | undefined) {
  return (a: string, b: string): number => {
    const freeA = isFreeLane(a)
    const freeB = isFreeLane(b)
    if (freeA !== freeB) return freeA ? -1 : 1
    const windowA = factsOf(a)?.contextWindow ?? 0
    const windowB = factsOf(b)?.contextWindow ?? 0
    if (windowA !== windowB) return windowB - windowA
    const visionA = factsOf(a)?.vision === true
    const visionB = factsOf(b)?.vision === true
    if (visionA !== visionB) return visionA ? -1 : 1
    return a.localeCompare(b)
  }
}
/**
 * The roster a chooser offers for one vendor.
 *
 * OpenCode's keyless free pool advertises every model it has, paid rows
 * included, and the plugin's own 免密 lane is free by construction. For both,
 * the chooser shows only the free rows, and "select all" is capped to them.
 */
function rosterOf(provider: PoolWebAggregateProvider): readonly string[] {
  /*
    availableModels 可能是 undefined（新接入、还没发现过模型）。
    原来直接 .filter，一家没发现过的厂商就让整页白屏。
  */
  const available = provider.availableModels ?? []
  return usesLocalCapabilities(provider) ? available.filter(id => isFreeLane(id)) : available
}
/** 一个模型的显示名：注册表写的名字 → 正在提供的行的名字 → id 本身。 */
function modelNameOf(provider: PoolWebAggregateProvider, modelRows: readonly ModelRow[], id: string): string {
  const declared = provider.modelMeta?.[id]?.name
  if (declared !== undefined && declared !== '') return declared
  const served = modelRows.find(row => row.modelId === id)?.name
  return served !== undefined && served !== '' ? served : id
}
export function AggregatePage({ t }: AggregatePageProps) {
  const [status, setStatus] = useState<PoolWebAggregateStatus | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  /** Provider ids with an in-flight action, so only that row shows a spinner. */
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set())
  /** providerId -> the status line shown on that card. Always Chinese. */
  const [flash, setFlash] = useState<Record<string, string>>({})
  const [drafts, setDrafts] = useState<Record<string, ProviderDraft>>({})
  /**
   * Which cards have their「更多」pane open.
   *
   * Kept here rather than in the row so it survives the `load()` that follows
   * every save: a pane that collapsed itself the moment the user pressed Save
   * would hide the confirmation line it just produced.
   */
  const [opened, setOpened] = useState<Record<string, boolean>>({})
  /**
   * providerId -> the model's ticked state while the chooser is being edited.
   *
   * A BUFFER, only ever sent when the user presses「保存 N 个」. Absent means "no
   * unsaved edit here", which is what lets the save button say whether there is
   * anything to save.
   */
  const [modelDrafts, setModelDrafts] = useState<Record<string, readonly string[]>>({})
  /** providerId -> the filter typed into that vendor's model list. */
  const [modelQueries, setModelQueries] = useState<Record<string, string>>({})
  /** 「选择模型」浮层当前打开的是哪一家；同一时间只开一个。 */
  const [picking, setPicking] = useState<string | undefined>(undefined)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<Category | 'all'>('all')
  /**
   * providerId/modelId -> the last connectivity reading for that pair.
   *
   * Keyed by both because a model id is only unique within its provider.
   */
  const [probes, setProbes] = useState<Record<string, ModelProbeReading>>({})
  /** The pair currently being measured, so only one button shows a spinner. */
  const [probing, setProbing] = useState<string | undefined>(undefined)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  const markBusy = useCallback((key: string, on: boolean): void => {
    setBusyIds(prev => {
      const next = new Set(prev)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })
  }, [])
  /**
   * Ask the host to run one real request against a model, and keep the reading.
   * A transport failure is turned into a reading rather than thrown.
   */
  const testModel = useCallback(async (provider: string, model: string): Promise<void> => {
    const key = `${provider}/${model}`
    if (probing !== undefined) return
    setProbing(key)
    try {
      const response = await fetch(POOL_MODEL_PROBE_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ provider, model }),
      })
      const value: unknown = await response.json().catch(() => undefined)
      const reading = value as PoolWebModelProbeResult | undefined
      if (mounted.current) {
        setProbes(prev => ({
          ...prev,
          [key]: response.ok && reading !== undefined && reading.ok === true
            ? reading
            : {
                ok: false,
                outputChars: 0,
                error: zhOnly(reading?.error) || `HTTP ${String(response.status)}`,
              },
        }))
      }
    } catch (cause: unknown) {
      if (mounted.current) {
        setProbes(prev => ({
          ...prev,
          [key]: { ok: false, outputChars: 0, error: causeLine(cause) },
        }))
      }
    } finally {
      if (mounted.current) setProbing(undefined)
    }
  }, [probing])
  const load = useCallback(async (signal?: AbortSignal): Promise<void> => {
    try {
      const response = await fetch(POOL_AGGREGATE_PATH, {
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
        ...signal === undefined ? {} : { signal },
      })
      const value: unknown = await response.json().catch(() => undefined)
      if (!response.ok) {
        const detail = value as { error?: string } | undefined
        if (mounted.current) setError(failLine('读取厂商列表失败', response.status, detail?.error))
        return
      }
      if (mounted.current && signal?.aborted !== true) {
        setStatus(value as PoolWebAggregateStatus)
        setError(undefined)
      }
    } catch (cause: unknown) {
      if (signal?.aborted === true) return
      // A dead panel is an absence of information, not a broken pool.
      if (mounted.current) setError(`读取厂商列表失败：${causeLine(cause)}`)
    }
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => { controller.abort() }
  }, [load])
  /** Post one patch, then re-read the document so the card shows what stuck. */
  const patch = useCallback(async (body: PoolWebAggregatePatch): Promise<boolean> => {
    const key = body.kind === 'provider' || body.kind === 'clear' ? body.providerId : body.kind
    markBusy(key, true)
    try {
      const response = await fetch(POOL_AGGREGATE_SAVE_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        const detail = await response.json().catch(() => ({})) as { error?: string }
        if (mounted.current) setFlash(prev => ({ ...prev, [key]: failLine('操作失败', response.status, detail.error) }))
        return false
      }
      await load()
      return true
    } catch (cause: unknown) {
      if (mounted.current) setFlash(prev => ({ ...prev, [key]: `操作失败：${causeLine(cause)}` }))
      return false
    } finally {
      if (mounted.current) markBusy(key, false)
    }
  }, [load, markBusy])
  const test = useCallback(async (providerId: string): Promise<void> => {
    markBusy(providerId, true)
    try {
      const response = await fetch(POOL_AGGREGATE_TEST_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ providerId }),
      })
      const probe = await response.json().catch(() => undefined) as PoolWebAggregateProbe | undefined
      if (!mounted.current) return
      const line = probe !== undefined && response.ok && probe.ok
        ? `连接正常（HTTP ${String(probe.status)}）`
        : failLine('连接失败', probe?.status ?? response.status, probe?.message)
      setFlash(prev => ({ ...prev, [providerId]: line }))
    } catch (cause: unknown) {
      if (mounted.current) setFlash(prev => ({ ...prev, [providerId]: `连接失败：${causeLine(cause)}` }))
    } finally {
      if (mounted.current) markBusy(providerId, false)
    }
  }, [markBusy])
  const discover = useCallback(async (providerId: string): Promise<void> => {
    markBusy(providerId, true)
    try {
      const response = await fetch(POOL_AGGREGATE_DISCOVER_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ providerId }),
      })
      const probe = await response.json().catch(() => undefined) as PoolWebAggregateProbe | undefined
      if (!mounted.current) return
      const ok = probe !== undefined && response.ok && probe.ok
      const committed = probe?.committed ?? 0
      const line = ok
        ? committed > 0 ? `已拉到 ${String(committed)} 个模型` : '这家没有返回模型列表'
        : failLine('拉取模型失败', probe?.status ?? response.status, probe?.message)
      setFlash(prev => ({ ...prev, [providerId]: line }))
      if (ok) await load()
    } catch (cause: unknown) {
      if (mounted.current) setFlash(prev => ({ ...prev, [providerId]: `拉取模型失败：${causeLine(cause)}` }))
    } finally {
      if (mounted.current) markBusy(providerId, false)
    }
  }, [load, markBusy])
  /**
   * The ticked ids for one vendor: the unsaved buffer if there is one, else the
   * server's own `models`.
   */
  const chosenFor = useCallback(
    (provider: PoolWebAggregateProvider): ReadonlySet<string> =>
      new Set(modelDrafts[provider.id] ?? provider.models ?? []),
    [modelDrafts],
  )
  const dropModelDraft = useCallback((providerId: string): void => {
    setModelDrafts(prev => {
      const next = { ...prev }
      delete next[providerId]
      return next
    })
  }, [])
  /** 关浮层 = 取消：丢掉没保存的勾选。 */
  const closePicker = useCallback((): void => {
    if (picking !== undefined) dropModelDraft(picking)
    setPicking(undefined)
  }, [picking, dropModelDraft])
  /* 浮层打开时 Esc 关闭（设计稿：点外面 / Esc 关闭）。 */
  useEffect(() => {
    if (picking === undefined) return undefined
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closePicker()
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [picking, closePicker])
  const laneBusy = busyIds.has('lane')
  /*
    `?? []` 只挡 null/undefined —— 后端把数组写成对象时它是 `is not iterable`，
    整页空白。数组守卫更硬一点。
  */
  const providers: readonly PoolWebAggregateProvider[] = (Array.isArray(status?.providers)
    ? status.providers as readonly PoolWebAggregateProvider[]
    : []).filter((p): p is PoolWebAggregateProvider => p !== null && typeof p === 'object')
  const laneEnabled = status?.enabled !== false
  /**
   * How many vendors each filter would show.
   *
   * Counted from the whole roster rather than from the current search, because
   * the buttons ARE the filter: the count answers "how much is in this
   * category", not "how many match what I typed".
   */
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const provider of providers) {
      counts.set(provider.category, (counts.get(provider.category) ?? 0) + 1)
    }
    return counts
  }, [providers])
  /** 筛选 + 搜索后的卡片，按模型数从多到少排（设计稿「列表按模型数排」）。 */
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return providers
      .filter(provider => {
        if (category !== 'all' && provider.category !== category) return false
        if (needle === '') return true
        if (provider.name.toLowerCase().includes(needle)) return true
        if (provider.id.includes(needle)) return true
        if (provider.notes?.toLowerCase().includes(needle) === true) return true
        return (provider.availableModels ?? []).some(model => model.toLowerCase().includes(needle))
      })
      .slice()
      .sort((a, b) => (b.availableModels ?? []).length - (a.availableModels ?? []).length)
  }, [providers, query, category])
  /** Model ids contributed right now, so a card can say what it is worth. */
  const contributionByProvider = useMemo(() => {
    const counts = new Map<string, number>()
    for (const row of Array.isArray(status?.models) ? status.models : []) {
      counts.set(row.providerId, (counts.get(row.providerId) ?? 0) + 1)
    }
    return counts
  }, [status?.models])
  /** The full model rows each provider contributes, grouped by provider id. */
  const modelRowsByProvider = useMemo(() => {
    const grouped = new Map<string, ModelRow[]>()
    for (const row of Array.isArray(status?.models) ? status.models : []) {
      const bucket = grouped.get(row.providerId)
      if (bucket === undefined) grouped.set(row.providerId, [row])
      else bucket.push(row)
    }
    return grouped
  }, [status?.models])
  const pickedProvider = picking === undefined ? undefined : providers.find(provider => provider.id === picking)
  /** 「发现模型」：能拉列表就先拉一次，再打开浮层；拉不了就直接用现有名单。 */
  const openPicker = (provider: PoolWebAggregateProvider): void => {
    setPicking(provider.id)
    if (provider.hasListing && provider.supported && provider.configured && !busyIds.has(provider.id)) {
      void discover(provider.id)
    }
  }
  const saveDraft = async (provider: PoolWebAggregateProvider): Promise<void> => {
    const draft = drafts[provider.id]
    if (draft === undefined) return
    // The appended key joins whatever is stored. The host never echoes keys
    // back, so this sends ONLY the new key and asks the host to append it.
    const appending = draft.extraKey.trim() === ''
      ? {}
      : { appendApiKey: draft.extraKey.trim() }
    const ok = await patch({
      kind: 'provider',
      providerId: provider.id,
      // An empty field means "leave what is stored alone", never "store an
      // empty key" — clearing has its own action.
      ...draft.apiKey.trim() === '' ? {} : { apiKey: draft.apiKey.trim() },
      ...draft.baseUrl === '' ? {} : { baseUrl: draft.baseUrl },
      ...appending,
    })
    if (ok) {
      setDrafts(prev => {
        const next = { ...prev }
        delete next[provider.id]
        return next
      })
      setFlash(prev => ({ ...prev, [provider.id]: '已保存' }))
    }
  }
  return (
    <main className="main">
      <header className="mhead">
        <div className="mhead-title">
          <span className="mhead-name">聚合渠道</span>
          <span className="mhead-org">
            {status === undefined ? '外部厂商 · 填 Key 接进来' : `${String(providers.length)} 家外部厂商 · 填 Key 接进来`}
          </span>
        </div>
        <div className="mhead-actions">
          <input
            className="search"
            type="search"
            value={query}
            placeholder="搜索厂商"
            aria-label="搜索厂商"
            onChange={event => { setQuery(event.target.value) }}
          />
        </div>
      </header>
      <div className="mbody">
        <div className="lane">
          <button
            type="button"
            className="sw"
            role="switch"
            aria-checked={laneEnabled}
            aria-label="聚合开关"
            disabled={laneBusy || status === undefined}
            onClick={() => { void patch({ kind: 'lane', enabled: !laneEnabled }) }}
          />
          <span className="lane-t">聚合开关</span>
          <span className="lane-d">
            {laneEnabled
              ? '关掉后这些厂商的模型不出现在模型选择器里'
              : '已关闭：这些厂商的模型现在不出现在模型选择器里，账号池不受影响'}
          </span>
        </div>
        {flash['lane'] === undefined ? null : <p className="hint">{flash['lane']}</p>}

        <p className="note">
          这些厂商不走扫码，直接填 API Key。填完点「发现模型」，拉到列表后勾选要用的，勾上的才进模型选择器。
        </p>

        <div className="tabs" role="group" aria-label="按类别筛选">
          <button
            type="button"
            className="tab"
            aria-pressed={category === 'all'}
            onClick={() => { setCategory('all') }}
          >
            全部<span className={'n'}>{String(providers.length)}</span>
          </button>
          {CATEGORIES.map(value => (
            <button
              key={value}
              type="button"
              className="tab"
              aria-pressed={category === value}
              onClick={() => { setCategory(value) }}
            >
              {CATEGORY_ZH[value]}<span className={'n'}>{String(categoryCounts.get(value) ?? 0)}</span>
            </button>
          ))}
        </div>

        {error === undefined ? null : <p className="hint">{error}</p>}
        {status === undefined && error === undefined
          ? <p className="hint">正在读取厂商列表…</p>
          : visible.length === 0
            ? <p className="hint">没有匹配的厂商</p>
            : <div className="vendors">
                {visible.map(provider => (
                  <ProviderRow
                    key={provider.id}
                    provider={provider}
                    contributed={contributionByProvider.get(provider.id) ?? 0}
                    modelRows={modelRowsByProvider.get(provider.id) ?? []}
                    probes={probes}
                    probing={probing}
                    busy={busyIds.has(provider.id)}
                    flash={flash[provider.id]}
                    draft={drafts[provider.id]}
                    open={opened[provider.id] === true}
                    laneEnabled={laneEnabled}
                    t={t}
                    onOpen={() => {
                      setOpened(prev => ({ ...prev, [provider.id]: prev[provider.id] !== true }))
                    }}
                    onDraft={(next) => { setDrafts(prev => ({ ...prev, [provider.id]: next })) }}
                    onStrategy={(strategy) => {
                      void patch({ kind: 'provider', providerId: provider.id, distribution: strategy })
                    }}
                    onSave={() => saveDraft(provider)}
                    onClear={async () => {
                      const ok = await patch({ kind: 'clear', providerId: provider.id })
                      if (ok) {
                        setDrafts(prev => {
                          const next = { ...prev }
                          delete next[provider.id]
                          return next
                        })
                        setFlash(prev => ({ ...prev, [provider.id]: '已清除这家的设置' }))
                      }
                    }}
                    onToggle={enabled => { void patch({ kind: 'provider', providerId: provider.id, enabled }) }}
                    onTest={() => { void test(provider.id) }}
                    onPick={() => { openPicker(provider) }}
                    onTestModel={(model) => { void testModel(provider.id, model) }}
                  />
                ))}
              </div>}

        <div className="hint">
          <b>说明</b>
          <span>
            同一家可以填多个 Key，请求在它们之间轮换。Key 只存在这台机器上。列表按模型数排，共 {String(providers.length)} 家。
          </span>
        </div>

        {pickedProvider === undefined
          ? null
          : <ModelPicker
              provider={pickedProvider}
              modelRows={modelRowsByProvider.get(pickedProvider.id) ?? []}
              chosen={chosenFor(pickedProvider)}
              busy={busyIds.has(pickedProvider.id)}
              flash={flash[pickedProvider.id]}
              query={modelQueries[pickedProvider.id] ?? ''}
              onQuery={value => { setModelQueries(prev => ({ ...prev, [pickedProvider.id]: value })) }}
              onToggleModel={(modelId, on) => {
                // The first tick opens the buffer from the saved set.
                setModelDrafts(prev => {
                  const base = prev[pickedProvider.id] ?? [...chosenFor(pickedProvider)]
                  const next = new Set(base)
                  if (on) next.add(modelId)
                  else next.delete(modelId)
                  return { ...prev, [pickedProvider.id]: [...next] }
                })
              }}
              onSelectAll={on => {
                const roster = rosterOf(pickedProvider)
                setModelDrafts(prev => ({ ...prev, [pickedProvider.id]: on ? [...roster] : [] }))
              }}
              onCancel={closePicker}
              onSave={async () => {
                const draft = modelDrafts[pickedProvider.id]
                if (draft === undefined) { setPicking(undefined); return }
                const ok = await patch({ kind: 'provider', providerId: pickedProvider.id, models: draft })
                if (ok) {
                  dropModelDraft(pickedProvider.id)
                  setFlash(prev => ({ ...prev, [pickedProvider.id]: '模型选择已保存' }))
                  setPicking(undefined)
                }
              }}
            />}
      </div>
    </main>
  )
}
function ProviderRow({
  provider,
  contributed,
  modelRows,
  probes,
  probing,
  busy,
  flash,
  draft,
  open,
  laneEnabled,
  t,
  onOpen,
  onDraft,
  onSave,
  onStrategy,
  onClear,
  onToggle,
  onTest,
  onPick,
  onTestModel,
}: {
  provider: PoolWebAggregateProvider
  /** How many model rows this provider contributes to the picker right now. */
  contributed: number
  /**
   * The full model rows this provider contributes, for the facts and the test
   * button. An empty list is meaningful — a configured vendor contributing
   * nothing — so the caller passes `[]` rather than omitting the prop.
   */
  modelRows: readonly ModelRow[]
  /** `"<providerId>/<modelId>"` -> the last reading for that pair. */
  probes: Readonly<Record<string, ModelProbeReading>>
  /** The pair currently being measured, as the same `"<provider>/<model>"` key. */
  probing: string | undefined
  busy: boolean
  flash?: string | undefined
  draft?: ProviderDraft | undefined
  open: boolean
  laneEnabled: boolean
  t?: Translate | undefined
  onOpen: () => void
  onDraft: (next: ProviderDraft) => void
  onSave: () => Promise<void>
  /** Commit one usage strategy immediately; it sends only `distribution`. */
  onStrategy: (strategy: string) => void
  onClear: () => Promise<void>
  onToggle: (enabled: boolean) => void
  onTest: () => void
  /** 打开「选择模型」浮层（能拉列表时顺带拉一次）。 */
  onPick: () => void
  /** Run one connectivity test against one of this vendor's models. */
  onTestModel: (modelId: string) => void
}) {
  const enabled = provider.enabled
  const effective = enabled && laneEnabled
  // Sign-in channel artwork first: where a vendor is both (minimax, gemini) that
  // icon is already worn by the login page, and two different marks for one
  // company would read as a bug. Then the vendor table. Only custom_openai has
  // neither — it is whatever endpoint the user points at — and wears initials.
  const icon = channelIcon(provider.id) ?? providerIcon(provider.id)
  const tileMark =
    icon === undefined ? { initials: channelInitials(provider.name) } : { icon }
  const paneId = `dsm-xdpool-agg-${provider.id}`
  const factsOf = factsLookup(provider, modelRows)
  const freeOnly = usesLocalCapabilities(provider)
  /*
    models 可能是 undefined —— 新接入的厂商还没拉过模型列表。
    原来直接 .length，一家没拉过的厂商就让整页白屏。
  */
  const knownModels = provider.models ?? []
  /* 卡片上的模型行列整份名单（不是已勾选的那几个）—— 设计稿写的是这家一共有多少。 */
  const roster = provider.availableModels ?? []
  const names = roster.map(id => modelNameOf(provider, modelRows, id))
  const modelsLine = names.length === 0
    ? '还没有模型列表，填好 Key 后点「发现模型」拉取'
    : `${String(names.length)} 个模型 · ${names.slice(0, MODEL_PREVIEW).join(' · ')}${names.length > MODEL_PREVIEW ? ` 等 ${String(names.length)} 个` : ''}`
  const category = (CATEGORIES as readonly string[]).includes(provider.category)
    ? CATEGORY_ZH[provider.category as Category]
    : '其他'
  /* 厂商说明（web-status 已换成中文）只做悬停提示；不是中文就不显示。 */
  const notes = zhOnly(provider.notes)
  const keyNeeded = provider.supported && provider.authKind !== 'none'
  const keyDraft = draft?.apiKey ?? ''
  const keySet = keyNeeded && provider.configured && keyDraft === ''
  const paneDirty = (draft?.baseUrl ?? '') !== '' || (draft?.extraKey ?? '').trim() !== ''
  const stateText = effective
    ? contributed > 0 ? `已接入 ${String(contributed)}` : '已接入'
    : enabled ? '聚合已关' : '未接入'
  /**
   * The served rows ranked, so the facts list in the pane reads in the same
   * order as the chooser.
   */
  const sortedModelRows = modelRows
    .filter(row => !freeOnly || isFreeLane(row.modelId))
    .slice()
    .sort((a, b) => rankModels(factsOf)(a.modelId, b.modelId))
  const draftWith = (change: Partial<ProviderDraft>): ProviderDraft => ({
    apiKey: draft?.apiKey ?? '',
    baseUrl: draft?.baseUrl ?? '',
    extraKey: draft?.extraKey ?? '',
    ...change,
  })
  return (
    <article className="vd" data-on={effective ? 'true' : 'false'}>
      <div className="vd-head">
        <BrandTile accent={accentFor(provider.id)} glyph="globe" size={20} {...tileMark} />
        <span className="vd-name" title={notes === '' ? provider.name : `${provider.name}：${notes}`}>
          {provider.name}
        </span>
        <span className="vd-cat" {...TINTED_CATEGORIES.has(provider.category) ? { 'data-cat': provider.category } : {}}>
          {category}
        </span>
      </div>
      <p className="vd-models-line" title={names.join('、')}>{modelsLine}</p>
      {!provider.supported
        ? <div className="vd-key-row">
            <span className="vd-n" style={{ flex: '1 1 auto' }}>走授权登录，不能填 Key</span>
          </div>
        : provider.authKind === 'none'
          ? <div className="vd-key-row">
              <span className="vd-n" style={{ flex: '1 1 auto' }}>不用填 Key，打开右下角的开关就能用</span>
            </div>
          : <div className="vd-key-row">
              <input
                className="vd-input"
                type="password"
                autoComplete="off"
                aria-label={`${provider.name} 的 API Key`}
                data-set={keySet ? 'true' : 'false'}
                value={keyDraft}
                placeholder={keySet ? 'sk-••••••••••••••••' : '粘贴 API Key'}
                title={keySet ? `已保存 ${String(Math.max(1, provider.keyCount))} 个 Key；粘贴新的会替换` : undefined}
                onChange={event => { onDraft(draftWith({ apiKey: event.target.value })) }}
                onKeyDown={event => { if (event.key === 'Enter' && keyDraft.trim() !== '') void onSave() }}
              />
              <button
                type="button"
                className="tiny"
                disabled={busy || keyDraft.trim() === ''}
                onClick={() => { void onSave() }}
              >
                {busy ? '保存中…' : provider.configured ? '更新' : '保存'}
              </button>
            </div>}
      {flash === undefined ? null : <span className="vd-n" role="status">{flash}</span>}
      <div className="vd-foot">
        <span className="vd-state" data-on={effective ? 'true' : 'false'}>{stateText}</span>
        <span className="vd-actions">
          <button type="button" className="tiny" disabled={!provider.supported} onClick={onPick}>
            发现模型
          </button>
          <button
            type="button"
            className="tiny"
            aria-expanded={open}
            aria-controls={paneId}
            onClick={onOpen}
          >
            {open ? '收起' : '更多'}
          </button>
          {/* 开关独立于保存：保存 Key 会自动接入；关掉开关是「先摘出去但保留 Key」。 */}
          <button
            type="button"
            className="sw"
            role="switch"
            aria-checked={enabled}
            aria-label={`${provider.name} · ${t?.('agg.enable') ?? '接入'}`}
            title={t?.('agg.enableHint') ?? '保存 Key 会自动接入这家；用这个开关可以在保留 Key 的情况下先摘出去。'}
            disabled={busy || !provider.supported}
            onClick={() => { onToggle(!enabled) }}
          />
        </span>
      </div>
      {/* 「更多」：设计稿卡片上放不下、但不能丢的设置。hidden 属性收起，不用 max-height 裁切。 */}
      <div id={paneId} role="group" aria-label={`${provider.name} 的更多设置`} hidden={!open}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--s2)',
            paddingTop: 'var(--s2)',
            borderTop: '1px solid var(--line)',
          }}
        >
          {keyNeeded
            ? <label className="field">
                <span className="vd-n">接口地址</span>
                <input
                  className="vd-input"
                  type="text"
                  value={draft?.baseUrl ?? provider.baseUrl ?? ''}
                  placeholder="留空用默认地址"
                  onChange={event => { onDraft(draftWith({ baseUrl: event.target.value })) }}
                />
              </label>
            : null}
          {/*
            追加 Key，以及（两把以上时）多 Key 的使用方式。只拿得到 keyCount ——
            Key 本身从不回传 —— 所以只能追加；一把 Key 时不画使用方式，那会是个
            只有一个选项、点了也没效果的控件。
          */}
          {keyNeeded && provider.keyCount >= 1
            ? <label className="field">
                <span className="vd-n">再加一个 Key（已存 {String(provider.keyCount)} 个，请求会在它们之间轮换）</span>
                <input
                  className="vd-input"
                  type="password"
                  autoComplete="off"
                  value={draft?.extraKey ?? ''}
                  placeholder="追加在已有 Key 之后"
                  onChange={event => { onDraft(draftWith({ extraKey: event.target.value })) }}
                />
              </label>
            : null}
          {keyNeeded && provider.keyCount > 1
            ? <label className="field">
                <span className="vd-n">多个 Key 怎么用</span>
                <select
                  className="ctx-select"
                  value={provider.distribution ?? 'priority'}
                  disabled={busy}
                  onChange={event => { onStrategy(event.target.value) }}
                >
                  {DIST_OPTIONS.map(option => (
                    <option key={option} value={option}>
                      {distLabel(option, t)}
                    </option>
                  ))}
                </select>
              </label>
            : null}
          <span style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', alignItems: 'center' }}>
            {paneDirty
              ? <button type="button" className="tiny" disabled={busy} onClick={() => { void onSave() }}>
                  {busy ? '保存中…' : '保存设置'}
                </button>
              : null}
            {provider.supported
              ? <button type="button" className="tiny" disabled={busy} onClick={onTest}>测试连接</button>
              : null}
            {provider.authUrl !== undefined
              ? <a className="tiny" href={provider.authUrl} target="_blank" rel="noreferrer noopener">去获取 Key</a>
              : null}
            {provider.website !== undefined && provider.website !== provider.authUrl
              ? <a className="tiny" href={provider.website} target="_blank" rel="noreferrer noopener">官网</a>
              : null}
            <button type="button" className="tiny" disabled={busy} onClick={() => { void onClear() }}>
              清除设置
            </button>
          </span>
          {/*
            正在提供的模型：上下文 / 输出 / 识图，以及逐个「测试连接」。
            数字来自状态文档里已有的行，不另外请求，所以和通道实际提供的一致。
          */}
          {sortedModelRows.length > 0
            ? <>
                <span className="vd-n">
                  正在提供的模型（{String(sortedModelRows.length)} / 共 {String(knownModels.length)} 个已勾选）
                </span>
                {sortedModelRows.map(row => {
                  const key = `${provider.id}/${row.modelId}`
                  const recuse = isFreeLane(row.modelId) ? recommendUse(factsOf(row.modelId)) : undefined
                  return (
                    <div key={row.id} style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
                      <span className="mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {modelNameOf(provider, modelRows, row.modelId)}
                      </span>
                      <ModelFactsRow
                        t={t}
                        facts={modelFactsFor(row)}
                        {...probes[key] === undefined
                          ? { onTest: () => { onTestModel(row.modelId) } }
                          : { probe: probes[key], probing: probing === key }}
                      />
                      {recuse === undefined ? null : <span className="vd-n">推荐用途：{recuse}</span>}
                    </div>
                  )
                })}
              </>
            : null}
        </div>
      </div>
    </article>
  )
}
/**
 * 「选择模型」浮层 —— xdpool-design/aggregate-models.html 的 .pick。
 *
 * 设计稿示例页把 .pick 放在 .pick-wrap 里居中（那是示例页的写法）。这里是真浮层：
 * 外面一层 position:fixed 的遮罩写在 inline style 上，点遮罩 / Esc / ×「取消」都会关闭
 * 并丢掉没保存的勾选。它挂在 .mbody 里，不是 .app 的子元素，不会占网格格子。
 */
function ModelPicker({
  provider,
  modelRows,
  chosen,
  busy,
  flash,
  query,
  onQuery,
  onToggleModel,
  onSelectAll,
  onCancel,
  onSave,
}: {
  provider: PoolWebAggregateProvider
  modelRows: readonly ModelRow[]
  /** The model ids currently ticked — the unsaved buffer, or the saved set. */
  chosen: ReadonlySet<string>
  busy: boolean
  flash?: string | undefined
  query: string
  onQuery: (value: string) => void
  onToggleModel: (modelId: string, on: boolean) => void
  /** Tick the whole roster, or clear the buffer entirely. */
  onSelectAll: (on: boolean) => void
  onCancel: () => void
  onSave: () => Promise<void>
}) {
  const factsOf = factsLookup(provider, modelRows)
  const roster = rosterOf(provider)
  const needle = query.trim().toLowerCase()
  const listed = roster
    .filter(id => needle === ''
      || id.toLowerCase().includes(needle)
      || modelNameOf(provider, modelRows, id).toLowerCase().includes(needle))
    .slice()
    .sort(rankModels(factsOf))
  const chosenCount = roster.filter(id => chosen.has(id)).length
  /*
    和服务端正在提供的比较（按集合比，不按顺序）：没改动时「保存」是灰的。
    models 可能是 undefined —— 新接入的厂商还没拉过模型列表。
  */
  const knownModels = provider.models ?? []
  const dirty = chosen.size !== knownModels.length || knownModels.some(id => !chosen.has(id))
  const footHint = busy
    ? '正在处理…'
    : chosenCount === 0 && roster.length > 0
      ? '至少勾一个才能保存'
      : flash ?? (usesLocalCapabilities(provider) ? '这家只列出免费模型' : '')
  return (
    <div
      role="presentation"
      onClick={onCancel}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 80,
        display: 'grid',
        placeItems: 'center',
        padding: 'var(--s5)',
        background: 'oklch(0% 0 0 / 0.45)',
      }}
    >
      <div
        className="pick"
        role="dialog"
        aria-modal="true"
        aria-label={`选择模型 · ${provider.name}`}
        style={{ maxHeight: 'calc(100vh - 48px)' }}
        onClick={event => { event.stopPropagation() }}
      >
        <div className="pick-head">
          <span className="pick-title">{provider.name}</span>
          <button type="button" className="pick-close" aria-label="关闭" onClick={onCancel}>×</button>
        </div>
        <div className="pick-tools">
          <span className="pick-sum">已选 <b>{String(chosenCount)}</b> / {String(roster.length)}</span>
          <span className="pick-hint">勾上的才进模型选择器</span>
          <input
            className="search"
            type="search"
            value={query}
            placeholder="搜索模型"
            aria-label="搜索模型"
            onChange={event => { onQuery(event.target.value) }}
          />
        </div>
        <div className="pick-list">
          {listed.length === 0
            ? <p className="hint" style={{ margin: 'var(--s2)' }}>
                {roster.length === 0
                  ? busy
                    ? '正在拉取模型列表…'
                    : '这家还没有模型列表。填好 Key 后再点「发现模型」拉取。'
                  : '没有匹配的模型'}
              </p>
            : listed.map(id => {
                const name = modelNameOf(provider, modelRows, id)
                const facts = factsOf(id)
                const vision = provider.modelMeta?.[id]?.vision === true || facts?.vision === true
                const reasoning = provider.modelMeta?.[id]?.reasoning === true
                  || (facts?.supportedEfforts?.length ?? 0) > 0
                return (
                  <label key={id} className="mp-row">
                    <input
                      type="checkbox"
                      checked={chosen.has(id)}
                      disabled={busy}
                      onChange={event => { onToggleModel(id, event.target.checked) }}
                    />
                    <span className="mp-main">
                      <span className="mp-name">{name}</span>
                      <span className="mp-id">{id}</span>
                    </span>
                    <span className="mp-tags">
                      {isFreeLane(id) ? <span className="mp-tag">免费</span> : null}
                      {vision ? <span className="mp-tag" data-k="vis">识图</span> : null}
                      {reasoning ? <span className="mp-tag" data-k="rz">推理</span> : null}
                    </span>
                  </label>
                )
              })}
        </div>
        <div className="pick-foot">
          <span className="pick-hint" role="status">{footHint}</span>
          {roster.length > 0
            ? <>
                <button type="button" className="tiny" disabled={busy} onClick={() => { onSelectAll(true) }}>全选</button>
                <button type="button" className="tiny" disabled={busy} onClick={() => { onSelectAll(false) }}>全清</button>
              </>
            : null}
          <span className="pick-actions">
            <button type="button" className="btn" onClick={onCancel}>取消</button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !dirty || chosenCount === 0}
              onClick={() => { void onSave() }}
            >
              保存 {String(chosenCount)} 个
            </button>
          </span>
        </div>
      </div>
    </div>
  )
}

/**
 * The aggregate provider page: every vendor in the roster as a compact row the
 * user opens before configuring.
 *
 * WHY THE ROWS ARE COLLAPSED
 *
 * The roster is seventy-six vendors and, on a fresh install, none of them is
 * configured. The first version drew every row with its key field, endpoint
 * field and seven buttons already on screen and its switch already flipped, so
 * the page opened on a wall of empty inputs that read as "everything is
 * already in the pool, and also everything is broken". Nothing here is in the
 * pool until the user says so: the row shows what the vendor IS, and the fields
 * appear when the row is opened.
 *
 * Split out of {@link ../client/PoolCard} because the pool card is already a
 * long file and this page has its own fetch/state lifecycle — it reads a
 * different document (`POOL_AGGREGATE_PATH`) and must not be mounted on the
 * pool card's 30-second poll.
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
import { AGGREGATE_CARD_CSS } from './styles.ts'
import { BrandTile } from './brand-tile.tsx'
import { channelIcon, channelInitials } from './channel-icons.ts'
import { providerIcon } from './provider-icons.ts'
import { ModelFactsRow } from './model-facts-row.tsx'
import { modelFactsFor, type ModelFacts, type ModelProbeReading } from './model-facts.ts'
import { knownCapabilities, isFreeLane } from '../free-catalog.ts'
import { recommendUse } from './recommend-use.ts'
import { PageHero } from './shell.tsx'
/** The translator the settings section injects; the page renders every string through it. */
type Translate = (key: XdPoolSettingsKey, params?: Record<string, unknown>) => string
/** Props delivered by the slot wrapper in {@link ./PoolCard}. */
export interface AggregatePageProps {
  t?: Translate | undefined
}
/** Category order in the filter row, matching the registry's own vocabulary. */
const CATEGORIES = ['apikey', 'free', 'free-tier', 'local', 'oauth'] as const
type Category = (typeof CATEGORIES)[number]
const CATEGORY_LABEL: Readonly<Record<Category, XdPoolSettingsKey>> = Object.freeze({
  apikey: 'agg.catApikey',
  free: 'agg.catFree',
  'free-tier': 'agg.catFreeTier',
  local: 'agg.catLocal',
  oauth: 'agg.catOauth',
})
/**
 * Tile accents for the roster.
 *
 * The registry carries no colour of its own — it has no accent, icon or hex
 * field at all — so a vendor's tint is derived from its id. That is a weaker
 * claim than the login channels' hand-picked accents, and deliberately so: it
 * exists to keep seventy-six tiles from looking like one grey column, not to
 * assert a brand colour nobody published. A derived tint is stable across
 * reloads, which is the property that actually matters for recognition.
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
/** How many model ids a row may print before it collapses into "and N more". */
const MODEL_PREVIEW = 4
/**
 * How many models a vendor must offer before the per-vendor chooser is drawn.
 *
 * The whole point of this page's model picker is a roster too long to read at a
 * glance, so a threshold is what keeps the short ones looking like the short
 * ones. Eight is where scrolling starts to beat scanning.
 */
const MODEL_CHOOSER_THRESHOLD = 8
/**
 * Per-provider edit buffer.
 *
 * The key is never echoed back by the read route — `aggregateStatusOf` reports
 * only whether one is present — so the field starts empty and an empty field on
 * save means "leave the stored key alone". Clearing is its own action, because
 * silently overwriting a key with nothing is the one mistake here that loses
 * work the user cannot retype.
 */
interface ProviderDraft {
  apiKey: string
  baseUrl: string
}
export function AggregatePage({ t }: AggregatePageProps) {
  const [status, setStatus] = useState<PoolWebAggregateStatus | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  /** Provider ids with an in-flight action, so only that row shows a spinner. */
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set())
  /** providerId -> the flash line shown under that row. */
  const [flash, setFlash] = useState<Record<string, string>>({})
  const [drafts, setDrafts] = useState<Record<string, ProviderDraft>>({})
  /**
   * Which rows are open.
   *
   * Kept here rather than in the row so it survives the `load()` that follows
   * every save: a row that collapsed itself the moment the user pressed Save
   * would hide the confirmation line it just produced.
   */
  const [opened, setOpened] = useState<Record<string, boolean>>({})
  /**
   * providerId -> the model's ticked state while the chooser is being edited.
   *
   * Separate from the server document on purpose, exactly as the key draft is:
   * this is a BUFFER, and it is only ever sent when the user presses Save. A
   * chooser that wrote on every click would need a write per tick, would fight
   * the `load()` that follows each save, and would leave the roster disagreeing
   * with the boxes whenever the request failed.
   *
   * Absent means "no unsaved edit here", which is what makes the Save button
   * able to say whether there is anything to save.
   */
  const [modelDrafts, setModelDrafts] = useState<Record<string, readonly string[]>>({})
  /** providerId -> the filter typed into that vendor's model list. */
  const [modelQueries, setModelQueries] = useState<Record<string, string>>({})
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<Category | 'all'>('all')
  /**
   * providerId/modelId -> the last connectivity reading for that pair.
   *
   * Keyed by both because a model id is only unique within its provider: two
   * vendors may well both publish something called `flash`, and a reading taken
   * against one of them must never be shown on the other's row.
   */
  const [probes, setProbes] = useState<Record<string, ModelProbeReading>>({})
  /** The pair currently being measured, so only one button shows a spinner. */
  const [probing, setProbing] = useState<string | undefined>(undefined)
  const mounted = useRef(true)
  useEffect(() => () => { mounted.current = false }, [])
  /**
   * Ask the host to run one real request against a model, and keep the reading.
   *
   * The pair goes to the route exactly as the row spells it, because the host's
   * adapter registry is the only thing that knows which credential and endpoint
   * a given provider id resolves to. A transport failure is turned into a
   * reading rather than thrown, because "the test did not run" and "the test
   * failed" are both things this row should be able to print.
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
                error: reading?.error ?? `HTTP ${response.status}`,
              },
        }))
      }
    } catch (cause: unknown) {
      if (mounted.current) {
        setProbes(prev => ({
          ...prev,
          [key]: {
            ok: false,
            outputChars: 0,
            error: cause instanceof Error ? cause.message : String(cause),
          },
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
        if (mounted.current) setError(detail?.error ?? `HTTP ${response.status}`)
        return
      }
      if (mounted.current && signal?.aborted !== true) {
        setStatus(value as PoolWebAggregateStatus)
        setError(undefined)
      }
    } catch (cause: unknown) {
      // A dead panel is an absence of information, not a broken pool: say so
      // in place and let the next click retry.
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => { controller.abort() }
  }, [load])
  /** Post one patch, then re-read the document so the row shows what stuck. */
  const patch = useCallback(async (body: PoolWebAggregatePatch): Promise<boolean> => {
    const key = body.kind === 'provider' ? body.providerId : body.kind
    setBusyIds(prev => new Set(prev).add(key))
    try {
      const response = await fetch(POOL_AGGREGATE_SAVE_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        const detail = await response.json().catch(() => ({})) as { error?: string }
        throw new Error(detail.error ?? `HTTP ${response.status}`)
      }
      await load()
      return true
    } catch (cause: unknown) {
      if (mounted.current) {
        const message = cause instanceof Error ? cause.message : String(cause)
        setFlash(prev => ({ ...prev, [key]: `${t?.('agg.actionFailed') ?? 'Action failed'}: ${message}` }))
      }
      return false
    } finally {
      if (mounted.current) {
        setBusyIds(prev => {
          const next = new Set(prev)
          next.delete(key)
          return next
        })
      }
    }
  }, [load, t])
  const test = useCallback(async (providerId: string): Promise<void> => {
    setBusyIds(prev => new Set(prev).add(providerId))
    try {
      const response = await fetch(POOL_AGGREGATE_TEST_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ providerId }),
      })
      const probe = await response.json().catch(() => undefined) as PoolWebAggregateProbe | undefined
      if (mounted.current && probe !== undefined) {
        const ok = response.ok && probe.ok
        const head = ok
          ? (t?.('agg.probeOk') ?? 'Connected')
          : (t?.('agg.probeFail') ?? 'Connection failed')
        setFlash(prev => ({ ...prev, [providerId]: `${head} (HTTP ${probe.status}) ${probe.message}` }))
      }
    } finally {
      if (mounted.current) {
        setBusyIds(prev => {
          const next = new Set(prev)
          next.delete(providerId)
          return next
        })
      }
    }
  }, [t])
  const discover = useCallback(async (providerId: string): Promise<void> => {
    setBusyIds(prev => new Set(prev).add(providerId))
    try {
      const response = await fetch(POOL_AGGREGATE_DISCOVER_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ providerId }),
      })
      const probe = await response.json().catch(() => undefined) as PoolWebAggregateProbe | undefined
      if (mounted.current && probe !== undefined) {
        const committed = probe.committed ?? 0
        const line = response.ok && probe.ok
          ? committed > 0
            ? (t?.('agg.discovered', { count: committed }) ?? `Wrote ${committed} models`)
            : (t?.('agg.discoverEmpty') ?? 'That vendor listed no models.')
          : `${t?.('agg.probeFail') ?? 'Connection failed'}: ${probe.message}`
        setFlash(prev => ({ ...prev, [providerId]: line }))
        if (response.ok && probe.ok) await load()
      }
    } finally {
      if (mounted.current) {
        setBusyIds(prev => {
          const next = new Set(prev)
          next.delete(providerId)
          return next
        })
      }
    }
  }, [load, t])
  /**
   * The ticked ids for one vendor: the unsaved buffer if there is one, else the
   * server's own `models`.
   *
   * The fallback is `models` and not `availableModels` on purpose. A vendor with
   * no stored choice is exposing its whole roster, so the boxes must start full;
   * reading the roster here and then saving "everything" would be right too, but
   * it would mark every untouched vendor dirty the moment the page opened.
   */
  const chosenFor = useCallback(
    (provider: PoolWebAggregateProvider): ReadonlySet<string> =>
      new Set(modelDrafts[provider.id] ?? provider.models),
    [modelDrafts],
  )
  const laneBusy = busyIds.has('lane')
  const providers = status?.providers ?? []
  const laneEnabled = status?.enabled !== false
  /**
   * How many vendors each filter would show.
   *
   * Counted from the whole roster rather than from the current search, because
   * the buttons ARE the filter: a count that shrank as the user typed would
   * answer a question they did not ask ("how many match what I typed?") instead
   * of the one they did ("how much is in this category?").
   */
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const provider of providers) {
      counts.set(provider.category, (counts.get(provider.category) ?? 0) + 1)
    }
    return counts
  }, [providers])
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return providers.filter(provider => {
      if (category !== 'all' && provider.category !== category) return false
      if (needle === '') return true
      if (provider.name.toLowerCase().includes(needle)) return true
      if (provider.id.includes(needle)) return true
      if (provider.notes?.toLowerCase().includes(needle) === true) return true
      return provider.models.some(model => model.toLowerCase().includes(needle))
    })
  }, [providers, query, category])
  /** Model ids contributed right now, so a row can say what it is worth. */
  const contributionByProvider = useMemo(() => {
    const counts = new Map<string, number>()
    for (const row of status?.models ?? []) {
      counts.set(row.providerId, (counts.get(row.providerId) ?? 0) + 1)
    }
    return counts
  }, [status?.models])
  /**
   * The full model rows each provider contributes, grouped by provider id.
   *
   * The row's model list is a flat id array, so the per-model facts the status
   * document already carries (window, output ceiling, image support) have to be
   * joined back on here. Providers with no rows get an empty list rather than
   * being skipped, so "this vendor is configured but contributes nothing" stays
   * distinguishable from "this vendor is not in the document at all".
   */
  const modelRowsByProvider = useMemo(() => {
    const grouped = new Map<string, PoolWebAggregateStatus['models'][number][]>()
    for (const row of status?.models ?? []) {
      const bucket = grouped.get(row.providerId)
      if (bucket === undefined) grouped.set(row.providerId, [row])
      else bucket.push(row)
    }
    return grouped
  }, [status?.models])
  return (
    <div className="dsm-xdpool-agg">
      <style>{AGGREGATE_CARD_CSS}</style>
      <PageHero
        title={t?.('agg.title') ?? 'Providers'}
        sub={t?.('agg.sub') ?? ''}
        pills={<>
          <span className="dsm-xdpool-agg-pill" data-tone={laneEnabled ? 'ok' : 'off'}>
            {t?.('agg.laneOn') ?? 'Aggregate lane'}
          </span>
          <span className="dsm-xdpool-agg-pill" data-tone="info">
            {t?.('agg.count', { providers: status?.configured ?? 0, models: status?.modelCount ?? 0 })
              ?? `${status?.configured ?? 0} configured · ${status?.modelCount ?? 0} models`}
          </span>
        </>}
      />
      <div className="dsm-xdpool-agg-lanebar">
        <label className="dsm-xdpool-switch">
          <input
            type="checkbox"
            checked={laneEnabled}
            disabled={laneBusy || status === undefined}
            onChange={event => { void patch({ kind: 'lane', enabled: event.target.checked }) }}
          />
          <span>{t?.('agg.laneOn') ?? 'Aggregate lane'}</span>
        </label>
        {!laneEnabled
          ? <span className="dsm-xdpool-agg-hint">{t?.('agg.laneOffHint') ?? ''}</span>
          : null}
      </div>
      <div className="dsm-xdpool-agg-filter">
        <input
          className="dsm-xdpool-agg-search"
          type="search"
          value={query}
          placeholder={t?.('agg.search') ?? 'Search…'}
          onChange={event => { setQuery(event.target.value) }}
        />
        <div className="dsm-xdpool-agg-cats" role="group">
          <button
            type="button"
            className="dsm-xdpool-agg-cat"
            data-on={category === 'all' ? 'true' : 'false'}
            onClick={() => { setCategory('all') }}
          >
            {t?.('agg.catAll', { count: providers.length }) ?? `All categories (${providers.length})`}
          </button>
          {CATEGORIES.map(value => (
            <button
              key={value}
              type="button"
              className="dsm-xdpool-agg-cat"
              data-on={category === value ? 'true' : 'false'}
              onClick={() => { setCategory(value) }}
            >
              {/* The count rides in the label's own parentheses rather than in a
                  separate chip: "API key (60)" is one control to read, and a
                  bare number floating next to a filter is one more thing to
                  decode before the user can press it. */}
              {t?.(CATEGORY_LABEL[value], { count: categoryCounts.get(value) ?? 0 })
                ?? `${value} (${categoryCounts.get(value) ?? 0})`}
            </button>
          ))}
        </div>
      </div>
      {error !== undefined
        ? <p className="dsm-xdpool-panel-error">{error}</p>
        : null}
      {status === undefined && error === undefined
        ? <p className="dsm-xdpool-panel-empty">…</p>
        : visible.length === 0
          ? <p className="dsm-xdpool-panel-empty">{t?.('agg.empty') ?? 'No vendor matches.'}</p>
          : <div className="dsm-xdpool-agg-list">
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
                  onSave={async () => {
                    const draft = drafts[provider.id]
                    if (draft === undefined) return
                    const ok = await patch({
                      kind: 'provider',
                      providerId: provider.id,
                      // An empty field means "leave what is stored alone", never
                      // "store an empty key" — clearing has its own action.
                      ...draft.apiKey === '' ? {} : { apiKey: draft.apiKey },
                      ...draft.baseUrl === '' ? {} : { baseUrl: draft.baseUrl },
                    })
                    if (ok) {
                      setDrafts(prev => {
                        const next = { ...prev }
                        delete next[provider.id]
                        return next
                      })
                      setFlash(prev => ({ ...prev, [provider.id]: t?.('agg.saved') ?? 'Saved' }))
                    }
                  }}
                  onClear={async () => {
                    const ok = await patch({ kind: 'clear', providerId: provider.id })
                    if (ok) {
                      setDrafts(prev => {
                        const next = { ...prev }
                        delete next[provider.id]
                        return next
                      })
                      setFlash(prev => ({ ...prev, [provider.id]: t?.('agg.cleared') ?? 'Cleared' }))
                    }
                  }}
                  onToggle={enabled => { void patch({ kind: 'provider', providerId: provider.id, enabled }) }}
                  onTest={() => { void test(provider.id) }}
                  onDiscover={() => { void discover(provider.id) }}
                  onTestModel={(model) => { void testModel(provider.id, model) }}
                  chosen={chosenFor(provider)}
                  onToggleModel={(modelId, on) => {
                    // The first tick opens the buffer from the saved set, so a
                    // user who never pressed "Choose…" still gets a working
                    // chooser instead of boxes that refuse to move.
                    setModelDrafts(prev => {
                      const base = prev[provider.id] ?? [...chosenFor(provider)]
                      const next = new Set(base)
                      if (on) next.add(modelId)
                      else next.delete(modelId)
                      return { ...prev, [provider.id]: [...next] }
                    })
                  }}
                  modelQuery={modelQueries[provider.id] ?? ''}
                  onModelQuery={value => { setModelQueries(prev => ({ ...prev, [provider.id]: value })) }}
                  onEditModels={() => { setModelDrafts(prev => ({ ...prev, [provider.id]: [...chosenFor(provider)] })) }}
                  onDiscardModels={() => {
                    setModelDrafts(prev => {
                      const next = { ...prev }
                      delete next[provider.id]
                      return next
                    })
                  }}
                  onSelectAllModels={on => {
                    const freeOnly = isFreeLane(provider.id) || provider.id === 'opencode'
                    const roster = freeOnly
                      ? provider.availableModels.filter(id => isFreeLane(id))
                      : provider.availableModels
                    setModelDrafts(prev => ({ ...prev, [provider.id]: on ? [...roster] : [] }))
                  }}
                  onSaveModels={async () => {
                    const draft = modelDrafts[provider.id]
                    if (draft === undefined) return
                    const ok = await patch({ kind: 'provider', providerId: provider.id, models: draft })
                    if (ok) {
                      setModelDrafts(prev => {
                        const next = { ...prev }
                        delete next[provider.id]
                        return next
                      })
                      setFlash(prev => ({ ...prev, [provider.id]: t?.('agg.modelsSaved') ?? 'Model selection saved' }))
                    }
                  }}
                  onSaveManualModels={async ids => {
                    // A typed roster is a normal save: the ids go into the same
                    // `models` field the chooser writes, so the lane and the
                    // card agree on where a choice lives.
                    const ok = await patch({ kind: 'provider', providerId: provider.id, models: [...ids] })
                    if (ok) setFlash(prev => ({ ...prev, [provider.id]: t?.('agg.modelsSaved') ?? 'Model ids saved' }))
                    return ok
                  }}
                />
              ))}
            </div>}
    </div>
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
  onClear,
  onToggle,
  onTest,
  onDiscover,
  onTestModel,
  chosen,
  onToggleModel,
  modelQuery,
  onModelQuery,
  onEditModels,
  onSelectAllModels,
  onSaveModels,
  onSaveManualModels,
  onDiscardModels,
}: {
  provider: PoolWebAggregateProvider
  /** How many model rows this provider contributes to the picker right now. */
  contributed: number
  /**
   * The full model rows this provider contributes, for the facts and the test
   * button.
   *
   * Only the enabled ones are here, so a row never offers to test a model the
   * lane would not serve. An empty list is meaningful — it is a configured
   * vendor contributing nothing — so the caller passes `[]` rather than
   * omitting the prop.
   */
  modelRows: readonly PoolWebAggregateStatus['models'][number][]
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
  onClear: () => Promise<void>
  onToggle: (enabled: boolean) => void
  onTest: () => void
  onDiscover: () => void
  /** Run one connectivity test against one of this vendor's models. */
  onTestModel: (modelId: string) => void
  /** The model ids currently ticked — the unsaved buffer, or the saved set. */
  chosen: ReadonlySet<string>
  /** Tick or untick one model id, creating no buffer if none exists yet. */
  onToggleModel: (modelId: string, on: boolean) => void  /** The filter typed into this vendor's model list. */
  modelQuery: string
  onModelQuery: (value: string) => void
  /** Start editing: snapshot the saved set into the buffer so Save can tell. */
  onEditModels: () => void
  /** Tick the whole roster, or clear the buffer entirely. */
  onSelectAllModels: (on: boolean) => void
  onSaveModels: () => Promise<void>
  /**
   * Replace this provider's model ids with a list the user typed.
   *
   * Separate from {@link onSaveModels} because the chooser can only ever
   * toggle ids out of a roster; a record with no roster needs a way to put
   * one in. The save path is the same `models` field, so the two cannot
   * disagree about where the choice lives.
   */
  onSaveManualModels: (ids: readonly string[]) => Promise<boolean>
  /** Throw the buffer away and go back to what the server is serving. */
  onDiscardModels: () => void
}) {
  const enabled = provider.enabled
  const effective = enabled && laneEnabled
  /**
   * The ids typed into a manual roster, or the saved ones.
   *
   * Deliberately not the `chosen` buffer: that one exists to narrow a roster the
   * registry already defines, and a typed list IS the roster. Sharing the buffer
   * would make "Discard" mean two different things on two kinds of row.
   */
  const [manualText, setManualText] = useState<string | undefined>(undefined)
  const manualValue = manualText ?? provider.models.join(', ')
  const saveManual = async (): Promise<void> => {
    const ids = manualValue
      .split(/[\s,，]+/u)
      .map(id => id.trim())
      .filter(id => id !== '')
    const ok = await onSaveManualModels(ids)
    if (ok) setManualText(undefined)
  }
  const keyState = provider.authKind === 'none'
    ? (t?.('agg.noKeyNeeded') ?? 'No key needed')
    : provider.configured
      ? (t?.('agg.keySet') ?? 'Key set')
      : (t?.('agg.noKey') ?? 'No key')
  const preview = provider.models.slice(0, MODEL_PREVIEW)
  const rest = provider.models.length - preview.length
  const category = CATEGORY_LABEL[provider.category as Category]
  // Sign-in channel artwork first: where a vendor is both (minimax, gemini) that
  // icon is already worn by the other two pages, and showing two different marks
  // for one company would read as a bug. Then the vendor table. Three of the
  // seventy-six have neither and fall through to initials, which is honest in a
  // way a borrowed logo is not.
  const icon = channelIcon(provider.id) ?? providerIcon(provider.id)
  const tileMark =
    icon === undefined ? { initials: channelInitials(provider.name) } : { icon }
  const paneId = `dsm-xdpool-agg-${provider.id}`
  /**
   * How many model ids a chooser is worth showing.
   *
   * Below this the list is short enough to read without a filter, and a search
   * box over six entries is noise. Eighty-five is the case this exists for: a
   * free vendor that advertises everything it has, paid rows included.
   */
  /**
   * Capabilities for one model id, or undefined when it is not being served.
   *
   * `modelRows` carries the registry's declared figures, which is the right
   * answer wherever the registry declares one. Where it declares none — 456 of
   * 504 rows, and every id a "Fetch models" discovered — the row gets nothing
   * invented for it: the local capability table is consulted only for ids it
   * actually covers, and `knownCapabilities` answers `undefined` for the rest
   * rather than falling back to a generic row. A blank beside a real model name
   * is a gap; "128K" that we guessed would be a lie the user cannot see.
   *
   * It is consulted for ids on the keyless free lane and for OpenCode Free,
   * where the same table is the authority the lane itself builds its catalogue
   * from — those ids carry no registry row at all, so this is their best
   * published answer rather than a guess about it.
   */
  const factsOf = (modelId: string): ModelFacts | undefined => {
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
  /**
   * Whether this vendor's rows may fall back to the local capability table.
   *
   * Only the two keyless lanes qualify. Every other vendor has a registry, and a
   * locally-guessed window for a paid id would contradict whatever that vendor
   * actually serves.
   */
  const usesLocalCapabilities = (vendor: PoolWebAggregateStatus['providers'][number]): boolean =>
    isFreeLane(vendor.id) || vendor.id === 'opencode'
  /**
   * OpenCode's keyless free pool advertises every model it has, paid rows
   * included, and the plugin's own免密 lane is free by construction. For both,
   * the chooser shows only the free rows — the user asked that the free fetch
   * surface free models and nothing else — and the "select all" button is capped
   * to that free roster so it cannot quietly tick a paid id.
   */
  const freeOnly = usesLocalCapabilities(provider)
  const roster = freeOnly
    ? provider.availableModels.filter(id => isFreeLane(id))
    : provider.availableModels
  const rosterSize = roster.length
  const chooserWorthIt = rosterSize >= MODEL_CHOOSER_THRESHOLD
  const needle = modelQuery.trim().toLowerCase()
  const listedModels = (
    chooserWorthIt && needle === ''
      ? roster
      : roster.filter(id => id.toLowerCase().includes(needle))
  )
    .slice()
    /*
     * The roster arrives in whatever order the vendor listed or the registry
     * declared it, and that order answers no question. Rank it the way the
     * channel cards rank: free first, then the widest window, then image
     * support, then name. On a keyless lane that puts the handful of models
     * that actually answer above seventy that return 401 for want of a key.
     */
    .sort((a, b) => {
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
    })
  /**
   * The same roster ranked, joined back onto its registry rows.
   *
   * The fact list below used to walk `modelRows` in whatever order the registry
   * happened to hold, which meant the rows a user reads to judge a vendor were
   * ordered by nothing at all while the picker above them was ordered by
   * capability. Ranking once and deriving both from it keeps the two in step.
   */
  const sortedModelRows = modelRows
    .filter(row => !freeOnly || isFreeLane(row.modelId))
    .slice()
    .sort((a, b) => {
      const freeA = isFreeLane(a.modelId)
      const freeB = isFreeLane(b.modelId)
      if (freeA !== freeB) return freeA ? -1 : 1
      const windowA = factsOf(a.modelId)?.contextWindow ?? 0
      const windowB = factsOf(b.modelId)?.contextWindow ?? 0
      if (windowA !== windowB) return windowB - windowA
      const visionA = factsOf(a.modelId)?.vision === true
      const visionB = factsOf(b.modelId)?.vision === true
      if (visionA !== visionB) return visionA ? -1 : 1
      return a.modelId.localeCompare(b.modelId)
    })
  /**
   * Whether the boxes differ from what the server is serving right now.
   *
   * Compared as a set, not as a list: the order the buffer holds is whatever
   * order the user clicked in, and a save that only reordered the list must not
   * present itself as a change worth writing.
   */
  const modelSelectionDirty =
    chosen.size !== provider.models.length ||
    provider.models.some(id => !chosen.has(id))
  return (
    <article
      className="dsm-xdpool-agg-row"
      data-off={effective ? 'false' : 'true'}
      data-open={open ? 'true' : 'false'}
      style={{ '--dsm-xdpool-agg-accent': accentFor(provider.id) } as Record<string, string>}
    >
      <div className="dsm-xdpool-agg-rowhead">
        {/* The same 40px tile the sign-in page and the pool cards wear, so the
            three lists read as one product. */}
        <BrandTile accent={accentFor(provider.id)} glyph="globe" {...tileMark} />
        <div className="dsm-xdpool-agg-titles">
          <span className="dsm-xdpool-agg-name">{provider.name}</span>
          <span className="dsm-xdpool-agg-org">
            {category === undefined ? provider.category : (t?.(category) ?? provider.category)}
            {` · ${provider.format}`}
          </span>
        </div>
        <span className="dsm-xdpool-agg-state" data-tone={enabled ? 'ok' : 'off'}>
          {enabled
            ? (t?.('agg.stateOn') ?? 'In the pool')
            : (t?.('agg.stateOff') ?? 'Not in the pool')}
        </span>
      </div>
      {/* The vendor's own description, straight from the registry. There is no
          per-model blurb to show — the registry's model rows carry an id, a
          name and three capability flags and nothing else — so this is the
          vendor's line and the row must not pretend it describes a model. */}
      {provider.notes === undefined
        ? null
        : <p className="dsm-xdpool-agg-note">{provider.notes}</p>}
      <div className="dsm-xdpool-agg-foot">
        <div className="dsm-xdpool-agg-tags">
          <span className="dsm-xdpool-agg-tag" data-tone={provider.configured ? 'ok' : 'off'}>
            {keyState}
          </span>
          <span className="dsm-xdpool-agg-tag" data-tone="info">
            {t?.('agg.models', { count: provider.models.length }) ?? `${provider.models.length} models`}
          </span>
          {/* Only worth its own chip once the roster is bigger than the exposed
              set: "3 of 85" is the answer to "why does this vendor only show
              three", and at 3 of 3 it would just repeat the count beside it. */}
          {rosterSize > provider.models.length
            ? <span className="dsm-xdpool-agg-tag" data-tone="busy">
                {t?.('agg.chosenOf', { chosen: provider.models.length, total: rosterSize })
                  ?? `${provider.models.length} of ${rosterSize} chosen`}
              </span>
            : null}
          {contributed > 0
            ? <span className="dsm-xdpool-agg-tag" data-tone="busy">
                {t?.('agg.contributed', { count: contributed })
                  ?? `contributes ${contributed} models`}
              </span>
            : null}
          {provider.discovered
            ? <span className="dsm-xdpool-agg-tag" data-tone="live">
                {t?.('agg.discoveredTag') ?? 'live'}
              </span>
            : null}
          {/* Kept in the collapsed row rather than left inside the pane: it is
              what tells the user the "Fetch models" button is worth opening the
              row for in the first place. */}
          {provider.hasListing
            ? <span className="dsm-xdpool-agg-tag" data-tone="info">
                {t?.('agg.listingYes') ?? 'Model list available'}
              </span>
            : null}
        </div>
        <button
          type="button"
          className="dsm-xdpool-agg-open"
          aria-expanded={open}
          aria-controls={paneId}
          onClick={onOpen}
        >
          <span className="dsm-xdpool-agg-open-caret" aria-hidden="true" />
          {open
            ? (t?.('row.collapse') ?? 'Collapse')
            : (t?.('agg.setup') ?? 'Set up')}
        </button>
      </div>
      <div
        className="dsm-xdpool-agg-pane"
        id={paneId}
        role="group"
        hidden={!open}
      >
        {!provider.supported
          ? <p className="dsm-xdpool-agg-warn">
              {t?.('agg.unsupported') ?? 'This vendor signs in via OAuth/ADC.'}
            </p>
          : null}
        {provider.authKind !== 'none'
          ? <div className="dsm-xdpool-agg-fields">
              <label className="dsm-xdpool-agg-field">
                <span>{t?.('agg.key') ?? 'API key'}</span>
                <input
                  type="password"
                  autoComplete="off"
                  value={draft?.apiKey ?? ''}
                  placeholder={t?.('agg.keyPlaceholder') ?? 'Paste the key'}
                  onChange={event => { onDraft({ apiKey: event.target.value, baseUrl: draft?.baseUrl ?? '' }) }}
                />
              </label>
              <label className="dsm-xdpool-agg-field">
                <span>{t?.('agg.baseUrl') ?? 'Endpoint'}</span>
                <input
                  type="text"
                  value={draft?.baseUrl ?? provider.baseUrl ?? ''}
                  placeholder={t?.('agg.baseUrlPlaceholder') ?? 'Blank uses the default'}
                  onChange={event => { onDraft({ apiKey: draft?.apiKey ?? '', baseUrl: event.target.value }) }}
                />
              </label>
            </div>
          : null}
        {/* A record that declares no models has no chooser to draw: the ids ARE
            the user's input. It sits beside the key and endpoint because that is
            the order the setup happens in — point at a gateway, authenticate,
            then say what it serves. */}
        {provider.manualModels
          ? <div className="dsm-xdpool-agg-fields">
              <label className="dsm-xdpool-agg-field">
                <span>{t?.('agg.manualIds') ?? 'Model ids'}</span>
                <input
                  type="text"
                  spellCheck={false}
                  autoComplete="off"
                  value={manualValue}
                  placeholder={t?.('agg.manualPlaceholder') ?? 'gpt-4.1, my-model'}
                  onChange={event => { setManualText(event.target.value) }}
                />
              </label>
              <div className="dsm-xdpool-agg-actions">
                <button
                  type="button"
                  className="dsm-btn dsm-btn-outline"
                  disabled={busy}
                  onClick={() => { void saveManual() }}
                >
                  {t?.('agg.manualSave') ?? 'Save model ids'}
                </button>
                <span className="dsm-xdpool-agg-hint">{t?.('agg.manualHint') ?? ''}</span>
              </div>
            </div>
          : null}
        {/* The switch is separate from Save on purpose. Saving a key is what puts
            a vendor in the pool — that is the whole point of pasting one — but
            taking a vendor back OUT without throwing the key away is a different
            decision, and it needs its own control. */}
        <label className="dsm-xdpool-switch dsm-xdpool-agg-switch">
          <input
            type="checkbox"
            checked={enabled}
            disabled={busy}
            onChange={event => { onToggle(event.target.checked) }}
          />
          <span>{t?.('agg.enable') ?? 'Add to the pool'}</span>
        </label>
        <span className="dsm-xdpool-agg-hint">{t?.('agg.enableHint') ?? ''}</span>
        <div className="dsm-xdpool-agg-actions">
          <button
            type="button"
            className="dsm-btn dsm-btn-primary"
            disabled={busy || !provider.supported}
            onClick={() => { void onSave() }}
          >
            {busy ? (t?.('agg.saving') ?? 'Saving…') : (t?.('agg.save') ?? 'Save')}
          </button>
          <button
            type="button"
            className="dsm-btn dsm-btn-outline"
            disabled={busy || !provider.supported}
            onClick={() => { void onTest() }}
          >
            {t?.('agg.test') ?? 'Test'}
          </button>
          {provider.hasListing
            ? <button
                type="button"
                className="dsm-btn dsm-btn-outline"
                disabled={busy || !provider.supported || !provider.configured}
                onClick={() => { void onDiscover() }}
              >
                {t?.('agg.discover') ?? 'Fetch models'}
              </button>
            : null}
          {provider.authUrl !== undefined
            ? <a className="dsm-btn dsm-btn-ghost" href={provider.authUrl} target="_blank" rel="noreferrer noopener">
                {t?.('agg.getKey') ?? 'Get a key'}
              </a>
            : null}
          {provider.website !== undefined && provider.website !== provider.authUrl
            ? <a className="dsm-btn dsm-btn-ghost" href={provider.website} target="_blank" rel="noreferrer noopener">
                {t?.('agg.website') ?? 'Website'}
              </a>
            : null}
          <button
            type="button"
            className="dsm-btn dsm-btn-ghost"
            disabled={busy}
            onClick={() => { void onClear() }}
          >
            {t?.('agg.clear') ?? 'Clear'}
          </button>
        </div>
        {preview.length > 0
          ? <p className="dsm-xdpool-agg-models">
              {preview.join(' · ')}
              {rest > 0 ? ` +${rest}` : ''}
            </p>
          : null}
        {/* The preview line above is ids only, so it cannot answer "how big a
            context does that model have, and can it see a screenshot" — the two
            questions a user actually opens a provider page to ask. The full
            rows are already in the document; they are joined on here rather
            than re-fetched, so what is printed is the same numbers the lane
            serves from. */}
        {modelRows.length > 0
          ? <ul className="dsm-xdpool-agg-facts">
              {sortedModelRows.map(row => {
                const key = `${provider.id}/${row.modelId}`
                const recuse = isFreeLane(row.modelId) ? recommendUse(factsOf(row.modelId)) : undefined
                return (
                  <li
                    key={row.id}
                    className="dsm-xdpool-agg-fact"
                    data-live={row.source === 'discovered' ? 'true' : undefined}
                  >
                    <span className="dsm-xdpool-agg-fact-name">
                      {row.name}
                      {isFreeLane(row.modelId) && (
                        <span className="dsm-xdpool-cpool-tag" data-tone="free">
                          {t?.('agg.modelFreeTag') ?? 'free'}
                        </span>
                      )}
                    </span>
                    <ModelFactsRow
                      t={t}
                      facts={modelFactsFor(row)}
                      {...probes[key] === undefined
                        ? { onTest: () => { onTestModel(row.modelId) } }
                        : { probe: probes[key], probing: probing === key }}
                    />
                    {recuse === undefined ? null : (
                      <p className="dsm-xdpool-recuse">
                        <span className="dsm-xdpool-recuse-label">{t?.('recuse.label') ?? '推荐用途'}</span>
                        {recuse}
                      </p>
                    )}
                  </li>
                )
              })}
            </ul>
          : null}
        {/* The model chooser. Rendered whenever the vendor offers more than the
            collapsed "first four" line can show, because that is the point at
            which the ids on screen stop being readable — the ids list stays as
            the summary, and this is where they become choices. */}
        {rosterSize > MODEL_PREVIEW
          ? <div className="dsm-xdpool-agg-picker">
              <div className="dsm-xdpool-agg-pickerhead">
                <span className="dsm-xdpool-agg-pickerlabel">
                  {t?.('agg.modelPick') ?? 'Choose which models this vendor contributes'}
                </span>
                <button
                  type="button"
                  className="dsm-xdpool-btn"
                  data-tone="quiet"
                  onClick={onEditModels}
                >
                  {t?.('agg.editModels') ?? 'Choose…'}
                </button>
              </div>
              <p className="dsm-xdpool-agg-hint">
                {t?.('agg.modelPickHint') ?? ''}
              </p>
              {chooserWorthIt || modelQuery !== ''
                ? <input
                    className="dsm-xdpool-cpool-searchbox"
                    type="search"
                    value={modelQuery}
                    placeholder={t?.('agg.modelSearch') ?? 'Filter models…'}
                    onChange={event => { onModelQuery(event.target.value) }}
                  />
                : null}
              <ul className="dsm-xdpool-agg-modellist">
                {listedModels.map(id => {
                  const on = chosen.has(id)
                  const recuse = isFreeLane(id) ? recommendUse(factsOf(id)) : undefined
                  return (
                    <li key={id} className="dsm-xdpool-agg-modelrow">
                      <label>
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={event => { onToggleModel(id, event.target.checked) }}
                        />
                        <span className="dsm-xdpool-agg-modelid">{id}</span>
                        {isFreeLane(id) && (
                          <span className="dsm-xdpool-cpool-tag" data-tone="free">
                            {t?.('agg.modelFreeTag') ?? 'free'}
                          </span>
                        )}
                      </label>
                      {/* The capabilities a registry row does know, when this
                          vendor is actually serving the model right now. For an
                          id that is not exposed there is no row to join on, and
                          a blank would be a lie rather than a gap. */}
                      {factsOf(id) === undefined
                        ? null
                        : <ModelFactsRow t={t} facts={factsOf(id) ?? {}} />}
                      {recuse === undefined ? null : (
                        <p className="dsm-xdpool-recuse">
                          <span className="dsm-xdpool-recuse-label">{t?.('recuse.label') ?? '推荐用途'}</span>
                          {recuse}
                        </p>
                      )}
                    </li>
                  )
                })}
              </ul>
              {listedModels.length === 0
                ? <p className="dsm-xdpool-agg-hint">
                    {rosterSize === 0
                      ? (t?.('agg.modelNoneAtAll') ?? 'This vendor lists no models.')
                      : (t?.('agg.modelNone') ?? 'No model matches that filter.')}
                  </p>
                : null}
              {modelSelectionDirty
                ? <div className="dsm-xdpool-agg-pickeracts">
                    <button
                      type="button"
                      className="dsm-xdpool-btn"
                      data-tone="quiet"
                      disabled={busy}
                      onClick={() => { onSelectAllModels(false) }}
                    >
                      {t?.('agg.selectNone') ?? 'Clear all'}
                    </button>
                    <button
                      type="button"
                      className="dsm-xdpool-btn"
                      data-tone="quiet"
                      disabled={busy}
                      onClick={() => { onSelectAllModels(true) }}
                    >
                      {t?.('agg.selectAll') ?? 'Select all'}
                    </button>
                    <button
                      type="button"
                      className="dsm-xdpool-btn"
                      data-tone="quiet"
                      disabled={busy}
                      onClick={onDiscardModels}
                    >
                      {t?.('agg.discardModels') ?? 'Discard'}
                    </button>
                    <button
                      type="button"
                      className="dsm-xdpool-btn"
                      data-tone="primary"
                      disabled={busy}
                      onClick={() => { void onSaveModels() }}
                    >
                      {busy ? (t?.('agg.savingModels') ?? 'Saving…') : (t?.('agg.saveModels') ?? 'Save models')}
                    </button>
                  </div>
                : null}
            </div>
          : null}
        {flash !== undefined
          ? <p className="dsm-xdpool-agg-flash">{flash}</p>
          : null}
      </div>
    </article>
  )
}

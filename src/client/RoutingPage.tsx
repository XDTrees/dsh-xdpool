/**
 * The routing page: chains that are themselves models.
 *
 * A chain reads as one model id to the picker (`combo:<slug>`), and at call time
 * it is tried member by member until one answers. The point of the page is to
 * make ORDER visible and editable — order is the whole semantics, so members
 * render as a numbered list and never as an unordered set of tags.
 *
 * Split out of {@link ./PoolCard} for the same reason as the aggregate page: it
 * reads its own document (`POOL_COMBOS_PATH`) and must not ride the pool card's
 * 30-second poll, because a routing document only changes when this page writes
 * it.
 *
 * Two deliberate honesty choices, both about not lying to the user:
 *
 * 1. A member the roster lost is shown, not silently dropped. The server keeps
 *    the chain verbatim and reports the unresolved ids; the panel prints them.
 *    Dropping them would make the panel look correct while a different model
 *    quietly answered.
 * 2. `missing` is only a WARNING, never a block on saving. The user may be
 *    configuring a chain for a key they intend to paste in next. Refusing the
 *    save would be a worse lie than the warning.
 *
 * @module dsh-xdpool/client/RoutingPage
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  POOL_COMBOS_PATH,
  POOL_COMBOS_SAVE_PATH,
  type PoolWebCombo,
  type PoolWebComboCandidate,
  type PoolWebCombosStatus,
} from '../status-paths.ts'
import type { XdPoolSettingsKey } from './locales.ts'
import { ROUTING_CARD_CSS } from './styles.ts'
import { PageHero } from './shell.tsx'
/** The translator the settings section injects; the page renders every string through it. */
type Translate = (key: XdPoolSettingsKey, params?: Record<string, unknown>) => string
/** Props delivered by the slot wrapper in {@link ./PoolCard}. */
export interface RoutingPageProps {
  t?: Translate | undefined
}
/**
 * One chain as this page edits it.
 *
 * Two identities, deliberately: `key` is local to the panel and never sent,
 * `id` is the server's and is undefined until the chain is first saved. Editing
 * is tracked by `key`, not `id`, because a chain being written for the first
 * time has no id yet and still has to be editable.
 */
interface ChainDraft {
  key: string
  id?: string | undefined
  name: string
  /**
   * The chain as PLATFORM GROUPS — the edit model.
   *
   * Two levels, because that is the order the router walks: platform order, then
   * model order inside each platform. A flat member list can express the same
   * sequence but cannot show the grouping, so moving "all of WorkBuddy's models
   * together" meant moving them one at a time and hoping none was missed.
   *
   * Model ids inside a group are BARE; the `provider/` prefix is derived from
   * `owner` when the draft is flattened for saving.
   */
  platforms: Array<{ owner: string; models: string[] }>
  /**
   * The member sequence to SAVE, in the order it will actually be walked.
   *
   * Kept beside `platforms` rather than always derived from them, because grouping
   * is LOSSY for an interleaved chain: `hy3 → opencode/x → glm-5.3` collapses to
   * `hy3 → glm-5.3 → opencode/x` once both pool models share a group. That is the
   * right shape for the two-level model, but re-deriving it on every render would
   * silently rewrite the routing priority of a chain the user never touched — a save
   * that reorders their fallbacks without asking.
   *
   * So: `flat` starts as exactly what the server sent, and only an EDIT of the
   * platform structure recomputes it. Opening a chain and pressing Save therefore
   * preserves its order.
   */
  flat: string[]
  strategy: 'fallback' | 'round-robin'
  stickyLimit: number
  enabled: boolean
}
/**
 * Flatten a draft into the member ids the server stores.
 *
 * Platform order first, then model order within each platform. Duplicates are
 * dropped: the same pair twice would spend two attempts on one endpoint and report
 * a fallback that never happened. A pool model is its bare id; anything else is
 * `owner/model`, the same composite id the aggregate catalog publishes.
 */
function flattenDraft(platforms: ChainDraft['platforms']): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const platform of platforms) {
    for (const model of platform.models) {
      const id = platform.owner === 'workbuddy' ? model : `${platform.owner}/${model}`
      if (seen.has(id)) continue
      seen.add(id)
      out.push(id)
    }
  }
  return out
}
function draftOf(combo: PoolWebCombo): ChainDraft {
  /**
   * `missing` members are kept, grouped under their own owner, so the editor shows
   * the chain the user actually configured rather than the shorter one the roster
   * can serve right now. Dropping them would make a save silently delete members
   * the user never asked to remove — the "保存了没法用" class of data loss.
   */
  /**
   * A chain read from disk may be missing `platforms` entirely — an older shape, a
   * hand-edited file, or a partial write — and either level can be absent:
   * `platforms` itself, or one group's `models` array inside it.
   *
   * Both used to be spread unguarded, so a chain in either state crashed the whole
   * routing page with `Cannot read properties of undefined (reading 'length')` — a
   * message that names neither the chain nor the field, leaving nothing to act on.
   * Normalising here means every reader below can treat the shape as total.
   */
  const platforms = (Array.isArray(combo.platforms) ? combo.platforms : [])
    .filter(group => group !== null && typeof group === 'object')
    .map(group => ({
      owner: typeof group.owner === 'string' ? group.owner : 'workbuddy',
      models: Array.isArray(group.models)
        ? [...group.models].filter(model => typeof model === 'string')
        : [],
    }))
  const known = new Set(Array.isArray(combo.models) ? combo.models : [])
  for (const modelId of Array.isArray(combo.missing) ? combo.missing : []) {
    if (known.has(modelId)) continue
    const slash = modelId.indexOf('/')
    const owner = slash === -1 ? 'workbuddy' : modelId.slice(0, slash)
    const model = slash === -1 ? modelId : modelId.slice(slash + 1)
    const group = platforms.find(entry => entry.owner === owner)
    if (group === undefined) platforms.push({ owner, models: [model] })
    else if (!group.models.includes(model)) group.models.push(model)
  }
  return {
    key: combo.id,
    id: combo.id,
    name: combo.name,
    platforms,
    // EXACTLY what the server says the chain is, in its order. Not
    // `flattenDraft(platforms)`: grouping is lossy for an interleaved chain, so
    // deriving it here would reorder the user's fallbacks the moment the page
    // rendered, and the next Save would write that new order back.
    flat: [
      ...(Array.isArray(combo.models) ? combo.models : []),
      ...(Array.isArray(combo.missing) ? combo.missing : [])
        .filter(id => !(Array.isArray(combo.models) ? combo.models : []).includes(id)),
    ],
    strategy: combo.strategy,
    stickyLimit: combo.stickyLimit,
    enabled: combo.enabled,
  }
}
function blankDraft(): ChainDraft {
  return {
    key: `new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: '',
    platforms: [],
    flat: [],
    strategy: 'fallback',
    stickyLimit: 1,
    enabled: true,
  }
}
/** Compact counts: 1_260_000 -> "1.3M". Chains quote context windows, so this is load-bearing. */
function compact(value: number): string {
  if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}M`
  if (value >= 1_000) return `${Math.round(value / 100) / 10}K`
  return String(value)
}
export function RoutingPage({ t }: RoutingPageProps) {
  const [status, setStatus] = useState<PoolWebCombosStatus | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [flash, setFlash] = useState<string | undefined>(undefined)
  const [drafts, setDrafts] = useState<ChainDraft[]>([])
  const [saving, setSaving] = useState(false)
  /** Key of the chain being edited, or `undefined` when nothing is open. */
  const [editing, setEditing] = useState<string | undefined>(undefined)
  /** Model id chosen in the add-member row. */
  const [picked, setPicked] = useState('')
  /** True once the drafts were seeded from the server, so later polls don't stomp edits. */
  const seeded = useRef(false)
  const mounted = useRef(true)
  useEffect(() => () => { mounted.current = false }, [])
  const load = useCallback(async (signal?: AbortSignal): Promise<void> => {
    try {
      const response = await fetch(POOL_COMBOS_PATH, {
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
        const next = value as PoolWebCombosStatus
        setStatus(next)
        setError(undefined)
        // Seed the editor from the server's chains ONCE. Without this the list
        // would render "no chain yet" for a profile that has three of them, and
        // the first save would then wipe all three — the panel silently deleting
        // work because it never showed it. `seeded` keeps a later re-read from
        // discarding edits in flight.
        //
        // The guard is read and set BEFORE the state update is queued, and that
        // ordering is the whole fix. The previous form put the guard INSIDE the
        // updater callback and then flipped the flag on the following line —
        // React runs that callback later, in the commit phase, by which point
        // the flag was already true, so the callback always returned the
        // unchanged value and the editor stayed empty for a profile whose server
        // did have chains. The list then rendered "no chain yet" and the first
        // save posted an empty table over the real chains.
        if (!seeded.current) {
          seeded.current = true
          setDrafts((next.combos ?? []).map(draftOf))
        }
      }
    } catch (cause: unknown) {
      // Same contract as the provider page: a dead panel says so in place. The
      // pool keeps serving whatever chains it already resolved.
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => { controller.abort() }
  }, [load])
  const combos = status?.combos ?? []
  const candidates = status?.candidates ?? []
  const candidateById = useMemo(() => {
    const map = new Map<string, PoolWebComboCandidate>()
    for (const candidate of candidates) map.set(candidate.id, candidate)
    return map
  }, [candidates])
  // The add-member picker lists the roster itself. It USED to be preceded by a
  // text box whose placeholder repeated the hero pill verbatim ("Models you can
  // put in a chain"), which is why the user called the row meaningless: the box
  // restated a fact already on screen while the `<select>` beside it did the
  // narrowing natively (a select's own type-ahead matches on first letters). One
  // control, one job. `workbuddy` stays out: it is the pool lane's own provider
  // id, not a model, and routing through it would mean chaining the pool against
  // itself.
  const roster = useMemo(() => candidates.filter(candidate => candidate.id !== 'workbuddy'), [candidates])
  const current = drafts.find(draft => draft.key === editing)
  const patchDraft = useCallback((changes: Partial<ChainDraft>): void => {
    setDrafts(prev => prev.map(draft => (draft.key === editing ? { ...draft, ...changes } : draft)))
  }, [editing])
  const save = useCallback(async (): Promise<void> => {
    setSaving(true)
    try {
      const response = await fetch(POOL_COMBOS_SAVE_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        // The WHOLE table, because the server replaces it: a chain removed here
        // must actually disappear, and a partial patch cannot express "drop the
        // member the user deleted from the middle of a chain".
        //
        // Wrapped in `{ combos: … }`, NOT sent as a bare array. The route reads
        // `body['combos']`, so an array body made it fall into its
        // `Array.isArray(raw) ? raw : []` guard and save an EMPTY table — the
        // panel said "Saved", the chains were gone, and nothing in the response
        // distinguished that from a successful write of nothing. The route now
        // accepts both shapes so an already-shipped card cannot wipe a table,
        // but the shape it documents is this one.
        body: JSON.stringify({
          combos: drafts.map(draft => ({
            ...draft.id === undefined ? {} : { id: draft.id },
            name: draft.name,
            // BOTH shapes: `platforms` is what the editor works in, `models` is the
            // flattened sequence every resolver reads. The server derives `models`
            // from `platforms`, so sending both costs nothing and keeps a build
            // that predates the two-level editor from seeing an empty chain.
            platforms: draft.platforms.map(group => ({ owner: group.owner, models: group.models })),
            models: draft.flat,
            strategy: draft.strategy,
            stickyLimit: draft.stickyLimit,
            enabled: draft.enabled,
          })),
        }),
      })
      if (!response.ok) {
        const detail = await response.json().catch(() => ({})) as { error?: string }
        if (mounted.current) setFlash(`${t?.('route.saveFailed') ?? 'Could not save'}: ${detail.error ?? `HTTP ${response.status}`}`)
        return
      }
      if (!mounted.current) return
      // Re-read from the RESPONSE rather than keeping the local drafts: the
      // server is what mints ids for brand-new chains, so keeping the local
      // copy would leave a saved chain still keyed by `undefined` and the next
      // save would look like a fresh add rather than an edit.
      const next = (await response.json().catch(() => undefined)) as PoolWebCombosStatus
      setStatus(next)
      setDrafts((next.combos ?? []).map(draftOf))
      setFlash(t?.('route.saved') ?? 'Saved')
      setEditing(undefined)
    } catch (cause: unknown) {
      if (mounted.current) {
        setFlash(`${t?.('route.saveFailed') ?? 'Could not save'}: ${cause instanceof Error ? cause.message : String(cause)}`)
      }
    } finally {
      if (mounted.current) setSaving(false)
    }
  }, [drafts, t])
  const addChain = useCallback((): void => {
    const draft = blankDraft()
    // No id: the server mints one from the name on save. Editing it here would
    // mean showing the user an id derived from a name they have not typed yet.
    setDrafts(prev => [...prev, draft])
    setEditing(draft.key)
  }, [])
  return (
    <div className="dsm-xdpool-rt">
      <style>{ROUTING_CARD_CSS}</style>
      <PageHero
        title={t?.('route.title') ?? 'Routing'}
        sub={t?.('route.sub') ?? ''}
        pills={<>
          <span className="dsm-xdpool-pill" data-tone="ok">
            {t?.('route.memberCount', { count: combos.length }) ?? `${combos.length} chain(s)`}
          </span>
          {/* A COUNT, not the sentence that used to sit here. The user reported
              this as a duplicate: the same wording was the hero pill AND the
              search placeholder two hundred pixels below, so the page stated
              one fact twice and showed neither's number. The pill is the
              summary; the box is the control that acts on it. */}
          <span className="dsm-xdpool-pill" data-tone="off">
            {t?.('route.rosterCount', { count: candidates.length }) ?? `${candidates.length} model(s)`}
          </span>
        </>}
      />
      <div className="dsm-xdpool-rt-new">
        <span className="dsm-xdpool-rt-hint">{t?.('route.idHint') ?? ''}</span>
        {/*
          A primary button, not the filter chip it used to borrow. `.agg-cat` is
          a *filter* affordance — it sits in a row of mutually exclusive chips
          and reads as "narrow the list", which is the opposite of "start a new
          chain". The chip does render here (its rules are in the shared sheet,
          which the shell injects on every page); it is the MEANING that was
          wrong, not the styling.
        */}
        <button type="button" className="dsm-btn dsm-btn-primary" onClick={addChain}>
          {t?.('route.newChain') ?? 'New chain'}
        </button>
      </div>
      {error !== undefined ? <p className="dsm-xdpool-panel-error">{error}</p> : null}
      {flash !== undefined ? <p className="dsm-xdpool-rt-flash">{flash}</p> : null}
      {status === undefined && error === undefined
        ? <p className="dsm-xdpool-panel-empty">{t?.('route.loading') ?? 'Reading…'}</p>
        : null}
      {current !== undefined
        ? <ChainEditor
          draft={current}
          roster={roster}
          busy={saving}
          candidateById={candidateById}
          t={t}
          onChange={patchDraft}
        />
        : null}
      {status === undefined
        ? null
        : drafts.length === 0
          ? <p className="dsm-xdpool-panel-empty">{t?.('route.empty') ?? 'No chain yet.'}</p>
          : <div className="dsm-xdpool-rt-list">
              {drafts.map(draft => (
                <ChainRow
                  key={draft.key}
                  draft={draft}
                  editable={draft.key === editing}
                  candidateById={candidateById}
                  t={t}
                  onEdit={() => { setEditing(draft.key) }}
                  onDelete={() => {
                    setDrafts(prev => prev.filter(entry => entry !== draft))
                    if (editing === draft.key) setEditing(undefined)
                  }}
                />
              ))}
              <div className="dsm-xdpool-rt-actions">
                {/* The shared button, not the aggregate filter chip this used to
                    borrow. The chip renders here — its rules are in the shared
                    sheet, which the shell injects on every page — but it is a
                    filter affordance: a 999px-radius pill that sits in a row of
                    mutually exclusive options. Saving chains is an action, and
                    this page now says so with the same control the pool card
                    uses for its own saves. */}
                <button
                  type="button"
                  className="dsm-btn dsm-btn-primary"
                  disabled={saving}
                  onClick={() => { void save() }}
                >
                  {saving ? (t?.('route.saving') ?? 'Saving…') : (t?.('route.save') ?? 'Save chains')}
                </button>
              </div>
            </div>}
    </div>
  )
}
/**
 * One chain row.
 *
 * Members are rendered from the DRAFT, not from the server's `models` list, and
 * the draft carries `missing` ids too. That is what lets the panel show a member
 * the roster lost instead of quietly presenting a shorter chain than the user
 * typed.
 */
function ChainRow({
  draft,
  editable,
  candidateById,
  t,
  onEdit,
  onDelete,
}: {
  draft: ChainDraft
  editable: boolean
  candidateById: Map<string, PoolWebComboCandidate>
  t?: Translate | undefined
  onEdit: () => void
  onDelete: () => void
}) {
  /**
   * Members the roster cannot serve right now, computed from the FLATTENED draft.
   *
   * Flattened rather than read off the groups, so the check matches what would be
   * saved: a group holds bare ids and the roster holds composite ones, and
   * comparing the two shapes directly would mark every aggregate member missing.
   */
  const flat = draft.flat
  const missing = flat.filter(model => candidateById.has(model) === false)
  return (
    <div className="dsm-xdpool-rt-row" data-off={draft.enabled ? 'false' : 'true'}>
      <div className="dsm-xdpool-rt-rowhead">
        <span className="dsm-xdpool-rt-name">{draft.name === '' ? (t?.('route.newChain') ?? 'New chain') : draft.name}</span>
        {draft.id !== undefined
          ? <span className="dsm-xdpool-rt-cid">{draft.id}</span>
          : null}
        <span className="dsm-xdpool-pill" data-tone={draft.enabled ? 'ok' : 'off'}>
          {draft.enabled ? (t?.('route.enabled') ?? 'Enabled') : (t?.('route.chainDisabled') ?? 'Disabled')}
        </span>
        <span className="dsm-xdpool-pills">
          <span className="dsm-xdpool-pill" data-tone="off">
            {t?.('route.platformCount', { count: draft.platforms.length }) ?? `${draft.platforms.length} platform(s)`}
          </span>
          <span className="dsm-xdpool-pill" data-tone="off">
            {t?.('route.memberCount', { count: flat.length }) ?? `${flat.length} model(s)`}
          </span>
        </span>
        <span className="dsm-xdpool-pageactions">
          {/* An outline button, not the aggregate filter chip this borrowed: the
              chip's rule is in the shared sheet, so it renders, but Edit sits in
              a pair of per-row actions and reading as one filter pill among
              options made the pair look like a choice rather than a pair of
              commands. */}
          <button type="button" className="dsm-btn dsm-btn-outline" onClick={onEdit}>
            {editable ? (t?.('route.editOpen') ?? 'Editing') : (t?.('route.edit') ?? 'Edit')}
          </button>
          <button type="button" className="dsm-xdpool-rt-drop" onClick={onDelete}>
            {t?.('route.removeMember') ?? 'Remove'}
          </button>
        </span>
      </div>
      {/*
        The chain as PLATFORM CAPSULES, numbered in the order the router walks
        them: `1. TRAE（字节）· 1`. The number is the priority, the trailing figure
        is how many of that platform's models are in the chain — which together say
        "tries TRAE first, one model there" without opening the editor.

        This replaced a flat list of model ids, which stated the same sequence but
        made the reader work out the platform boundaries themselves. That is the
        part the two-level editor is for, and it should be visible collapsed too.
      */}
      {draft.platforms.length === 0
        ? <p className="dsm-xdpool-rt-warn">{t?.('route.noMembers') ?? 'Add at least one member.'}</p>
        : <ol className="dsm-xdpool-rt-lanes">
            {draft.platforms.map((platform, index) => (
              <li className="dsm-xdpool-rt-lane" key={`${platform.owner}-${index}`}>
                <span className="dsm-xdpool-rt-ord">{index + 1}</span>
                <span className="dsm-xdpool-rt-lanename" title={platform.owner}>
                  {ownerName(platform.owner, t)}
                </span>
                <span className="dsm-xdpool-rt-lanecount">· {platform.models.length}</span>
              </li>
            ))}
          </ol>}
      {missing.length > 0
        ? <p className="dsm-xdpool-rt-warn">
            {t?.('route.missing', { models: missing.join(', ') }) ?? missing.join(', ')}
          </p>
        : null}
    </div>
  )
}
/**
 * A readable name for one platform.
 *
 * `workbuddy` is this plugin's own pool lane, so it gets the product name the cards
 * use. Every other owner IS a provider id, and it is printed as-is: the aggregate
 * page, the model picker and this page then show one spelling for one channel, and
 * inventing a second one here would make the same vendor look like two.
 */
function ownerName(owner: string, t?: Translate | undefined): string {
  if (owner === 'workbuddy') return t?.('route.ownerPool') ?? 'XD Pool（WorkBuddy）'
  return owner
}
/**
 * The model id WITHOUT its provider prefix.
 *
 * A candidate's id is the composite the picker and the aggregate catalog use
 * (`provider/model`), while a platform group stores bare ids — the owner sits in the
 * field beside them, so carrying the prefix in both would let the two disagree. A
 * pool candidate's id is already bare (`hy3`), which is why this checks the prefix
 * instead of always slicing.
 */
function bareModelOf(candidate: PoolWebComboCandidate): string {
  const prefix = `${candidate.owner}/`
  return candidate.id.startsWith(prefix) ? candidate.id.slice(prefix.length) : candidate.id
}
/**
 * The editor for exactly one chain — TWO LEVELS, like the router walks it.
 *
 * Platform order first, then model order inside each platform. That is the
 * documented fallback semantics ("same platform: try the next model; platform
 * exhausted: the next platform"), and it is the shape a reader thinks in. The
 * previous editor was a single flat list of model ids, which could express the same
 * sequence but could not SHOW the grouping — so moving "all of WorkBuddy's models
 * together" meant clicking one at a time and hoping none was missed, and the
 * platform boundaries had to be re-derived by eye from the ids.
 *
 * Each platform card carries its own controls (up / down / remove, and the same for
 * every model inside it), which is why the pickers are local state: a chain can have
 * a dozen platforms open at once and one shared "picked" slot would make selecting a
 * model in one card silently change what another card was about to add.
 */
function ChainEditor({
  draft,
  roster,
  busy,
  candidateById,
  t,
  onChange,
}: {
  draft: ChainDraft
  roster: readonly PoolWebComboCandidate[]
  busy: boolean
  candidateById: Map<string, PoolWebComboCandidate>
  t?: Translate | undefined
  onChange: (changes: Partial<ChainDraft>) => void
}) {
  /**
   * One pending selection per platform, keyed by owner, plus one for the
   * "add platform" row. Local because it is transient editor state: it must not
   * travel into the draft, or an unsaved picker value would be saved as part of the
   * chain and reappear on the next open.
   */
  const [pickByLane, setPickByLane] = useState<Record<string, string>>({})
  const [pickLane, setPickLane] = useState('')

  /** Owners already in the chain — a platform appears at most once. */
  const used = draft.platforms.map(platform => platform.owner)
  /**
   * Platforms still available to add, with how many models each could offer.
   *
   * Counted from the roster so the dropdown says what it is worth adding: an empty
   * platform would produce a card with nothing to put in it.
   */
  const addable = useMemo(() => {
    const counts = new Map<string, number>()
    for (const candidate of roster) {
      if (used.includes(candidate.owner)) continue
      counts.set(candidate.owner, (counts.get(candidate.owner) ?? 0) + 1)
    }
    return [...counts.entries()].map(([owner, count]) => ({ owner, count }))
  }, [roster, used.join('\u0000')])

  /**
   * Apply one platform edit and RECOMPUTE `flat` from the new structure.
   *
   * Every path that changes the platform shape goes through here, so `flat` is only
   * ever re-derived as the direct result of a user action — never on render. That is
   * the difference between "the editor reorders what I asked it to" and "saving an
   * untouched chain silently rewrote my fallback order".
   */
  const commit = (platforms: ChainDraft['platforms']): void => {
    onChange({ platforms, flat: flattenDraft(platforms) })
  }
  const patchLane = (index: number, update: { models?: string[]; owner?: string }): void => {
    commit(draft.platforms.map((platform, at) => (at === index ? { ...platform, ...update } : platform)))
  }
  const moveLane = (index: number, delta: number): void => {
    const next = [...draft.platforms]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    const [moved] = next.splice(index, 1)
    if (moved === undefined) return
    next.splice(target, 0, moved)
    commit(next)
  }
  const dropLane = (index: number): void => {
    commit(draft.platforms.filter((_, at) => at !== index))
  }
  /** Models of one owner that are not in this platform's group yet. */
  const candidatesFor = (owner: string, group: { models: readonly string[] }): readonly PoolWebComboCandidate[] =>
    roster.filter(candidate => candidate.owner === owner && !group.models.includes(bareModelOf(candidate)))

  return (
    <div className="dsm-xdpool-rt-editor">
      <div className="dsm-xdpool-rt-editorhead">
        <span className="dsm-xdpool-rt-edname">
          {draft.name === '' ? (t?.('route.newChain') ?? 'New chain') : draft.name}
        </span>
        <label className="dsm-xdpool-switch">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={event => { onChange({ enabled: event.target.checked }) }}
          />
          <span>{t?.('route.enabled') ?? 'Enabled'}</span>
        </label>
      </div>
      <div className="dsm-xdpool-rt-fields">
        <label className="dsm-xdpool-rt-field">
          <span>{t?.('route.chainName') ?? 'Chain name'}</span>
          <input
            type="text"
            value={draft.name}
            placeholder={t?.('route.chainNamePlaceholder') ?? ''}
            onChange={event => { onChange({ name: event.target.value }) }}
          />
        </label>
        <label className="dsm-xdpool-rt-field">
          <span>{t?.('route.strategy') ?? 'Strategy'}</span>
          <select
            value={draft.strategy}
            onChange={event => { onChange({ strategy: event.target.value === 'round-robin' ? 'round-robin' : 'fallback' }) }}
          >
            <option value="fallback">{t?.('route.strategyFallback') ?? 'Fallback'}</option>
            <option value="round-robin">{t?.('route.strategyRoundRobin') ?? 'Round robin'}</option>
          </select>
        </label>
        <label className="dsm-xdpool-rt-field">
          <span>{t?.('route.stickyLimit') ?? 'Turns per member'}</span>
          <input
            type="number"
            min={1}
            value={draft.stickyLimit}
            onChange={event => {
              const parsed = Number.parseInt(event.target.value, 10)
              // A non-finite or non-positive value would be normalised away by the
              // server, so the field would visibly snap back after a save.
              onChange({ stickyLimit: Number.isFinite(parsed) && parsed > 0 ? parsed : 1 })
            }}
          />
        </label>
      </div>
      <p className="dsm-xdpool-rt-hint">{t?.('route.stickyHint') ?? ''}</p>

      <p className="dsm-xdpool-rt-hint">{t?.('route.platformOrder') ?? 'Platform order (higher is tried first)'}</p>
      {draft.platforms.length === 0
        ? <p className="dsm-xdpool-rt-warn">{t?.('route.noMembers') ?? 'Add at least one member.'}</p>
        : <div className="dsm-xdpool-rt-laneboxes">
            {draft.platforms.map((platform, index) => {
              const group = { models: platform.models }
              const choices = candidatesFor(platform.owner, group)
              const picked = pickByLane[platform.owner] ?? ''
              return (
                <div className="dsm-xdpool-rt-lanebox" key={`${platform.owner}-${index}`}>
                  <div className="dsm-xdpool-rt-lanebox-head">
                    <span className="dsm-xdpool-rt-ord">{index + 1}</span>
                    <span className="dsm-xdpool-rt-lanebox-name">{ownerName(platform.owner, t)}</span>
                    <span className="dsm-xdpool-rt-cid">{platform.owner}</span>
                  </div>
                  <div className="dsm-xdpool-rt-laneacts">
                    <button type="button" className="dsm-xdpool-rt-drop" disabled={index === 0} onClick={() => { moveLane(index, -1) }}>
                      {t?.('route.moveUp') ?? 'Up'}
                    </button>
                    <button type="button" className="dsm-xdpool-rt-drop" disabled={index === draft.platforms.length - 1} onClick={() => { moveLane(index, 1) }}>
                      {t?.('route.moveDown') ?? 'Down'}
                    </button>
                    <button type="button" className="dsm-xdpool-rt-drop" onClick={() => { dropLane(index) }}>
                      {t?.('route.removePlatform') ?? 'Remove'}
                    </button>
                  </div>
                  {platform.models.length === 0
                    ? <p className="dsm-xdpool-rt-hint">{t?.('route.platformNoModels') ?? 'No model added to this platform yet.'}</p>
                    : <ol className="dsm-xdpool-rt-members">
                        {platform.models.map((model, modelIndex) => {
                          const fullId = platform.owner === 'workbuddy' ? model : `${platform.owner}/${model}`
                          const candidate = candidateById.get(fullId)
                          return (
                            <li className="dsm-xdpool-rt-member" key={`${model}-${modelIndex}`}>
                              <span className="dsm-xdpool-rt-ord">{modelIndex + 1}</span>
                              <span className="dsm-xdpool-rt-mid" title={fullId}>{model}</span>
                              {candidate === undefined
                                ? <span className="dsm-xdpool-agg-tag dsm-xdpool-rt-mtag" data-tone="busy">
                                    {t?.('route.unusable') ?? 'needs a key'}
                                  </span>
                                : <span className="dsm-xdpool-agg-tag dsm-xdpool-rt-mtag" data-tone="ok">
                                    {compact(candidate.contextWindow)}
                                  </span>}
                              <button
                                type="button"
                                className="dsm-xdpool-rt-drop"
                                disabled={modelIndex === 0}
                                onClick={() => {
                                  const next = [...platform.models]
                                  const [moved] = next.splice(modelIndex, 1)
                                  if (moved === undefined) return
                                  next.splice(modelIndex - 1, 0, moved)
                                  patchLane(index, { models: next })
                                }}
                              >
                                {t?.('route.moveUp') ?? 'Up'}
                              </button>
                              <button
                                type="button"
                                className="dsm-xdpool-rt-drop"
                                disabled={modelIndex === platform.models.length - 1}
                                onClick={() => {
                                  const next = [...platform.models]
                                  const [moved] = next.splice(modelIndex, 1)
                                  if (moved === undefined) return
                                  next.splice(modelIndex + 1, 0, moved)
                                  patchLane(index, { models: next })
                                }}
                              >
                                {t?.('route.moveDown') ?? 'Down'}
                              </button>
                              <button
                                type="button"
                                className="dsm-xdpool-rt-drop"
                                onClick={() => { patchLane(index, { models: platform.models.filter(entry => entry !== model) }) }}
                              >
                                {t?.('route.removeMember') ?? 'Remove'}
                              </button>
                            </li>
                          )
                        })}
                      </ol>}
                  {/* One picker per platform, and it lists only THAT platform's
                      models — the grouping is now structural, so a grouped
                      dropdown would repeat what the card already says. */}
                  {choices.length === 0
                    ? null
                    : <div className="dsm-xdpool-rt-addrow">
                        <select
                          className="dsm-xdpool-rt-pick"
                          value={picked}
                          disabled={busy}
                          onChange={event => { setPickByLane(prev => ({ ...prev, [platform.owner]: event.target.value })) }}
                        >
                          <option value="">{t?.('route.pickModel') ?? 'Pick a model…'}</option>
                          {choices.map(choice => (
                            <option key={choice.id} value={bareModelOf(choice)}>{choice.name} — {bareModelOf(choice)}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="dsm-btn dsm-btn-outline"
                          disabled={busy || picked === ''}
                          onClick={() => {
                            if (picked === '' || platform.models.includes(picked)) return
                            patchLane(index, { models: [...platform.models, picked] })
                            setPickByLane(prev => ({ ...prev, [platform.owner]: '' }))
                          }}
                        >
                          {t?.('route.addModel') ?? 'Add model'}
                        </button>
                      </div>}
                </div>
              )
            })}
          </div>}

      {addable.length === 0
        ? null
        : <div className="dsm-xdpool-rt-addrow">
            <select
              className="dsm-xdpool-rt-pick"
              value={pickLane}
              disabled={busy}
              onChange={event => { setPickLane(event.target.value) }}
            >
              <option value="">{t?.('route.pickPlatform') ?? 'Pick a platform…'}</option>
              {addable.map(entry => (
                <option key={entry.owner} value={entry.owner}>
                  {ownerName(entry.owner, t)}（{entry.count}）
                </option>
              ))}
            </select>
            <button
              type="button"
              className="dsm-btn dsm-btn-outline"
              disabled={busy || pickLane === ''}
              onClick={() => {
                if (pickLane === '' || used.includes(pickLane)) return
                commit([...draft.platforms, { owner: pickLane, models: [] }])
                setPickLane('')
              }}
            >
              {t?.('route.addPlatform') ?? 'Add platform'}
            </button>
          </div>}
      <p className="dsm-xdpool-rt-hint">{t?.('route.platformHint') ?? 'Higher is tried first; the same applies to models inside one platform.'}</p>
    </div>
  )
}

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
  models: string[]
  strategy: 'fallback' | 'round-robin'
  stickyLimit: number
  enabled: boolean
}
function draftOf(combo: PoolWebCombo): ChainDraft {
  return {
    key: combo.id,
    id: combo.id,
    name: combo.name,
    // `missing` ids are carried into the draft so the editor shows the chain the
    // user actually typed, not the shorter one the roster can currently serve.
    models: [...combo.models, ...combo.missing],
    strategy: combo.strategy,
    stickyLimit: combo.stickyLimit,
    enabled: combo.enabled,
  }
}
function blankDraft(): ChainDraft {
  return { key: `new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name: '', models: [], strategy: 'fallback', stickyLimit: 1, enabled: true }
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
        body: JSON.stringify(drafts.map(draft => ({
          ...draft.id === undefined ? {} : { id: draft.id },
          name: draft.name,
          models: draft.models,
          strategy: draft.strategy,
          stickyLimit: draft.stickyLimit,
          enabled: draft.enabled,
        }))),
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
          picked={picked}
          busy={saving}
          candidateById={candidateById}
          t={t}
          onPick={setPicked}
          onChange={patchDraft}
          onAddMember={() => {
            if (picked === '' || current.models.includes(picked)) return
            patchDraft({ models: [...current.models, picked] })
            setPicked('')
          }}
          onDropMember={modelId => {
            patchDraft({ models: current.models.filter(id => id !== modelId) })
          }}
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
  const missing = draft.models.filter(model => candidateById.has(model) === false)
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
            {t?.('route.strategyLabel', {
              strategy: draft.strategy === 'round-robin'
                ? (t?.('route.strategyRoundRobin') ?? 'Round robin')
                : (t?.('route.strategyFallback') ?? 'Fallback'),
              members: t?.('route.memberCount', { count: draft.models.length }) ?? `${draft.models.length}`,
            }) ?? draft.strategy}
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
      {missing.length > 0
        ? <p className="dsm-xdpool-rt-warn">
            {t?.('route.missing', { models: missing.join(', ') }) ?? missing.join(', ')}
          </p>
        : null}
    </div>
  )
}
/** The editor for exactly one chain, rendered full width above the list. */
function ChainEditor({
  draft,
  roster,
  picked,
  busy,
  candidateById,
  t,
  onPick,
  onChange,
  onAddMember,
  onDropMember,
}: {
  draft: ChainDraft
  roster: readonly PoolWebComboCandidate[]
  picked: string
  busy: boolean
  candidateById: Map<string, PoolWebComboCandidate>
  t?: Translate | undefined
  onPick: (value: string) => void
  onChange: (changes: Partial<ChainDraft>) => void
  onAddMember: () => void
  onDropMember: (modelId: string) => void
}) {
  return (
    <div className="dsm-xdpool-rt-editor">
      <div className="dsm-xdpool-rt-editorhead">
        <span className="dsm-xdpool-rt-edname">{draft.name === '' ? (t?.('route.newChain') ?? 'New chain') : draft.name}</span>
        <label className="dsm-xdpool-switch">
          <input type="checkbox" checked={draft.enabled} onChange={event => { onChange({ enabled: event.target.checked }) }} />
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
              // A non-finite or non-positive value would be normalised away by
              // the server, so the field would visibly snap back after a save.
              // Rejecting it here keeps the editor and the stored chain in step.
              onChange({ stickyLimit: Number.isFinite(parsed) && parsed > 0 ? parsed : 1 })
            }}
          />
        </label>
      </div>
      <p className="dsm-xdpool-rt-hint">{t?.('route.stickyHint') ?? ''}</p>
      <div>
        <span className="dsm-xdpool-rt-hint">{t?.('route.members') ?? 'Members'}</span>
        {draft.models.length === 0
          ? <p className="dsm-xdpool-rt-warn">{t?.('route.noMembers') ?? ''}</p>
          : <ol className="dsm-xdpool-rt-members">
              {draft.models.map((modelId, index) => {
                const candidate = candidateById.get(modelId)
                return (
                  <li className="dsm-xdpool-rt-member" key={`${modelId}-${index}`}>
                    <span className="dsm-xdpool-rt-ord">{index + 1}</span>
                    <span className="dsm-xdpool-rt-mid" title={modelId}>{modelId}</span>
                    {candidate === undefined
                      ? <span className="dsm-xdpool-agg-tag dsm-xdpool-rt-mtag" data-tone="busy">
                          {t?.('route.unusable') ?? 'needs a key'}
                        </span>
                      : <span className="dsm-xdpool-agg-tag dsm-xdpool-rt-mtag" data-tone="ok">
                          {compact(candidate.contextWindow)}
                        </span>}
                    <button type="button" className="dsm-xdpool-rt-drop" onClick={() => { onDropMember(modelId) }}>
                      {t?.('route.removeMember') ?? 'Remove'}
                    </button>
                  </li>
                )
              })}
            </ol>}
      </div>
      {/* One control commits one member: the picker lists the roster, the button
          puts the chosen id into the chain. The search box that used to sit
          here repeated the hero pill verbatim and duplicated what the select's
          own type-ahead already does — the user called the row meaningless. The
          picker keeps its own recessed-strip chrome (`.rt-pick`) because the
          label-field selector's rules only match `.rt-field input, .rt-field
          select`, and this control IS the `.rt-field`; borrowing it left a bare
          browser dropdown in the middle of a restyled row. */}
      <div className="dsm-xdpool-rt-addrow">
        <select
          className="dsm-xdpool-rt-pick"
          value={picked}
          onChange={event => { onPick(event.target.value) }}
        >
          <option value="">{t?.('route.id') ?? 'Model id'}</option>
          {roster.map(candidate => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.id} — {candidate.name}
            </option>
          ))}
        </select>
        {/* An action, so it wears the action button. It used to borrow
            `.agg-cat`, which is a filter chip — it renders now that the chip
            lives in the shared sheet, but a chip that commits an edit reads as
            a toggle, and the user cannot tell whether it is now on. */}
        <button type="button" className="dsm-btn dsm-btn-outline" disabled={busy || picked === ''} onClick={onAddMember}>
          {t?.('route.addMember') ?? 'Add'}
        </button>
      </div>
    </div>
  )
}
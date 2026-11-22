/**
 * The routing page: chains that are themselves models.
 *
 * A chain reads as one model id to the picker (`combo:<slug>`), and at call time
 * it is tried member by member until one answers. The point of the page is to
 * make ORDER visible and editable — order is the whole semantics, so members
 * render as a numbered list and never as an unordered set of tags.
 *
 * 版面照设计稿 routing.html：
 *   main.main > header.mhead（标题 + 「新建规则」）+ div.mbody
 *   mbody：.banner（匹配规则说明）→ section.sec「已建规则」（.table）→ section.sec「新建规则」（.card.stack）
 *
 * 「已建规则」与「新建规则」是两个独立区块（用户明确要求）：
 *   - 已建规则只显示服务器上已保存的链。表格里的启用开关、删除都是即时保存的。
 *   - 新建规则是一张独立表单，编辑的是一份本地草稿；点「添加 / 保存修改」才写进表里并保存。
 *     点表格里的「编辑」会把那条链拷进这张表单，表单标题变成「编辑规则」。
 *   这样表单里没写完的东西不会被表格里的开关顺手存掉。
 *
 * Two deliberate honesty choices, both about not lying to the user:
 *
 * 1. A member the roster lost is shown, not silently dropped. The server keeps
 *    the chain verbatim and reports the unresolved ids; the panel prints them.
 * 2. `missing` is only a WARNING, never a block on saving. The user may be
 *    configuring a chain for a key they intend to paste in next.
 *
 * @module dsh-xdpool/client/RoutingPage
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  POOL_COMBOS_PATH,
  POOL_COMBOS_SAVE_PATH,
  type PoolWebCombo,
  type PoolWebComboCandidate,
  type PoolWebCombosStatus,
} from '../status-paths.ts'
import type { XdPoolSettingsKey } from './locales.ts'
import { channelIcon } from './channel-icons.ts'
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
 * `id` is the server's and is undefined until the chain is first saved.
 */
interface ChainDraft {
  key: string
  id?: string | undefined
  name: string
  /**
   * The chain as PLATFORM GROUPS — the edit model. Platform order, then model
   * order inside each platform. Model ids inside a group are BARE; the
   * `provider/` prefix is derived from `owner` when the draft is flattened.
   */
  platforms: Array<{ owner: string; models: string[] }>
  /**
   * The member sequence to SAVE, in the order it will actually be walked.
   *
   * Kept beside `platforms` rather than always derived from them, because
   * grouping is LOSSY for an interleaved chain. `flat` starts as exactly what
   * the server sent, and only an EDIT of the platform structure recomputes it,
   * so opening a chain and saving it preserves its order.
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
 * dropped. A pool model is its bare id; a channel member (`channel:model`) is
 * already composite (#141); anything else is `owner/model`.
 */
function flattenDraft(platforms: ChainDraft['platforms']): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const platform of platforms) {
    for (const model of platform.models) {
      // The colon is the test, matching `channelMemberOf` in `combos.ts`.
      const selfOwned = /^[A-Za-z0-9_-]+:/u.test(model)
      const id = platform.owner === 'workbuddy' || selfOwned
        ? model
        : `${platform.owner}/${model}`
      if (seen.has(id)) continue
      seen.add(id)
      out.push(id)
    }
  }
  return out
}
/** The full member id of one model inside one platform group — same rule as {@link flattenDraft}. */
function memberIdOf(owner: string, model: string): string {
  const selfOwned = /^[A-Za-z0-9_-]+:/u.test(model)
  return owner === 'workbuddy' || selfOwned ? model : `${owner}/${model}`
}
function draftOf(combo: PoolWebCombo): ChainDraft {
  /**
   * `missing` members are kept, grouped under their own owner, so the editor shows
   * the chain the user actually configured. Either level of `platforms` may be
   * absent on disk, so both are normalised here.
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
    /**
     * Read the owner the same way `combos.ts` does, so a missing CHANNEL member is filed
     * under its channel rather than under a slash prefix (#141).
     */
    const colon = modelId.indexOf(':')
    const channelHead = colon > 0 ? modelId.slice(0, colon) : ''
    const isChannelMember = channelHead !== '' && /^[A-Za-z0-9_-]+$/u.test(channelHead)
    const slash = modelId.indexOf('/')
    const owner = isChannelMember
      ? channelHead
      : (slash === -1 ? 'workbuddy' : modelId.slice(0, slash))
    const model = isChannelMember
      ? modelId
      : (slash === -1 ? modelId : modelId.slice(slash + 1))
    const group = platforms.find(entry => entry.owner === owner)
    if (group === undefined) platforms.push({ owner, models: [model] })
    else if (!group.models.includes(model)) group.models.push(model)
  }
  return {
    key: combo.id,
    id: combo.id,
    name: combo.name,
    platforms,
    // EXACTLY what the server says the chain is, in its order.
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
/** A deep copy, so editing in the form never mutates the row in the table. */
function cloneDraft(draft: ChainDraft): ChainDraft {
  return {
    ...draft,
    platforms: draft.platforms.map(group => ({ owner: group.owner, models: [...group.models] })),
    flat: [...draft.flat],
  }
}
/** Compact counts: 1_260_000 -> "1.3M". */
function compact(value: number): string {
  if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}M`
  if (value >= 1_000) return `${Math.round(value / 100) / 10}K`
  return String(value)
}
/** 保存失败的原因，统一成中文；后端返回的英文错误不原样展示。 */
function saveFailReason(status: number | undefined): string {
  if (status === undefined) return '连不上本机服务，请稍后再试'
  if (status === 400) return '提交的内容不合法（HTTP 400）'
  if (status === 403) return '没有权限（HTTP 403）'
  if (status === 404) return '保存接口不存在，可能需要重启 DSH（HTTP 404）'
  if (status >= 500) return `服务内部出错（HTTP ${String(status)}）`
  return `HTTP ${String(status)}`
}
/** 设计稿 .ch-mark 的图标：JS 内嵌的 data URI 用 url()，其余走 icons.css 的变量。 */
function markStyle(owner: string): CSSProperties {
  const icon = channelIcon(owner)
  const base: CSSProperties = { width: '16px', height: '16px', display: 'inline-block', verticalAlign: '-3px', flex: '0 0 auto' }
  if (icon === undefined) return base
  return {
    ...base,
    backgroundImage: icon.startsWith('css:') ? `var(${icon.slice(4)})` : `url("${icon}")`,
  }
}
/** 策略的短名，表格里放不下长句。 */
function strategyShort(strategy: ChainDraft['strategy']): string {
  return strategy === 'round-robin' ? '轮转' : '兜底'
}
/** 已建规则表格的列：规则 / 依次走哪些渠道 / 成员 / 启用 / 操作。 */
const RULE_COLUMNS = 'minmax(0,1fr) minmax(0,1.3fr) 56px 60px 128px'
export function RoutingPage({ t }: RoutingPageProps) {
  const [status, setStatus] = useState<PoolWebCombosStatus | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [flash, setFlash] = useState<{ text: string; ok: boolean } | undefined>(undefined)
  /** 已保存的链（服务器上的那张表）。 */
  const [drafts, setDrafts] = useState<ChainDraft[]>([])
  const [saving, setSaving] = useState(false)
  /** 「新建规则」表单里的那一份草稿 —— 与表格分开。 */
  const [editor, setEditor] = useState<ChainDraft>(() => blankDraft())
  /** 第一次点删除只是变成「确认删除」，第二次才真删。 */
  const [confirmKey, setConfirmKey] = useState<string | undefined>(undefined)
  /** True once the drafts were seeded from the server, so later reads don't stomp edits. */
  const seeded = useRef(false)
  const mounted = useRef(true)
  const editorRef = useRef<HTMLElement | null>(null)
  /** 读取只在挂载时跑一次；t 每次渲染可能是新函数，放进依赖会反复重读。 */
  const tRef = useRef(t)
  tRef.current = t
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  const load = useCallback(async (signal?: AbortSignal): Promise<void> => {
    const failed = tRef.current?.('route.failed') ?? '链没能读出来。池子本身不受影响。'
    try {
      const response = await fetch(POOL_COMBOS_PATH, {
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
        ...signal === undefined ? {} : { signal },
      })
      const value: unknown = await response.json().catch(() => undefined)
      if (!response.ok) {
        if (mounted.current) setError(`${failed}（HTTP ${String(response.status)}）`)
        return
      }
      if (mounted.current && signal?.aborted !== true) {
        const next = value as PoolWebCombosStatus
        setStatus(next)
        setError(undefined)
        // Seed ONCE, and read-and-set the guard BEFORE queueing the update —
        // a guard inside the updater runs too late and leaves the list empty.
        if (!seeded.current) {
          seeded.current = true
          setDrafts((next.combos ?? []).map(draftOf))
        }
      }
    } catch {
      if (signal?.aborted === true) return
      if (mounted.current) setError(failed)
    }
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => { controller.abort() }
  }, [load])
  const candidates = status?.candidates ?? []
  const candidateById = useMemo(() => {
    const map = new Map<string, PoolWebComboCandidate>()
    for (const candidate of candidates) map.set(candidate.id, candidate)
    return map
  }, [candidates])
  // `workbuddy` stays out: it is the pool lane's own provider id, not a model.
  const roster = useMemo(() => candidates.filter(candidate => candidate.id !== 'workbuddy'), [candidates])
  /**
   * 把整张表写回服务器。
   *
   * The WHOLE table, because the server replaces it. Wrapped in `{ combos: … }`,
   * NOT sent as a bare array — the route reads `body['combos']`.
   */
  const persist = useCallback(async (list: readonly ChainDraft[]): Promise<boolean> => {
    setSaving(true)
    setFlash(undefined)
    const failed = t?.('route.saveFailed') ?? '链没能保存'
    try {
      const response = await fetch(POOL_COMBOS_SAVE_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          combos: list.map(draft => ({
            ...draft.id === undefined ? {} : { id: draft.id },
            name: draft.name,
            // BOTH shapes: `platforms` for the editor, `models` for every resolver.
            platforms: (draft.platforms ?? []).map(group => ({ owner: group.owner, models: group.models })),
            models: draft.flat,
            strategy: draft.strategy,
            stickyLimit: draft.stickyLimit,
            enabled: draft.enabled,
          })),
        }),
      })
      if (!response.ok) {
        if (mounted.current) setFlash({ text: `${failed}：${saveFailReason(response.status)}`, ok: false })
        return false
      }
      if (!mounted.current) return false
      // Re-read from the RESPONSE: the server mints ids for brand-new chains.
      const next = (await response.json().catch(() => undefined)) as PoolWebCombosStatus | undefined
      if (next === undefined) {
        setFlash({ text: `${failed}：服务返回的内容读不懂`, ok: false })
        return false
      }
      setStatus(next)
      setDrafts((next.combos ?? []).map(draftOf))
      setFlash({ text: t?.('route.saved') ?? '链已保存', ok: true })
      return true
    } catch {
      if (mounted.current) setFlash({ text: `${failed}：${saveFailReason(undefined)}`, ok: false })
      return false
    } finally {
      if (mounted.current) setSaving(false)
    }
  }, [t])
  /** 表格是否已经从服务器读到 —— 没读到之前任何保存都可能把服务器上的链覆盖成空表。 */
  const ready = status !== undefined
  const editingExisting = drafts.some(draft => draft.key === editor.key)
  const openNew = (): void => {
    setEditor(blankDraft())
    setConfirmKey(undefined)
    editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const openEdit = (draft: ChainDraft): void => {
    setEditor(cloneDraft(draft))
    setConfirmKey(undefined)
    editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const submitEditor = async (): Promise<void> => {
    if (!ready || saving) return
    const next = editingExisting
      ? drafts.map(draft => (draft.key === editor.key ? editor : draft))
      : [...drafts, editor]
    const ok = await persist(next)
    if (ok && mounted.current) setEditor(blankDraft())
  }
  const toggleEnabled = (draft: ChainDraft): void => {
    if (!ready || saving) return
    void persist(drafts.map(entry => (entry.key === draft.key ? { ...entry, enabled: !entry.enabled } : entry)))
  }
  const removeChain = (draft: ChainDraft): void => {
    if (!ready || saving) return
    if (confirmKey !== draft.key) { setConfirmKey(draft.key); return }
    setConfirmKey(undefined)
    if (editor.key === draft.key) setEditor(blankDraft())
    void persist(drafts.filter(entry => entry.key !== draft.key))
  }
  return (
    <main className="main" aria-label={t?.('route.title') ?? '路由'}>
      <header className="mhead">
        <div className="mhead-title">
          <span className="mhead-name">{t?.('route.title') ?? '路由'}</span>
          <span className="mhead-org">决定每个请求走哪个渠道</span>
        </div>
        <div className="mhead-actions">
          <button type="button" className="btn btn-primary" disabled={!ready} onClick={openNew}>
            新建规则
          </button>
        </div>
      </header>
      <div className="mbody">
        <div className="banner">
          <span className="banner-icon" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round">
              <path d="M6 3v18M18 3v18M6 8h12M6 16h12" />
            </svg>
          </span>
          <span className="banner-body">
            <span className="banner-t">{t?.('route.bannerTitle') ?? '规则从上往下匹配，命中就停'}</span>
            <span className="banner-d">
              {t?.('route.bannerBody') ?? '一条链里的成员按顺序试，谁先能上就用谁。'}
            </span>
          </span>
        </div>

        {error === undefined ? null : (
          <p className="hint" role="alert">
            <span>{error}</span>
            <button type="button" className="tiny" style={{ marginLeft: 'auto' }} onClick={() => { void load() }}>
              重试
            </button>
          </p>
        )}
        {flash === undefined ? null : (
          <p className="hint" role="status" style={flash.ok ? undefined : { color: 'var(--danger)' }}>
            <span>{flash.text}</span>
          </p>
        )}

        {/* ── 已建规则 ───────────────────────────────────────────── */}
        <section className="sec">
          <div className="sec-head">
            <span className="sec-title">已建规则</span>
            <span className="sec-n num">{String(drafts.length)}</span>
            {saving ? <span className="pill">{t?.('route.saving') ?? '保存中…'}</span> : null}
          </div>
          {status === undefined && error === undefined
            ? <p className="hint">{t?.('route.loading') ?? '正在读取链…'}</p>
            : (
              <div className="table">
                <div className="tr tr-head" style={{ gridTemplateColumns: RULE_COLUMNS }}>
                  <span className="td">规则</span>
                  <span className="td">依次走哪些渠道</span>
                  <span className="td td-num">成员</span>
                  <span className="td td-num">启用</span>
                  <span className="td td-num">操作</span>
                </div>
                {drafts.length === 0
                  ? (
                    <div className="tr" style={{ gridTemplateColumns: 'minmax(0,1fr)' }}>
                      <span className="td" style={{ color: 'var(--faint)' }}>
                        {t?.('route.empty') ?? '还没有链。建一条，被限流就不会再把一整轮对话掐断。'}
                      </span>
                    </div>
                  )
                  : drafts.map(draft => (
                    <RuleRow
                      key={draft.key}
                      draft={draft}
                      editing={draft.key === editor.key}
                      confirming={confirmKey === draft.key}
                      busy={saving || !ready}
                      candidateById={candidateById}
                      t={t}
                      onToggle={() => { toggleEnabled(draft) }}
                      onEdit={() => { openEdit(draft) }}
                      onDelete={() => { removeChain(draft) }}
                    />
                  ))}
              </div>
            )}
        </section>

        {/* ── 新建规则（或编辑某条已建规则）──────────────────────── */}
        <section className="sec" ref={editorRef}>
          <div className="sec-head">
            <span className="sec-title">
              {editingExisting
                ? `编辑规则：${editor.name === '' ? (t?.('route.newChain') ?? '新建一条链') : editor.name}`
                : '新建规则'}
            </span>
            <span className="pill">
              {t?.('route.rosterCount', { count: candidates.length }) ?? `${String(candidates.length)} 个可入链模型`}
            </span>
          </div>
          <ChainEditor
            key={editor.key}
            draft={editor}
            roster={roster}
            busy={saving}
            ready={ready}
            isNew={!editingExisting}
            candidateById={candidateById}
            t={t}
            onChange={changes => { setEditor(prev => ({ ...prev, ...changes })) }}
            onSubmit={() => { void submitEditor() }}
            onCancel={() => { setEditor(blankDraft()) }}
          />
        </section>
      </div>
    </main>
  )
}
/**
 * 已建规则表格里的一行。
 *
 * Members are rendered from the DRAFT, which carries `missing` ids too, so the
 * panel shows a member the roster lost instead of a shorter chain.
 */
function RuleRow({
  draft,
  editing,
  confirming,
  busy,
  candidateById,
  t,
  onToggle,
  onEdit,
  onDelete,
}: {
  draft: ChainDraft
  editing: boolean
  confirming: boolean
  busy: boolean
  candidateById: Map<string, PoolWebComboCandidate>
  t?: Translate | undefined
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  /** Members the roster cannot serve right now, computed from the FLATTENED draft. */
  const flat = draft.flat
  const missing = flat.filter(model => candidateById.has(model) === false)
  const platforms = draft.platforms ?? []
  return (
    <div className="tr" style={{ gridTemplateColumns: RULE_COLUMNS, alignItems: 'start' }}>
      <span className="td" style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
        <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: draft.enabled ? 1 : 0.55 }}>
          {draft.name === '' ? (t?.('route.newChain') ?? '新建一条链') : draft.name}
        </span>
        {draft.id === undefined ? null : <span className="td-mono" style={{ color: 'var(--faint)' }} title={draft.id}>{draft.id}</span>}
        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--faint)' }}>
          {strategyShort(draft.strategy)} · 每个成员连 {String(draft.stickyLimit)} 轮
          {draft.enabled ? '' : ` · ${t?.('route.chainDisabled') ?? '已停用'}`}
        </span>
        {missing.length > 0
          ? <span className="pill" data-tone="warn" title={missing.join('、')} style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {t?.('route.missing', { models: missing.join('、') }) ?? `这些成员暂时不在册：${missing.join('、')}`}
            </span>
          : null}
      </span>
      <span
        className="td"
        style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: draft.enabled ? 1 : 0.55 }}
        title={platforms.map(platform => ownerName(platform.owner, t)).join(' → ')}
      >
        {platforms.length === 0
          ? <span style={{ color: 'var(--faint)' }}>{t?.('route.noMembers') ?? '至少加一个成员'}</span>
          : platforms.map((platform, index) => (
            <span key={`${platform.owner}-${String(index)}`}>
              {index === 0 ? null : <span style={{ color: 'var(--faint)', margin: '0 6px' }}>→</span>}
              <span className="ch-mark" style={markStyle(platform.owner)} />
              <span style={{ marginLeft: '6px' }}>{ownerName(platform.owner, t)}</span>
              <span style={{ color: 'var(--faint)', marginLeft: '3px' }}>×{String((platform.models ?? []).length)}</span>
            </span>
          ))}
      </span>
      <span className="td td-num" title={t?.('route.memberCount', { count: flat.length }) ?? `${String(flat.length)} 个成员`}>
        {String(flat.length)}
      </span>
      <span className="td td-num">
        <button
          type="button"
          role="switch"
          className="sw"
          aria-checked={draft.enabled}
          aria-label={t?.('route.enabled') ?? '启用'}
          disabled={busy}
          onClick={onToggle}
          style={{ marginLeft: 'auto' }}
        />
      </span>
      <span className="td" style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
        <button type="button" className="tiny" disabled={busy} aria-pressed={editing} onClick={onEdit}>
          {editing ? (t?.('route.editOpen') ?? '编辑中') : (t?.('route.edit') ?? '编辑')}
        </button>
        <button
          type="button"
          className="tiny"
          disabled={busy}
          onClick={onDelete}
          style={confirming ? { color: 'var(--danger)', borderColor: 'var(--danger)' } : undefined}
        >
          {confirming ? '确认删除' : '删除'}
        </button>
      </span>
    </div>
  )
}
/**
 * A readable name for one platform. `workbuddy` is this plugin's own pool lane;
 * every other owner IS a provider id and is printed as-is.
 */
function ownerName(owner: string, t?: Translate | undefined): string {
  if (owner === 'workbuddy') return t?.('route.ownerPool') ?? 'XD Pool（WorkBuddy）'
  return owner
}
/** The model id WITHOUT its provider prefix. */
function bareModelOf(candidate: PoolWebComboCandidate): string {
  const prefix = `${candidate.owner}/`
  return candidate.id.startsWith(prefix) ? candidate.id.slice(prefix.length) : candidate.id
}
/** 平台卡片里每一行模型的列：序号 / 模型 / 上下文 / 操作。 */
const MODEL_COLUMNS = '24px minmax(0,1fr) 72px auto'
/**
 * 「新建规则」表单 —— TWO LEVELS, like the router walks it.
 *
 * Platform order first, then model order inside each platform. Each platform
 * block carries its own up / down / remove and its own model picker, which is
 * why the pickers are local state keyed by owner.
 */
function ChainEditor({
  draft,
  roster,
  busy,
  ready,
  isNew,
  candidateById,
  t,
  onChange,
  onSubmit,
  onCancel,
}: {
  draft: ChainDraft
  roster: readonly PoolWebComboCandidate[]
  busy: boolean
  ready: boolean
  isNew: boolean
  candidateById: Map<string, PoolWebComboCandidate>
  t?: Translate | undefined
  onChange: (changes: Partial<ChainDraft>) => void
  onSubmit: () => void
  onCancel: () => void
}) {
  const [pickByLane, setPickByLane] = useState<Record<string, string>>({})
  const [pickLane, setPickLane] = useState('')
  const uid = useId()

  /** Owners already in the chain — a platform appears at most once. */
  const used = (draft.platforms ?? []).map(platform => platform.owner)
  /** Platforms still available to add, with how many models each could offer. */
  const addable = useMemo(() => {
    const counts = new Map<string, number>()
    for (const candidate of roster) {
      if (used.includes(candidate.owner)) continue
      counts.set(candidate.owner, (counts.get(candidate.owner) ?? 0) + 1)
    }
    return [...counts.entries()].map(([owner, count]) => ({ owner, count }))
  }, [roster, used.join('\u0000')])

  /** Apply one platform edit and RECOMPUTE `flat` — only ever as the result of a user action. */
  const commit = (platforms: ChainDraft['platforms']): void => {
    onChange({ platforms, flat: flattenDraft(platforms) })
  }
  const patchLane = (index: number, update: { models?: string[]; owner?: string }): void => {
    commit((draft.platforms ?? []).map((platform, at) => (at === index ? { ...platform, ...update } : platform)))
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
  const moveModel = (index: number, models: readonly string[], from: number, to: number): void => {
    if (to < 0 || to >= models.length) return
    const next = [...models]
    const [moved] = next.splice(from, 1)
    if (moved === undefined) return
    next.splice(to, 0, moved)
    patchLane(index, { models: next })
  }
  /** Models of one owner that are not in this platform's group yet. */
  const candidatesFor = (owner: string, group: { models: readonly string[] }): readonly PoolWebComboCandidate[] =>
    roster.filter(candidate => candidate.owner === owner && !group.models.includes(bareModelOf(candidate)))

  const missing = draft.flat.filter(model => candidateById.has(model) === false)
  const nameEmpty = draft.name.trim() === ''
  const platforms = draft.platforms ?? []

  return (
    <div className="card stack">
      <div className="grid2">
        <div className="field">
          <label htmlFor={`${uid}-name`}>{t?.('route.chainName') ?? '链的名字'}</label>
          <input
            id={`${uid}-name`}
            className="input"
            type="text"
            value={draft.name}
            placeholder={t?.('route.chainNamePlaceholder') ?? '例如 主力-兜底'}
            onChange={event => { onChange({ name: event.target.value }) }}
          />
        </div>
        <div className="field">
          <label htmlFor={`${uid}-strategy`}>{t?.('route.strategy') ?? '策略'}</label>
          <select
            id={`${uid}-strategy`}
            className="select"
            value={draft.strategy}
            onChange={event => { onChange({ strategy: event.target.value === 'round-robin' ? 'round-robin' : 'fallback' }) }}
          >
            <option value="fallback">{t?.('route.strategyFallback') ?? '兜底——永远从第一个开始'}</option>
            <option value="round-robin">{t?.('route.strategyRoundRobin') ?? '轮转——轮流换起点'}</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${uid}-sticky`}>{t?.('route.stickyLimit') ?? '每个成员连着几轮'}</label>
          <input
            id={`${uid}-sticky`}
            className="input"
            type="number"
            min={1}
            value={draft.stickyLimit}
            title={t?.('route.stickyHint') ?? '在轮到下一个成员之前，同一个成员连续回答几轮。'}
            onChange={event => {
              const parsed = Number.parseInt(event.target.value, 10)
              onChange({ stickyLimit: Number.isFinite(parsed) && parsed > 0 ? parsed : 1 })
            }}
          />
        </div>
        <div className="field">
          <label id={`${uid}-enabled`}>{t?.('route.enabled') ?? '启用'}</label>
          <div className="row" style={{ minHeight: '32px' }}>
            <button
              type="button"
              role="switch"
              className="sw"
              aria-checked={draft.enabled}
              aria-labelledby={`${uid}-enabled`}
              onClick={() => { onChange({ enabled: !draft.enabled }) }}
            />
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--faint)' }}>
              {draft.enabled ? '保存后立刻生效' : (t?.('route.chainDisabled') ?? '已停用')}
            </span>
          </div>
        </div>
      </div>

      <div className="field">
        <label>{t?.('route.platformOrder') ?? '平台顺序（越靠上越优先）'}</label>
        {platforms.length === 0
          ? <p className="hint">{t?.('route.noMembers') ?? '至少加一个成员——空链没有东西可调，答不了话。'}</p>
          : (
            <div className="stack">
              {platforms.map((platform, index) => {
                const models = platform.models ?? []
                const choices = candidatesFor(platform.owner, { models })
                const picked = pickByLane[platform.owner] ?? ''
                return (
                  <div className="table" key={`${platform.owner}-${String(index)}`}>
                    <div className="tr tr-head" style={{ gridTemplateColumns: '24px minmax(0,1fr) auto' }}>
                      <span className="td num">{String(index + 1)}</span>
                      <span className="td" style={{ display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap', color: 'var(--text)', minWidth: 0 }}>
                        <span className="ch-mark" style={markStyle(platform.owner)} />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{ownerName(platform.owner, t)}</span>
                        {platform.owner === 'workbuddy' ? null : <span className="mono" style={{ color: 'var(--faint)' }}>{platform.owner}</span>}
                      </span>
                      <span className="td" style={{ display: 'flex', gap: '4px' }}>
                        <button type="button" className="tiny" disabled={index === 0} onClick={() => { moveLane(index, -1) }}>
                          {t?.('route.moveUp') ?? '上移'}
                        </button>
                        <button type="button" className="tiny" disabled={index === platforms.length - 1} onClick={() => { moveLane(index, 1) }}>
                          {t?.('route.moveDown') ?? '下移'}
                        </button>
                        <button type="button" className="tiny" onClick={() => { dropLane(index) }}>
                          {t?.('route.removePlatform') ?? '移除'}
                        </button>
                      </span>
                    </div>
                    {models.length === 0
                      ? (
                        <div className="tr" style={{ gridTemplateColumns: 'minmax(0,1fr)' }}>
                          <span className="td" style={{ color: 'var(--faint)' }}>
                            {t?.('route.platformNoModels') ?? '这个平台还没有添加模型'}
                          </span>
                        </div>
                      )
                      : models.map((model, modelIndex) => {
                        const fullId = memberIdOf(platform.owner, model)
                        const candidate = candidateById.get(fullId)
                        return (
                          <div className="tr" key={`${model}-${String(modelIndex)}`} style={{ gridTemplateColumns: MODEL_COLUMNS }}>
                            <span className="td td-dim" style={{ textAlign: 'left' }}>{String(modelIndex + 1)}</span>
                            <span className="td td-mono" title={fullId}>{model}</span>
                            <span className="td td-num">
                              {candidate === undefined
                                ? <span className="pill" data-tone="warn">{t?.('route.unusable') ?? '缺 key'}</span>
                                : <span className="td-dim">{compact(candidate.contextWindow)}</span>}
                            </span>
                            <span className="td" style={{ display: 'flex', gap: '4px' }}>
                              <button type="button" className="tiny" disabled={modelIndex === 0}
                                onClick={() => { moveModel(index, models, modelIndex, modelIndex - 1) }}>
                                {t?.('route.moveUp') ?? '上移'}
                              </button>
                              <button type="button" className="tiny" disabled={modelIndex === models.length - 1}
                                onClick={() => { moveModel(index, models, modelIndex, modelIndex + 1) }}>
                                {t?.('route.moveDown') ?? '下移'}
                              </button>
                              <button type="button" className="tiny"
                                onClick={() => { patchLane(index, { models: models.filter(entry => entry !== model) }) }}>
                                {t?.('route.removeMember') ?? '移除'}
                              </button>
                            </span>
                          </div>
                        )
                      })}
                    {choices.length === 0
                      ? null
                      : (
                        <div className="tr" style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
                          <select
                            className="select"
                            value={picked}
                            disabled={busy}
                            aria-label={t?.('route.pickModel') ?? '选择模型…'}
                            onChange={event => { setPickByLane(prev => ({ ...prev, [platform.owner]: event.target.value })) }}
                          >
                            <option value="">{t?.('route.pickModel') ?? '选择模型…'}</option>
                            {choices.map(choice => (
                              <option key={choice.id} value={bareModelOf(choice)}>{choice.name} — {bareModelOf(choice)}</option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="tiny"
                            disabled={busy || picked === ''}
                            onClick={() => {
                              if (picked === '' || models.includes(picked)) return
                              patchLane(index, { models: [...models, picked] })
                              setPickByLane(prev => ({ ...prev, [platform.owner]: '' }))
                            }}
                          >
                            {t?.('route.addModel') ?? '加模型'}
                          </button>
                        </div>
                      )}
                  </div>
                )
              })}
            </div>
          )}
      </div>

      {addable.length === 0
        ? null
        : (
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <select
              className="select"
              value={pickLane}
              disabled={busy}
              aria-label={t?.('route.pickPlatform') ?? '选择平台…'}
              onChange={event => { setPickLane(event.target.value) }}
            >
              <option value="">{t?.('route.pickPlatform') ?? '选择平台…'}</option>
              {addable.map(entry => (
                <option key={entry.owner} value={entry.owner}>
                  {ownerName(entry.owner, t)}（{String(entry.count)}）
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn"
              style={{ flex: '0 0 auto' }}
              disabled={busy || pickLane === ''}
              onClick={() => {
                if (pickLane === '' || used.includes(pickLane)) return
                commit([...draft.platforms, { owner: pickLane, models: [] }])
                setPickLane('')
              }}
            >
              {t?.('route.addPlatform') ?? '加平台'}
            </button>
          </div>
        )}
      <p className="hint">{t?.('route.platformHint') ?? '平台越靠上越优先；同一个平台里模型也一样。'}</p>

      {missing.length > 0
        ? <p className="hint" style={{ color: 'var(--warn)' }}>
            {t?.('route.missing', { models: missing.join('、') }) ?? `这些成员暂时不在册：${missing.join('、')}`}
          </p>
        : null}

      <div className="row">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !ready || nameEmpty}
          title={nameEmpty ? '先给这条链起个名字' : undefined}
          onClick={onSubmit}
        >
          {busy ? (t?.('route.saving') ?? '保存中…') : (isNew ? '添加' : '保存修改')}
        </button>
        <button type="button" className="btn" disabled={busy} onClick={onCancel}>
          取消
        </button>
        {nameEmpty ? <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--faint)' }}>先给这条链起个名字</span> : null}
      </div>
    </div>
  )
}

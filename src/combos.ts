/**
 * Route combos: one picker row that stands for an ordered chain of models.
 *
 * WHY A THIRD LANE SHAPE
 *
 * The pool owns WorkBuddy ids, the aggregate lane owns `providerId/modelId`
 * ids, and a user with both wants a row that says "try these in order" without
 * having to remember which upstream is currently rate-limited. A combo is that
 * row — and it is NOT a provider, which is why its id carries a prefix the
 * registry cannot produce:
 *
 *   - `combo:<slug>` contains no slash before its colon, so
 *     `parseProviderModelId` rejects it. A combo row therefore can never be
 *     mistaken for an aggregate row, and the two lanes keep deciding purely on
 *     the id's own shape, with no extra header for a caller to forge.
 *   - `buildAggregateCatalog` only emits ids built by `providerModelId`, so no
 *     registry entry can collide with a combo id either.
 *
 * CAPACITY IS AN INTERSECTION, NOT A UNION
 *
 * A chain's advertised context window is the SMALLEST window among its members.
 * Advertising the largest one is how a combo silently truncates a conversation:
 * the host picks the model, sizes its compaction against the advertised window,
 * and the member that actually answers rejects the prompt as too long. Same
 * reasoning for `maxOutputTokens`, and in reverse for vision — a chain whose
 * members disagree about images is treated as text-only, because a fallback that
 * cannot read the image is worse than an honest "no".
 *
 * MEMBERS THAT DISAPPEARED ARE DROPPED, NOT KEPT
 *
 * A member id that the current catalogs no longer serve is removed from the
 * chain. Keeping it would make the chain report "tried 3 candidates" while only
 * one was ever reachable, which reads on screen as a bug in the plugin.
 *
 * @module dsh-xdpool/combos
 */
import type { AggregateModelRow } from './aggregate.ts'
import type { WorkBuddyModelInfo } from './catalog.ts'
import { isProviderId, parseProviderModelId } from './providers.ts'
/** Id prefix every combo row advertises under. */
export const COMBO_PREFIX = 'combo:'
/** The lane name a combo row belongs to, for display grouping. */
export const COMBO_CHANNEL = 'combo'
/** Chain strategies. Anything else on disk falls back to `fallback`. */
export const COMBO_STRATEGIES = ['fallback', 'round-robin'] as const
export type ComboStrategy = (typeof COMBO_STRATEGIES)[number]
/** A chain as the user configured it, before the catalogs are consulted. */
export interface ComboSetting {
  /** `combo:<slug>`; derived from the name when absent or malformed. */
  id?: string
  name: string
  /** Member model ids, in the order the user put them. */
  models: readonly string[]
  /** How the chain advances; `fallback` restarts from the top each turn. */
  strategy?: ComboStrategy
  /** Consecutive turns one member serves before `round-robin` advances. */
  stickyLimit?: number
  /** Absent is treated as on; an explicit false hides the row. */
  enabled?: boolean
}
/** One picker row standing for a chain. */
export interface ComboModelRow {
  /** Always `combo:<slug>`. */
  id: string
  name: string
  /** Members that exist RIGHT NOW, in order. Never empty — see below. */
  models: readonly string[]
  strategy: ComboStrategy
  stickyLimit: number
  /** Smallest window across members; 0 when no member declares one. */
  contextWindow: number
  maxOutputTokens: number
  supportsImages: boolean
  /**
   * Discriminator. Aggregate rows carry `providerId`, pool rows carry neither,
   * and only this shape is `true`.
   */
  combo: true
}
/** What a member id turned out to name, once both catalogs were consulted. */
export interface ComboMember {
  /** The id to send downstream, verbatim. */
  modelId: string
  /** True when it is an aggregate `providerId/modelId` row. */
  aggregate: boolean
  /** Set only for aggregate members. */
  providerId?: string
  /** Display name for the chain editor. */
  name: string
  contextWindow: number
  maxOutputTokens: number
  supportsImages: boolean
}
/** Windows assumed when nothing on the chain declares one. */
export const COMBO_DEFAULT_CONTEXT_WINDOW = 131_072
/** Output ceiling assumed when nothing on the chain declares one. */
export const COMBO_DEFAULT_MAX_OUTPUT = 32_768
/** A trimmed non-empty string, or ''. */
function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
/** A de-duplicated list of non-empty trimmed strings from an untrusted array. */
function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of value) {
    const id = text(raw)
    if (id === '' || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}
/**
 * The combo id a name slugifies to, or '' when the name cannot form one.
 *
 * Unicode-aware on purpose. This used to be `/[^a-z0-9]+/g`, which meant any
 * name that was not ASCII — every Chinese chain name — slugged to the empty
 * string, and `normalizeCombos` then dropped the entry with a bare `continue`.
 * The card reported "saved", the store held nothing, and the chain vanished on
 * the next read: the "new route cannot be saved" report. A name is user data and
 * may be written in any script, so the id has to survive one.
 *
 * Latin names keep the old shape (`writing-fallback`), because ids already
 * stored that way must keep resolving; only characters that used to be stripped
 * to nothing are now kept.
 */
export function comboId(name: string): string {
  const slug = text(name)
    .toLowerCase()
    // `\p{L}`/`\p{N}` keep letters and digits of every script; everything else
    // (spaces, punctuation, emoji) becomes the hyphen that separates words.
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 48)
    .replace(/-+$/u, '')
  return slug === '' ? '' : `${COMBO_PREFIX}${slug}`
}
/** True when the id names a combo row. */
export function isComboId(id: string): boolean {
  return typeof id === 'string' && id.startsWith(COMBO_PREFIX) && id.length > COMBO_PREFIX.length
}
/**
 * Narrow one catalog row to the chain kind.
 *
 * A predicate rather than an `id` check at each call site: a chain row and a
 * provider row share only `id`, so callers that reach for `providerId` on the
 * union would otherwise compile only because the id happened to start with
 * `combo:`. Here the compiler enforces that a chain has no vendor field at all.
 */
export function isComboRow(
  row: ComboModelRow | AggregateModelRow,
): row is ComboModelRow {
  return isComboId(row.id)
}
/**
 * Shape whatever the settings file held into a usable chain list.
 *
 * A chain with no members is DROPPED rather than kept as an empty row: a model
 * that cannot answer anything is not a model, and showing one in the picker
 * only produces a request that fails with nothing to fix. The card warns about
 * that case before the save (`route.noMembers`), which is why dropping here is
 * not a silent loss.
 */
export function normalizeCombos(raw: unknown): ComboSetting[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: ComboSetting[] = []
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue
    const value = entry as Record<string, unknown>
    const name = text(value.name) || text(value.id)
    if (name === '') continue
    const id = text(value.id)
    const models = stringList(value.models).filter(model => model !== id && !isComboId(model))
    if (models.length === 0) continue
    const chainId = isComboId(id) ? id : comboId(name)
    if (chainId === '' || seen.has(chainId)) continue
    seen.add(chainId)
    const strategy: ComboStrategy = COMBO_STRATEGIES.includes(value.strategy as ComboStrategy)
      ? (value.strategy as ComboStrategy)
      : 'fallback'
    const limit = typeof value.stickyLimit === 'number' && Number.isFinite(value.stickyLimit)
      ? Math.floor(value.stickyLimit)
      : 1
    out.push({
      id: chainId,
      name,
      models,
      strategy,
      stickyLimit: limit > 0 ? limit : 1,
      enabled: value.enabled !== false,
    })
  }
  return out
}
/** The two catalogs a combo chain is resolved against. */
export interface ComboSources {
  /** Pool rows, by id. */
  pool: readonly WorkBuddyModelInfo[]
  /** Aggregate rows, by composite id. */
  aggregate: readonly AggregateModelRow[]
}
/**
 * Classify one member id against both catalogs.
 *
 * `combo:` ids are rejected outright: a chain pointing at another chain would
 * make the router depend on its own output, and the round-robin cursor would
 * then advance twice per turn.
 */
export function resolveComboMember(modelId: string, sources: ComboSources): ComboMember | undefined {
  const id = text(modelId)
  if (id === '' || isComboId(id)) return undefined
  const aggregateRow = sources.aggregate.find(row => row.id === id)
  if (aggregateRow !== undefined) {
    const parsed = parseProviderModelId(id)
    return {
      modelId: id,
      aggregate: true,
      providerId: parsed === null ? aggregateRow.providerId : parsed.providerId,
      name: aggregateRow.name,
      contextWindow: aggregateRow.contextWindow,
      maxOutputTokens: aggregateRow.maxOutputTokens,
      supportsImages: aggregateRow.supportsImages,
    }
  }
  const poolRow = sources.pool.find(row => row.id === id)
  if (poolRow === undefined) return undefined
  return {
    modelId: id,
    aggregate: false,
    name: poolRow.name,
    contextWindow: poolRow.contextWindow,
    maxOutputTokens: poolRow.maxOutputTokens,
    supportsImages: poolRow.supportsImages,
  }
}
/**
 * The same model served by more than one lane, in the order to try them.
 *
 * This is the "same model, different route" tier: when a lane rate-limits, the
 * answer is usually to reach the SAME model through another provider, not to
 * fall back to a different model. Switching models changes context window, tool
 * calling, structured-output shape and writing style — a cross-model fallback is
 * a last resort, not a first one.
 *
 * The registry carries 86 model ids under two or more providers (kimi-k2.5 sits
 * under eight), so the tier is real and not theoretical. What was missing is
 * that a user had to spell it out: three separate chain members naming the same
 * model three times, in the right order, and re-edit the chain whenever a
 * provider was added.
 *
 * Derivation, not configuration: for one model id, every aggregate row sharing
 * `modelName` (or the bare id when the registry names no shared display name) is
 * a route to it. Pool rows are excluded — `buddy:`/`workbuddy:` are the pool's
 * own lanes and naming them here would silently spend the user's WorkBuddy
 * credits as a "fallback".
 *
 * The requested provider, when given, comes FIRST: the user chose that lane, so
 * it stays the primary and the others are the alternates.
 */
export function siblingRoutes(
  modelId: string,
  sources: ComboSources,
  preferredProvider?: string,
): string[] {
  const id = text(modelId)
  if (id === '') return []
  const target = sources.aggregate.find(row => row.id === id)
  if (target === undefined) return [id]
  // A shared display name is what identifies "the same model" across vendors;
  // the registry does not always publish one, so fall back to the bare id.
  const name = text(target.name)
  const bare = bareModelIdOf(target)
  const out: string[] = [id]
  for (const row of sources.aggregate) {
    if (row.id === id) continue
    if (row.providerId === target.providerId) continue
    const sameName = name !== '' && text(row.name) === name
    const sameBare = bare !== '' && bareModelIdOf(row) === bare
    if (!sameName && !sameBare) continue
    // Different vendors, same model. Context window and capabilities are not
    // compared here on purpose: a vendor that publishes a narrower window is
    // still a valid alternate route, and refusing it would drop the very
    // provider the user is trying to fall back TO.
    if (!out.includes(row.id)) out.push(row.id)
  }
  if (preferredProvider === undefined || out.length <= 1) return out
  // Stable move-to-front: the user's chosen lane stays primary.
  const primary = out.filter(candidate => candidate.startsWith(`${preferredProvider}/`))
  return [...primary, ...out.filter(candidate => !candidate.startsWith(`${preferredProvider}/`))]
}

/** The model id without its provider prefix, for cross-vendor comparison. */
function bareModelIdOf(row: AggregateModelRow): string {
  const parsed = parseProviderModelId(row.id)
  return parsed === null ? text(row.modelId) : parsed.modelId
}

/**
 * Every combo row that can currently answer, given the catalogs.
 *
 * Disabled chains are skipped, as are chains whose members have all gone away:
 * a row that cannot answer is worse than no row, because the picker would show
 * it as a broken model rather than as nothing configured.
 */
export function buildComboCatalog(
  chains: readonly ComboSetting[],
  sources: ComboSources,
): ComboModelRow[] {
  const rows: ComboModelRow[] = []
  for (const chain of chains) {
    if (chain.enabled === false) continue
    const id = isComboId(chain.id ?? '') ? (chain.id as string) : comboId(chain.name)
    if (id === '') continue
    const members: ComboMember[] = []
    for (const memberId of chain.models) {
      const member = resolveComboMember(memberId, sources)
      // Dropped, not kept: a member the catalogs no longer serve would make the
      // chain claim candidates it cannot reach.
      if (member !== undefined) members.push(member)
    }
    if (members.length === 0) continue
    rows.push({
      id,
      name: chain.name,
      models: members.map(member => member.modelId),
      strategy: COMBO_STRATEGIES.includes(chain.strategy as ComboStrategy)
        ? (chain.strategy as ComboStrategy)
        : 'fallback',
      stickyLimit: typeof chain.stickyLimit === 'number' && chain.stickyLimit > 0
        ? Math.floor(chain.stickyLimit)
        : 1,
      // INTERSECTION: the smallest window any member declares, so the host never
      // sizes a compaction against a member that cannot take it.
      contextWindow: Math.min(...members.map(member => member.contextWindow || COMBO_DEFAULT_CONTEXT_WINDOW)),
      maxOutputTokens: Math.min(...members.map(member => member.maxOutputTokens || COMBO_DEFAULT_MAX_OUTPUT)),
      // INTERSECTION: every member must accept images, or the chain does not
      // advertise them — a fallback that cannot read the image is a failed turn.
      supportsImages: members.every(member => member.supportsImages),
      combo: true,
    })
  }
  return rows
}
/**
 * Per-chain rotation cursors, in memory.
 *
 * Not persisted on purpose: a cursor is a scheduling detail, and restoring a
 * stale one after a restart would silently continue a rotation the user can no
 * longer see. Losing it costs at most one extra turn on the wrong member.
 */
const rotation = new Map<string, { index: number; used: number }>()
/** Forget the cursors of chains that no longer exist. */
export function pruneRotation(combos: readonly ComboSetting[]): void {
  const keep = new Set(combos.map(chain => chain.id).filter((id): id is string => typeof id === 'string'))
  for (const id of [...rotation.keys()]) if (!keep.has(id)) rotation.delete(id)
}
/** Drop every cursor. Exists for the tests, not for callers. */
export function resetComboRotation(): void {
  rotation.clear()
}
/** What {@link comboChain} was asked to do. */
export interface ComboChainOptions {
  /** Compute the chain without consuming a rotation step. */
  peek?: boolean
}
/**
 * The members to try for one turn, in order.
 *
 * `fallback` always restarts from the head, which is what makes it predictable:
 * the first member is the one the user put first, and a failure there is a
 * reason to try the second rather than to keep hammering the first.
 *
 * `round-robin` starts from the cursor instead. It is the mode that spreads
 * load across several equivalent upstreams, and `stickyLimit` is how many
 * consecutive turns one member keeps before the cursor moves — one keeps a
 * conversation pinned, five lets a burst soak one lane before it rotates.
 */
export function comboChain(
  row: ComboModelRow,
  options: ComboChainOptions = {},
): readonly string[] {
  const members = row.models
  if (members.length <= 1) return members
  if (row.strategy !== 'round-robin') return members
  const cursor = rotation.get(row.id) ?? { index: 0, used: 0 }
  const start = ((cursor.index % members.length) + members.length) % members.length
  const ordered = [...members.slice(start), ...members.slice(0, start)]
  if (options.peek === true) return ordered
  const used = cursor.used + 1
  const limit = row.stickyLimit > 0 ? row.stickyLimit : 1
  rotation.set(row.id, used >= limit ? { index: (start + 1) % members.length, used: 0 } : { index: start, used })
  return ordered
}
/**
 * Whether a model id names a provider the registry knows.
 *
 * Kept next to the combo helpers because the combo editor's member picker needs
 * the same predicate the aggregate lane resolves with, and two answers to "is
 * this an upstream we can name" would eventually disagree.
 */
export function isAggregateMemberId(modelId: string): boolean {
  const parsed = parseProviderModelId(modelId)
  return parsed !== null && isProviderId(parsed.providerId)
}
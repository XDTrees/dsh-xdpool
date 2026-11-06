/**
 * Catalog for the免密 free lane.
 *
 * The gateway's listing is authoritative about WHICH models exist and nothing
 * about what they can do — it is a flat id list, and it includes paid ids this
 * lane cannot answer. So the roster is filtered to the免密 ids and every
 * capability is a LOCAL table, read off direct probes rather than a model card.
 * That distinction is why the two halves are separate functions here.
 *
 * Regional availability is egress-dependent and the gateway does not disclose
 * it: the same id exists or does not depending on where the request leaves from.
 * A row that carries the flag is labelled as such rather than silently failing
 * for a user whose VPN is off.
 *
 * @module src/free-catalog
 */

import crypto from 'node:crypto'
import {
  FREE_LISTING_PATH,
  FREE_LISTING_TIMEOUT_MS,
  FREE_UPSTREAM_BASE,
  baseModelId,
  freeFetch,
  gatewayHeaders,
  mintRequestId,
  sessionForConversation,
  wireFor,
} from './free-upstream.ts'
import type { FreeWire } from './free-messages.ts'

/** The model-id prefix this lane publishes, so the shim can route by shape. */
export const FREE_MODEL_PREFIX = 'free:'
/** The channel tag the aggregate roster carries for these rows. */
export const FREE_CHANNEL = 'free'

/** Ids that are free-tier without carrying the `-free` suffix. */
const ALWAYS_FREE = new Set(['union-alpha', 'space-bunny-free'])

interface CapabilityEntry {
  match: RegExp
  vision: boolean
  reasoning: boolean
  contextWindow: number
  maxOutput: number
  canDisableThinking?: boolean
}

/**
 * Local capability baseline.
 *
 * `contextWindow`/`maxOutput` are the published capacities; `vision` is what this
 * lane actually accepted under a direct image-input probe, not what a model card
 * claims.
 */
const CAPABILITIES: readonly CapabilityEntry[] = [
  { match: /^mimo.*v2\.6/u, vision: true, reasoning: true, contextWindow: 1_048_576, maxOutput: 131_072, canDisableThinking: false },
  { match: /^mimo.*v2\.5/u, vision: true, reasoning: true, contextWindow: 1_048_576, maxOutput: 131_072, canDisableThinking: false },
  { match: /^mimo/u, vision: true, reasoning: true, contextWindow: 262_144, maxOutput: 131_072 },
  { match: /^muse.?spark/u, vision: true, reasoning: true, contextWindow: 1_048_576, maxOutput: 131_072 },
  { match: /^nemotron/u, vision: false, reasoning: true, contextWindow: 128_000, maxOutput: 32_768 },
  { match: /^ling/u, vision: false, reasoning: true, contextWindow: 128_000, maxOutput: 32_768 },
  { match: /^space.?bunny/u, vision: true, reasoning: true, contextWindow: 262_144, maxOutput: 65_536 },
  { match: /^union/u, vision: true, reasoning: false, contextWindow: 262_144, maxOutput: 131_072 },
  { match: /^deepseek/u, vision: false, reasoning: true, contextWindow: 128_000, maxOutput: 64_000 },
  { match: /^jev/u, vision: false, reasoning: false, contextWindow: 32_768, maxOutput: 4_096 },
]

/** The fallback for an id no rule matched: assume it thinks, assume nothing else. */
const FALLBACK_CAPABILITY = { vision: false, reasoning: true, contextWindow: 131_072, maxOutput: 32_768 } as const

/** Human-facing display names, so a raw upstream id never reaches the picker. */
const DISPLAY_NAMES: Readonly<Record<string, string>> = {
  'mimo-v2.6-flash-free': 'MiMo V2.6 Flash',
  'mimo-v2.5-free': 'MiMo V2.5',
  'muse-spark-1.3-contributor-free': 'Muse Spark 1.3',
  'muse-spark-1.2-contributor-free': 'Muse Spark 1.2',
  'nemotron-3-ultra-free': 'Nemotron 3 Ultra',
  'nemotron-3.5-lightning-free': 'Nemotron 3.5 Lightning',
  'ling-3.0-flash-fin-free': 'Ling 3.0 Flash Fin',
  'space-bunny-free': 'Space Bunny',
  'union-alpha': 'Union Alpha',
  'deepseek-v4-flash-free': 'DeepSeek V4 Flash',
  'jev-1.13-free': 'Jev 1.13',
}

/** Ids whose availability is known to be egress-dependent. */
const REGION_SENSITIVE: readonly RegExp[] = [/^muse.?spark/u]

function positiveInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : undefined
}

/** Is this id on the免密 lane? The listing mixes paid and free; only these answer. */
export function isFreeLane(modelId: string): boolean {
  const base = baseModelId(modelId)
  if (ALWAYS_FREE.has(base)) return true
  return /(?:^|[-_])free(?:$|[-_.])/u.test(base)
}

/** What a matched {@link CapabilityEntry} publishes. */
export interface KnownCapability {
  vision: boolean
  reasoning: boolean
  contextWindow: number
  maxOutput: number
  canDisableThinking: boolean
}

/**
 * The measured figures for an id the table covers, or `undefined` when it covers
 * none.
 *
 * Split out from {@link capabilitiesFor} because that one must ALWAYS answer: the
 * lane needs a serving contract for every id it lists, and a guessed window beats
 * no window there. A caller that would be *printing* the number to a user must
 * use this one instead — "the table has never heard of this model" and "this
 * model has a 128K window" are different claims, and only this function keeps
 * them apart.
 */
export function knownCapabilities(modelId: string): KnownCapability | undefined {
  const base = baseModelId(modelId)
  for (const entry of CAPABILITIES) {
    if (entry.match.test(base)) {
      return {
        vision: entry.vision,
        reasoning: entry.reasoning,
        contextWindow: entry.contextWindow,
        maxOutput: entry.maxOutput,
        canDisableThinking: entry.canDisableThinking !== false,
      }
    }
  }
  return undefined
}

/** The baseline capacities for one model id. */
export function capabilitiesFor(modelId: string): {
  vision: boolean
  reasoning: boolean
  contextWindow: number
  maxOutput: number
  canDisableThinking: boolean
} {
  return knownCapabilities(modelId) ?? { ...FALLBACK_CAPABILITY, canDisableThinking: true }
}

/** Is this id's availability known to depend on where the request leaves from? */
export function isRegionSensitive(modelId: string): boolean {
  const base = baseModelId(modelId)
  return REGION_SENSITIVE.some(pattern => pattern.test(base))
}

/** Title-case a bare upstream id into something a picker can show. */
export function displayModelName(modelId: string): string {
  const base = baseModelId(modelId)
  const known = DISPLAY_NAMES[base]
  if (known !== undefined) return known
  return base
    .replace(/[-_.]+/gu, ' ')
    .replace(/(\d)\s+/gu, '$1 ')
    .trim()
    .split(' ')
    .map(word => (/^\d/u.test(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(' ')
}

/** One free-lane row, as the adapter and the shim both read it. */
export interface FreeModelRow {
  /** Published id, WITHOUT the `free:` prefix. */
  id: string
  /** The id the picker and the wire both carry. */
  modelId: string
  name: string
  wire: FreeWire
  vision: boolean
  reasoning: boolean
  contextWindow: number
  maxOutput: number
  canDisableThinking: boolean
  regionSensitive: boolean
}

/** Parse the gateway's `{"data":[{"id":…}]}` listing. */
export function parseListing(payload: unknown): string[] {
  const rows = Array.isArray((payload as { data?: unknown } | null)?.data)
    ? (payload as { data: unknown[] }).data
    : Array.isArray((payload as { models?: unknown } | null)?.models)
      ? (payload as { models: unknown[] }).models
      : Array.isArray(payload) ? payload : []
  const out: string[] = []
  for (const row of rows) {
    const id = typeof row === 'string' ? row : (row as { id?: unknown } | null)?.id
    if (typeof id === 'string' && id !== '') out.push(id)
  }
  return out
}

/**
 * The free rows for a raw listing, in listing order.
 *
 * The prefix is what the shim routes on, so it is applied here rather than at
 * the call sites: one place decides the lane's id shape, and every reader gets it
 * the same way.
 */
export function buildFreeCatalog(ids: readonly string[]): FreeModelRow[] {
  const seen = new Set<string>()
  const rows: FreeModelRow[] = []
  for (const raw of ids) {
    const id = raw.trim()
    if (id === '' || !isFreeLane(id)) continue
    const base = baseModelId(id)
    if (seen.has(base)) continue
    seen.add(base)
    const caps = capabilitiesFor(base)
    rows.push({
      id: base,
      modelId: `${FREE_MODEL_PREFIX}${base}`,
      name: displayModelName(base),
      wire: wireFor(base),
      vision: caps.vision,
      reasoning: caps.reasoning,
      contextWindow: positiveInt(caps.contextWindow) ?? FALLBACK_CAPABILITY.contextWindow,
      maxOutput: positiveInt(caps.maxOutput) ?? FALLBACK_CAPABILITY.maxOutput,
      canDisableThinking: caps.canDisableThinking,
      regionSensitive: isRegionSensitive(base),
    })
  }
  return rows
}

/** One listing round. Returns the parsed JSON document. */
export async function fetchFreeListing(
  options: { session?: string | undefined; signal?: AbortSignal | undefined; timeoutMs?: number } = {},
): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? FREE_LISTING_TIMEOUT_MS)
  timer.unref?.()
  let callerAborted = false
  const onCallerAbort = (): void => {
    callerAborted = true
    controller.abort()
  }
  options.signal?.addEventListener('abort', onCallerAbort, { once: true })
  try {
    const response = await freeFetch(`${FREE_UPSTREAM_BASE}${FREE_LISTING_PATH}`, {
      headers: gatewayHeaders({
        session: sessionForConversation(options.session),
        requestId: mintRequestId(),
        stream: false,
        accept: 'application/json',
      }),
      signal: controller.signal,
    })
    const text = await response.text()
    if (!response.ok) {
      throw new Error(`the free lane answered HTTP ${response.status}: ${text.slice(0, 200)}`)
    }
    return JSON.parse(text) as unknown
  } catch (error: unknown) {
    if (callerAborted || options.signal?.aborted === true) throw new Error('request aborted')
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`the free lane's listing did not answer within ${String(options.timeoutMs ?? FREE_LISTING_TIMEOUT_MS)}ms`)
    }
    throw error instanceof Error ? error : new Error(String(error))
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onCallerAbort)
  }
}

/**
 * The static roster, used until the first listing lands and again whenever one
 * fails.
 *
 * An empty picker is the one outcome a user reads as "the plugin broke", so the
 * lane ships with rows it can serve without ever having reached the network.
 * These are the ids the gateway is known to serve免密 today; a row that later
 * disappears costs one dead model entry, while an empty lane costs everything.
 */
export const FALLBACK_FREE_MODEL_IDS: readonly string[] = Object.freeze([
  'muse-spark-1.3-contributor-free',
  'muse-spark-1.2-contributor-free',
  'union-alpha',
  'space-bunny-free',
  'nemotron-3-ultra-free',
  'deepseek-v4-flash-free',
  'mimo-v2.6-flash-free',
  'mimo-v2.5-free',
  'jev-1.13-free',
])

/** Live free roster with a static fallback behind it. */
export class FreeCatalog {
  private rows: readonly FreeModelRow[]
  private listeners = new Set<() => void>()
  private lastError: string | undefined
  private lastUpdatedAt: string | undefined
  /**
   * Whether this lane contributes models at all.
   *
   * OFF unless the user turns it on, which is the opposite of every other lane
   * here and deliberate: the 免密 lane is a shared third-party endpoint with no
   * credential of its own, so it cannot be "configured" — it is either silently
   * present or absent. Left on by default it dropped a group into the model
   * picker that the user never asked for and could not remove: the aggregate
   * switch does not govern it (it is not an aggregate provider), so the only
   * way out was editing the file. Reported as "关不掉，应该默认是关闭的".
   *
   * An explicit `true` is what enables it — `undefined` (a config written before
   * this switch existed, or a fresh install) stays off.
   */
  private laneEnabled = false

  constructor(fallback: readonly string[] = FALLBACK_FREE_MODEL_IDS) {
    this.rows = Object.freeze(buildFreeCatalog(fallback))
  }

  /** Turn the lane on or off; the roster readers all consult this. */
  setEnabled(enabled: boolean): void {
    if (this.laneEnabled === enabled) return
    this.laneEnabled = enabled
    // Same notification the roster updates use: the card's toggle and the
    // adapter's model list both read this class, and neither polls.
    for (const listener of this.listeners) listener()
  }

  /** Whether the lane is contributing models right now. */
  enabled(): boolean {
    return this.laneEnabled
  }

  /**
   * The rows that may be OFFERED.
   *
   * Empty when the lane is off. Callers that need the roster regardless (the
   * aggregate page's "free" filter, which lists what the lane COULD serve) use
   * {@link allRows} instead — so switching the lane off hides it from the model
   * picker without erasing it from the page that explains it.
   */
  current(): readonly FreeModelRow[] {
    return this.laneEnabled ? this.rows : []
  }

  /** Every row the lane knows about, offered or not. */
  allRows(): readonly FreeModelRow[] {
    return this.rows
  }

  /** Why the last refresh failed, for display. Never a substitute for rows. */
  error(): string | undefined {
    return this.lastError
  }

  /** When the live list last landed. */
  updatedAt(): string | undefined {
    return this.lastUpdatedAt
  }

  /** The row behind a published id, or undefined. */
  find(modelId: string): FreeModelRow | undefined {
    return this.rows.find(row => row.modelId === modelId || row.id === modelId)
  }

  /** Whether anything is being served right now. */
  hasRows(): boolean {
    return this.rows.length > 0
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Re-read the listing and notify when the roster actually changed.
   *
   * A failed refresh KEEPS the current rows and records the error. Dropping to
   * empty here would make a network hiccup look like the models were deleted.
   */
  async refresh(options: { session?: string | undefined } = {}): Promise<readonly FreeModelRow[]> {
    let next: readonly FreeModelRow[]
    try {
      next = Object.freeze(buildFreeCatalog(parseListing(await fetchFreeListing(options))))
    } catch (error: unknown) {
      this.lastError = error instanceof Error ? error.message : String(error)
      if (this.rows.length === 0) {
        // Only the very first fetch can still be empty; keep the user served.
        this.rows = Object.freeze(buildFreeCatalog(FALLBACK_FREE_MODEL_IDS))
      }
      for (const listener of this.listeners) listener()
      return this.rows
    }
    if (next.length === 0) {
      // A live listing that parses to nothing free is a shape change, not an
      // outage; the static roster is a better answer than an empty picker.
      this.lastError = 'the gateway listing held no免密 models'
      for (const listener of this.listeners) listener()
      return this.rows
    }
    this.lastError = undefined
    this.lastUpdatedAt = new Date().toISOString()
    const same = next.length === this.rows.length && next.every((row, index) => row.modelId === this.rows[index]?.modelId)
    if (same) return this.rows
    this.rows = next
    for (const listener of this.listeners) listener()
    return this.rows
  }
}

/**
 * A stable digest of a conversation, for the per-session quota.
 *
 * Exported because the shim has to compute the SAME session the listing used,
 * and a user whose first turn refreshed the roster must not be charged a second
 * session for the same conversation.
 */
export function sessionSeedFor(conversationKey: string | undefined): string {
  const seed = conversationKey ?? ''
  return crypto.createHash('sha256').update(`xdpool-free-seed\0${seed}`, 'utf8').digest('hex').slice(0, 16)
}

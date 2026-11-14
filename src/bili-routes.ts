/**
 * Declare CodeArts' real per-model limits to billion-context.
 *
 * billion-context (bili) wraps DSH's model traffic and rewrites the request body
 * before it leaves the process. Two of its rewrites break CodeArts, and both
 * were measured against the live gateway on 2026-11-14 with the account this
 * plugin had just signed in — same body, same signature, only the rewriting
 * layer differs:
 *
 *   1. OUTPUT BUDGET. bili's `restoreOutputBudget` treats a `max_tokens` below
 *      the model's "known output ceiling" as a client-side collapse and raises
 *      it back to that ceiling. With no ceiling declared for the route, the
 *      ceiling comes from the models.dev registry, which lists 384000 for
 *      `deepseek-v4.1-flash`. CodeArts caps output at 65536; anything above it
 *      is refused inside a HTTP 200 SSE frame:
 *
 *        {"error_code":"InferHub.001001005.400",
 *         "error_msg":"The request param is invalid, Please check it"}
 *
 *      Measured: 65536 → streams normally; 384000 → that frame, with the same
 *      credential and body. The pack already clamps its own `max_tokens` to
 *      65536, so this is purely bili's late rewrite. Declaring
 *      `models.<id>.output = 65536` makes `ceiling` equal what the client
 *      already sends, so the rescue does not fire at all.
 *
 *   2. BENEFIT ROUTE. To re-sign a body it rewrote, bili re-derives the headers
 *      itself and calls its own `apigBenefitFor(model)`, which falls back to
 *      `DEFAULT_BENEFIT_MODELS = ["glm-5.3-flash", "deepseek-v4.1-flash"]`
 *      whenever the route declares nothing. That stamps `maas_type: benefit`
 *      onto the re-signed request, and an account without that entitlement gets
 *
 *        {"error_code":"InferHub.APIG.0101.404",
 *         "error_msg":"The API does not exist or has not been published in the
 *         environment"}
 *
 *      Measured on the same account: with `maas_type: benefit` → APIG.0101,
 *      without it → 200 and a normal stream. The pack stopped guessing this
 *      header for exactly the same reason
 *      (`tools/patch-pack-codearts-no-benefit-guess.mjs`); this closes the same
 *      guess one layer down, where bili re-signs.
 *
 * BOTH ARE ROUTE CONFIGURATION, NOT CODE
 *
 * bili resolves these two facts from `providers.<url>.models.<id>` in its own
 * config (`~/.config/billion-context/billion-context.json`, or
 * `$BILI_CONFIG_FILE`). `models.output` is the ceiling, `models.benefit` the
 * explicit benefit answer. So the fix is a config merge: declare the ceiling the
 * gateway actually enforces, and answer the benefit question instead of leaving
 * bili to guess.
 *
 * HOW IT IS APPLIED
 *
 * A running proxy is updated through its own management API
 * (`GET`/`PUT /__bili/config`), which validates the document and reloads the
 * route table in place — so a session that is already running is fixed without a
 * restart. The `PUT` accepts the whole file as `{ "file": "<json text>" }` and
 * REPLACES the provider map, so the document is always the one bili itself
 * reported, with only our two keys merged in; nothing of the user's own
 * configuration can be lost by it. When no proxy is running, the same document
 * is written to the config file directly, so the next spawn picks it up.
 *
 * Idempotent: after the first successful apply the desired document is already
 * on disk, so every later run compares equal and writes nothing.
 *
 * @module dsh-xdpool/bili-routes
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** The CodeArts chat gateway — the only upstream these declarations cover. */
export const CODEARTS_UPSTREAM = 'https://snap-access.cn-north-4.myhuaweicloud.com'

/**
 * What the gateway accepts as output tokens.
 *
 * Measured 2026-11-14: 65536 streams; 131072 produces an empty stream; 384000
 * answers `InferHub.001001005.400`. The pack already uses this same number for
 * its own clamp (`CODEARTS_MAX_OUTPUT_TOKENS`); it is repeated here because the
 * two layers are separate bundles and this one must not import the other's
 * internals.
 */
export const CODEARTS_MAX_OUTPUT_TOKENS = 65_536

/**
 * Models the channel pack serves, used when its catalog cache is unavailable.
 *
 * The cache (`<cache-dir>/codearts_models.json`) is written by the pack after a
 * successful catalog fetch and is the live roster; this list is the fallback so
 * a first run — before any catalog fetch — still declares the models a user is
 * most likely to pick. Ids are matched exactly by bili (then by a normalized
 * form), so the spelling here must be the wire spelling.
 */
export const KNOWN_CODEARTS_MODELS = Object.freeze([
  'GLM-5.2',
  'GLM-5.1',
  'GLM-5',
  'glm-5.3',
  'glm-5.3-flash',
  'glm-5.2-sft-harmony',
  'openpangu-2.0-flash',
  'openpangu-2.0-pro',
  'deepseek-v4-flash',
  'deepseek-v4-pro',
  'deepseek-v4.1-flash',
])

/** One per-model entry in bili's route table. */
interface RouteModelEntry {
  output?: unknown
  benefit?: unknown
  [key: string]: unknown
}

/** What an apply attempt did, for logging and tests. */
export interface BiliRouteOutcome {
  /** Where the declarations now live. */
  path: string
  /** Model ids declared. */
  models: readonly string[]
  /** How the change landed, or why it did not. */
  applied: 'proxy' | 'file' | 'already-declared' | 'no-config' | 'no-models'
  /** Non-fatal failure detail; this never throws into the caller. */
  error?: string
}

/** The DSH home, honouring the same override the rest of the plugin uses. */
function dshHome(env: NodeJS.ProcessEnv): string {
  const fromEnv = env['DSH_HOME']
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv.trim()
  return join(homedir(), '.dsh')
}

/** Where the pack caches its fetched CodeArts catalog. */
function codeArtsCacheDir(env: NodeJS.ProcessEnv): string | undefined {
  const override = env['DSH_CODEARTS_CACHE_DIR']
  if (override !== undefined && override.length > 0) return override
  const home = env['USERPROFILE'] ?? env['HOME'] ?? homedir()
  return home === undefined || home === '' ? undefined : join(home, '.cache', 'deveco')
}

/**
 * bili's config file, resolved the way bili resolves it.
 *
 * `BILI_CONFIG_FILE` wins over the XDG location, and `XDG_CONFIG_HOME` over
 * `~/.config` — mirroring `configFile()` in bili, because writing anywhere else
 * would be a silently inert file.
 */
export function biliConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env['BILI_CONFIG_FILE']
  if (explicit !== undefined && explicit.length > 0) return explicit
  const xdg = env['XDG_CONFIG_HOME']
  const base = xdg !== undefined && xdg.length > 0 ? xdg : join(homedir(), '.config')
  return join(base, 'billion-context', 'billion-context.json')
}

/**
 * bili's state directory — where it records the live proxy's origin.
 *
 * Resolved the way bili resolves it (`xdg("XDG_STATE_HOME", ".local/state")`),
 * because the origin pointer written by one resolution and read by another is a
 * pointer to nothing.
 */
export function biliStateDir(env: NodeJS.ProcessEnv = process.env): string {
  const xdg = env['XDG_STATE_HOME']
  const base = xdg !== undefined && xdg.length > 0 ? xdg : join(homedir(), '.local', 'state')
  return join(base, 'billion-context')
}

/**
 * The running proxy's origin, as bili records it for its own clients.
 *
 * `proxy-origin` is the file bili writes when it starts a proxy and removes when
 * one dies, so reading it is the difference between "update the proxy that is
 * serving this very session" and "write a config file the running process will
 * never look at". `BILI_ORIGIN` is honoured first for tests and for a launcher
 * that already knows the address.
 *
 * Never throws: an absent or half-written pointer simply means "no proxy".
 */
export async function biliProxyOrigin(env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  const explicit = env['BILI_ORIGIN']
  if (explicit !== undefined && explicit.trim() !== '') return explicit.trim().replace(/\/+$/, '')
  try {
    const raw = JSON.parse(await readFile(join(biliStateDir(env), 'proxy-origin'), 'utf8')) as unknown
    const origin = typeof raw === 'object' && raw !== null ? (raw as { origin?: unknown }).origin : undefined
    if (typeof origin === 'string' && origin.trim() !== '') return origin.trim().replace(/\/+$/, '')
  } catch {
    // No live proxy.
  }
  return undefined
}

/**
 * Model ids to declare: the pack's live catalog when it exists, the static
 * roster otherwise. Union, so a catalog that has not yet seen a model the
 * fallback knows still gets a declaration.
 */
export function codeArtsModelIds(
  cachedCatalog?: unknown,
  fallback: readonly string[] = KNOWN_CODEARTS_MODELS,
): string[] {
  const ids: string[] = []
  const push = (id: unknown): void => {
    if (typeof id !== 'string' || id === '' || ids.includes(id)) return
    ids.push(id)
  }
  if (Array.isArray(cachedCatalog)) {
    for (const entry of cachedCatalog as unknown[]) {
      if (typeof entry === 'string') push(entry)
      else if (typeof entry === 'object' && entry !== null && !Array.isArray(entry)) {
        push((entry as { id?: unknown }).id)
      }
    }
  }
  for (const id of fallback) push(id)
  return ids
}

/** Read the pack's cached catalog, if it has one. Never throws. */
export async function readCodeArtsCatalog(env: NodeJS.ProcessEnv = process.env): Promise<unknown> {
  const dir = codeArtsCacheDir(env)
  if (dir === undefined) return undefined
  try {
    return JSON.parse(await readFile(join(dir, 'codearts_models.json'), 'utf8')) as unknown
  } catch {
    return undefined
  }
}

/**
 * Merge the declarations into a bili config document.
 *
 * Everything that is already in `raw` survives: other providers, the user's
 * proxy/compress/billing blocks, and every per-model key we do not own. Only
 * `models.<id>.output` and `models.<id>.benefit` are written, and only on the
 * CodeArts route. Returns `changed: false` when the document already says this,
 * which is what keeps repeated runs free.
 */
export function mergeRouteDeclarations(
  raw: unknown,
  ids: readonly string[],
  options: { output?: number; benefit?: boolean; upstream?: string } = {},
): { document: Record<string, unknown>; changed: boolean } {
  const output = options.output ?? CODEARTS_MAX_OUTPUT_TOKENS
  const benefit = options.benefit ?? false
  const upstream = options.upstream ?? CODEARTS_UPSTREAM
  const base: Record<string, unknown> =
    typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? { ...(raw as Record<string, unknown>) }
      : {}
  const providers: Record<string, unknown> =
    typeof base['providers'] === 'object' && base['providers'] !== null && !Array.isArray(base['providers'])
      ? { ...(base['providers'] as Record<string, unknown>) }
      : {}
  const route: Record<string, unknown> =
    typeof providers[upstream] === 'object' && providers[upstream] !== null && !Array.isArray(providers[upstream])
      ? { ...(providers[upstream] as Record<string, unknown>) }
      : {}
  const models: Record<string, unknown> =
    typeof route['models'] === 'object' && route['models'] !== null && !Array.isArray(route['models'])
      ? { ...(route['models'] as Record<string, unknown>) }
      : {}

  let changed = false
  for (const id of ids) {
    const existing = models[id]
    const entry: RouteModelEntry =
      typeof existing === 'object' && existing !== null && !Array.isArray(existing)
        ? { ...(existing as RouteModelEntry) }
        : {}
    // Only fill what this layer owns. A ceiling the user lowered themselves is
    // respected: raising it back would re-create the very rejection this exists
    // to prevent, so only an absent or LARGER value is corrected.
    if (typeof entry.output !== 'number' || entry.output > output) {
      entry.output = output
      changed = true
    }
    // An explicit answer beats bili's `DEFAULT_BENEFIT_MODELS` guess. `false`
    // means "do not stamp `maas_type: benefit`", which is what the measured
    // entitlement requires; a user who does hold it can flip this one key.
    if (entry.benefit !== benefit) {
      entry.benefit = benefit
      changed = true
    }
    models[id] = entry
  }

  route['models'] = models
  providers[upstream] = route
  base['providers'] = providers
  return { document: base, changed }
}

/** Write a JSON document atomically. */
async function writeAtomically(path: string, document: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.xdpool-${String(process.pid)}.tmp`
  await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
  await rename(temporary, path)
}

/** One `fetch` call against the proxy's management API. */
async function proxyCall(
  origin: string,
  init: { method: 'GET' | 'PUT'; body?: string },
  fetchImpl: typeof fetch,
  timeoutMs = 1_500,
): Promise<{ ok: boolean; status: number; text: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(`${origin}/__bili/config`, {
      method: init.method,
      ...(init.body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: init.body }),
      signal: controller.signal,
    })
    return { ok: response.ok, status: response.status, text: await response.text() }
  } finally {
    clearTimeout(timer)
  }
}

/** The document bili reports, or undefined when the answer is not one. */
function documentFromProxy(text: string): Record<string, unknown> | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  const raw = (parsed as { raw?: unknown }).raw
  if (typeof raw !== 'string' || raw === '') return {}
  try {
    const document = JSON.parse(raw) as unknown
    return typeof document === 'object' && document !== null && !Array.isArray(document)
      ? (document as Record<string, unknown>)
      : {}
  } catch {
    return undefined
  }
}

/**
 * The last successful outcome, so a repeated call from the pool scan is free.
 *
 * `ensureCodeArtsRouteDeclarations` runs on every account scan, and a scan
 * happens on every lazy pool load — so without this a local HTTP round trip plus
 * a file read would ride every model request. The declarations are static (the
 * ceiling is a property of the gateway, the roster only grows), and bili
 * re-reads its config file on spawn, so once this process has applied them the
 * answer cannot go stale within the window below.
 *
 * Re-checked periodically rather than latched forever: a user who edits bili's
 * config by hand, or a bili that restarts with a doctored file, should be
 * corrected without a DSH restart too.
 */
const RECHECK_INTERVAL_MS = 10 * 60_000

let lastApplied: { at: number; outcome: BiliRouteOutcome } | undefined
let inFlight: Promise<BiliRouteOutcome> | undefined

/** Forget the latch, so the next call re-reads and re-applies. */
export function resetBiliRouteDeclarations(): void {
  lastApplied = undefined
  inFlight = undefined
}

/**
 * Apply the declarations, at most once per {@link RECHECK_INTERVAL_MS} and with
 * concurrent callers sharing one attempt.
 */
export function ensureCodeArtsRouteDeclarations(
  options: Parameters<typeof applyCodeArtsRouteDeclarations>[0] = {},
): Promise<BiliRouteOutcome> {
  const now = Date.now()
  const cached = lastApplied
  const explicit = options.env !== undefined || options.fetchImpl !== undefined || options.origin !== undefined
  if (!explicit && cached !== undefined && now - cached.at < RECHECK_INTERVAL_MS) {
    return Promise.resolve(cached.outcome)
  }
  if (!explicit && inFlight !== undefined) return inFlight
  const attempt = applyCodeArtsRouteDeclarations(options).then((outcome) => {
    // A failure is not cached: the next scan should try again.
    if (outcome.error === undefined && outcome.applied !== 'no-models') {
      lastApplied = { at: Date.now(), outcome }
    }
    return outcome
  })
  if (!explicit) {
    inFlight = attempt
    void attempt.finally(() => {
      inFlight = undefined
    })
  }
  return attempt
}

/**
 * Apply the declarations. Never throws — a failure here must not turn a working
 * sign-in into an error, and a missing bili is the normal case for most users.
 *
 * `fetchImpl` and the proxy origin are injectable so the whole flow is testable
 * without a live proxy.
 */
export async function applyCodeArtsRouteDeclarations(options: {
  env?: NodeJS.ProcessEnv
  fetchImpl?: typeof fetch
  origin?: string
  logger?: { info?: (message: string) => void; warn?: (message: string) => void } | undefined
  benefit?: boolean
  output?: number
} = {}): Promise<BiliRouteOutcome> {
  const env = options.env ?? process.env
  const path = biliConfigPath(env)
  const ids = codeArtsModelIds(await readCodeArtsCatalog(env))
  if (ids.length === 0) return { path, models: ids, applied: 'no-models' }
  const mergeOptions = {
    ...(options.output === undefined ? {} : { output: options.output }),
    ...(options.benefit === undefined ? {} : { benefit: options.benefit }),
  }

  const origin = options.origin ?? await biliProxyOrigin(env)
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  if (origin !== undefined && typeof fetchImpl === 'function') {
    try {
      const current = await proxyCall(origin, { method: 'GET' }, fetchImpl)
      if (current.ok) {
        const document = documentFromProxy(current.text)
        if (document !== undefined) {
          const merged = mergeRouteDeclarations(document, ids, mergeOptions)
          if (!merged.changed) return { path, models: ids, applied: 'already-declared' }
          // `{ file }` carries the WHOLE document: bili's provider PUT replaces
          // the map, so sending only our route would delete the user's others.
          const put = await proxyCall(
            origin,
            { method: 'PUT', body: JSON.stringify({ file: `${JSON.stringify(merged.document, null, 2)}\n` }) },
            fetchImpl,
          )
          if (put.ok) return { path, models: ids, applied: 'proxy' }
          options.logger?.warn?.(
            `[xdpool] billion-context refused the CodeArts route declarations (HTTP ${String(put.status)}); falling back to its config file`,
          )
        }
      }
    } catch (error) {
      // No proxy, or it is between instances: the file path below still applies
      // the same document for the next spawn.
      options.logger?.info?.(
        `[xdpool] billion-context proxy not reachable (${error instanceof Error ? error.message : String(error)}); writing its config file instead`,
      )
    }
  }

  try {
    let existing: unknown
    try {
      existing = JSON.parse(await readFile(path, 'utf8')) as unknown
    } catch {
      existing = undefined
    }
    const merged = mergeRouteDeclarations(existing, ids, mergeOptions)
    if (!merged.changed) return { path, models: ids, applied: 'already-declared' }
    await writeAtomically(path, merged.document)
    return { path, models: ids, applied: 'file' }
  } catch (error) {
    return { path, models: ids, applied: 'no-config', error: String(error) }
  }
}

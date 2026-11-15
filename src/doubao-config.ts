/**
 * Persisted settings for the Doubao plugin.
 *
 * ONE field on purpose. Doubao takes no credentials, no region, no pool and no
 * multipliers — the only thing a user can meaningfully configure is which catalog
 * entries appear in DSH's model picker.
 *
 * IMPORTANT: the schema lives in its own module so the browser half can mirror
 * the field name without importing anything Node-side. The Loader reads `Config`
 * from the plugin entry, which re-exports this.
 *
 * @module dsh-connect-doubao/config
 */
import z from '@deepseek-ai/schemastery'

/** The single settings field. Mirrored by the card as `enabledModelIds`. */
export const ENABLED_MODEL_IDS_FIELD = 'enabledModelIds'

/** Shape of this plugin's settings. */
export interface DoubaoSettings {
  /**
   * Catalog ids the user has ticked.
   *
   * Defaults to `[]` — which means "NOT YET CONFIGURED" rather than "ticked
   * nothing". The two are separated by {@link isConfigured}, which treats a
   * never-saved field the same as an empty one; schemastery 3.18.4 has no
   * `.optional()` and folds an `undefined` default into a NULLABLE field, which
   * would add a third state (`null`) for the card to disambiguate. The reference
   * connector uses the same default-plus-explicit-seeding approach.
   *
   * An empty list therefore serves the WHOLE catalog, so a first-run install
   * shows its models. Collapsing the two states would instead silently re-publish
   * every entry for a user who had deliberately ticked none — which is why
   * `enabledModelsOf` keys off {@link isConfigured} rather than off emptiness.
   */
  enabledModelIds: string[]
  /**
   * Simulate tool calling in the prompt so Doubao can drive the Harness tools.
   *
   * OFF by default. Doubao's endpoint ignores a `tools` array outright (measured
   * 2026-10-22: it answered with its OWN server-side search skill and never
   * referenced our declarations), so the only channel available is the prompt:
   * describe the tools, then parse a fenced block back into `tool_calls`.
   *
   * Measured 2026-11-02 with a two-tool sandbox loop: 9/9 calls well-formed,
   * 5/5 rounds converged, ~11.5s per round, one duplicate call. That is enough
   * to be useful and not enough to be trusted silently — hence opt-in.
   */
  toolEmulation: boolean
  /**
   * Absolute path to the Doubao profile, or `''` for "detect it yourself".
   *
   * Only needed when the app keeps `User Data` somewhere the four automatic
   * strategies cannot reach — an external drive that is not mounted at scan
   * time, a redirected folder, or a copy the user moved by hand. The card
   * offers a picker for it; the value is validated host-side (it must contain
   * `Default\Network\Cookies`) before it is stored.
   */
  profileDir: string
}

/** The settings field holding the tool-emulation switch. */
export const TOOL_EMULATION_FIELD = 'toolEmulation'

/** The settings field holding a manually chosen profile directory. */
export const PROFILE_DIR_FIELD = 'profileDir'

/** Read the chosen profile directory, or `undefined` when it is not set. */
export function profileDirOf(config: unknown): string | undefined {
  const value = (config as { profileDir?: unknown } | undefined)?.profileDir
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/** Read the switch out of an arbitrary config snapshot; default true. */
export function toolEmulationOf(config: unknown): boolean {
  const value = (config as { toolEmulation?: unknown } | undefined)?.toolEmulation
  return value !== false
}

/** Whether the user has ever saved a selection (i.e. the field is not the default). */
export function isConfigured(config: unknown): boolean {
  return enabledIdsOf(config) !== undefined
}

/**
 * The settings SCHEMA the Loader reads.
 *
 * It MUST be a real schemastery schema: Cordis calls `.validate()` on it while
 * resolving the entry's config, so a plain object literal throws
 * `TypeError: Cannot read properties of undefined (reading 'validate')` and the
 * Loader reports `1 entry did not activate` — the plugin then contributes
 * nothing at all (no provider, no routes), with only that one warning to show
 * for it. Verified against a real DSH 0.2.0-rc.2 host (M5-B).
 *
 * schemastery is a peer dependency resolved from the Harness at runtime and is
 * never bundled (see tsdown.config.ts).
 */
/**
 * Mark one schema field as volatile.
 *
 * This is what makes the field WRITABLE from a settings form at all. The host
 * only surfaces volatile fields (`Forms expose only volatile fields from
 * active, uniquely addressed profile entries`), and its write gate rejects
 * everything else:
 *
 *   Plugin entry "<id>" has no volatile fields
 *
 * — which is exactly why `settings.describe()` listed 33 namespaces and this
 * plugin's was the one missing: the namespace is derived from the marker, not
 * from the Loader entry. The comparison plugin states the failure verbatim:
 * "the scope's `set()` still resolves — so the card would look like it saved
 * and silently revert", which is precisely the symptom that started this hunt.
 *
 * `volatile()` ships in schemastery 3.18.3+ and the peer range requires
 * >=3.18.4, so the function probe is a safety net rather than the normal path;
 * it degrades to the bare schema on an older resolution instead of throwing.
 */
function asVolatile<T>(schema: T): T {
  const candidate = schema as unknown as { volatile?: () => T }
  return typeof candidate.volatile === 'function' ? candidate.volatile() : schema
}

export const Config: z<DoubaoSettings> = z.object({
  enabledModelIds: asVolatile(z.array(z.string()).default([]))
    .description('Catalog ids enabled in the DSH model picker. Doubao routes upstream by content, so this selects which entries are offered, never which model answers. Empty means "not yet configured" and serves the whole catalog.'),
  toolEmulation: asVolatile(z.boolean().default(true))
    .description('使用提示词模拟工具调用（OpenAI tools → doubao-tool 围栏 → tool_calls），让豆包及客户端接入的第三方模型能驱动 Harness 的本地工具。默认开启。'),
  profileDir: asVolatile(z.string().default(''))
    .description('豆包客户端 User Data 目录。留空表示自动探测（%LOCALAPPDATA%、%APPDATA%、运行中客户端的 --user-data-dir、全盘扫描）。只有当豆包把数据放在自动探测找不到的位置时才需要填。'),
})

/**
 * The ticked ids, or `undefined` when the field is ABSENT.
 *
 * The absent case is what `enabledModelsOf` keys off to mean "never
 * configured"; a present-but-empty array is a real (empty) selection.
 */
export function enabledIdsOf(config: unknown): string[] | undefined {
  const value = (config as { enabledModelIds?: unknown } | undefined)?.enabledModelIds
  if (!Array.isArray(value)) return undefined
  return value.filter((entry): entry is string => typeof entry === 'string')
}

/**
 * The ids the adapter should filter by, or `undefined` for "serve everything".
 *
 * Normalises the schemastery default (`[]`, meaning not-yet-configured) into
 * the `undefined` that `enabledModelsOf` reads as "serve the whole catalog".
 * Without this the default would read as a user who ticked nothing, and a
 * first-run install would show an empty model picker.
 */
export function effectiveIds(config: unknown): string[] | undefined {
  const ids = enabledIdsOf(config)
  if (ids === undefined || ids.length === 0) return undefined
  return ids
}
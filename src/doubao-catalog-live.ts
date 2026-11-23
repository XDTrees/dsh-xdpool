/**
 * The Doubao catalogue, asked of the account.
 *
 * WHY THE STATIC LIST IS NOT ENOUGH
 *
 * `doubao-models.ts` carries the six entries read off a real client request. Doubao also
 * publishes a LONGER roster per account — the 「工作任务」 family plus third-party models
 * (DeepSeek, Kimi, GLM) that are only visible once a session exists. Reading it costs one
 * request and makes the picker match what the account can actually use.
 *
 * The endpoint and body were measured against the live service: `brief_list` requires
 * `{language_code, bot_id}` and the `Agw-Js-Conv` header. An empty body is answered
 * `710010202 common invalid param`, and no body at all is answered "system error" — both of
 * which read like a broken request rather than a missing field.
 *
 * FAILURE IS NOT FATAL
 *
 * A catalogue read that fails leaves the static list in place. The lane stays usable with the
 * six models that are known to work, which beats an empty picker because one optional call
 * went wrong.
 *
 * @module dsh-xdpool/doubao-catalog-live
 */
import { cookieHeader, sessionUsable, type DoubaoSession } from './doubao-auth.ts'
import { DOUBAO_MODELS, type DoubaoModelInfo } from './doubao-models.ts'
import { modelsFromClientCache } from './doubao-client-cache.ts'
import { fetchMenuModels } from './doubao-menu.ts'

/** The endpoint that lists what the account may use. */
const BRIEF_LIST_ENDPOINT = 'https://www.doubao.com/alice/slot/action_bar_v3/brief_list'

/** The bot whose roster is being asked for — the default Doubao assistant. */
const BOT_ID = '7338286299411103781'

/** How long a live listing is reused. */
const TTL_MS = 10 * 60 * 1000

/** The query the endpoint expects. */
const CLIENT_PARAMS = {
  aid: '497858',
  real_aid: '497858',
  version_code: '20800',
  device_platform: 'web',
  doubao_device_platform: 'web',
  language: 'zh',
  region: 'CN',
  sys_region: 'CN',
  pkg_type: 'release_version',
  pc_version: '2.1.7',
  chromium_version: '148.0.7816.0',
  client_platform: 'pc_client',
  runtime: 'web',
  runtime_version: '3.5.4',
  samantha_web: '1',
  'use-olympus-account': '1',
} as const

let cached: { at: number; models: readonly DoubaoModelInfo[] } | undefined

/** A model row as the endpoint reports it. */
interface RawModel {
  model_item_key?: unknown
  key?: unknown
  name?: unknown
  title?: unknown
  localized_name?: unknown
  tag_list?: unknown
  context_window?: unknown
}

/**
 * Read the roster from the account.
 *
 * `now` is injectable so a test can exercise the cache without waiting.
 */
export async function fetchLiveModels(
  session: DoubaoSession | undefined,
  options: { force?: boolean; now?: number } = {},
): Promise<readonly DoubaoModelInfo[]> {
  const now = options.now ?? Date.now()
  if (options.force !== true && cached !== undefined && now - cached.at < TTL_MS) return cached.models
  if (session === undefined || !sessionUsable(session)) return DOUBAO_MODELS

  const params = new URLSearchParams({ ...CLIENT_PARAMS, web_tab_id: crypto.randomUUID() })
  let raw: unknown
  try {
    const response = await fetch(`${BRIEF_LIST_ENDPOINT}?${params.toString()}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: '*/*',
        'user-agent': session.userAgent,
        // The scheme URL, not https: the gateway checks which client is calling.
        Referer: 'chrome://doubao-chat/',
        'agw-js-conv': 'str',
        cookie: cookieHeader(session),
      },
      // Both fields are required; an empty body is answered `710010202`.
      body: JSON.stringify({ language_code: 'zh', bot_id: BOT_ID }),
      // Bounded, because this runs inside a card render path: a hung read left the model list
      // empty and the panel spinning.
      signal: AbortSignal.timeout(12_000),
    })
    raw = await response.json()
  } catch {
    return DOUBAO_MODELS
  }

  /**
   * The page's server-side render is the PRIMARY source.
   *
   * Doubao has no frontend endpoint for the model menu: `brief_list` answers only the skill
   * strip, and the roster is fetched by the page's own loader and inlined into the HTML it
   * returns. `fetchMenuModels` reads that HTML with the account's cookie and gets the whole
   * office roster — measured as eleven entries with real multipliers and per-model windows.
   *
   * This matters beyond convenience: the fallback below reads the DESKTOP CLIENT's IndexedDB,
   * which only exists for someone who installed and ran the client. A user who signed in
   * through this plugin's own browser window got the baseline six and nothing else.
   */
  const fromMenu = await fetchMenuModels(session)
  /**
   * The client cache is still consulted, as a fallback.
   *
   * It costs nothing when absent, and it carries slugs a page render might have filtered —
   * `need_upgrade` entries are dropped from the menu, and a paid model the user has since
   * bought appears on the next page load rather than immediately.
   */
  const fromCache = fromMenu.length > 0 ? [] : modelsFromClientCache()
  const discovered = [...fromMenu, ...modelsFrom(raw), ...fromCache]
  if (discovered.length === 0) return DOUBAO_MODELS

  /**
   * The static entries come FIRST, by id, and the discovered ones fill in behind them.
   *
   * The six in `DOUBAO_MODELS` are the ones measured to work end to end, including the image
   * alias that is not a Doubao model key at all — a live listing cannot produce that, and it
   * must not be dropped because the server never heard of it.
   */
  const byId = new Map<string, DoubaoModelInfo>()
  for (const model of DOUBAO_MODELS) byId.set(model.id, model)
  for (const model of discovered) {
    if (byId.has(model.id)) {
      /**
       * Keep the known-good name; add what the SERVER published, if it has any.
       *
       * The effort ladder has to survive this merge — issue #207. Before, only
       * `badge` was copied, so every model already present in the static table
       * threw away the 低/中/高/极高/最高 it had just been handed, and the picker
       * fell back to three fixed levels. Only overwrite when the server really
       * said something: the IndexedDB-cache path carries no ladder, and an empty
       * value there must not wipe one that is already known.
       */
      const known = byId.get(model.id)
      if (known !== undefined) {
        const next = { ...known }
        if (known.badge === undefined && model.badge !== undefined) next.badge = model.badge
        if (model.efforts !== undefined && model.efforts.length > 0) next.efforts = model.efforts
        if (next.badge !== known.badge || next.efforts !== known.efforts) byId.set(model.id, next)
      }
      continue
    }
    byId.set(model.id, model)
  }
  const models = [...byId.values()]
  cached = { at: now, models }
  return models
}

/**
 * Pull model rows out of whatever shape the endpoint answered with.
 *
 * The document is nested and has changed shape between builds, so the walk looks for the
 * FIELDS rather than a fixed path: any object carrying a `model_item_key` (or a `key` next to
 * a name) is a model. That is what keeps this working when the envelope is rearranged.
 */
export function modelsFrom(raw: unknown): DoubaoModelInfo[] {
  const out: DoubaoModelInfo[] = []
  const seen = new Set<string>()
  const walk = (node: unknown, depth: number): void => {
    if (depth > 12 || node === null || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const entry of node) walk(entry, depth + 1)
      return
    }
    const record = node as RawModel
    const key = typeof record.model_item_key === 'string'
      ? record.model_item_key
      : typeof record.key === 'string' ? record.key : undefined
    const name = typeof record.name === 'string'
      ? record.name
      : typeof record.title === 'string'
        ? record.title
        : typeof record.localized_name === 'string' ? record.localized_name : undefined
    if (key !== undefined && key !== '' && name !== undefined && name !== '' && !seen.has(key)) {
      seen.add(key)
      const badge = badgeOf(record.tag_list)
      out.push({
        id: key,
        name,
        ...(badge === undefined ? {} : { badge }),
        reasoning: true,
      })
    }
    for (const value of Object.values(record)) walk(value, depth + 1)
  }
  walk(raw, 0)
  return out
}

/** The tag text the card shows beside a model, when the server sent one. */
function badgeOf(tagList: unknown): string | undefined {
  if (!Array.isArray(tagList)) return undefined
  for (const tag of tagList) {
    if (typeof tag === 'string' && tag.trim() !== '') return tag.trim()
    if (typeof tag === 'object' && tag !== null) {
      const text = (tag as { text?: unknown }).text
      if (typeof text === 'string' && text.trim() !== '') return text.trim()
    }
  }
  return undefined
}

/** Drop the cache, for a test or after a sign-out. */
export function resetLiveModelsCache(): void {
  cached = undefined
}

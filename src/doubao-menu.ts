/**
 * The Doubao model menu, read from the page the browser would load.
 *
 * WHY THIS REPLACES THE CLIENT CACHE
 *
 * The menu is NOT on an HTTP endpoint the frontend can call: `slot/action_bar_v3/brief_list`
 * answers only the skill strip (`entry_list` — the PPT / recording buttons), and the model
 * menu is fetched by the page's own server-side loader and inlined into the HTML it returns.
 * Reading the desktop client's IndexedDB worked, but it made the whole catalogue conditional on
 * having the client installed and having run it — so a user who signed in through this plugin's
 * browser window got the six baselines and nothing else.
 *
 * The same HTML is available to any session: `GET https://www.doubao.com/chat/` with a valid
 * cookie returns `actionBarBriefList.modeSelectData` already populated. Measured with a
 * signed-in cookie: the office mode lists seven `person-*` models — DeepSeek, Kimi and GLM —
 * which is what the client cache was being read for.
 *
 * WHAT TRAVELS WITH EACH MODEL
 *
 * `model_extra_params.total_window_size` is the context window, `reasoning_effort_config.option_list`
 * is the reasoning ladder, and `tag_list` carries the multiplier (`1.44x`) or the promotion
 * (`限时优惠 0.01x`). `subscribe_config.need_upgrade` marks a model the account has not bought —
 * those are skipped rather than shown and failing.
 *
 * @module dsh-xdpool/doubao-menu
 */
import { cookieHeader, sessionUsable, type DoubaoSession } from './doubao-auth.ts'
import type { DoubaoModelInfo } from './doubao-models.ts'

/** The page whose server-side render carries the menu. */
const CHAT_PAGE = 'https://www.doubao.com/chat/'

/** How long a read menu is reused. */
const TTL_MS = 10 * 60 * 1000

let cached: { at: number; models: readonly DoubaoModelInfo[] } | undefined

/** The reasoning ladder's numeric levels, as the vendor names them. */
const LEVEL_NAMES: Readonly<Record<number, string>> = {
  3: 'low',
  4: 'medium',
  5: 'high',
  6: 'xhigh',
  7: 'max',
  8: 'auto',
}

/**
 * The multiplier in a tag list.
 *
 * Doubao returns the rate as a tag: `type 2` is a bare multiplier (`1.44x`), `type 6` is a
 * promotion with a prefix (`限时优惠 0.01x`). A tag with no number at all says the model is not
 * metered for this account (`小额免费`), which is reported as `免费` rather than as a rate.
 */
export function rateFromTags(tags: unknown): string | undefined {
  if (!Array.isArray(tags)) return undefined
  for (const tag of tags) {
    const text = typeof tag === 'object' && tag !== null
      ? String((tag as { text?: unknown }).text ?? '').trim()
      : ''
    if (text === '') continue
    const match = /(\d+(?:\.\d+)?)\s*[xX×]$/u.exec(text)
    if (match?.[1] !== undefined) return text
    if (/免费/u.test(text)) return text
  }
  return undefined
}

/** A model key as the vendor writes it, kept verbatim. */
function keyOf(item: Record<string, unknown>): string | undefined {
  const key = item['model_item_key'] ?? item['key']
  return typeof key === 'string' && key !== '' ? key : undefined
}

/**
 * One menu entry, or undefined when it should not be listed.
 *
 * A `need_upgrade` model is one the account has not subscribed to: showing it would put a model
 * in the picker that answers an upgrade prompt instead of a reply.
 */
function entryOf(item: Record<string, unknown>): DoubaoModelInfo | undefined {
  if (typeof item !== 'object' || item === null) return undefined
  const subscribe = item['subscribe_config']
  if (subscribe !== null && typeof subscribe === 'object'
    && (subscribe as { need_upgrade?: unknown }).need_upgrade === true) {
    return undefined
  }
  const key = keyOf(item)
  if (key === undefined) return undefined
  const name = typeof item['name'] === 'string' && item['name'] !== '' ? item['name'] : key

  const extra = item['model_extra_params']
  const window = extra !== null && typeof extra === 'object'
    ? Number((extra as { total_window_size?: unknown }).total_window_size)
    : Number.NaN

  const config = item['reasoning_effort_config']
  const options = config !== null && typeof config === 'object'
    ? (config as { option_list?: unknown }).option_list
    : undefined
  const levels: string[] = []
  if (Array.isArray(options)) {
    for (const option of options) {
      const level = typeof option === 'object' && option !== null
        ? Number((option as { level?: unknown }).level)
        : Number.NaN
      const name2 = LEVEL_NAMES[level]
      if (name2 !== undefined && !levels.includes(name2)) levels.push(name2)
    }
  }

  const rate = rateFromTags(item['tag_list'])
  return {
    id: key,
    name,
    // Every model on this menu is reached through the office (work-task) lane, which is what
    // the upstream keys on; there is no separate chat-only roster here.
    badge: '工作任务',
    reasoning: levels.length > 0,
    ...(Number.isFinite(window) && window > 0 ? { contextWindow: window } : {}),
    ...(rate === undefined ? {} : { rate }),
    ...(levels.length === 0 ? {} : { efforts: levels }),
  }
}

/**
 * Every model listed on the office lane of a menu document.
 *
 * The document is the `modeSelectData` subtree: a list of MODES, each with its own model list.
 * Only the office mode holds the multi-model roster — the default chat mode lists its own
 * entries, which are not what a work subscription grants.
 */
export function modelsFromMenu(raw: unknown): DoubaoModelInfo[] {
  /**
   * Accept the menu itself OR a document wrapping it.
   *
   * `menuFromHtml` returns the `modeSelectData` object directly, while a caller holding a whole
   * response would pass `{ data: { modeSelectData } }`. Both are handled because getting this
   * wrong is silent: the result is an empty list, which looks exactly like "the account has no
   * models" and sends the reader looking at the wrong layer.
   */
  let candidate = raw
  if (candidate !== null && typeof candidate === 'object' && 'data' in candidate) {
    candidate = (candidate as { data?: unknown }).data
  }
  if (candidate !== null && typeof candidate === 'object' && 'modeSelectData' in candidate) {
    candidate = (candidate as { modeSelectData?: unknown }).modeSelectData
  }
  if (candidate === null || typeof candidate !== 'object') return []
  const config = (candidate as { modeSelectConfig?: unknown }).modeSelectConfig
    ?? (candidate as { menuConfV2?: unknown }).menuConfV2
  if (config === null || typeof config !== 'object') return []

  const record = config as Record<string, unknown>
  // Two shapes measured: `menu_item_list` (flat, the page) and `mode_list.item_list` (nested,
  // the client cache). Both carry model entries, so both are walked.
  const lists: unknown[] = [record['menu_item_list']]
  const modes = record['mode_list']
  if (modes !== null && typeof modes === 'object') {
    lists.push((modes as { item_list?: unknown }).item_list)
  }

  const out: DoubaoModelInfo[] = []
  const seen = new Set<string>()
  for (const list of lists) {
    if (!Array.isArray(list)) continue
    for (const item of list) {
      if (typeof item !== 'object' || item === null) continue
      const entry = entryOf(item as Record<string, unknown>)
      if (entry === undefined || seen.has(entry.id)) continue
      seen.add(entry.id)
      out.push(entry)
    }
  }
  return out
}

/**
 * Pull the menu document out of the page's HTML.
 *
 * The data is inlined as a JSON assignment, so this finds the `modeSelectData` key and decodes
 * the balanced object that follows it. A hand-rolled bracket walk rather than a regex, because
 * the value is nested many levels deep and contains braces inside strings.
 */
export function menuFromHtml(html: string): unknown {
  const marker = '"modeSelectData"'
  const at = html.indexOf(marker)
  if (at < 0) return undefined
  const colon = html.indexOf(':', at + marker.length)
  if (colon < 0) return undefined
  let start = colon + 1
  while (start < html.length && /\s/u.test(html[start] ?? '')) start += 1
  if (html[start] !== '{') return undefined

  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < html.length; i += 1) {
    const ch = html[i]
    if (inString) {
      if (escaped) { escaped = false; continue }
      if (ch === '\\') { escaped = true; continue }
      if (ch === '"') inString = false
      continue
    }
    if (ch === '"') { inString = true; continue }
    if (ch === '{') { depth += 1; continue }
    if (ch === '}') {
      depth -= 1
      if (depth === 0) {
        const slice = html.slice(start, i + 1)
        try {
          return JSON.parse(slice) as unknown
        } catch {
          // The page escapes forward slashes (`\u002F`); that is valid JSON, so a failure here
          // means the walk found the wrong object rather than an encoding problem.
          return undefined
        }
      }
    }
  }
  return undefined
}

/**
 * The account's menu, read from the page.
 *
 * A failed read returns an empty list rather than throwing: the caller falls back to the
 * measured baseline, because a picker with the known-good models beats an empty one.
 */
export async function fetchMenuModels(
  session: DoubaoSession | undefined,
  options: { force?: boolean; now?: number } = {},
): Promise<readonly DoubaoModelInfo[]> {
  const now = options.now ?? Date.now()
  if (options.force !== true && cached !== undefined && now - cached.at < TTL_MS) return cached.models
  if (session === undefined || !sessionUsable(session)) return []
  try {
    const response = await fetch(CHAT_PAGE, {
      headers: {
        'user-agent': session.userAgent,
        Referer: 'chrome://doubao-chat/',
        accept: 'text/html',
        cookie: cookieHeader(session),
      },
      signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok) return []
    const models = modelsFromMenu(menuFromHtml(await response.text()))
    if (models.length === 0) return []
    cached = { at: now, models }
    return models
  } catch {
    return []
  }
}

/** Drop the cache, for a test or after a sign-out. */
export function resetMenuCache(): void {
  cached = undefined
}

/**
 * The full Doubao model menu, read from the desktop client's own cache.
 *
 * WHY THE WEB CATALOGUE IS SHORT
 *
 * `brief_list` answers with feature ENTRIES (writing, images, video…) and none of the model
 * keys, so a session alone yields the six models that are measured to work. The account can
 * use more — Doubao publishes third-party models as `person-*` slugs (DeepSeek, Kimi, GLM),
 * and the desktop client knows all of them.
 *
 * WHERE IT KEEPS THEM
 *
 * The client caches the menu in its Chromium profile:
 *
 *   %LOCALAPPDATA%/Doubao/User Data/Default/IndexedDB/chrome_doubao-launcher_0.indexeddb.leveldb
 *
 * A LevelDB store, so there is no key to look up without the library — but the records are
 * plain V8-serialised blobs, and the model entries sit at `model_item_key` followed by the
 * display `name`. Scanning the log files for that sequence is what the reference
 * implementation does, and it is what this does too.
 *
 * WHEN IT IS ABSENT
 *
 * Nothing guarantees the desktop client is installed or has ever run. A missing directory is
 * the ordinary case on a machine that only uses the web product, and it must not be reported
 * as a failure — the six measured models are still there.
 *
 * @module dsh-xdpool/doubao-client-cache
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DoubaoModelInfo } from './doubao-models.ts'

/** The cache stores that carry the menu, newest first. */
const CACHE_DB_DIRS = [
  'chrome_doubao-launcher_0.indexeddb.leveldb',
  'chrome_doubao-chat_0.indexeddb.leveldb',
]

/** Where the client keeps its Chromium profile. */
function userDataDirs(): string[] {
  const out: string[] = []
  const local = process.env['LOCALAPPDATA']
  if (local !== undefined) out.push(join(local, 'Doubao', 'User Data'))
  const roaming = process.env['APPDATA']
  if (roaming !== undefined) out.push(join(roaming, 'Doubao'))
  // The profile the plugin's own sign-in browser uses is NOT this: it holds no Doubao client
  // cache, and reading it would only produce noise.
  return out
}

/** Every cache directory that exists. */
export function cacheDirs(): string[] {
  const found: string[] = []
  const seen = new Set<string>()
  for (const base of userDataDirs()) {
    for (const db of CACHE_DB_DIRS) {
      const full = join(base, 'Default', 'IndexedDB', db)
      const key = full.toLowerCase()
      if (!seen.has(key) && existsSync(full)) {
        seen.add(key)
        found.push(full)
      }
    }
  }
  return found
}

/** Read a LEB128 varint. Returns [value, nextOffset] or undefined. */
function readVarint(buf: Buffer, at: number): [number, number] | undefined {
  let result = 0
  let pos = at
  let bytes = 0
  for (;;) {
    if (pos >= buf.length) return undefined
    const byte: number | undefined = buf[pos]
    if (byte === undefined) return undefined
    result |= (byte & 0x7f) << (7 * bytes)
    pos += 1
    bytes += 1
    if ((byte & 0x80) === 0) break
    if (bytes > 4) return undefined
  }
  return [result >>> 0, pos]
}

/** Read a structured-clone string at `at`. Returns [value, nextOffset]. */
function readV8String(buf: Buffer, at: number): [string, number] | undefined {
  const tag = buf[at]
  const sized = readVarint(buf, at + 1)
  if (sized === undefined) return undefined
  const [length, dataAt] = sized
  const end = dataAt + length
  if (length <= 0 || end > buf.length) return undefined
  // One-byte strings carry tag 0x22, two-byte strings 0x63.
  if (tag === 0x22) return [buf.subarray(dataAt, end).toString('latin1'), end]
  if (tag === 0x63) return [buf.subarray(dataAt, end).toString('utf16le'), end]
  return undefined
}

/** Find the `name` property following `from` and decode its value. */
function readNameAfter(buf: Buffer, from: number, to: number): string | undefined {
  for (let i = from; i < to - 6; i++) {
    if (buf[i] !== 0x22) continue
    const sized = readVarint(buf, i + 1)
    if (sized === undefined) continue
    const [length, dataAt] = sized
    if (length !== 4 || dataAt + 4 > buf.length) continue
    if (buf.subarray(dataAt, dataAt + 4).toString('latin1') !== 'name') continue
    const value = readV8String(buf, dataAt + 4)
    if (value === undefined) return undefined
    const [name, next] = value
    if (next > to) return undefined
    return name
  }
  return undefined
}

/**
 * Whether a string has the shape of a model key.
 *
 * Shape, not length: the earlier bound of 24 characters silently dropped every `person-*`
 * model, because those slugs run to 37. The server is the only authority on which keys exist,
 * so this only rejects what could not be a key at all.
 */
function looksLikeModelKey(value: string): boolean {
  return /^[\w.-]{1,64}$/u.test(value)
}

/** Whether a string has the shape of a display name rather than a field name or URL. */
function looksLikeModelName(value: string): boolean {
  if (value.length < 2 || value.length > 40) return false
  if (!/[\u4e00-\u9fa5A-Za-z]/u.test(value)) return false
  return !/^[a-z_]+$/u.test(value) && !value.includes('http')
}

/**
 * Parse one LevelDB value buffer for (key, name) pairs.
 *
 * Exported so the encoding can be tested with synthetic bytes: the real cache belongs to
 * another application and changes whenever it updates, so a parser that can only be exercised
 * against it cannot be trusted to keep working.
 */
export function parseCacheBuffer(buf: Buffer): DoubaoModelInfo[] {
  const out = new Map<string, DoubaoModelInfo>()
  /**
   * A second, text-based pass over the same buffer.
   *
   * V8 does not store a long string as one contiguous run: a key of 37 characters arrives as
   * several chunks (`person-deepseek-v4-` + `1` + `.flash-26` + `1017`), each with its own
   * length prefix. The structured reader below decodes the FIRST chunk and then stops, because
   * the next byte is not a string tag — so a model whose slug happens to be split was skipped
   * entirely, which is why DeepSeek was missing while Kimi and GLM were not.
   *
   * The scan below reconciles the fragments: every `person-…` run in the printable text is a
   * candidate, and the longest key that starts the same way wins. That is what turns
   * `person-deepseek-v4-` back into `person-deepseek-v4-1-flash-261017`.
   */
  const text = buf.toString('latin1')
  const slugs = [...new Set([...text.matchAll(/person-[a-z0-9][a-z0-9-]{4,60}/gu)].map(match => match[0]))]
  for (const slug of slugs) {
    /**
     * Only a COMPLETE slug is a model.
     *
     * The fragments outnumber the real keys: the same record contributes
     * `person-deepseek-v4-` and `ash-26`, and a naive run turns both into "models". Doubao
     * slugs end in a six-digit date stamp (`…-261017`), so requiring that shape keeps the
     * sixteen real keys and drops every piece of a split one.
     */
    if (!/^person-[a-z0-9-]+-\d{6}$/u.test(slug)) continue
    if (out.has(slug)) continue
    const name = nameForSlug(buf, slug)
    /**
     * The window and the multiplier travel WITH the model in this cache.
     *
     * Measured on a real record: `total_window_size: 300000` and a `tag.text` of `"1.48x"` sit
     * beside `model_item_key` and `name`. Neither is on any HTTP endpoint this lane can call —
     * `brief_list` returns feature entries and no model fields at all — so the cache is the only
     * source for the two numbers the picker wants to print.
     */
    const meta = metaNear(buf, slug)
    out.set(slug, {
      id: slug,
      // A readable name from the slug when the bytes do not yield one: `person-deepseek-v4-1-flash`
      // becomes "DeepSeek V4.1 Flash", which is what the vendor calls it. The raw slug as a
      // label is worse than a derived one and only marginally better than nothing.
      name: name ?? nameFromSlug(slug),
      badge: '工作任务',
      reasoning: true,
      ...(meta.contextWindow === undefined ? {} : { contextWindow: meta.contextWindow }),
      ...(meta.rate === undefined ? {} : { rate: meta.rate }),
    })
  }

  const KEY = Buffer.from('model_item_key')
  let at = -1
  while ((at = buf.indexOf(KEY, at + 1)) !== -1) {
    const keyRead = readV8String(buf, at + KEY.length)
    if (keyRead === undefined) continue
    const [firstChunk, afterKey] = keyRead
    if (!looksLikeModelKey(firstChunk)) continue
    /**
     * A leaf key such as `0` / `3` / `seed-lite-7b` arrives whole. A `person-*` key may be
     * truncated here, which is why the slug pass above exists; if this read is short, skip it
     * rather than storing a partial id the upstream would reject.
     */
    const key = firstChunk.endsWith('-') ? undefined : firstChunk
    if (key === undefined) continue
    const name = readNameAfter(buf, afterKey, Math.min(buf.length, afterKey + 220))
    if (name === undefined || !looksLikeModelName(name)) continue
    if (!out.has(key)) {
      out.set(key, {
        id: key,
        name,
        /**
         * Third-party slugs are 「工作任务」 models: the client runs them through the task lane,
         * and `seed-lite-7b` / `5` / `9` are already badged that way in the static list.
         */
        ...(key.startsWith('person-') || key === 'seed-lite-7b' || key === '5' || key === '9'
          ? { badge: '工作任务' }
          : {}),
        reasoning: true,
      })
    }
  }
  return [...out.values()]
}

/**
 * The display name belonging to a slug, read from the buffer.
 *
 * The name sits after the key in the same record. It is matched by finding the slug in the raw
 * bytes and taking the first readable name-like string that follows — which is what makes the
 * card show "DeepSeek V4.1 Flash" rather than the raw slug.
 */
function nameForSlug(buf: Buffer, slug: string): string | undefined {
  const at = buf.indexOf(Buffer.from(slug, 'latin1'))
  if (at < 0) return undefined
  /**
   * A short window AFTER the key, and a strict shape.
   *
   * The display name follows its key in the same record, but the bytes between them are
   * encoding noise that decodes into plausible-looking garbage ("enableDeepThinkingSwitchT",
   * "namec K"). Widening the window made that worse, so the match is narrowed instead: a name
   * is a run of letters/CJK that STARTS with a capital or a Han character, contains no
   * camelCase tail (which is how a field name reads), and is not one of the known field words.
   */
  const window = buf.subarray(at + slug.length, Math.min(buf.length, at + slug.length + 200)).toString('utf8')
  for (const match of window.matchAll(/[一-龥A-Z][一-龥A-Za-z0-9]*(?:[ .·][一-龥A-Za-z0-9]+){0,3}/gu)) {
    const candidate = match[0].trim()
    if (candidate.length < 2 || candidate.length > 40) continue
    if (!/[一-龥]/u.test(candidate) && !/^[A-Z][A-Za-z0-9]*(?: [A-Z0-9][A-Za-z0-9.]*){1,4}$/u.test(candidate)) {
      // A single capitalised token with no space is a field name far more often than a model.
      continue
    }
    if (/^(Model|Name|Version|Switch|Expert|Jump|Deep|Person|Http|Samantha|Item|List|Menu|Conf)/u.test(candidate)) continue
    return candidate
  }
  return undefined
}


/**
 * The window and multiplier recorded beside a model key.
 *
 * Both live in the same V8 record as the key, a few hundred bytes after it, so they are read
 * from the same window the name is: `total_window_size` (or `context_window`) as a number, and
 * the first `tag.text` that reads like a multiplier. Either may be absent — a model on a plan
 * that publishes no figure simply has neither, and printing an invented one would be worse than
 * printing nothing.
 */
export function metaNear(buf: Buffer, slug: string): { contextWindow?: number; rate?: string } {
  const at = buf.indexOf(Buffer.from(slug, 'latin1'))
  if (at < 0) return {}
  /**
   * The window the fields are read from, and why the search is binary-tolerant.
   *
   * The record is V8-serialised, so a field name and its value are separated by bytes that
   * decode to control characters — `"text"1.48x` is one measured example. A pattern that
   * expects a space or a quote between them matches nothing, which is how the first version of
   * this function returned empty for every model.
   */
  const window = buf.subarray(at, Math.min(buf.length, at + 1200))
  const text = window.toString('latin1')
  const out: { contextWindow?: number; rate?: string } = {}
  // A multiplier: "1.48x", "0.65x", "x0", or the Chinese words the promotions use.
  // A multiplier reads `1.48x` or `0.65x`; the Chinese promotions have no number at all.
  const rate = /(\d+(?:\.\d+)?x|免费|限时免费)/iu.exec(text)
  if (rate?.[1] !== undefined) out.rate = rate[1].trim()
  /**
   * A context window: `total_window_size` followed by its digits.
   *
   * Matched loosely on the boundary between the name and the number because the serialised form
   * has no separator to anchor on — any non-digit run of up to 24 bytes is allowed between them.
   */
  const size = /total_window_size[^0-9]{1,24}(\d{4,7})/u.exec(text)
    ?? /context_window[^0-9]{1,24}(\d{4,7})/u.exec(text)
    ?? /(\d{3})k_\d{3}/u.exec(text)
  if (size?.[1] !== undefined) {
    // The `300k_230` shape records the window in kilobytes rather than as a full count.
    out.contextWindow = size[0].includes('k_') ? Number(size[1]) * 1000 : Number(size[1])
  }
  return out
}

/**
 * A presentable name derived from a model slug.
 *
 * `person-kimi-k3-1-pro-highspeed` reads as "Kimi K3.1 Pro Highspeed": the vendor prefix and
 * the date stamp are dropped, and version numbers are joined back together. Used only when the
 * cache bytes do not yield the real display name.
 */
export function nameFromSlug(slug: string): string {
  const body = slug
    .replace(/^person-/u, '')
    .replace(/-\d{6}$/u, '')
    .split('-')
    .filter(part => part !== '')
  /**
   * Join version numbers: `deepseek-v4-1-flash` is "DeepSeek V4.1 Flash", not "V4 1 Flash".
   *
   * A part that is a bare digit and directly follows a `v<number>` token belongs to that
   * version — which is how Doubao writes every version in its own slugs.
   */
  const words: string[] = []
  for (const part of body) {
    const previous = words[words.length - 1]
    if (/^\d+$/u.test(part) && previous !== undefined && /^v\d+$/iu.test(previous)) {
      words[words.length - 1] = `${previous}.${part}`
      continue
    }
    // `k3-1` is "K3.1": a bare digit after a token that ENDS in a digit is a minor version.
    if (/^\d+$/u.test(part) && previous !== undefined && /\d$/u.test(previous)) {
      words[words.length - 1] = `${previous}.${part}`
      continue
    }
    words.push(part)
  }
  const KNOWN: Readonly<Record<string, string>> = {
    kimi: 'Kimi',
    glm: 'GLM',
    deepseek: 'DeepSeek',
    qwen: 'Qwen',
    doubao: 'Doubao',
    pro: 'Pro',
    flash: 'Flash',
    highspeed: '高速',
    lite: 'Lite',
    turbo: 'Turbo',
    a: 'A',
    b: 'B',
  }
  return words
    .map(word => KNOWN[word.toLowerCase()] ?? (word.length <= 2 ? word.toUpperCase() : `${word.charAt(0).toUpperCase()}${word.slice(1)}`))
    .join(' ')
}

/** Scan one LevelDB directory for model entries. */
function scanDir(dir: string): DoubaoModelInfo[] {
  const found = new Map<string, DoubaoModelInfo>()
  let files: string[]
  try {
    files = readdirSync(dir)
  } catch {
    return []
  }
  for (const file of files) {
    // `.log` and `.ldb` carry the live records; `.sst` is older Chromium naming. The lock and
    // manifest files hold no values.
    if (!/\.(log|ldb|sst)$/iu.test(file)) continue
    let buf: Buffer
    try {
      buf = readFileSync(join(dir, file))
    } catch {
      continue
    }
    for (const model of parseCacheBuffer(buf)) {
      if (!found.has(model.id)) found.set(model.id, model)
    }
  }
  return [...found.values()]
}

/**
 * Every model the desktop client's cache knows, or an empty list.
 *
 * Never throws: a machine without the client, a cache mid-write, or a future format change all
 * mean "no extra models", which is a state the caller already handles.
 */
export function modelsFromClientCache(): DoubaoModelInfo[] {
  const out = new Map<string, DoubaoModelInfo>()
  for (const dir of cacheDirs()) {
    for (const model of scanDir(dir)) {
      if (!out.has(model.id)) out.set(model.id, model)
    }
  }
  return [...out.values()]
}

/** Whether the desktop client's cache is readable, for the card to explain a short list. */
export function clientCacheAvailable(): boolean {
  return cacheDirs().length > 0
}

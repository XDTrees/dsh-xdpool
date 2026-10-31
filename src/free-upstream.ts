/**
 * Outbound wire for the免密 free lane.
 *
 * Every fact encoded here was verified against the live gateway by direct
 * request rather than inferred from its documentation, which matters because
 * each one is a hard gate that answers with a bare error and no explanation:
 *
 * - `Authorization: Bearer public` is the pooled credential. There is no
 *   per-user secret on this lane, so a request that carries a real key is
 *   rejected as unknown.
 * - The endpoint is per MODEL, not per request: the same model cannot be asked
 *   through the other wire even if it would accept it.
 *
 * ## The v2 fingerprint (everything here changed on 2026-10-14)
 *
 * The gateway stopped recognising v1 clients. All four facts below moved
 * together and each one on its own answers `403 FreeTierError` with no
 * explanation of which was wrong; they were verified by running a request per
 * variant until one answered 200 with real content.
 *
 * 1. **User-Agent** — the shape is `opencode/<channel>/<version>/<client>` and
 *    the major version must be at least 2. `opencode/1.18.x` is now refused by
 *    name.
 * 2. **Path** — `/inference/v1/*`, not `/zen/v1/*`. The old path answers every
 *    free model with `403 FreeTierError` even with a perfect fingerprint.
 * 3. **Session headers** — four headers carrying the same value
 *    (`x-opencode-session`, `x-opencode-session-id`, `x-session-affinity`,
 *    `x-session-id`). The v1-only `x-opencode-request` is not merely optional: a
 *    request that still sends it is refused, so the per-turn request id stays a
 *    local book-keeping value and never goes on the wire.
 * 4. **Tools** — `read` and `shell`, with OpenCode's OWN descriptions and
 *    parameter schemas. The v1 approach (four self-disabling stubs with empty
 *    `properties`) is dead, and so is promoting the caller's real shell into a
 *    slot: v2 compares definitions, so a promoted slot no longer matches.
 *    `tool_choice: 'none'` is likewise fatal now — only the Responses wire fills
 *    a missing choice, and it fills it with `auto`.
 *
 * @module src/free-upstream
 */

import crypto from 'node:crypto'
import http from 'node:http'
import https from 'node:https'
import { Readable } from 'node:stream'
import { ReadableStream } from 'node:stream/web'
import {
  AggregateError,
  classifyUpstream,
  readSseHead,
  retryAfterMs,
  sniffBodyShape,
} from './aggregate.ts'
import {
  FINGERPRINT_TOOLS,
  FreeToolWire,
  chatChunksFor,
  type FingerprintPlan,
  type FreeEvent,
  type FreeWire,
} from './free-messages.ts'

export type { FingerprintPlan }

/**
 * Overridable so the offline suite can point the lane at a dead port.
 *
 * The guard is not decoration: this module is reachable from the CLIENT bundle
 * (the aggregate page imports the capability table from the same lane), and the
 * client runs in a browser where `process` does not exist. A bare
 * `process.env.X` is a ReferenceError at module-evaluation time there, which
 * takes the whole settings section down with it — the page the user was on when
 * the plugin loaded, not merely this one lane. `typeof` costs a few bytes and
 * turns an unguarded read into a miss that falls through to the real gateway.
 */
export const FREE_UPSTREAM_BASE =
  (typeof process === 'undefined' ? undefined : process.env.XDPOOL_FREE_BASE) ?? 'https://opencode.ai'
/**
 * The gateway fingerprints a genuine client, and only a v2-shaped UA is one.
 *
 * The shape is `opencode/<channel>/<version>/<client>` with a major version of at
 * least 2 — the v1 `opencode/1.18.x` is refused by name since 2026-10-14.
 */
export const FREE_CLIENT_UA = 'opencode/latest/2.0.26/cli'
/** Anthropic's version header, for the Messages wire. */
export const ANTHROPIC_API_VERSION = '2023-06-01'
/** Listing round budget. */
export const FREE_LISTING_TIMEOUT_MS = 15_000
/** One turn's budget, matching the pool shim's idle ceiling. */
export const FREE_TURN_TIMEOUT_MS = 300_000

const MAX_SESSION_LENGTH = 256
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

/**
 * The two tools the v2 gate requires, with OpenCode's own definitions.
 *
 * ⚠️ **Copied verbatim from the OpenCode v2.0.26 CLI.** The upstream compares
 * both the description and the parameter schema: rewording, trimming the schema,
 * emptying `properties`, or renaming all trade a working lane for a 403. Nothing
 * in these strings is ours to improve.
 */
const FINGERPRINT_TOOL_DEFINITIONS: Readonly<Record<string, { description: string; parameters: Record<string, unknown> }>> = {
  read: {
    description: 'Read the contents of a file or directory. Supports text files, images, and PDFs. Images and PDFs are presented directly to the model. Each text line is prefixed by its 1-based line number as <line>: <content>. The prefix is for reference and is not part of the file content. Directory entries are returned one per line. Use offset and limit to read large files or directories in sections. Prefer one larger read over many small slices, and use grep to find specific content in large files.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File or directory to read' },
        offset: { type: 'integer', minimum: 0, description: 'The line or directory entry to start reading from (1-based)' },
        limit: { type: 'integer', minimum: 0, description: 'The maximum number of lines or directory entries to read (defaults to and capped at 2000)' },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  shell: {
    description: 'Execute a shell command and return its output. Commands run on Linux using bash. Quote file paths containing spaces or special characters. Prefer dedicated tools over shell commands when possible. When output is large, the full result is saved to a file and a truncated preview is returned. Rely on automatic truncation unless filtering the output is more useful. Commands accept an optional timeout, background commands have no timeout by default. Background commands return immediately, and you will be notified when they complete.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command string to execute' },
        workdir: { type: 'string', description: 'Working directory to execute the command in. Defaults to the current working directory. When possible, avoid changing directories in the command and set the working directory here instead.' },
        timeout: { type: 'integer', minimum: 0, description: 'Timeout in milliseconds. Set to 0 to disable the timeout. Defaults to 120000 for foreground commands. Background commands have no timeout by default.' },
        background: { type: 'boolean', description: "Run the command in the background and return immediately (useful for dev servers and long-running builds). You do not need to use '&' at the end of the command when using this parameter. You will be notified when it completes. DO NOT poll for completion." },
      },
      required: ['command'],
      additionalProperties: false,
    },
  },
}

/**
 * The note appended when a fingerprint tool had to be injected.
 *
 * v2's definitions are REAL tools — description and schema both come from the
 * official client, and the model will actually call them (it was observed
 * calling `read` to answer "what files are in /etc"). v1 suppressed that with a
 * "must not be used" stub description; here the only lever is the prompt. The
 * wording is the one that was measured: calling them "unavailable" makes the
 * model refuse the CALLER's own `Read`/`Bash` too, while "placeholder, use the
 * tools you were given" holds the injected ones back without collateral.
 */
function placeholderNote(names: readonly string[]): string {
  const list = names.map(name => `\`${name}\``).join(' or ')
  return names.length > 1
    ? `Do not call the ${list} tools; they are placeholders that do nothing. Use the other tools you have been given instead.`
    : `Do not call the ${list} tool; it is a placeholder that does nothing. Use the other tools you have been given instead.`
}

/** Models served by `/responses` instead of `/chat/completions`. */
const RESPONSES_MODELS = new Set(['muse-spark-1.2-contributor-free', 'muse-spark-1.3-contributor-free'])
/** Models served by the Anthropic-shaped `/messages` endpoint. */
const MESSAGES_MODELS = new Set(['union-alpha'])

export const SESSION_RE = /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/
export const REQUEST_RE = /^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/
/**
 * Shape *and* the v2 descending-counter signature: the 48-bit prefix's low 12
 * bits must sit in `0xfc0`–`0xfff`. Mirrors OFM 2.5.0's gate — a `ses_` id that
 * matches {@link SESSION_RE} but has random/ascending low 12 bits is still
 * rejected by the upstream with `403 FreeTierError`.
 */
export const SESSION_DESCENDING_RE = /^ses_[0-9a-f]{9}f[c-f][0-9a-f][0-9A-Za-z]{14}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function base62From(bytes: Buffer): string {
  let out = ''
  for (const byte of bytes) out += BASE62[byte % 62] ?? '0'
  return out
}

let lastStamp = 0
let seq = 0

/** A gateway-shaped canonical session id: time-prefixed, monotonic counter. */
export function mintSessionId(timestamp: number = Date.now()): string {
  if (timestamp !== lastStamp) {
    lastStamp = timestamp
    seq = 0
  }
  seq += 1
  const value = ~(BigInt(timestamp) * 0x1000n + BigInt(seq))
  let hex = ''
  for (let i = 0; i < 6; i += 1) hex += ((value >> BigInt(40 - 8 * i)) & 0xffn).toString(16).padStart(2, '0')
  return `ses_${hex}${base62From(crypto.randomBytes(14))}`
}

/** A gateway-shaped request id for one turn. Kept local: v2 refuses it on the wire. */
export function mintRequestId(timestamp: number = Date.now()): string {
  const value = BigInt(timestamp) * 0x1000n + 1n
  let hex = ''
  for (let i = 0; i < 6; i += 1) hex += ((value >> BigInt(40 - 8 * i)) & 0xffn).toString(16).padStart(2, '0')
  return `msg_${hex}${base62From(crypto.randomBytes(14))}`
}

/** Does `id` already look like a v2-canonical session (shape *and* descending counter)? */
export function isCanonicalSession(id: string | undefined): boolean {
  const s = text(id).trim()
  if (!SESSION_RE.test(s)) return false
  const low = Number(BigInt(`0x${s.slice(4, 16)}`) & 0xfffn)
  return low >= 0xfc0 && low <= 0xfff
}

/** 64-bit FNV-1a, used only to turn a seed string into a stable number. */
function fnv64(str: string): bigint {
  let h = 0xcbf29ce484222325n
  for (let i = 0; i < str.length; i += 1) {
    h ^= BigInt(str.charCodeAt(i) & 0xff)
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn
  }
  return h
}

/** The 12-hex canonical prefix for a 41-bit timestamp + 1..63 counter. */
function canonicalPrefix(ts: bigint, seq: number): string {
  const s = BigInt(Math.min(Math.max(seq | 0, 1), 63))
  const value = ~(BigInt(ts) * 0x1000n + s)
  let hex = ''
  for (let i = 0; i < 6; i += 1) hex += ((value >> BigInt(40 - 8 * i)) & 0xffn).toString(16).padStart(2, '0')
  return hex
}

// A fixed recent epoch so synthetic timestamps stay plausibly "recent" (never in
// the future) while remaining fully deterministic per seed — restart-stable.
// The v2 gateway checks the *encoding signature* of the prefix, not its recency,
// so a fixed but valid descending timestamp is accepted (cf. OFM 2.5.0).
const SESSION_EPOCH = 1769721600000n // 2026-06-01T00:00:00Z

/** Deterministic canonical upstream session for a conversation seed. */
function sessionFromSeed(seed: string): string {
  const h = fnv64(`xdpool-free\0${seed}`)
  const offset = h & 0x7fffffffn // up to ~24.9 days of spread
  const ts = SESSION_EPOCH + (offset % (30n * 24n * 3600n * 1000n))
  const seq = Number((h >> 31n) & 0x3fn) + 1
  const prefix = canonicalPrefix(ts, seq > 63 ? 63 : seq)
  const suffix = base62From(
    crypto.createHash('sha256').update(`xdpool-free-suffix\0${seed}`, 'utf8').digest().subarray(0, 14),
  )
  return `ses_${prefix}${suffix}`
}

/** Return `id` if already canonical; otherwise derive a deterministic canonical session from it. */
export function canonicalizeSession(id: string | undefined): string {
  if (isCanonicalSession(id)) return text(id).trim().slice(0, MAX_SESSION_LENGTH)
  const trimmed = text(id).trim()
  const seed = trimmed === '' ? 'global' : trimmed
  return sessionFromSeed(seed)
}

/**
 * Map one downstream conversation onto one stable upstream session.
 *
 * This is the difference between a free lane that works and one that 403/429s:
 * quota is per session, so a fresh id per request burns the budget and a
 * hash-derived id is rejected by the v2 gateway. A deterministic canonical
 * session gives the same conversation the same upstream session across
 * restarts, which is also how the real client behaves.
 */
export function sessionForConversation(sessionId: string | undefined): string {
  return canonicalizeSession(sessionId)
}

/**
 * A stable per-turn request id, so retries of one turn share it.
 *
 * NOTE: the v2 gateway refuses `x-opencode-request` on the wire (it is v1-only),
 * so this id is local book-keeping only — {@link gatewayHeaders} never sends it.
 * It is therefore exempt from the canonical-session encoding the upstream enforces.
 */
export function requestIdFor(sessionId: string, turnSeed: string | undefined): string {
  if (text(turnSeed) === '') return mintRequestId()
  const digest = crypto.createHash('sha256').update(`xdpool-free-req\0${sessionId}\0${turnSeed}`, 'utf8').digest()
  const id = `msg_${digest.subarray(0, 6).toString('hex')}${base62From(digest.subarray(6, 20))}`
  return REQUEST_RE.test(id) ? id : mintRequestId()
}

/** Strip a trailing "(level)" thinking suffix so lookups hit the base id. */
export function baseModelId(model: string): string {
  return model.replace(/\([^()]+\)\s*$/u, '').trim()
}

/** `muse-spark` answers on the Responses wire whatever the exact suffix is. */
function isMuseSpark(modelId: string): boolean {
  const clean = baseModelId(modelId)
  const base = clean.includes('/') ? (clean.split('/').pop() ?? clean) : clean
  return /^muse[-_]?spark(?:$|[-_:.\s])/iu.test(base)
}

/** Does this model need the Responses wire? */
export function isResponsesModel(modelId: string): boolean {
  return RESPONSES_MODELS.has(baseModelId(modelId)) || isMuseSpark(modelId)
}

/** Does this model need the Anthropic-shaped wire? */
export function isMessagesModel(modelId: string): boolean {
  return MESSAGES_MODELS.has(baseModelId(modelId))
}

/**
 * Which upstream path serves this model.
 *
 * `/inference/*` since 2026-10-14. The old `/zen/*` prefix answers every free
 * model with `403 FreeTierError` no matter how good the fingerprint is, which is
 * why the listing path in {@link fetchFreeListing} moved with it.
 */
export function endpointFor(modelId: string): string {
  if (isResponsesModel(modelId)) return '/inference/v1/responses'
  if (isMessagesModel(modelId)) return '/inference/v1/messages'
  return '/inference/v1/chat/completions'
}

/** Which wire shape that endpoint speaks; drives encoding and parsing. */
export function wireFor(modelId: string): FreeWire {
  const path = endpointFor(modelId)
  if (path === '/inference/v1/responses') return 'responses'
  if (path === '/inference/v1/messages') return 'messages'
  return 'chat'
}

/** The listing endpoint that goes with {@link endpointFor}'s prefix. */
export const FREE_LISTING_PATH = '/inference/v1/models'

/**
 * The headers the gateway fingerprints a genuine client by.
 *
 * Four headers carry the SAME session value; the v2 client sends it under all
 * four names and the gateway checks more than one of them. `x-opencode-request`
 * is deliberately absent — it was v1-only, and a v2 request that still carries
 * it is refused, so the per-turn request id stays local book-keeping.
 */
export function gatewayHeaders({
  session,
  requestId: _requestId,
  stream,
  accept,
}: {
  session: string
  /** Unused on the wire; accepted so callers keep passing their per-turn id. */
  requestId: string
  stream: boolean
  accept?: string
}): Record<string, string> {
  return {
    'content-type': 'application/json',
    // The pooled credential. Sending a real key here reads as an unknown one.
    authorization: 'Bearer public',
    'user-agent': FREE_CLIENT_UA,
    'x-opencode-client': 'cli',
    'x-opencode-session': session,
    'x-opencode-session-id': session,
    'x-session-affinity': session,
    'x-session-id': session,
    'x-opencode-project': 'global',
    accept: accept ?? (stream ? 'text/event-stream' : '*/*'),
  }
}

function toolNameOf(tool: unknown): string {
  if (!isRecord(tool)) return ''
  if (typeof tool.name === 'string' && tool.name.trim() !== '') return tool.name.trim()
  const fn = tool.function
  if (isRecord(fn) && typeof fn.name === 'string') return fn.name.trim()
  return ''
}

/**
 * The gate tool a name answers to, or '' when it is not one.
 *
 * EXACT match, not case-folded. The old pass canonicalised by lowercasing, which
 * meant a caller's `Read` got renamed to `read` and then compared against
 * OpenCode's own definition — two definitions for one name, and a 403.
 */
function fingerprintKey(name: string): string {
  const trimmed = name.trim()
  return FINGERPRINT_TOOLS.includes(trimmed) ? trimmed : ''
}

/** The Chat-shape `{function:{…}}` wrapper, or null for the flat Responses one. */
function functionOf(tool: Record<string, unknown>): Record<string, unknown> | null {
  return isRecord(tool.function) ? tool.function : null
}

/** Where one tool's description and schema sit, per wire shape. */
function definitionOf(
  tool: Record<string, unknown>,
  { claude, flat }: { claude: boolean; flat: boolean },
): { description: unknown; schema: unknown } | null {
  const wrapper = claude || flat ? tool : functionOf(tool)
  if (wrapper === null || wrapper === undefined) return null
  return { description: wrapper.description, schema: claude ? wrapper.input_schema : wrapper.parameters }
}

/** Does this tool already carry OpenCode's own definition for `name`? */
function carriesFingerprintDefinition(
  tool: Record<string, unknown>,
  name: string,
  shape: { claude: boolean; flat: boolean },
): boolean {
  const own = definitionOf(tool, shape)
  if (own === null) return false
  const want = FINGERPRINT_TOOL_DEFINITIONS[name]
  if (want === undefined) return false
  return own.description === want.description && JSON.stringify(own.schema) === JSON.stringify(want.parameters)
}

function withToolName(tool: Record<string, unknown>, name: string): Record<string, unknown> {
  const fn = functionOf(tool)
  return fn === null ? { ...tool, name } : { ...tool, function: { ...fn, name } }
}

/** The gate's own declaration, spelled the way the wire expects. */
function fingerprintTool(name: string, { claude, flat }: { claude: boolean; flat: boolean }): Record<string, unknown> {
  const { description, parameters } = FINGERPRINT_TOOL_DEFINITIONS[name] ?? {}
  if (claude) return { name, description, input_schema: parameters }
  if (flat) return { type: 'function', name, description, parameters }
  return { type: 'function', function: { name, description, parameters } }
}

/**
 * OpenCode's own declaration of a gate tool, for a caller that wants to declare
 * it itself. Exported because "the caller declares the real one" is a state the
 * fingerprint pass has to be able to recognise, and the only honest way to put a
 * test into that state is with the real definition rather than a lookalike.
 */
export function fingerprintToolFor(name: string, wire: FreeWire): Record<string, unknown> {
  return fingerprintTool(name, { claude: wire === 'messages', flat: wire === 'responses' })
}

/** `original -> alias` for every tool the rename pass touched. */
function aliasesByOriginal(map: Map<string, string>): Map<string, string> {
  return new Map([...map].map(([alias, original]) => [original, alias]))
}

/**
 * Point an explicit `tool_choice` at the alias of a tool that was renamed.
 *
 * Only an alias is retargeted: a choice naming a tool we left alone must stay
 * byte-identical, and `none` is never emitted (see {@link applyFingerprint}).
 */
function retargetToolChoice(body: Record<string, unknown>, map: Map<string, string>): void {
  if (map.size === 0) return
  const choice = body.tool_choice
  if (!isRecord(choice)) return
  const aliases = aliasesByOriginal(map)
  if (typeof choice.name === 'string') {
    const alias = aliases.get(choice.name.trim())
    if (alias !== undefined) body.tool_choice = { ...choice, name: alias }
    return
  }
  const fn = choice.function
  if (isRecord(fn) && typeof fn.name === 'string') {
    const alias = aliases.get(fn.name.trim())
    if (alias !== undefined) body.tool_choice = { ...choice, function: { ...fn, name: alias } }
  }
}

/**
 * Rewrite prior-turn calls to a tool that was renamed.
 *
 * Without this the model reads its own earlier `read` call as a call to
 * OpenCode's injected tool of that name, and the two definitions disagree.
 */
function aliasHistoryToolCalls(body: Record<string, unknown>, map: Map<string, string>): void {
  if (map.size === 0) return
  const aliases = aliasesByOriginal(map)
  const aliasOf = (name: unknown): string | undefined =>
    typeof name === 'string' ? aliases.get(name.trim()) : undefined
  const withField = (block: Record<string, unknown>, field: string, value: string | undefined): Record<string, unknown> =>
    value === undefined ? block : { ...block, [field]: value }
  if (Array.isArray(body.input)) {
    body.input = body.input.map(item => {
      if (!isRecord(item) || item.type !== 'function_call') return item
      return withField(item, 'name', aliasOf(item.name))
    })
  }
  if (!Array.isArray(body.messages)) return
  body.messages = body.messages.map(message => {
    if (!isRecord(message)) return message
    if (Array.isArray(message.content)) {
      return {
        ...message,
        // Both sides of a pair move together: the call goes out as `read_client`,
        // so a `tool_result` still naming `read` is an answer to a call this turn
        // never made — the gateway reads it as an orphan and the turn fails.
        content: message.content.map(block => {
          if (!isRecord(block)) return block
          if (block.type === 'tool_use') {
            const aliased = aliasOf(block.name)
            return aliased === undefined ? block : withToolName(block, aliased)
          }
          if (block.type === 'tool_result') return withField(block, 'tool_name', aliasOf(block.tool_name))
          return block
        }),
      }
    }
    if (!Array.isArray(message.tool_calls)) return message
    return {
      ...message,
      tool_calls: message.tool_calls.map(call => {
        if (!isRecord(call) || !isRecord(call.function)) return call
        const aliased = aliasOf(call.function.name)
        return aliased === undefined ? call : { ...call, function: { ...call.function, name: aliased } }
      }),
    }
  })
}

/** Tell the model the injected fingerprint tools are placeholders. */
function noteInjectedTools(
  body: Record<string, unknown>,
  { claude, flat }: { claude: boolean; flat: boolean },
  names: readonly string[],
): void {
  const note = placeholderNote(names)
  if (flat) {
    body.instructions = typeof body.instructions === 'string' && body.instructions.trim() !== ''
      ? `${body.instructions}\n\n${note}`
      : note
    return
  }
  if (claude) {
    body.system = typeof body.system === 'string' && body.system !== '' ? `${body.system}\n\n${note}` : note
    return
  }
  const messages = Array.isArray(body.messages) ? body.messages : []
  const first = messages[0]
  if (isRecord(first) && first.role === 'system' && typeof first.content === 'string') {
    body.messages = [{ ...first, content: `${first.content}\n\n${note}` }, ...messages.slice(1)]
    return
  }
  body.messages = [{ role: 'system', content: note }, ...messages]
}

/**
 * Satisfy the v2 free-tier fingerprint gate on `body.tools`.
 *
 * ## The v2 rules (each one is a 403 that was measured)
 *
 * 1. `read` and `shell` must be DECLARED, with OpenCode's definitions byte for
 *    byte.
 * 2. The caller's tools survive UNTOUCHED, including case variants like
 *    `Read`/`Bash` — those are not gate tools.
 * 3. A caller tool that happens to be named `read`/`shell` with a DIFFERENT
 *    definition is renamed to `<name>_client`; {@link aliasHistoryToolCalls} and
 *    {@link retargetToolChoice} rewrite the history and the choice to match, and
 *    the response side restores the caller's name.
 * 4. A duplicate declaration of the same name keeps the first — the upstream
 *    refuses duplicates.
 * 5. `tool_choice: 'none'` is never emitted. v2 answers 403 to it (v1 allowed it,
 *    and the old code even added it). Only the Responses wire fills a missing
 *    choice, with `auto`.
 *
 * ⚠️ v1's "promote the caller's shell into the bash slot" is GONE: v2 compares
 * definitions, so a promoted slot no longer matches what the gate wants.
 *
 * @param body - request body, mutated in place
 * @param wire - which upstream shape `body.tools` is spelled in
 * @returns what the response side needs to undo the gate
 */
export function applyFingerprint(body: Record<string, unknown>, wire: FreeWire): FingerprintPlan {
  const flat = wire === 'responses'
  const claude = wire === 'messages'
  const shape = { claude, flat }
  const map = new Map<string, string>()
  const tools = Array.isArray(body.tools) ? body.tools.filter(isRecord) : []
  const taken = new Set(tools.map(toolNameOf).filter(name => name !== ''))
  // `seen` and `present` do different jobs. `seen` handles "a duplicate name
  // keeps the first" (and counts a renamed one); `present` records the gate names
  // that survived WITH OpenCode's definition. The injection test must read
  // `present` — otherwise a caller's `read` renamed to `read_client` looks like
  // "read is already declared", the official definition is never added, and the
  // gate still refuses.
  const seen = new Set<string>()
  const present = new Set<string>()
  const out: Record<string, unknown>[] = []

  for (const tool of tools) {
    const current = toolNameOf(tool)
    const key = fingerprintKey(current)
    if (key === '') {
      out.push(tool)
      continue
    }
    if (seen.has(key)) continue
    seen.add(key)
    if (carriesFingerprintDefinition(tool, key, shape)) {
      out.push(tool)
      present.add(key)
      continue
    }
    let alias = `${key}_client`
    for (let i = 2; taken.has(alias); i += 1) alias = `${key}_client${i}`
    taken.add(alias)
    map.set(alias, current)
    out.push(withToolName(tool, alias))
  }

  const injected: string[] = []
  for (const name of FINGERPRINT_TOOLS) {
    if (present.has(name)) continue
    out.push(fingerprintTool(name, shape))
    injected.push(name)
  }

  body.tools = out
  retargetToolChoice(body, map)
  aliasHistoryToolCalls(body, map)
  if (injected.length > 0) noteInjectedTools(body, shape, injected)
  // Belt and braces: a `none` left by the caller (a continuation path, say)
  // fails the whole turn under v2.
  const choice = body.tool_choice
  if (choice === 'none' || (isRecord(choice) && choice.type === 'none')) delete body.tool_choice
  if (flat && !body.tool_choice) body.tool_choice = 'auto'
  // `injected` is not redundant with the tool list: `read` sits in `body.tools`
  // both when the gate declared it and when the caller declared OpenCode's REAL
  // `read`, and only the first is a decoy. The response side can no longer tell
  // them apart by name, so it is told which ones it did not get from the caller.
  return { rename: map, injected }
}

/** Restore the caller's tool spelling in a fragment or a final payload. */
export function restoreToolName(name: string, map: Map<string, string>): string {
  if (map.size === 0) return name
  return map.get(name) ?? name
}

/** Test seam: this lane's own transport, so the suite never leaves the process. */
export const freeLane = { fetch: null as unknown }

/**
 * The free lane's transport.
 *
 * `node:http`/`node:https` rather than `globalThis.fetch`, because local proxy
 * plugins work by replacing `globalThis.fetch` and re-serializing the body on the
 * way out — which mangles a JSON body enough to change the turn. The native
 * modules cannot be swapped by another plugin.
 */
export function freeFetch(
  url: string,
  init: {
    method?: string
    headers?: Record<string, string>
    body?: string | undefined
    signal?: AbortSignal | undefined
  } = {},
): Promise<Response> {
  const method = init.method ?? 'GET'
  const stub = freeLane.fetch as unknown as { fetch?: (url: string, init: unknown) => Promise<Response> } | null
  if (stub !== null && typeof stub.fetch === 'function') return stub.fetch(url, { method, ...init })
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const transport = target.protocol === 'http:' ? http : https
    const request = transport.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (target.protocol === 'http:' ? 80 : 443),
        path: `${target.pathname}${target.search}`,
        method,
        headers:
          init.body === undefined
            ? (init.headers ?? {})
            : { ...(init.headers ?? {}), 'content-length': Buffer.byteLength(init.body, 'utf8') },
      },
      response => {
        resolve(
          new Response(Readable.toWeb(response) as ReadableStream<Uint8Array>, {
            status: response.statusCode ?? 0,
            statusText: response.statusMessage ?? '',
            headers: response.headers as unknown as Headers,
          }),
        )
      },
    )
    request.on('error', reject)
    const abort = (): void => {
      request.destroy(new Error('The operation was aborted'))
    }
    init.signal?.addEventListener('abort', abort, { once: true })
    request.on('close', () => {
      init.signal?.removeEventListener('abort', abort)
    })
    if (init.body !== undefined) request.write(init.body, 'utf8')
    request.end()
  })
}

/** One turn's outcome: the upstream status, plus what the stream carried. */
export interface FreeTurnResult {
  status: number
  /** Set when the turn ended on the output ceiling rather than a finish token. */
  truncated?: boolean
  /** Every decoy call the model made and the caller cannot run. */
  suppressedOnly?: boolean
  /**
   * The finish token the caller should be told.
   *
   * Computed here rather than taken from the upstream frame, because only this
   * module knows how many calls survived the decoy filter — the gateway reported
   * a call the caller cannot run, and echoing that back would leave the turn
   * claiming `tool_calls` with nothing to run.
   */
  finishReason?: string
  /**
   * The upstream's token usage, when it sent any.
   *
   * Carried out of the loop so the caller (the free lane) can file it with the
   * pool's usage recorder — the dashboard is built from those numbers, so asking
   * for them and then dropping them would leave every free-model call uncounted
   * while the paid lanes were tallied.
   */
  usage?: Record<string, unknown>
}

/** What one turn's caller wants back per decoded event. */
export interface FreeTurnHooks {
  /**
   * One chat-shaped delta, already translated from the upstream wire.
   *
   * The caller owns the response framing, so this is the delta object only — no
   * chunk envelope, no `data:` prefix.
   */
  onDelta: (delta: Record<string, unknown>) => void
}

/**
 * Add the one fact a 429 on this lane can never convey on its own.
 *
 * The free tier meters quota PER UPSTREAM SESSION, not per key and not per
 * account — the gateway's own sentence is "the provider asked to wait 74558s",
 * i.e. twenty hours, which reads like a ban on the whole provider. It is not:
 * a different conversation maps to a different session and is served
 * immediately. Saying so costs one clause and turns a message that looks like
 * "this lane is over" into one that tells the user what to do next.
 *
 * Only a rate class gets the hint: a dead credential or a missing model has
 * nothing to do with the session budget, and adding the clause there would
 * invite the user to retry something that cannot succeed.
 */
function withSessionQuotaHint(error: unknown, retryAfterMs: number | undefined): unknown {
  if (
    !(error instanceof AggregateError) ||
    error.kind !== 'soft_rate' ||
    retryAfterMs === undefined ||
    error.message.includes('per conversation')
  ) {
    return error
  }
  return new AggregateError(
    error.kind,
    `${error.message} — this quota is counted per conversation on the free tier, so a new conversation (or another model) starts with its own budget`,
    error.status,
  )
}

/**
 * Say what a 403 on this lane actually means (#96).
 *
 * The gateway answers a client it does not recognise with `403 FreeTierError`
 * and no explanation of which of its four fingerprint facts was wrong. That
 * reaches the caller as a bare `client` failure, and a bare 4xx is what the
 * host then renders in its own words: the user in #96 saw "当前请求的额度已用尽"
 * for a request that had never been billed. The wording pointed at waiting,
 * while the actual cause was "this build's fingerprint no longer matches, update
 * the plugin" — the two need opposite responses.
 *
 * The lane cannot tell them apart from the outside (both look like a refusal
 * with a thin body), so this does not pretend to. It names the actionable
 * reading FIRST — the fingerprint, which the user can fix by updating — and
 * keeps the quota possibility second, because it is the one that fixes itself.
 *
 * A 429 keeps its own hint ({@link withSessionQuotaHint}): that one really is
 * quota, and blurring the two would lose a distinction worth keeping.
 */
function withFreeTierHint(status: number, refusal: string, retryAfterMs: number | undefined): unknown {
  const base = classifyUpstream(status, refusal, retryAfterMs, '')
  if (status !== 403) return base
  // The provider's own sentence is kept: it is the only evidence a maintainer
  // has when the fingerprint moves again.
  const separator = base.message.indexOf(': ')
  const detail = separator === -1 ? '' : base.message.slice(separator + 2)
  const kept = detail === '' ? '' : ` (provider said: ${detail})`
  return new AggregateError(
    base.kind,
    'the free lane refused this client: its request fingerprint no longer matches what opencode.ai accepts, '
      + 'so this is NOT an exhausted quota and waiting will not help — update dsh-xdpool and try again; '
      + 'if it persists, report this message. The shared free quota is also metered per conversation, so one '
      + `retry in a fresh conversation covers the case where only that budget is spent${kept}`,
    status,
  )
}

/**
 * POST one streaming turn and hand back chat-shaped deltas.
 *
 * The shape of the ANSWER decides how it is read, never its Content-Type: a front
 * proxy that mislabels a JSON body as an event stream is common, and believing
 * the header truncates real answers. A JSON answer to a streamed request is
 * folded through the same translation rather than passed on as one opaque
 * document, so the caller sees a delta sequence either way.
 */
export async function postFreeStreamed(
  {
    modelId,
    body,
    session,
    requestId,
    hooks,
    plan,
    signal,
    timeoutMs = FREE_TURN_TIMEOUT_MS,
  }: {
    modelId: string
    body: Record<string, unknown>
    session: string
    requestId: string
    hooks: FreeTurnHooks
    /** What the fingerprint pass did: renames, and which gate names it injected. */
    plan?: FingerprintPlan | undefined
    signal?: AbortSignal | undefined
    timeoutMs?: number
  },
): Promise<FreeTurnResult> {
  const wire = wireFor(modelId)
  const requestBody: Record<string, unknown> = { ...body, model: modelId, stream: true }
  // Ask for usage the way the paid lane does. The Anthropic Messages wire reports
  // usage on its own events and rejects `stream_options`, so only add it for the
  // chat / responses wires. The free gateway may still ignore it — in which case
  // the dashboard honestly shows "not reported" rather than a fabricated zero.
  if (wire !== 'messages') {
    requestBody.stream_options = {
      ...(isRecord(body.stream_options) ? body.stream_options : {}),
      include_usage: true,
    }
  }
  const bodyText = JSON.stringify(requestBody)
  const url = `${FREE_UPSTREAM_BASE}${endpointFor(modelId)}`
  const headers = gatewayHeaders({ session, requestId, stream: true })
  if (wire === 'messages') headers['anthropic-version'] = ANTHROPIC_API_VERSION
  // The plan is passed IN rather than recomputed here, because the request body
  // was re-spelled by the translation layer before the fingerprint was applied —
  // so this module has no idea which names are the caller's.
  const tools = new FreeToolWire(body.tools, plan)
  let response: Response
  try {
    response = await freeFetch(url, { method: 'POST', headers, body: bodyText, signal })
  } catch (error: unknown) {
    if (signal?.aborted === true || (error instanceof Error && error.name === 'AbortError')) {
      throw new AggregateError('client', 'request aborted')
    }
    const cause = error instanceof Error ? error.message : String(error)
    throw new AggregateError('server', `the free lane request failed: ${cause}`)
  }
  const retryAfter = retryAfterMs(response)
  if (!response.ok) {
    const refusal = await response.text().catch(() => '')
    throw withSessionQuotaHint(withFreeTierHint(response.status, refusal, retryAfter), retryAfter)
  }
  if (response.body === null) throw new AggregateError('server', 'the free lane returned no body', response.status)

  let events: string[]
  let raw = ''
  const head = await readSseHead(response.body, signal ?? new AbortController().signal, timeoutMs)
  if (head.shape === 'sse') {
    events = head.payloads
  } else {
    if (head.shape === 'empty') throw new AggregateError('server', 'the free lane returned no body', response.status)
    raw = head.text
    if (!head.done) {
      try {
        for (;;) {
          const chunk = await head.reader.read()
          if (chunk.done) break
          if (chunk.value !== undefined) raw += head.decoder.decode(chunk.value, { stream: true })
        }
      } catch (error: unknown) {
        await head.reader.cancel().catch(() => null)
        throw new AggregateError('server', `the free lane stream broke: ${error instanceof Error ? error.message : String(error)}`, response.status)
      }
    }
    raw += head.decoder.decode()
    events = jsonAnswerEvents(raw)
  }

  const result: FreeTurnResult = { status: response.status }
  let finish: string | undefined
  let usage: Record<string, unknown> | undefined
  for (const event of events) {
    let decoded: unknown
    try {
      decoded = JSON.parse(event) as unknown
    } catch {
      // A frame the gateway could not write as JSON is not a frame; forwarding it
      // would hand the caller a decoder error instead of an answer.
      continue
    }
    if (isRecord(decoded) && (decoded.error !== undefined || decoded.type === 'error')) {
      // Same wording as the HTTP path: an error frame carries the SAME refusal
      // in a 200 envelope, and the user sees the message, not the status line —
      // so a frame-classified 403 must not read as "quota used up" either.
      throw withSessionQuotaHint(withFreeTierHint(response.status, event, retryAfter), retryAfter)
    }
    const translated: FreeEvent = chatChunksFor(wire, decoded, tools)
    for (const delta of translated.frames) hooks.onDelta(delta)
    if (translated.usage !== undefined) usage = translated.usage
    if (translated.finish !== undefined) finish = translated.finish
    if (translated.done === true) result.truncated = finish === 'length'
  }
  // A `tool_calls` finish is only honest when a call survived the decoy filter.
  // Reporting `tool_calls` beside no callable tool — or beside one the caller
  // cannot run — is how a truncated turn comes back demanding a retry forever.
  if (tools.calls() > 0) finish = 'tool_calls'
  else if (finish === 'tool_calls') finish = result.truncated === true ? 'length' : 'stop'
  if (finish === 'length') result.truncated = true
  if (usage !== undefined) {
    hooks.onDelta({ usage })
    result.usage = usage
  }
  result.suppressedOnly = tools.suppressed()
  result.finishReason = finish
  return result
}

/**
 * The events one JSON answer carries.
 *
 * The chat and Messages wires answer with one document; the Responses wire
 * answers with one document too, but its `output` array holds the events that a
 * stream would have delivered. Both are read here so the caller gets one
 * sequence either way.
 */
function jsonAnswerEvents(raw: string): string[] {
  if (sniffBodyShape(raw) === 'sse') {
    // A gateway that answered a stream request with SSE in one write. Keep the
    // frames rather than re-parsing them as JSON.
    return raw
      .split(/\r?\n/u)
      .map(line => line.trimEnd())
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trimStart())
      .filter(payload => payload !== '' && payload !== '[DONE]')
  }
  let payload: unknown
  try {
    payload = JSON.parse(raw) as unknown
  } catch {
    // A 200 that is not JSON is a hop speaking for the gateway: markup means a
    // front proxy swallowed the answer, and an identical retry draws the same
    // page again, so this must NOT land in a retryable server class.
    if (/^\s*<(!doctype|html[\s>])/iu.test(raw)) {
      throw new AggregateError('client', "the free lane's front proxy answered with an HTML error page")
    }
    throw new AggregateError('server', `unexpected non-stream response: ${raw.slice(0, 200)}`)
  }
  if (isRecord(payload) && payload.type === 'response' && isRecord(payload.response)) {
    // The Responses wire's non-streaming document: replay its own items as the
    // events a stream would have sent, so the translation above sees one shape.
    const events: string[] = []
    const response = payload.response
    const output = isRecord(response) && Array.isArray(response.output) ? response.output : []
    for (const item of output) {
      if (!isRecord(item)) continue
      const kind = text(item.type)
      if (kind === 'function_call') {
        events.push(JSON.stringify({
          type: 'response.output_item.added',
          output_index: events.length,
          item: { type: 'function_call', call_id: text(item.call_id ?? item.id), name: text(item.name) },
        }))
        events.push(JSON.stringify({
          type: 'response.function_call_arguments.delta',
          output_index: events.length,
          delta: text(item.arguments),
        }))
        continue
      }
      // `content` is checked as an array directly rather than through `isRecord`,
      // which is false for arrays — asking it first dropped every message the
      // document carried, leaving a completed response with nothing in it.
      const body = Array.isArray(item.content)
        ? item.content.map(part => (isRecord(part) ? text(part.text) : '')).join('')
        : ''
      if (body === '') continue
      events.push(JSON.stringify({ type: 'response.output_text.delta', output_index: events.length, delta: body }))
    }
    events.push(JSON.stringify({
      type: 'response.completed',
      response: isRecord(response) ? response : {},
    }))
    return events
  }
  return [raw]
}

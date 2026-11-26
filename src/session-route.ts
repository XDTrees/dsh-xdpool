/**
 * 「这个会话现在是走哪家、用哪个号」——一张会话 id 到归属的小表。
 *
 * WHY THIS IS A SEPARATE MODULE
 *
 * The usage ledger (`stats.ts`) already records which channel and which account
 * served every physical call. It cannot answer this question, for a reason that
 * is structural rather than a bug: it files calls under a `turnId` minted per
 * request, and it keeps a bounded ring of samples that a busy session flushes
 * out. "Which account is this conversation on" is a question about the CURRENT
 * state of one conversation, not about the last 2000 calls.
 *
 * The identity that makes it answerable exists: `GenerateOptions.sessionId` is
 * the DSH Session id, and pi-ai turns it into session-affinity headers on the
 * wire. So a lane that receives a request can say, at the moment it serves it,
 * "session X is on channel C, account A". This module holds exactly that fact
 * and nothing else.
 *
 * WHAT IT DELIBERATELY DOES NOT HOLD
 *
 * No prompts, no message text, no token counts. A conversation id mapped to a
 * vendor and an account label is what the reader asked for; copying the rest
 * would turn a status readout into a second copy of the transcript.
 *
 * BOUNDED ON PURPOSE
 *
 * One entry per live conversation is small, but sessions accumulate. The map is
 * an LRU with a fixed ceiling, so a long-running host cannot grow it without
 * limit. An evicted session simply reads as "unknown" until its next call
 * repopulates it, which is the honest state rather than a stale guess.
 *
 * @module dsh-xdpool/session-route
 */

/** One conversation's current归属, as the serving lane last saw it. */
export interface SessionRoute {
  /** The DSH Session id this describes. */
  sessionId: string
  /**
   * The channel that served it.
   *
   * `workbuddy` for the pooled WorkBuddy lanes, `free` for the keyless lane, or
   * a provider / channel id (a third-party vendor or a sign-in channel).
   */
  channel: string
  /** Gateway region for the pooled lanes: `cn`, `global`, or empty elsewhere. */
  region: string
  /** The model id the last call asked for. */
  model: string
  /**
   * Display label of the account that served it, or `''` when the lane cannot
   * name one.
   *
   * Empty is a real answer, not a missing one: a sign-in channel's account is
   * chosen inside the host's adapter, which does not report it back, so the
   * honest value is "the channel picked one of its own". Inventing a label
   * would put a name on screen that nobody verified.
   */
  account: string
  /** When this route was last confirmed by an answered call, in epoch ms. */
  at: number
}

/**
 * Header names a DSH session id may arrive under.
 *
 * pi-ai writes these itself when `compat.sendSessionAffinityHeaders` is on —
 * `x-session-affinity` and `x-client-request-id` for the `openai` format,
 * `session_id` as well. Reading several is not defensive coding: which one
 * appears depends on the pi-ai generation the host bundles, and a single-name
 * reader would silently report "unknown" on the other line.
 */
export const SESSION_HEADER_NAMES = [
  'x-session-affinity',
  'x-client-request-id',
  'session_id',
] as const

/** Ceiling on retained conversations. A dashboard, not an archive. */
export const SESSION_ROUTE_LIMIT = 200

/**
 * Longest session id that is still treated as one.
 *
 * A DSH session id is a UUID-length string. The cap exists because this value
 * arrives in a request header: without it, anything on the machine that can
 * reach the loopback shim could fill the map with megabyte keys.
 */
const SESSION_ID_MAX_LENGTH = 200

/** A session id shaped like an id, or undefined. */
export function normalizeSessionId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed === '' || trimmed.length > SESSION_ID_MAX_LENGTH) return undefined
  // Ids are printable and contain no whitespace; anything else is not one, and
  // letting it through would put arbitrary bytes on a panel.
  return /^[\x21-\x7e]+$/u.test(trimmed) ? trimmed : undefined
}

/**
 * Read the session id from request headers, first match wins.
 *
 * Accepts a plain header bag rather than a `Headers` instance so the shim can
 * pass `req.headers` straight through, and a test can pass an object literal.
 */
export function sessionIdFromHeaders(
  headers: Readonly<Record<string, string | string[] | undefined>> | undefined,
): string | undefined {
  if (headers === undefined) return undefined
  for (const name of SESSION_HEADER_NAMES) {
    const raw = headers[name] ?? headers[name.toLowerCase()]
    const value = Array.isArray(raw) ? raw[0] : raw
    const normalized = normalizeSessionId(value)
    if (normalized !== undefined) return normalized
  }
  return undefined
}

/**
 * A bounded, most-recent-wins map of conversation → serving route.
 *
 * Reads are cheap and synchronous because the HTTP route that serves the panel
 * is answering a poll that runs while a turn streams; an async read here would
 * make the panel lag the call it is describing.
 */
export class SessionRouteBook {
  private readonly routes = new Map<string, SessionRoute>()
  private readonly limit: number

  constructor(limit: number = SESSION_ROUTE_LIMIT) {
    this.limit = limit > 0 ? limit : 1
  }

  /**
   * Remember which route served one session.
   *
   * Re-inserting also refreshes LRU position: a conversation that just spoke is
   * the one most likely to be read next.
   */
  record(route: SessionRoute): void {
    const sessionId = normalizeSessionId(route.sessionId)
    if (sessionId === undefined) return
    this.routes.delete(sessionId)
    this.routes.set(sessionId, { ...route, sessionId })
    while (this.routes.size > this.limit) {
      const oldest = this.routes.keys().next().value
      if (oldest === undefined) break
      this.routes.delete(oldest)
    }
  }

  /** The current route for one conversation, or undefined when unknown. */
  of(sessionId: string | undefined): SessionRoute | undefined {
    const normalized = normalizeSessionId(sessionId)
    return normalized === undefined ? undefined : this.routes.get(normalized)
  }

  /** Every retained route, most recently confirmed last. */
  list(): readonly SessionRoute[] {
    return [...this.routes.values()]
  }

  /** Conversations currently retained. */
  size(): number {
    return this.routes.size
  }

  /** Forget everything. Used by reset paths and by tests. */
  clear(): void {
    this.routes.clear()
  }
}

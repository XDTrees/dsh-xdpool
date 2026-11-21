/**
 * Turn a failed response body into a sentence.
 *
 * Every channel did `text.slice(0, 300)` and threw it, so a user saw the vendor's raw JSON:
 * `{"error":{"message":"No valid authentication credentials were provided (request_id: …)"}}`.
 * Three hundred characters of JSON in a card is not an error message — the useful part is one
 * field, and the noisy part is the rest.
 *
 * These extract the message when the body is one of the shapes the vendors actually use, and
 * fall back to the trimmed text otherwise. Nothing is invented: a body with no recognisable
 * message is shown as it came.
 *
 * @module dsh-xdpool/error-body
 */

/** The field names that carry a human message, in the order they are tried. */
const MESSAGE_KEYS = ['message', 'msg', 'error_description', 'detail', 'reason'] as const

/** Recursively look for a message field. */
function dig(value: unknown, depth = 0): string | undefined {
  if (depth > 3 || value === null) return undefined
  if (typeof value === 'string') return value.trim() === '' ? undefined : value.trim()
  if (typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  // A `message` at this level wins over anything nested.
  for (const key of MESSAGE_KEYS) {
    const found = record[key]
    if (typeof found === 'string' && found.trim() !== '') return found.trim()
  }
  // `{"error": {...}}` and `{"error": "..."}` are both common.
  for (const key of ['error', 'errors', 'data', 'response']) {
    if (key in record) {
      const nested = dig(record[key], depth + 1)
      if (nested !== undefined) return nested
    }
  }
  return undefined
}

/**
 * The readable part of a failed body.
 *
 * A JSON body is parsed and its message extracted; anything else is trimmed. The result is
 * capped so a stray HTML page cannot fill the card.
 */
export function messageFromBody(text: string, limit = 200): string {
  const trimmed = text.trim()
  if (trimmed === '') return ''
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown
      const message = dig(parsed)
      /**
       * A JSON body with no message is "nothing to say", not "show the JSON".
       *
       * `{}` and `{"code":500}` carry no sentence, and showing the braces is noise — the
       * caller's status fallback is the honest answer.
       */
      return message === undefined ? '' : message.slice(0, limit)
    } catch {
      // Not JSON after all; fall through to the text.
    }
  }
  // An HTML error page: strip the tags rather than showing markup.
  if (trimmed.startsWith('<')) {
    const withoutTags = trimmed.replace(/<[^>]*>/gu, ' ').replace(/\s+/gu, ' ').trim()
    return (withoutTags === '' ? '上游返回了一个网页而不是数据' : withoutTags).slice(0, limit)
  }
  return trimmed.slice(0, limit)
}

/**
 * The sentence to throw for a failed response.
 *
 * Keeps the status when the body says nothing usable, because a bare `HTTP 502` still tells the
 * reader more than an empty string does.
 */
export function failureMessage(status: number, text: string): string {
  const message = messageFromBody(text)
  return message === '' ? `HTTP ${String(status)}` : message
}

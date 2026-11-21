import { describe, expect, it } from 'vitest'
import { failureMessage, messageFromBody } from '../src/error-body.ts'

/**
 * Turning a failed body into a sentence.
 *
 * Every channel used to throw `text.slice(0, 300)` — three hundred characters of the vendor's
 * raw JSON in a card, where the useful part is one field. A user reads
 * `{"error":{"message":"No valid authentication credentials were provided (request_id: …)"}}`
 * and has to find the sentence inside it themselves.
 */
describe('the shapes the vendors actually send', () => {
  it('reads the OpenAI-style nested error', () => {
    // `{"error":{"message":"…"}}` — Qiniu, and most OpenAI-compatible gateways.
    expect(messageFromBody('{"error":{"message":"No valid authentication credentials were provided"}}'))
      .toBe('No valid authentication credentials were provided')
  })

  it('reads a flat message', () => {
    expect(messageFromBody('{"message":"auth_token 不存在"}')).toBe('auth_token 不存在')
  })

  it('reads a flat error string', () => {
    expect(messageFromBody('{"error":"Invalid token"}')).toBe('Invalid token')
  })

  it('reads the msg spelling', () => {
    // Several Chinese vendors use `msg` rather than `message`.
    expect(messageFromBody('{"msg":"请求过于频繁"}')).toBe('请求过于频繁')
  })

  it('prefers a message at the top level over one nested deeper', () => {
    // The outermost sentence describes the request the caller made.
    expect(messageFromBody('{"message":"outer","data":{"message":"inner"}}')).toBe('outer')
  })
})

describe('the shapes that are not JSON', () => {
  it('passes plain text through, trimmed', () => {
    expect(messageFromBody('  something went wrong  ')).toBe('something went wrong')
  })

  it('strips the tags from an HTML error page', () => {
    /**
     * A gateway in front of the API answers with a page, and markup in a card is unreadable.
     */
    const message = messageFromBody('<html><body><h1>502 Bad Gateway</h1></body></html>')
    expect(message).toContain('502 Bad Gateway')
    expect(message).not.toContain('<')
  })

  it('says so when a page has no text at all', () => {
    expect(messageFromBody('<html><body></body></html>')).toContain('网页')
  })

  it('answers empty for an empty body', () => {
    expect(messageFromBody('')).toBe('')
    expect(messageFromBody('   ')).toBe('')
  })

  it('caps the length', () => {
    // A stray document must not fill the card.
    expect(messageFromBody('a'.repeat(5_000)).length).toBeLessThanOrEqual(200)
  })
})

describe('the sentence thrown', () => {
  it('uses the extracted message when there is one', () => {
    expect(failureMessage(401, '{"error":{"message":"bad key"}}')).toBe('bad key')
  })

  it('falls back to the status when the body says nothing', () => {
    // A bare `HTTP 502` still tells the reader more than an empty string does.
    expect(failureMessage(502, '')).toBe('HTTP 502')
    expect(failureMessage(500, '{}')).toBe('HTTP 500')
  })
})

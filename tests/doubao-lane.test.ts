import { describe, expect, it } from 'vitest'
import { promptFromMessages } from '../src/doubao-llm.ts'
import { buildHeaders, cookieHeader, sessionUsable, type DoubaoSession } from '../src/doubao-auth.ts'

/**
 * The Doubao lane's request shape.
 *
 * Everything here was measured against the live service. The three headers are not
 * preferences: get any of them wrong and the answer is
 * `710022004 rate limited`, which reads as throttling and is not — the request was never
 * accepted. A test is the only thing that stops a future edit from "tidying" them away.
 */
describe('the Doubao request', () => {
  const session: DoubaoSession = {
    cookies: { sessionid: 'abc123', uid_tt: 'u1', sid_tt: 's1' },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36 SamanthaDoubao/2.31.4',
    savedAt: '2026-11-15T00:00:00.000Z',
  }

  it('identifies as the desktop client, not a browser', () => {
    // The suffix is what the upstream checks. A plain browser UA is refused.
    expect(buildHeaders(session)['User-Agent']).toContain('SamanthaDoubao/')
  })

  it('sends the chrome:// referer, not an https one', () => {
    // An https referer marks the caller as a web page; the app sends the scheme URL.
    expect(buildHeaders(session)['Referer']).toBe('chrome://doubao-chat/')
  })

  it('sends the real client-hints brand', () => {
    expect(buildHeaders(session)['sec-ch-ua']).toContain('Chromium')
  })

  it('carries the conversation header the gateway needs', () => {
    // Without it the request is accepted and then refused with `710022002`, which names the
    // wrong reason.
    expect(buildHeaders(session)['agw-js-conv']).toBe('str')
  })

  it('joins the jar into a Cookie header', () => {
    expect(cookieHeader(session)).toBe('sessionid=abc123; uid_tt=u1; sid_tt=s1')
  })

  it('refuses a session without sessionid', () => {
    expect(sessionUsable(undefined)).toBe(false)
    expect(sessionUsable({ ...session, cookies: { uid_tt: 'u1' } })).toBe(false)
    expect(sessionUsable({ ...session, cookies: { sessionid: '' } })).toBe(false)
    expect(sessionUsable(session)).toBe(true)
  })
})

/**
 * The prompt the lane sends.
 *
 * Doubao keeps history server-side under a conversation id, so the exchange is expressed by
 * the conversation rather than by replaying every message. What has to travel inline is what
 * the caller put in front of the last user turn.
 */
describe('the prompt built from host messages', () => {
  it('keeps a single question a single question', () => {
    const prompt = promptFromMessages([
      { role: 'user', content: [{ type: 'text', text: '你好' }] },
    ])
    expect(prompt).toBe('你好')
  })

  it('reads a plain string content', () => {
    expect(promptFromMessages([{ role: 'user', content: '直接是字符串' }])).toBe('直接是字符串')
  })

  it('joins several turns in order', () => {
    const prompt = promptFromMessages([
      { role: 'system', content: [{ type: 'text', text: '你是助手' }] },
      { role: 'user', content: [{ type: 'text', text: '第一问' }] },
      { role: 'assistant', content: [{ type: 'text', text: '第一答' }] },
      { role: 'user', content: [{ type: 'text', text: '第二问' }] },
    ])
    expect(prompt).toBe('你是助手\n\n第一问\n\n第一答\n\n第二问')
  })

  it('skips images and other non-text blocks rather than sending their JSON', () => {
    const prompt = promptFromMessages([
      { role: 'user', content: [{ type: 'image', url: 'https://x/y.png' }, { type: 'text', text: '这是什么' }] },
    ])
    expect(prompt).toBe('这是什么')
  })

  it('ignores a message with nothing readable', () => {
    expect(promptFromMessages([{ role: 'user', content: [] }, null, 'nonsense'])).toBe('')
  })
})

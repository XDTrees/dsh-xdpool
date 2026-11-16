import { describe, expect, it } from 'vitest'
import type { IncomingMessage } from 'node:http'
import { originTrusted } from '../src/origin-trust.ts'

/**
 * Trusting a request that did not come from localhost.
 *
 * The plugin's routes accepted only a loopback `Origin`. Behind `tailscale serve`, a LAN
 * hostname, or any reverse proxy the browser sends the PUBLIC hostname, so every mutating call
 * answered `403 origin-not-trusted` while reads worked — a GET issued by the page's own `fetch`
 * carries no `Origin` at all. The card displayed its data and refused every button (#164).
 */
function request(headers: Record<string, string | undefined>): IncomingMessage {
  return { headers } as unknown as IncomingMessage
}

describe('the origin gate', () => {
  it('accepts a request with no Origin', () => {
    // A same-origin `fetch()` in Chromium omits it for GET/HEAD. Refusing this would break the
    // page on the machine the plugin was installed on.
    expect(originTrusted(request({}))).toBe(true)
  })

  it('accepts a loopback Origin', () => {
    expect(originTrusted(request({ origin: 'http://127.0.0.1:3080' }))).toBe(true)
    expect(originTrusted(request({ origin: 'http://localhost:3080' }))).toBe(true)
  })

  it('accepts the host a reverse proxy publishes, as a trusted entry', () => {
    const req = request({ origin: 'https://node.tailfca5ef.ts.net', host: 'node.tailfca5ef.ts.net' })
    expect(originTrusted(req, ['node.tailfca5ef.ts.net'])).toBe(true)
  })

  it('accepts it without configuration too, when Host agrees', () => {
    // This is the case a proxy produces: the page is served from that hostname, so `Origin` and
    // `Host` say the same thing. A malicious page elsewhere cannot make them agree.
    const req = request({ origin: 'https://node.tailfca5ef.ts.net', host: 'node.tailfca5ef.ts.net' })
    expect(originTrusted(req)).toBe(true)
  })

  it('still refuses a cross-site page', () => {
    // A request from evil.example aimed at our host: the two headers disagree, and nothing is
    // configured. This is the case the gate exists for.
    const req = request({ origin: 'https://evil.example', host: '127.0.0.1:3080' })
    expect(originTrusted(req)).toBe(false)
  })

  it('matches a trusted entry with a port exactly', () => {
    const origin = { origin: 'https://node.ts.net:8443', host: 'node.ts.net:8443' }
    expect(originTrusted(request({ ...origin, host: 'other.example' }), ['node.ts.net:8443'])).toBe(true)
    // A different port on the same hostname is not that entry.
    expect(originTrusted(request({ origin: 'https://node.ts.net:9000', host: 'other.example' }), ['node.ts.net:8443'])).toBe(false)
  })

  it('matches a port-less entry on any port', () => {
    const req = request({ origin: 'https://node.ts.net:8443', host: 'other.example' })
    expect(originTrusted(req, ['node.ts.net'])).toBe(true)
  })

  it('refuses an unparseable Origin', () => {
    expect(originTrusted(request({ origin: 'not a url' }))).toBe(false)
  })

  it('ignores junk in the trusted list', () => {
    const req = request({ origin: 'https://node.ts.net', host: 'other.example' })
    expect(originTrusted(req, ['', '   ', 'node.ts.net'])).toBe(true)
  })
})

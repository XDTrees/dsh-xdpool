/**
 * `listen EADDRINUSE: address already in use 127.0.0.1:8326` is accurate and useless.
 *
 * The overwhelmingly common cause is not "another program stole the port" — it is a
 * previous DSH that has not finished exiting, still holding the relay it was serving.
 * The requested port and the old listener are the same, so the fix is either to wait or
 * to pick a different port, and the message has to say both or the reader goes hunting
 * for a phantom squatter.
 *
 * The raw text stays at the end: it is the only part that can be searched for, and a
 * paraphrase that loses it is worse than none.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const relay = readFileSync(new URL('../src/relay.ts', import.meta.url), 'utf8')

describe('bind failures are explained, not echoed', () => {
  it('names the usual cause of EADDRINUSE and both remedies', () => {
    expect(relay).toContain('function explainBindFailure(')
    const start = relay.indexOf('function explainBindFailure(')
    const body = relay.slice(start, start + 1600)
    expect(body).toContain('EADDRINUSE')
    // "a previous DSH still holds it" — the actual cause.
    expect(body).toContain('还没完全退出')
    // Both actions: wait, or change the port.
    expect(body).toMatch(/稍等|重试/u)
    expect(body).toContain('换一个端口')
  })

  it('separates a missing interface from a busy port', () => {
    // EADDRNOTAVAIL means the host has no such address. Merging it into the busy-port
    // case would send the reader looking for a process that does not exist.
    const start = relay.indexOf('function explainBindFailure(')
    const body = relay.slice(start, start + 1600)
    expect(body).toContain('EADDRNOTAVAIL')
    expect(body).toContain('0.0.0.0')
  })

  it('mentions the privileged-port rule for EACCES', () => {
    const start = relay.indexOf('function explainBindFailure(')
    const body = relay.slice(start, start + 1600)
    expect(body).toContain('EACCES')
    expect(body).toContain('1024')
  })

  it('keeps the raw error inside the explanation', () => {
    // Searchable, and the only thing that survives a Node/vendor rewording.
    const start = relay.indexOf('function explainBindFailure(')
    const body = relay.slice(start, start + 1600)
    expect(body).toMatch(/原始错误：\$\{raw\}/u)
    // And an unrecognised failure is passed through untouched rather than guessed at.
    expect(body).toMatch(/return raw/u)
  })

  it('is wired into the bind failure path', () => {
    expect(relay).toContain('bindError = explainBindFailure(raw, host, port)')
  })
})

/**
 * A chain member gets a deadline of its own.
 *
 * The caller's signal covers "the user cancelled". It does not cover "this
 * provider accepted the request and then held the socket open" — and without a
 * second, per-member deadline that single case defeats the entire point of a
 * chain: the request hangs on member one and member two is never tried.
 *
 * The design has one property worth locking beyond the timeout itself: the
 * member's controller is DERIVED from the caller's, so cancellation still stops
 * the request immediately rather than waiting out the deadline.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const shim = readFileSync(new URL('../src/shim.ts', import.meta.url), 'utf8')

/** The chain-serving function, bounded by the next top-level declaration. */
function chainBody(): string {
  const start = shim.indexOf('async function serveComboCompletion(')
  if (start === -1) throw new Error('serveComboCompletion moved')
  const next = Math.min(
    ...[shim.indexOf('\n  async function ', start + 1), shim.indexOf('\n  function ', start + 1)]
      .filter(index => index !== -1),
  )
  if (!Number.isFinite(next)) throw new Error('could not bound the chain body')
  return shim.slice(start, next)
}

const body = chainBody()

describe('a hung member cannot hold the whole chain', () => {
  it('declares a per-member deadline', () => {
    expect(shim).toContain('const MEMBER_TIMEOUT_MS = 180_000')
  })

  it('derives each member signal from the caller own', () => {
    // A fresh AbortController, fed by the caller's abort event — that is what
    // makes cancellation immediate while still adding a way to time out.
    expect(body).toContain('const memberController = new AbortController()')
    expect(body).toContain("signal.addEventListener('abort', relayAbort, { once: true })")
    expect(body).toContain('memberController.abort()')
  })

  it('arms the timer per member and releases it on every exit', () => {
    expect(body).toMatch(/setTimeout\(\(\) => \{ memberController\.abort\(\) \}, MEMBER_TIMEOUT_MS\)/u)
    // `finally` rather than a release on each of the eight exits: the loop has
    // several `continue`s and a `return`, and one missed release leaks a timer
    // (and the listener) on every skip.
    expect(body).toContain('} finally {')
    expect(body).toContain('releaseMember()')
    expect(body).toContain('clearTimeout(memberTimer)')
    expect(body).toContain("signal.removeEventListener('abort', relayAbort)")
  })

  it('passes the member signal to the work, not the caller signal', () => {
    // The whole point: the call that may hang must be the one that can be
    // aborted by the deadline. Handing it `signal` would leave the timeout inert.
    expect(body).toContain('conversationKey, memberSignal)')
    expect(body).toContain('prepared, memberSignal,')
    expect(body).toContain('signal: memberSignal,')
  })

  it('does not hold the process open after the request finished', () => {
    // An armed 180s timer with no `unref` keeps the host alive for three minutes
    // after the last request — invisible in tests, obvious in shutdown.
    expect(body).toContain('memberTimer.unref?.()')
  })
})

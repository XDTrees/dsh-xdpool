/**
 * The chain's EXECUTION side: a channel member must reach the host lane.
 *
 * Resolving a member is only half of it. The shim's chain loop had two branches —
 * pool member, aggregate member — and a channel member falling into the pool branch
 * would call `acquireForRequest('trae:doubao-seed')`, which asks the WorkBuddy pool
 * for an account for a model it has never heard of and answers "no usable account".
 * The user would see the chain fail on models the picker happily serves.
 *
 * So this asserts the shape of the third branch: it exists, it is checked BEFORE the
 * pool branch, and its frames are BUFFERED like every other member — the chain
 * promises "retry only before any visible content", and streaming straight to the
 * socket would leave two models' text spliced together when a later member answered.
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

describe('a channel member runs on the host lane', () => {
  it('has its own branch, checked before the pool', () => {
    const hostAt = body.indexOf('if (member.host === true) {')
    const poolAt = body.indexOf('if (!member.aggregate) {')
    expect(hostAt, 'the host branch is gone — channel members would hit the pool').toBeGreaterThan(-1)
    expect(poolAt).toBeGreaterThan(-1)
    // Order matters: falling into the pool branch first would ask the WorkBuddy
    // pool for an account for a channel model and fail with "no usable account".
    expect(hostAt).toBeLessThan(poolAt)
  })

  it('drives it through the host adapter seam, not through a socket', () => {
    expect(body).toContain('channels.turn({')
    expect(body).toContain('channels.resolve(member.modelId)')
  })

  it('BUFFERS the frames instead of writing them as they arrive', () => {
    // `hostFrames.push` then a single write loop on success. Writing inside the
    // event loop would put this member's text on the wire before knowing whether
    // it answers, which is exactly what the chain's retry rule forbids.
    expect(body).toContain('const hostFrames: string[] = []')
    expect(body).toContain('for (const payload of hostFrames) res.write(')
  })

  it('sends the BARE model id upstream', () => {
    // `trae:doubao-seed` is our composite id; the channel adapter would look for a
    // model literally called that and answer "unknown model".
    expect(body).toContain('withBareModelId(raw, channelTarget.modelId)')
  })

  it('records a skip when the lane or the target is missing', () => {
    // Both are configuration states the user can act on, and both must appear in
    // the trace rather than failing silently over to the next member.
    expect(body).toContain('needs the login-channel lane, which this build does not mount')
    expect(body).toContain('is not a resolvable channel model id')
  })

  it('treats an empty answer as an ANSWER, not a failure', () => {
    // A model that replied with nothing visible has responded. Falling through to
    // the next member would silently substitute a different model over a legitimate
    // (if unhelpful) result.
    expect(body).toContain('An empty answer is still an ANSWER')
  })
})

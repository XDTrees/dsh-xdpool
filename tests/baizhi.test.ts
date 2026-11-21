import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  BAIZHI_MAX_CONTEXT,
  baizhiPrng,
  baizhiSolve,
  baizhiSolveOne,
  normalizeBaizhiModel,
  readBaizhiChallenge,
} from '../src/baizhi-protocol.ts'

/**
 * 百智云's proof-of-work, which is the only interesting part of the protocol.
 *
 * The daily credit is gated behind a challenge the client solves locally, and two details decide
 * whether the redeem is accepted: the ordinal is ONE-based, and the target's seed carries a
 * trailing `d` that the salt's does not. Either mistake produces a wrong answer set and a
 * rejection that says nothing about why.
 */
describe('the salt generator', () => {
  it('is deterministic for a seed and length', () => {
    expect(baizhiPrng('abc', 16)).toBe(baizhiPrng('abc', 16))
  })

  it('returns exactly the requested number of hex characters', () => {
    for (const length of [1, 8, 16, 64]) {
      expect(baizhiPrng('seed', length)).toHaveLength(length)
      expect(baizhiPrng('seed', length)).toMatch(/^[0-9a-f]+$/u)
    }
  })

  it('differs between the salt seed and the target seed', () => {
    // The target seed is `${token}${ordinal}d`; using the same seed for both produces a target
    // no solution can match, and the redeem fails with no explanation.
    expect(baizhiPrng('tok1', 8)).not.toBe(baizhiPrng('tok1d', 8))
  })
})

describe('solving one challenge', () => {
  it('finds a number whose sha256 starts with the target', () => {
    // A one-character target is trivially solvable, which is what makes this test fast.
    const salt = baizhiPrng('t1', 8)
    const target = baizhiPrng('t1d', 1)
    const n = baizhiSolveOne(salt, target, { remaining: 1_000_000 })
    // The property that matters: the answer really does match.
    const digest = createHash('sha256').update(`${salt}${n}`, 'utf8').digest('hex')
    expect(digest.startsWith(target)).toBe(true)
  })

  it('refuses to run past its budget', () => {
    /**
     * A 16-character target on a 64-character salt is effectively unsolvable. Refusing on the
     * budget is what stops a raised difficulty from freezing the host.
     */
    expect(() => baizhiSolveOne('a'.repeat(64), 'f'.repeat(16), { remaining: 100 }))
      .toThrow(/预算/u)
  })
})

describe('solving a whole challenge', () => {
  it('produces one solution per sub-challenge', () => {
    const solutions = baizhiSolve(
      { token: 'tok', count: 2, saltLength: 8, targetLength: 1 },
      { remaining: 2_000_000 },
    )
    expect(solutions).toHaveLength(2)
    for (const n of solutions) expect(Number.isInteger(n)).toBe(true)
  })
})

describe('reading a challenge envelope', () => {
  it('accepts a well-formed one', () => {
    const parsed = readBaizhiChallenge({ token: 't', challenge: { c: 2, s: 16, d: 4 } })
    expect('error' in parsed).toBe(false)
    if (!('error' in parsed)) {
      expect(parsed.count).toBe(2)
      expect(parsed.saltLength).toBe(16)
      expect(parsed.targetLength).toBe(4)
    }
  })

  it('refuses an absurd count rather than hanging', () => {
    // A `c` of a billion would run for hours; the bound is what makes this safe.
    const parsed = readBaizhiChallenge({ token: 't', challenge: { c: 1_000_000_000, s: 16, d: 4 } })
    expect('error' in parsed).toBe(true)
  })

  it('refuses a missing token', () => {
    expect('error' in readBaizhiChallenge({ challenge: { c: 1, s: 1, d: 1 } })).toBe(true)
  })

  it('refuses a non-object body', () => {
    expect('error' in readBaizhiChallenge(null)).toBe(true)
    expect('error' in readBaizhiChallenge('nope')).toBe(true)
  })
})

describe('reading a catalogue row', () => {
  it('keeps an absent window absent instead of inventing one', () => {
    /**
     * The vendor does not publish a window for every model, and filling in a number makes the
     * host compact against a limit nobody promised.
     */
    const model = normalizeBaizhiModel({ id: 'x' })
    expect(model?.id).toBe('x')
    expect(model?.contextWindow).toBeUndefined()
  })

  it('reports an unknown image capability as unknown, not as no', () => {
    // `vision: false` would block a model that does accept images; leaving it off is honest.
    expect(normalizeBaizhiModel({ id: 'x' })?.vision).toBeUndefined()
    expect(normalizeBaizhiModel({ id: 'y', vision: true })?.vision).toBe(true)
  })

  it('reads the published limits when they are there', () => {
    const model = normalizeBaizhiModel({ id: 'z', context_window: 200_000, max_tokens: 64_000 })
    expect(model?.contextWindow).toBe(200_000)
    expect(model?.maxOutputTokens).toBe(64_000)
  })

  it('declares the largest window the gateway publishes', () => {
    expect(BAIZHI_MAX_CONTEXT).toBe(1_048_576)
  })
})

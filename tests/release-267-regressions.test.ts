/**
 * Three fixes from the 2026-11-12 field reports.
 *
 * #140 — the pack's outbound fetch was read from the global at every call, so another
 *        plugin's patch became the channel's transport.
 * #143 — a model the card did not tick could not be resolved even when named explicitly.
 * #132 — a zcode risk-control refusal with no business code and a 405 status reached the
 *        user as a bare "HTTP 405".
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const pack = readFileSync(new URL('../vendor/channel-pack/pack.js', import.meta.url), 'utf8')
const adapter = readFileSync(new URL('../src/adapter.ts', import.meta.url), 'utf8')

describe('outbound fetch is bound once (#140)', () => {
  it('captures the implementation at creation, not per call', () => {
    // `(options.fetchImpl ?? globalThis.fetch)(input, init)` read the global lazily. When
    // billion-context patched `globalThis.fetch` to enforce its 8 MiB direct-upload gate,
    // that patch became the transport for every channel request — it knows nothing about
    // conversation ownership, so the body was refused (422, rendered as 400 upstream).
    expect(pack).toContain('const boundFetch = options.fetchImpl ??')
    expect(pack).not.toContain('const fetchImpl = (input, init) => (options.fetchImpl ?? globalThis.fetch)(input, init);')
  })

  it('keeps an explicit override winning', () => {
    // Tests and embedders substitute a fetch on purpose; the binding must not take that
    // away.
    expect(pack).toContain('options.fetchImpl ?? (typeof globalThis.fetch')
  })

  it('says so when no implementation exists at all', () => {
    // The Chinese text is stored as `\uXXXX` escapes in the build artifact, so the
    // assertion targets the code shape rather than the wording.
    expect(pack).toContain('boundFetch === undefined')
    expect(pack).toMatch(/if \(boundFetch === undefined\) throw new Error/u)
  })
})

describe('an explicitly named model resolves even when unticked (#143)', () => {
  it('serves the union of visible and all, not the filtered list alone', () => {
    // The card's tick-boxes decide what the picker LISTS. They must not decide what the
    // provider can serve: `kimi-k3.1-pro` was on the roster and servable, and the refusal
    // came from a display filter.
    expect(adapter).toContain('catalog.current()')
    expect(adapter).toContain('const withSelection')
    // Ticked rows keep their per-model overrides (image support, context budget).
    expect(adapter).toContain('catalog.visible()')
  })

  it('puts the ticked models first, so the default choice does not change', () => {
    expect(adapter).toMatch(/return \[\.\.\.shown, \.\.\.rest\]/u)
  })
})

describe('a code-less risk-control refusal is classified as risk control (#132)', () => {
  it('recognises the 405 that carries no business code', () => {
    // The screenshot showed `HTTP 405 · request has been blocked due to unusual activity`
    // reaching the user as a generic HTTP error while the same condition elsewhere gave
    // the proper 3012 message: the body had no `code`, and the status was neither 401 nor
    // 403, so every branch missed it.
    expect(pack).toContain('isZcodeBlockedWithoutCode')
    expect(pack).toContain('if (status !== 405 && status !== 403) return false')
  })

  it('does not treat a real 405 as risk control', () => {
    // The test requires the body to mention blocking; a genuine method error stays a
    // method error.
    expect(pack).toMatch(/blocked\|unusual activity\|forbidden/u)
  })

  it('routes it to the cooldown warning instead of a raw status', () => {
    // Both the message builder and the error code use it, so the user sees the冷却 warning
    // rather than "HTTP 405".
    const hits = [...pack.matchAll(/isZcodeBlockedWithoutCode\(status, trimmed\)/gu)]
    expect(hits.length).toBe(2)
    expect(pack).toContain('formatZcodeUnusualActivityMessage')
  })
})

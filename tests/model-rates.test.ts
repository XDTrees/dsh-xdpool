/**
 * Regression tests for the model-directory display: the credit multiplier and
 * the free badge.
 *
 * Both were invisible on the international roster even though the upstream was
 * sending everything needed, for two independent reasons:
 *
 *  1. `tags` was parsed into the model object NOWHERE. The JSON carried a
 *     `tags` array; `parseUpstreamModel` simply never read it, and
 *     `toModelInfo` then dropped it again, so the card's promo badges were
 *     unreachable for every model on both gateways.
 *  2. Even once parsed, `free` was awaited as a literal tag — and no gateway
 *     sends one. Zero cost is expressed as `credits: "x0.00"` (global `hy3`,
 *     `hy4-preview-f`, `deepseek-v4.1-flash`), so a genuinely free model
 *     rendered as a plain paid one.
 *
 * The fixtures below are the REAL shapes captured from `www.workbuddy.ai/v3/config`.
 */

import { describe, expect, it } from 'vitest'
import { parseUpstreamModel, isFreeModel } from '../src/upstream.ts'
import { toModelInfo, catalogFromUpstream, FALLBACK_WORKBUDDY_MODELS } from '../src/catalog.ts'

/** One entry in the shape the global gateway actually returns. */
function globalModel(extra: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'glm-5.3',
    name: 'GLM-5.3',
    credits: 'x0.79 credits',
    maxInputTokens: 200_000,
    maxOutputTokens: 128_000,
    supportsImages: true,
    ...extra,
  }
}

describe('the upstream tag list survives parsing', () => {
  it('keeps a tags array instead of discarding it', () => {
    const parsed = parseUpstreamModel(globalModel({ tags: ['craft'] }))
    expect(parsed?.tags).toEqual(['craft'])
  })

  it('drops non-string and empty tag entries rather than passing junk through', () => {
    const parsed = parseUpstreamModel(globalModel({ tags: ['craft', '', 42, null, 'image-to-image'] }))
    expect(parsed?.tags).toEqual(['craft', 'image-to-image'])
  })

  it('treats an absent or empty tag list as "no tags"', () => {
    expect(parseUpstreamModel(globalModel({}))?.tags).toBeUndefined()
    expect(parseUpstreamModel(globalModel({ tags: [] }))?.tags).toBeUndefined()
  })

  it('carries tags through to the catalog info', () => {
    const parsed = parseUpstreamModel(globalModel({ tags: ['craft'] }))
    expect(parsed).toBeDefined()
    expect(toModelInfo(parsed!).tags).toEqual(['craft'])
  })
})

describe('free is derived from the multiplier, not awaited as a tag', () => {
  it('a zero-credit model is free', () => {
    // The exact global spelling: hy3 / hy4-preview-f / deepseek-v4.1-flash.
    const parsed = parseUpstreamModel(globalModel({ id: 'hy3', credits: 'x0.00' }))
    expect(parsed?.creditMultiplier).toBe(0)
    expect(isFreeModel(parsed!)).toBe(true)
  })

  it('a paid model is not free', () => {
    const parsed = parseUpstreamModel(globalModel({ credits: 'x0.79 credits' }))
    expect(isFreeModel(parsed!)).toBe(false)
  })

  it('an explicit free tag still counts when a gateway sends one', () => {
    expect(isFreeModel({ tags: ['free'] })).toBe(true)
    expect(isFreeModel({ tags: ['limited-free'] })).toBe(true)
    expect(isFreeModel({ tags: ['craft'] })).toBe(false)
  })
})

describe('the multiplier reaches the catalog info', () => {
  it('parses the two spellings the gateways use', () => {
    // Global: "x0.79" / "x0.79 credits"; CN uses the same "xN.NN" prefix.
    expect(parseUpstreamModel(globalModel({ credits: 'x0.79' }))?.creditMultiplier).toBe(0.79)
    expect(parseUpstreamModel(globalModel({ credits: 'x0.79 credits' }))?.creditMultiplier).toBe(0.79)
    expect(parseUpstreamModel(globalModel({ credits: 'x3.31 credits' }))?.creditMultiplier).toBe(3.31)
  })

  it('an empty credits string is "unknown", NOT free', () => {
    // `default-model` really does send `credits: ""`. Reading that as 0 would
    // brand the default model as free.
    expect(parseUpstreamModel(globalModel({ id: 'default-model', credits: '' }))?.creditMultiplier).toBeUndefined()
  })
})

describe('the static fallback refuses to guess at rates', () => {
  it('carries no multiplier, because a captured rate goes stale', () => {
    // This used to assert the OPPOSITE — that the fallback carries rates so an
    // unreachable upstream does not "strip" them. That traded a visible gap for
    // an invisible lie: the captured 0.79 for glm-5.3 is a price the user budgets
    // against months later, and `multiplier: 0` on a once-free model keeps
    // rendering the "free" badge after the promotion ended.
    //
    // An absent rate renders as no rate, which is exactly true while the fetch
    // has failed; `catalogSource` already tells the card the list is the built-in
    // one, so the gap is explained rather than hidden.
    const byId = new Map(FALLBACK_WORKBUDDY_MODELS.map(m => [m.id, m]))
    for (const model of FALLBACK_WORKBUDDY_MODELS) {
      expect(model.multiplier, `${model.id} must not claim a rate`).toBeUndefined()
    }
    // The IDS stay accurate — that is the part a failed fetch would otherwise
    // hide, and an id is a fact rather than a price.
    expect(byId.has('glm-5.3')).toBe(true)
    // The CN gateway names this one `kimi-k3-1`; the table used to carry the
    // stale `kimi-k3`, which no longer resolves to anything upstream.
    expect(byId.has('kimi-k3-1')).toBe(true)
    expect(byId.has('hy3')).toBe(true)
  })

  it('no row advertises a campaign badge it cannot keep current', () => {
    // `badge:限时免费` and friends are campaign claims; offline they advertise a
    // promotion that may have ended.
    for (const model of FALLBACK_WORKBUDDY_MODELS) {
      for (const tag of model.tags ?? []) {
        expect(tag, `${model.id}: ${tag}`).not.toMatch(/^badge:/u)
      }
    }
  })

  it('carries the models that only exist upstream, so a failed fetch does not hide them', () => {
    // The reported incident: a startup fetch failed, the picker fell back to
    // this table, and `deepseek-v4.1-flash` — which the user had enabled —
    // vanished with no explanation. A table that does not name the models
    // people actually use turns a network hiccup into "the plugin deleted my
    // models".
    const ids = new Set(FALLBACK_WORKBUDDY_MODELS.map(m => m.id))
    for (const id of ['deepseek-v4.1-flash', 'kimi-k3-1', 'minimax-m3', 'auto']) {
      expect(ids.has(id), `${id} must be in the fallback table`).toBe(true)
    }
  })

  it('does not carry ids the gateway has retired', () => {
    // A stale row is worse than a missing one: it looks authoritative, so the
    // user can select it and then get UNKNOWN_MODEL from the provider.
    const ids = new Set(FALLBACK_WORKBUDDY_MODELS.map(m => m.id))
    expect(ids.has('kimi-k3')).toBe(false)
    expect(ids.has('hy4-preview-f')).toBe(false)
  })

  it('the fallback is what shows before the first live fetch, with no invented rates', () => {
    const infos = catalogFromUpstream([])
    expect(infos.length).toBeGreaterThan(0)
    // No rate is claimed while the roster is the built-in one. The gap is the
    // honest answer; a stale number would be indistinguishable from a live one.
    expect(infos.filter(m => m.multiplier !== undefined)).toHaveLength(0)
  })
})

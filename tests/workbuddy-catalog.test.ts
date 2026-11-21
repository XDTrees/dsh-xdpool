import { describe, expect, it } from 'vitest'
import { parseUpstreamModel } from '../src/upstream.ts'
import { FALLBACK_WORKBUDDY_MODELS, fallbackModelsFor } from '../src/catalog.ts'

/**
 * What the WorkBuddy catalogue is allowed to hide.
 *
 * The payload lists 36 entries and names 13 agents; one of them — `cli` — carries a 16-model
 * whitelist. Inherited code applied that as a FILTER, so half the catalogue never reached the
 * picker and a refresh looked like it had found nothing new. The whitelist is an ordering hint,
 * not an allowlist: a model an account can call belongs in the list.
 */
describe('one catalogue entry', () => {
  it('keeps an entry that names both token limits', () => {
    const model = parseUpstreamModel({
      id: 'hy4flash',
      name: 'Hy4 flash',
      maxInputTokens: 960_000,
      maxOutputTokens: 64_000,
      supportsImages: true,
    })
    expect(model?.id).toBe('hy4flash')
    expect(model?.contextWindow).toBe(960_000)
    expect(model?.maxTokens).toBe(64_000)
  })

  it('drops an entry with no token limits', () => {
    // Image and video generators publish neither, and they are not chat models — listing them
    // would put a model in the picker that cannot answer a message.
    expect(parseUpstreamModel({ id: 'kling-video-v3', name: 'Kling' })).toBeUndefined()
  })

  it('drops an entry the vendor disabled', () => {
    expect(parseUpstreamModel({
      id: 'gone', name: 'Gone', maxInputTokens: 1, maxOutputTokens: 1, disabled: true,
    })).toBeUndefined()
  })

  it('drops an entry with no id', () => {
    expect(parseUpstreamModel({ name: 'Nameless', maxInputTokens: 1, maxOutputTokens: 1 })).toBeUndefined()
  })
})

describe('the static table', () => {
  it('lists the Hy4 family the live catalogue serves', () => {
    /**
     * The table is what a user sees when the live fetch fails, so an id the gateway still serves
     * has to be here or a failed refresh silently removes a model that works.
     */
    const ids = FALLBACK_WORKBUDDY_MODELS.map(model => model.id)
    for (const id of ['hy4std', 'hy4flash', 'hy4flash-free']) {
      expect(ids, id).toContain(id)
    }
  })

  it('covers the models only the international gateway serves', () => {
    /**
     * The global table used to be the domestic one with the promo badges stripped, so a failed
     * refresh offered none of the models a user picks the international lane FOR — GPT-6, Grok,
     * Gemini 4.
     */
    const ids = fallbackModelsFor('global').map(model => model.id)
    for (const id of ['gpt-6-astra', 'grok-4.7', 'gemini-4-carbon', 'kimi-k3', 'minimax-m3.1-flash']) {
      expect(ids, id).toContain(id)
    }
  })

  it('keeps the international table a superset of the domestic one', () => {
    // A model that works on the domestic gateway must not disappear when the same account is
    // read through the international one.
    const globalIds = new Set(fallbackModelsFor('global').map(model => model.id))
    for (const model of FALLBACK_WORKBUDDY_MODELS) {
      expect(globalIds.has(model.id), model.id).toBe(true)
    }
  })

  it('declares 960K for Hy4, not the old preview window', () => {
    // Read off the live payload's `maxInputTokens`.
    const hy4 = FALLBACK_WORKBUDDY_MODELS.find(model => model.id === 'hy4std')
    expect(hy4?.contextWindow).toBe(960_000)
    expect(hy4?.supportsImages).toBe(true)
  })
})

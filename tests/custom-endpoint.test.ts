/**
 * A custom OpenAI-compatible endpoint has to be reachable through the aggregate
 * lane, or "bring your own gateway" is a claim the UI cannot keep.
 *
 * The registry is data, so this is a data test: one record whose base URL is
 * EMPTY and whose model list is EMPTY, and the existing machinery does the rest —
 * `providerAuthUsable` wants a key, `effectiveBaseUrl` prefers the user's
 * override, and discovery fills the roster from `/v1/models`.
 *
 * What is worth locking is that the record does not accidentally behave like a
 * configured vendor: an empty base URL must read as "not set up yet", never as
 * "works", or the row would sit in the picker contributing nothing and looking
 * broken.
 */
import { describe, expect, it } from 'vitest'
import { PROVIDERS, getProvider } from '../src/providers.ts'

const custom = getProvider('custom_openai')

describe('the custom OpenAI-compatible endpoint', () => {
  it('exists in the registry as one fixed slot', () => {
    expect(custom, 'custom_openai is gone — "bring your own endpoint" is unreachable').not.toBeNull()
    expect(custom?.auth.kind).toBe('apiKey')
    expect(custom?.format).toBe('openai-chat')
  })

  it('declares no base URL of its own, so the user must supply one', () => {
    // The whole point: the address is unknown. A default here would be a guess
    // that silently sends requests somewhere the user never chose.
    expect(custom?.baseUrl ?? '').toBe('')
    // An env var is offered as a convenience, not as a fallback value.
    expect(custom?.baseUrlOverrideEnv).toBe('CUSTOM_OPENAI_BASE_URL')
  })

  it('declares no models, because the roster is whatever the endpoint serves', () => {
    expect(custom?.models ?? []).toHaveLength(0)
  })

  it('is not counted as a local provider', () => {
    // `local` drives copy and filters meant for things like LLaMA.cpp on
    // localhost. A custom endpoint is usually remote, so claiming otherwise
    // would mis-sort it on the page.
    expect(custom?.local).not.toBe(true)
  })

  it('is the only registry record that is marked custom', () => {
    // One slot, not one per pasted URL: the settings store already keys by
    // provider id, so a second custom row would silently overwrite the first.
    const customs = PROVIDERS.filter(provider => provider.custom === true).map(provider => provider.id)
    expect(customs).toEqual(['custom_openai'])
  })

  it('does not collide with a vendor id', () => {
    const ids = PROVIDERS.map(provider => provider.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

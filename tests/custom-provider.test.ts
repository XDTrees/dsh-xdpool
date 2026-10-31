/**
 * The user-supplied endpoint, end to end at the settings boundary.
 *
 * The registry can only declare gateways its authors know about. `custom` is the
 * escape hatch: a record with NO base URL, NO models and NO listing host, whose
 * three unknowns are exactly the three fields the settings pane already stores.
 * That makes it a test about the RESOLUTION, not about a new code path — which
 * is the point of adding a record instead of a special case:
 *
 * - the chat URL is composed from the base the user typed (`effectiveChatUrl`),
 * - the listing URL is composed the same way, which `modelsEndpoint` cannot do
 *   on its own because it has no base to join a relative `/models` against,
 * - the typed ids become the roster, because a record that declares no models
 *   cannot have a registry roster that narrows them away.
 *
 * Every assertion below would pass vacuously if `custom` were not a real
 * registry entry: `buildAggregateCatalog` skips an id the registry does not
 * know, and `resolveAggregateProvider` throws for it.
 */
import { describe, expect, it } from 'vitest'
import type { AggregateStore } from '../src/store.ts'
import { buildAggregateCatalog, modelChoicesFor, resolveAggregateProvider } from '../src/aggregate.ts'
import { getProvider, isProviderId, parseProviderModelId } from '../src/providers.ts'
import { aggregateStatusOf } from '../src/web-status.ts'
import type { ProviderSetting } from '../src/providers.ts'

const BASE = 'https://gw.example.com/v1'
/** One store holding exactly the custom record, so no other vendor leaks in. */
function storeWith(setting: ProviderSetting): AggregateStore {
  return { providers: { custom: setting } }
}
/** The custom record's setting, ready to serve one typed id. */
const SERVING: ProviderSetting = { apiKey: 'sk-test', baseUrl: BASE, models: ['gpt-6.1-sol'] }

describe('the custom record is registry data, not a special case in code', () => {
  it('declares an empty base and no models, which is what makes it "custom"', () => {
    const provider = getProvider('custom')
    expect(provider).not.toBeNull()
    expect(provider?.baseUrl).toBe('')
    expect(provider?.models).toEqual([])
    expect(provider?.format).toBe('openai-chat')
    expect(provider?.auth.kind).toBe('apiKey')
    expect(isProviderId('custom')).toBe(true)
  })

  it('keeps the listing as a path, so only a user base can make it absolute', () => {
    expect(getProvider('custom')?.modelsUrl).toBe('/models')
  })
})

describe('the custom endpoint is composed from what the user typed', () => {
  it('posts a turn to <base>/chat/completions', () => {
    expect(resolveAggregateProvider(storeWith(SERVING), 'custom').chatUrl).toBe(`${BASE}/chat/completions`)
  })

  it('reads the listing from <base>/models, which is the path the record declares', () => {
    expect(resolveAggregateProvider(storeWith(SERVING), 'custom').modelsUrl).toBe(`${BASE}/models`)
  })

  it('trims a trailing slash before joining, so the path is never doubled', () => {
    const resolved = resolveAggregateProvider(
      storeWith({ apiKey: 'sk-test', baseUrl: `${BASE}///`, models: ['gpt-6.1-sol'] }),
      'custom',
    )
    expect(resolved.chatUrl).toBe(`${BASE}/chat/completions`)
    expect(resolved.modelsUrl).toBe(`${BASE}/models`)
  })

  it('refuses to invent an endpoint before a base URL is set', () => {
    expect(() => resolveAggregateProvider(storeWith({ apiKey: 'sk-test' }), 'custom')).toThrow(/no base URL/iu)
  })
})

describe('the typed ids are the roster', () => {
  it('serves exactly those ids, in the order they were typed', () => {
    const rows = buildAggregateCatalog(
      storeWith({ apiKey: 'sk-test', baseUrl: BASE, models: ['gpt-6.1-sol', 'house-model'] }),
    )
    expect(rows.map(row => row.id)).toEqual(['custom/gpt-6.1-sol', 'custom/house-model'])
    expect(rows.map(row => row.modelId)).toEqual(['gpt-6.1-sol', 'house-model'])
  })

  it('gives a typed id the documented fallback capacities, not a fabricated row', () => {
    const [row] = buildAggregateCatalog(storeWith(SERVING))
    expect(row?.contextWindow).toBe(131_072)
    expect(row?.maxOutputTokens).toBe(32_768)
    // The registry says nothing about this id, so nothing is claimed about it.
    expect(row?.supportsImages).toBe(false)
  })

  it('offers the typed ids back to the card, so they can be edited instead of lost', () => {
    const provider = getProvider('custom')!
    expect(modelChoicesFor(provider, SERVING)).toEqual(['gpt-6.1-sol'])
  })

  it('survives the id round trip the shim performs, with the slash in the model name intact', () => {
    expect(parseProviderModelId('custom/gpt-6.1-sol')).toEqual({ providerId: 'custom', modelId: 'gpt-6.1-sol' })
    expect(parseProviderModelId('custom/vendor/model')).toEqual({ providerId: 'custom', modelId: 'vendor/model' })
  })
})

describe('the card is told the ids are the user’s to type', () => {
  it('flags the row as manual rather than drawing a chooser over an empty roster', () => {
    const status = aggregateStatusOf(storeWith(SERVING), [])
    const row = status.providers.find(provider => provider.id === 'custom')
    expect(row?.manualModels).toBe(true)
    expect(row?.availableModels).toEqual(['gpt-6.1-sol'])
    expect(row?.models).toEqual(['gpt-6.1-sol'])
  })

  it('flags every record that declares no models, and only those', () => {
    // Not `=== 'custom'`: the local servers (llamacpp, lmstudio, ollama) are in
    // the same state — a base URL and no declared ids and no listing to fetch —
    // so they were unreachable for the same reason and are fixed by the same
    // field. Azure has models of its own; it must stay unflagged.
    const status = aggregateStatusOf(storeWith(SERVING), [])
    for (const row of status.providers) {
      expect({ id: row.id, manual: row.manualModels }).toEqual({
        id: row.id,
        manual: getProvider(row.id)?.models.length === 0,
      })
    }
    // A deployment-named endpoint is the same situation: Azure's models are
    // per-deployment, so its ids are typed too. A vendor with a declared roster
    // is the contrast.
    expect(status.providers.find(row => row.id === 'azure_openai')?.manualModels).toBe(true)
    expect(status.providers.find(row => row.id === 'llamacpp')?.manualModels).toBe(true)
    expect(status.providers.find(row => row.id === 'agnes')?.manualModels).toBe(false)
  })
})

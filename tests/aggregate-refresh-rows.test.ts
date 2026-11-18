/**
 * `AggregateCatalog.refresh()` decided whether to publish new rows by comparing
 * row ids and row counts. An edit that kept the id and the count — swapping one
 * chain member for another, renaming the chain, replacing a model in a
 * provider's `models[]` — therefore rebuilt nothing, and the picker (and the
 * gateway, which resolves chain members through the same rows) kept the old
 * window and the old image flag until the plugin restarted. The routing page,
 * which reads the store directly, showed the new chain the whole time.
 */
import { describe, expect, it } from 'vitest'
import { AggregateCatalog } from '../src/aggregate.ts'
import type { WorkBuddyModelInfo } from '../src/catalog.ts'
import type { AggregateStore } from '../src/store.ts'

function storeWith(models: readonly string[]): AggregateStore {
  return {
    version: 1,
    enabled: true,
    providers: {},
    combos: [{ name: 'chain', models: [...models], strategy: 'fallback', stickyLimit: 1, enabled: true }],
  }
}

describe('refresh republishes a chain whose members changed but whose count did not', () => {
  const small: WorkBuddyModelInfo = {
    id: 'hy3', name: 'HY3', contextWindow: 192_000, maxOutputTokens: 8_192, supportsImages: false,
  }
  const large: WorkBuddyModelInfo = {
    id: 'hy4', name: 'HY4', contextWindow: 1_000_000, maxOutputTokens: 64_000, supportsImages: true,
  }
  const swap: WorkBuddyModelInfo = {
    id: 'hy5', name: 'HY5', contextWindow: 1_000_000, maxOutputTokens: 64_000, supportsImages: true,
  }

  it('adopts the new member set', async () => {
    const store = storeWith(['hy3', 'hy4'])
    const catalog = new AggregateCatalog(() => store, () => [small, large, swap])
    await catalog.refresh()
    expect(catalog.findCombo('combo:chain')?.contextWindow).toBe(192_000)
    // Swap the 192k member for a 1M one. The id and the member count are
    // unchanged, which is exactly the edit an id-only comparison cannot see.
    store.combos = [{ name: 'chain', models: ['hy5', 'hy4'], strategy: 'fallback', stickyLimit: 1, enabled: true }]
    await catalog.refresh()
    expect(catalog.findCombo('combo:chain')?.contextWindow).toBe(1_000_000)
  })
})
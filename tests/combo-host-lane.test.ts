/**
 * The routing page could only ever offer the WorkBuddy pool.
 *
 * `combosStatusOf` built its candidates from two catalogs — the pool roster and
 * this plugin's own aggregate registry — and a 扫码登录 channel is in NEITHER. The
 * channels are providers the vendored pack registers with the HOST, so the only way
 * to see them is to ask the host. That is exactly what the reference router does
 * (`llm.listProviders` / `llm.listModels`), and exactly why its page listed fourteen
 * platforms while ours listed one.
 *
 * Three behaviours make the fix work, and each is asserted separately:
 *
 *   1. `resolveComboMember` recognises a `<channel>:<model>` row as a third lane.
 *   2. That lane is NOT confused with `aggregate`, which has different credentials,
 *      a different error vocabulary and a different code path.
 *   3. A channel member never shadows a pool member, and vice versa.
 */
import { describe, expect, it } from 'vitest'
import {
  COMBO_DEFAULT_CONTEXT_WINDOW,
  COMBO_DEFAULT_MAX_OUTPUT,
  resolveComboMember,
  type ComboSources,
  type HostModelRow,
} from '../src/combos.ts'
import type { AggregateModelRow } from '../src/aggregate.ts'
import type { WorkBuddyModelInfo } from '../src/catalog.ts'

const pool: WorkBuddyModelInfo[] = [
  { id: 'hy3', name: 'Hy3', contextWindow: 192_000, maxOutputTokens: 64_000, supportsImages: true },
]
const aggregate: AggregateModelRow[] = [{
  id: 'opencode/glm-5.3',
  name: 'GLM-5.3',
  providerId: 'opencode',
  modelId: 'glm-5.3',
  contextWindow: 1_000_000,
  maxOutputTokens: 64_000,
  supportsImages: false,
  wire: 'chat',
  source: 'static',
}]
const host: HostModelRow[] = [
  { id: 'trae:doubao-seed', channel: 'trae', modelId: 'doubao-seed', name: 'Doubao Seed' },
  { id: 'qoder:glm-4.6', channel: 'qoder', modelId: 'glm-4.6', name: 'GLM-4.6' },
]
const sources: ComboSources = { pool, aggregate, host }

describe('a chain can name a 扫码登录 channel model', () => {
  it('resolves it through the host lane', () => {
    const member = resolveComboMember('trae:doubao-seed', sources)
    expect(member).toBeDefined()
    expect(member?.host).toBe(true)
    // The channel id travels with the member so the shim can call
    // `channels.turn` without re-parsing the composite id.
    expect(member?.channel).toBe('trae')
  })

  it('does NOT mark it as aggregate', () => {
    // Both are "third party" in the loose sense, so the two flags could easily be
    // conflated — and then a channel member would be sent to
    // `resolveAggregateProvider`, which would look for a key that does not exist
    // and answer 401 for a channel that is perfectly signed in.
    const member = resolveComboMember('trae:doubao-seed', sources)
    expect(member?.aggregate).toBe(false)
    expect(member?.providerId).toBeUndefined()
  })

  it('leaves the window and image flag at the documented defaults', () => {
    // The host's listing publishes neither, and an unknown window must not be
    // treated as a large one: the host would then size a compaction against a limit
    // nobody promised.
    const member = resolveComboMember('qoder:glm-4.6', sources)
    expect(member?.contextWindow).toBe(COMBO_DEFAULT_CONTEXT_WINDOW)
    expect(member?.maxOutputTokens).toBe(COMBO_DEFAULT_MAX_OUTPUT)
    expect(member?.supportsImages).toBe(false)
  })
})

describe('the three lanes stay distinguishable', () => {
  it('a pool id still resolves to the pool', () => {
    const member = resolveComboMember('hy3', sources)
    expect(member?.host).toBeUndefined()
    expect(member?.aggregate).toBe(false)
    expect(member?.contextWindow).toBe(192_000)
  })

  it('an aggregate id still resolves to the aggregate lane', () => {
    const member = resolveComboMember('opencode/glm-5.3', sources)
    expect(member?.aggregate).toBe(true)
    expect(member?.host).toBeUndefined()
    expect(member?.providerId).toBe('opencode')
  })

  it('an id no catalog knows is still refused, not guessed', () => {
    // A chain may name a model that is gone; saying "unknown" is what lets the card
    // report it as missing instead of routing somewhere arbitrary.
    expect(resolveComboMember('nobody:nothing', sources)).toBeUndefined()
  })

  it('works with no host list at all, which is every caller that predates it', () => {
    const withoutHost: ComboSources = { pool, aggregate }
    expect(resolveComboMember('hy3', withoutHost)?.modelId).toBe('hy3')
    // And a channel id simply does not resolve, rather than throwing.
    expect(resolveComboMember('trae:doubao-seed', withoutHost)).toBeUndefined()
  })
})

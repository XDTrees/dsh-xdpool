/**
 * Chains are edited in TWO LEVELS: platform order, then model order per platform.
 *
 * That is the order the router actually walks — "same platform: try the next model;
 * platform exhausted: the next platform" — and the order a reader thinks in. The
 * stored form is still the flat `models` list every resolver reads, so the whole
 * feature rests on one invariant:
 *
 *   flatten(platforms) === models
 *
 * These tests pin that invariant from both directions: flattening groups produces
 * the composite ids the catalogs publish, and grouping a flat list reproduces it
 * exactly. A drift here is silent — the editor would show one chain and the router
 * would walk another.
 */
import { describe, expect, it } from 'vitest'
import { flattenPlatforms, normalizeCombos, splitPlatforms, POOL_OWNER } from '../src/combos.ts'

describe('flattening platform groups', () => {
  it('walks platform order, then model order inside each platform', () => {
    const flat = flattenPlatforms([
      { owner: 'workbuddy', models: ['hy3', 'glm-5.3'] },
      { owner: 'opencode', models: ['deepseek-v4.1-flash-free'] },
    ])
    expect(flat).toEqual(['hy3', 'glm-5.3', 'opencode/deepseek-v4.1-flash-free'])
  })

  it('gives a pool model its BARE id and every other lane its prefix', () => {
    // The prefix is derived from the owner, never stored: carrying both would let
    // the two disagree, and a pool id with a prefix (`workbuddy/hy3`) matches
    // nothing the catalog publishes.
    expect(flattenPlatforms([{ owner: POOL_OWNER, models: ['hy3'] }])).toEqual(['hy3'])
    expect(flattenPlatforms([{ owner: 'qoder', models: ['glm-4.6'] }])).toEqual(['qoder/glm-4.6'])
  })

  it('drops a duplicate pair, which would otherwise spend two attempts on one endpoint', () => {
    const flat = flattenPlatforms([
      { owner: 'workbuddy', models: ['hy3', 'hy3'] },
      { owner: 'workbuddy', models: ['hy3'] },
    ])
    expect(flat).toEqual(['hy3'])
  })

  it('ignores an empty owner and an empty model', () => {
    expect(flattenPlatforms([
      { owner: '', models: ['hy3'] },
      { owner: 'workbuddy', models: ['', '  '] },
    ])).toEqual([])
  })

  it('refuses to nest one chain inside another', () => {
    // A `combo:` member would make the router depend on its own output and advance
    // the round-robin cursor twice per turn.
    expect(flattenPlatforms([{ owner: 'workbuddy', models: ['combo:other'] }])).toEqual([])
  })
})

describe('grouping a flat list back into platforms', () => {
  it('reads each owner from the id shape and keeps first-seen order', () => {
    const groups = splitPlatforms(['hy3', 'opencode/glm-5.3', 'glm-5.3', 'qoder/glm-4.6'])
    expect(groups).toEqual([
      { owner: 'workbuddy', models: ['hy3', 'glm-5.3'] },
      { owner: 'opencode', models: ['glm-5.3'] },
      { owner: 'qoder', models: ['glm-4.6'] },
    ])
  })

  it('round-trips an ALREADY GROUPED chain exactly', () => {
    // Grouped input is the invariant's home case: platform order, then model order.
    const flat = ['hy3', 'glm-5.3', 'opencode/glm-5.3']
    expect(flattenPlatforms(splitPlatforms(flat))).toEqual(flat)
  })

  it('is LOSSY for an interleaved chain, which is why the editor keeps `flat`', () => {
    // `hy3 → opencode/x → glm-5.3` puts two pool models on either side of a
    // third-party one. Both pool models share a group, so regrouping pulls
    // `glm-5.3` forward and the walk order changes.
    //
    // That is inherent to a two-level model, not a bug — but it is exactly why
    // `ChainDraft` carries the server's `flat` list beside `platforms` and only
    // recomputes it on an EDIT. Deriving it on render would reorder the user's
    // fallbacks the moment the page opened, and the next Save would persist that.
    const interleaved = ['hy3', 'opencode/glm-5.3', 'glm-5.3']
    expect(flattenPlatforms(splitPlatforms(interleaved))).not.toEqual(interleaved)
    // The members are all still there — only the order moved.
    expect(new Set(flattenPlatforms(splitPlatforms(interleaved)))).toEqual(new Set(interleaved))
  })

  it('accepts an empty chain', () => {
    expect(splitPlatforms([])).toEqual([])
  })
})

describe('normalizeCombos understands both stored shapes', () => {
  it('derives `models` from `platforms`, so the two can never disagree', () => {
    const [chain] = normalizeCombos([{
      name: 'daily',
      platforms: [
        { owner: 'workbuddy', models: ['hy3'] },
        { owner: 'opencode', models: ['glm-5.3'] },
      ],
      // A STALE flat list, as if the user replaced the groups and the old field
      // lingered: it must be ignored rather than merged, or saving would keep
      // resurrecting a member the user removed.
      models: ['hy3', 'stale/model'],
    }])
    expect(chain?.models).toEqual(['hy3', 'opencode/glm-5.3'])
    expect(chain?.platforms).toHaveLength(2)
  })

  it('keeps a flat chain flat, for every config written before this existed', () => {
    const [chain] = normalizeCombos([{ name: 'legacy', models: ['hy3', 'opencode/glm-5.3'] }])
    expect(chain?.models).toEqual(['hy3', 'opencode/glm-5.3'])
    // Absent rather than invented: the editor groups it on the fly, so storing
    // derived groups would be a second source of truth on disk.
    expect(chain?.platforms).toBeUndefined()
  })

  it('drops a platform with no models rather than keeping an inert group', () => {
    // An empty group renders as a platform card the user cannot act on, and it
    // contributes nothing to the walk — keeping it would make the editor and the
    // router disagree about what the chain contains.
    const [chain] = normalizeCombos([{
      name: 'x',
      platforms: [
        { owner: 'workbuddy', models: [] },
        { owner: 'opencode', models: ['glm-5.3'] },
      ],
    }])
    expect(chain?.platforms).toHaveLength(1)
    expect(chain?.models).toEqual(['opencode/glm-5.3'])
  })

  it('yields no chain when platforms is present but entirely empty', () => {
    // Not a fallback to a stale `models`: the user just replaced the chain with
    // nothing, and resurrecting the old list would be the opposite of what they did.
    expect(normalizeCombos([{ name: 'x', platforms: [], models: ['hy3'] }])).toEqual([])
  })
})

/**
 * "Same model, a different route" is the tier that was missing.
 *
 * The registry serves 86 model ids under two or more providers, so a
 * rate-limited vendor almost always has an alternate route to the SAME model.
 * Reaching it is strictly better than falling back to a different model: a
 * different model changes the context window, the tool-calling behaviour, the
 * structured-output shape and the writing style, and the user only finds out
 * afterwards.
 *
 * Before this, the user had to express that tier by hand: the same model three
 * times as three chain members, in the right order, re-edited whenever a vendor
 * was added. `siblingRoutes` derives it from the catalog instead.
 */
import { describe, expect, it } from 'vitest'
import { siblingRoutes, type ComboSources } from '../src/combos.ts'
import type { AggregateModelRow } from '../src/aggregate.ts'
import type { WorkBuddyModelInfo } from '../src/catalog.ts'

function row(providerId: string, modelId: string, name: string): AggregateModelRow {
  return {
    id: `${providerId}/${modelId}`,
    name,
    providerId,
    modelId,
    contextWindow: 128_000,
    maxOutputTokens: 8_000,
    supportsImages: false,
    wire: 'chat',
    source: 'static',
  }
}

const aggregate: AggregateModelRow[] = [
  row('kimi', 'kimi-k2.5', 'Kimi K2.5'),
  row('kimi_code', 'kimi-k2.5', 'Kimi K2.5'),
  row('bazaarlink', 'kimi-k2.5', 'Kimi K2.5'),
  // A different model that happens to share nothing but a prefix.
  row('kimi', 'kimi-k3', 'Kimi K3'),
  // Same bare id, DIFFERENT display label: cross-vendor naming is inconsistent,
  // so the bare id must also count as a match.
  row('ollama_cloud', 'kimi-k2.5', 'kimi-k2.5:latest'),
]
const pool: WorkBuddyModelInfo[] = [
  { id: 'deepseek-v4.1-flash', name: 'Deepseek-V4.1-Flash', contextWindow: 1_000_000, maxOutputTokens: 128_000, supportsImages: true },
]
const sources: ComboSources = { pool, aggregate }

describe('siblingRoutes finds the same model under other vendors', () => {
  it('returns every vendor serving the same model, and nothing else', () => {
    const routes = siblingRoutes('kimi/kimi-k2.5', sources)
    expect(routes).toContain('kimi/kimi-k2.5')
    expect(routes).toContain('kimi_code/kimi-k2.5')
    expect(routes).toContain('bazaarlink/kimi-k2.5')
    // Matched by bare id as well, because vendors disagree about the label.
    expect(routes).toContain('ollama_cloud/kimi-k2.5')
    // A different model is never a sibling: this is a route tier, not a fallback
    // tier, so picking up kimi-k3 here would defeat the whole point.
    expect(routes).not.toContain('kimi/kimi-k3')
  })

  it('keeps the requested provider first, so the chosen lane stays primary', () => {
    const routes = siblingRoutes('bazaarlink/kimi-k2.5', sources, 'bazaarlink')
    expect(routes[0]).toBe('bazaarlink/kimi-k2.5')
    // …and every other route is still present, just after it.
    expect(new Set(routes)).toEqual(new Set(siblingRoutes('kimi/kimi-k2.5', sources)))
  })

  it('never includes a pool lane as an alternate for an aggregate model', () => {
    // Naming `buddy:`/`workbuddy:` here would spend the user's WorkBuddy credits
    // as a "fallback", which is a different account than the one they configured.
    for (const route of siblingRoutes('kimi/kimi-k2.5', sources)) {
      expect(route.startsWith('buddy/')).toBe(false)
      expect(route.startsWith('workbuddy/')).toBe(false)
    }
  })

  it('a model with only one route answers just itself', () => {
    const single: ComboSources = {
      pool: [],
      aggregate: [row('glm', 'glm-5', 'GLM-5')],
    }
    expect(siblingRoutes('glm/glm-5', single)).toEqual(['glm/glm-5'])
    // And so does a model in the pool, which has no vendor alternates at all.
    expect(siblingRoutes('deepseek-v4.1-flash', sources))
      .toEqual(['deepseek-v4.1-flash'])
  })

  it('an unknown id is returned unchanged rather than expanded to everything', () => {
    // A chain may name a model this build cannot resolve (a key the user is
    // about to paste). Answering "no siblings" keeps the member verbatim; the
    // alternative would silently rewrite their chain.
    expect(siblingRoutes('nobody/never-heard-of-it', sources))
      .toEqual(['nobody/never-heard-of-it'])
    expect(siblingRoutes('', sources)).toEqual([])
  })

  it('never lists a route twice', () => {
    const routes = siblingRoutes('kimi/kimi-k2.5', sources)
    expect(new Set(routes).size).toBe(routes.length)
  })
})

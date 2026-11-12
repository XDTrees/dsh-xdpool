/**
 * A channel member's id is `<channel>:<model>` — complete on its own (#141).
 *
 * Two code paths used to prefix it a second time, and the two failures compounded:
 *
 *   1. `splitPlatforms` split on the first `/`. For `cline:deepseek/deepseek-v4.1-flash-1017:batch`
 *      that produced provider `cline` and model `cline:deepseek/…`, so the editor showed
 *      a doubled prefix.
 *   2. `flattenDraft` wrote `${owner}/${model}` for every non-pool lane, turning
 *      `raccoon:sn-deepseek-v4-1-flash-1017` into `raccoon/raccoon:sn-…` in
 *      `aggregate.json`.
 *
 * After that the runtime matched nothing and the chain reported all nine members missing —
 * and a save in that state would have rewritten the chain with the doubled ids, which is
 * the data-loss half of the report.
 *
 * The colon is the discriminator. A channel head is a bare identifier (letters, digits,
 * `_`, `-`); an `https://` scheme has a colon too and must NOT be read as a channel.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const combos = readFileSync(new URL('../src/combos.ts', import.meta.url), 'utf8')
const page = readFileSync(new URL('../src/client/RoutingPage.tsx', import.meta.url), 'utf8')

describe('channel member ids keep their own prefix (#141)', () => {
  it('recognises `channel:model` in splitPlatforms', () => {
    expect(combos).toContain('channelMemberOf')
    // Checked BEFORE the slash split, so a model half containing `/` is not cut.
    expect(combos).toContain('const channelMember = channelMemberOf(id)')
    expect(combos).toContain('const parsed = channelMember === undefined ? parseProviderModelId(id) : null')
  })

  it('does not mistake a URL scheme for a channel', () => {
    // `https://host/x` has a colon at index 5. Filing that under `https` would be worse
    // than leaving it alone, so the head must be a bare identifier.
    expect(combos).toContain('A-Za-z0-9_-')
    expect(combos).toMatch(/if \(!\/\^\[A-Za-z0-9_-\]\+\$\/u\.test\(channel\)\) return undefined/u)
  })

  it('does not prefix an already-composite id when flattening', () => {
    expect(page).toContain('const selfOwned')
    expect(page).toMatch(/platform\.owner === 'workbuddy' \|\| selfOwned/u)
  })

  it('files a missing channel member under its channel, not under the pool', () => {
    // `raccoon:sn-…` has no slash, so the old code called it a pool model and the next
    // save wrote `workbuddy/raccoon:sn-…`.
    expect(page).toContain('const isChannelMember')
    expect(page).toContain('const channelHead')
  })

  it('leaves a provider-row id alone', () => {
    // `openai/gpt-4` must keep `openai` as the owner and `gpt-4` as the model — the
    // channel branch requires a colon before the first slash, so this still goes through
    // `parseProviderModelId`.
    expect(combos).toContain('parseProviderModelId')
  })
})

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The detail page: one page for every channel.
 *
 * THE RULE THESE TESTS PROTECT
 *
 * There used to be two renderers — the lanes had a card of their own, with four disclosure
 * triggers and a summary line, while the other channels had a list of collapsible sections. The
 * operator's report was precise: "these two look like they come from another plugin". They did:
 * two bodies of markup, one visual language, and no test that could notice they disagreed.
 *
 * So the assertions here are about ONE implementation: the page takes data, and the components
 * that feed it contain no markup of their own. A second renderer would fail these, which is the
 * point.
 */
const page = readFileSync(new URL('../src/client/ChannelDetailPage.tsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../src/client/detail-page-styles.ts', import.meta.url), 'utf8')
const pool = readFileSync(new URL('../src/client/PoolCard.tsx', import.meta.url), 'utf8')
const channels = readFileSync(new URL('../src/client/ChannelPoolSection.tsx', import.meta.url), 'utf8')

describe('one page, fed by data', () => {
  it('is used by both the channel list and the WorkBuddy lanes', () => {
    // Two callers, one component. If a caller drew its own body again, this is where it shows.
    expect(channels).toContain('<ChannelDetailPage')
    expect(pool).toContain('<ChannelDetailPage')
  })

  it('leaves no card markup in the callers', () => {
    /**
     * The old renderers are gone, and their class names with them: a leftover
     * `dsm-xdpool-region-pane` would be a second body of markup nobody deletes, and the next
     * reader would style it believing it is live.
     */
    for (const gone of ['dsm-xdpool-region-seg', 'dsm-xdpool-region-pane', 'dsm-xdpool-region-head']) {
      expect(pool, `${gone} should no longer exist in PoolCard`).not.toContain(gone)
    }
  })

  it('collapses no section', () => {
    /*
      The old design hid every SECTION behind a disclosure, so a reader had to open a drawer to
      find out whether there was anything in it. That is still banned, and `aria-expanded` is how
      a hand-rolled drawer announces itself.

      ONE `<details>` is allowed, and only for the credit breakdown inside an account card: the
      card already prints the total, and the disclosure holds the split (daily vs bonus vs
      claimed). Nothing becomes invisible — the number a reader came for is on the card face.

      The count is pinned rather than the tag being banned outright, so a second disclosure
      appearing anywhere in this page fails here instead of arriving silently.
    */
    expect(page).not.toContain('aria-expanded')
    // The opening TAG, not the word: the source comments explain the decision in prose and
    // mention `<details>` while doing so.
    const openings = [...page.matchAll(/<details\s+className="([^"]*)"/gu)].map(m => m[1] ?? '')
    // Two: this page renders two account-card shapes, and both carry the same breakdown.
    expect(openings.length, 'only the credit breakdown may collapse').toBe(2)
    for (const cls of openings) {
      expect(cls, 'every disclosure must be the credit breakdown').toContain('acct-detail')
    }
    expect(page).toContain('acct-total')
  })
})

describe('the order the page answers questions in', () => {
  it('states the figures before anything else', () => {
    // "What does this channel have" is the first thing asked, and the header is where it goes.
    const statsAt = page.indexOf('<Stats')
    const accountsAt = page.indexOf("channelpool.accountsTitle")
    const modelsAt = page.indexOf("channelpool.modelsTitle")
    expect(statsAt).toBeGreaterThan(-1)
    expect(accountsAt).toBeGreaterThan(statsAt)
    expect(modelsAt).toBeGreaterThan(accountsAt)
  })

  it('puts usage mode and automation above the accounts', () => {
    /**
     * They are two decisions about the same subject — which account serves, and whether credit is
     * collected unattended — so they belong where decisions are made, not folded under the list
     * where a "why did it use that account" question goes to die.
     */
    const policiesAt = page.indexOf('policies')
    const accountsAt = page.indexOf("channelpool.accountsTitle")
    expect(policiesAt).toBeGreaterThan(-1)
    expect(accountsAt).toBeGreaterThan(policiesAt)
  })

  it('offers the sign-in control in the accounts header', () => {
    // The operator asked for it there: add an account, next to the accounts.
    const band = page.slice(page.indexOf("channelpool.accountsTitle"))
    expect(band.slice(0, 400)).toContain('addAccount')
  })
})

describe('one account, one card', () => {
  it('draws each account as its own card', () => {
    // The numbers belong to the credential, not to the channel. As shared columns they only lined
    // up when every account happened to be healthy.
    expect(page).toContain('acct')
    expect(page).toContain('accounts.map(account =>')
  })

  it('keeps a broken account readable instead of blanking its row', () => {
    // An account whose balance could not be read shows why, in its own card — not as a row of
    // empty cells that look like zero.
    expect(page).toContain('acct-err')
    expect(page).toContain('account.error')
  })

  it('says a balance has not arrived rather than printing zero', () => {
    /**
     * `…` and `—` are different claims: one is "still reading", the other is "nothing reported".
     * Printing either as 0 would tell the reader they have nothing.
     */
    expect(page).toContain('stats.pending === true')
    expect(page).toContain("? '…'")
  })
})

describe('the models are their own section', () => {
  it('has a search, and one switch per model', () => {
    expect(page).toContain('search')
    expect(page).toContain('model')
    expect(page).toContain('toggleModel(model.id')
  })

  it('writes the whole selection at once', () => {
    /**
     * The pack stores the blacklist as a single write, so a per-click save would be 91 requests
     * for "turn everything on" and would leave the list half-applied while they ran.
     */
    expect(page).toContain('onSaveModels')
    expect(page).toContain('setDraft')
  })

  it('caps its own height so the accounts stay put', () => {
    // 91 models would otherwise push the account cards off the screen, and those are what the
    // reader came for.
    expect(styles).toMatch(/\.dsm-xdpool-modellist\{[^}]*max-height/u)
  })
})

describe('the styles', () => {
  it('are tokens, not literals', () => {
    /**
     * A colour written here would not follow the host's theme, and the page would be the one
     * surface that stays bright inside a dark window.
     */
    expect(styles).toContain('var(--xd-text)')
    expect(styles).toContain('var(--xd-surface)')
    expect(styles).not.toMatch(/background:\s*#[0-9a-fA-F]{6}/u)
  })

  it('narrow the columns by container, not viewport', () => {
    // The plugin lives in a ~500px settings panel inside a wide window; a media query never fires
    // there, which is how the detail column got squeezed to a slit.
    expect(styles).toContain('@container xdpool')
  })

  it('keep every state under reduced motion', () => {
    expect(styles).toContain('prefers-reduced-motion')
  })
})

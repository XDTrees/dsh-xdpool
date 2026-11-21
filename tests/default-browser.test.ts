import { describe, expect, it } from 'vitest'
import { defaultBrowser } from '../src/default-browser.ts'

/**
 * The browser a sign-in window appears in.
 *
 * The other channels in this plugin hand a URL to `window.open`, so they always appear in the
 * browser the user actually uses. The two lanes that drive one themselves started whichever came
 * first in a fixed list — Chrome ahead of Edge — so the same user got Edge for thirteen channels
 * and Chrome for two, for no reason they could see.
 */
describe('the default browser', () => {
  it('answers with a real executable or nothing', () => {
    // On a machine with a default set, the answer must be launchable — a name without a path
    // would make the caller fall back for no reason.
    const browser = defaultBrowser()
    if (browser === undefined) return
    expect(browser.path).toMatch(/\.exe$/iu)
    expect(browser.name).not.toBe('')
  })

  it('never answers Firefox as a path to launch', () => {
    /**
     * Firefox has no DevTools protocol of this shape, so driving it would open a window this
     * cannot attach to — and a sign-in that silently cannot be captured is worse than falling
     * back to a browser that can.
     */
    const browser = defaultBrowser()
    if (browser === undefined) return
    expect(browser.path.toLowerCase()).not.toContain('firefox')
  })

  it('names the browser it found', () => {
    const browser = defaultBrowser()
    if (browser === undefined) return
    // The name is only for the progress line; what matters is that it is not the raw path.
    expect(browser.name.length).toBeLessThan(browser.path.length)
  })
})

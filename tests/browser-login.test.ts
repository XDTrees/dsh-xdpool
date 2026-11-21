import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The browser sign-in, and the details that decide whether it works.
 *
 * A card that asks for a pasted token makes the user open devtools on a page they have already
 * signed into. The reference implementation does the opposite: start a browser, let the user sign
 * in there, and read the credential out afterwards.
 *
 * Each case below is a detail that fails in a way which reads like something else:
 *
 *   1. Without `detached` + `unref()` the window dies when DSH restarts — which is exactly when a
 *      user restarts, mid-login.
 *   2. A fixed debugging port collides; port 0 plus `DevToolsActivePort` is the only reliable way
 *      to find it, and a browser that starts without writing it was blocked by antivirus.
 *   3. Reaching into the user's own profile would read cookies belonging to everything else.
 */
const browser = readFileSync(new URL('../src/browser-login.ts', import.meta.url), 'utf8')

describe('the window outlives the request', () => {
  it('detaches the child and unreferences it', () => {
    // Both are needed: `detached` puts it in its own process group, `unref` stops the event loop
    // from keeping a handle on it.
    expect(browser).toContain('detached: true')
    expect(browser).toContain('child.unref()')
  })

  it('gives the browser a profile of its own', () => {
    // Reading the user's real profile would reach cookies for everything else on the machine.
    expect(browser).toContain('--user-data-dir=')
    expect(browser).toContain('login-profiles')
  })

  it('sweeps old profiles', () => {
    // A profile holds real cookies; leaving them forever is clutter and a small liability.
    expect(browser).toContain('sweepLoginProfiles')
  })
})

describe('finding the debugging port', () => {
  it('lets the browser choose, then reads where it said', () => {
    // A fixed port collides with whatever else is running on the machine.
    expect(browser).toContain('--remote-debugging-port=0')
    expect(browser).toContain('DevToolsActivePort')
  })

  it('distinguishes "blocked" from "never started"', () => {
    /**
     * A browser that starts and never writes the port file was stopped by security software —
     * a different problem, with a different fix, from an executable that is not there.
     */
    expect(browser).toContain('没写出调试端口')
  })

  it('clears the lock files a crashed run leaves behind', () => {
    // These make a new process appear to start and then do nothing.
    for (const name of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
      expect(browser, name).toContain(name)
    }
  })
})

describe('reading the credential', () => {
  it('picks the tab on the vendor host, not about:blank', () => {
    /**
     * Evaluating in `about:blank` throws a cross-origin `SecurityError` that reads like a broken
     * CDP connection.
     */
    expect(browser).toContain('pickLoginPage')
    expect(browser).toContain('hostFragment')
  })

  it('keeps polling while the user works', () => {
    // The token appears after their last click; one failed read means "still loading".
    expect(browser).toContain('waitForCredential')
  })
})

describe('the daily-browser door', () => {
  it('opens the user\'s own browser without a throwaway profile', () => {
    /**
     * Google refuses to sign in from a browser without the user's Google session, so a channel
     * whose sign-in offers a Google button needs this second door.
     */
    expect(browser).toContain('openInDefaultBrowser')
  })

  it('never throws when no browser is available', () => {
    /**
     * A missing browser must not become an exception the caller did not ask for: `spawn` reports
     * failure asynchronously, and a throw here would happen on a route that is already mid-answer.
     * Both doors answer `undefined` instead, which the card renders as "no browser found".
     */
    const section = browser.slice(browser.indexOf('export function openInDefaultBrowser'))
    const body = section.slice(0, 600)
    expect(body).toContain('return undefined')
    expect(body).toContain('catch')
  })
})

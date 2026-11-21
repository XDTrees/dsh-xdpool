import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * A route nobody calls is a feature that cannot be used.
 *
 * Four check-in routes existed while the card had no way to reach them — the backend was
 * finished and the button still went to a pack RPC that has no branch for these channels.
 * These cases check the WIRING, not the behaviour: every route the host serves has to appear
 * in the client that is meant to call it.
 */
const section = readFileSync(new URL('../src/client/ChannelPoolSection.tsx', import.meta.url), 'utf8')
const channels = readFileSync(new URL('../src/client/ChannelsPage.tsx', import.meta.url), 'utf8')

/** The routes this plugin serves for its own channels. */
const OWN_CHECKIN_ROUTES = [
  'POOL_ASTUDIO_CHECKIN_PATH',
  'POOL_BAIZHI_CHECKIN_PATH',
  'POOL_MAGICREW_CN_CHECKIN_PATH',
  'POOL_MAGICREW_INTL_CHECKIN_PATH',
]

describe('the check-in routes', () => {
  it('are all reachable from the pool card', () => {
    /**
     * `credits.claimAll` is a pack RPC and answers "unsupported provider" for these channels.
     * Without an explicit call the button looks broken rather than absent.
     */
    for (const route of OWN_CHECKIN_ROUTES) {
      expect(section, route).toContain(route)
    }
  })

  it('are driven through one dispatcher, not four copies', () => {
    // One helper means the message handling and the balance refresh cannot drift apart.
    expect(section).toContain('ownCheckin')
    expect(section).toContain('OWN_CHECKIN_CHANNELS')
  })

  it('routes every channel that has its own check-in to it', () => {
    // A channel with a route but no entry in the set would silently fall through to the pack.
    for (const id of ['astudio', 'baizhi', 'autoclaw']) {
      expect(section, id).toContain(`'${id}'`)
    }
  })
})

describe('the sign-in routes', () => {
  it('are reachable from the login page', () => {
    /**
     * Every channel that takes a pasted credential must name its own session route, or the
     * page would post one vendor's token to another vendor's endpoint.
     */
    /**
     * AStudio posts to its own LOGIN route, not its session route: it is the only paste channel
     * that has to resolve what it was given — a bearer, a cookie string, or a whole document —
     * before it can store an account.
     */
    for (const route of [
      'POOL_ASTUDIO_LOGIN_PATH',
      'POOL_ACCIO_SESSION_PATH',
      'POOL_MONKEYCODE_CN_SESSION_PATH',
      'POOL_MONKEYCODE_INTL_SESSION_PATH',
      'POOL_BAIZHI_SESSION_PATH',
      'POOL_AUTOCLAW_INTL_SESSION_PATH',
      'POOL_AUTOCLAW_CN_SESSION_PATH',
    ]) {
      expect(channels, route).toContain(route)
    }
  })

  it('offers a paste box for every channel that needs one', () => {
    // The box is the only way in for these: their sign-in needs a captcha or a desktop flow
    // this page cannot host.
    expect(channels).toContain("phase: 'paste-credential'")
    for (const id of ['astudio', 'accio', 'monkeycode', 'baizhi', 'autoclaw']) {
      expect(channels, id).toContain(`channel.id === '${id}'`)
    }
  })
})

describe('the sign-in refresh', () => {
  // Read at module load, alongside the other sources this file inspects.
  const host = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')

  it('re-commits the adapter routes after a sign-in', () => {
    /**
     * The host caches each provider's model list and only rebuilds it when the route set is
     * re-committed. An adapter that re-reads its store is not enough: without `replace` the
     * freshly signed-in channel stays invisible until DSH restarts.
     */
    expect(host).toContain('ownAdapterRefresherSlot')
    expect(host).toContain('.replace([route])')
  })

  it('wires every paste channel to the refresher', () => {
    // A channel whose `adopted` is a no-op is a channel that needs a restart to appear.
    const wired = [...host.matchAll(/adopted: \(\) => \{ ownAdapterRefresherSlot\.current\?\.\(\) \}/gu)]
    expect(wired.length, 'one per own-channel route group').toBeGreaterThanOrEqual(5)
  })

  it('resets the slot before building fresh adapters', () => {
    // A remount must not call the previous mount's disposed handle.
    expect(host).toContain('ownAdapterRefresherSlot.current = undefined')
  })
})

describe('the balance routes', () => {
  it('are all reachable from the pool card', () => {
    // A balance the card cannot ask for is a balance it never shows.
    for (const route of [
      'POOL_ASTUDIO_WALLET_PATH',
      'POOL_ACCIO_QUOTA_PATH',
      'POOL_MONKEYCODE_CN_WALLET_PATH',
      'POOL_MONKEYCODE_INTL_WALLET_PATH',
      'POOL_BAIZHI_WALLET_PATH',
      'POOL_AUTOCLAW_INTL_WALLET_PATH',
      'POOL_AUTOCLAW_CN_WALLET_PATH',
    ]) {
      expect(section, route).toContain(route)
    }
  })
})

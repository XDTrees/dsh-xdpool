/**
 * The model picker groups by provider, and this plugin registers one provider
 * per region. The fallback catalog is installed before any account exists, so a
 * region with no discovered credential used to advertise a whole roster whose
 * every request died at the upstream with "no account" — visible, selectable,
 * and impossible to hide from the card (the card refuses an empty selection and
 * the catalog reads an empty list as "everything").
 *
 * Registration is therefore decided BEFORE the adapters are built: the host has
 * no un-register path for a live provider, and
 * `ctx.llm.registerConfigurableProviders` is all-or-nothing, so a region that
 * must not appear has to be skipped up front — including its directory entry,
 * which is what the settings form renders.
 *
 * The host entry cannot be imported here (it pulls in the whole runtime), so the
 * assertions read the source text, the same way `provider-registration.test.ts`
 * does.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const hostSource = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')

function gateIndex(): number {
  const at = hostSource.indexOf('const accountRegions = await')
  expect(at).toBeGreaterThan(-1)
  return at
}

describe('a region without a discovered account registers no provider', () => {
  it('scans the pool before the adapters are built', () => {
    const registration = hostSource.indexOf('const adaptersByRegion = {')
    expect(registration).toBeGreaterThan(-1)
    expect(gateIndex()).toBeLessThan(registration)
    // The pool's own scan, not a second notion of "an account": the region gate
    // and a later `rescan()` must never disagree about who is signed in.
    const gate = hostSource.slice(gateIndex(), registration)
    expect(gate).toContain('await core.pool.scan()')
    expect(gate).toContain('regionOf(account.credential.domain)')
  })

  it('gates both region registrations on the scanned set', () => {
    expect(hostSource).toMatch(/releaseAdapterCn = accountRegions\.has\('cn'\)\s*\n\s*\? ctx\.llm\.registerAdapter/)
    expect(hostSource).toMatch(
      /releaseAdapterGlobal = accountRegions\.has\('global'\)\s*\n\s*\? ctx\.llm\.registerAdapter/,
    )
  })

  it('leaves the aggregate and free lanes unconditional', () => {
    // Neither lane draws on a discovered WorkBuddy account — the aggregate lane
    // holds the user's own key and the free lane a pooled gateway credential —
    // so the region gate must not touch them.
    expect(hostSource).toMatch(/releaseAdapterAggregate = ctx\.llm\.registerAdapter/)
    expect(hostSource).toMatch(/releaseAdapterFree = ctx\.llm\.registerAdapter/)
  })

  it('keeps the settings directory in step with the adapters', () => {
    // A registered adapter with no directory entry loses its settings form; a
    // directory entry with no adapter offers the form for a dead region. Both
    // list entries follow the same set.
    expect(hostSource).toMatch(/\.\.\.\(accountRegions\.has\('cn'\)/)
    expect(hostSource).toMatch(/\.\.\.\(accountRegions\.has\('global'\)/)
  })

  it('falls back to registering both regions when the scan itself fails', () => {
    // A filesystem quirk must not hide a region the user can actually use.
    expect(hostSource).toContain('account scan before registration failed; registering both regions')
    expect(hostSource).toContain("new Set<WorkBuddyRegion>(['cn', 'global'])")
  })
})

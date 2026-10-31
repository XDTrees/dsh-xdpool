/**
 * billion-context is not this plugin's job any more.
 *
 * The feature shipped as a fifth page that observed a SEPARATE plugin's loopback
 * proxy. It was removed on request, and this file exists because "removed" is a
 * claim that decays: the row in `cordis.patch.yml` outlived the feature once
 * already (kept `disabled: true` "for addressability"), and a stray
 * `optionalDependencies` entry would keep installing a package on every user's
 * machine for a page that no longer renders.
 *
 * So the assertions below are about the whole surface, not one file: no page, no
 * route, no locale keys, no stylesheet, no dependency, no mount.
 */
import { readFileSync, existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const ROOT = new URL('..', import.meta.url)
function read(path) {
  return readFileSync(new URL(path, ROOT), 'utf8')
}
function exists(path) {
  return existsSync(new URL(path, ROOT))
}

describe('the billion-context surface is gone', () => {
  it('has no page, no reader and no mount module', () => {
    expect(exists('src/client/BillionPage.tsx')).toBe(false)
    expect(exists('src/billion.ts')).toBe(false)
    expect(exists('src/billion-mount.ts')).toBe(false)
  })

  it('has no relay route and no document type', () => {
    // The route answered `state: 'missing'` on a machine without the other
    // plugin — a first-class state for a feature this plugin no longer has.
    expect(read('src/status-paths.ts')).not.toContain('POOL_BILLION_PATH')
    expect(read('src/web-status.ts')).not.toContain('billionDocument')
    expect(read('src/index.ts')).not.toContain('billion')
  })

  it('has no tab, no page arm and no style block', () => {
    const card = read('src/client/PoolCard.tsx')
    expect(card).not.toContain("id: 'billion'")
    expect(card).not.toContain('BillionPage')
    expect(read('src/client/styles.ts')).not.toContain('BILLION_CARD_CSS')
  })

  it('has no locale keys left behind', () => {
    const locales = read('src/client/locales.ts')
    expect(locales).not.toMatch(/'billion\./u)
    expect(locales).not.toMatch(/'shell\.(tabBillion|subBillion)'/u)
    // The neighbours that shared the block must still be there: a removal that
    // takes two keys with it is how `channelpool.title` went missing once.
    expect(locales).toContain("'channelpool.title'")
    expect(locales).toContain("'channelpool.accountCount'")
  })

  it('no longer installs the package or mounts a duplicate row', () => {
    // Both halves of the old wiring: the dependency (installs on every machine)
    // and the patch row (which the host ran to `failed` when the real plugin was
    // present, because a cordis service can only be registered once).
    const manifest = JSON.parse(read('package.json'))
    expect(manifest.optionalDependencies?.['billion-context']).toBeUndefined()
    const patch = read('cordis.patch.yml')
    expect(patch).not.toMatch(/^- id: billion-context-xdpool$/mu)
    // The provider row this plugin DOES own must still be registered.
    expect(patch).toContain('- id: llm-xdpool')
  })
})

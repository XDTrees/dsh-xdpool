/**
 * Three defects reported against 2.6.4, each with a distinct root cause.
 *
 * #134 / #135 — the postinstall script could make a WORKING install look broken.
 * #133 — clicking the credit dot on a fresh session opened an empty panel.
 * #122 — an empty `enabledModelIds` array was read as "serve nothing".
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const linkScript = readFileSync(new URL('../scripts/link-host-peers.mjs', import.meta.url), 'utf8')
const dot = readFileSync(new URL('../src/client/CreditDot.tsx', import.meta.url), 'utf8')
const catalog = readFileSync(new URL('../src/catalog.ts', import.meta.url), 'utf8')

describe('postinstall must never fail a working install (#134, #135)', () => {
  it('does not exit non-zero when the host is not visible', () => {
    // `ENFORCE` + `process.exit(1)` is what rolled back working upgrades: a packaged host
    // keeps its dependencies inside `app.asar`, which `existsSync` cannot see into from a
    // plain Node process, and resolves them itself at runtime. "Not found from here" is
    // not evidence of a broken install.
    const fails = [...linkScript.matchAll(/process\.exit\(([^)]*)\)/gu)]
    expect(fails).toHaveLength(0)
    // And the old enforcement switch is gone entirely.
    expect(linkScript).not.toContain('ENFORCE')
  })

  it('says what was not found instead of calling it a failure', () => {
    expect(linkScript).toContain('not visible from this process')
    expect(linkScript).toContain('Not treated as an install failure')
  })

  it('checks resolution with ESM, not CJS (#135)', () => {
    // `@earendil-works/pi-ai` is ESM-only: its `exports` has `types` and `import` but no
    // `require` and no `./package.json` subpath, so `require.resolve` throws
    // ERR_PACKAGE_PATH_NOT_EXPORTED for a package that is installed and importable. That
    // false negative failed 2.6.4's self-check on Windows.
    expect(linkScript).toContain('import.meta.resolve')
    expect(linkScript).not.toContain('REQUIRE.resolve')
    expect(linkScript).not.toContain('createRequire')
  })

  it('looks for the host on every platform, and beside the running binary (#134)', () => {
    // `HARNESS_BASES` used to be Windows-only, so the whole loop was skipped on macOS.
    expect(linkScript).toContain('/Applications/DeepSeek Harness.app/Contents/Resources')
    // Built with `join`, so the literal is the segment list rather than a POSIX path.
    expect(linkScript).toContain("'share', 'deepseek-harness'")
    // A non-default install drive is only reachable through the running executable.
    expect(linkScript).toContain('process.execPath')
  })

  it('finds a peer that is already linked, so a re-run is idempotent', () => {
    // The old `locate()` used CJS resolution, which reports an ESM-only peer as absent —
    // so a second postinstall tried to rebuild links it had just made.
    expect(linkScript).toContain("join(PACKAGE_ROOT, 'node_modules', name)")
  })
})

describe('the credit dot always answers its own click (#133)', () => {
  it('never returns null for the whole component', () => {
    // The reported symptom: "clicking the green credit icon opens a blank page". A fresh
    // session has no snapshot yet, and `return null` unmounted the trigger along with the
    // panel, leaving an empty popover shell.
    expect(dot).not.toMatch(/if \(failed \|\| snapshot === undefined\) return null/u)
  })

  it('explains a missing snapshot inside the panel', () => {
    expect(dot).toContain('dot.loading')
    expect(dot).toContain('dot.loadFailed')
    expect(dot).toContain('dsm-xdpool-dotpanel-empty')
  })

  it('reads an unknown balance as grey, never as "you are fine"', () => {
    expect(dot).toMatch(/const ready = snapshot !== undefined && !failed/u)
    expect(dot).toMatch(/const alive = ready &&/u)
  })
})

describe('an empty model selection means "all", not "none" (#122)', () => {
  it('treats `[]` like `undefined`', () => {
    // DSH 0.2.2-rc.1 writes `enabledModelIds: []` before the picker is ever used. Read as a
    // real selection, it narrowed the catalog to zero models and every request reported
    // `has no configured model "<id>"` for a model the card was listing.
    expect(catalog).toContain('enabled.length === 0 ? undefined')
  })
})

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * Every sign-in must actually verify what it was given.
 *
 * Three of the six channels accepted ANY string and stored it as an account:
 *
 *   AStudio    — had no verification at all.
 *   MagiCrew   — saved first, then read the models without checking the result.
 *   Accio      — checked only `error`, but the gateway answers a bad token with `success:false`
 *                and no models rather than an HTTP failure.
 *
 * The damage is the same in all three: the card says "signed in", the picker fills, and the
 * first message fails with an auth error on an account that looked fine.
 *
 * These cases read the route sources rather than driving HTTP, because the point is the ORDER
 * (verify before save) and the CONDITION (which signal counts as a refusal) — both of which are
 * visible in the source and awkward to observe through a fake vendor.
 */
/**
 * The source AFTER the import block.
 *
 * Comparing `indexOf` over the whole file would count the import statement itself as a call,
 * which made every "A comes before B" assertion meaningless when A is imported first.
 */
function bodyOf(source: string): string {
  const NL = String.fromCharCode(10)
  /**
   * Drop the import block line by line.
   *
   * A single `indexOf('export ')` is not enough: a file may import, then declare a constant,
   * then export. Removing every import statement (including a multi-line one's continuation
   * lines) leaves the code under test, and only that.
   */
  const lines = source.split(NL)
  const kept: string[] = []
  let insideImport = false
  for (const line of lines) {
    const trimmed = line.trim()
    if (insideImport) {
      if (trimmed.endsWith("'") || trimmed.endsWith('"')) insideImport = false
      continue
    }
    if (/^import\s/u.test(trimmed)) {
      // A one-line import ends with a quote; a multi-line one does not.
      if (!trimmed.endsWith("'") && !trimmed.endsWith('"')) insideImport = true
      continue
    }
    kept.push(line)
  }
  return kept.join(NL)
}

const routes = {
  astudio: bodyOf(readFileSync(new URL('../src/astudio-routes.ts', import.meta.url), 'utf8')),
  accio: bodyOf(readFileSync(new URL('../src/accio-routes.ts', import.meta.url), 'utf8')),
  baizhi: bodyOf(readFileSync(new URL('../src/baizhi-routes.ts', import.meta.url), 'utf8')),
  autoclaw: bodyOf(readFileSync(new URL('../src/autoclaw-routes.ts', import.meta.url), 'utf8')),
  monkeycode: bodyOf(readFileSync(new URL('../src/monkeycode-routes.ts', import.meta.url), 'utf8')),
}

describe('verification comes before storage', () => {
  it('AStudio probes the catalogue before saving', () => {
    const source = routes.astudio
    // The probe must exist AND come first: a save before the probe stores what it later refuses.
    const probe = source.indexOf('astudioCatalog')
    const save = source.indexOf('saveAstudioAccount')
    expect(probe).toBeGreaterThan(0)
    expect(save).toBeGreaterThan(0)
    expect(probe, 'the probe must run before the save').toBeLessThan(save)
  })


})

describe('the refusal condition', () => {
  it('AStudio treats an ERROR as the answer, even with fallback models attached', () => {
    /**
     * `astudioCatalog` falls back to the measured table when the live read fails, so a 401
     * arrives WITH seven models. A `models.length === 0` test therefore never fired.
     */
    expect(routes.astudio).toContain('probe.error !== undefined')
    expect(routes.astudio).not.toContain('probe.error !== undefined && probe.models.length === 0')
  })



  it('Accio treats an empty list as a refusal too', () => {
    /**
     * The gateway answers a bad token with `success:false` and no models rather than an HTTP
     * failure, so `error` alone is not enough.
     */
    expect(routes.accio).toContain('catalog.models.length === 0')
  })
})

describe('the channels that already verified', () => {


  it('MonkeyCode exchanges the session for a key before saving', () => {
    const source = routes.monkeycode
    const exchange = source.indexOf('monkeycodeExchangeKey')
    const save = source.indexOf('saveMonkeycodeCredential')
    expect(exchange).toBeGreaterThan(0)
    expect(exchange).toBeLessThan(save)
  })

  it('Baizhi reads the catalogue before saving', () => {
    const source = routes.baizhi
    const read = source.indexOf('baizhiCatalog')
    const save = source.indexOf('saveBaizhiCredential')
    expect(read).toBeGreaterThan(0)
    expect(read).toBeLessThan(save)
  })

  it('AutoClaw reads the catalogue before saving', () => {
    const source = routes.autoclaw
    const read = source.indexOf('autoclawCatalog')
    const save = source.indexOf('saveAutoclawCredential')
    expect(read).toBeGreaterThan(0)
    expect(read).toBeLessThan(save)
  })
})

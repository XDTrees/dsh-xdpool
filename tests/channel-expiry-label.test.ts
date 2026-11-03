/**
 * A credential that has run out must say so, and must say it in red.
 *
 * Reported 2026-11-03: a CodeArts account displayed "启用 · 长期有效" while the
 * very same row reported `HTTP 400 APIG.0602 Bad request: the security token has
 * expired`. Both halves were wrong in a way that pointed at each other:
 *
 *   1. `expiryText` returned `channelpool.expiryNever` for ANY stamp in the
 *      past. `Math.ceil(days)` was negative, and the `days <= 0` branch reused
 *      the "no expiry" copy — so expired and channel-without-expiry were
 *      literally the same string. On a channel whose credentials carry no
 *      expiry at all that placeholder is honest; on an expired one it is a lie.
 *   2. Every sub-day remainder printed "1d". CodeArts mints ~2 h STS
 *      credentials, so the only rows with a real countdown were the ones that
 *      could never show it, and they then jumped straight to "never".
 *
 * Two assertions therefore matter together, and neither alone would have caught
 * it: the LABEL must differ from `expiryNever` once the stamp is past, and the
 * row must carry the error tone. Source-level, like `channel-pool-loading.test.ts`
 * — the component needs a DOM and an live RPC bridge, neither available here.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const section = readFileSync(new URL('../src/client/ChannelPoolSection.tsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../src/client/styles.ts', import.meta.url), 'utf8')
const locales = readFileSync(new URL('../src/client/locales.ts', import.meta.url), 'utf8')

/** The `expiryText` function body, bounded by the helper that follows it. */
const expiryTextBody = section.slice(
  section.indexOf('function expiryText('),
  section.indexOf('function expiryIsPast(') > section.indexOf('function expiryText(')
    ? section.indexOf('/** The vendor\'s currency')
    : section.indexOf('/** The vendor\'s currency'),
)

describe('an expired credential is not called "no expiry"', () => {
  it('returns the dedicated expired copy for a past stamp', () => {
    // The defect, precisely: this branch used to return `channelpool.expiryNever`.
    expect(expiryTextBody).toContain("channelpool.expiryExpired")
    expect(expiryTextBody).not.toMatch(
      /if \(remaining <= 0\) return t\?\.\('channelpool\.expiryNever'\)/u,
    )
    // The past branch must be reached BEFORE any "no expiry" fallback can win.
    const pastAt = expiryTextBody.indexOf('remaining <= 0')
    const hoursAt = expiryTextBody.indexOf('minutes < 60')
    expect(pastAt).toBeGreaterThan(-1)
    expect(pastAt).toBeLessThan(hoursAt)
  })

  it('keeps "no expiry" for stamps that carry none', () => {
    // The placeholder is still correct for channels with no expiry at all
    // (ZCode among them); dropping it outright would be the wrong fix.
    expect(expiryTextBody).toContain("channelpool.expiryNever")
    expect(expiryTextBody).toMatch(/expiresAt === undefined/u)
  })

  it('resolves below a day, because that is the range CodeArts lives in', () => {
    // `Math.ceil(days)` printed "1d" for everything under 24 h.
    expect(expiryTextBody).not.toMatch(/Math\.ceil\(\(expiresAt - Date\.now\(\)\) \/ 86_400_000\)/u)
    expect(expiryTextBody).toContain('60_000')
    expect(expiryTextBody).toContain('3_600_000')
    expect(expiryTextBody).toContain('86_400_000')
    expect(expiryTextBody).toContain('return `${minutes}m`')
    expect(expiryTextBody).toContain('return `${hours}h`')
  })
})

describe('the expired row is tinted like a problem', () => {
  it('sets the tone off the stamp, never off the label text', () => {
    // Reading the tone back out of the rendered string would compare a
    // translated value and break for every locale but the one tested.
    expect(section).toContain('function expiryIsPast(')
    expect(section).toMatch(/data-tone=\{expiryIsPast\(account\.expiresAt\)/u)
    expect(section).not.toMatch(/data-tone=\{expiryText\(/u)
  })

  it('has a rule for that tone, or the attribute renders as nothing', () => {
    expect(styles).toMatch(/\.dsm-xdpool-cpool-acctmeta\[data-tone=err\]/u)
  })
})

describe('both locales carry the new copy', () => {
  it('defines expiryExpired in the English and Chinese dictionaries', () => {
    const enDict = locales.slice(locales.indexOf('channelpool.expiryExpired') - 400)
    expect(locales).toMatch(/'channelpool\.expiryExpired': 'expired'/u)
    expect(locales).toMatch(/'channelpool\.expiryExpired': '已过期'/u)
    expect(enDict.length).toBeGreaterThan(0)
  })
})

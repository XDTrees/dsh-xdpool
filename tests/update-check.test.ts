import { describe, expect, it } from 'vitest'
import { compareVersions } from '../src/update-check.ts'

/**
 * Comparing the version this build runs against the published one.
 *
 * The panel has three honest answers — newer, current, could not check — and this is the half
 * that decides "newer". Getting the ordering wrong makes the panel claim an update exists when
 * it does not, or hide one that does.
 */
describe('version comparison', () => {
  it('orders patch releases', () => {
    expect(compareVersions('2.7.3', '2.7.2')).toBeGreaterThan(0)
    expect(compareVersions('2.7.2', '2.7.3')).toBeLessThan(0)
    expect(compareVersions('2.7.3', '2.7.3')).toBe(0)
  })

  it('compares numerically, not as text', () => {
    // Text ordering would put "2.7.9" after "2.7.10" — the bug this guards.
    expect(compareVersions('2.7.10', '2.7.9')).toBeGreaterThan(0)
    expect(compareVersions('2.10.0', '2.9.9')).toBeGreaterThan(0)
  })

  it('handles a shorter or longer version', () => {
    expect(compareVersions('2.8', '2.7.9')).toBeGreaterThan(0)
    expect(compareVersions('2.7.3.1', '2.7.3')).toBeGreaterThan(0)
  })

  it('treats a prerelease as older than its release', () => {
    // npm's own ordering: 2.7.3-rc.1 < 2.7.3, so a user on the prerelease IS offered the release.
    expect(compareVersions('2.7.3-rc.1', '2.7.3')).toBeLessThan(0)
    expect(compareVersions('2.7.3', '2.7.3-rc.1')).toBeGreaterThan(0)
  })

  it('ignores a leading v', () => {
    expect(compareVersions('v2.7.3', '2.7.3')).toBe(0)
  })

  it('is symmetric', () => {
    for (const [a, b] of [['2.7.3', '2.8.0'], ['1.0.0', '1.0.1'], ['3.0.0', '2.99.99']]) {
      expect(Math.sign(compareVersions(a!, b!)), `${a} vs ${b}`).toBe(-Math.sign(compareVersions(b!, a!)))
    }
  })
})

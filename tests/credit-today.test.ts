/**
 * The measured day total has three states and only one of them is a number.
 *
 *   - a file that recorded the day   -> a total;
 *   - a file with no entry for today -> `available: false`, because nothing OBSERVED it;
 *   - no file / unreadable / wrong shape -> the same `available: false`.
 *
 * The distinction that matters is the middle one. An observer that has not run must never
 * be reported as a measured zero: the panel prints a plain number for a measurement and a
 * `≈` for an estimate, so a fabricated zero would be the one thing it cannot take back.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readCreditsToday } from '../src/credit-today.ts'

const made: string[] = []

/** A fresh DSH home with cost-meter's statistics file (or without it). */
function homeWith(statistics: unknown): string {
  const home = mkdtempSync(join(tmpdir(), 'xdpool-today-'))
  made.push(home)
  if (statistics !== undefined) {
    const dir = join(home, 'storages', 'cost-meter')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'workbuddy-statistics.json'), JSON.stringify(statistics))
  }
  return home
}

/** A fixed clock, so "today" in a test is the day its fixture names. */
const NOW = new Date(2026, 10, 14, 15, 30, 0)

afterEach(() => {
  while (made.length > 0) {
    const dir = made.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

describe('readCreditsToday', () => {
  it('sums the day across every account that recorded one', async () => {
    const home = homeWith({
      accounts: {
        'cn:xdpool:a': { remaining: 4800, total: 5000, days: { '2026-11-14': 12, '2026-11-13': 298 } },
        'cn:xdpool:b': { remaining: 1900, total: 2000, days: { '2026-11-14': 51 } },
        // Another day only: it must not leak into today's figure.
        'global:xdpool:c': { remaining: 100, total: 100, days: { '2026-10-25': 241 } },
      },
    })
    const today = await readCreditsToday(home, NOW)
    expect(today.available).toBe(true)
    expect(today.day).toBe('2026-11-14')
    expect(today.total).toBe(63)
    // Two accounts carried a figure; the third did not, and is not counted.
    expect(today.accounts).toBe(2)
    expect(today.source).toBe('cost-meter')
  })

  it('reports "no record" -- not zero -- when the file has no entry for today', async () => {
    // The morning-after-restart case: the file exists, every account in it is real, and
    // none of them has been sampled since midnight.
    const home = homeWith({ accounts: { 'cn:xdpool:a': { days: { '2026-11-13': 298 } } } })
    const today = await readCreditsToday(home, NOW)
    expect(today.available).toBe(false)
    expect(today.total).toBeUndefined()
    expect(today.accounts).toBe(0)
    expect(today.day).toBe('2026-11-14')
  })

  it('treats a missing file as no record, because it is not an error either', async () => {
    const home = homeWith(undefined)
    expect(await readCreditsToday(home, NOW)).toEqual({
      day: '2026-11-14',
      accounts: 0,
      source: 'cost-meter',
      available: false,
    })
  })

  it('degrades to no record on a shape it does not recognise', async () => {
    // The file belongs to another repository, so every level is external: a shape change
    // must read as "unknown", never as a number derived from whatever happened to parse.
    const cases: unknown[] = [
      null,
      [],
      { accounts: null },
      { accounts: 'nope' },
      { accounts: { a: null } },
      { accounts: { a: { days: null } } },
      { accounts: { a: { days: { '2026-11-14': 'soon' } } } },
      { accounts: { a: { days: { '2026-11-14': -5 } } } },
    ]
    for (const shape of cases) {
      const home = homeWith(shape)
      const today = await readCreditsToday(home, NOW)
      expect(today.available).toBe(false)
      expect(today.total).toBeUndefined()
    }
  })

  it('reads the LOCAL day, so the figure does not roll over at UTC midnight', async () => {
    // 2026-11-14 has to mean the machine's 14th, not UTC's. A UTC key would show the
    // previous day's total for the first eight hours of a UTC+8 morning -- exactly when
    // someone checks whether an overnight run spent much.
    const home = homeWith({
      accounts: { 'cn:xdpool:a': { days: { '2026-11-14': 7, '2026-11-13': 100 } } },
    })
    const today = await readCreditsToday(home, new Date(2026, 10, 14, 0, 30, 0))
    expect(today.day).toBe('2026-11-14')
    expect(today.total).toBe(7)
  })

  it('writes an unreadable file off as no record instead of throwing', async () => {
    const home = mkdtempSync(join(tmpdir(), 'xdpool-today-'))
    made.push(home)
    const dir = join(home, 'storages', 'cost-meter')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'workbuddy-statistics.json'), '{ not json')
    const today = await readCreditsToday(home, NOW)
    expect(today.available).toBe(false)
  })
})

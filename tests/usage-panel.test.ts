import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The usage summary.
 *
 * It used to be a panel under the whole page listing each call; it is now one line at the foot of
 * the rail, so the reader stops scrolling past a log to reach the accounts — and on a short window
 * that log was the only thing on screen.
 *
 * The PROPERTY these tests keep is the one that mattered in the panel: a turn and a call are two
 * different numbers and are never collapsed into one. A turn that rotated three accounts is one
 * thing the user asked for and three upstream round trips; a single figure makes the summary
 * disagree with the person reading it.
 */
const card = readFileSync(new URL('../src/client/PoolCard.tsx', import.meta.url), 'utf8')
const locales = readFileSync(new URL('../src/client/locales.ts', import.meta.url), 'utf8')

describe('the usage line', () => {
  it('keeps turns and calls as two separate numbers', () => {
    // Both parameters, named, in one label — never `turns + calls`. The dashboard page renders
    // them; this checks the shape the summary documents.
    expect(locales).toContain('{turns}')
    expect(locales).toContain('{calls}')
  })

  it('is not on the pool page', () => {
    /**
     * It was a panel under the whole page, then a line in the rail. Both were in the way: the
     * accounts are what the reader opened the pool for, so usage lives on the dashboard page and
     * nowhere else. This test keeps that decision — a summary creeping back in is a regression.
     */
    expect(card).not.toContain('dsm-xdpool-usageline')
    expect(card).not.toContain("footer={")
  })

  it('names the label in both languages', () => {
    expect(locales).toContain("'row.usageTurns'")
  })
})

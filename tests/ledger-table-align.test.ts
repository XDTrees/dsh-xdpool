/**
 * A table whose header does not line up with its own cells reads as broken data,
 * not as a CSS problem.
 *
 * The ledger's numeric columns were left-aligned in the header and right-aligned
 * in the body, because `.dsm-xdpool-table th{text-align:left}` is specificity
 * (0,1,1) and `.dsm-xdpool-num{text-align:right}` is (0,1,0) — the more specific
 * rule won, and every numeric title sat at the far left of a column whose numbers
 * hugged the right edge. Two of four numeric headers were affected, which is why
 * the table looked "错位" rather than simply untidy.
 *
 * A selector fix alone is easy to regress, so this locks both halves: the header
 * and the body must be moved by the SAME pair of selectors, and the row payload
 * must stay a fixed-size tuple so a column cannot appear on one side only.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const styles = readFileSync(new URL('../src/client/styles.ts', import.meta.url), 'utf8')
const page = readFileSync(new URL('../src/client/LedgerPage.tsx', import.meta.url), 'utf8')

describe('numeric table columns line up with their headers', () => {
  it('right-aligns the header and the cell through selectors that beat the th rule', () => {
    // The pair is the point: bumping only one side reproduces the original bug.
    expect(styles).toContain('.dsm-xdpool-table th.dsm-xdpool-num,')
    expect(styles).toContain('.dsm-xdpool-table td.dsm-xdpool-num,')
  })

  it('no longer relies on the bare class, which the th rule always out-specified', () => {
    // (0,1,1) beats (0,1,0). Keeping the bare selector as the ONLY alignment for
    // a numeric column would silently reintroduce the shift.
    const rule = styles.slice(styles.indexOf('.dsm-xdpool-table th.dsm-xdpool-num,'))
    expect(rule.slice(0, 260)).toContain('text-align:right')
  })

  it('every numeric header carries the class that now works', () => {
    const headers = [...page.matchAll(/<th className="dsm-xdpool-num">([^<]*)</gu)]
    // The recent-calls table has four numeric columns (in / out / cached / ttft).
    expect(headers.length).toBeGreaterThanOrEqual(4)
  })

  it('the row payload is a fixed three-tuple, so a column cannot drift', () => {
    // Rendered through `.map`, so a `string[]` of the wrong length would shift
    // every numeric column against its title and no type would complain.
    expect(page).toContain('readonly [string, string, string]')
    expect(page).toMatch(/function tokenCells\(call: UsageCall\): readonly \[string, string, string\]/u)
  })
})

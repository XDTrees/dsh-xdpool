/**
 * Numeric table columns line up with their headers.
 *
 * The dashboard's tables are read column-wise — "what did that account spend" is
 * answered by scanning DOWN a column — so a header sitting at the left edge of a
 * column whose numbers hug the right edge does not read as untidy, it reads as
 * broken data.
 *
 * The specific bug this pins: `.dsm-xdpool-table th{text-align:left}` is
 * specificity (0,1,1) and `.dsm-xdpool-num{text-align:right}` is (0,1,0), so the
 * bare class could never win and every numeric title stayed left-aligned while
 * its cells went right.
 *
 * The newer half is the heat table: its cells are painted with an inline
 * background, so any rule that also set `text-align` on the cell class would be
 * cancelled by nothing and centre-aligned numbers would drift out of their own
 * column. The pair below is what keeps both tables honest.
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

  it('marks every numeric header in the per-account table with that class', () => {
    const headers = [...page.matchAll(/<th className="dsm-xdpool-num">/gu)]
    // Spendable / charged / granted / requests, plus each heat column and the
    // per-account footer. Four is the floor, not the count.
    expect(headers.length).toBeGreaterThanOrEqual(4)
  })

  it('centres heat cells on purpose, with a rule that says so', () => {
    // The heat table's numbers are inside a coloured box, so they are centred
    // rather than right-aligned — but that has to be a deliberate rule, not a
    // side effect of the inline style.
    expect(styles).toContain('.dsm-xdpool-dash-heat td.dsm-xdpool-dash-cell')
    const rule = styles.slice(styles.indexOf('.dsm-xdpool-dash-heat td.dsm-xdpool-dash-cell'))
    expect(rule.slice(0, 200)).toContain('text-align:center')
  })
})

describe('the per-account row cannot drift out of step with its header', () => {
  it('renders the same fixed set of cells for every account', () => {
    // The account table has seven columns. Rendering one of them conditionally
    // would shift every later cell against its title, and no type notices
    // because each cell is a separate JSX child.
    //
    // Anchored on the table's own class rather than on a column title: the class
    // is unique to this table, while "Account" appears in three of them and an
    // anchor on it silently measured the wrong table's header.
    const start = page.indexOf('dsm-xdpool-table dsm-xdpool-dash-table')
    expect(start, 'the per-account table must keep its own class').toBeGreaterThan(-1)
    const table = page.slice(start, page.indexOf('</table>', start))
    const header = table.slice(0, table.indexOf('</thead>'))
    const body = table.slice(table.indexOf('<tbody>'), table.indexOf('</tbody>'))
    // `/<th[\s>]/` and not `/<th/`: the bare pattern also matches `<thead>`,
    // which counted a phantom eighth column and would have hidden a real one.
    expect([...header.matchAll(/<th[\s>]/gu)]).toHaveLength(7)
    expect([...body.matchAll(/<td[\s>]/gu)]).toHaveLength(7)
  })
})

/**
 * A disabled primary button must not become invisible under the cursor.
 *
 * The model card's "保存" button appeared to vanish the moment the mouse moved
 * onto it. It was not vanishing — it was correctly disabled (nothing in the
 * draft differed from what the server last reported), and the disabled state
 * was being rendered unreadable by one CSS declaration:
 *
 *   .dsm-btn:disabled:hover{transform:none;background:transparent}
 *
 * At specificity (0,3,0) that beat `.dsm-btn-primary`'s (0,1,0) fill, so the
 * light background went transparent while the label stayed
 * `--dsw-alias-bg-layer-3` — a dark colour designed to sit ON that light fill.
 * Add `.dsm-btn:disabled{opacity:.4}` and you get dark text at 40% alpha on a
 * dark panel: legible nowhere, and only under hover, which is exactly when a
 * user reaches for it.
 *
 * The `background:transparent` was also doing nothing useful. Every variant
 * gates its hover background with `:not(:disabled)` already, so a disabled
 * button never acquires one to be undone. These assertions pin both halves:
 * the override is gone, and the gating that made it redundant is still there.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '..')
const styles = readFileSync(join(ROOT, 'src', 'client', 'styles.ts'), 'utf8')

/** Every declaration block whose selector list contains `selector`. */
function blocksFor(selector: string): string[] {
  const out: string[] = []
  const ruleRe = /([^{}]+)\{([^{}]*)\}/gu
  let m: RegExpExecArray | null
  while ((m = ruleRe.exec(styles)) !== null) {
    if (m[1].includes(selector)) out.push(m[2])
  }
  return out
}

describe('the disabled button hover state', () => {
  it('declares a disabled:hover rule at all', () => {
    expect(blocksFor('.dsm-btn:disabled:hover')).toHaveLength(1)
  })

  it('never overrides the background of a disabled button', () => {
    for (const body of blocksFor('.dsm-btn:disabled:hover')) {
      expect(body, 'a background here outranks .dsm-btn-primary and hides the label').not.toMatch(/background/)
    }
  })

  it('keeps the primary fill and its dark label paired', () => {
    const primary = blocksFor('.dsm-btn-primary').join('')
    expect(primary).toMatch(/background:var\(--dsw-alias-label-primary/)
    expect(primary).toMatch(/color:var\(--dsw-alias-bg-layer-3/)
  })
})

describe('the hover backgrounds that made the override redundant', () => {
  for (const variant of ['dsm-btn-outline', 'dsm-btn-ghost', 'dsm-btn-primary']) {
    it(`${variant} gates its hover background against :disabled`, () => {
      const hoverRules = styles
        .split('\n')
        .filter(line => line.includes(`.${variant}:hover`) && line.includes('{'))
      expect(hoverRules.length, `${variant} should declare a hover rule`).toBeGreaterThan(0)
      for (const line of hoverRules) {
        expect(line, `${variant}:hover must not apply to a disabled button`).toContain(':not(:disabled)')
      }
    })
  }
})

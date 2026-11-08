/**
 * The backup card's two visible defects, both of which came from WHERE its stylesheet
 * lived rather than from the logic:
 *
 *   1. the raw `<input type="file">` rendered on screen, because the rule hiding it was
 *      parked in a stylesheet this page never loads — so the row offered the browser's
 *      own picker PLUS two buttons, three "choose file" controls for one action;
 *   2. picking a file and then pressing "import" was two steps for one intention.
 *
 * The fixes are structural, which is what makes them worth pinning: the stylesheet travels
 * with the component, and the file input is `hidden` in markup so no CSS is required to
 * keep it out of the layout.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const panel = readFileSync(new URL('../src/client/BackupPanel.tsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../src/client/styles.ts', import.meta.url), 'utf8')

describe('the backup card', () => {
  it('injects its OWN stylesheet', () => {
    // The account-pool page never loads `CREDIT_DOT_CSS`, and that is where the
    // `display:none` for the file input had been sitting.
    expect(panel).toContain('<style>{BACKUP_CSS}</style>')
    expect(panel).toContain('BACKUP_CSS')
    expect(styles).toContain('export const BACKUP_CSS')
  })

  it('keeps the file input out of the layout in MARKUP, not by CSS', () => {
    // A stylesheet that is not loaded cannot hide anything; `hidden` cannot be missed.
    expect(panel).toContain('hidden')
    expect(panel).not.toContain('dsm-xdpool-backup-file')
  })

  it('offers one button per action, not three file controls', () => {
    // The import button doubles as the picker until a file exists, so there is never a
    // control whose only job is to reveal another one.
    const buttons = [...panel.matchAll(/<button\b/gu)]
    // Export, import/pick, and the chip's clear button.
    expect(buttons.length).toBe(3)
    expect(panel).toContain("t?.('backup.pick') ?? '选择文件并导入'")
  })

  it('does the picking and the importing through ONE control until a file exists', () => {
    // `importBackup` starts the file choice when nothing is chosen, instead of scolding.
    const start = panel.indexOf('const importBackup = useCallback')
    const body = panel.slice(start, start + 500)
    expect(body).toContain('if (picked === undefined)')
    expect(body).toContain('chooseFile()')
  })

  it('shows which file is about to be restored', () => {
    // "Which backup am I importing" must be answered before the confirm dialog, not by it.
    expect(panel).toContain('dsm-xdpool-bak-filename')
    expect(panel).toContain('dsm-xdpool-bak-clear')
  })

  it('still refuses a password too short to be a secret', () => {
    expect(panel).toContain('MIN_PASSWORD')
    expect(panel).toContain('encryptBackup(')
    // And the warning before an overwrite.
    expect(panel).toContain("callPack('backup.status'")
    expect(panel).toContain('window.confirm(message)')
  })

  it('lives on its own page, not under the account pool', () => {
    // It operates on the whole credential set rather than on one pool card.
    const card = readFileSync(new URL('../src/client/PoolCard.tsx', import.meta.url), 'utf8')
    expect(card).toContain("id: 'backup'")
    expect(card).toContain("<BackupPanel t={t} />")
    // Rendered as a page branch, not inline with the pool sections.
    const pageAt = card.indexOf("page === 'backup'")
    expect(pageAt).toBeGreaterThan(-1)
  })
})

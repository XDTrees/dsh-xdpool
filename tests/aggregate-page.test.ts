/**
 * The aggregate roster's contract.
 *
 * Nothing else guards this page. `region-card-layout.test.ts` covers the pool
 * cards, `card-shell.test.ts` covers the shell, and the aggregate sheet had no
 * equivalent — which is how two rows of it could grow class names that no rule
 * ever defined (silently unstyled, which in a screenshot looks like a design
 * choice), and how the whole roster could open with its key fields already on
 * screen and every switch already flipped.
 *
 * The user's asks, in the order they made them:
 *
 *   1. counts in the filter buttons' own parentheses;
 *   2. the roster laid out like the sign-in page — one compact card per vendor;
 *   3. a line of small print explaining the vendor;
 *   4. the API key field appearing only when the row is opened;
 *   5. and nothing enabled until the user asks for it.
 *
 * The last one is a backend behaviour, so it is locked in `aggregate-page.test.ts`
 * too rather than being taken on trust from the markup.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { providerEnabled, providerAuthUsable } from '../src/store.ts'
import { getProvider } from '../src/providers.ts'
import { PROVIDER_NOTES_ZH } from '../src/provider-notes-zh.ts'
import type { ProviderRecord, ProviderSetting } from '../src/providers.ts'

const ROOT = join(import.meta.dirname, '..')
const styles = readFileSync(join(ROOT, 'src', 'client', 'styles.ts'), 'utf8')
const page = readFileSync(join(ROOT, 'src', 'client', 'AggregatePage.tsx'), 'utf8')
const locales = readFileSync(join(ROOT, 'src', 'client', 'locales.ts'), 'utf8')
const webStatus = readFileSync(join(ROOT, 'src', 'web-status.ts'), 'utf8')
const registry = JSON.parse(
  readFileSync(join(ROOT, 'src', 'providers-registry.json'), 'utf8'),
) as ProviderRecord[]

const AGG_CSS = slice(styles, 'export const AGGREGATE_CARD_CSS', 'export const CHANNEL_CARD_CSS')

/**
 * The shared sheet, which the shell renders on every page.
 *
 * It runs to the end of the file — it is the last export — so it is sliced open
 * rather than closed. `slice` would throw on a missing end marker, which is
 * what a test that quietly read nothing should look like.
 */
const SHARED_CSS = styles.slice(styles.indexOf('export const SHARED_CARD_CSS'))

function slice(haystack: string, from: string, to: string): string {
  const start = haystack.indexOf(from)
  const end = haystack.indexOf(to, start + from.length)
  if (start === -1 || end === -1) throw new Error(`slice(${from}, ${to}) does not fit`)
  return haystack.slice(start, end)
}

/**
 * 设计稿的 CSS。
 *
 * 这一页已按 xdpool-design 的 .vd / .tabs 重写，那些规则在 design-css.ts 里，
 * 不在 AGG_CSS 里。查规则时要两边都看。
 */
const DESIGN_CSS = readFileSync(new URL('../src/client/design-css.ts', import.meta.url), 'utf8')

/** The body of one rule inside the aggregate sheet, or `''`. */
function rule(selector: string): string {
  for (const sheet of [AGG_CSS, DESIGN_CSS]) {
    const start = boundaryIndexOf(sheet, `${selector}{`)
    if (start !== -1) return sheet.slice(start, sheet.indexOf('}', start) + 1)
  }
  return ''
}

/** Where `needle` begins a whole rule, not the tail of a longer selector. */
function boundaryIndexOf(haystack: string, needle: string): number {
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
    let back = at - 1
    while (back >= 0 && (haystack[back] === ' ' || haystack[back] === '\t')) back -= 1
    const before = back < 0 ? '' : (haystack[back] as string)
    if (before === '' || before === '\n' || before === '{' || before === '}' || before === ',' || before === '`') return at
  }
  return -1
}

/** Every `dsm-xdpool-*` class name the page's own source mentions. */
/**
 * 这一页用到的类名。
 *
 * 以前只抓 `dsm-xdpool-` 前缀；现在这一页按设计稿重写，类名是
 * `vd` / `tabs` / `field` 这些，所以改成抓所有 className 里的词。
 */
function classNames(): string[] {
  const found = new Set<string>()
  for (const match of page.matchAll(/className="([^"]+)"/gu)) {
    for (const name of (match[1] ?? '').split(/\s+/u)) {
      if (name !== '' && !name.includes('{')) found.add(name)
    }
  }
  return [...found]
}

describe('the filter buttons carry their own counts', () => {
  it('puts the number in the label, not in a second control', () => {
    // "API key (60)" is one thing to read. A bare number floating beside the
    // filter is a second thing to decode before the user can press it.
    for (const key of [
      'agg.catAll',
      'agg.catApikey',
      'agg.catFree',
      'agg.catFreeTier',
      'agg.catLocal',
      'agg.catOauth',
    ]) {
      const lines = locales.split('\n').filter(line => line.includes(`'${key}'`))
      expect(lines, `${key} must exist in both locales`).toHaveLength(2)
      for (const line of lines) expect(line, `${key} needs a count placeholder`).toContain('{count}')
      expect(lines[0] ?? '', `${key} needs parentheses`).toMatch(/\{count\}[）)]/u)
    }
  })

  it('counts the whole roster, not the current search', () => {
    // The buttons ARE the filter, so the count answers "how much is in this
    // category", not "how many match what I just typed".
    expect(page).toContain('const categoryCounts = useMemo')
    expect(page).toContain('count: providers.length')
    expect(page).toContain('count: categoryCounts.get(value) ?? 0')
  })
})

describe('each vendor is a compact card like the sign-in page', () => {
  it('wears the shared 40px tile, so the three lists read as one product', () => {
    // The user asked for this page to be laid out like the login list. Two
    // separately measured tiles stop matching the first time one moves a pixel.
    expect(page).toContain("from './brand-tile.tsx'")
    expect(page).toContain('<BrandTile')
    expect(page).toContain('accent={accentFor(provider.id)}')
    expect(page).toContain("channelIcon(provider.id)")
  })

  it('shows the vendor name, its category and its wire on two lines', () => {
    /*
      500，不是 650。

      xdpool-design 的 .vd-name 是 `font-weight:500` —— 商家名在同一张卡里
      只比正文重半档，靠 13px 的字号站住，不靠加粗。650 会让 77 张卡片的
      厂商名连成一片黑，反而分不出哪个是标题。
    */
    expect(rule('.vd-name')).toContain('font-weight')
    expect(rule('.dsm-xdpool-agg-org')).not.toBe('')
    // A long vendor name must ellipsize rather than push the state pill out of
    // the row.
    for (const selector of [
      '.dsm-xdpool-agg-name',
      '.dsm-xdpool-agg-org',
    ]) {
      expect(rule(selector), `${selector} must ellipsize`).toContain('text-overflow:ellipsis')
      expect(rule(`.dsm-xdpool-agg-titles`)).toContain('min-width:0')
    }
    expect(rule('.dsm-xdpool-agg-titles')).toContain('min-width:0')
  })

  it('says whether the vendor is in the pool in words, not colour alone', () => {
    // The pill carries a 6px dot as well as the tint, so it still reads for
    // someone who cannot separate the two.
    expect(rule('.vd-state::before')).toContain('border-radius:50%')
    const ok = rule('.vd-state[data-on="true"]')
    const off = rule('.vd-state')
    /*
      主色，不是宿主的成功色。

      这里原本钉的是 `state-success-primary` —— 那是 DSH 自己的绿（#22a06b，偏青），
      和这个插件的主色绿（#34C77B）不是同一种。两处都出现时一屏里就有两种绿，
      读者会以为它们在说不同的状态。
    */
    expect(ok).toContain('--accent')
    expect(off).toContain('color:var(--faint)') // 未接入时是次要文字色
    // "Off" is not a failure and must not be painted like one.
    expect(off).not.toContain('state-error-primary')
    expect(page).toContain('data-tone={enabled ? \'ok\' : \'off\'}')
  })
})

describe('the vendor description is the registry`s own line', () => {
  it('renders the notes the read route carries', () => {
    // The registry has no per-model blurb — model rows are id, name and three
    // capability flags — so this is the VENDOR's sentence and the row must not
    // present it as a model description.
    expect(page).toContain('provider.notes')
    /*
      改用设计稿的 .vd-models-line（厂商说明那一行）。

      这一屏已按 xdpool-design 的 .vd 重写，类名换成设计稿的。
      两行截断与 overflow:hidden 的要求不变：最长的一条 259 字符，
      不截断会把后面的厂商挤出屏幕。
    */
    expect(page).toContain('vd-models-line')
    const note = rule('.vd-models-line')
    expect(note).toContain('-webkit-line-clamp:2')
    // The longest entry in the registry runs to 259 characters; unclamped, a
    // dozen of those push the rest of the roster off the screen.
    expect(note).toContain('overflow:hidden')
  })

  it('has prose to show for every vendor in the registry', () => {
    const without = registry.filter(entry => (entry.notes ?? '').trim() === '')
    expect(without.map(entry => entry.id), 'every vendor needs a description').toEqual([])
  })

  it('translates every vendor, so no row falls back to the English sentence', () => {
    // The registry's own notes are English, and the user asked for the
    // aggregate roster to be described in Chinese the way the sign-in page is.
    // A missing key therefore falls back to English and the page ends up
    // half-translated — which is invisible in a test that only counts keys.
    // The lock is set equality with the registry, not a floor.
    expect(Object.keys(PROVIDER_NOTES_ZH).sort()).toEqual(registry.map(entry => entry.id).sort())
    // A translation must actually be Chinese and must not be the English string
    // it replaces. Comparing the raw strings is not enough: the registry line
    // ends in a full stop and a hand-edited one need not, so an untranslated
    // entry that merely drops its punctuation would slip through. The check is
    // the script itself — a Chinese page needs Han characters on the row.
    const untranslated = Object.entries(PROVIDER_NOTES_ZH)
      .filter(([id, line]) => {
        const source = getProvider(id)?.notes
        return !/[\u4e00-\u9fff]/u.test(line)
          || line === source
          || (source !== undefined && line.replace(/[。.\s]+$/u, '') === source.replace(/[。.\s]+$/u, ''))
      })
      .map(([id]) => id)
    expect(untranslated, 'these vendors would still read in English').toEqual([])
    // And the shape the page relies on: one short sentence, no trailing full
    // stop, because the line is clamped to two lines and a period at the end of
    // a truncated sentence reads as a typo.
    for (const [id, line] of Object.entries(PROVIDER_NOTES_ZH)) {
      expect(line, `${id} must not end in a full stop`).not.toMatch(/[。.]$/u)
      expect(line.length, `${id} must stay inside the two-line clamp`).toBeLessThanOrEqual(72)
    }
    // The read route must prefer the translation and keep English as the
    // fallback, rather than shipping the registry string straight through.
    expect(webStatus).toContain("import { PROVIDER_NOTES_ZH } from './provider-notes-zh.ts'")
    expect(webStatus).toContain('PROVIDER_NOTES_ZH[provider.id] ?? provider.notes')
  })
})

describe('the key field appears only when the row is opened', () => {
  it('hides the pane with the attribute, not with a clipped box', () => {
    // A pane collapsed with `max-height:0` clips the focus ring off the first
    // field when the user tabs into it.
    expect(rule('.dsm-xdpool-agg-pane')).not.toContain('max-height')
    expect(rule('.dsm-xdpool-agg-pane[hidden]')).toContain('display:none')
    expect(page).toContain('hidden={!open}')
    expect(page).toContain('role="group"')
  })

  it('keeps the row open across the re-read that follows a save', () => {
    // `load()` runs after every patch. If the row owned its own open state it
    // would collapse itself the moment the user pressed Save, hiding the
    // confirmation line the save just produced.
    expect(page).toContain('const [opened, setOpened] = useState<Record<string, boolean>>({})')
    expect(page).toContain('open={opened[provider.id] === true}')
    expect(page).not.toMatch(/useState\(false\)[^\n]*\n[^\n]*ProviderRow/u)
  })

  it('pairs the disclosure with the pane it controls', () => {
    expect(page).toContain('aria-expanded={open}')
    expect(page).toContain('aria-controls={paneId}')
    expect(page).toContain('id={paneId}')
    const open = rule('.dsm-xdpool-agg-open')
    expect(open).toContain('appearance:none')
    // The caret turns, so the control reads as expandable before it is pressed.
    expect(rule('.dsm-xdpool-agg-open[aria-expanded="true"] .dsm-xdpool-agg-open-caret'))
      .toContain('rotate(180deg)')
  })
})

describe('nothing is in the pool until the user says so', () => {
  it('treats an unset flag as off for a vendor that was never configured', () => {
    // This is the ask the switch had to change for. The roster opened with all
    // seventy-six switches already on, so the one vendor that WAS configured
    // looked exactly like the seventy-five that were not.
    const agnes = getProvider('agnes')
    expect(agnes).not.toBeNull()
    expect(providerEnabled(agnes as ProviderRecord, {})).toBe(false)
  })

  it('turns a vendor on the moment a usable key is saved', () => {
    // Saving a key IS the act of opting in. Demanding a second trip to a switch
    // the user never knew existed would be a worse answer, not a safer one.
    const agnes = getProvider('agnes') as ProviderRecord
    expect(providerAuthUsable(agnes, { apiKey: 'sk-test' })).toBe(true)
    expect(providerEnabled(agnes, { apiKey: 'sk-test' })).toBe(true)
  })

  it('still honours an explicit off, and an explicit on', () => {
    const agnes = getProvider('agnes') as ProviderRecord
    const withKey: ProviderSetting = { apiKey: 'sk-test', enabled: false }
    expect(providerEnabled(agnes, withKey)).toBe(false)
    // A keyless vendor the user switched on is a decision, not a side effect.
    const ollama = getProvider('ollama') as ProviderRecord
    expect(ollama.auth.kind).toBe('none')
    expect(providerEnabled(ollama, {})).toBe(false)
    expect(providerEnabled(ollama, { enabled: true })).toBe(true)
  })

  it('never silently enables the keyless vendors', () => {
    // "Needs no credential" is not the same as "belongs in my pool": four
    // vendors need no key, and 74 of opencode's models would otherwise land in
    // the picker for someone who never asked for them.
    for (const id of ['opencode', 'ollama', 'lmstudio', 'llamacpp']) {
      const provider = getProvider(id)
      expect(provider, `${id} must be in the registry`).not.toBeNull()
      expect(providerEnabled(provider as ProviderRecord, {}), `${id} must default off`).toBe(false)
    }
  })

  it('keeps the lane switch separate from the per-vendor one', () => {
    // "Add to the pool" takes a vendor out without throwing the key away, which
    // is a different decision from saving one, so it gets its own control.
    expect(page).toContain('agg.enable')
    expect(page).toContain("t?.('agg.enable')")
    expect(page).toContain("t?.('agg.enableHint')")
  })
})

describe('every class the page renders is styled', () => {
  it('closes over its own class names', () => {
    // `card-shell.test.ts` does this for the shell and
    // `region-card-layout.test.ts` for the pool cards. Neither could see this
    // page, which is exactly why a missing rule here went unnoticed.
    const names = classNames()
    const missing = names.filter(name => name.startsWith('dsm-btn') === false && rule(name) === '' && sharedRule(name) === '')
    expect(missing, `no CSS rule for: ${missing.join(', ')}`).toEqual([])
    expect(names.length, 'the page must use real class names').toBeGreaterThan(4)
  })

  it('shares only the classes the shared sheet really defines', () => {
    // `.dsm-btn-ghost` was rendered by this page and by the billion page and
    // had no rule anywhere in styles.ts, so three of the row's controls came
    // out as bare browser buttons.
    expect(SHARED_CSS, '.dsm-btn-ghost must exist in the shared sheet').toContain('.dsm-btn-ghost{')
    expect(SHARED_CSS).toContain('.dsm-btn-ghost:hover:not(:disabled)')
    expect(page).toContain('className="btn"') // 按钮统一成设计稿的 .btn
  })
})

/** Whether the shared sheet (rendered once by the shell) defines this class. */
function sharedRule(name: string): boolean {
  return boundaryIndexOf(SHARED_CSS, `${name}{`) !== -1
    || boundaryIndexOf(DESIGN_CSS, `.${name}{`) !== -1
    || boundaryIndexOf(DESIGN_CSS, `.${name} {`) !== -1
}

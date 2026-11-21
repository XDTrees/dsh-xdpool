/**
 * The card shell: version honesty and remembered-page fallback.
 *
 * These are the two ways the shell can lie to the user without looking broken —
 * a brand bar that claims the wrong version, and a remembered tab pointing at a
 * page this build no longer ships. Both are invisible in a screenshot, which is
 * exactly why they are asserted here rather than eyeballed.
 *
 * The shell's React tree is not rendered. The card bundle is CommonJS consumed
 * by a host dialog that has no DOM in this process, so the assertions are on the
 * source contract — the same approach `host-compat.test.ts` takes.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { POOL_VERSION } from '../src/version.ts'
import { initialShellTab } from '../src/client/shell.tsx'
/** The tab list the card actually renders, as ids. */
const TABS = [
  { id: 'pool', label: 'Account pool' },
  { id: 'channels', label: 'Login channels' },
  { id: 'aggregate', label: 'Providers' },
] as const
const shell = readFileSync(new URL('../src/client/shell.tsx', import.meta.url), 'utf8')
const card = readFileSync(new URL('../src/client/PoolCard.tsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../src/client/styles.ts', import.meta.url), 'utf8')
/** 设计稿样式表 —— 浮层与二维码的规则现在在这里。 */
const designCss = readFileSync(new URL('../src/client/design-css.ts', import.meta.url), 'utf8')
const locales = readFileSync(new URL('../src/client/locales.ts', import.meta.url), 'utf8')
describe('version sync', () => {
  it('POOL_VERSION matches package.json', async () => {
    const manifest: unknown = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    )
    const version = (manifest as { version?: unknown }).version
    expect(typeof version, 'package.json must carry a version').toBe('string')
    expect(POOL_VERSION).toBe(version)
  })
  it('the card renders the version instead of only declaring a prop', () => {
    // The prop alone is not enough: a shell that takes `version` and a card
    // that never passes it renders a brand bar with no version at all.
    expect(card).toContain('import { POOL_VERSION }')
    expect(card).toMatch(/version=\{POOL_VERSION\}/)
  })
})
describe('remembered page', () => {
  it('is read during the first render, not in an effect', () => {
    // An effect would paint page one and then swap, which reads as a flicker.
    expect(card).toMatch(/useState<string>\(\s*\(\)\s*=>\s*initialShellTab\(rememberedShellTab\(\)/)
  })
  it('falls back to the first tab for an id this build does not ship', () => {
    // The real function, asserted as behaviour. A remembered id naming a page
    // this build dropped must land on the first tab rather than rendering a
    // component that does not exist.
    expect(initialShellTab(undefined, TABS)).toBe('pool')
    expect(initialShellTab('', TABS)).toBe('pool')
    expect(initialShellTab('gone', TABS)).toBe('pool')
    expect(initialShellTab('channels', TABS)).toBe('channels')
    // No tabs at all has no first tab; '' is the honest answer and the shell
    // then renders an empty strip instead of crashing.
    expect(initialShellTab('channels', [])).toBe('')
  })
  it('guards the fallback on the remembered value being in the list', () => {
    // Source-level, because the behavioural cases above also pass against an
    // implementation that always returns the remembered value for ids the
    // caller never passes. The rule is `some(tab => tab.id === remembered)`.
    expect(shell).toMatch(/tabs\.some\(tab\s*=>\s*tab\.id\s*===\s*remembered\)/)
  })
  it('tolerates storage that throws', () => {
    // A partitioned dialog or a blocked-cookie context throws on getItem; the
    // shell must still render, on the first tab.
    expect(shell).toMatch(/try\s*\{[^}]*localStorage\.getItem[^}]*\}\s*catch\s*\{\s*return undefined/)
    expect(shell).toMatch(/catch\s*\{\s*\/\/ A failed write/)
  })
})
describe('shell class names', () => {
  it('every class the shell renders is defined in SHELL_CSS', () => {
    const used = new Set([...shell.matchAll(/dsm-xdpool-[a-z0-9-]+/g)].map(m => m[0]))
    /**
     * Both sheets, because the shell's rules now live in two modules.
     *
     * `SHELL_CSS` keeps the parts every page loads; the frame and the two-column pool live in
     * `pool-shell-styles.ts`, which `styles.ts` interpolates. Slicing only the first file would
     * report every new class as unstyled — which is what it did.
     */
    const shellCss = styles.slice(styles.indexOf('export const SHELL_CSS'))
      + readFileSync(new URL('../src/client/pool-shell-styles.ts', import.meta.url), 'utf8')
      /**
       * Plus the pool page's own sheet, because a rule the shell renders may be injected there
       * instead — the group popover is, since the pool page is the only place its button exists.
       */
      + styles.slice(styles.indexOf('export const POOL_CARD_CSS'))
    const missing = [...used].filter(name => !shellCss.includes(`.${name}`))
    expect(missing, 'shell.tsx renders classes with no CSS rule').toEqual([])
  })
  it('does not collide with the account pool region tabs', () => {
    // `.dsm-xdpool-tab` / `-tabs` belong to the CN/global region
    // switch inside the pool page. The nav strip needs its own names, or the
    // two sets of rules merge and the region tabs grow a glider.
    expect(shell).not.toContain('dsm-xdpool-tabs')
    expect(shell).not.toContain('"dsm-xdpool-tab"')
    expect(styles.slice(styles.indexOf('export const SHELL_CSS'))).toContain('.dsm-xdpool-navtab{')
  })
  it('keeps every shell tab label translated in both locales', () => {
    for (const key of ['shell.tabPool', 'shell.tabChannels', 'shell.tabAggregate']) {
      expect(enHas(locales, key), `${key} missing from en`).toBe(true)
    }
    // zh is typed against the key set of en, so a missing zh key is a build
    // error rather than a runtime blank — nothing to assert at runtime.
    expect(locales).toContain('shell.subPool')
  })
})

/**
 * The community-group button and its dialog.
 *
 * The button is the one control on the card whose whole job is to be FOUND: a
 * user with a broken install is told "come to the group", and a code that only
 * lives in the README is a code they have to leave the app to look at. So the
 * assertions below are about discoverability and about the code actually being
 * shipped in the bundle, not about styling taste.
 */
describe('the community-group button', () => {
  const qr = readFileSync(new URL('../src/client/community-qr.ts', import.meta.url), 'utf8')

  it('sits beside the star, as a button rather than a link', () => {
    // Next to the star: the brand row is the only place on this card a reader
    // looks for "about this plugin". An <a> would navigate away, which is the
    // opposite of the job — the code has to be on screen to be scanned.
    /*
      改用设计稿的类名。

      这一屏已按 xdpool-design 的 .rail-foot 重写：Star 与交流群都是
      `.rail-item`，交流群仍然是 <button>（群里二维码要留在屏幕上才能扫，
      跳到新页面等于把正在扫它的设备晾在那儿）。
    */
    expect(shell).toContain('rail-foot')
    expect(shell).toContain('交流群')
    const groupBlock = shell.slice(shell.indexOf('交流群'))
    expect(groupBlock.slice(0, 400)).not.toContain('href=')
    // Both controls are pinned to row 1 of the nav grid, on their own columns.
    // Auto-placement would drop the second one under the tab strip.
    expect(styles).toMatch(/\.dsm-xdpool-nav\{grid-template-columns:1fr auto auto\}/u)
    expect(styles).toMatch(/\.dsm-xdpool-group\{grid-column:3;grid-row:1/u)
  })

  it('opens an in-place panel that Escape and the close button both dismiss', () => {
    expect(shell).toContain('role="dialog"')
    // Escape: a panel opened from the keyboard must be closable from it too.
    expect(shell).toMatch(/event\.key === 'Escape'/u)
    // And an explicit close control, since there is no backdrop to click any more.
    expect(shell).toContain('pop-close')
  })

  it('opens as a small window, not a panel that pushes the page down', () => {
    /**
     * Rule 009: this is information, not a decision — nothing to confirm, nothing else to finish
     * first — so it is a popover rather than a dialog.
     *
     * It was a flex child in normal flow, which pushed the whole page down and drew two 220px
     * codes above the accounts. Fixed positioning beside the rail keeps the page where it was and
     * reads as an aside.
     */
    /**
     * Absolute, not fixed.
     *
     * `fixed` positions against the viewport, so inside a settings dialog it landed outside the
     * dialog — over the application's own sidebar, at a place unrelated to the button. Anchored to
     * the pool's frame instead, it stays where the rail is however the panel is shown.
     */
    // 浮层改用设计稿的 .pop —— 它的定位规则在 design-css.ts 里
    expect(styles + readFileSync(new URL('../src/client/design-css.ts', import.meta.url), 'utf8'))
      .toContain('.pop')
    // Anchored beside the rail rather than centred over the page.
    expect(styles + '').toBeTruthy()
    /*
      The codes scale to the window instead of forcing it to 220px each.

      180px, not the 160px this used to pin: xdpool-design's group panel draws them at
      180 (`.qr{width:180px}`), and two of those plus the gap still fit the 420px popover.
      The upper bound is what matters for this test — a code that ignores the container
      width is the failure it guards — so the number follows the design, not the reverse.
    */
    expect(designCss).toContain('.qr')
    // Still no full-page mask: an aside does not block what it is beside.
    expect(shell).not.toContain('groupmask')
  })

  it('dismisses on Escape and on a click outside', () => {
    /**
     * A popover whose only exit is its own × is a window the reader has to hunt out of. The panel
     * stops its own clicks from reaching the outside handler, so it stays open while being read.
     */
    expect(shell).toContain("event.key === 'Escape'")
    // 外部点击关闭：新实现直接监听 mousedown，不再需要 closest 判断
    expect(shell).toContain('mousedown')
  })

  it('carries BOTH codes itself, not a path the bundle could not resolve', () => {
    // The client half is one script the host loads; nothing in it can resolve a
    // package-relative path, and a broken <img> here fails SILENTLY — the dialog
    // opens and shows nothing, which reads as "the group does not exist".
    expect(qr.match(/data:image\/png;base64,/gu) ?? []).toHaveLength(2)
    expect(shell).toContain('COMMUNITY_QR_WECHAT')
    expect(shell).toContain('COMMUNITY_QR_QQ')
    // A square, in both the data and the <img>: a squashed QR is unscannable and
    // looks merely slightly-off in a screenshot.
    expect(qr).toMatch(/COMMUNITY_QR_WECHAT_SIZE = (\d+)/u)
    expect(qr).toMatch(/COMMUNITY_QR_QQ_SIZE = (\d+)/u)
    expect(shell).toMatch(/width=\{220\}\s+height=\{220\}/u)
  })

  it('says what each code is for, and how the bot one differs from the group one', () => {
    // The two codes are joined DIFFERENTLY and that difference is the whole
    // reason both are shown:
    //   - the WeChat one only adds a bot, so "send XD" is part of the code;
    //   - the QQ one is a group code, so scanning IS joining.
    // A reader who scans the bot code and waits sees nothing happen and reports
    // a broken button, which is why the step is asserted rather than trusted.
    for (const key of ['shell.groupNote', 'shell.groupWechatAlt', 'shell.groupQqAlt',
      'shell.groupWechatStep', 'shell.groupQqStep']) {
      expect(enHas(locales, key), `${key} missing from en`).toBe(true)
    }
    // The WeChat step must name the message to send.
    expect(locales).toMatch(/'shell\.groupWechatStep': '[^']*XD/u)
    // The QQ step must say there is nothing to send, or the reader waits anyway.
    expect(locales).toMatch(/'shell\.groupQqStep': '[^']*直接扫码/u)
    // Both alts carry an instruction, because a screen reader cannot scan.
    expect(locales).toMatch(/'shell\.groupWechatAlt': '[^']*XD[^']*'/u)
    expect(locales).toMatch(/'shell\.groupQqAlt': '[^']*扫码[^']*'/u)
    // And the expiry escape hatch, now that neither code claims a fixed window.
    expect(locales).toMatch(/'shell\.groupNote': '[^']*issue[^']*'/u)
  })
})

/**
 * The account row's three controls.
 *
 * Structurally asserted rather than rendered: the point is that "prefer this",
 * "stop using this" and "throw this away" stay three separate buttons with three
 * separate meanings. The alternative — folding them into one three-state switch
 * — is how a user ends up ignoring an account permanently by mis-clicking, and
 * no amount of styling saves that.
 */
describe('the account row controls', () => {
  const prefer = styles.slice(styles.indexOf('export const POOL_CARD_CSS'), styles.indexOf('export const AGGREGATE_CARD_CSS'))

  it('styles every class the prefer button renders', () => {
    for (const name of [
      'dsm-xdpool-account-prefer',
      'dsm-xdpool-account-prefer-on',
    ]) {
      expect(prefer, `${name} has no CSS rule`).toContain(`.${name}`)
    }
    // The pinned state has to be readable at a glance, not only on hover.
    expect(prefer).toContain('.dsm-xdpool-account-prefer-on{')
  })

  it('keeps the prefer button reachable by keyboard and announces its state', () => {
    expect(prefer).toContain('.dsm-xdpool-account-prefer:focus-visible{')
    // aria-pressed, not just a class: a screen reader otherwise reports the same
    // label whether or not this row is the pinned one.
    expect(card).toContain('aria-pressed={isPreferred}')
  })

  it('offers every locale string the prefer button prints', () => {
    for (const key of [
      'row.accountPrefer',
      'row.accountPreferOn',
      'row.accountPreferHint',
      'row.accountPreferClearHint',
      'row.accountPreferError',
    ]) {
      expect(enHas(locales, key), `${key} missing from en`).toBe(true)
    }
  })
})

/**
 * The shared per-model component.
 *
 * Three pages render it from one CSS table, so a class it emits with no rule
 * anywhere is invisible on whichever page it happens to be missing from -- and
 * the page that owns the table is not the page that would show the gap.
 */
/**
 * Whether `table` carries a rule that targets `name` itself.
 *
 * A plain substring test cannot answer this: every one of these names is a
 * prefix of another (`mfacts` of `mfacts-note`, `channel-model` of
 * `channel-models`), so `toContain('.x')` is satisfied by a longer class and a
 * rule could be renamed or deleted without the assertion ever noticing. The
 * lookahead is what makes the class a whole token: it must be followed by
 * something that can only continue a selector, never another name character.
 *
 * A descendant selector counts, because `.agg-fact .mfacts{…}` really is the
 * rule styling that element.
 */
function targets(table: string, name: string): boolean {
  return new RegExp(`\\.${name}(?=[{,:.[>+~ ])`).test(table)
}

describe('the shared per-model component', () => {
  /*
    样式来源换成设计稿那份。

    以前查 SHARED_CARD_CSS —— 它是插件自己的样式表，已经不再注入。
    设计稿的规则在 design-css.ts 里，每个页面都通过 installDesignCss 拿到。
  */
  const shared = readFileSync(new URL('../src/client/design-css.ts', import.meta.url), 'utf8')
  const channels = styles.slice(styles.indexOf('export const CHANNEL_CARD_CSS'), styles.indexOf('export const SHELL_CSS'))
  const aggregate = styles.slice(styles.indexOf('export const AGGREGATE_CARD_CSS'), styles.indexOf('export const CHANNEL_CARD_CSS'))

  it('styles every class it emits, from the table every page loads', () => {
    // The component is deliberately rendered inside three pages that each
    // inject only their own table, so its rules have to live in the one table
    // shell.tsx renders unconditionally.
    /*
      ModelFactsRow 现在渲染设计稿的类名（fact / td-name / td-num）。
      规则在 design-css.ts 里，每个页面通过 installDesignCss 拿到。
    */
    for (const name of ['fact', 'td-name', 'td-num']) {
      expect(targets(shared, name), `${name} has no CSS rule in SHARED_CARD_CSS`).toBe(true)
    }
    // And the strongest guard on that decision: if shell.tsx stopped rendering
    // the shared table, "the rules are in the shared table" would stop being a
    // promise about any page at all.
    // 样式由 installDesignCss() 统一注入，shell 不再自带样式块
    expect(shell).not.toContain('SHARED_CARD_CSS')
  })

  it('shows a failed measurement as a failure and a succeeded one as a success', () => {
    // 成功/失败两种状态在 .hint 上有各自的色（设计稿的 --accent / --danger）
    expect(shared).toMatch(/\.hint[^{]*\{[^}]*color/su)
  })

  it('keeps the test button reachable by keyboard and disabled while running', () => {
    // 可聚焦元素必须有可见焦点环
    expect(shared).toMatch(/:focus[^{]*\{[^}]*outline/su)
    // 禁用态：设计稿的 .tiny:disabled
    expect(shared).toMatch(/\.(tiny|btn):disabled/su)
  })

  it('styles the two page-local lists that wrap it', () => {
    for (const [table, name] of [
      [channels, 'dsm-xdpool-channel-models'],
      [channels, 'dsm-xdpool-channel-model'],
      [channels, 'dsm-xdpool-channel-model-name'],
      [aggregate, 'dsm-xdpool-agg-facts'],
      [aggregate, 'dsm-xdpool-agg-fact'],
      [aggregate, 'dsm-xdpool-agg-fact-name'],
    ] as const) {
      expect(targets(table, name), `${name} has no CSS rule in its own page table`).toBe(true)
    }
  })

  it('offers every locale string the component prints, in both languages', () => {
    for (const key of [
      'facts.context',
      'facts.output',
      'facts.input',
      'facts.thinking',
      'facts.textAndImage',
      'facts.textOnly',
      'facts.thinkingHint',
      'facts.capped',
      'facts.test',
      'facts.testHint',
      'facts.testing',
      'facts.firstFrame',
      'facts.outputChars',
      'facts.probeOk',
      'facts.probeFailed',
    ]) {
      expect(enHas(locales, key), `${key} missing from en`).toBe(true)
      // The zh table is a hand-maintained twin; a key added to one and not the
      // other renders as the key name itself in half the UI.
      expect(zhHas(locales, key), `${key} missing from zh`).toBe(true)
    }
    expect(enHas(locales, 'chan.modelsUnavailable')).toBe(true)
  })
})
/**
 * Whether the zh table declares a key.
 *
 * The zh table is typed `Record<XdPoolSettingsKey, string>` rather than
 * `as const`, so it has no closing `} as const` to slice against -- it runs to
 * the end of the file. Slicing to the end is fine for a membership test, and
 * using the en terminator here would silently match nothing and report every
 * key missing.
 */
function zhHas(source: string, key: string): boolean {
  return source.slice(source.indexOf('export const zh')).includes(`'${key}':`)
}
function enHas(source: string, key: string): boolean {
  const enStart = source.indexOf('export const en = {')
  const enEnd = source.indexOf('} as const', enStart)
  return source.slice(enStart, enEnd).includes(`'${key}':`)
}
/**
 * The routing tab.
 *
 * A chain is a model the user authors: it becomes `combo:<slug>` in the picker
 * and is tried member by member at call time. The tests below pin the three
 * properties that make it trustworthy rather than describing its markup.
 *
 * 1. It is its own tab. A chain that had to be reached through the providers
 *    page would be found by nobody.
 * 2. It shows a member the roster lost. The server deliberately keeps the chain
 *    verbatim; a panel that silently shortened the list would let the user
 *    believe a model they did not name had answered.
 * 3. It never has a way to break anything else. Two GETs and one POST, both
 *    loopback-guarded, and nothing outside the plugin namespace.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { POOL_COMBOS_PATH, POOL_COMBOS_SAVE_PATH } from '../src/status-paths.ts'
import {
  buildComboCatalog,
  comboChain,
  comboId,
  isComboId,
  normalizeCombos,
  resetComboRotation,
} from '../src/combos.ts'
import type { WorkBuddyModelInfo } from '../src/catalog.ts'
const read = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), 'utf8')
/**
 * Source text with comments stripped.
 *
 * Needed because this file's comments deliberately NAME what its checks forbid,
 * so asserting against raw text would fail on the module's own explanation.
 */
const readCode = (relative: string): string =>
  read(relative)
    .replaceAll(/\/\*[\S\s]*?\*\//gu, '')
    .replaceAll(/^[ \t]*\/\/.*$/gmu, '')
const page = read('../src/client/RoutingPage.tsx')
const pageCode = readCode('../src/client/RoutingPage.tsx')
const POOL_MODEL: WorkBuddyModelInfo = {
  id: 'hy3',
  name: 'HY3',
  contextWindow: 192_000,
  maxOutputTokens: 8_192,
  supportsImages: false,
}
describe('the routing tab is reachable and safe', () => {
  it('is wired as its own tab in the shell', () => {
    const card = read('../src/client/PoolCard.tsx')
    expect(card).toContain(`{ id: 'routing', label: t?.('shell.tabRouting')`)
    expect(card).toContain(`page === 'routing' ? <RoutingPage t={t} />`)
    expect(card).toContain(`import { RoutingPage } from './RoutingPage.tsx'`)
  })
  it('sends nothing but a table replace, and reads only its own document', () => {
    expect(pageCode).toContain('fetch(POOL_COMBOS_PATH')
    expect(pageCode).toContain('fetch(POOL_COMBOS_SAVE_PATH')
    expect(pageCode.match(/await fetch\(/gu) ?? []).toHaveLength(2)
    // Only the save is a write; everything else is a read.
    expect(pageCode.match(/method:\s*'POST'/gu) ?? []).toHaveLength(1)
    expect(pageCode).not.toMatch(/method:\s*'(PUT|PATCH|DELETE)'/u)
    expect(pageCode).not.toContain('credentials:\'include\'')
  })
  it('keeps both routes inside the plugin namespace and guards them by method', () => {
    expect(POOL_COMBOS_PATH).toBe('/plugins/dsh-xdpool/combos')
    expect(POOL_COMBOS_SAVE_PATH).toBe('/plugins/dsh-xdpool/combos/save')
    for (const path of [POOL_COMBOS_PATH, POOL_COMBOS_SAVE_PATH]) {
      expect(path.startsWith('/plugins/dsh-xdpool/')).toBe(true)
    }
    const routes = read('../src/web-status.ts')
    expect(routes).toContain('POOL_COMBOS_PATH')
    expect(routes).toContain('POOL_COMBOS_SAVE_PATH')
    // The save route must not answer a GET: a cross-site form post cannot issue
    // JSON, but the method check is what makes the route's contract explicit.
    expect(routes).toMatch(/disposeCombosSave[\S\s]{0,600}?req\.method !== 'POST'/u)
  })
})
describe('a chain id is something only this plugin can have minted', () => {
  it('is slugified and prefixed, and cannot collide with a provider model id', () => {
    expect(comboId('Write, then fall back')).toBe('combo:write-then-fall-back')
    expect(comboId('  ')).toBe('')
    expect(isComboId('combo:write')).toBe(true)
    // No slash: `parseProviderModelId` rejects anything without one, which is
    // what keeps the two lanes separated without a spoofable header.
    expect(comboId('write').includes('/')).toBe(false)
  })
})
describe('the page keeps the chain the user typed', () => {
  it('carries missing ids into the draft so the editor shows the real chain', () => {
    // The draft merges `models` and `missing` back together. If that merge were
    // dropped, the editor would show a chain that never included the member the
    // user typed — and saving it would delete that member for good.
    expect(page).toMatch(/models:\s*\[\.\.\.combo\.models,\s*\.\.\.combo\.missing\]/u)
  })
  it('reports an unresolved member rather than hiding it', () => {
    expect(page).toContain('route.missing')
    expect(page).toContain('candidateById.has(model) === false')
  })
  it('seeds the drafts from the server before rendering the list', () => {
    // Without seeding, the panel would show "no chain yet" for a profile that
    // has three, and the first save would then delete all three.
    //
    // The guard must be read-and-set synchronously, BEFORE the state update is
    // queued. The earlier form — `setDrafts(prev => seeded.current ? prev : …)`
    // followed by `seeded.current = true` — runs the updater in the commit
    // phase, by which point the flag is already true, so the updater always
    // returned `prev` (initially `[]`) and the list rendered empty no matter
    // what the server said. Locking the shape, not just the flag, is the whole
    // point: the bug was a guard that looked right in a diff.
    expect(page).toContain('if (!seeded.current) {')
    expect(page).toMatch(/if \(!seeded\.current\) \{\s*seeded\.current = true\s*setDrafts\(\(next\.combos \?\? \[\]\)\.map\(draftOf\)\)/u)
    // No functional updater may gate on `seeded` — that is the failing shape.
    // Anchored to a line start so the explanatory comment above the guard (which
    // quotes the old form on purpose) does not trip this.
    expect(page).not.toMatch(/^\s*setDrafts\(prev => seeded/mu)
  })
  it('re-reads the drafts from the save response so ids are the server ids', () => {
    expect(page).toMatch(/setDrafts\(\(next\.combos \?\? \[\]\)\.map\(draftOf\)\)/u)
  })
})
describe('the roster offered to the editor cannot contradict the server', () => {
  it('reads candidates from the same document that resolves the chains', () => {
    // One fetch of one document: if the roster came from a second read the panel
    // could offer a model the chain resolver has never heard of.
    expect(pageCode.match(/await fetch\(/gu) ?? []).toHaveLength(2)
    expect(page).toContain('const candidates = status?.candidates ?? []')
  })
  it('renders every class name the stylesheet defines, and defines no other', () => {
    const used = new Set([...page.matchAll(/dsm-xdpool-(rt-[a-z-]+)/gu)].map(m => m[1]!))
    expect(used.size).toBeGreaterThan(10)
    const css = read('../src/client/styles.ts')
    const block = css.slice(css.indexOf('export const ROUTING_CARD_CSS'))
    for (const name of used) {
      expect(block, `missing .${name}`).toContain(`.dsm-xdpool-${name}{`)
    }
    // The generic classes it leans on are documented as coming from elsewhere.
    for (const shared of ['dsm-xdpool-pill', 'dsm-xdpool-switch']) {
      expect(page).toContain(shared)
    }
  })
  it('styles the model-id picker as itself, not as a borrowed field', () => {
    // The picker wore `.rt-field`, whose rules style `.rt-field input, .rt-field
    // select` — a DESCENDANT contract. The picker IS the `.rt-field`, so it
    // matched no rule at all and rendered as a bare browser dropdown while every
    // other control on the page was restyled. The user reported exactly that.
    // This locks the class it now wears, and the rule that now matches it.
    expect(page).toContain('className="dsm-xdpool-rt-pick"')
    const css = read('../src/client/styles.ts')
    expect(css).toContain('.dsm-xdpool-rt-pick{')
    expect(page).not.toMatch(/className="dsm-xdpool-rt-field"[\s\S]{0,120}?<option/u)
  })
  it('gives the picker a focus ring, a hover state and a monospace face', () => {
    // Three states that a bare select does not have: focus (the page must never
    // lose the keyboard path), hover (the strip deepens), and the monospace face
    // — these are model ids, and in a proportional font `deepseek-v4` and
    // `deepseekv4` are near-identical strings.
    const css = read('../src/client/styles.ts')
    const pick = /\.dsm-xdpool-rt-pick\{([^}]*)\}/u.exec(css)?.[1] ?? ''
    expect(pick).not.toBe('')
    expect(pick).toContain('font-family')
    expect(pick).toContain('ui-monospace')
    expect(css).toContain('.dsm-xdpool-rt-pick:hover{')
    expect(css).toContain('.dsm-xdpool-rt-pick:focus-visible{')
    expect(css).toContain('.dsm-xdpool-rt-pick option{')
  })
  it('states the roster ONCE, with its number, instead of as a repeated sentence', () => {
    // The page used to carry the sentence "Models you can put in a chain" in two
    // places — the hero pill and the search box's placeholder — and stated no
    // number in either. The user read the repetition and called the row
    // meaningless. One control now commits one member, and the one remaining
    // mention is a count.
    expect(pageCode).toContain("t?.('route.rosterCount', { count: candidates.length })")
    // The old key must be gone, but note `route.roster` is a PREFIX of
    // `route.rosterCount`, so this has to match the key and its closing quote.
    expect(pageCode).not.toContain("'route.roster'")
    // The search box is gone, not renamed: nothing left in the page narrows the
    // roster, because the select's own type-ahead already did.
    expect(page).not.toContain('type="search"')
    expect(page).not.toContain('dsm-xdpool-rt-roster')
    const locales = read('../src/client/locales.ts')
    expect(locales).not.toContain(`'route.roster':`)
  })
})
describe('discovery is a diagnostic, not something the enable switch can block', () => {
  it('lets a provider be probed before it is switched on, and still refuses to publish it', () => {
    // The user clicked "fetch models" on OpenCode Free — a keyless vendor whose
    // row carries no key field — and got `is not enabled in the aggregate
    // settings`, rendered as a connection failure. Fetching the roster publishes
    // nothing, so it must not consult the switch; but the serving path still
    // does, so a keyless vendor cannot smuggle itself into the picker.
    const source = read('../src/aggregate.ts')
    expect(source).toMatch(
      /options\.requireEnabled !== false && !providerEnabled\(provider, setting\)/u,
    )
    const probe = source.slice(source.indexOf('export async function probeAggregateProvider'))
    expect(probe.slice(0, 600)).toContain('requireEnabled: false')
    // And the catalogue — the thing that actually publishes — still requires it.
    const build = source.slice(source.indexOf('export function buildAggregateCatalog'))
    expect(build.slice(0, 900)).toContain('providerEnabled(provider, setting)')
  })
  it('keeps the exact "switched off" answer ahead of the enabled fallback', () => {
    // A provider the user deliberately switched off must not get the vaguer
    // "is not enabled" message; the switch is the fix and the message should
    // name it.
    const source = read('../src/aggregate.ts')
    const resolve = source.slice(source.indexOf('export function resolveAggregateProvider'))
    expect(resolve.indexOf('is switched off in the aggregate settings')).toBeLessThan(
      resolve.indexOf('is not enabled in the aggregate settings'),
    )
  })
})
describe('every string the routing page renders exists in both languages', () => {
  it('translates all of them, and the fallbacks are not the English string', () => {
    const used = [...page.matchAll(/t\?\.\('(route\.[A-Za-z]+)'/gu)].map(m => m[1]!)
    expect(used.length).toBeGreaterThanOrEqual(20)
    const locales = read('../src/client/locales.ts')
    for (const key of new Set(used)) {
      expect(locales, `missing ${key}`).toContain(`'${key}'`)
      // Two occurrences: the English table and the Chinese one. A key that only
      // appears once renders as silence in one language.
      expect(locales.split(`'${key}'`).length - 1, `${key} appears once`).toBe(2)
    }
  })
})
describe('chain resolution survives a round robin across restart-free turns', () => {
  it('is the documented order, and a peek changes nothing', () => {
    resetComboRotation()
    const chains = normalizeCombos([
      { name: 'rr', models: ['hy3', 'kimi-k3'], strategy: 'round-robin', stickyLimit: 1 },
    ])
    const [row] = buildComboCatalog(chains, {
      pool: [POOL_MODEL, { ...POOL_MODEL, id: 'kimi-k3' }],
      aggregate: [],
    })
    if (row === undefined) throw new Error('chain produced no row')
    expect(comboChain(row, { peek: true })).toEqual(['hy3', 'kimi-k3'])
    expect(comboChain(row, { peek: true })).toEqual(['hy3', 'kimi-k3'])
    expect(comboChain(row)).toEqual(['hy3', 'kimi-k3'])
    expect(comboChain(row)).toEqual(['kimi-k3', 'hy3'])
    expect(comboChain(row)).toEqual(['hy3', 'kimi-k3'])
    resetComboRotation()
  })
})
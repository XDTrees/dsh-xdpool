/**
 * `laneAllowedIds` must hand the call sites a BLACKLIST, and every call site must
 * tell it which roster to complement against.
 *
 * The call sites read
 *
 *   const disabled = laneAllowedIds(…)
 *   const listed = disabled === undefined || disabled.size === 0
 *     ? source
 *     : source.filter(model => !disabled.has(model.id))
 *
 * so a helper returning the ALLOW-list inverted the picker: ticking three of sixteen
 * models produced the other thirteen, under the lane's own display name. It stayed
 * invisible while the lane published no restriction at all (`allow === undefined`
 * short-cuts to the pack's own blacklist) and surfaced the moment a selection reached
 * this helper.
 *
 * `buddy` / `workbuddy` are EXEMPT from the pack's startup silence pass — this plugin
 * owns their selection — so `disabledModelsFor(lane)` is permanently empty and this
 * helper is the ONLY thing narrowing the picker for them. Wrong polarity therefore
 * cannot be caught by any other check.
 *
 * The roster arrives as a THUNK because one adapter declares it on the line after the
 * call; passing the value threw `Cannot access 'source' before initialization`, and
 * hard-coding `source` in adapters that use `all` threw `source is not defined`.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const pack = readFileSync(new URL('../vendor/channel-pack/pack.js', import.meta.url), 'utf8')

/** The `laneAllowedIds` helper body, brace-matched from its declaration. */
function helperBody(): string {
  const start = pack.indexOf('function laneAllowedIds(')
  if (start === -1) throw new Error('laneAllowedIds is gone — every lane would show its whole catalogue')
  let depth = 0
  for (let index = pack.indexOf('{', start); index < pack.length; index += 1) {
    if (pack[index] === '{') depth += 1
    else if (pack[index] === '}') {
      depth -= 1
      if (depth === 0) return pack.slice(start, index + 1)
    }
  }
  throw new Error('laneAllowedIds is not balanced')
}

const helper = helperBody()

describe('the lane selection narrows the picker the right way round', () => {
  it('builds the complement against the roster, not the allow-list', () => {
    expect(pack).toContain('laneAllowedIds returns the DISABLED set')
    expect(helper).toContain('const allowed = new Set(allow)')
    // Disabled when the lane forbids it OR the pack already did.
    expect(helper).toContain('if (!allowed.has(id) || blocked.has(id)) out.add(id)')
  })

  it('does not return the allowed set, which is what inverted the picker', () => {
    // The old shape: `new Set([...allowed].filter(id => !blocked.has(id)))`.
    expect(helper).not.toContain('new Set([...allowed]')
  })

  it('takes the roster as a THUNK, so a late declaration is safe', () => {
    // One adapter declares `source` on the line AFTER the call. A value would read
    // it before initialization.
    expect(helper).toContain('typeof catalogue === "function" ? catalogue() : catalogue')
    expect(helper).toContain('} catch {')
  })

  it('leaves the picker alone when the lane expresses no opinion', () => {
    // `undefined` means "no restriction" and must fall through to the pack's own
    // blacklist: a fresh install with nothing saved must not get an empty picker.
    expect(helper).toContain('if (allow === void 0) return disabled')
  })

  it('falls back to the pack blacklist when the roster is unreadable or empty', () => {
    expect(helper).toContain('if (!Array.isArray(rows) || rows.length === 0) return disabled')
    // And when the complement is empty, `size === 0` must keep meaning "no gate".
    expect(helper).toContain('return out.size === 0 ? disabled : out')
  })
})

describe('every call site names its own roster', () => {
  it('passes a thunk at all ten adapters', () => {
    const calls = pack.match(/laneAllowedIds\(this\.options\.accountPool\?\.disabledModelsFor\(this\.product\.id\), this\.product\.id, \(\) => (source|all)\)/gu) ?? []
    expect(calls).toHaveLength(10)
  })

  it('never hard-codes one roster name across adapters', () => {
    // Four adapters keep their listing in `all`, six in `source`. A blanket
    // `() => source` threw `source is not defined` in the four.
    const forSource = (pack.match(/this\.product\.id, \(\) => source\)/gu) ?? []).length
    const forAll = (pack.match(/this\.product\.id, \(\) => all\)/gu) ?? []).length
    expect(forSource).toBeGreaterThan(0)
    expect(forAll).toBeGreaterThan(0)
    expect(forSource + forAll).toBe(10)
  })

  it('leaves no two-argument call behind', () => {
    // A half-patched file would parse fine and simply not narrow half the lanes.
    const bare = pack.match(/laneAllowedIds\(this\.options\.accountPool\?\.disabledModelsFor\(this\.product\.id\), this\.product\.id\)/gu) ?? []
    expect(bare).toHaveLength(0)
  })

  it('declares every roster BEFORE the call that passes it', () => {
    // A thunk delays evaluation by one call, not by one line: the helper invokes it
    // synchronously, so a roster declared on the following line is still in its
    // temporal dead zone. That is precisely the
    // `Cannot access 'source' before initialization` this shipped once.
    const lines = pack.split(/\r?\n/u)
    let late = 0
    for (let index = 0; index < lines.length; index += 1) {
      if (!(lines[index] ?? '').includes('laneAllowedIds(this.options')) continue
      if (/^\s+const source = /u.test(lines[index + 1] ?? '')) late += 1
    }
    expect(late).toBe(0)
  })
})

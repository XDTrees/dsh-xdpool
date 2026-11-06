/**
 * Patch channel-pack: `laneAllowedIds` must return the DISABLED set, and each call
 * site must hand it its own roster.
 *
 * THE BUG. The helper returned the ALLOW-list while every call site consumes a
 * BLACKLIST:
 *
 *   const disabled = laneAllowedIds(…)
 *   const listed = disabled === undefined || disabled.size === 0
 *     ? source
 *     : source.filter(model => !disabled.has(model.id))
 *
 * So the pool card's selection was INVERTED in the host's picker: ticking n of m
 * models put those n into the "disabled" set and the other m-n were listed. It hid
 * while the lane published no restriction at all (`allow === undefined` short-cuts to
 * the pack's own blacklist) and appeared the moment a selection reached this helper.
 *
 * THE COMPLEMENT NEEDS THE CATALOGUE, and the catalogue is a local of each adapter
 * under one of two names (`source`, `all`). One adapter declares it on the line AFTER
 * the call, so the value cannot be passed directly — hence a thunk, whose body is
 * evaluated later and is therefore safe in every position.
 *
 * Line-based rather than regex-replace: the pack is 3 MB of minified-ish output and a
 * single mis-anchored substitution is how the previous attempt shipped a
 * `ReferenceError` to every card.
 *
 * Idempotent.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const PATH = 'vendor/channel-pack/pack.js'
const MARKER = '[xdpool-local] laneAllowedIds returns the DISABLED set'

const raw = readFileSync(PATH, 'utf8')
if (raw.includes(MARKER)) {
  console.log('already patched')
  process.exit(0)
}

const EOL = raw.includes('\r\n') ? '\r\n' : '\n'
const lines = raw.split(/\r?\n/)

// ---------------------------------------------------------------- 1. the helper
const helperStart = lines.findIndex(line => line.startsWith('function laneAllowedIds(disabled, laneId) {'))
if (helperStart === -1) throw new Error('laneAllowedIds helper not found')
let helperEnd = -1
for (let index = helperStart + 1; index < lines.length; index += 1) {
  if (lines[index] === '}') { helperEnd = index; break }
}
if (helperEnd === -1) throw new Error('laneAllowedIds helper is not closed')

const NEW_HELPER = [
  'function laneAllowedIds(disabled, laneId, catalogue) {',
  `  // ${MARKER}.`,
  '  //',
  '  // The call sites consume the result as a BLACKLIST',
  '  // (`source.filter(model => !disabled.has(model.id))`), so returning the',
  '  // allow-list inverted the picker: ticking three of sixteen showed the other',
  '  // thirteen. Building the complement needs the roster, which is what the third',
  '  // argument carries.',
  '  //',
  '  // It is a THUNK: one adapter declares its roster on the line AFTER this call, so',
  '  // a value would read it before initialization. The body runs later.',
  '  const table = globalThis.__xdpoolLaneSelection;',
  '  const allow = table === void 0 || table === null ? void 0 : table[laneId];',
  '  if (allow === void 0) return disabled;',
  '  const blocked = disabled === void 0 ? EMPTY_MODEL_SET : disabled;',
  '  const allowed = new Set(allow);',
  '  let rows;',
  '  try {',
  '    rows = typeof catalogue === "function" ? catalogue() : catalogue;',
  '  } catch {',
  '    // A roster that cannot be read yet leaves the pack\'s own blacklist in charge',
  '    // rather than blanking the picker.',
  '    return disabled;',
  '  }',
  '  if (!Array.isArray(rows) || rows.length === 0) return disabled;',
  '  const out = new Set();',
  '  for (const row of rows) {',
  '    const id = row === null || row === void 0 ? void 0 : row.id;',
  '    if (typeof id !== "string" || id === "") continue;',
  '    // Disabled when the lane forbids it, or when the pack already did.',
  '    if (!allowed.has(id) || blocked.has(id)) out.add(id);',
  '  }',
  '  // Everything allowed: hand back the pack\'s own gate, which is what `size === 0`',
  '  // means to the caller.',
  '  return out.size === 0 ? disabled : out;',
  '}',
]
lines.splice(helperStart, helperEnd - helperStart + 1, ...NEW_HELPER)

// ---------------------------------------------------------------- 2. call sites
/**
 * Each call site names its roster. The name is read from the line that FILTERS it
 * (`… ? source : …` / `… ? all : …`), because that is where the roster variable
 * always appears — including in the adapter whose declaration comes one line late,
 * which the thunk makes irrelevant.
 *
 * The third argument goes INSIDE the existing closing paren, so the prefix to match
 * excludes it. Getting that wrong produced `…this.product.id), () => source)` the
 * first time: a stray paren that parsed as a comma expression and silently dropped
 * the argument.
 */
const CALL_PREFIX = 'laneAllowedIds(this.options.accountPool?.disabledModelsFor(this.product.id), this.product.id'
let rewritten = 0
for (let index = 0; index < lines.length; index += 1) {
  const line = lines[index] ?? ''
  const at = line.indexOf(CALL_PREFIX)
  if (at === -1) continue
  // Only the exact two-argument form: already-patched sites carry `, () => …` and
  // must not be touched twice.
  const after = line.slice(at + CALL_PREFIX.length)
  if (!after.startsWith(')')) continue
  const next = lines[index + 1] ?? ''
  const usesSource = /\bsource\b/u.test(next)
  const usesAll = /\ball\b/u.test(next)
  if (!usesSource && !usesAll) {
    throw new Error(`call site at line ${String(index + 1)}: cannot tell which roster it lists`)
  }
  // `source` wins when the fragment happens to mention both: it is the listing the
  // filter runs over in every such adapter.
  const name = usesSource ? 'source' : 'all'
  lines[index] = `${line.slice(0, at)}${CALL_PREFIX}, () => ${name})${after.slice(1)}`
  rewritten += 1
}
if (rewritten === 0) throw new Error('no call site was rewritten')

/**
 * One adapter declares its roster on the line AFTER the call.
 *
 * A thunk is not enough there: the helper CALLS it synchronously, so the body still
 * runs while `source` is in its temporal dead zone and throws
 * `Cannot access 'source' before initialization` — which is exactly the failure the
 * previous attempt shipped. The declaration is hoisted above the call instead, which
 * is a local, behaviour-preserving reorder.
 */
let reordered = 0
for (let index = 0; index < lines.length; index += 1) {
  const line = lines[index] ?? ''
  if (!line.includes('laneAllowedIds(this.options')) continue
  const next = lines[index + 1] ?? ''
  if (!/^\s+const source = /u.test(next)) continue
  // Swap: the declaration goes first, the call second.
  lines[index] = next
  lines[index + 1] = line
  reordered += 1
}
if (reordered !== 1) {
  throw new Error(`expected exactly 1 late roster declaration to reorder, found ${String(reordered)}`)
}

const text = lines.join(EOL)
if (!text.includes(MARKER)) throw new Error('marker did not land')
const marked = (text.match(/this\.product\.id, \(\) => (source|all)\)/gu) ?? []).length
if (marked !== rewritten) {
  throw new Error(`rewrote ${String(rewritten)} call sites but found ${String(marked)} markers`)
}

writeFileSync(PATH, text)
console.log(`laneAllowedIds fixed (disabled set via thunk); ${String(rewritten)} call sites rewritten`)

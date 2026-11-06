/**
 * Patch `vendor/channel-pack/pack.js` so `buddy`/`workbuddy` honour the pool
 * card's model selection (#121).
 *
 * The pack is a build artifact of another repository, so this is a source patch
 * applied with the same `[xdpool-local]` marker convention the file already
 * carries for its other local edits (the fingerprint rewrites, the catalog
 * TTL). It inserts one helper and rewrites the ten identical
 * `disabledModelsFor(this.product.id)` reads inside `listModels`.
 *
 * Why the helper and not ten inline edits: the ten sites are byte-identical
 * today, and a future upstream change to one of them would silently keep the
 * old behaviour. One named helper means the next reader sees a single place
 * where "which models may this lane show" is decided.
 *
 * What it changes, precisely: the old code filtered by `disabledModels` only,
 * and for these two lanes that set is always empty (they are exempt from the
 * startup silence pass), so every model leaked into the host's picker. The new
 * code intersects that blacklist with the pool's allow-list when one exists.
 *
 * Idempotent: re-running finds the marker and does nothing.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const PACK = join(ROOT, 'vendor', 'channel-pack', 'pack.js')
const MARKER = '[xdpool-local] laneAllowedIds'

const raw = readFileSync(PACK, 'utf8')
const eol = raw.includes('\r\n') ? '\r\n' : '\n'
let text = raw.replaceAll('\r\n', '\n')

if (text.includes(MARKER)) {
  console.log('already patched — nothing to do')
  process.exit(0)
}

const HELPER = `// [xdpool-local] laneAllowedIds
//
// buddy / workbuddy are exempt from the startup silence pass because
// dsh-xdpool's own pool card owns their model selection (see
// POOL_OWNED_PROVIDERS below). The exemption avoided a conflict but not a GAP:
// \`disabledModelsFor("buddy")\` is therefore always empty, so every adapter
// returned its whole catalogue and the card's "1 of 16" had no effect on the
// host's model picker (#121).
//
// This helper is the missing link. It intersects the pack's own blacklist with
// the allow-list dsh-xdpool publishes on \`globalThis.__xdpoolLaneSelection\`,
// keyed by lane id. The global is a handoff, not an API: the pack is a build
// artifact of another repository and cannot import from the plugin's src/, and
// threading a value through ten adapter constructors would be rejected by the
// next pack refresh.
//
// Semantics that matter:
//   - an ABSENT entry (undefined) means "no restriction". A lane the user never
//     touched must keep showing everything; treating it as "empty allow-list"
//     would blank the picker.
//   - an EMPTY array means the user disabled every model, which is a real state
//     and must be honoured — hence the two are distinguished below rather than
//     folded with \`??\`.
function laneAllowedIds(disabled, laneId) {
  const table = globalThis.__xdpoolLaneSelection;
  const allow = table === void 0 || table === null ? void 0 : table[laneId];
  if (allow === void 0) return disabled;
  const allowed = new Set(allow);
  const blocked = disabled === void 0 ? EMPTY_MODEL_SET : disabled;
  // Return a real Set even when the pack had none: the call sites only test
  // \`size === 0\` and \`.has\`, so both must work.
  return new Set([...allowed].filter((id) => !blocked.has(id)));
}
`

// Insert the helper immediately after EMPTY_MODEL_SET is defined, which the
// helper reads. Anchored on the exact declaration line the pack ships
// (`var EMPTY_MODEL_SET = /* @__PURE__ */ new Set();`).
const anchor = 'var EMPTY_MODEL_SET = /* @__PURE__ */ new Set();'
const anchorAt = text.indexOf(anchor)
if (anchorAt === -1) throw new Error('EMPTY_MODEL_SET declaration not found; pack layout changed')
const definitionEnd = text.indexOf('\n', anchorAt)
if (definitionEnd === -1) throw new Error('could not find the end of the EMPTY_MODEL_SET line')
text = text.slice(0, definitionEnd + 1) + '\n' + HELPER + text.slice(definitionEnd + 1)
console.log('inserted laneAllowedIds helper')

// Rewrite the ten identical reads. Each becomes a call that also passes the
// lane id, so the helper knows which allow-list applies.
const NEEDLE = 'const disabled = this.options.accountPool?.disabledModelsFor(this.product.id);'
const REPLACEMENT = 'const disabled = laneAllowedIds(this.options.accountPool?.disabledModelsFor(this.product.id), this.product.id);'
const occurrences = text.split(NEEDLE).length - 1
if (occurrences !== 10) {
  throw new Error(`expected 10 disabled reads inside listModels, found ${String(occurrences)} — pack layout changed`)
}
text = text.split(NEEDLE).join(REPLACEMENT)
console.log(`rewrote ${String(occurrences)} listModels reads`)

writeFileSync(PACK, eol === '\r\n' ? text.replaceAll('\n', '\r\n') : text)
console.log('pack.js patched')

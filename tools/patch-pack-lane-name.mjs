/**
 * Patch the `buddy` lane's display name in the vendored pack (#119).
 *
 * `providerInfo()` appears ten times in `pack.js`, once per adapter, and nine of
 * them are byte-identical to each other. Only the WorkBuddy/CodeBuddy pair
 * matters here — its `name` comes from `this.product.displayName`, which is the
 * upstream constant `"CodeBuddy (腾讯)"`. Every other interface in this plugin
 * calls that same lane "WorkBuddy 国内版" (`src/channels.ts`, the region card,
 * the pool page), so a user who signed in to WorkBuddy saw the model picker
 * claim they were on a different product.
 *
 * The override is applied at the ONE `providerInfo` that is followed by the
 * WorkBuddy model-listing code, located by anchoring on its neighbouring doc
 * comment rather than on a line number: line numbers move with every pack
 * refresh, and a patch that lands on the wrong adapter would rename another
 * vendor's group.
 *
 * Why not edit `CODEBUDDY.displayName` itself: that constant also feeds the
 * rate-limit copy that tells the user "CodeBuddy (腾讯)：模型 … 均在限流中".
 * Renaming it there would change a message about an upstream product name into
 * one about a product the user never installed. The override is scoped to what
 * the picker shows, which is the surface the issue is about.
 *
 * Idempotent: re-running detects the marker and stops.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const PACK = join(ROOT, 'vendor', 'channel-pack', 'pack.js')
const MARKER = '[xdpool-local] LANE_DISPLAY_NAME'

const raw = readFileSync(PACK, 'utf8')
const eol = raw.includes('\r\n') ? '\r\n' : '\n'
let text = raw.replaceAll('\r\n', '\n')

if (text.includes(MARKER)) {
  console.log('already patched — nothing to do')
  process.exit(0)
}

/**
 * The two names this plugin uses, keyed by the lane ids the picker sees.
 *
 * Identical to `src/channels.ts`'s `name` for the same ids, including the
 * absence of parentheses: "WorkBuddy 国际版", not "WorkBuddy (国际版)". Keeping
 * them byte-identical is the point of the fix — a near-match would leave the
 * two screens differing by punctuation.
 */
const TABLE = `// [xdpool-local] LANE_DISPLAY_NAME
//
// The picker's group names for the two lanes this plugin owns, matching
// \`src/channels.ts\` exactly. The vendored upstream constants still call the CN
// lane "CodeBuddy (腾讯)", which is the endpoint's original product name; a user
// who signed in to WorkBuddy saw that name in the model picker while every card
// in this plugin called it "WorkBuddy 国内版" (#119).
//
// Scoped to \`providerInfo\` on purpose: \`CODEBUDDY.displayName\` also feeds the
// rate-limit copy, and renaming the constant would rewrite messages about a
// product the user never installed.
const LANE_DISPLAY_NAME = {
  buddy: "WorkBuddy 国内版",
  workbuddy: "WorkBuddy 国际版"
};
`

// 1. Insert the table once, right after the lane-selection helper block (both
//    are this plugin's local additions and belong together).
const helperAnchor = 'function laneAllowedIds(disabled, laneId) {'
const helperAt = text.indexOf(helperAnchor)
if (helperAt === -1) throw new Error('laneAllowedIds helper not found — run patch-pack-lane-selection.mjs first')
const helperEnd = text.indexOf('\n}\n', helperAt)
if (helperEnd === -1) throw new Error('could not find the end of laneAllowedIds')
text = text.slice(0, helperEnd + 3) + '\n' + TABLE + text.slice(helperEnd + 3)
console.log('inserted LANE_DISPLAY_NAME table')

// 2. Rewrite the ONE providerInfo whose neighbouring doc comment names both
//    products. The anchor is that comment, so a pack refresh that reorders
//    adapters cannot land this on another vendor.
const DOC_ANCHOR = `   * 展示名同样来自产品配置：CodeBuddy 为 'CodeBuddy (腾讯)'，`
const docAt = text.indexOf(DOC_ANCHOR)
if (docAt === -1) throw new Error("the WorkBuddy providerInfo doc comment was not found — pack layout changed")
const methodAt = text.indexOf('  providerInfo(provider) {', docAt)
if (methodAt === -1) throw new Error('the WorkBuddy providerInfo method was not found after its doc comment')

const OLD_BODY = `  providerInfo(provider) {
    const id = typeof provider === "string" && provider.length > 0 ? provider : this.product.id;
    return { id, name: this.product.displayName };
  }`
const NEW_BODY = `  providerInfo(provider) {
    const id = typeof provider === "string" && provider.length > 0 ? provider : this.product.id;
    // [xdpool-local] The picker's group name follows this plugin's own naming.
    return { id, name: LANE_DISPLAY_NAME[id] ?? this.product.displayName };
  }`
if (!text.startsWith(OLD_BODY, methodAt)) {
  throw new Error('the WorkBuddy providerInfo body no longer matches — pack layout changed')
}
text = text.slice(0, methodAt) + NEW_BODY + text.slice(methodAt + OLD_BODY.length)
console.log('rewrote the WorkBuddy/CodeBuddy providerInfo')

writeFileSync(PACK, eol === '\r\n' ? text.replaceAll('\n', '\r\n') : text)
console.log('pack.js patched')

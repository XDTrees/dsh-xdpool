/**
 * Patch channel-pack: let billion-context re-sign the CodeArts chat request.
 *
 * CodeArts chat is an SDK-HMAC-SHA256 request to Huawei APIG. billion-context
 * (bili) sits inside DSH, intercepts model traffic and compresses context — and
 * compression rewrites the body, which a body-covering signature cannot survive.
 * Its stated contract is binary: a signed request is either RE-SIGNED+COMPRESSED
 * or REFUSED locally. With no credential it refuses:
 *
 *   403 {"code":"bili_resign_unavailable","error":{"type":"signed_request_requires_resign"}}
 *
 * The pack already knows how to hand bili a credential: the two loopback marker
 * headers `x-bili-resign` / `x-bili-resign-credential` (base64 JSON of
 * ak/sk/token) let bili recompute the signature on every egress body it
 * produces. That support existed but was gated behind `codeartsResignHeaders:
 * true`, which nothing ever set, so it was dead code in practice.
 *
 * WHY THE GATE STILL MATTERS — and why this patch does NOT simply flip it on:
 *
 *   The credential marker carries the secret access key. bili strips both
 *   headers in its forward header loop (`server.ts`: "loopback re-sign markers
 *   are internal to the bili tunnel — they must never reach the upstream (they
 *   carry the credential)"), so WITH bili in the path the secret never leaves
 *   the machine. WITHOUT bili, nothing strips them and the AK/SK would be sent
 *   to Huawei verbatim in a header Huawei does not even read.
 *
 *   `billion-context` is an optionalDependency. So the switch is driven by
 *   whether bili's fetch chain is actually installed in THIS process, not by a
 *   user setting: `Symbol.for("billion-context.native-fetch-intercept")` is the
 *   flag bili sets on `globalThis` when its interceptor is live (#1410), and
 *   `Symbol.for("billion-context.native-intercept-state")` is the live-instance
 *   slot (#3394). Either being present means the markers will be consumed and
 *   stripped locally. Neither present means they are never sent.
 *
 *   An explicit `false` still wins, so an embedder can opt out.
 *
 * Idempotent: re-running finds the marker and stops.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const PATH = 'vendor/channel-pack/pack.js'
const MARKER = '[xdpool-local] bili re-sign markers'

const GATE_ANCHOR = '      if (this.options.codeartsResignHeaders === true) {'
const HELPER_ANCHOR = 'function registerCodeArtsLlm(ctx, options) {'

const source = readFileSync(PATH, 'utf8')
if (source.includes(MARKER)) {
  console.log('already patched')
  process.exit(0)
}

const countOf = (text, needle) => text.split(needle).length - 1
for (const [needle, want, label] of [
  [GATE_ANCHOR, 1, 'resign-header gate'],
  [HELPER_ANCHOR, 1, 'registerCodeArtsLlm'],
]) {
  const found = countOf(source, needle)
  if (found !== want) {
    throw new Error(
      `${label}: expected ${String(want)} occurrence, found ${String(found)} — pack.js changed shape, re-derive the patch`,
    )
  }
}

let patched = source

// (1) A detector for "bili is intercepting this process's fetch right now".
//     Both symbols are bili's own cross-copy identities, so a duplicate install
//     is still detected.
patched = patched.replace(
  HELPER_ANCHOR,
  [
    '// [xdpool-local] bili re-sign markers — see tools/patch-pack-codearts-bili-credential.mjs.',
    '//',
    '// billion-context only re-signs what it is given a credential for; without one it',
    '// refuses a body-signed model request outright (compress-or-refuse). These two',
    '// symbols are bili\'s own globalThis identities — set while its fetch interceptor',
    '// is live in this process — so the credential markers are attached exactly when',
    '// something in the request path is guaranteed to consume and strip them before',
    '// egress. When bili is absent the markers are never added: there would be no one',
    '// to strip them and the secret would travel to the upstream in a header Huawei',
    '// does not read.',
    'function biliFetchChainPresent() {',
    '  try {',
    '    const g = globalThis;',
    '    return g[Symbol.for("billion-context.native-fetch-intercept")] === true ||',
    '      g[Symbol.for("billion-context.native-intercept-state")] !== undefined;',
    '  } catch {',
    '    return false;',
    '  }',
    '}',
    '',
    HELPER_ANCHOR,
  ].join('\n'),
)

// (2) The gate: explicit true ⇒ on, explicit false ⇒ off, otherwise follow the
//     live interceptor.
patched = patched.replace(
  GATE_ANCHOR,
  [
    '      // [xdpool-local] bili re-sign markers: attach the credential when bili is',
    '      // actually intercepting this process (it strips both before egress and',
    '      // re-signs every body it rewrites). An explicit false opts out.',
    '      if (',
    '        this.options.codeartsResignHeaders === true ||',
    '        (this.options.codeartsResignHeaders !== false && biliFetchChainPresent())',
    '      ) {',
  ].join('\n'),
)

writeFileSync(PATH, patched)
console.log('bili re-sign marker patch applied')

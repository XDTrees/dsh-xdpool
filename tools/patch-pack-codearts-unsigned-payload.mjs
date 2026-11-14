/**
 * Patch channel-pack: sign CodeArts chat requests with `UNSIGNED-PAYLOAD`.
 *
 * Huawei APIG's SDK-HMAC-SHA256 covers the request BODY by default: the signer
 * hashes the bytes and puts that digest in `x-sdk-content-sha256`, and the
 * gateway recomputes `sha256(body)` and compares. Anything that rewrites the
 * body after signing — billion-context's context compression, a retry that
 * re-serializes the JSON — therefore invalidates the signature upstream
 * (401 APIG.0301 "body hash mismatch x-sdk-content-sha256").
 *
 * Huawei's own signer spec has an escape hatch for exactly this: send
 *
 *   X-Sdk-Content-Sha256: UNSIGNED-PAYLOAD
 *
 * and the gateway skips the body-hash comparison — the canonical request
 * carries the literal string `UNSIGNED-PAYLOAD` in place of the digest
 * ("需要读取 body 的条件为：不存在值为 UNSIGNED-PAYLOAD 的
 * x-sdk-content-sha256 头", devg-apisign §5.3 / devg-apig). Method, path,
 * query, host, x-sdk-date and the signed-header list are still signed, so the
 * request is still authenticated — only the body stops being pinned.
 *
 * SCOPE — CodeArts chat only:
 *
 *   - `signRequestHuawei` gains an OPTIONAL eighth parameter and is otherwise
 *     unchanged, so omitting it keeps body-hash signing byte-for-byte. The
 *     other three call sites in this bundle (the model-catalog GET in
 *     `fetchSignedGet`, the queue-status GET, and `signedSnapRequest` used by
 *     the points/benefit flow) do not pass it — WorkBuddy and every other
 *     vendor are untouched.
 *   - Only the CodeArts chat call opts in.
 *   - No user-facing switch: the route is identified by provider, as the bug
 *     report asked. Nothing for a user to misconfigure.
 *
 * Idempotent: re-running finds the marker and stops.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const PATH = 'vendor/channel-pack/pack.js'
const MARKER = '[xdpool-local] UNSIGNED-PAYLOAD'

const SIGNER_ANCHOR = 'async function signRequestHuawei(ak, sk, securityToken, method, urlStr, body, extraHeaders) {'
const PAYLOAD_ANCHOR = '  const payloadHash = await sha256Hex(body);'
const CHAT_ANCHOR = [
  '        "POST",',
  '        url,',
  '        new TextEncoder().encode(body),',
  '        extraSignedHeaders',
  '      );',
].join('\n')

const source = readFileSync(PATH, 'utf8')
if (source.includes(MARKER)) {
  console.log('already patched')
  process.exit(0)
}

const countOf = (text, needle) => text.split(needle).length - 1
for (const [needle, want, label] of [
  [SIGNER_ANCHOR, 1, 'signer signature'],
  [PAYLOAD_ANCHOR, 1, 'payload-hash line'],
  [CHAT_ANCHOR, 1, 'CodeArts chat signing call'],
]) {
  const found = countOf(source, needle)
  if (found !== want) {
    throw new Error(
      `${label}: expected ${String(want)} occurrence, found ${String(found)} — pack.js changed shape, re-derive the patch`,
    )
  }
}

let patched = source

// (1) The signer gains an opt-in flag. Its body is untouched when the flag is
//     absent — that is what keeps the other three callers on body signing.
patched = patched.replace(
  SIGNER_ANCHOR,
  [
    SIGNER_ANCHOR.replace('extraHeaders) {', 'extraHeaders, unsignedPayload) {'),
    '  // [xdpool-local] UNSIGNED-PAYLOAD — CodeArts chat only. See',
    '  // tools/patch-pack-codearts-unsigned-payload.mjs.',
    '  //',
    '  // Huawei APIG verifies sha256(body) against x-sdk-content-sha256 unless that',
    '  // header reads UNSIGNED-PAYLOAD, in which case the body is not covered by the',
    '  // signature at all. A caller that lets something rewrite the body after',
    '  // signing (context compression) needs exactly that, because a rewritten body',
    '  // can never match the digest of the original. Omitted ⇒ historical',
    '  // behaviour: hash the bytes, sign the digest.',
  ].join('\n'),
)

// (2) payloadHash is the literal string when the caller opted in, the digest
//     otherwise. The literal is what the gateway compares against.
patched = patched.replace(
  PAYLOAD_ANCHOR,
  '  const payloadHash = unsignedPayload === true ? "UNSIGNED-PAYLOAD" : await sha256Hex(body);',
)

// (3) The CodeArts chat call is the only site that opts in.
patched = patched.replace(
  CHAT_ANCHOR,
  [
    '        "POST",',
    '        url,',
    '        new TextEncoder().encode(body),',
    '        extraSignedHeaders,',
    '        // [xdpool-local] UNSIGNED-PAYLOAD: billion-context compresses context by',
    "        // rewriting this body, and a body-covering signature cannot survive that.",
    "        // Huawei's own signer spec lets the body leave the signature: the gateway",
    '        // then authenticates method/path/query/headers and skips the body-hash',
    '        // comparison. Chat only — the catalog and queue-status GETs, and',
    '        // signedSnapRequest, keep their body-hash signatures.',
    '        true',
    '      );',
  ].join('\n'),
)

writeFileSync(PATH, patched)
console.log('UNSIGNED-PAYLOAD patch applied')

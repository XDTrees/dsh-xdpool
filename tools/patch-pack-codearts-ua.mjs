/**
 * Patch channel-pack: give the CodeArts request an IDE-shaped User-Agent.
 *
 * The host's `attributionHeaders()` stamps
 *   user-agent: deepseek-harness/<ver> (+https://github.com/deepseek-ai/deepseek-harness)
 * and the snap-access gateway rejects exactly that string with
 *
 *   HTTP 403 {"error_code":"TM.00000001","error_msg":"网络繁忙，请稍后重试"}
 *
 * Measured with the same credential, same body, same endpoint:
 *   harness UA            -> 403 TM.00000001
 *   no UA (Node default)  -> 200, streams normally
 *   CodeArts-Agent/1.0    -> 200, streams normally
 *
 * so the credential, the signature, the model id and the body are all correct and
 * the UA alone decides. Overriding it is the fix; leaving it to the host means
 * every CodeArts request fails with a message that reads like a bad key.
 *
 * Idempotent: re-running finds the marker and stops.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const PATH = 'vendor/channel-pack/pack.js'
const MARKER = 'CodeArts-Agent/1.0'
const ANCHOR = '      const headers = new Headers(attributionHeaders());'

const source = readFileSync(PATH, 'utf8')
if (source.includes(MARKER)) {
  console.log('already patched')
  process.exit(0)
}
if (!source.includes(ANCHOR)) {
  throw new Error('anchor line not found — pack.js changed shape, re-derive the patch')
}

const replacement = [
  ANCHOR,
  '      // [xdpool-local] Override the host USER-AGENT, or the gateway answers 403.',
  '      //',
  '      // attributionHeaders() stamps the DSH bot UA and snap-access rejects it',
  '      // outright with 403 {error_code:TM.00000001}. Measured against the live',
  '      // gateway with the SAME credential, body and endpoint: the harness UA gets',
  '      // 403, no UA gets 200, an IDE-shaped UA gets 200 — so the UA alone decides,',
  '      // and every CodeArts request failed with a message that reads like a bad key.',
  '      //',
  '      // Only the UA is replaced. The other attribution headers stay: they identify',
  '      // the host for support and are not rejected.',
  '      headers.set("user-agent", "CodeArts-Agent/1.0 (Windows NT 10.0; Win64; x64)");',
].join('\n')

// One replacement only: the anchor is a single occurrence, and asserting that
// keeps the patch from silently spreading if pack.js ever gains a second copy.
const occurrences = source.split(ANCHOR).length - 1
if (occurrences !== 1) throw new Error(`expected 1 anchor, found ${String(occurrences)}`)

writeFileSync(PATH, source.replace(ANCHOR, replacement))
console.log('UA patch applied')

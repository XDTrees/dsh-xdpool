/**
 * The gateway hands out two strings a client must transcribe EXACTLY: the base URL
 * (including the `/v1` the OpenAI wire needs) and the key. Getting either wrong
 * produces a 401 or a 404 that says nothing about the transcription.
 *
 * The reference gateway solves the same problem by printing a shell one-liner that
 * pipes a local settings file into the clipboard — necessary there because its key
 * exists only on disk. Here the key is already in the status document, so the button
 * can be direct.
 *
 * Two decisions are worth pinning:
 *
 *   1. the copied base URL is derived from the address the listener ACTUALLY bound
 *      (`status.endpoint`), not the requested port — port 0 asks the OS for a free
 *      port, and a `0.0.0.0` bind cannot be dialled from the same machine;
 *   2. the key is copied even while masked, because the mask guards against a
 *      shoulder-surfer, not against the user.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const page = readFileSync(new URL('../src/client/GatewayPage.tsx', import.meta.url), 'utf8')
const clipboard = readFileSync(new URL('../src/client/clipboard.ts', import.meta.url), 'utf8')

describe('the gateway copy buttons', () => {
  it('copies the base URL with the /v1 suffix a client needs', () => {
    expect(page).toContain("copy('base', origin)")
    // Derived from the bound endpoint, trailing slashes trimmed so a double slash
    // cannot appear before `/v1`.
    expect(page).toContain("endpoint.replace(/\\/+$/u, '')")
    expect(page).toContain('/v1`')
  })

  it('offers BOTH base URL forms, because clients disagree about who adds /v1', () => {
    // Reported: `404 /v1/v1/responses`. The client appended `/v1` to a base URL that
    // already ended in `/v1`. There is no single correct string — an SDK that appends
    // the path wants the bare origin, while a field like OPENAI_BASE_URL wants the
    // full prefix — so the panel offers both and names the client each suits.
    expect(page).toContain("copy('baseV1', baseUrl)")
    expect(page).toContain("copy('base', origin)")
    expect(page).toContain('gw.copyOriginHint')
    expect(page).toContain('gw.copyV1Hint')
  })

  it('says which wire the relay speaks, so a Responses client is not a mystery 404', () => {
    // The relay forwards exactly two paths; `/v1/responses` is not one of them.
    expect(page).toContain('gw.wire')
  })

  it('makes the model id copyable, because the id is what the client must send', () => {
    // Reported: a client sent `DeepSeek-V4.1-Flash` and got
    // `403 ... is not shared on this gateway`, while the shared id was
    // `trae:deepseek-v4.1-flash`. Same model to a human, different strings to the
    // relay — and nothing bridged the gap.
    expect(page).toContain('copy(`id:${row.id}`, row.id)')
    // Only the id is copied. Copying the display name would reproduce the failure.
    expect(page).not.toContain('copy(`id:${row.id}`, row.name)')
  })

  it('does not toggle the checkbox when the id is copied', () => {
    // The row is a <label>, so a click inside it activates the control — which would
    // unshare the very model whose id was just copied.
    const start = page.indexOf('copy(`id:${row.id}`, row.id)')
    const before = page.slice(Math.max(0, start - 420), start)
    expect(before).toContain('event.preventDefault()')
    expect(before).toContain('event.stopPropagation()')
  })

  it('builds the shared snippet from the live endpoint, not the requested port', () => {
    // `status.endpoint` is what actually bound. Copying `host:port` from the form
    // would hand out a URL that does not answer when a port of 0 was requested.
    const start = page.indexOf('const configSnippet')
    expect(start).toBeGreaterThan(-1)
    const body = page.slice(start, start + 400)
    expect(body).toContain('baseUrl')
    expect(body).not.toContain('parsedPort')
  })

  it('copies the REAL key while it is masked on screen', () => {
    // The mask is a shoulder-surfing guard, not a statement that the value is
    // unavailable — so copying must not require revealing it first.
    expect(page).toContain("copy('key', key)")
    const keyStart = page.indexOf("copy('key', key)")
    // The copy button's own `disabled` decides eligibility: no key, or a write in
    // flight. Adding `revealed` there would defeat the guard it exists for.
    const button = page.slice(Math.max(0, keyStart - 420), keyStart)
    expect(button).toContain('disabled={busy || key ===')
    expect(button).not.toContain('revealed')
  })

  it('says which field was copied, not just that something was', () => {
    // One global flag would put "Copied" on the key button right after the base URL
    // was copied, in a panel whose whole job is handing over the right string.
    expect(page).toContain('copiedField')
    expect(page).toContain("copiedField === 'base'")
    expect(page).toContain("copiedField === 'key'")
  })

  it('reports a failed copy instead of silently doing nothing', () => {
    // A copy button that fails quietly leaves the user pasting a stale clipboard and
    // blaming the key.
    expect(page).toContain('gw.copyFailed')
    expect(page).toContain('if (!ok)')
  })

  it('falls back to execCommand where the async clipboard is unavailable', () => {
    // The card can be served over plain http:// on a LAN address, where
    // `navigator.clipboard` is undefined rather than rejecting.
    expect(clipboard).toContain("doc.createElement('textarea')")
    expect(clipboard).toContain("doc.execCommand('copy')")
    expect(clipboard).toContain("area.setAttribute('readonly', '')")
  })

  it('returns false rather than throwing when there is no clipboard at all', () => {
    expect(clipboard).toContain('if (doc === undefined) return false')
    expect(clipboard).toContain("if (value === '') return false")
  })
})

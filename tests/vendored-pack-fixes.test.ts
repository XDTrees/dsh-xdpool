import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The vendored pack's two source-level fixes.
 *
 * Both are strings in a bundled vendor file rather than importable functions, so the checks
 * are structural: they assert the SHAPE that fixes the defect is present, which is what a
 * future regeneration of the bundle would silently drop.
 */
const packPath = join(import.meta.dirname, '..', 'vendor', 'channel-pack', 'pack.js')

describe('the vendored pack', () => {
  const pack = readFileSync(packPath, 'utf8')

  it('falls back to any pool account when listing TRAE models (issue #154)', () => {
    // `getAvailableAccount` skips an account that is cooling, disabled or simply not picked,
    // and the old code then resolved `TRAE_ACCESS_TOKEN` — a ref a scan login never writes.
    // The result was an empty catalogue, a silent give-up, and the 28 hard-coded fallback
    // rows under names the vendor never published.
    expect(pack).toContain('listAccountsByProvider(this.product.id)')
    expect(pack).toContain('issue #154')
  })

  it('shrinks a Qoder payload before it reaches the WASM (issue #155)', () => {
    // The encrypted-infer glue declares ~1 MB and the whole request is written into it; the
    // overflow panics Rust and surfaces as the bare word `unreachable`.
    expect(pack).toContain('shrinkQoderPayload(payload)')
    expect(pack).toContain('QODER_PAYLOAD_BYTE_BUDGET')
    expect(pack).toContain('issue #155')
  })

  it('cuts OLDEST turns first and never the last message', () => {
    // Dropping the current question would answer something the user did not ask; dropping a
    // lone tool result would make the request invalid rather than merely shorter.
    const shrink = pack.slice(pack.indexOf('function shrinkQoderPayload'), pack.indexOf('async function getGlue'))
    expect(shrink).toContain('out.messages.length > 2')
    expect(shrink).toContain('out.messages.shift()')
  })

  it('never sends the retired benefit header (issue #150)', () => {
    // `maas_type: benefit` lands the request on a lane the upstream retired; every CodeArts
    // turn failed with "The API does not exist" until it stopped being sent.
    expect(pack).toContain('const extraSignedHeaders = void 0')
    expect(pack).not.toContain('{ maas_type: "benefit" }')
  })
})

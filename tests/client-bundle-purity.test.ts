import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The client bundle must not reach Node.
 *
 * A card that imports a host module drags that module's whole dependency chain along. The
 * Doubao card once imported `doubao-llm.ts` for its model list, which reaches
 * `doubao-auth.ts` — and that spawns a browser and reads the filesystem. The bundled result
 * contained `node:fs` and `node:crypto`, so the moment the page loaded it threw, and the
 * plugin's entry disappeared: still listed and enabled, absent from the sidebar and the
 * settings page, with no error anywhere the user could see.
 *
 * The fix was to move the DATA into a module with no imports (`doubao-models.ts`). This test
 * is what stops the next helper from being imported "just for one constant".
 */
describe('the client bundle', () => {
  const clientPath = join(import.meta.dirname, '..', 'lib', 'client.js')

  /** Whether a built bundle exists; the source-only checkout has none. */
  const hasBundle = ((): boolean => {
    try {
      readFileSync(clientPath, 'utf8')
      return true
    } catch {
      return false
    }
  })()

  it('is buildable independently of the host', () => {
    // The build is what produces the file; if it is absent the assertion below cannot run,
    // and saying so beats a false pass.
    if (!hasBundle) {
      expect(hasBundle, 'lib/client.js is missing — build before testing this').toBe(true)
      return
    }
    const bundle = readFileSync(clientPath, 'utf8')
    const offenders = [...bundle.matchAll(/require\("(node:[a-z_/]+)"\)/gu)].map(match => match[1] ?? '')
    const unique = [...new Set(offenders)]
    expect(unique, 'the client bundle must not require Node builtins').toEqual([])
  })

  it('carries no filesystem, crypto or process spawn', () => {
    if (!hasBundle) return
    const bundle = readFileSync(clientPath, 'utf8')
    for (const name of ['node:fs', 'node:crypto', 'node:child_process', 'node:os', 'node:path']) {
      expect(bundle.includes(`require("${name}")`), `client bundle reaches ${name}`).toBe(false)
    }
  })
})

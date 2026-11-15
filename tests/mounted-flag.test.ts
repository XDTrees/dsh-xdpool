import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The mounted flag must be set ON mount, not only cleared on unmount.
 *
 * A `useRef(true)` is initialised once per component INSTANCE, and React's StrictMode mounts,
 * unmounts and re-mounts the same instance. The cleanup sets the flag to false; nothing sets
 * it back. From then on every guard reads false and returns before touching state — so the
 * data arrives, the component ignores it, and the panel shows an empty or stale view for a
 * reason nothing in the network log explains.
 *
 * That is exactly what happened to a card that reads its own state over a route: the host
 * answered `signedIn: true` with
 * twelve models, and the card kept showing "not signed in" because its own flag said it was
 * gone. The fix is one line per file, and this test is what keeps it from coming back.
 */
describe('the mounted flag', () => {
  const clientDir = join(import.meta.dirname, '..', 'src', 'client')
  const files = readdirSync(clientDir).filter(name => name.endsWith('.tsx'))

  /** Components that keep a mounted ref. */
  const withFlag = files.filter(name => {
    const source = readFileSync(join(clientDir, name), 'utf8')
    return /useRef\(true\)/u.test(source)
  })

  it('finds the components that use it', () => {
    // A guard against the scan silently matching nothing, which would make the assertion
    // below pass for the wrong reason.
    expect(withFlag.length).toBeGreaterThan(0)
  })

  it('is set back to true on mount in every component that clears it', () => {
    const offenders: string[] = []
    for (const name of withFlag) {
      const source = readFileSync(join(clientDir, name), 'utf8')
      const refName = /const (\w+) = useRef\(true\)/u.exec(source)?.[1]
      if (refName === undefined) continue
      const clears = source.includes(`${refName}.current = false`)
      if (!clears) continue
      const restores = source.includes(`${refName}.current = true`)
      if (!restores) offenders.push(name)
    }
    expect(offenders, 'these clear the flag on unmount but never set it back on mount').toEqual([])
  })

  it('restores it inside an effect, not at module scope', () => {
    // Setting it at module scope would run once per import and be just as wrong.
    for (const name of withFlag) {
      const source = readFileSync(join(clientDir, name), 'utf8')
      const refName = /const (\w+) = useRef\(true\)/u.exec(source)?.[1]
      if (refName === undefined) continue
      if (!source.includes(`${refName}.current = true`)) continue
      // The restore has to sit in the same effect that clears it, so the pair is mounted
      // and unmounted together.
      const effectAt = source.indexOf('useEffect(')
      const restoreAt = source.indexOf(`${refName}.current = true`)
      expect(restoreAt, `${name} must set the flag inside an effect`).toBeGreaterThan(effectAt)
    }
  })
})

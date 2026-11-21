/**
 * The device id Marvis expects on every request.
 *
 * WHERE IT COMES FROM
 *
 * `HKCU\SOFTWARE\Tencent\Marvis\Env\svid` when the client is installed. Without it the
 * service answers `-109 RC_PARAMS_INVALID` on the very first exchange — the parameter check runs
 * BEFORE the code is validated, so a missing guid reads like a malformed request and is actually
 * a missing device.
 *
 * A machine without the client derives the same 32-hex shape from its own name and user. It is
 * stable per machine, so a re-login does not produce a new device, and it needs no binary — the
 * reference implementation once shipped four DLLs to sign this and no longer does.
 *
 * @module dsh-xdpool/marvis-device
 */
import { createHash } from 'node:crypto'
import { hostname, userInfo } from 'node:os'
import { spawnSync } from 'node:child_process'

/** The registry value the client writes. */
const SVID_KEY = 'HKCU\\SOFTWARE\\Tencent\\Marvis\\Env'

/** Cached: the lookup runs a synchronous `reg query`, and this is called per request. */
let cached: string | undefined

/** The registry value, or undefined when the client is not installed. */
function fromRegistry(): string | undefined {
  if (process.platform !== 'win32') return undefined
  try {
    const out = spawnSync('reg', ['query', SVID_KEY, '/v', 'svid'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 3000,
    })
    const match = /svid\s+REG_SZ\s+([0-9a-fA-F]{32})/u.exec(String(out.stdout ?? ''))
    return match?.[1]?.toLowerCase()
  } catch {
    return undefined
  }
}

/**
 * The device id.
 *
 * Always 32 lowercase hex: the service rejects any other shape, and a per-call value would make
 * every request look like a new device.
 */
export function deviceGuid(): string {
  if (cached !== undefined) return cached
  const registry = fromRegistry()
  if (registry !== undefined) {
    cached = registry
    return cached
  }
  // Derived, not random: the same machine must present the same device on every sign-in.
  const seed = `${hostname()}|${userInfo().username}|marvis`
  cached = createHash('md5').update(seed).digest('hex')
  return cached
}

/** Drop the cache, for a test. */
export function resetDeviceCache(): void {
  cached = undefined
}

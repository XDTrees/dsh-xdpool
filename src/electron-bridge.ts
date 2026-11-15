/**
 * Asking the host for its own browser.
 *
 * THE THIRD ROAD, AND WHY IT IS WORTH TRYING
 *
 * Reading a browser's cookies normally needs the DevTools protocol, and an ordinary user's
 * browser does not listen on a debugging port. But this plugin does not run in an ordinary
 * process: it runs inside the DSH desktop app, which is Electron. If the Electron runtime is
 * reachable from here, the plugin can open a window of its own, let the user sign in there,
 * and read that window's cookie jar through Electron's own API — no debugging port, no
 * pasting, and the same one-click experience the scanning channels give.
 *
 * WHAT IS PROBED, AND WHY EACH WAY
 *
 * Electron's main process is reachable in three different ways depending on how a module is
 * loaded, and which one works is a property of the host rather than of this code:
 *
 *   1. `import('electron')`   — the ESM path, which is how this plugin is written;
 *   2. `createRequire(...)('electron')` — the CommonJS path, which is how Electron's own
 *      internals do it and which resolves even from an ESM module;
 *   3. `process.versions.electron` alone — no module needed, but it only says the runtime
 *      IS Electron, which is worth knowing separately from whether the API is reachable.
 *
 * The result is reported rather than assumed. A host that does not allow this must fall back
 * to the paste, and pretending otherwise would leave the panel offering a button that does
 * nothing.
 *
 * @module dsh-xdpool/electron-bridge
 */

/** What the host allows, as far as it can be established from in here. */
export interface ElectronProbe {
  /** Whether this process IS Electron. */
  isElectron: boolean
  /** Which route reached the API, for the record. */
  via: 'import' | 'require' | undefined
  /** Whether the cookie and window APIs are present. */
  hasBrowserWindow: boolean
  hasSession: boolean
}

/** The shape of the pieces of Electron this module uses, kept minimal on purpose. */
export interface ElectronApi {
  BrowserWindow: new (options: Record<string, unknown>) => ElectronWindow
  session: { fromPartition: (partition: string) => ElectronSession }
}

/** One Electron window, as far as this module touches it. */
export interface ElectronWindow {
  loadURL: (url: string) => Promise<void>
  on: (event: string, listener: (...args: unknown[]) => void) => void
  destroy: () => void
  webContents: { session: ElectronSession; on: (event: string, listener: () => void) => void }
}

/** One Electron session, as far as this module touches it. */
export interface ElectronSession {
  cookies: { get: (filter: { url: string }) => Promise<{ name: string; value: string }[]> }
}

/**
 * Try to reach the Electron API from inside the host.
 *
 * Every route is tried and the first that yields `BrowserWindow` and `session` wins. A route
 * that throws is not an error worth reporting — it is simply not this host's route.
 */
export async function probeElectron(): Promise<{ probe: ElectronProbe; api: ElectronApi | undefined }> {
  const isElectron = typeof process.versions['electron'] === 'string'
  const probe: ElectronProbe = { isElectron, via: undefined, hasBrowserWindow: false, hasSession: false }

  /** Does this object look like the Electron API? */
  const usable = (candidate: unknown): candidate is ElectronApi => {
    if (typeof candidate !== 'object' || candidate === null) return false
    const api = candidate as Record<string, unknown>
    return typeof api['BrowserWindow'] === 'function' &&
      typeof api['session'] === 'object' && api['session'] !== null &&
      typeof (api['session'] as Record<string, unknown>)['fromPartition'] === 'function'
  }

  // 1. The ESM route.
  try {
    // The module id is held in a variable so TypeScript does not try to resolve it: the
    // package is a runtime builtin of the Electron process, and it is not on disk.
    const moduleId = 'electron'
    const imported = await import(moduleId) as unknown
    // Electron's ESM build puts the API on `default` as well as at the top level.
    const candidates = [imported, (imported as { default?: unknown }).default]
    for (const candidate of candidates) {
      if (usable(candidate)) {
        probe.via = 'import'
        probe.hasBrowserWindow = true
        probe.hasSession = true
        return { probe, api: candidate }
      }
    }
  } catch { /* not this route */ }

  // 2. The CommonJS route, resolved from the host's own main module.
  try {
    const { createRequire } = await import('node:module')
    const hostEntry = process.argv[1] ?? process.execPath
    const req = createRequire(hostEntry)
    const required = req('electron') as unknown
    if (usable(required)) {
      probe.via = 'require'
      probe.hasBrowserWindow = true
      probe.hasSession = true
      return { probe, api: required }
    }
  } catch { /* not this route */ }

  return { probe, api: undefined }
}

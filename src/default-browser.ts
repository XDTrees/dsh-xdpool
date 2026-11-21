/**
 * Which browser to drive for a sign-in.
 *
 * WHY THIS EXISTS
 *
 * The other channels in this plugin hand a URL to `window.open`, so the sign-in always appears in
 * whatever browser the user actually uses. The lanes that drive a browser themselves — Doubao and
 * Marvis — started one from a hard-coded list with Chrome first, which meant a machine whose
 * default is Edge got a Chrome window instead. Two channels, two different browsers, for no
 * reason the user could see.
 *
 * So this reads the default browser and puts it first. The fixed list stays as the fallback:
 * a machine can have no default set, and a default can name a browser that cannot be driven
 * (Firefox has no DevTools protocol of this shape).
 *
 * @module dsh-xdpool/default-browser
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** What the user's own browser is, when it can be determined. */
export interface DefaultBrowser {
  /** Display name, e.g. `Edge`. */
  name: string
  /** Absolute path to the executable. */
  path: string
}

/** Run `reg query` and return its output, or an empty string. */
function regQuery(key: string): string {
  if (process.platform !== 'win32') return ''
  try {
    return execFileSync('reg', ['query', key], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 4000,
    })
  } catch {
    return ''
  }
}

/**
 * The executable behind a Windows ProgId.
 *
 * `MSEdgeHTM` maps to a command line like
 * `"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --single-argument %1`;
 * only the quoted path is used, because the rest is the shell's own argument.
 */
function exeFromProgId(progId: string): string | undefined {
  for (const root of ['HKCR', 'HKCU\\SOFTWARE\\Classes', 'HKLM\\SOFTWARE\\Classes']) {
    const output = regQuery(`${root}\\${progId}\\shell\\open\\command`)
    if (output === '') continue
    const line = output.split('\n').find(entry => /REG_SZ/iu.test(entry)) ?? ''
    const quoted = /"([^"]+\.exe)"/iu.exec(line)
    const bare = quoted?.[1]
    if (bare !== undefined && existsSync(bare)) return bare
    const loose = /([A-Za-z]:\\[^\s"]+\.exe)/iu.exec(line)
    if (loose?.[1] !== undefined && existsSync(loose[1])) return loose[1]
  }
  return undefined
}

/** A readable name for an executable path. */
function nameOf(path: string): string {
  const base = path.replaceAll('/', '\\').split('\\').pop()?.toLowerCase() ?? ''
  if (base.includes('msedge')) return 'Edge'
  if (base.includes('chrome')) return 'Chrome'
  if (base.includes('brave')) return 'Brave'
  if (base.includes('vivaldi')) return 'Vivaldi'
  if (base.includes('qqbrowser')) return 'QQ浏览器'
  if (base.includes('360')) return '360浏览器'
  if (base.includes('quark')) return '夸克'
  if (base.includes('sogou')) return '搜狗'
  return base.replace(/\.exe$/iu, '')
}

/**
 * The browser the user opens links with, when it is one this can drive.
 *
 * Returns undefined when there is no default, when the default is not a Chromium browser (Firefox
 * cannot be driven this way), or when the platform is not Windows — the caller then falls back to
 * its own list.
 */
export function defaultBrowser(): DefaultBrowser | undefined {
  if (process.platform !== 'win32') return undefined
  const choice = regQuery(
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice',
  )
  const progId = /ProgId\s+REG_SZ\s+(\S+)/iu.exec(choice)?.[1]
  if (progId === undefined || progId === '') return undefined
  /**
   * A non-Chromium default is reported as "no answer" on purpose.
   *
   * `MozillaURL` / `FirefoxURL` would open a window this cannot attach to, and a sign-in that
   * silently cannot be captured is worse than falling back to a browser that can.
   */
  if (/firefox|mozilla/iu.test(progId)) return undefined
  const path = exeFromProgId(progId)
  if (path === undefined) return undefined
  return { name: nameOf(path), path }
}

/**
 * Every Chromium browser worth trying, most likely first.
 *
 * This lives here so the two lanes that drive a browser (Doubao and Marvis) cannot drift apart:
 * each used to carry its own list — one with ten hard-coded paths, one with twenty-seven — and a
 * browser added to only one of them was invisible to the other channel.
 */
export function chromiumCandidates(): readonly DefaultBrowser[] {
  const local = process.env['LOCALAPPDATA'] ?? ''
  const roaming = process.env['APPDATA'] ?? ''
  const pf = process.env['PROGRAMFILES'] ?? ''
  const pf86 = process.env['PROGRAMFILES(X86)'] ?? process.env['ProgramFiles(x86)'] ?? ''
  const found: DefaultBrowser[] = []
  const add = (name: string, path: string): void => {
    if (path !== '' && existsSync(path)) found.push({ name, path })
  }
  for (const exe of [
    'chrome.exe', '360ChromeX.exe', '360chrome.exe', '360se.exe', 'QQBrowser.exe',
    'Brave.exe', 'vivaldi.exe', 'opera.exe', 'SogouExplorer.exe', 'Quark.exe', 'msedge.exe',
  ]) {
    const path = exeFromProgIdPath(exe)
    if (path !== undefined) add(nameOf(path), path)
  }
  add('Chrome', join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'))
  add('Chrome', join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'))
  add('Chrome', join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'))
  add('Chromium', join(local, 'Chromium', 'Application', 'chrome.exe'))
  add('QQ浏览器', join(local, 'Tencent', 'QQBrowser', 'Application', 'QQBrowser.exe'))
  add('360极速', join(local, '360ChromeX', 'Chrome', 'Application', '360ChromeX.exe'))
  add('Brave', join(pf, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'))
  add('Vivaldi', join(local, 'Vivaldi', 'Application', 'vivaldi.exe'))
  add('搜狗', join(local, 'SogouExplorer', 'SogouExplorer.exe'))
  add('夸克', join(local, 'Quark', 'Quark.exe'))
  // Edge last: it has the most organisational policy and is the most likely to be disabled.
  add('Edge', join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))
  add('Edge', join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))
  const seen = new Set<string>()
  return found.filter(browser => {
    const key = browser.path.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** The registry lookup, exposed under a name that reads correctly from outside. */
function exeFromProgIdPath(progId: string): string | undefined {
  return exeFromProgId(progId)
}

/**
 * The browser to use for a sign-in window, preferring the one the user actually uses.
 *
 * MEASURED as a complaint: the new channels opened Chrome while the older ones opened Edge,
 * because the launcher took the first entry of `chromiumCandidates()` — which is a fixed list,
 * not the user's choice. A sign-in window that appears in a different browser from the one the
 * user browses in loses their passwords, their extensions and their session, so it looks like
 * being signed out everywhere at once.
 *
 * Order: the system default when it can be driven over CDP, then the known Chromium installs.
 */
export function preferredLoginBrowser(): DefaultBrowser | undefined {
  const systemDefault = defaultBrowser()
  if (systemDefault !== undefined) return systemDefault
  return chromiumCandidates()[0]
}

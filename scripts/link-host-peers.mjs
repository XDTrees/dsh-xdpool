/**
 * Link the host-provided peer dependencies into this package's node_modules.
 *
 * WHY THIS EXISTS
 *
 * Seven of this plugin's dependencies are `peerDependencies`: the host supplies them, not
 * npm. A manual copy of the package into `node_modules/dsh-xdpool` resolved them by walking
 * up into the host's tree, so nothing was ever missing. Installing normally breaks that
 * walk, and a top-level import failure prevents `apply()` from ever running — so EVERY web
 * route is unregistered and the card renders empty while blaming the gateway.
 *
 * WHAT IT MAY NOT DO: FAIL THE INSTALL
 *
 * The script links what it can find and then stops. It does not exit non-zero when the
 * host cannot be located, for a reason that two bug reports made concrete:
 *
 *   - A PACKAGED host keeps its dependencies inside `app.asar`, and `fs.existsSync` in a
 *     plain Node process cannot see inside an asar archive — only Electron's patched `fs`
 *     can. So "not found" from here often means "invisible to this process", not "absent".
 *   - The host resolves these peers itself at runtime. 2.6.3 shipped with no postinstall at
 *     all and loaded fine on macOS for exactly that reason.
 *
 * The previous version treated a failed probe as proof of a broken install and exited 1,
 * which made the plugin manager roll back a working upgrade. That is the worst outcome
 * available: the user loses the new version to protect against a problem they did not have.
 *
 * So the contract is now: link when the host is reachable, otherwise say what was not
 * found and finish successfully. Only an actual failure to CREATE a link is reported, and
 * even then as a warning — the plugin may still load through the host's own resolution.
 *
 * HOW RESOLUTION IS CHECKED
 *
 * With ESM, not CJS. `@earendil-works/pi-ai` is ESM-only: its `exports` map has `types` and
 * `import` but no `require` and no `./package.json` subpath. A `require.resolve()` of it
 * throws ERR_PACKAGE_PATH_NOT_EXPORTED even when the package is installed and importable,
 * which is precisely the false negative the reporter hit. `import.meta.resolve` asks the
 * question the plugin will actually ask.
 *
 * @module dsh-xdpool/scripts/link-host-peers
 */
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = resolve(HERE, '..')
const ENTRY_URL = pathToFileURL(join(PACKAGE_ROOT, 'lib', 'index.js')).href

/** The peer dependencies this plugin imports at runtime. */
function peerNames() {
  const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'))
  return Object.keys(manifest.peerDependencies ?? {})
}

/**
 * Can the plugin resolve `name` from its own entry point?
 *
 * `import.meta.resolve` answers with ESM conditions, which is what the plugin uses. It
 * never throws for a missing package in current Node — it returns a URL that may not
 * exist — so the answer is checked for existence as well.
 *
 * A `data:` or `node:` result is not a real package file and is treated as unresolved.
 */
function resolvesFromEntry(name) {
  try {
    const url = import.meta.resolve(name, ENTRY_URL)
    if (typeof url !== 'string' || url === '') return undefined
    if (url.startsWith('node:') || url.startsWith('data:')) return undefined
    return fileURLToPath(url)
  } catch {
    return undefined
  }
}

/** The installed version of a package directory, or undefined when unreadable. */
function versionOf(dir) {
  try {
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    return typeof manifest.version === 'string' ? manifest.version : undefined
  } catch {
    return undefined
  }
}

/**
 * The host's copy of a peer, if one can be found.
 *
 * Separate from `locate` because the two answer different questions: `locate` asks "is this
 * importable", `hostCopyOf` asks "where is the host's own copy". The second is needed to
 * detect a version MISMATCH, which is a failure mode `locate` cannot see — the package
 * resolves perfectly well at the wrong generation.
 */
function hostCopyOf(name) {
  for (const root of hostRoots()) {
    const candidate = join(root, name)
    if (existsSync(join(candidate, 'package.json'))) return candidate
  }
  return undefined
}

/**
 * The package directory for `name`, whether or not it can be imported right now.
 *
 * The physical check comes FIRST because it is the only one that works for an ESM-only
 * package whose `exports` map omits `./package.json`: `require.resolve(`${name}/package.json`)`
 * throws ERR_PACKAGE_PATH_NOT_EXPORTED for `pi-ai` even with the package sitting on disk.
 * That false negative used to send an already-linked peer back into the missing list, so a
 * second `postinstall` run re-linked what it had just built.
 */
function locate(name) {
  // 1. On disk under this package's own node_modules — a junction we made earlier counts.
  const physical = join(PACKAGE_ROOT, 'node_modules', name)
  if (existsSync(join(physical, 'package.json'))) return physical
  // 2. Whatever ESM resolves from the entry, which is the real question.
  const resolved = resolvesFromEntry(name)
  if (resolved !== undefined) {
    // Walk up to the package root: the first directory named like the package.
    const wanted = name.startsWith('@') ? name.split('/')[1] : name
    let dir = dirname(resolved)
    while (dir !== dirname(dir)) {
      if (dir.endsWith(`/${wanted}`) || dir.endsWith(`\\${wanted}`)) return dir
      dir = dirname(dir)
    }
    return dirname(resolved)
  }
  return undefined
}

/**
 * Candidate host module roots.
 *
 * The host SPLITS its tree — `cordis` and the `@deepseek-ai/*` runtime in one place,
 * `pi-ai` in another — so several roots are tried rather than one.
 *
 * `DSH_HOST_ROOT` is honoured when set, but note it is NOT injected by the host: two
 * reporters verified that the plugin manager does not pass it. It exists for an operator
 * who wants to point at a specific tree by hand.
 *
 * On a packaged install most of this is unverifiable from a plain Node process, because the
 * dependencies live inside `app.asar` and `existsSync` cannot see in. That is expected and
 * is why a miss is not an error.
 */
function hostRoots() {
  const roots = []
  const env = process.env['DSH_HOST_ROOT']
  if (typeof env === 'string' && env !== '') roots.push(env)
  // When the host loads the plugin from inside its own tree.
  roots.push(resolve(PACKAGE_ROOT, '..'))
  roots.push(resolve(PACKAGE_ROOT, '..', '..', '..'))
  /**
   * Derived from the running executable, which is the only signal that survives a
   * non-default install drive — the reporter's harness sat on `F:` while every hard-coded
   * guess pointed at `C:`. `process.execPath` is the Node or Electron binary doing the
   * install, which for the bundled runtime lives inside the harness directory.
   */
  for (const up of [1, 2, 3, 4, 5]) {
    const segments = [process.execPath]
    for (let i = 0; i < up; i += 1) segments.push('..')
    const base = resolve(...segments)
    for (const app of ['app', join('app', 'dsh')]) {
      roots.push(join(base, 'resources', app, 'node_modules'))
    }
    roots.push(join(base, 'node_modules'))
  }
  for (const base of HARNESS_BASES) {
    if (typeof base !== 'string' || base === '') continue
    for (const app of ['app', join('app', 'dsh')]) {
      roots.push(join(base, 'resources', app, 'node_modules'))
    }
  }
  return [...new Set(roots)]
}

/**
 * Where a DSH install commonly sits, per platform.
 *
 * Every entry is a guess and a miss is silent, which is what makes listing several
 * acceptable. `HARNESS_BASES` used to be Windows-only — the macOS reporter's whole
 * `LOCALAPPDATA`/`PROGRAMFILES` loop simply never ran.
 */
const HARNESS_BASES = [
  process.env['DSH_HARNESS_ROOT'],
  // macOS: /Applications/DeepSeek Harness.app/Contents/Resources
  '/Applications/DeepSeek Harness.app/Contents/Resources',
  join(process.env['HOME'] ?? '', 'Applications', 'DeepSeek Harness.app', 'Contents', 'Resources'),
  // Linux
  join(process.env['HOME'] ?? '', '.local', 'share', 'deepseek-harness'),
  '/opt/DeepSeek Harness',
  // Windows, default locations
  typeof process.env['LOCALAPPDATA'] === 'string' ? join(process.env['LOCALAPPDATA'], 'Programs', 'DeepSeek Harness') : undefined,
  typeof process.env['LOCALAPPDATA'] === 'string' ? join(process.env['LOCALAPPDATA'], 'DeepSeek Harness') : undefined,
  typeof process.env['ProgramW6432'] === 'string' ? process.env['ProgramW6432'] : undefined,
  typeof process.env['PROGRAMFILES'] === 'string' ? process.env['PROGRAMFILES'] : undefined,
  /**
   * Windows, installed on another drive.
   *
   * Not a guess about this particular machine: it is derived from where the PROFILE lives.
   * A DSH profile sits at `<harness data dir>/profiles/<name>`, and on Windows the data
   * directory is often the harness's own folder — which is exactly the layout this repo
   * was developed against (`D:\dsh-home\profiles\desktop` beside `D:\DeepSeek Harness`).
   * When they are siblings, the harness is one segment up with a different name, so the
   * sibling of the data dir is tried as a harness root too.
   *
   * A miss costs nothing, which is why deriving is preferable to hard-coding a drive letter.
   */
  ...siblingHarnessBases(),
]

/**
 * Harness roots that can be derived from where this profile lives.
 *
 * `D:\dsh-home\profiles\desktop\node_modules\dsh-xdpool` → walk up to the data directory,
 * then try every plausible sibling. Cheap, and it is the only way to find a harness on a
 * non-default drive without asking the user to set an environment variable.
 *
 * Several levels are tried because the two layouts in the wild differ:
 *
 *   - `<dataDir>/profiles/<name>` — the data dir's PARENT holds the harness
 *     (`D:\dsh-home` beside `D:\DeepSeek Harness`)
 *   - the harness IS the data dir's parent — some installs put profiles inside the app
 *
 * A miss costs nothing, which is why deriving beats hard-coding a drive letter.
 */
function siblingHarnessBases() {
  const out = []
  let dir = PACKAGE_ROOT
  let dataDir
  for (let i = 0; i < 8; i += 1) {
    dir = dirname(dir)
    if (dir === dirname(dir)) break
    // `<x>/profiles/...` means `<x>` is the data directory.
    if (dirname(dir).endsWith('profiles')) { dataDir = dirname(dir); break }
    if (dir.endsWith('profiles')) { dataDir = dirname(dir); break }
  }
  const start = dataDir ?? resolve(PACKAGE_ROOT, '..', '..', '..')
  // Walk up a few levels from the data directory, offering a sibling at each.
  let cursor = start
  for (let i = 0; i < 3; i += 1) {
    out.push(join(cursor, 'DeepSeek Harness'))
    const parent = dirname(cursor)
    if (parent === cursor) break
    out.push(join(parent, 'DeepSeek Harness'))
    cursor = parent
  }
  return out
}

/** Whether this is a source checkout rather than an installed package. */
const IS_SOURCE_CHECKOUT = existsSync(join(PACKAGE_ROOT, 'src'))

const linked = []
const alreadyResolved = []
const notFound = []
const failed = []

for (const name of peerNames()) {
  /**
   * A peer that resolves is only acceptable if its VERSION matches the host's.
   *
   * Resolvability alone is not the contract that matters. `@earendil-works/pi-ai` shipped
   * from a `devDependency` at 0.85.1 while the host ran 1.1.0, and the plugin's own
   * `warnOnPiAiGenerationMismatch` documents the result: two copies on one call chain throw
   * at the adapter seam and the host reports every turn as a non-retryable `PI_AI_ERROR`.
   * The package resolved fine — at the wrong generation.
   *
   * So when the host has a copy and ours differs, the host's copy WINS. That is the whole
   * point of treating these as peer dependencies: the host owns them, and a second
   * generation beside it is a defect rather than a choice.
   */
  const current = locate(name)
  const hostCopy = hostCopyOf(name)
  const hostVersion = hostCopy === undefined ? undefined : versionOf(hostCopy)
  const ours = current === undefined ? undefined : versionOf(current)
  if (current !== undefined && (hostVersion === undefined || ours === hostVersion)) {
    alreadyResolved.push(name)
    continue
  }
  // A mismatch is reported below through `relinked` when the host copy is linked.
  let target = hostCopy
  if (target === undefined) {
    for (const root of hostRoots()) {
      const candidate = join(root, name)
      // `existsSync` cannot see inside `app.asar`; on a packaged host this simply misses and
      // the peer is reported as not found, which is no longer fatal.
      if (existsSync(join(candidate, 'package.json'))) { target = candidate; break }
    }
  }
  if (target === undefined) { notFound.push(name); continue }
  const dest = join(PACKAGE_ROOT, 'node_modules', name)
  try {
    mkdirSync(dirname(dest), { recursive: true })
    // A previous run may have left a link (or a partial one); replacing it is correct
    // because the resolve check above already skipped anything that works.
    if (existsSync(dest)) rmSync(dest, { recursive: true, force: true })
    // Junction on Windows because creating a real symlink needs elevation there; a
    // junction needs none and behaves the same for directory reads.
    symlinkSync(target, dest, process.platform === 'win32' ? 'junction' : 'dir')
    linked.push(`${name} → ${target}${ours === undefined ? '' : ` (was ${ours}, host has ${hostVersion ?? '?'})`}`)
  } catch (error) {
    failed.push(`${name} (${error instanceof Error ? error.message : String(error)})`)
  }
}

if (linked.length > 0) {
  process.stdout.write(`dsh-xdpool: linked ${String(linked.length)} host dependency(ies)\n`)
  for (const line of linked) process.stdout.write(`  ${line}\n`)
}
if (alreadyResolved.length > 0 && linked.length === 0) {
  process.stdout.write(`dsh-xdpool: all ${String(alreadyResolved.length)} peer dependencies already resolve\n`)
}

/**
 * Report, and deliberately do not fail.
 *
 * A packaged host hides these inside `app.asar` (invisible to a bare Node process) and
 * resolves them itself at runtime — 2.6.3 shipped with no postinstall and loaded fine. So
 * "not found from here" is not evidence of a broken install, and exiting non-zero on it
 * rolled back working upgrades for macOS and Windows users alike.
 */
if (notFound.length > 0) {
  process.stdout.write(
    `dsh-xdpool: ${String(notFound.length)} peer dependency(ies) not visible from this process:\n`
    + notFound.map(name => `  ${name}\n`).join('')
    + (IS_SOURCE_CHECKOUT
      ? 'Expected in a source checkout: build and test resolve them from devDependencies.\n'
      : 'This is normal for a packaged host, which keeps them inside app.asar and resolves\n'
        + 'them itself at runtime. Set DSH_HOST_ROOT to a directory containing node_modules\n'
        + 'only if the plugin later fails to load.\n'),
  )
}
if (failed.length > 0) {
  // A link that could not be CREATED is a real problem, but still not fatal: the host may
  // resolve the peer without our help. Worth a warning, not a rollback.
  process.stdout.write(
    `dsh-xdpool: could not link ${String(failed.length)} dependency(ies):\n`
    + failed.map(name => `  ${name}\n`).join(''),
  )
}

/**
 * Final self-check, phrased as the plugin would phrase it.
 *
 * Uses ESM resolution rather than CJS: `pi-ai` is ESM-only with no `require` condition and
 * no `./package.json` subpath, so a `require.resolve` of it throws
 * ERR_PACKAGE_PATH_NOT_EXPORTED while the package sits there fully importable. That false
 * negative is what made 2.6.4 uninstallable on Windows.
 *
 * An unresolved peer is reported and the script still exits 0, for the asar reason above.
 */
const unresolved = peerNames().filter(name => locate(name) === undefined)
if (unresolved.length === 0) {
  process.stdout.write('dsh-xdpool: all peer dependencies resolve; the build should load\n')
} else {
  process.stdout.write(
    `dsh-xdpool: ${String(unresolved.length)} peer dependency(ies) do not resolve here: `
    + `${unresolved.join(', ')}\n`
    + '  Not treated as an install failure — see the note above.\n',
  )
}

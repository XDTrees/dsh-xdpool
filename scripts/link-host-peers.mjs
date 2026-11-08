/**
 * Link the host-provided peer dependencies into this package's node_modules.
 *
 * WHY THIS IS NEEDED
 *
 * Seven of this plugin's dependencies are `peerDependencies`: they are supplied by the
 * host, not by npm. A manual copy of the package into `node_modules/dsh-xdpool` resolved
 * them by walking up to the host's own tree, so nothing was ever missing. Installing
 * normally breaks that walk: the package ends up beside the host rather than inside it,
 * and `import` fails with
 *
 *   Cannot find package '@earendil-works/pi-ai'
 *
 * which — being a top-level import failure — prevents `apply()` from ever running, so
 * EVERY web route is unregistered and the card renders empty while blaming the gateway.
 *
 * WHAT IT DOES
 *
 * For each peer dependency, find a copy the host actually runs with and point
 * `node_modules/<name>` at it. Junctions on Windows, symlinks elsewhere. Skipped when a
 * copy already resolves — an operator who installed a peer deliberately keeps theirs.
 *
 * WHERE IT LOOKS
 *
 * `DSH_HOST_ROOT` when set (the harness passes it), then the paths a packaged DSH
 * install actually uses. Both `resources/app/node_modules` and
 * `resources/app/dsh/node_modules` are searched because the host splits its tree between
 * them: `pi-ai` lives in the latter, `cordis` in the former.
 *
 * FAILURE IS LOUD ON PURPOSE
 *
 * A silently skipped link is what produced the blank panel. If a peer cannot be found the
 * script says which one and exits non-zero, so the install fails visibly instead of
 * producing a package that cannot load.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = resolve(HERE, '..')
const REQUIRE = createRequire(import.meta.url)

/** The peer dependencies this plugin imports at runtime. */
function peerNames() {
  const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'))
  return Object.keys(manifest.peerDependencies ?? {})
}

/**
 * Candidate host module roots, most specific first.
 *
 * Derived from this file's own location as well, because when the host loads the plugin
 * from `app/dsh/node_modules`, two levels up IS the host root.
 */
function hostRoots() {
  const roots = []
  const env = process.env['DSH_HOST_ROOT']
  if (typeof env === 'string' && env !== '') roots.push(env)
  // `<host>/resources/app/dsh/node_modules/dsh-xdpool` → `<host>/resources/app/dsh/node_modules`
  roots.push(resolve(PACKAGE_ROOT, '..'))
  // A source checkout beside the harness: look for the resources tree directly.
  for (const base of [process.env['LOCALAPPDATA'], process.env['PROGRAMFILES']]) {
    if (typeof base !== 'string' || base === '') continue
    roots.push(join(base, 'DeepSeek Harness', 'resources', 'app', 'dsh', 'node_modules'))
    roots.push(join(base, 'DeepSeek Harness', 'resources', 'app', 'node_modules'))
  }
  return roots
}

/** Resolve a package's directory without importing it. */
function locate(name) {
  try {
    return dirname(REQUIRE.resolve(`${name}/package.json`))
  } catch {
    // Some packages do not export package.json; fall back to the resolver's own answer.
    try {
      const entry = REQUIRE.resolve(name)
      // Walk up to the package root — the first directory whose name is the package's.
      let dir = dirname(entry)
      const wanted = name.startsWith('@') ? name.split('/')[1] : name
      while (dir !== dirname(dir)) {
        if (dir.endsWith(`/${wanted}`) || dir.endsWith(`\\${wanted}`)) return dir
        dir = dirname(dir)
      }
    } catch {
      return undefined
    }
    return undefined
  }
}

/**
 * When to ENFORCE.
 *
 * This runs on `postinstall` of the published package, where a missing peer really does
 * mean a plugin that cannot load — and it must fail loudly there. But the same script also
 * runs when someone installs the repository for development or CI, where the host does not
 * exist and the peers are resolved from `devDependencies` instead. Failing there would
 * break every fresh clone and every pipeline for a condition that is not a problem.
 *
 * The two cases are told apart by whether this is a source checkout: `src/` ships in the
 * repository and not in the tarball (`files` lists `lib`, `vendor`, `scripts`…).
 */
const IS_SOURCE_CHECKOUT = existsSync(join(PACKAGE_ROOT, 'src'))
const ENFORCE = !IS_SOURCE_CHECKOUT

const linked = []
const missing = []
for (const name of peerNames()) {
  // Already resolvable: leave it alone. Someone who installed a peer on purpose keeps
  // control, and re-linking would overwrite that choice.
  if (locate(name) !== undefined) continue
  let target
  for (const root of hostRoots()) {
    const candidate = join(root, name)
    if (existsSync(candidate)) { target = candidate; break }
  }
  if (target === undefined) { missing.push(name); continue }
  const dest = join(PACKAGE_ROOT, 'node_modules', name)
  try {
    mkdirSync(dirname(dest), { recursive: true })
    // A previous run may have left a link (or a partial one); replacing it is correct
    // because the resolve check above already skipped anything that works.
    if (existsSync(dest)) rmSync(dest, { recursive: true, force: true })
    // Junction on Windows because creating a real symlink needs elevation there; a
    // junction needs none and behaves the same for directory reads.
    symlinkSync(target, dest, process.platform === 'win32' ? 'junction' : 'dir')
    linked.push(`${name} → ${target}`)
  } catch (error) {
    missing.push(`${name} (${error instanceof Error ? error.message : String(error)})`)
  }
}

if (linked.length > 0) {
  process.stdout.write(`dsh-xdpool: linked ${String(linked.length)} host dependency(ies)\n`)
  for (const line of linked) process.stdout.write(`  ${line}\n`)
}
if (missing.length > 0) {
  const where = IS_SOURCE_CHECKOUT
    ? 'a source checkout, so the host is not expected to be present'
    : 'an installed package, where a missing peer prevents the plugin from loading'
  process.stderr.write(
    `dsh-xdpool: could not satisfy ${String(missing.length)} peer dependency(ies) `
    + `(${where}):\n`
    + missing.map(name => `  ${name}\n`).join(''),
  )
  if (ENFORCE) {
    process.stderr.write(
      'The plugin will fail to load without them. Install them into this profile, or set\n'
      + 'DSH_HOST_ROOT to the directory containing node_modules.\n',
    )
    // Hard failure on purpose: a silently skipped link is what produced a package that
    // installed cleanly and then could not load at all.
    process.exit(1)
  }
  // A source checkout keeps going: `devDependencies` provide these for build and test,
  // and CI has no harness to link against. Failing here would break the pipeline for a
  // condition that is not a defect.
  process.stdout.write('dsh-xdpool: continuing — this looks like a development checkout\n')
} else {
  /**
   * Self-check: confirm every peer RESOLVES from the package root.
   *
   * Not a full `import` of the entry: that would also pull the host's own runtime (cordis,
   * the llm plumbing) and can only succeed inside a live harness, so it would fail in a
   * source checkout and in CI for a reason unrelated to this script's job.
   *
   * Resolution is the exact property that broke: a top-level import failure aborts
   * `apply()`, and every web route then goes unregistered while the card blames the
   * gateway. Checking `require.resolve` from inside the package reproduces that failure
   * without needing the host running.
   */
  const unresolved = []
  const localRequire = createRequire(join(PACKAGE_ROOT, 'lib', 'index.js'))
  for (const name of peerNames()) {
    try {
      localRequire.resolve(name)
    } catch {
      unresolved.push(name)
    }
  }
  if (unresolved.length > 0) {
    process.stderr.write(
      `dsh-xdpool: ${String(unresolved.length)} peer dependency(ies) still do not resolve:\n`
      + unresolved.map(name => `  ${name}\n`).join(''),
    )
    // Same split as above: fatal for an installed package, informational in a checkout.
    if (ENFORCE) process.exit(1)
    process.stdout.write('dsh-xdpool: continuing — this looks like a development checkout\n')
  } else {
    process.stdout.write('dsh-xdpool: all peer dependencies resolve; the build should load\n')
  }
}

// Keep the unused helper referenced so a tree-shaker cannot hide it if this file is ever
// bundled; it is intentionally exported for a maintenance script.
export { readdirSync }

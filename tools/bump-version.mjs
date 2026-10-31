/**
 * Bump the three places the version lives, in one pass.
 *
 * There are three and they must agree: `package.json` (what npm publishes),
 * `src/version.ts` (what the browser card draws — it cannot read package.json,
 * so it is hand-maintained) and `.release-please-manifest.json` (what
 * release-please diffs against). `tests/card-shell.test.ts` fails if the first
 * two drift, but nothing checks the manifest at build time, and a stale manifest
 * makes release-please propose the wrong next version.
 *
 * Written as a file rather than a `node -e` one-liner because the anchors
 * contain quotes that Windows shells mangle — the same class of failure that
 * turns a "successful" edit into a silently unchanged file.
 *
 * Run: node tools/bump-version.mjs 2.5.1
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const next = process.argv[2]
if (next === undefined || !/^\d+\.\d+\.\d+$/u.test(next)) {
  throw new Error(`usage: node tools/bump-version.mjs <major.minor.patch> (got ${String(process.argv[2])})`)
}

function edit(relative, pattern, replacement, label) {
  const path = join(ROOT, relative)
  const raw = readFileSync(path, 'utf8')
  const eol = raw.includes('\r\n') ? '\r\n' : '\n'
  const text = raw.replaceAll('\r\n', '\n')
  if (!pattern.test(text)) throw new Error(`${label}: anchor not found in ${relative}`)
  const updated = text.replace(pattern, replacement)
  if (updated === text) throw new Error(`${label}: replacement changed nothing in ${relative}`)
  writeFileSync(path, eol === '\r\n' ? updated.replaceAll('\n', '\r\n') : updated)
  console.log(`  ${relative}: ${label}`)
}

// package.json — rewritten through JSON.parse so the file stays valid whatever
// the previous formatting was. Two-space indent is what the repo ships.
{
  const path = join(ROOT, 'package.json')
  const manifest = JSON.parse(readFileSync(path, 'utf8'))
  const previous = manifest.version
  manifest.version = next
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`  package.json: ${String(previous)} -> ${next}`)
}

edit('src/version.ts', /export const POOL_VERSION = '[^']+'/, `export const POOL_VERSION = '${next}'`, 'POOL_VERSION')

{
  const path = join(ROOT, '.release-please-manifest.json')
  const manifest = JSON.parse(readFileSync(path, 'utf8'))
  const previous = manifest['.']
  manifest['.'] = next
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`  .release-please-manifest.json: ${String(previous)} -> ${next}`)
}

// Read them back rather than trusting the writes above: a bump that reports
// success while leaving one file on the old number is the failure this script
// exists to make impossible.
const pkgVersion = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version
const tsVersion = readFileSync(join(ROOT, 'src/version.ts'), 'utf8').match(/POOL_VERSION = '([^']+)'/u)?.[1]
const manifestVersion = JSON.parse(readFileSync(join(ROOT, '.release-please-manifest.json'), 'utf8'))['.']
if (pkgVersion !== next || tsVersion !== next || manifestVersion !== next) {
  throw new Error(`version mismatch: package.json=${String(pkgVersion)} version.ts=${String(tsVersion)} manifest=${String(manifestVersion)}`)
}
console.log(`verified all three read back as ${next}`)

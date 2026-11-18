/**
 * Point `DSH_HOME` at a throwaway directory for the whole test run.
 *
 * WHY A GLOBAL SETUP FILE RATHER THAN PER-TEST HYGIENE
 *
 * The plugin's state paths all resolve through `dshHome()`, and its fallback is the user's real
 * `~/.dsh`. One test that called a store helper without injecting a path was enough to overwrite
 * a live Doubao session with a fixture while this feature was being built.
 *
 * A per-test convention cannot prevent that — the failure is a test that simply forgot. This file
 * makes the mistake impossible by construction: no test in this repository can name the real
 * home, because `DSH_HOME` no longer points at it.
 *
 * It runs once per worker BEFORE any test module is imported, so a module-level `dshHome()` call
 * sees the temp directory too.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll } from 'vitest'

const sandbox = mkdtempSync(join(tmpdir(), 'dsh-xdpool-test-home-'))
process.env['DSH_HOME'] = sandbox

afterAll(() => {
  try {
    rmSync(sandbox, { recursive: true, force: true })
  } catch {
    // A leftover temp directory is not a test failure.
  }
})

/**
 * Adopting state written under the plugin's pre-rename directory.
 *
 * The stakes here are asymmetric and that is the whole reason this file exists.
 * A migration that runs when it should not costs a few kilobytes of copied
 * files. A migration that fails to run when it should costs the user their
 * third-party API keys, which nothing upstream can hand back. So the tests are
 * weighted accordingly: the "must adopt" cases assert exact file contents, and
 * the "must not touch" cases assert that the new directory is left byte-for-byte
 * alone.
 *
 * `adoptLegacyDataDir` is exercised against throwaway homes in `tmpdir()`, the
 * same discipline `provider-registration.test.ts` established — the real
 * `<data>\.xdpool` must never be read or written by a test run.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  adoptLegacyDataDir,
  CURRENT_DATA_DIR_NAME,
  describeProviderIdRename,
  LEGACY_DATA_DIR_NAME,
  PROVIDER_ID_RENAMES,
} from '../src/migrate.ts'
/** Homes created during this file's run, removed afterwards. */
const created: string[] = []
/** A throwaway DSH home, plus the env that points the migration at it. */
function throwawayHome(): { home: string; env: NodeJS.ProcessEnv } {
  const home = mkdtempSync(join(tmpdir(), 'xdpool-migrate-'))
  created.push(home)
  return { home, env: { DSH_HOME: home } as NodeJS.ProcessEnv }
}
/** Write one file, creating its parent. */
function put(path: string, text: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, text, 'utf8')
}
afterEach(() => {
  while (created.length > 0) {
    const home = created.pop()
    if (home !== undefined) rmSync(home, { recursive: true, force: true })
  }
})
describe('the names this migration is built on', () => {
  it('adopts the pre-rename directory into the current one', () => {
    expect(LEGACY_DATA_DIR_NAME).toBe('.workbuddy-xdpool')
    expect(CURRENT_DATA_DIR_NAME).toBe('.xdpool')
    expect(LEGACY_DATA_DIR_NAME).not.toBe(CURRENT_DATA_DIR_NAME)
  })
  it('maps every pre-rename provider id to its replacement', () => {
    expect(PROVIDER_ID_RENAMES).toEqual({
      'workbuddy-xdpool': 'xdpool',
      'workbuddy-xdpool-global': 'xdpool-global',
      'workbuddy-xdpool-aggregate': 'xdpool-aggregate',
      'workbuddy-xdpool-free': 'xdpool-free',
    })
  })
})
describe('adopting the pre-rename directory', () => {
  it('copies the user\'s keys, ignore list and pin into the current directory', () => {
    const { home, env } = throwawayHome()
    const legacy = join(home, LEGACY_DATA_DIR_NAME)
    const keys = JSON.stringify({ version: 1, providers: { moonshot: { apiKey: 'sk-secret' } } })
    put(join(legacy, 'aggregate.json'), keys)
    put(join(legacy, 'ignored.json'), JSON.stringify({ version: 1, accounts: [{ id: 'a1', label: 'A' }] }))
    put(join(legacy, 'preferred.json'), JSON.stringify({ accountId: 'a1' }))
    const result = adoptLegacyDataDir(env)
    expect(result.adopted).toBe(true)
    expect(result.files).toEqual(['aggregate.json', 'ignored.json', 'preferred.json'])
    expect(result.skipped).toBeUndefined()
    // The credential is what actually matters, so assert the bytes.
    expect(readFileSync(join(home, CURRENT_DATA_DIR_NAME, 'aggregate.json'), 'utf8')).toBe(keys)
    expect(readFileSync(join(home, CURRENT_DATA_DIR_NAME, 'preferred.json'), 'utf8'))
      .toBe(JSON.stringify({ accountId: 'a1' }))
  })
  it('leaves the pre-rename directory intact, so a downgrade still works', () => {
    const { home, env } = throwawayHome()
    const legacy = join(home, LEGACY_DATA_DIR_NAME)
    put(join(legacy, 'aggregate.json'), '{"version":1}')
    adoptLegacyDataDir(env)
    // Copied, never moved: the original file is still there with its bytes.
    expect(existsSync(join(legacy, 'aggregate.json'))).toBe(true)
    expect(readFileSync(join(legacy, 'aggregate.json'), 'utf8')).toBe('{"version":1}')
  })
  it('is idempotent: a second run copies nothing', () => {
    const { home, env } = throwawayHome()
    put(join(home, LEGACY_DATA_DIR_NAME, 'aggregate.json'), '{"version":1}')
    expect(adoptLegacyDataDir(env).adopted).toBe(true)
    const second = adoptLegacyDataDir(env)
    expect(second.adopted).toBe(false)
    expect(second.skipped).toBe('already-migrated')
    expect(second.files).toEqual([])
  })
  it('never overwrites state the current directory already holds', () => {
    const { home, env } = throwawayHome()
    put(join(home, LEGACY_DATA_DIR_NAME, 'aggregate.json'), '{"version":1,"providers":{"old":{}}}')
    put(join(home, CURRENT_DATA_DIR_NAME, 'aggregate.json'), '{"version":1,"providers":{"new":{}}}')
    const result = adoptLegacyDataDir(env)
    // The new file is authoritative; the legacy copy must not resurrect old keys.
    expect(readFileSync(join(home, CURRENT_DATA_DIR_NAME, 'aggregate.json'), 'utf8'))
      .toBe('{"version":1,"providers":{"new":{}}}')
    expect(result.adopted).toBe(false)
    expect(result.skipped).toBe('already-migrated')
  })
  it('fills in only the files the current directory is missing', () => {
    const { home, env } = throwawayHome()
    put(join(home, LEGACY_DATA_DIR_NAME, 'aggregate.json'), '{"legacy":true}')
    put(join(home, LEGACY_DATA_DIR_NAME, 'ignored.json'), '{"accounts":[]}')
    put(join(home, CURRENT_DATA_DIR_NAME, 'aggregate.json'), '{"current":true}')
    const result = adoptLegacyDataDir(env)
    expect(result.files).toEqual(['ignored.json'])
    expect(readFileSync(join(home, CURRENT_DATA_DIR_NAME, 'aggregate.json'), 'utf8')).toBe('{"current":true}')
    expect(readFileSync(join(home, CURRENT_DATA_DIR_NAME, 'ignored.json'), 'utf8')).toBe('{"accounts":[]}')
  })
  it('is a no-op on a machine that never ran the old name', () => {
    const { env } = throwawayHome()
    const result = adoptLegacyDataDir(env)
    expect(result.adopted).toBe(false)
    expect(result.skipped).toBe('no-legacy-dir')
    expect(result.files).toEqual([])
  })
  it('treats an empty pre-rename directory as nothing to adopt', () => {
    const { home, env } = throwawayHome()
    mkdirSync(join(home, LEGACY_DATA_DIR_NAME), { recursive: true })
    const result = adoptLegacyDataDir(env)
    expect(result.adopted).toBe(false)
    expect(result.skipped).toBe('legacy-empty')
  })
  it('ignores subdirectories, which are not plugin state', () => {
    const { home, env } = throwawayHome()
    const legacy = join(home, LEGACY_DATA_DIR_NAME)
    put(join(legacy, 'aggregate.json'), '{"version":1}')
    mkdirSync(join(legacy, 'nested'), { recursive: true })
    const result = adoptLegacyDataDir(env)
    expect(result.files).toEqual(['aggregate.json'])
    expect(existsSync(join(home, CURRENT_DATA_DIR_NAME, 'nested'))).toBe(false)
  })
  it('reports failure instead of throwing when the copy cannot happen', () => {
    const { home, env } = throwawayHome()
    put(join(home, LEGACY_DATA_DIR_NAME, 'aggregate.json'), '{"version":1}')
    // A regular file where the destination directory must go: mkdir/copy fails.
    put(join(home, CURRENT_DATA_DIR_NAME), 'not a directory')
    let result: ReturnType<typeof adoptLegacyDataDir> | undefined
    expect(() => { result = adoptLegacyDataDir(env) }).not.toThrow()
    expect(result?.adopted).toBe(false)
    expect(result?.skipped).toBe('failed')
  })
  it('resolves home the same way the rest of the plugin does', () => {
    const { home, env } = throwawayHome()
    put(join(home, LEGACY_DATA_DIR_NAME, 'aggregate.json'), '{}')
    const result = adoptLegacyDataDir(env)
    expect(result.to).toBe(join(home, CURRENT_DATA_DIR_NAME))
    expect(result.from).toBe(join(home, LEGACY_DATA_DIR_NAME))
  })
})
describe('the note about ids the plugin cannot rename for you', () => {
  it('names every old id, its replacement, and the file to edit', () => {
    const note = describeProviderIdRename()
    expect(note).toContain('workbuddy-xdpool -> xdpool')
    expect(note).toContain('workbuddy-xdpool-global -> xdpool-global')
    // The two files a user actually has to touch.
    expect(note).toContain('agent-default-model.provider')
    expect(note).toContain('cordis.patch.yml')
  })
})

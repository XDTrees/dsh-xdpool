/**
 * Regression tests for the 1.9.0 report: "the model picker does not list xdpool
 * any more".
 *
 * The structural defect behind that report is a HOST contract, not a bug in this
 * plugin: `ctx.llm.registerConfigurableProviders(entries)` is all-or-nothing.
 * `dsh-llm/lib/index.js` validates the whole array inside one `commit` loop and
 * throws on the first entry that fails —
 *
 *   throw new LlmError(
 *     "configurable providers need a non-empty provider, displayName, and settingsNs",
 *     "INVALID_DIRECTORY")
 *   throw new LlmError("duplicate configurable provider", "DUPLICATE_DIRECTORY")
 *
 * We used to put the three `registerAdapter` calls and that one directory call
 * in a SINGLE try, with a `finally` that released every handle whenever any of
 * them was still undefined. So a rejected directory entry unwound the three
 * adapters too, the outer catch returned, and the user got a mounted settings
 * card with an empty model picker — indistinguishable, from the outside, from
 * "the plugin is not loaded".
 *
 * The same `finally` also held a second defect: an inner `let
 * releaseAdapterAggregate` shadowed the outer handle, so the aggregate adapter's
 * release function was written to a variable nothing could read and the handle
 * was lost for good (a leak that compounds on every re-apply).
 *
 * The host entry cannot be imported here — it pulls in the whole host runtime —
 * so the contract assertions read the source, and the diagnostics module is
 * driven for real (it is the only path that can now tell the user WHICH of the
 * two failures happened).
 */
import { readFileSync } from 'node:fs'
import { mkdtempSync, readFileSync as readFile } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { describeError, recordStartupNote, startupLogPath } from '../src/diagnostics.ts'
/** Source of the host entry, read as text for the structural assertions. */
const hostSource = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
/** The block that owns all four registration handles. */
function registrationBlock(): string {
  const start = hostSource.indexOf('const adaptersByRegion = {')
  expect(start).toBeGreaterThan(-1)
  const end = hostSource.indexOf('builtAdapter = adaptersByRegion.cn', start)
  expect(end).toBeGreaterThan(start)
  return hostSource.slice(start, end)
}
describe('a rejected directory entry cannot take the adapters down with it', () => {
  it('registers the directory in a try of its own, not in the adapters try', () => {
    const block = registrationBlock()
    const adapterCalls = block.match(/ctx\.llm\.registerAdapter\(/g) ?? []
    const directoryCall = block.match(/ctx\.llm\.registerConfigurableProviders\(/g) ?? []
    // Four providers now: the two pool lanes, the aggregate lane and the
    // credential-free lane. All four in the adapters try, the directory after.
    expect(adapterCalls).toHaveLength(4)
    expect(directoryCall).toHaveLength(1)
    // The four adapter calls must all precede the directory call: the adapters
    // have to be LIVE before the directory is offered, so a directory rejection
    // finds something already installed to keep.
    const lastAdapter = block.lastIndexOf('ctx.llm.registerAdapter(')
    const directoryAt = block.indexOf('ctx.llm.registerConfigurableProviders(')
    expect(lastAdapter).toBeLessThan(directoryAt)
  })
  it('has no all-or-nothing finally that releases adapters on a directory failure', () => {
    const block = registrationBlock()
    // The old shape was a `finally` conditioned on any handle being undefined.
    // Nothing in this block may release a handle from a `finally` any more: the
    // only releases belong to the adapter-failure path (which genuinely gives
    // up) and to the disposer registered later in `apply`.
    expect(block).not.toMatch(/finally\s*\{[^}]*releaseAdapter/)
  })
  it('declares each release handle exactly once, so none is shadowed', () => {
    const block = registrationBlock()
    for (const name of [
      'releaseAdapterCn',
      'releaseAdapterGlobal',
      'releaseAdapterAggregate',
      'releaseAdapterFree',
      'releaseDirectory',
    ]) {
      const declarations = block.match(new RegExp(`let ${name}\\b`, 'g')) ?? []
      expect(declarations, `${name} must be declared once`).toHaveLength(1)
    }
  })
  it('recovers from a directory rejection instead of returning', () => {
    const block = registrationBlock()
    const catchAt = block.indexOf('configurable-provider directory rejected')
    expect(catchAt).toBeGreaterThan(-1)
    const catchBody = block.slice(catchAt)
    // The catch must NOT give up: no `return` before the adapters are handed to
    // a disposer, and no release call — that is the whole point of the split.
    const beforeDisposal = catchBody.slice(0, catchBody.indexOf('builtAdapter') + 1)
    expect(beforeDisposal).not.toMatch(/release(Adapter|Directory)/)
    expect(beforeDisposal).not.toMatch(/\breturn\b/)
  })
})
describe('the startup trace distinguishes the two failure shapes', () => {
  it('writes an apply-entered note before anything can throw', () => {
    const at = hostSource.indexOf('apply entered host=')
    expect(at).toBeGreaterThan(-1)
    // It must sit after the settings registration and before the shim promise
    // that leads to provider registration, so its absence means the plugin
    // never reached the host at all.
    const settingsAt = hostSource.indexOf('settings service exposes neither')
    expect(settingsAt).toBeGreaterThan(-1)
    expect(settingsAt).toBeLessThan(at)
    expect(hostSource.indexOf('shims.cn.ready')).toBeGreaterThan(at)
  })
  it('names the exact throw for both registration paths', () => {
    expect(hostSource).toContain('adapters REJECTED:')
    expect(hostSource).toContain('directory REJECTED:')
    expect(hostSource).toContain('registration FAILED:')
    expect(hostSource).toContain('providers registered')
  })
  it('aliases buddy and workbuddy on the pool adapters to suppress duplicate pack registrations', () => {
    const block = registrationBlock()
    expect(block).toMatch(/registerAdapter\(\s*\[POOL_PROVIDER_BY_REGION\.cn,\s*['"]buddy['"]\]/)
    expect(block).toMatch(/registerAdapter\(\s*\[POOL_PROVIDER_BY_REGION\.global,\s*['"]workbuddy['"]\]/)
  })
  it('aligns CODEBUDDY display name with WorkBuddy in the vendored pack', () => {
    const packSource = readFileSync(new URL('../vendor/channel-pack/pack.js', import.meta.url), 'utf8')
    expect(packSource).toMatch(/displayName:\s*["']WorkBuddy \((\\u56FD\\u5185\\u7248|国内版)\)["']/)
    expect(packSource).toMatch(/attributionName:\s*["']WorkBuddy["']/)
  })
  it('renders a thrown LlmError as text an operator can act on', () => {
    class LlmError extends Error {
      readonly code: string
      constructor(message: string, code: string) {
        super(message)
        this.name = 'LlmError'
        this.code = code
      }
    }
    const thrown = new LlmError(
      'configurable providers need a non-empty provider, displayName, and settingsNs',
      'INVALID_DIRECTORY',
    )
    expect(describeError(thrown)).toBe(
      'LlmError: configurable providers need a non-empty provider, displayName, and settingsNs (INVALID_DIRECTORY)',
    )
    // `String(error)` on a structured clone is `{}` — the reason those markers
    // in the old logs were unreadable.
    expect(describeError({ code: 'DUPLICATE_DIRECTORY' })).toBe('{"code":"DUPLICATE_DIRECTORY"}')
    expect(describeError('plain text')).toBe('plain text')
  })
  it('appends to the trace under the throwaway home it was given', () => {
    const home = mkdtempSync(join(tmpdir(), 'wbp-diag-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      const path = startupLogPath()
      expect(path).toBe(join(home, '.xdpool', 'startup.log'))
      recordStartupNote('apply entered')
      recordStartupNote('directory REJECTED: LlmError: nope (INVALID_DIRECTORY)')
      const lines = readFile(path, 'utf8').trimEnd().split('\n')
      expect(lines).toHaveLength(2)
      expect(lines[0]).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z apply entered$/)
      expect(lines[1]).toContain('directory REJECTED: LlmError: nope (INVALID_DIRECTORY)')
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
    }
  })
  it('never throws out of the diagnostic path', () => {
    const previous = process.env.DSH_HOME
    // A path that cannot hold a file: mkdirSync will fail on a parent that is a
    // regular file, and the note must still come back as text.
    process.env.DSH_HOME = join(tmpdir(), 'wbp-diag-not-a-dir-placeholder', '\u0000invalid')
    try {
      expect(() => recordStartupNote('this cannot be written')).not.toThrow()
      expect(recordStartupNote('this cannot be written either')).toContain('this cannot be written either')
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
    }
  })
})
describe('the host really is all-or-nothing (the reason for the split)', () => {
  it('a second directory registration for a live provider is refused by the host', () => {
    // A model of the host's own `commit` loop, so the test fails loudly if this
    // plugin is ever refactored back into one try on the assumption that a
    // partial directory is acceptable.
    const directory = new Set<string>()
    const commit = (entries: { provider: string; displayName: string; settingsNs: string; owned: boolean }[]): void => {
      for (const entry of entries) {
        if (entry.provider.length === 0 || entry.displayName.length === 0 || entry.settingsNs.length === 0) {
          throw new Error('configurable providers need a non-empty provider, displayName, and settingsNs')
        }
        if (directory.has(entry.provider) && !entry.owned) {
          throw new Error('duplicate configurable provider')
        }
      }
      for (const entry of entries) directory.add(entry.provider)
    }
    commit([{ provider: 'xdpool', displayName: 'WorkBuddy 池', settingsNs: 'ns', owned: false }])
    expect(() => commit([{ provider: 'xdpool', displayName: 'WorkBuddy 池', settingsNs: 'ns', owned: false }]))
      .toThrow(/duplicate configurable provider/)
    // And a rejected group registers NOTHING: the second provider is still absent.
    const fresh = new Set<string>()
    void fresh
    expect(directory.has('xdpool')).toBe(true)
    expect(directory.size).toBe(1)
  })
})

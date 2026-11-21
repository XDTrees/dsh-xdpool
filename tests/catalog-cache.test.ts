import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * A cached catalogue must belong to ONE account.
 *
 * Every adapter caches its model list for ten minutes. Without a record of which credential
 * built that list, signing into a second account kept the first one's models: the card showed
 * models the new account cannot use, and none of the ones it can. The user reads that as "this
 * channel is broken".
 *
 * These cases read the adapter sources because the condition is what matters — a fresh read must
 * happen when the credential changes — and a timing test would be flaky.
 */
const adapters = {
  astudio: readFileSync(new URL('../src/astudio-host-adapter.ts', import.meta.url), 'utf8'),
  accio: readFileSync(new URL('../src/accio-host-adapter.ts', import.meta.url), 'utf8'),
  baizhi: readFileSync(new URL('../src/baizhi-host-adapter.ts', import.meta.url), 'utf8'),
  autoclaw: readFileSync(new URL('../src/autoclaw-host-adapter.ts', import.meta.url), 'utf8'),
}

describe('the cached catalogue remembers its account', () => {
  for (const [name, source] of Object.entries(adapters)) {
    it(`${name} invalidates the cache when the credential changes`, () => {
      /**
       * Either the adapter caches nothing (so this cannot happen) or it records the key.
       */
      const caches = source.includes('modelsAt')
      if (!caches) return
      expect(source, `${name} caches but does not record which account`).toContain('modelsFor')
      expect(source, `${name} must compare the account before trusting the cache`)
        .toMatch(/const changed = this\.modelsFor !== /u)
    })
  }
})

describe('every channel gates on a credential', () => {
  const cases: readonly { name: string; file: string }[] = [
    { name: 'astudio', file: 'astudio-host-adapter.ts' },
    { name: 'accio', file: 'accio-host-adapter.ts' },
    { name: 'monkeycode', file: 'monkeycode-host-adapter.ts' },
    { name: 'baizhi', file: 'baizhi-host-adapter.ts' },
    { name: 'autoclaw', file: 'autoclaw-host-adapter.ts' },
  ]

  for (const testCase of cases) {
    it(`${testCase.name} answers an empty list without a credential`, () => {
      /**
       * #169: a channel that lists its static table regardless of the credential leaves a
       * picker group offering models nothing can answer. The group must disappear when the
       * account is removed.
       */
      const source = readFileSync(new URL(`../src/${testCase.file}`, import.meta.url), 'utf8')
      const listModels = source.slice(source.indexOf('override async listModels'))
      expect(listModels.slice(0, 600), testCase.name).toContain('return []')
    })
  }
})

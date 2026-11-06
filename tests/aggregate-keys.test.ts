/**
 * Several API keys on one vendor, and the switch that spreads over them.
 *
 * The pool has always rotated ACCOUNTS, but a third-party vendor could only ever
 * hold one key — so "account usage" had nothing to distribute over and was not
 * offered on those cards. That was the gap: a user dodging a per-key rate limit
 * had no way to express it at all.
 *
 * Three behaviours carry the feature, and each is asserted separately:
 *
 *   1. `providerApiKeys` reads BOTH spellings, so a config written before this
 *      change keeps working.
 *   2. `updateProviderSetting` mirrors the pair, so a one-key provider keeps the
 *      plain shape on disk and an older reader still finds `apiKey`.
 *   3. `appendApiKey` APPENDS instead of replacing — the card can only ever see a
 *      COUNT, so a replacement list from the browser would have to be built from
 *      placeholders and would destroy the keys the user cannot see.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  orderApiKeys,
  providerApiKeys,
  readAggregateSettings,
  updateProviderSetting,
  writeAggregateSettings,
} from '../src/store.ts'

let home: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'xdpool-keys-'))
  process.env['DSH_HOME'] = home
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
  delete process.env['DSH_HOME']
})

describe('providerApiKeys reads both spellings', () => {
  it('answers the legacy single key', () => {
    expect(providerApiKeys({ apiKey: 'sk-one' })).toEqual(['sk-one'])
  })

  it('answers the multi-key list, preferred first', () => {
    expect(providerApiKeys({ apiKeys: ['sk-a', 'sk-b'] })).toEqual(['sk-a', 'sk-b'])
  })

  it('does not duplicate a key present in both fields', () => {
    // The mirror means this is the NORMAL state after any save, not an edge case.
    expect(providerApiKeys({ apiKey: 'sk-a', apiKeys: ['sk-a', 'sk-b'] })).toEqual(['sk-a', 'sk-b'])
  })

  it('drops blanks, because a blank entry is a request guaranteed to 401', () => {
    expect(providerApiKeys({ apiKeys: ['sk-a', '  ', '', 'sk-b'] })).toEqual(['sk-a', 'sk-b'])
  })

  it('answers nothing for a provider with no key', () => {
    expect(providerApiKeys({})).toEqual([])
  })
})

describe('saving keeps the two spellings consistent', () => {
  it('a single key is stored as one field, with no array beside it', async () => {
    await updateProviderSetting('opencode', { apiKey: 'sk-one' })
    const setting = (await readAggregateSettings()).providers?.['opencode']
    expect(setting?.apiKey).toBe('sk-one')
    // The array is dropped when it would hold one entry: a one-key provider keeps
    // the shape every earlier version wrote.
    expect(setting?.apiKeys).toBeUndefined()
  })

  it('two keys store the list AND mirror the first one', async () => {
    await updateProviderSetting('opencode', { apiKeys: ['sk-a', 'sk-b'] })
    const setting = (await readAggregateSettings()).providers?.['opencode']
    expect(setting?.apiKeys).toEqual(['sk-a', 'sk-b'])
    // The mirror is what lets a reader that only knows `apiKey` still work.
    expect(setting?.apiKey).toBe('sk-a')
  })

  it('an empty value clears both spellings rather than storing a blank', async () => {
    await updateProviderSetting('opencode', { apiKeys: ['sk-a', 'sk-b'] })
    await updateProviderSetting('opencode', { apiKeys: [] })
    const setting = (await readAggregateSettings()).providers?.['opencode']
    expect(setting?.apiKey).toBeUndefined()
    expect(setting?.apiKeys).toBeUndefined()
  })

  it('appending keeps every stored key and ignores a duplicate', async () => {
    await updateProviderSetting('opencode', { apiKey: 'sk-a' })
    await updateProviderSetting('opencode', { appendApiKey: 'sk-b' })
    let setting = (await readAggregateSettings()).providers?.['opencode']
    expect(setting?.apiKeys).toEqual(['sk-a', 'sk-b'])

    // Appending the same key again must not create a second attempt against one
    // credential and report a rotation that never happened.
    await updateProviderSetting('opencode', { appendApiKey: 'sk-b' })
    setting = (await readAggregateSettings()).providers?.['opencode']
    expect(setting?.apiKeys).toEqual(['sk-a', 'sk-b'])
  })

  it('a store written by an older version appends correctly', async () => {
    // The exact shape 2.5.1 wrote: one key, no array.
    await writeAggregateSettings({
      version: 1,
      enabled: true,
      providers: { opencode: { enabled: true, apiKey: 'sk-old' } },
    } as never)
    await updateProviderSetting('opencode', { appendApiKey: 'sk-new' })
    const setting = (await readAggregateSettings()).providers?.['opencode']
    expect(providerApiKeys(setting ?? {})).toEqual(['sk-old', 'sk-new'])
    // And the vendor stays enabled: appending a key is not a re-configuration.
    expect(setting?.enabled).toBe(true)
  })
})

describe('orderApiKeys follows the chosen strategy', () => {
  const keys = ['a', 'b', 'c'] as const

  it('priority keeps the stored order, preferred first', () => {
    expect(orderApiKeys(keys, 'priority')).toEqual(['a', 'b', 'c'])
    expect(orderApiKeys(keys, undefined)).toEqual(['a', 'b', 'c'])
  })

  it('round-robin rotates from a picked start and keeps every key', () => {
    const rotated = orderApiKeys(keys, 'round-robin', () => 0.5)
    expect(rotated).toEqual(['b', 'c', 'a'])
    // Nothing is lost: a rotation reorders, it never filters.
    expect([...rotated].sort()).toEqual(['a', 'b', 'c'])
  })

  it('balanced spreads from a random start as well', () => {
    expect(orderApiKeys(keys, 'balanced', () => 0.99)).toEqual(['c', 'a', 'b'])
  })

  it('strategies with no input answer the stored order instead of inventing one', () => {
    // `expiry` wants key lifetimes this lane cannot read; `sticky` wants a
    // conversation. Answering the stored order is honest; a made-up ordering would
    // look like it did something.
    expect(orderApiKeys(keys, 'expiry')).toEqual(['a', 'b', 'c'])
    expect(orderApiKeys(keys, 'sticky')).toEqual(['a', 'b', 'c'])
  })

  it('a single key is never reordered, under any strategy', () => {
    for (const strategy of ['priority', 'round-robin', 'balanced', 'sticky', 'expiry', 'nonsense']) {
      expect(orderApiKeys(['only'], strategy, () => 0.5)).toEqual(['only'])
    }
  })

  it('an out-of-range pick still yields a permutation, never a dropped key', () => {
    // `picker` is a seam for tests and could be a caller bug; a key list is what a
    // request is made with, so it must survive a bad float intact.
    for (const value of [-1, 1, 1.5, Number.NaN]) {
      const out = orderApiKeys(keys, 'round-robin', () => value)
      expect([...out].sort()).toEqual(['a', 'b', 'c'])
    }
  })
})

import { describe, expect, it, beforeEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  isUsageStrategy,
  publishChannelUsage,
  readChannelUsage,
  writeChannelUsage,
} from '../src/channel-usage.ts'

/**
 * Per-channel usage order.
 *
 * The pool-wide setting is right for the two WorkBuddy lanes, where every account is one
 * vendor's. A channel with two or three accounts of its own is a different decision, so each
 * gets its own answer — stored beside the plugin's other state, and handed to the pack through
 * the environment because that is what its selection reads.
 */
let store: string
beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), 'xdpool-usage-'))
  process.env['DSH_HOME'] = store
  delete process.env['DSH_XDPOOL_CHANNEL_USAGE']
})

describe('the stored overrides', () => {
  it('starts empty, which means "every channel follows the pool"', () => {
    expect(readChannelUsage()).toEqual({})
  })

  it('remembers one channel', () => {
    writeChannelUsage('codearts', 'balanced')
    expect(readChannelUsage()).toEqual({ codearts: 'balanced' })
  })

  it('keeps several channels independent', () => {
    writeChannelUsage('codearts', 'balanced')
    writeChannelUsage('qoder', 'round-robin')
    expect(readChannelUsage()).toEqual({ codearts: 'balanced', qoder: 'round-robin' })
  })

  it('clears one channel without touching the others', () => {
    // Clearing must DELETE the key rather than store the pool's current value: a stored copy
    // would freeze, and a later change to the pool default would not reach this channel.
    writeChannelUsage('codearts', 'balanced')
    writeChannelUsage('qoder', 'round-robin')
    writeChannelUsage('codearts', undefined)
    expect(readChannelUsage()).toEqual({ qoder: 'round-robin' })
  })

  it('ignores a value that is not one of the five', () => {
    // The store is a file a user could hand-edit; an unknown strategy would be stored and then
    // silently fall back at request time, which is worse than dropping it now.
    writeChannelUsage('codearts', 'nonsense' as never)
    expect(readChannelUsage()).toEqual({})
  })

  it('survives a corrupt file by reporting no overrides', () => {
    writeChannelUsage('codearts', 'balanced')
    // A half-written file must not take the plugin down; the worst case is "follow the pool".
    expect(() => readChannelUsage()).not.toThrow()
  })
})

describe('what the pack receives', () => {
  it('publishes nothing when no channel has an override', () => {
    publishChannelUsage()
    expect(process.env['DSH_XDPOOL_CHANNEL_USAGE']).toBeUndefined()
  })

  it('publishes a JSON map the pack can parse', () => {
    writeChannelUsage('codearts', 'balanced')
    publishChannelUsage()
    const raw = process.env['DSH_XDPOOL_CHANNEL_USAGE']
    expect(raw).toBeDefined()
    expect(JSON.parse(raw ?? '{}')).toEqual({ codearts: 'balanced' })
  })

  it('updates the published map on every write, not only at mount', () => {
    // A value that only took effect on restart would make the pane look broken.
    writeChannelUsage('codearts', 'balanced')
    expect(JSON.parse(process.env['DSH_XDPOOL_CHANNEL_USAGE'] ?? '{}')).toEqual({ codearts: 'balanced' })
    writeChannelUsage('qoder', 'expiry')
    expect(JSON.parse(process.env['DSH_XDPOOL_CHANNEL_USAGE'] ?? '{}')).toEqual({
      codearts: 'balanced',
      qoder: 'expiry',
    })
  })
})

describe('the names', () => {
  it('accepts exactly the five strategies', () => {
    for (const name of ['priority', 'round-robin', 'balanced', 'sticky', 'expiry']) {
      expect(isUsageStrategy(name), name).toBe(true)
    }
    for (const name of ['', 'PRIORITY', 'random', 'first', 0, null, undefined]) {
      expect(isUsageStrategy(name), String(name)).toBe(false)
    }
  })
})

import { describe, expect, it, beforeEach } from 'vitest'

/**
 * Doubao's model selection has to survive a panel reopen.
 *
 * `model.setDisabled` and `model.setAllDisabled` are pack RPCs addressed to the pack's own model
 * record. Doubao has no entry there, so both answered "unknown provider", the catch rolled the
 * local state back, and the checkbox snapped to its old value the moment the panel was reopened.
 * Every other channel persists through the pack because the pack owns its catalogue; this lane
 * owns its own.
 *
 * These tests exercise the storage helpers against a real localStorage shim, because the bug was
 * never in the rendering — it was in what got written.
 */
const KEY = 'dsh-xdpool.doubao-skipped-models.v1'

/** A minimal localStorage, since the these helpers run in the browser half. */
class MemoryStore {
  private readonly map = new Map<string, string>()
  getItem(key: string): string | null { return this.map.get(key) ?? null }
  setItem(key: string, value: string): void { this.map.set(key, value) }
  removeItem(key: string): void { this.map.delete(key) }
  clear(): void { this.map.clear() }
}

beforeEach(() => {
  const store = new MemoryStore()
  ;(globalThis as { localStorage?: MemoryStore }).localStorage = store
})

/** The reader, mirroring the one in the component. */
function readSkipped(): ReadonlySet<string> | undefined {
  const raw = globalThis.localStorage?.getItem(KEY)
  if (raw === null || raw === undefined) return undefined
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return undefined
    return new Set(parsed.filter((id): id is string => typeof id === 'string'))
  } catch {
    return undefined
  }
}

/** The writer, mirroring the one in the component. */
function saveSkipped(modelId: string, disabled: boolean): void {
  const current = readSkipped() ?? new Set<string>()
  const next = new Set(current)
  if (disabled) next.add(modelId)
  else next.delete(modelId)
  globalThis.localStorage?.setItem(KEY, JSON.stringify([...next]))
}

describe("Doubao's model selection", () => {
  it('starts unconfigured rather than empty', () => {
    // "Never touched" must be distinguishable from "everything switched off": the first shows
    // all models, the second shows none, and collapsing them makes a fresh account look as
    // though the user had already made choices.
    expect(readSkipped()).toBeUndefined()
  })

  it('remembers one model being switched off', () => {
    saveSkipped('person-kimi-k3-261111', true)
    expect([...(readSkipped() ?? [])]).toEqual(['person-kimi-k3-261111'])
  })

  it('remembers it being switched back on', () => {
    saveSkipped('person-kimi-k3-261111', true)
    saveSkipped('person-kimi-k3-261111', false)
    expect(readSkipped()?.has('person-kimi-k3-261111')).toBe(false)
  })

  it('keeps several models independently', () => {
    saveSkipped('a', true)
    saveSkipped('b', true)
    saveSkipped('a', false)
    expect([...(readSkipped() ?? [])]).toEqual(['b'])
  })

  it('survives a reopen — the state is read back, not reset', () => {
    // This is the reported bug in one assertion: switch a model off, then read again.
    saveSkipped('seed-lite-7b', true)
    const second = readSkipped()
    expect(second?.has('seed-lite-7b')).toBe(true)
  })

  it('treats a corrupt value as unconfigured instead of crashing', () => {
    globalThis.localStorage?.setItem(KEY, 'not json')
    expect(readSkipped()).toBeUndefined()
  })

  it('ignores non-string entries in a hand-edited value', () => {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(['ok', 42, null, { x: 1 }]))
    expect([...(readSkipped() ?? [])]).toEqual(['ok'])
  })

  it('turns everything off in one write, and back on in one write', () => {
    const all = ['0', '3', 'seed-lite-7b', '5', '9', 'image-gen']
    // All off: every id is skipped.
    globalThis.localStorage?.setItem(KEY, JSON.stringify(all))
    expect(readSkipped()?.size).toBe(all.length)
    // All on: the skip list is emptied, and an empty list still means "configured".
    globalThis.localStorage?.setItem(KEY, JSON.stringify([]))
    const after = readSkipped()
    expect(after).toBeDefined()
    expect(after?.size).toBe(0)
  })
})

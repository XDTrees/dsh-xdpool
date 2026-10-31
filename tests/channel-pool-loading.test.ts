/**
 * The scan-channel section's loading contract (#95, #102).
 *
 * Two defects, one page, and both were INVISIBLE in the way that matters: the
 * section rendered nothing, so a blank half-page could equally mean "you have
 * not signed in to these channels", "the RPC bridge is down", or "it is still
 * loading". The fix has three parts and each one is asserted here, because each
 * one on its own would restore the original confusion:
 *
 *   1. a snapshot that outlives the mount, so switching tabs does not re-run
 *      the whole chain and show blank cards for 2-4 seconds;
 *   2. the balance RPC off the draw path, so the cards appear at once and only
 *      the credits cell waits;
 *   3. a visible "reading" line instead of air while that first read is out.
 *
 * Source-level assertions, like the rest of this suite: the component needs a
 * DOM and a live RPC bridge, neither of which exists in this process.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const section = readFileSync(new URL('../src/client/ChannelPoolSection.tsx', import.meta.url), 'utf8')
const locales = readFileSync(new URL('../src/client/locales.ts', import.meta.url), 'utf8')

/** The `load` function body, bounded by the retry helper that follows it. */
const loadBody = section.slice(section.indexOf('const load = async ()'), section.indexOf('const loadWithRetry ='))

describe('the channel cards survive a remount', () => {
  it('keeps the last good answer outside the component', () => {
    // `useState` dies with the mount, and switching tabs unmounts this section,
    // so a module-level store is the only thing that can hold the answer.
    expect(section).toContain('let poolSnapshot: ChannelPoolSnapshot | undefined')
    expect(section).toMatch(/useState<readonly ChannelEntry\[\]>\(\(\) => poolSnapshot\?\.entries \?\? \[\]\)/u)
    expect(section).toMatch(/useState<string \| undefined>\(\(\) => poolSnapshot\?\.error\)/u)
  })

  it('writes the store BEFORE the mounted check', () => {
    // The defect, precisely: a result that arrived after the reader switched
    // tabs was dropped for not being watched. The store must be filled first,
    // so the answer survives even when nobody is looking.
    const storeWrite = loadBody.indexOf('poolSnapshot = { entries: next, error: undefined }')
    const mountedCheck = loadBody.indexOf('if (!mountedRef.current) return', storeWrite === -1 ? 0 : storeWrite)
    expect(storeWrite).toBeGreaterThan(-1)
    expect(mountedCheck).toBeGreaterThan(storeWrite)
  })

  it('can invalidate the store when the data behind it changed', () => {
    // A login or a deletion makes the snapshot wrong, and a stale card after an
    // action the user just took reads as "that did nothing".
    expect(section).toContain('export function invalidatePoolSnapshot()')
    expect(section).toContain('invalidatePoolSnapshot()')
  })

  it('stamps each load so a late answer cannot repaint a newer one', () => {
    expect(section).toContain('const loadSeq = useRef(0)')
    expect(loadBody).toContain('loadSeq.current += 1')
    expect(loadBody).toContain('loadSeq.current !== seq')
  })
})

describe('the cards do not wait for the balance RPC', () => {
  it('wave 1 asks only for what the card itself draws', () => {
    // `account.list` and `model.list` answer from memory; `credits.balances` is
    // the only call that goes to the network. Awaiting all four together — the
    // old shape — made the whole card wait on the slowest one.
    expect(loadBody).not.toContain("callPack('credits.balances'")
    expect(loadBody).toContain("callPack('account.list'")
    expect(loadBody).toContain("callPack('model.list'")
  })

  it('marks the credits as pending so the "…" branch is reachable', () => {
    // The renderer already had `balancePending && total === undefined ? '…'`,
    // but the writer hard-coded `false`, so the placeholder was dead code and
    // the wait was invisible.
    expect(loadBody).toContain('balancePending: wantBalances')
    expect(loadBody).not.toMatch(/balancePending: false\s*\n\s*balanceError: balances !== undefined/u)
    expect(section).toContain("t?.('channelpool.balanceLoading')")
  })

  it('fires wave 2 quietly, per channel, without blocking the paint', () => {
    // Quiet: marking the provider busy would disable its claim button for a
    // read the reader never asked for.
    expect(loadBody).toMatch(/void refreshBalances\(entry\.channel\.id, false, true, seq\)/u)
    expect(section).toMatch(/const refreshBalances = async \(provider: string, force: boolean, quiet = false, seq\?: number\)/u)
    // A quiet read that fails must land in balanceError, not the section notice.
    expect(section).toContain('balanceError: envelope.error?.message ?? \'credits.balances refused\'')
  })
})

describe('loading and failing are stated, not rendered as air', () => {
  it('shows a reading line while the first wave is out', () => {
    // The old code was `if (entries.length === 0 && error === undefined) return
    // <></>` — a bare fragment. A failed bridge produced exactly that, so
    // "broken" and "nothing here" looked identical.
    expect(section).toContain("t?.('channelpool.loading')")
    expect(section).toMatch(/if \(!loading\) return <><\/>/u)
    expect(locales).toContain("'channelpool.loading'")
    expect(locales).toMatch(/'channelpool\.loading': '正在读取扫码渠道…'/u)
    expect(locales).toMatch(/'channelpool\.loading': 'Reading scan channels…'/u)
  })

  it('reports a refused provider.status instead of an empty page', () => {
    // The specific failure in #95: `ok: false` → empty map → empty entry list →
    // `<></>` with `error === undefined`. Silence was the bug.
    expect(loadBody).toMatch(/if \(!statusAnswer\.ok\) \{/u)
    expect(loadBody).toContain("statusAnswer.error?.message ?? 'provider.status refused'")
  })

  it('stops loading on failure, so the error is what stays on screen', () => {
    const catchArm = loadBody.slice(loadBody.indexOf('} catch (cause) {'))
    expect(catchArm).toContain('setLoading(false)')
    expect(catchArm).toContain('poolSnapshot = { entries: entriesRef.current, error: message }')
  })
})

/**
 * A routing chain must be able to say WHY it moved on.
 *
 * The three articles the operator sent all make the same point from different
 * angles: a fallback chain that only reports its final answer is unauditable.
 * The user sees one reply from an unspecified member, and when that reply is
 * slower, differently worded, or simply wrong, there is nothing on screen or in
 * the log that says which member served it or why the earlier ones declined.
 *
 * So the chain keeps a trace: every skip records `member → kind (status)`, the
 * serving member is logged when anything was skipped, and a chain where NOTHING
 * answered puts the whole trace into the error message — because in that case
 * the trace IS the answer.
 *
 * These are source-level assertions. Driving the real path needs a live pool and
 * two upstreams; what is worth locking here is that the trace is threaded through
 * every exit, since a single missed `continue` is exactly how a diagnostic turns
 * into a lie.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const shim = readFileSync(new URL('../src/shim.ts', import.meta.url), 'utf8')

/**
 * The chain-serving function.
 *
 * Bounded by the NEXT top-level function declaration, not by a `/**` marker:
 * the body contains JSDoc-looking text in comments, and an earlier version of
 * this helper sliced past the end of the function into the single-model retry
 * loop — where there are eight more `continue` statements, so the "every skip is
 * recorded" check compared 6 against 13 and looked like a real defect.
 */
function chainBody(): string {
  const start = shim.indexOf('async function serveComboCompletion(')
  if (start === -1) throw new Error('serveComboCompletion not found — the chain entry point moved')
  // The next top-level `async function` / `function` after the chain body. Both
  // spellings are tried and the nearer one wins, so a reordering upstream cannot
  // silently extend the slice.
  const candidates = [
    shim.indexOf('\n  async function ', start + 1),
    shim.indexOf('\n  function ', start + 1),
  ].filter(index => index !== -1)
  if (candidates.length === 0) throw new Error('could not bound the chain body')
  return shim.slice(start, Math.min(...candidates))
}

const body = chainBody()

describe('a chain records every reason it moved on', () => {
  it('has a trace and a helper that writes to it', () => {
    expect(body).toContain('const switches: string[] = []')
    expect(body).toContain('const noteSwitch = (')
    // The helper both records AND logs, so a reader of either surface sees it.
    expect(body).toMatch(/noteSwitch[\s\S]{0,400}?switches\.push/u)
    expect(body).toMatch(/noteSwitch[\s\S]{0,600}?logger\?\.warn\?\./u)
  })

  it('calls the helper at EVERY exit that moves to the next member', () => {
    // Count the `continue` statements that skip a member, and the helper calls.
    // Every skip must be recorded: the whole value of a trace is that it has no
    // holes, and one unrecorded `continue` makes the sequence misleading rather
    // than merely incomplete.
    //
    // `\r?` because the file is checked out CRLF on Windows and LF elsewhere —
    // without it this counted zero skips locally and the assertion compared two
    // numbers that were both wrong.
    const bodyAfterHelper = body.slice(body.indexOf('const noteSwitch'))
    const skips = (bodyAfterHelper.match(/\r?\n\s+continue\r?\n/gu) ?? []).length
    // `const noteSwitch = (` is the definition and does not match this pattern,
    // so every hit is a CALL.
    const notes = (bodyAfterHelper.match(/noteSwitch\(/gu) ?? []).length
    expect(notes, 'every member skip must be recorded').toBe(skips)
    expect(skips).toBeGreaterThanOrEqual(5)
  })

  it('names the serving member when anything was skipped', () => {
    // Without this line the caller cannot tell that the answer came from the
    // third choice. Silent when nothing was skipped, because a one-member chain
    // that worked needs no narration.
    expect(body).toMatch(/if \(switches\.length > 0\) \{/u)
    expect(body).toContain('served by ${member.modelId}')
    // The count is printed as "skipped/total" — the reader needs to know whether
    // the third member answered out of three or out of ten.
    expect(body).toContain('after skipping')
    expect(body).toMatch(/String\(switches\.length\)\}\/\$\{String\(members\.length\)\}/u)
  })

  it('puts the trace in the error when no member answered', () => {
    // The one case where the trace is the answer: the user needs to know which
    // member failed with what, and sending them to a log file is a worse trade
    // than a long line in the message.
    expect(body).toMatch(/const trace = switches\.length === 0 \? '' :/u)
    expect(body).toContain('${trace}')
    // And the attempt list stays: it names the ORDER, which the trace alone
    // does not (the trace only has the members that were skipped).
    expect(body).toContain('no member answered after ${attempts.length}')
  })

  it('keeps the reason vocabulary it already had', () => {
    // The trace is only readable if the kinds mean something. These are the four
    // a chain member can produce, and they map to different user actions:
    // wait (soft_rate), re-sign-in (session_dead), top up (hard_credit), or fix
    // the config (combo_config).
    for (const kind of ['soft_rate', 'session_dead', 'hard_credit', 'combo_config']) {
      expect(body, `${kind} is no longer recorded`).toContain(kind)
    }
  })
})

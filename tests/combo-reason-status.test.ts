/**
 * "No account available" must not always mean "invalid API key" (#115).
 *
 * `unavailableReason` returns a complete diagnosis, and each answer needs a
 * different action from the reader:
 *
 *   cooling      → wait, the limit resets
 *   session_dead → sign in again, the credential was revoked
 *   reserve      → lower your own credit floor, or top up
 *   disabled     → switch the account back on
 *   empty        → add an account
 *
 * The routing chain collapsed four of those into 401 — whose universal reading is
 * "your API key is invalid, sign in again". A user parked under their own
 * reserve limit was told to re-authenticate, did it, and it did not help, because
 * nothing was wrong with the credential.
 *
 * These are source assertions: the mapping lives in one table and the risk is
 * that a future edit reintroduces a two-way ternary.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const shim = readFileSync(new URL('../src/shim.ts', import.meta.url), 'utf8')

/** The `REASON_STATUS` table, brace-matched. */
function reasonTable(): string {
  const start = shim.indexOf('const REASON_STATUS')
  if (start === -1) throw new Error('REASON_STATUS is gone — the chain is guessing statuses again')
  let depth = 0
  for (let index = shim.indexOf('{', start); index < shim.length; index += 1) {
    if (shim[index] === '{') depth += 1
    else if (shim[index] === '}') {
      depth -= 1
      if (depth === 0) return shim.slice(start, index + 1)
    }
  }
  throw new Error('REASON_STATUS is not balanced')
}

const table = reasonTable()

describe('each "no account" reason gets its own status', () => {
  it('maps all five reasons the pool can report', () => {
    // The union in `unavailableReason` is exactly these five, so a new one must
    // be added here or it will fall back to 503 — honest, but less useful.
    expect(table).toMatch(/cooling:\s*429/u)
    expect(table).toMatch(/session_dead:\s*401/u)
    expect(table).toMatch(/reserve:\s*402/u)
    expect(table).toMatch(/disabled:\s*403/u)
    expect(table).toMatch(/empty:\s*503/u)
  })

  it('does not answer 401 for anything except a dead credential', () => {
    // 401 is the one status with a universally understood meaning. Anything
    // else reusing it sends the reader to re-authenticate over a problem that
    // authentication cannot fix.
    const entries = [...table.matchAll(/(\w+):\s*(\d+)/gu)].map(m => [m[1], Number(m[2])] as const)
    const unauthorised = entries.filter(([, status]) => status === 401).map(([reason]) => reason)
    expect(unauthorised).toEqual(['session_dead'])
  })

  it('keeps distinct statuses, so the five do not collapse back into fewer', () => {
    const statuses = [...table.matchAll(/(\w+):\s*(\d+)/gu)].map(m => Number(m[2]))
    expect(new Set(statuses).size).toBe(statuses.length)
  })

  it('the chain consults the table instead of a two-way ternary', () => {
    // The defect was `why.reason === 'cooling' ? 429 : 401`. Its shape is the
    // bug: a ternary cannot express five answers, and the next reader copies it.
    expect(shim).toContain('REASON_STATUS[why.reason] ?? 503')
    expect(shim).not.toMatch(/why\.reason === 'cooling' \? 429 : 401/u)
  })

  it('an unknown reason falls back to "cannot serve", never to "bad key"', () => {
    // 503 is a true statement about an unfamiliar state; 401 is a specific and
    // probably false one.
    expect(shim).toMatch(/REASON_STATUS\[why\.reason\] \?\? 503/u)
  })
})

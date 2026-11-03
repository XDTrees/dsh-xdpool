/**
 * HTTP status per `unavailableReason` verdict, on the AGGREGATE (combo) path.
 *
 * `unavailableReason` answers WHY no account could serve a request, and the
 * answers need DIFFERENT advice: a cooldown means wait, a revoked sign-in means
 * sign in again, a reserve floor or a switched-off account means edit the card,
 * an empty pool means add an account.
 *
 * The single-model path already branches on every reason. The combo path
 * collapsed them with `cooling ? 429 : 401`, so `reserve`, `disabled` and
 * `empty` all surfaced as 401 — and 401 reads as "the API key is invalid, sign
 * in again". Users followed that advice and stayed stuck, because the fault was
 * a credit floor or a toggle.
 *
 * Only the mapping table itself is pinned here; the transport is stubbed out.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const shimSource = readFileSync(join(import.meta.dirname, '..', 'src', 'shim.ts'), 'utf8')

describe('reason → status mapping', () => {
  it('declares a status for every reason `unavailableReason` can return', () => {
    // The declared union in accounts.ts is the source of truth. Anchored on the
    // `unavailableReason` signature so an unrelated `reason:` field (the
    // skipped-file report has its own union) cannot be picked up by mistake.
    const accountsSource = readFileSync(join(import.meta.dirname, '..', 'src', 'accounts.ts'), 'utf8')
    const anchor = accountsSource.indexOf('unavailableReason(')
    expect(anchor).toBeGreaterThan(-1)
    const block = /reason:\s*((?:'[a-z_]+'\s*\|\s*)+'[a-z_]+')/.exec(accountsSource.slice(anchor))
    expect(block).not.toBeNull()

    const reasons = [...block![1]!.matchAll(/'([a-z_]+)'/g)].map(m => m[1]!)
    expect(reasons.length).toBeGreaterThan(0)

    const table = /const REASON_STATUS[\s\S]*?\{([\s\S]*?)\n\}/.exec(shimSource)
    expect(table).not.toBeNull()
    for (const reason of reasons) {
      expect(table![1]).toContain(`${reason}:`)
    }
  })

  it('maps a reserve floor to 402, not 401', () => {
    const table = /const REASON_STATUS[\s\S]*?\{([\s\S]*?)\n\}/.exec(shimSource)!
    expect(table[1]).toMatch(/reserve:\s*402/)
  })

  it('maps a switched-off pool to 403, not 401', () => {
    const table = /const REASON_STATUS[\s\S]*?\{([\s\S]*?)\n\}/.exec(shimSource)!
    expect(table[1]).toMatch(/disabled:\s*403/)
  })

  it('keeps cooling at 429 and session_dead at 401', () => {
    const table = /const REASON_STATUS[\s\S]*?\{([\s\S]*?)\n\}/.exec(shimSource)!
    expect(table[1]).toMatch(/cooling:\s*429/)
    expect(table[1]).toMatch(/session_dead:\s*401/)
  })

  it('no longer collapses every reason onto 401 in the combo path', () => {
    // The old expression was `status: why.reason === 'cooling' ? 429 : 401`.
    expect(shimSource).not.toMatch(/status:\s*why\.reason === 'cooling'\s*\?\s*429\s*:\s*401/)
    expect(shimSource).toContain('REASON_STATUS[why.reason] ?? 503')
  })
})

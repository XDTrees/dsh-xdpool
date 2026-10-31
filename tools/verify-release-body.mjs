/**
 * Check every factual claim in the 2.5.1 release body against the source.
 *
 * The body is prose written from memory of the work, and prose drifts: a line
 * number, a count, a function name that was renamed ten minutes later. Every
 * assertion below is cheap to run and one is not — so a claim that no longer
 * matches the tree fails here instead of being published where a reader would
 * have to trust it.
 *
 * Run: node tools/verify-release-body.mjs _release-2.5.1.md
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const bodyPath = process.argv[2]
if (bodyPath === undefined) throw new Error('usage: node tools/verify-release-body.mjs <body.md>')
const body = readFileSync(join(ROOT, bodyPath), 'utf8')

const src = {
  routing: readFileSync(join(ROOT, 'src/client/RoutingPage.tsx'), 'utf8'),
  pool: readFileSync(join(ROOT, 'src/client/ChannelPoolSection.tsx'), 'utf8'),
  accounts: readFileSync(join(ROOT, 'src/accounts.ts'), 'utf8'),
  task: readFileSync(join(ROOT, 'src/task-events.ts'), 'utf8'),
  free: readFileSync(join(ROOT, 'src/free-upstream.ts'), 'utf8'),
  card: readFileSync(join(ROOT, 'src/client/PoolCard.tsx'), 'utf8'),
  qr: readFileSync(join(ROOT, 'src/client/community-qr.ts'), 'utf8'),
  changelog: readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8'),
}

// The QR payload length the body quotes. The body names the WHOLE data URI
// (`data:image/png;base64,` + payload), because that is the string the probe
// prints; comparing against the bare base64 body instead is the kind of
// off-by-a-prefix that makes a correct body look wrong.
const qrBase64 = src.qr.match(/base64,([A-Za-z0-9+/=]+)/u)?.[1] ?? ''
const qrDataUriLength = 'data:image/png;base64,'.length + qrBase64.length

const checks = [
  // --- #99
  ['#99: the synchronous guard is in the source', src.routing.includes('if (!seeded.current) {')],
  ['#99: no functional updater gates on seeded', !/^\s*setDrafts\(prev => seeded/mu.test(src.routing)],

  // --- #101
  ['#101: the radio name is scoped by useId', src.card.includes('budget-${radioScope}')],
  ['#101: no unscoped radio name remains', !src.card.includes('budget-${model.id}')],

  // --- #102
  ['#102: the snapshot is written before the mounted check',
    src.pool.indexOf('poolSnapshot = { entries: next') !== -1
    && src.pool.indexOf('poolSnapshot = { entries: next') < src.pool.indexOf('if (!mountedRef.current) return', src.pool.indexOf('poolSnapshot = { entries: next'))],
  ['#102: wave 2 is fired per channel, unawaited',
    src.pool.includes('void refreshBalances(entry.channel.id, false, true, seq)')],
  ['#102: balancePending is no longer hardcoded false',
    !/balancePending: false,\s*\n\s*balanceError: balances/u.test(src.pool)],

  // --- #95
  ['#95: the reading state has its own locale key', src.pool.includes("t?.('channelpool.loading')")],

  // --- #98
  ['#98: expertIdFromJumpUrl exists', src.task.includes('export function expertIdFromJumpUrl')],
  ['#98: reserve is counted, not returned on first hit', src.accounts.includes('let reserved = 0')],
  ['#98: reserve needs every usable account parked', src.accounts.includes('usable === 0 && reserved > 0')],
  ['#98: flushEarnings exists', readFileSync(join(ROOT, 'src/scheduler.ts'), 'utf8').includes('async flushEarnings()')],

  // --- #96
  ['#96: withFreeTierHint exists', src.free.includes('function withFreeTierHint')],
  ['#96: the 403 path is routed through it', src.free.includes('withFreeTierHint(response.status, refusal, retryAfter)')],

  // --- counts quoted in the body
  ['the QR data URI length matches the body\'s figure',
    body.includes(String(qrDataUriLength))],
  ['the CHANGELOG carries a 2.5.1 section', src.changelog.includes('## 2.5.1 —')],
  ['the body names the six issues it covers',
    ['#95', '#96', '#98', '#99', '#101', '#102'].every(tag => body.includes(tag))],
  ['the body does not promise a feature that was not built',
    !body.includes('tests pass (')],
]

let failed = 0
for (const [label, ok] of checks) {
  console.log(`${ok ? '  OK  ' : '  FAIL'}  ${label}`)
  if (!ok) failed += 1
}
if (failed > 0) throw new Error(`${String(failed)} claim(s) in ${bodyPath} do not match the tree`)
console.log(`all ${String(checks.length)} claims verified`)

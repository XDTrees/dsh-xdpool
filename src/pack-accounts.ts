/**
 * Accounts the login channels hand the pool.
 *
 * The WorkBuddy / CodeBuddy lanes are logged in by SCANNING A QR CODE on the
 * Channels page, not by reading a credential file the desktop app left behind.
 * Those sign-ins land in the vendored free-channel pack's own account pool
 * (`channel-pack:` in `settings-legacy.yaml`, secrets in `.credentials.yaml`),
 * so the region cards — which have always listed whatever `AccountPool.scan()`
 * found — never saw them. The user then found the same account twice: once
 * under "WorkBuddy 国内版" and once under a channel card.
 *
 * This module is the bridge. It reads the pack's accounts and rewrites them
 * into {@link WorkBuddyCredential} so ONE pool holds every sign-in, whichever
 * route produced it. Both sides key an account by its upstream identity, so a
 * QR sign-in of an account the desktop app also has merges into one row instead
 * of appearing twice — which is the whole point of routing them through a
 * single pool rather than merging two lists at render time.
 *
 * @module dsh-xdpool/pack-accounts
 */

import type { WorkBuddyCredential } from './accounts.ts'

/**
 * Channel ids whose accounts this plugin serves itself.
 *
 * `buddy` is CodeBuddy (CN) and `workbuddy` is WorkBuddy AI (international);
 * both are the two lanes the two region cards exist for. Every other channel
 * (TRAE, Qoder, ZCode, …) keeps its own model roster and gateway and is listed
 * by the channel cards instead, so its accounts must not leak into this pool.
 */
export const PACK_REGION_CHANNELS: readonly string[] = ['buddy', 'workbuddy']

/**
 * Fallback domain per channel, used when the credential carries none.
 *
 * A scan sign-in normally records the domain the server issued the token for
 * (`token.domain`), but a credential written by an older build can lack it, and
 * `regionOf` treats a missing domain as CN — which would file an international
 * sign-in under the 国内版 card. So the channel's own product domain is the
 * fallback, and it is the same value the pack sends as `X-Domain` when it has
 * no better one.
 */
const PACK_CHANNEL_DOMAINS: Readonly<Record<string, string>> = {
  buddy: 'copilot.tencent.com',
  workbuddy: 'www.workbuddy.ai',
}

/** One account row as the vendored pack stores it. */
export interface PackAccountEntry {
  id?: unknown
  provider?: unknown
  nickname?: unknown
  enabled?: unknown
  credentialRef?: unknown
  expiresAt?: unknown
}

/** The credential document behind `credentialRef`, snake_cased by the pack. */
export interface PackCredentialDocument {
  access_token?: unknown
  refresh_token?: unknown
  expires_at?: unknown
  refresh_expires_at?: unknown
  nickname?: unknown
  user_id?: unknown
  enterprise_id?: unknown
  domain?: unknown
}

/**
 * The slice of the pack's pool this module reads. Duck-typed on purpose.
 *
 * `listAllAccounts` is declared as returning a promise because the pack declares
 * it `async` (`async listAllAccounts() { return this.readAccounts() }` in
 * `vendor/channel-pack/pack.js`). It was typed synchronously here on the
 * assumption that the pack's async wrapper resolved to a plain array — but an
 * `async` function always hands back a promise, so `pool.listAllAccounts()
 * .filter(...)` threw `TypeError: ... .filter is not a function` on the very
 * first read. Nothing caught it at the call site beyond a swallowed rejection,
 * so every scanned-in channel account silently failed to merge and the account
 * pool looked empty no matter how many channels the user signed into.
 */
export interface PackAccountReader {
  listAllAccounts(): Promise<readonly PackAccountEntry[]>
  resolveCredentialByRef(refName: string): Promise<unknown> | unknown
}

/** Normalize a `snake_case` expiry that may arrive as seconds or milliseconds. */
function expiryToMs(value: unknown): number {
  if (typeof value !== 'number' && typeof value !== 'string') return 0
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return 0
  return numeric > 1e12 ? numeric : numeric * 1000
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/**
 * Rewrite one pack credential into the pool's shape.
 *
 * Returns undefined when the document is not a usable credential — a missing
 * access token cannot serve a request, and admitting a half-parsed row would
 * put it in rotation to fail on its first pick. The pack's own `domain` wins
 * over the channel default because the server decides which gateway a token
 * belongs to; `user_id` becomes `uid` because that is the same value the
 * desktop app's credential files carry, which is what makes the two routes
 * merge on one id.
 */
export function packCredentialToWorkBuddy(
  entry: PackAccountEntry,
  document: PackCredentialDocument,
): WorkBuddyCredential | undefined {
  const accessToken = text(document.access_token)
  if (accessToken === undefined) return undefined
  const provider = text(entry.provider) ?? 'channel-pack'
  const refName = text(entry.credentialRef) ?? text(entry.id) ?? provider
  const domain = text(document.domain) ?? PACK_CHANNEL_DOMAINS[provider] ?? ''
  const expiresAtMs = expiryToMs(document.expires_at) || expiryToMs(entry.expiresAt)
  const nickname = text(document.nickname) ?? text(entry.nickname)
  const uid = text(document.user_id)
  // Resolved once. Written as `text(…) === undefined ? {} : { enterpriseId: text(…) }`
  // it parsed the field twice and defeated the narrowing — the second call was
  // still `string | undefined` against a field declared `?: string`.
  const enterpriseId = text(document.enterprise_id)
  return {
    accessToken,
    // A non-refreshable sign-in is still a working credential, and the pack
    // records exactly that (`refreshable: false`). Dropping those would hide
    // exactly the accounts a user just scanned in.
    refreshToken: text(document.refresh_token) ?? '',
    expiresAtMs,
    ...expiryToMs(document.refresh_expires_at) > 0
      ? { refreshExpiresAtMs: expiryToMs(document.refresh_expires_at) }
      : {},
    ...nickname === undefined ? {} : { nickname },
    // The pack has no billing `uin`; `uid` is the fallback identity, and a row
    // with neither still keys on its nickname rather than being dropped.
    ...uid === undefined ? {} : { uid },
    ...enterpriseId === undefined ? {} : { enterpriseId },
    domain,
    // The pool logs this on an unreadable file, and a scan sign-in has no file:
    // name the credential ref so a duplicate or a 401 points at something real.
    sourcePath: `channel-pack:${provider}:${refName}`,
  }
}

/** The pack's pool, as reachable through cordis. Duck-typed, never imported. */
export function readPackAccountPool(ctx: unknown): PackAccountReader | undefined {
  let pool: unknown
  try {
    pool = (ctx as { get?: (name: string) => unknown } | undefined)?.get?.('accountPool')
  } catch {
    // The host hands plugins a Proxy whose property access throws for services
    // this composition does not declare, and `get` is the documented escape
    // hatch — but a ctx without it at all throws here instead, which is the same
    // "not available" answer.
    return undefined
  }
  if (pool === undefined || pool === null) return undefined
  const candidate = pool as Partial<PackAccountReader>
  if (typeof candidate.listAllAccounts !== 'function') return undefined
  if (typeof candidate.resolveCredentialByRef !== 'function') return undefined
  return pool as PackAccountReader
}

/**
 * Every account the pack holds for the two pool-owned channels.
 *
 * Best-effort per account: one unreadable credential costs that account, not
 * the batch, because a channel with a bad secret is still worth showing. The
 * caller re-runs this whenever it wants a fresh reading.
 */
export async function readPackCredentials(pool: PackAccountReader | undefined): Promise<WorkBuddyCredential[]> {
  if (pool === undefined) return []
  const entries = (await pool.listAllAccounts()).filter(entry => {
    const provider = text(entry.provider)
    return provider !== undefined && PACK_REGION_CHANNELS.includes(provider)
  })
  const resolved = await Promise.all(entries.map(async (entry) => {
    const refName = text(entry.credentialRef)
    if (refName === undefined) return undefined
    try {
      const document = await pool.resolveCredentialByRef(refName)
      if (document === undefined || document === null || typeof document !== 'object') return undefined
      return packCredentialToWorkBuddy(entry, document as PackCredentialDocument)
    } catch {
      return undefined
    }
  }))
  return resolved.filter((credential): credential is WorkBuddyCredential => credential !== undefined)
}

/**
 * Point a pool at the pack's accounts and pull them in once.
 *
 * Called after the channel pack finished mounting — or failed to, since the
 * pool is owned by whichever plugin won the race and both vendor the same file.
 * The registration is unconditional and the reading is best-effort: if this
 * copy of the pack lost the race, or has not provided `accountPool` yet, the
 * registered source simply yields nothing and the pool keeps its desktop
 * accounts. Rescanning here rather than mutating `accounts` directly is what
 * makes a QR sign-in merge by identity instead of appearing as a second row.
 */
export async function adoptChannelPackAccounts(
  ctx: unknown,
  pool: { applyExternalSource(source?: () => Promise<readonly WorkBuddyCredential[]>): void; scan(): Promise<unknown> },
  logger?: { info?(...args: unknown[]): void; warn?(...args: unknown[]): void },
): Promise<void> {
  const pack = readPackAccountPool(ctx)
  // Registered even when `pack` is undefined: cordis resolves `accountPool`
  // lazily, so a later scan may well find it, and re-registering on every call
  // is cheap.
  pool.applyExternalSource(() => readPackCredentials(readPackAccountPool(ctx)))
  if (pack === undefined) {
    logger?.warn?.('[xdpool] channel-pack account pool not visible yet; pool stays on desktop sign-ins')
    return
  }
  try {
    const merged = await pool.scan()
    const count = Array.isArray(merged) ? merged.length : 0
    logger?.info?.(`[xdpool] pool now serves ${count} account(s) including channel sign-ins`)
  } catch (error: unknown) {
    logger?.warn?.('[xdpool] could not merge channel-pack accounts', error)
  }
}


/**
 * Publish CodeArts credential refs where billion-context looks for them.
 *
 * billion-context (bili) sits inside DSH and compresses context by rewriting
 * request bodies. CodeArts signs its chats with Huawei APIG's SDK-HMAC-SHA256,
 * which by default covers the body — so a rewrite invalidates the signature and
 * the gateway answers 401. bili's contract for that is binary: a body-signed
 * request is either RE-SIGNED+COMPRESSED or REFUSED locally with
 * `403 {"code":"bili_resign_unavailable"}`.
 *
 * To re-sign, bili needs the AK/SK. It can be handed a credential two ways:
 *
 *   1. In-band, via the `x-bili-resign` / `x-bili-resign-credential` markers —
 *      but ONLY on the server path (a request tunnelled through the proxy's
 *      HTTP port). The **native lane** — the in-process `globalThis.fetch`
 *      patch that DSH's own model traffic goes through — does not read those
 *      inbound markers at all: it builds its own `resignExtra` and resolves the
 *      credential itself. (Measured: `decodeApigCredential` is called zero
 *      times in `dist/agent/dsh-native.js`.)
 *   2. Out-of-band, by discovery: bili reads `$DSH_HOME/jet-hub/state.json`,
 *      takes every account whose `provider` is `"codearts"` and whose
 *      `enabled` is not `false`, and resolves each `credentialRef` through the
 *      DSH credentials service.
 *
 * Path 2 is the one the native lane uses, and it points at a DIFFERENT plugin's
 * file: `jet-hub` is the CodeArts auth plugin, and a user who signed in through
 * THIS plugin's channel pack has their account in
 * `$DSH_HOME/channel-pack/state.json` instead. bili then finds no candidate,
 * refuses, and the user sees "API 密钥无效" for a credential that is perfectly
 * valid.
 *
 * This module closes that gap: it mirrors the *reference* — never the secret —
 * from the pack's account pool into jet-hub's state file. The credentials
 * themselves stay solely in the DSH credential store; `credentialRef` is a name
 * (`CODEARTS_ACCOUNT_XXXXXXXX`), and bili resolves it through the same service,
 * so the AK/SK never gets copied to a second place on disk.
 *
 * Why mirror instead of asking bili to read our file: bili's discovery path is
 * not configurable per-source, and duplicating its loader here would rot the
 * moment it changes. A ref pointer is stable across bili releases.
 *
 * Why not just set `BILI_CODEARTS_REF`: that works, but it is a process-level
 * env var that pins ONE account and has to be re-set whenever the user switches
 * accounts. Mirroring the live pool keeps multi-account pools working.
 *
 * @module dsh-xdpool/jet-hub-bridge
 */

import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** Where bili reads CodeArts accounts from, relative to the DSH home. */
const JET_HUB_STATE = join('jet-hub', 'state.json')

/**
 * Which refs THIS bridge wrote into jet-hub's file, relative to the DSH home.
 *
 * Needed to prune safely: jet-hub's file is shared, and a minimal
 * `{provider, enabled, credentialRef}` row there may as easily be another
 * plugin's as ours. Without a record of what we wrote, "stale" cannot be told
 * apart from "not mine", and pruning would delete someone else's credential.
 */
const OWNED_REFS = join('jet-hub', '.xdpool-owned-refs.json')

/** The provider id both plugins use for Huawei CodeArts. */
const CODEARTS = 'codearts'

/** One account row out of either state file. */
interface AccountRow {
  provider?: unknown
  enabled?: unknown
  credentialRef?: unknown
  nickname?: unknown
  [key: string]: unknown
}

/** The shape of both `jet-hub/state.json` and `channel-pack/state.json`. */
interface StateDocument {
  accounts?: unknown
  [key: string]: unknown
}

/** What a sync attempt did, for logging and tests. */
export interface JetHubBridgeOutcome {
  /** Absolute path written. */
  path: string
  /** CodeArts credential refs now present in jet-hub's file. */
  refs: readonly string[]
  /** True when the file changed on this call. */
  wrote: boolean
  /** How many stale bridge-authored refs were dropped, when any were. */
  pruned?: number
  /** Why nothing was written, when nothing was. */
  skipped?: 'no-refs' | 'already-present' | 'unreadable-source'
  /** Non-fatal failure detail; the sync never throws into the caller. */
  error?: string
}

/** The DSH home, honouring the same override the rest of the plugin uses. */
export function dshHome(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env['DSH_HOME']
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv.trim()
  return join(homedir(), '.dsh')
}

/** The credential ref of every ENABLED CodeArts account in the pack's pool. */
export function codeArtsRefsFrom(poolState: unknown): string[] {
  const accounts = (poolState as StateDocument | undefined)?.accounts
  if (!Array.isArray(accounts)) return []
  const refs: string[] = []
  for (const row of accounts as AccountRow[]) {
    if (row?.provider !== CODEARTS) continue
    // The pack records `enabled: false` for a switched-off account. Absent means
    // enabled — matching bili's own reading (`enabled === false` skips).
    if (row.enabled === false) continue
    const ref = row.credentialRef
    if (typeof ref !== 'string' || ref === '') continue
    if (!refs.includes(ref)) refs.push(ref)
  }
  return refs
}

/**
 * Merge our refs into an existing jet-hub document.
 *
 * The file belongs to ANOTHER plugin, so this preserves everything already in
 * it: unknown top-level keys survive, and an account already listed keeps its
 * own fields (nickname, expiry, whatever jet-hub writes) unless it is one of
 * ours. Refs are matched by `credentialRef`, so a repeated sync is a no-op and
 * a user who signed into both plugins ends up with both accounts listed.
 */
export function mergeRefsIntoJetHub(
  existing: unknown,
  refs: readonly string[],
  ownedRefs?: readonly string[],
): { document: StateDocument; added: number; removed: number } {
  const document: StateDocument =
    typeof existing === 'object' && existing !== null && !Array.isArray(existing)
      ? { ...(existing as StateDocument) }
      : {}
  const rows = Array.isArray(document.accounts) ? [...(document.accounts as AccountRow[])] : []
  const seen = new Set(
    rows
      .map((row) => (typeof row?.credentialRef === 'string' ? row.credentialRef : undefined))
      .filter((ref): ref is string => ref !== undefined),
  )
  let added = 0
  for (const ref of refs) {
    if (seen.has(ref)) continue
    rows.push({ provider: CODEARTS, enabled: true, credentialRef: ref })
    seen.add(ref)
    added += 1
  }
  // Drop CodeArts rows that are OURS but no longer in the pool.
  //
  // A CodeArts re-sign-in replaces the credential under a NEW ref
  // (`CODEARTS_ACCOUNT_AC7A7A7A` became `…E9550FF8` on the user's machine), and
  // a stale row is not merely useless: bili tries candidates in file order and
  // asks the credential service to resolve each one, so a ref that no longer
  // exists can win the race and arm the re-signer with a dead credential — the
  // turn then dies after signing instead of being fixed. Only rows this bridge
  // writes are eligible for removal (plain `provider: codearts` with nothing
  // else on them); the other plugin's richer rows are left alone, because we
  // cannot know whether their refs are still valid in ITS model.
  // Which stale rows may we delete? Only ones THIS bridge could have written,
  // identified positively rather than by guessing from their shape: a plain
  // `{provider, enabled, credentialRef}` row whose ref is absent from the pool
  // could equally be another plugin's minimal row, and deleting that would drop
  // a credential we know nothing about. So the caller passes the set it wrote
  // last time, and only those are eligible.
  const owned = new Set(ownedRefs ?? [])
  let removed = 0
  const kept = rows.filter((row) => {
    if (row?.provider !== CODEARTS) return true
    if (typeof row.credentialRef !== 'string') return true
    if (refs.includes(row.credentialRef)) return true
    if (!owned.has(row.credentialRef)) return true
    removed += 1
    return false
  })
  document.accounts = kept
  return { document, added, removed }
}

/**
 * Write the merged document, atomically.
 *
 * A half-written state file would break the other plugin on its next read, so
 * this writes a sibling temp file and renames over the target — the same
 * pattern `src/at-rest.ts` uses for anything that must not be observed mid-write.
 */
async function writeAtomically(path: string, document: StateDocument): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.xdpool-${String(process.pid)}.tmp`
  await writeFile(temp, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await rename(temp, path)
}

/**
 * Mirror the pack's CodeArts credential refs into bili's discovery file.
 *
 * Never throws: this runs on the login path, and a bridge failure must not turn
 * a successful sign-in into an error. The caller logs `error` when present.
 * Absent bili is not a problem worth reporting — the file is simply written and
 * nothing reads it.
 */
export async function publishCodeArtsRefsToJetHub(options: {
  home?: string
  poolStatePath?: string
  logger?: { info?: (message: string) => void; warn?: (message: string) => void } | undefined
} = {}): Promise<JetHubBridgeOutcome> {
  const home = options.home ?? dshHome()
  const target = join(home, JET_HUB_STATE)
  const source = options.poolStatePath ?? join(home, 'channel-pack', 'state.json')

  let poolState: unknown
  try {
    poolState = JSON.parse(await readFile(source, 'utf8'))
  } catch (error) {
    return { path: target, refs: [], wrote: false, skipped: 'unreadable-source', error: String(error) }
  }

  const refs = codeArtsRefsFrom(poolState)
  if (refs.length === 0) return { path: target, refs, wrote: false, skipped: 'no-refs' }

  let existing: unknown
  try {
    existing = JSON.parse(await readFile(target, 'utf8'))
  } catch {
    // Missing or unparsable: start from an empty document rather than failing.
    // Overwriting a corrupt file is safer than leaving bili unable to read it.
    existing = undefined
  }

  let owned: string[] = []
  try {
    const parsed = JSON.parse(await readFile(join(home, OWNED_REFS), 'utf8')) as unknown
    // The writer has always emitted `{ refs: [...] }`, but this reader used to
    // accept ONLY a bare `[...]`. `Array.isArray({refs:[...]})` is false, so
    // `owned` stayed empty on every run that mattered and the prune below could
    // never fire — which is why a ref belonging to a deleted account survived a
    // re-sign-in and bili kept arming its re-signer with it. Both shapes are
    // accepted now; the object form is what is actually on disk.
    const listed = Array.isArray(parsed)
      ? parsed
      : typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { refs?: unknown }).refs)
        ? (parsed as { refs: unknown[] }).refs
        : []
    owned = listed.filter((ref): ref is string => typeof ref === 'string')
  } catch {
    // No record yet (first run after this feature, or a cleaned home): nothing
    // is prunable, which errs toward keeping a stale row rather than deleting a
    // foreign one — the safe direction.
    owned = []
  }
  const { document, added, removed } = mergeRefsIntoJetHub(existing, refs, owned)
  if (added === 0 && removed === 0) {
    // The state file needs no change — but the ownership record still has to
    // exist, or a later re-sign-in (which mints a NEW ref) can never prune this
    // one. Bootstrapping it lazily here was the bug: on the first run the record
    // did not exist, so `owned` was empty, nothing was prunable, and this early
    // return meant the record never got written either. The stale ref then
    // survived every restart and bili kept arming the re-signer with it.
    if (!sameRefs(owned, refs)) {
      try {
        await writeAtomically(join(home, OWNED_REFS), { refs: [...refs] } as StateDocument)
      } catch (error) {
        return { path: target, refs, wrote: false, error: String(error) }
      }
    }
    return { path: target, refs, wrote: false, skipped: 'already-present' }
  }
  try {
    await writeAtomically(target, document)
    await writeAtomically(join(home, OWNED_REFS), { refs: [...refs] } as StateDocument)
  } catch (error) {
    return { path: target, refs, wrote: false, error: String(error) }
  }
  return { path: target, refs, wrote: true, pruned: removed }
}

/** Whether two ref lists hold the same members (order-insensitive). */
function sameRefs(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false
  const set = new Set(left)
  return right.every((ref) => set.has(ref))
}

/**
 * Last `mtimeMs` of the pool state file this process mirrored, keyed by path.
 *
 * Exists so the cheap entry point below can tell "nothing happened since the
 * last sync" from "the pool changed" with ONE `stat` instead of a full
 * read/merge/write round trip. Keyed by path rather than held as a single value
 * because tests (and a future second profile) point it at different homes.
 */
const syncedSourceStamp = new Map<string, number>()

/**
 * Re-publish only when the pool state file changed since the last sync.
 *
 * WHY THIS EXISTS
 *
 * `publishCodeArtsRefsToJetHub` used to be called from exactly one place: the
 * channel-pack adoption that runs ONCE, when the plugin mounts. That is fine for
 * accounts that were already signed in at startup, and wrong for every sign-in
 * that happens afterwards — which is the common case, because a user signs in
 * BECAUSE the channel did not work.
 *
 * Measured on the user's machine: the process started at 11:28, the bridge wrote
 * jet-hub's file at 11:27 (its startup run), a fresh CodeArts sign-in landed at
 * 11:49 under a NEW ref (`CODEARTS_ACCOUNT_F423797F`), and jet-hub's file still
 * named the DELETED `CODEARTS_ACCOUNT_E9550FF8` from the previous account. bili
 * resolves the refs in that file in order, so it armed its re-signer with a
 * credential that no longer exists — the turn failed exactly as it had before
 * any of the signing fixes landed, and re-signing in again could never help.
 *
 * WHY NOT HOOK THE LOGIN ITSELF
 *
 * The pack owns the login flow and exposes no completion event this plugin can
 * subscribe to; the state file IS the event. Watching its mtime is one `stat`
 * per pool scan (scans are frequent: every lazy load and every card render), and
 * it fires for sign-ins, sign-outs, disable-toggles and background refreshes
 * alike — including the ones that happen while the user is looking at another
 * tab. A login callback would have to be re-derived for each of those paths and
 * would still miss a sign-in performed by the OTHER vendored copy of the pack.
 *
 * Never throws: it runs inside the pool's scan path, where an exception would
 * turn a readable account list into a failed one.
 */
export async function syncCodeArtsRefsIfPoolChanged(options: {
  home?: string
  poolStatePath?: string
  logger?: { info?: (message: string) => void; warn?: (message: string) => void } | undefined
} = {}): Promise<JetHubBridgeOutcome | undefined> {
  const home = options.home ?? dshHome()
  const source = options.poolStatePath ?? join(home, 'channel-pack', 'state.json')
  let stamp: number
  try {
    stamp = (await stat(source)).mtimeMs
  } catch {
    // No pool document yet: nothing was ever signed in, so nothing to publish.
    return undefined
  }
  if (syncedSourceStamp.get(source) === stamp) return undefined
  const outcome = await publishCodeArtsRefsToJetHub(options)
  // Record the stamp even on failure. Retrying a write that the filesystem just
  // refused would re-attempt it on every subsequent scan, which is a warning
  // storm rather than a recovery — and the failure is already logged.
  syncedSourceStamp.set(source, stamp)
  return outcome
}

/** Forget what was mirrored, so the next sync runs unconditionally. */
export function resetCodeArtsRefsSyncState(): void {
  syncedSourceStamp.clear()
}

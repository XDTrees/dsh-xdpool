/**
 * Mirroring CodeArts credential refs where billion-context discovers them.
 *
 * The bug this exists for, measured on a real install: a CodeArts sign-in
 * through the channel pack lands in `channel-pack/state.json`, but bili's native
 * lane — the in-process fetch patch DSH's model traffic actually goes through —
 * discovers CodeArts accounts ONLY in `$DSH_HOME/jet-hub/state.json`. That file
 * belongs to a different plugin and did not exist, so bili found no credential,
 * refused the body-signed chat (`403 bili_resign_unavailable`), and the UI
 * reported "API 密钥无效" for a perfectly valid key.
 *
 * Handing bili the credential in-band does NOT work on that lane: measured, its
 * `dist/agent/dsh-native.js` calls `decodeApigCredential` zero times — the
 * `x-bili-resign-credential` marker is only read by the HTTP proxy path. Out of
 * band is the only route, which is why this mirrors refs into the file bili
 * reads.
 *
 * The properties pinned here are the ones that would make this PR harmful
 * rather than helpful:
 *
 *   - it must never copy the SECRET, only the ref name;
 *   - it must never clobber the other plugin's accounts (that file is not ours);
 *   - it must be idempotent, because it runs on every startup;
 *   - it must never throw, because it runs on the sign-in path.
 */
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  codeArtsRefsFrom,
  mergeRefsIntoJetHub,
  publishCodeArtsRefsToJetHub,
  resetCodeArtsRefsSyncState,
  syncCodeArtsRefsIfPoolChanged,
} from '../src/jet-hub-bridge.ts'

let home: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'xdpool-jethub-'))
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

async function writePool(state: unknown): Promise<void> {
  await mkdir(join(home, 'channel-pack'), { recursive: true })
  await writeFile(join(home, 'channel-pack', 'state.json'), JSON.stringify(state), 'utf8')
}

async function readJetHub(): Promise<Record<string, unknown> | undefined> {
  try {
    return JSON.parse(await readFile(join(home, 'jet-hub', 'state.json'), 'utf8')) as Record<string, unknown>
  } catch {
    return undefined
  }
}

describe('which accounts count as re-signable', () => {
  it('keeps enabled CodeArts refs and drops every other provider', () => {
    const refs = codeArtsRefsFrom({
      accounts: [
        { provider: 'codearts', credentialRef: 'CODEARTS_ACCOUNT_AAAA', enabled: true },
        { provider: 'workbuddy', credentialRef: 'WORKBUDDY_ACCOUNT_BBBB', enabled: true },
        { provider: 'qoder', credentialRef: 'QODER_ACCOUNT_CCCC' },
      ],
    })
    expect(refs).toEqual(['CODEARTS_ACCOUNT_AAAA'])
  })

  it('drops a switched-off CodeArts account', () => {
    // bili skips `enabled === false` too, so publishing one would be a ref it
    // resolves and then refuses to use.
    expect(codeArtsRefsFrom({
      accounts: [{ provider: 'codearts', credentialRef: 'CODEARTS_ACCOUNT_AAAA', enabled: false }],
    })).toEqual([])
  })

  it('treats a missing `enabled` as enabled, matching bili', () => {
    expect(codeArtsRefsFrom({
      accounts: [{ provider: 'codearts', credentialRef: 'CODEARTS_ACCOUNT_AAAA' }],
    })).toEqual(['CODEARTS_ACCOUNT_AAAA'])
  })

  it('survives a malformed pool document', () => {
    for (const junk of [undefined, null, {}, { accounts: 'nope' }, { accounts: [null, 42] }]) {
      expect(codeArtsRefsFrom(junk)).toEqual([])
    }
  })

  it('deduplicates a ref listed twice', () => {
    expect(codeArtsRefsFrom({
      accounts: [
        { provider: 'codearts', credentialRef: 'CODEARTS_ACCOUNT_AAAA' },
        { provider: 'codearts', credentialRef: 'CODEARTS_ACCOUNT_AAAA' },
      ],
    })).toEqual(['CODEARTS_ACCOUNT_AAAA'])
  })
})

describe('merging into a file that belongs to another plugin', () => {
  it('preserves unknown top-level keys and foreign accounts', () => {
    // jet-hub owns this file and may store anything; the bridge must be additive.
    const { document, added } = mergeRefsIntoJetHub(
      {
        version: 3,
        someJetHubSetting: { keep: true },
        accounts: [
          { provider: 'codearts', credentialRef: 'CODEARTS_ACCOUNT_JETHUB', nickname: 'theirs' },
          { provider: 'something-else', credentialRef: 'OTHER_REF' },
        ],
      },
      ['CODEARTS_ACCOUNT_XDPOOL'],
    )
    expect(added).toBe(1)
    expect(document['version']).toBe(3)
    expect(document['someJetHubSetting']).toEqual({ keep: true })
    const accounts = document.accounts as Array<Record<string, unknown>>
    expect(accounts).toHaveLength(3)
    // The other plugin's own row keeps its nickname rather than being rewritten.
    expect(accounts.find((row) => row['credentialRef'] === 'CODEARTS_ACCOUNT_JETHUB')).toEqual({
      provider: 'codearts',
      credentialRef: 'CODEARTS_ACCOUNT_JETHUB',
      nickname: 'theirs',
    })
  })

  it('is a no-op when the ref is already listed', () => {
    const existing = { accounts: [{ provider: 'codearts', credentialRef: 'CODEARTS_ACCOUNT_AAAA' }] }
    expect(mergeRefsIntoJetHub(existing, ['CODEARTS_ACCOUNT_AAAA']).added).toBe(0)
  })

  it('prunes a stale ref only when this bridge wrote it', () => {
    // The distinction that matters: an absent-from-pool row is prunable only if
    // we put it there. A row we never wrote could be another plugin's credential
    // and must survive — a re-sign-in changes the ref, so getting this wrong
    // deletes a live credential.
    const existing = {
      accounts: [
        { provider: 'codearts', credentialRef: 'MINE_STALE' },
        { provider: 'codearts', credentialRef: 'THEIRS_STALE' },
      ],
    }
    const pruned = mergeRefsIntoJetHub(existing, ['MINE_CURRENT'], ['MINE_STALE'])
    expect(pruned.removed).toBe(1)
    const refs = (pruned.document.accounts as Array<Record<string, unknown>>).map((row) => row['credentialRef'])
    expect(refs).toEqual(['THEIRS_STALE', 'MINE_CURRENT'])

    // With no ownership record nothing is prunable: err toward keeping.
    const noRecord = mergeRefsIntoJetHub(existing, ['MINE_CURRENT'])
    expect(noRecord.removed).toBe(0)
  })

  it('starts from an empty document when the file is missing or junk', () => {
    for (const junk of [undefined, null, 'nope', [1, 2], 42]) {
      const { document } = mergeRefsIntoJetHub(junk, ['CODEARTS_ACCOUNT_AAAA'])
      expect(document.accounts).toEqual([
        { provider: 'codearts', enabled: true, credentialRef: 'CODEARTS_ACCOUNT_AAAA' },
      ])
    }
  })
})

describe('publishing to disk', () => {
  it('creates the jet-hub file with the ref only — never the secret', async () => {
    await writePool({
      accounts: [{ provider: 'codearts', credentialRef: 'CODEARTS_ACCOUNT_AAAA', enabled: true }],
    })
    const outcome = await publishCodeArtsRefsToJetHub({ home })
    expect(outcome.wrote).toBe(true)
    expect(outcome.refs).toEqual(['CODEARTS_ACCOUNT_AAAA'])

    const written = await readFile(join(home, 'jet-hub', 'state.json'), 'utf8')
    // The ref is a NAME; the AK/SK lives in the credential store and must not
    // appear here. This is the assertion that keeps the bridge from becoming a
    // secret leak.
    expect(written).toContain('CODEARTS_ACCOUNT_AAAA')
    expect(written).not.toMatch(/access_key_id|secret_access_key|security_token/u)
  })

  it('is idempotent across repeated startups', async () => {
    await writePool({ accounts: [{ provider: 'codearts', credentialRef: 'CODEARTS_ACCOUNT_AAAA' }] })
    expect((await publishCodeArtsRefsToJetHub({ home })).wrote).toBe(true)
    const second = await publishCodeArtsRefsToJetHub({ home })
    expect(second.wrote).toBe(false)
    expect(second.skipped).toBe('already-present')
    // Still exactly one row, not one per boot.
    const doc = await readJetHub()
    expect(doc?.['accounts']).toHaveLength(1)
  })

  it('writes the file with owner-only permissions', async () => {
    // It names a credential ref; group/world read is unnecessary exposure, and
    // the repo has a dedicated helper for exactly this.
    await writePool({ accounts: [{ provider: 'codearts', credentialRef: 'CODEARTS_ACCOUNT_AAAA' }] })
    await publishCodeArtsRefsToJetHub({ home })
    const { stat } = await import('node:fs/promises')
    const mode = (await stat(join(home, 'jet-hub', 'state.json'))).mode & 0o777
    expect(mode).toBe(0o600)
  })

  it('adds to an existing jet-hub file instead of replacing it', async () => {
    await mkdir(join(home, 'jet-hub'), { recursive: true })
    await writeFile(
      join(home, 'jet-hub', 'state.json'),
      JSON.stringify({ keepMe: 'yes', accounts: [{ provider: 'codearts', credentialRef: 'THEIRS' }] }),
      'utf8',
    )
    await writePool({ accounts: [{ provider: 'codearts', credentialRef: 'OURS' }] })
    await publishCodeArtsRefsToJetHub({ home })
    const doc = await readJetHub()
    expect(doc?.['keepMe']).toBe('yes')
    const refs = (doc?.['accounts'] as Array<Record<string, unknown>>).map((row) => row['credentialRef'])
    expect(refs).toEqual(['THEIRS', 'OURS'])
  })

  it('reports rather than throws when the pool file is absent', async () => {
    // This runs on the sign-in path; a bridge failure must never fail a login.
    const outcome = await publishCodeArtsRefsToJetHub({ home })
    expect(outcome.wrote).toBe(false)
    expect(outcome.skipped).toBe('unreadable-source')
    expect(await readJetHub()).toBeUndefined()
  })

  it('does nothing when the pool holds no CodeArts account', async () => {
    await writePool({ accounts: [{ provider: 'workbuddy', credentialRef: 'WORKBUDDY_ACCOUNT_BBBB' }] })
    const outcome = await publishCodeArtsRefsToJetHub({ home })
    expect(outcome.wrote).toBe(false)
    expect(outcome.skipped).toBe('no-refs')
  })
})

/**
 * The regression this entry point exists for.
 *
 * Measured on the user's machine: the process mounted at 11:28 and the bridge
 * wrote jet-hub's file at 11:27 — its ONE startup run. A fresh CodeArts sign-in
 * landed at 11:49 under a NEW ref (`CODEARTS_ACCOUNT_F423797F`), and jet-hub's
 * file still named the DELETED `CODEARTS_ACCOUNT_E9550FF8` from the previous
 * account. bili resolves that file's refs in order, so it armed its re-signer
 * with a credential that no longer existed: re-signing in could never help, and
 * the turn failed exactly as it had before any signing fix.
 *
 * The behaviour under test is therefore not "can it publish" (that covered
 * above) but "does it publish AGAIN when the pool changes underneath it".
 */
describe('a sign-in after mount still reaches jet-hub', () => {
  it('republishes when the pool document changes', async () => {
    resetCodeArtsRefsSyncState()
    await writePool({ accounts: [{ provider: 'codearts', credentialRef: 'CODEARTS_ACCOUNT_OLD00000' }] })
    const first = await syncCodeArtsRefsIfPoolChanged({ home })
    expect(first?.wrote).toBe(true)
    // Replace the account the way a re-sign-in does: a NEW ref, same provider.
    await writePool({ accounts: [{ provider: 'codearts', credentialRef: 'CODEARTS_ACCOUNT_NEW11111' }] })
    const second = await syncCodeArtsRefsIfPoolChanged({ home })
    expect(second?.wrote).toBe(true)
    const refs = ((await readJetHub())?.['accounts'] as Array<Record<string, unknown>>)
      .map((row) => row['credentialRef'])
    expect(refs).toContain('CODEARTS_ACCOUNT_NEW11111')
  })

  it('drops the superseded ref, which is what broke the turn', async () => {
    // A stale row is worse than useless: bili resolves candidates in file order,
    // so the dead one can win and the request dies after signing.
    resetCodeArtsRefsSyncState()
    await writePool({ accounts: [{ provider: 'codearts', credentialRef: 'CODEARTS_ACCOUNT_OLD00000' }] })
    await syncCodeArtsRefsIfPoolChanged({ home })
    await writePool({ accounts: [{ provider: 'codearts', credentialRef: 'CODEARTS_ACCOUNT_NEW11111' }] })
    await syncCodeArtsRefsIfPoolChanged({ home })
    const refs = ((await readJetHub())?.['accounts'] as Array<Record<string, unknown>>)
      .map((row) => row['credentialRef'])
    expect(refs).not.toContain('CODEARTS_ACCOUNT_OLD00000')
    expect(refs).toEqual(['CODEARTS_ACCOUNT_NEW11111'])
  })

  it('is a no-op when the pool is unchanged, so scanning stays cheap', async () => {
    // The callback runs on every pool scan — every lazy load and every card
    // render. Re-writing the file each time would be pure churn on another
    // plugin's document.
    resetCodeArtsRefsSyncState()
    await writePool({ accounts: [{ provider: 'codearts', credentialRef: 'CODEARTS_ACCOUNT_AAAAAAA' }] })
    expect((await syncCodeArtsRefsIfPoolChanged({ home }))?.wrote).toBe(true)
    expect(await syncCodeArtsRefsIfPoolChanged({ home })).toBeUndefined()
  })

  it('stays silent when no pool exists yet', async () => {
    resetCodeArtsRefsSyncState()
    expect(await syncCodeArtsRefsIfPoolChanged({ home })).toBeUndefined()
  })
})

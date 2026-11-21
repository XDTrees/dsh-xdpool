/**
 * Where Marvis accounts live between runs.
 *
 * A list, keyed by `openid` — the vendor's own account id. One file beside the plugin's other
 * state, written atomically and readable only by its owner: it holds live access tokens.
 *
 * @module dsh-xdpool/marvis-store
 */
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pluginDataDir } from './ignored.ts'
import type { MarvisAccount } from './marvis-protocol.ts'

/** The file the accounts live in. */
const FILE = 'marvis-accounts.json'

/** Absolute path of the account file. */
export function marvisAccountsPath(): string {
  return join(pluginDataDir(), FILE)
}

/** Whether a value is a usable stored account. */
function asAccount(value: unknown): MarvisAccount | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const record = value as Partial<MarvisAccount>
  if (typeof record.openid !== 'string' || record.openid === '') return undefined
  if (typeof record.accessToken !== 'string' || record.accessToken === '') return undefined
  if (typeof record.guid !== 'string' || record.guid === '') return undefined
  return {
    openid: record.openid,
    accessToken: record.accessToken,
    ...(typeof record.refreshToken === 'string' && record.refreshToken !== ''
      ? { refreshToken: record.refreshToken }
      : {}),
    ...(typeof record.nickname === 'string' && record.nickname !== ''
      ? { nickname: record.nickname }
      : {}),
    loginType: typeof record.loginType === 'string' && record.loginType !== '' ? record.loginType : '1',
    guid: record.guid,
    expiresAt: typeof record.expiresAt === 'number' ? record.expiresAt : 0,
  }
}

/** Every stored account. A missing or malformed file answers with an empty list. */
export async function readMarvisAccounts(): Promise<readonly MarvisAccount[]> {
  try {
    const parsed = JSON.parse(await readFile(marvisAccountsPath(), 'utf8')) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.map(asAccount).filter((account): account is MarvisAccount => account !== undefined)
  } catch {
    return []
  }
}

/** Write the whole list atomically. */
async function writeAccounts(accounts: readonly MarvisAccount[]): Promise<void> {
  const target = marvisAccountsPath()
  await mkdir(dirname(target), { recursive: true })
  const temporary = `${target}.tmp`
  await writeFile(temporary, JSON.stringify(accounts, null, 2), { encoding: 'utf8', mode: 0o600 })
  await rename(temporary, target)
}

/**
 * Add or replace one account.
 *
 * Keyed by `openid`, so signing into the same account again refreshes its token instead of
 * appending a duplicate — which is what a user does when a session expires.
 */
export async function saveMarvisAccount(account: MarvisAccount): Promise<void> {
  const existing = await readMarvisAccounts()
  const next = existing.filter(entry => entry.openid !== account.openid)
  next.push(account)
  await writeAccounts(next)
}

/** Forget one account. */
export async function removeMarvisAccount(openid: string): Promise<void> {
  const existing = await readMarvisAccounts()
  await writeAccounts(existing.filter(entry => entry.openid !== openid))
}

/** Forget everything. */
export async function removeAllMarvisAccounts(): Promise<void> {
  try {
    await unlink(marvisAccountsPath())
  } catch {
    // Nothing to remove is the state the caller wanted.
  }
}

/**
 * The account a request should use.
 *
 * The first one. A multi-account picker is a separate feature; what matters is that a second
 * sign-in does not destroy the first.
 */
export async function defaultMarvisAccount(): Promise<MarvisAccount | undefined> {
  const accounts = await readMarvisAccounts()
  return accounts[0]
}

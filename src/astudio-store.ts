/**
 * Where AStudio accounts live, and the routes the card talks to.
 *
 * A keyed store like Marvis's: `accountId` is the vendor's uid, so signing in again refreshes
 * the entry instead of appending a duplicate.
 *
 * @module dsh-xdpool/astudio-store
 */
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pluginDataDir } from './ignored.ts'
import { withStoreLock } from './store-lock.ts'
import type { AstudioAccount } from './astudio-account.ts'

/** The file the accounts live in. */
const FILE = 'astudio-accounts.json'

/** Absolute path of the account file. */
export function astudioAccountsPath(): string {
  return join(pluginDataDir(), FILE)
}

/** Whether a value is a usable stored account. */
function asAccount(value: unknown): AstudioAccount | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const record = value as Partial<AstudioAccount>
  if (typeof record.accountId !== 'string' || record.accountId === '') return undefined
  if (typeof record.bearer !== 'string' || record.bearer === '') return undefined
  return {
    accountId: record.accountId,
    bearer: record.bearer,
    cookie: typeof record.cookie === 'string' ? record.cookie : '',
    ...(typeof record.nickname === 'string' && record.nickname !== '' ? { nickname: record.nickname } : {}),
    ...(typeof record.expiresAt === 'number' ? { expiresAt: record.expiresAt } : {}),
  }
}

/** Every stored account. A missing or malformed file answers with an empty list. */
export async function readAstudioAccounts(): Promise<readonly AstudioAccount[]> {
  try {
    const parsed = JSON.parse(await readFile(astudioAccountsPath(), 'utf8')) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.map(asAccount).filter((account): account is AstudioAccount => account !== undefined)
  } catch {
    return []
  }
}

/** Write the whole list atomically, readable only by its owner: it holds live credentials. */
async function writeAccounts(accounts: readonly AstudioAccount[]): Promise<void> {
  const target = astudioAccountsPath()
  await mkdir(dirname(target), { recursive: true })
  const temporary = `${target}.tmp`
  await writeFile(temporary, JSON.stringify(accounts, null, 2), { encoding: 'utf8', mode: 0o600 })
  await rename(temporary, target)
}

/** Add or replace one account, keyed by the vendor's uid. */
export async function saveAstudioAccount(account: AstudioAccount): Promise<void> {
  return await withStoreLock(astudioAccountsPath(), async () => {
    const existing = await readAstudioAccounts()
    const next = existing.filter(entry => entry.accountId !== account.accountId)
    next.push(account)
    await writeAccounts(next)
  })
}

/** Forget one account. */
export async function removeAstudioAccount(accountId: string): Promise<void> {
  const existing = await readAstudioAccounts()
  await writeAccounts(existing.filter(entry => entry.accountId !== accountId))
}

/** Forget everything. */
export async function removeAllAstudioAccounts(): Promise<void> {
  try {
    await unlink(astudioAccountsPath())
  } catch {
    // Nothing to remove is the state the caller wanted.
  }
}

/** The account a request should use. */
export async function defaultAstudioAccount(): Promise<AstudioAccount | undefined> {
  const accounts = await readAstudioAccounts()
  return accounts[0]
}

/** Replace one account's bearer in place, used after a re-mint. */
export async function updateAstudioBearer(accountId: string, bearer: string): Promise<void> {
  const existing = await readAstudioAccounts()
  const next = existing.map(entry => entry.accountId === accountId ? { ...entry, bearer } : entry)
  await writeAccounts(next)
}

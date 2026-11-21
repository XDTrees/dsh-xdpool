/**
 * Where AutoClaw accounts live, one entry per site.
 *
 * @module dsh-xdpool/autoclaw-store
 */
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pluginDataDir } from './ignored.ts'
import { withStoreLock } from './store-lock.ts'
import type { AutoclawCredential } from './autoclaw-protocol.ts'

/** The file the credentials live in. */
const FILE = 'autoclaw-accounts.json'

/** Absolute path of the credential file. */
export function autoclawAccountsPath(): string {
  return join(pluginDataDir(), FILE)
}

/** Whether a value is a usable stored credential. */
function asCredential(value: unknown): AutoclawCredential | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const record = value as Partial<AutoclawCredential>
  if (typeof record.site !== 'string' || record.site === '') return undefined
  if (typeof record.accessToken !== 'string' || record.accessToken === '') return undefined
  return {
    site: record.site,
    accessToken: record.accessToken,
    ...(typeof record.refreshToken === 'string' && record.refreshToken !== ''
      ? { refreshToken: record.refreshToken }
      : {}),
    ...(typeof record.nickname === 'string' && record.nickname !== '' ? { nickname: record.nickname } : {}),
    ...(typeof record.expiresAt === 'number' ? { expiresAt: record.expiresAt } : {}),
  }
}

/** Every stored credential. */
export async function readAutoclawCredentials(): Promise<readonly AutoclawCredential[]> {
  try {
    const parsed = JSON.parse(await readFile(autoclawAccountsPath(), 'utf8')) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.map(asCredential).filter((entry): entry is AutoclawCredential => entry !== undefined)
  } catch {
    return []
  }
}

/** Write the whole list atomically, readable only by its owner. */
async function writeCredentials(credentials: readonly AutoclawCredential[]): Promise<void> {
  const target = autoclawAccountsPath()
  await mkdir(dirname(target), { recursive: true })
  const temporary = `${target}.tmp`
  await writeFile(temporary, JSON.stringify(credentials, null, 2), { encoding: 'utf8', mode: 0o600 })
  await rename(temporary, target)
}

/** Add or replace one site's credential. */
/**
 * Add or replace one credential.
 *
 * Keyed by SITE + ACCOUNT.
 *
 * The key used to be the site alone, so a second account on the same site evicted
 * the first — signing in twice left you with one account and no message saying so.
 * Now a repeated sign-in as the same person refreshes that token and a different
 * person is appended.
 *
 * An unfinished sign-in (empty token) is matched by site, so retrying does not
 * leave a row per attempt.
 */
export async function saveAutoclawCredential(credential: AutoclawCredential): Promise<void> {
  return await withStoreLock(autoclawAccountsPath(), async () => {
    const existing = await readAutoclawCredentials()
    const same = (entry: AutoclawCredential): boolean =>
      credential.accessToken === ''
        ? entry.site === credential.site && entry.accessToken === ''
        : entry.site === credential.site && entry.accessToken === credential.accessToken
    const next = existing.filter(entry => !same(entry))
    next.push(credential)
    await writeCredentials(next)
  })
}

/** Forget one site's credential. */
export async function removeAutoclawCredential(site: string): Promise<void> {
  const existing = await readAutoclawCredentials()
  await writeCredentials(existing.filter(entry => entry.site !== site))
}

/** Forget everything. */
export async function removeAllAutoclawCredentials(): Promise<void> {
  try {
    await unlink(autoclawAccountsPath())
  } catch {
    // Nothing to remove is the state the caller wanted.
  }
}

/** The credential for one site. */
export async function autoclawCredentialFor(site: string): Promise<AutoclawCredential | undefined> {
  const all = await readAutoclawCredentials()
  return all.find(entry => entry.site === site)
}

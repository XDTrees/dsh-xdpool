/**
 * Where Accio accounts live, and the routes the card talks to.
 *
 * Keyed by region: the domestic and international hosts are different services with different
 * accounts, so one file holds one entry per region.
 *
 * @module dsh-xdpool/accio-store
 */
import { inspectPaste } from './paste-guard.ts'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pluginDataDir } from './ignored.ts'
import { withStoreLock } from './store-lock.ts'
import type { AccioCredential, AccioRegion } from './accio-protocol.ts'

/** The file the credentials live in. */
const FILE = 'accio-accounts.json'

/** Absolute path of the credential file. */
export function accioAccountsPath(): string {
  return join(pluginDataDir(), FILE)
}

/** Whether a value is a usable stored credential. */
function asCredential(value: unknown): AccioCredential | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const record = value as Partial<AccioCredential>
  if (record.region !== 'cn' && record.region !== 'global') return undefined
  if (typeof record.accessToken !== 'string' || record.accessToken === '') return undefined
  return {
    region: record.region,
    accessToken: record.accessToken,
    ...(typeof record.refreshToken === 'string' && record.refreshToken !== ''
      ? { refreshToken: record.refreshToken }
      : {}),
    ...(typeof record.nickname === 'string' && record.nickname !== '' ? { nickname: record.nickname } : {}),
    ...(typeof record.expiresAt === 'number' ? { expiresAt: record.expiresAt } : {}),
  }
}

/** Every stored credential. */
export async function readAccioCredentials(): Promise<readonly AccioCredential[]> {
  try {
    const parsed = JSON.parse(await readFile(accioAccountsPath(), 'utf8')) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.map(asCredential).filter((entry): entry is AccioCredential => entry !== undefined)
  } catch {
    return []
  }
}

/** Write the whole list atomically, readable only by its owner. */
async function writeCredentials(credentials: readonly AccioCredential[]): Promise<void> {
  const target = accioAccountsPath()
  await mkdir(dirname(target), { recursive: true })
  const temporary = `${target}.tmp`
  await writeFile(temporary, JSON.stringify(credentials, null, 2), { encoding: 'utf8', mode: 0o600 })
  await rename(temporary, target)
}

/**
 * Add or replace one credential.
 *
 * Keyed by REGION + ACCOUNT, not region alone.
 *
 * It used to be `filter(entry => entry.region !== credential.region)`, which let a
 * second account in the same region evict the first: sign in twice and you had one
 * account, silently. The key is now the token — signing in again as the same person
 * refreshes their token, a different person is appended.
 *
 * Accounts with no token yet (`''`, a sign-in that has not finished) are matched by
 * region so an unfinished attempt does not pile up one row per retry.
 */
export async function saveAccioCredential(credential: AccioCredential): Promise<void> {
  return await withStoreLock(accioAccountsPath(), async () => {
    const existing = await readAccioCredentials()
    const same = (entry: AccioCredential): boolean =>
      credential.accessToken === ''
        ? entry.region === credential.region && entry.accessToken === ''
        : entry.region === credential.region && entry.accessToken === credential.accessToken
    const next = existing.filter(entry => !same(entry))
    next.push(credential)
    await writeCredentials(next)
  })
}

/**
 * Forget one credential.
 *
 * `accessToken` narrows it to a single account; omitting it removes every account
 * in that region, which is what the settings page's "sign out of this region" does.
 */
export async function removeAccioCredential(region: AccioRegion, accessToken?: string): Promise<void> {
  const existing = await readAccioCredentials()
  await writeCredentials(existing.filter(entry => (
    accessToken === undefined
      ? entry.region !== region
      : !(entry.region === region && entry.accessToken === accessToken)
  )))
}

/** Forget everything. */
export async function removeAllAccioCredentials(): Promise<void> {
  try {
    await unlink(accioAccountsPath())
  } catch {
    // Nothing to remove is the state the caller wanted.
  }
}

/** The credential a request should use. */
export async function defaultAccioCredential(): Promise<AccioCredential | undefined> {
  const all = await readAccioCredentials()
  return all[0]
}

/**
 * Pull an access token out of whatever the user pasted.
 *
 * The web app keeps its token in storage; users copy either the bare token or a JSON blob that
 * contains it.
 */
export function parseAccioCredential(input: string): {
  accessToken?: string; refreshToken?: string
} {
  const text = input.trim()
  // A paste that cannot be a credential is refused before it is stored.
  if (inspectPaste(input) !== undefined) return {}
  if (text === '') return {}
  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>
      const token = parsed['access_token'] ?? parsed['accessToken'] ?? parsed['token']
      const refresh = parsed['refresh_token'] ?? parsed['refreshToken']
      return {
        ...(typeof token === 'string' && token !== '' ? { accessToken: token } : {}),
        ...(typeof refresh === 'string' && refresh !== '' ? { refreshToken: refresh } : {}),
      }
    } catch {
      return {}
    }
  }
  return { accessToken: text }
}

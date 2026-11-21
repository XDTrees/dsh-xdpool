/**
 * Where 百智云 accounts live, and the routes the card talks to.
 *
 * @module dsh-xdpool/baizhi-store
 */
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pluginDataDir } from './ignored.ts'
import { withStoreLock } from './store-lock.ts'
import type { BaizhiCredential } from './baizhi-protocol.ts'

/** The file the credentials live in. */
const FILE = 'baizhi-accounts.json'

/** Absolute path of the credential file. */
export function baizhiAccountsPath(): string {
  return join(pluginDataDir(), FILE)
}

/** Whether a value is a usable stored credential. */
function asCredential(value: unknown): BaizhiCredential | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const record = value as Partial<BaizhiCredential>
  if (typeof record.apiKey !== 'string' || record.apiKey === '') return undefined
  return {
    apiKey: record.apiKey,
    ...(typeof record.sessionCookie === 'string' && record.sessionCookie !== ''
      ? { sessionCookie: record.sessionCookie }
      : {}),
    ...(typeof record.nickname === 'string' && record.nickname !== '' ? { nickname: record.nickname } : {}),
  }
}

/** Every stored credential. */
export async function readBaizhiCredentials(): Promise<readonly BaizhiCredential[]> {
  try {
    const parsed = JSON.parse(await readFile(baizhiAccountsPath(), 'utf8')) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.map(asCredential).filter((entry): entry is BaizhiCredential => entry !== undefined)
  } catch {
    return []
  }
}

/** Write the whole list atomically, readable only by its owner. */
async function writeCredentials(credentials: readonly BaizhiCredential[]): Promise<void> {
  const target = baizhiAccountsPath()
  await mkdir(dirname(target), { recursive: true })
  const temporary = `${target}.tmp`
  await writeFile(temporary, JSON.stringify(credentials, null, 2), { encoding: 'utf8', mode: 0o600 })
  await rename(temporary, target)
}

/** Add or replace one key. */
export async function saveBaizhiCredential(credential: BaizhiCredential): Promise<void> {
  return await withStoreLock(baizhiAccountsPath(), async () => {
    const existing = await readBaizhiCredentials()
    const next = existing.filter(entry => entry.apiKey !== credential.apiKey)
    next.push(credential)
    await writeCredentials(next)
  })
}

/** Forget one key. */
export async function removeBaizhiCredential(apiKey: string): Promise<void> {
  const existing = await readBaizhiCredentials()
  await writeCredentials(existing.filter(entry => entry.apiKey !== apiKey))
}

/** Forget everything. */
export async function removeAllBaizhiCredentials(): Promise<void> {
  try {
    await unlink(baizhiAccountsPath())
  } catch {
    // Nothing to remove is the state the caller wanted.
  }
}

/** The key a request should use. */
export async function defaultBaizhiCredential(): Promise<BaizhiCredential | undefined> {
  const all = await readBaizhiCredentials()
  return all[0]
}

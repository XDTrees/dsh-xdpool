/**
 * Where MonkeyCode accounts live, one entry per site.
 *
 * @module dsh-xdpool/monkeycode-store
 */
import { inspectPaste } from './paste-guard.ts'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pluginDataDir } from './ignored.ts'
import { withStoreLock } from './store-lock.ts'
import type { MonkeycodeCredential } from './monkeycode-protocol.ts'

/** The file the credentials live in. */
const FILE = 'monkeycode-accounts.json'

/** Absolute path of the credential file. */
export function monkeycodeAccountsPath(): string {
  return join(pluginDataDir(), FILE)
}

/** Whether a value is a usable stored credential. */
function asCredential(value: unknown): MonkeycodeCredential | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const record = value as Partial<MonkeycodeCredential>
  if (typeof record.site !== 'string' || record.site === '') return undefined
  if (typeof record.cookie !== 'string' || record.cookie === '') return undefined
  return {
    site: record.site,
    cookie: record.cookie,
    ...(typeof record.apiKey === 'string' && record.apiKey !== '' ? { apiKey: record.apiKey } : {}),
    ...(typeof record.nickname === 'string' && record.nickname !== '' ? { nickname: record.nickname } : {}),
  }
}

/** Every stored credential. */
export async function readMonkeycodeCredentials(): Promise<readonly MonkeycodeCredential[]> {
  try {
    const parsed = JSON.parse(await readFile(monkeycodeAccountsPath(), 'utf8')) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.map(asCredential).filter((entry): entry is MonkeycodeCredential => entry !== undefined)
  } catch {
    return []
  }
}

/** Write the whole list atomically, readable only by its owner. */
async function writeCredentials(credentials: readonly MonkeycodeCredential[]): Promise<void> {
  const target = monkeycodeAccountsPath()
  await mkdir(dirname(target), { recursive: true })
  const temporary = `${target}.tmp`
  await writeFile(temporary, JSON.stringify(credentials, null, 2), { encoding: 'utf8', mode: 0o600 })
  await rename(temporary, target)
}

/** Add or replace one site's credential. */
export async function saveMonkeycodeCredential(credential: MonkeycodeCredential): Promise<void> {
  return await withStoreLock(monkeycodeAccountsPath(), async () => {
    const existing = await readMonkeycodeCredentials()
    const next = existing.filter(entry => entry.site !== credential.site)
    next.push(credential)
    await writeCredentials(next)
  })
}

/** Forget one site's credential. */
export async function removeMonkeycodeCredential(site: string): Promise<void> {
  const existing = await readMonkeycodeCredentials()
  await writeCredentials(existing.filter(entry => entry.site !== site))
}

/** Forget everything. */
export async function removeAllMonkeycodeCredentials(): Promise<void> {
  try {
    await unlink(monkeycodeAccountsPath())
  } catch {
    // Nothing to remove is the state the caller wanted.
  }
}

/** The credential for one site. */
export async function monkeycodeCredentialFor(site: string): Promise<MonkeycodeCredential | undefined> {
  const all = await readMonkeycodeCredentials()
  return all.find(entry => entry.site === site)
}

/** The signing secret, which is not part of the stored shape but is needed per call. */
const secrets = new Map<string, string>()

/** Remember a site's signing secret for this process. */
export function rememberMonkeycodeSecret(site: string, secret: string): void {
  secrets.set(site, secret)
}

/** Read a site's signing secret. */
export function monkeycodeSecretFor(site: string): string | undefined {
  return secrets.get(site)
}

/**
 * Pull a session cookie out of whatever the user pasted.
 *
 * A bare cookie string, a `Cookie:` header line, and a JSON blob holding the value all appear
 * in practice.
 */
export function parseMonkeycodeCredential(input: string): { cookie?: string } {
  /**
   * A paste that cannot be a credential is refused before it is stored.
   *
   * Accepting it would fail at the vendor with `HTTP 401`, which reads as "my account
   * is broken" rather than "I pasted the wrong thing".
   */
  if (inspectPaste(input) !== undefined) return {}

  const text = input.trim()
  if (text === '') return {}
  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>
      const cookie = parsed['cookie'] ?? parsed['session'] ?? parsed['session_cookie']
      return typeof cookie === 'string' && cookie !== '' ? { cookie } : {}
    } catch {
      return {}
    }
  }
  // A `Cookie:` header line keeps its own prefix; stripping it is friendlier than refusing.
  const stripped = text.replace(/^cookie:\s*/iu, '')
  return { cookie: stripped }
}

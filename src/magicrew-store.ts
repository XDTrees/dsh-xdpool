/**
 * Magicrew 的账号存在哪里，两站各一个文件。
 *
 * 和 autoclaw / accio 一样：一个渠道一个 JSON，读-改-写走 `withStoreLock`
 * 串行化（两个渠道同时保存会互相覆盖，那是 2.7.6 修过的问题）。
 *
 * @module dsh-xdpool/magicrew-store
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pluginDataDir } from './ignored.ts'
import { withStoreLock } from './store-lock.ts'
import type { MagicrewCredential } from './magicrew-protocol.ts'

/** 一条存下来的账号。 */
export interface MagicrewAccount {
  /** 稳定 id：同一份凭据重复登录不会产生第二条。 */
  id: string
  credential: MagicrewCredential
  /** 加进池子的时刻。 */
  createdAt: number
  /** 用户关掉它之后不参与分配。 */
  enabled: boolean
}

interface FirstFile {
  version: 1
  accounts: MagicrewAccount[]
}

function fileNameOf(site: 'cn' | 'intl'): string {
  return site === 'cn' ? 'magicrew-accounts.json' : 'magicrew-intl-accounts.json'
}

export function magicrewAccountsPath(site: 'cn' | 'intl'): string {
  return join(pluginDataDir(), fileNameOf(site))
}

/**
 * 凭据的稳定指纹。
 *
 * 用 JWT 的**签名段**（第三段）而不是整条：JWT 的 header 一样、payload 一样，
 * 只有重新登录才会换签名。用它当 id，重复登录同一个账号会覆盖而不是新增。
 */
function fingerprintOf(jwt: string): string {
  const parts = jwt.split('.')
  const seed = parts.length >= 3 ? (parts[2] as string) : jwt
  let hash = 0
  for (let at = 0; at < seed.length; at += 1) hash = (hash * 31 + seed.charCodeAt(at)) >>> 0
  return hash.toString(16).padStart(8, '0')
}

export function magicrewAccountId(site: 'cn' | 'intl', jwt: string): string {
  return `${site === 'cn' ? 'magicrew' : 'magicrewintl'}-${fingerprintOf(jwt)}`
}

function asAccount(value: unknown): MagicrewAccount | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const id = record['id']
  const credential = record['credential']
  if (typeof id !== 'string' || id === '') return undefined
  if (credential === null || typeof credential !== 'object') return undefined
  const row = credential as Record<string, unknown>
  if (typeof row['jwt'] !== 'string' || row['jwt'] === '') return undefined
  return {
    id,
    credential: credential as MagicrewCredential,
    createdAt: typeof record['createdAt'] === 'number' ? record['createdAt'] : Date.now(),
    enabled: record['enabled'] !== false,
  }
}

/** 读全部账号。文件不存在或读坏了都返回空数组。 */
export async function readMagicrewAccounts(site: 'cn' | 'intl'): Promise<readonly MagicrewAccount[]> {
  try {
    const text = await readFile(magicrewAccountsPath(site), 'utf8')
    const parsed: unknown = JSON.parse(text)
    if (parsed === null || typeof parsed !== 'object') return []
    const rows = (parsed as Partial<FirstFile>).accounts
    if (!Array.isArray(rows)) return []
    return rows.map(asAccount).filter((row): row is MagicrewAccount => row !== undefined)
  } catch {
    return []
  }
}

/**
 * 写入全部账号。
 *
 * 先写临时文件再 `rename` —— 直接写目标文件时，进程被杀会留下半截 JSON，
 * 下次读到就是「一个账号都没有」。
 */
async function writeMagicrewAccounts(
  site: 'cn' | 'intl',
  accounts: readonly MagicrewAccount[],
): Promise<void> {
  const path = magicrewAccountsPath(site)
  await mkdir(dirname(path), { recursive: true })
  const document: FirstFile = { version: 1, accounts: [...accounts] }
  const temp = `${path}.${String(Date.now())}.tmp`
  await writeFile(temp, `${JSON.stringify(document, undefined, 2)}\n`, 'utf8')
  await rename(temp, path)
}

/**
 * 加一个账号（或覆盖同 id 的旧记录）。
 *
 * 返回最终的账号 —— 调用方要拿它的 id 去显示。
 */
export async function addMagicrewAccount(
  site: 'cn' | 'intl',
  credential: MagicrewCredential,
): Promise<MagicrewAccount> {
  return withStoreLock(magicrewAccountsPath(site), async () => {
    const existing = await readMagicrewAccounts(site)
    const id = magicrewAccountId(site, credential.jwt)
    const previous = existing.find(row => row.id === id)
    const account: MagicrewAccount = {
      id,
      credential,
      /* 重复登录同一个账号时保留原来的创建时间与开关状态 */
      createdAt: previous?.createdAt ?? Date.now(),
      enabled: previous?.enabled ?? true,
    }
    await writeMagicrewAccounts(site, [...existing.filter(row => row.id !== id), account])
    return account
  })
}

/** 删一个账号。 */
export async function removeMagicrewAccount(site: 'cn' | 'intl', id: string): Promise<boolean> {
  return withStoreLock(magicrewAccountsPath(site), async () => {
    const existing = await readMagicrewAccounts(site)
    const next = existing.filter(row => row.id !== id)
    if (next.length === existing.length) return false
    await writeMagicrewAccounts(site, next)
    return true
  })
}

/** 开关一个账号。 */
export async function setMagicrewAccountEnabled(
  site: 'cn' | 'intl',
  id: string,
  enabled: boolean,
): Promise<boolean> {
  return withStoreLock(magicrewAccountsPath(site), async () => {
    const existing = await readMagicrewAccounts(site)
    let touched = false
    const next = existing.map(row => {
      if (row.id !== id) return row
      touched = true
      return { ...row, enabled }
    })
    if (!touched) return false
    await writeMagicrewAccounts(site, next)
    return true
  })
}

/** 换掉一个账号的凭据（续期之后）。 */
export async function updateMagicrewCredential(
  site: 'cn' | 'intl',
  id: string,
  credential: MagicrewCredential,
): Promise<boolean> {
  return withStoreLock(magicrewAccountsPath(site), async () => {
    const existing = await readMagicrewAccounts(site)
    let touched = false
    const next = existing.map(row => {
      if (row.id !== id) return row
      touched = true
      return { ...row, credential }
    })
    if (!touched) return false
    await writeMagicrewAccounts(site, next)
    return true
  })
}

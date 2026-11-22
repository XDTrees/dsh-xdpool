/**
 * 老版本（npm 上已发布的 2.7.0 ~ 2.7.5）数据的兼容迁移。
 *
 * 审计结论（逐项对比 2.7.0 / 2.7.5 的 lib/index.js 与当前源码）：
 *
 *   - 绝大多数文件的路径和格式完全没变：aggregate.json、accounts.json、ignored.json、
 *     preferred.json、sticky-affinity.json、startup.log、channel-pack/*，读写代码逐行一致。
 *   - 唯一换了格式的是豆包：旧版只有一个 `doubao-session.json`（单会话），新版是
 *     `doubao-sessions.json`（账号列表）。`doubao-store.ts` 读的时候会把旧文件合并进来，
 *     但只要还没写过一次，新格式文件里就没有它 —— 以后哪个版本去掉了「读时合并」，
 *     这个账号就会凭空消失。所以这里把它**落盘**成新格式，旧文件原样留着。
 *   - 「下一次写盘时静默抹掉」的风险见 `data-guard.ts`，在 store.ts / doubao-store.ts 的
 *     写入口处接上。
 *
 * 规矩：
 *   - 绝不删除旧文件。迁移只新增 / 追加，旧文件保持原样（降级回 2.7.x 时它还能读）。
 *   - 幂等。跑多少次结果都一样：已经迁过的不再写。
 *   - 永不抛错。迁移失败不能挡住插件启动，原因以一行中文返回给调用方写进 startup.log。
 *
 * @module dsh-xdpool/compat-migrate
 */
import { existsSync, readFileSync } from 'node:fs'
import { readFile, rename } from 'node:fs/promises'
import { dirname } from 'node:path'
import { accountIdOf, doubaoSessionPath, doubaoSessionsPath, readStoredAccounts } from './doubao-store.ts'
import type { DoubaoSession } from './doubao-auth.ts'
import { ensureSecretDir, writeSecretFile } from './file-perms.ts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** 豆包单会话文件迁移的结果。 */
export interface DoubaoMigrationResult {
  /** 这一次真的写了新格式文件。 */
  migrated: boolean
  /** 旧文件的位置（不论存在与否）。 */
  legacyPath: string
  /** 新格式文件的位置。 */
  sessionsPath: string
  /** 这一次迁进去的账号 id。 */
  accountIds: string[]
  /** 没迁的原因。 */
  skipped?: 'no-legacy' | 'already-migrated' | 'legacy-invalid' | 'sessions-unreadable' | 'failed'
  /** 失败时的中文说明。 */
  error?: string
}

/** 新格式文件的原始行和其中已有的账号 id；文件不存在时为空，读不懂时为 undefined。 */
async function sessionRowsOnDisk(path: string): Promise<{ rows: unknown[]; ids: Set<string> } | undefined> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    return { rows: [], ids: new Set<string>() }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!Array.isArray(parsed)) return undefined
  const ids = new Set<string>()
  for (const row of parsed as unknown[]) {
    if (!isRecord(row)) continue
    const id = row['id']
    if (typeof id === 'string' && id !== '') {
      ids.add(id)
      continue
    }
    const session = row['session']
    const cookies = isRecord(session) ? session['cookies'] : undefined
    if (isRecord(cookies)) ids.add(accountIdOf(session as unknown as DoubaoSession))
  }
  return { rows: parsed as unknown[], ids }
}

/** 旧文件是不是一个合法的会话（有非空 sessionid）。 */
function legacyLooksValid(path: string): boolean {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown
    const cookies = isRecord(raw) ? raw['cookies'] : undefined
    const sessionId = isRecord(cookies) ? cookies['sessionid'] : undefined
    return typeof sessionId === 'string' && sessionId !== ''
  } catch {
    return false
  }
}

/**
 * 把 2.7.x 的 `doubao-session.json` 落盘成新的 `doubao-sessions.json` 里的一行。
 *
 * - 旧文件不动（不删、不改名），降级回 2.7.x 仍然能用；
 * - 新文件里已有的行原样保留（包括当前版本读不懂的行），只在末尾追加；
 * - 新文件存在但读不懂时什么都不写 —— 那份坏文件里可能还有别的账号，不能盖掉；
 * - 幂等：旧账号 id 已在新文件里就直接返回 already-migrated。
 */
export async function migrateDoubaoLegacySession(): Promise<DoubaoMigrationResult> {
  const legacyPath = doubaoSessionPath()
  const sessionsPath = doubaoSessionsPath()
  const accountIds: string[] = []
  if (!existsSync(legacyPath)) return { migrated: false, legacyPath, sessionsPath, accountIds, skipped: 'no-legacy' }
  try {
    const onDisk = await sessionRowsOnDisk(sessionsPath)
    if (onDisk === undefined) {
      return {
        migrated: false,
        legacyPath,
        sessionsPath,
        accountIds,
        skipped: 'sessions-unreadable',
        error: `${sessionsPath} 不是合法的账号列表，没有改动它；旧的豆包登录态仍在 ${legacyPath}`,
      }
    }
    // readStoredAccounts 会把旧文件合并进来；新文件里没有的那几个就是要落盘的。
    const merged = await readStoredAccounts()
    const missing = merged.filter(account => !onDisk.ids.has(account.id))
    if (missing.length === 0) {
      return {
        migrated: false,
        legacyPath,
        sessionsPath,
        accountIds,
        skipped: legacyLooksValid(legacyPath) ? 'already-migrated' : 'legacy-invalid',
      }
    }
    const rows: unknown[] = [...onDisk.rows, ...missing]
    await ensureSecretDir(dirname(sessionsPath))
    const temporary = `${sessionsPath}.tmp`
    await writeSecretFile(temporary, JSON.stringify(rows, null, 2))
    await rename(temporary, sessionsPath)
    for (const account of missing) accountIds.push(account.id)
    return { migrated: true, legacyPath, sessionsPath, accountIds }
  } catch (error: unknown) {
    return {
      migrated: false,
      legacyPath,
      sessionsPath,
      accountIds,
      skipped: 'failed',
      error: `豆包登录态迁移失败（${error instanceof Error ? error.message : String(error)}），旧文件 ${legacyPath} 没有改动`,
    }
  }
}

/**
 * 启动时跑一遍所有兼容迁移，返回要写进 startup.log 的说明（没做任何事时为空数组）。
 *
 * 永不抛错；每一项迁移各自吞掉自己的错误。
 */
export async function runCompatMigrations(): Promise<string[]> {
  const notes: string[] = []
  try {
    const doubao = await migrateDoubaoLegacySession()
    if (doubao.migrated) {
      notes.push(`compat: 豆包旧登录态已转成多账号格式 -> ${doubao.sessionsPath}（${doubao.accountIds.join(', ')}），旧文件保留在 ${doubao.legacyPath}`)
    } else if (doubao.error !== undefined) {
      notes.push(`compat: ${doubao.error}`)
    }
  } catch (error: unknown) {
    notes.push(`compat: 迁移异常 ${error instanceof Error ? error.message : String(error)}`)
  }
  return notes
}

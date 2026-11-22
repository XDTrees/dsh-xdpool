/**
 * 历史备份：把「立即备份」生成的加密文件留一份在插件自己的数据目录里。
 *
 * 为什么放在后端
 *
 * 以前的备份只是一次浏览器下载 —— 文件去了哪、有几份，插件一概不知道，所以备份页没法列出
 * 「历史备份」，更没法一键恢复。现在每次生成备份，卡片把**已经加密好的**信封交给这里，存到
 * `<DSH_HOME>/.xdpool/backups/`。恢复时卡片取回信封，在浏览器里用密码解开，再走原来的
 * `backup.import` —— 和从文件导入是同一条路。
 *
 * 只收密文
 *
 * 明文载荷里有每个账号的凭据。这里拒绝任何不是加密信封的东西（`format` 必须是
 * `dsh-xdpool/backup-encrypted`，且带 salt / iv / data），所以磁盘上永远只有密文；密码从不
 * 经过这里。
 *
 * 文件布局
 *
 * 每份备份一个文件：`<时间戳>-<6 位随机>.a<账号数>.json`，内容就是可直接下载的信封。
 * 账号数和时间写在文件名里，列表只需 readdir + stat，不用把几 MB 的文件逐个读出来；
 * 也没有单独的索引文件会和实际文件对不上。
 *
 * 接口（一个路径，见 `POOL_BACKUPS_PATH`）
 *
 *   GET                         → { backups: [{ id, createdAt, size, accounts }] }，新的在前
 *   GET  ?id=<id>               → { id, envelope }
 *   POST { envelope, accounts } → { backup: { id, createdAt, size, accounts } }
 *   POST { delete: <id> }       → { ok: true }
 *
 * @module dsh-xdpool/backup-store
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { readdir, readFile, rename, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { ensureSecretDir, writeSecretFile } from './file-perms.ts'
import { pluginDataDir } from './ignored.ts'
import { originTrusted, type TrustedHosts } from './origin-trust.ts'

/** 和 `client/backup-crypto.ts` 的 `ENCRYPTED_FORMAT` 一致。这里不 import 浏览器模块。 */
const ENCRYPTED_FORMAT = 'dsh-xdpool/backup-encrypted'

/** 最多留几份。再多就删最旧的 —— 每份都是全部凭据，不该无限堆在磁盘上。 */
export const MAX_BACKUPS = 30

/** 一份备份的请求体上限。设计稿示例是 2.4MB，留足余量。 */
const BODY_LIMIT = 32 * 1024 * 1024

/** 列表里的一行。 */
export interface StoredBackup {
  id: string
  /** ISO 时间。 */
  createdAt: string
  /** 字节数，等于下载下来的文件大小。 */
  size: number
  /** 生成时账号池里的账号数。 */
  accounts: number
}

const ID_PATTERN = /^\d{13}-[0-9a-f]{6}$/u
const FILE_PATTERN = /^(\d{13}-[0-9a-f]{6})\.a(\d{1,6})\.json$/u

/** 备份目录。 */
export function backupsDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(pluginDataDir(env), 'backups')
}

function isEnvelope(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return record['format'] === ENCRYPTED_FORMAT
    && typeof record['salt'] === 'string'
    && typeof record['iv'] === 'string'
    && typeof record['data'] === 'string'
}

function parseName(name: string): { id: string; accounts: number; ms: number } | undefined {
  const match = FILE_PATTERN.exec(name)
  if (match === null) return undefined
  const id = match[1]
  const accounts = Number(match[2])
  if (id === undefined || !Number.isFinite(accounts)) return undefined
  const ms = Number(id.slice(0, 13))
  if (!Number.isFinite(ms)) return undefined
  return { id, accounts, ms }
}

/** 全部历史备份，新的在前。目录不存在时是空列表。 */
export async function listBackups(dir: string = backupsDir()): Promise<StoredBackup[]> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return []
  }
  const rows: Array<StoredBackup & { ms: number }> = []
  for (const name of names) {
    const parsed = parseName(name)
    if (parsed === undefined) continue
    try {
      const info = await stat(join(dir, name))
      rows.push({
        id: parsed.id,
        createdAt: new Date(parsed.ms).toISOString(),
        size: info.size,
        accounts: parsed.accounts,
        ms: parsed.ms,
      })
    } catch {
      // 读的同时被删了：跳过这一行即可。
    }
  }
  rows.sort((a, b) => b.ms - a.ms)
  return rows.map(({ ms: _ms, ...row }) => row)
}

async function fileOf(id: string, dir: string): Promise<string | undefined> {
  if (!ID_PATTERN.test(id)) return undefined
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return undefined
  }
  const name = names.find(entry => parseName(entry)?.id === id)
  return name === undefined ? undefined : join(dir, name)
}

/** 取回一份备份的信封（密文）。 */
export async function readBackup(id: string, dir: string = backupsDir()): Promise<unknown> {
  const path = await fileOf(id, dir)
  if (path === undefined) return undefined
  return JSON.parse(await readFile(path, 'utf8')) as unknown
}

/** 存一份新备份。只收加密信封。 */
export async function saveBackup(
  envelope: unknown,
  accounts: number,
  dir: string = backupsDir(),
): Promise<StoredBackup> {
  if (!isEnvelope(envelope)) throw new Error('not an encrypted backup envelope')
  const count = Number.isFinite(accounts) && accounts >= 0 ? Math.min(Math.trunc(accounts), 999_999) : 0
  const ms = Date.now()
  const id = `${String(ms)}-${randomBytes(3).toString('hex')}`
  const text = JSON.stringify(envelope, null, 2)
  await ensureSecretDir(dir)
  const target = join(dir, `${id}.a${String(count)}.json`)
  const temp = `${target}.tmp`
  await writeSecretFile(temp, text)
  await rename(temp, target)
  // 超出上限就删最旧的。
  const all = await listBackups(dir)
  for (const extra of all.slice(MAX_BACKUPS)) {
    await deleteBackup(extra.id, dir).catch(() => false)
  }
  return { id, createdAt: new Date(ms).toISOString(), size: Buffer.byteLength(text), accounts: count }
}

/** 删一份。不存在时返回 false。 */
export async function deleteBackup(id: string, dir: string = backupsDir()): Promise<boolean> {
  const path = await fileOf(id, dir)
  if (path === undefined) return false
  await unlink(path)
  return true
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
  res.end(payload)
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > BODY_LIMIT) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim()
      if (text === '') { resolve({}); return }
      try {
        const parsed: unknown = JSON.parse(text)
        resolve(typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
          ? parsed as Record<string, unknown>
          : {})
      } catch {
        reject(new Error('invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

/** `POOL_BACKUPS_PATH` 的处理函数。由 `web-status.ts` 注册。 */
export async function handleBackupsRequest(
  req: IncomingMessage,
  res: ServerResponse,
  trustedHosts: TrustedHosts = [],
  dir: string = backupsDir(),
): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'POST') return send(res, 405, { error: 'method not allowed' })
  if (!originTrusted(req, trustedHosts)) return send(res, 403, { error: 'origin-not-trusted' })
  try {
    if (req.method === 'GET') {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const id = url.searchParams.get('id')
      if (id === null) return send(res, 200, { backups: await listBackups(dir) })
      const envelope = await readBackup(id, dir)
      if (envelope === undefined) return send(res, 404, { error: 'backup not found' })
      return send(res, 200, { id, envelope })
    }
    const body = await readBody(req)
    const toDelete = body['delete']
    if (typeof toDelete === 'string') {
      const removed = await deleteBackup(toDelete, dir)
      return send(res, removed ? 200 : 404, removed ? { ok: true } : { error: 'backup not found' })
    }
    if (!isEnvelope(body['envelope'])) {
      return send(res, 400, { error: 'expected {envelope, accounts} with an encrypted envelope' })
    }
    const accounts = typeof body['accounts'] === 'number' ? body['accounts'] : 0
    return send(res, 200, { backup: await saveBackup(body['envelope'], accounts, dir) })
  } catch (error: unknown) {
    return send(res, 500, { error: error instanceof Error ? error.message.slice(0, 300) : 'backup store failed' })
  }
}

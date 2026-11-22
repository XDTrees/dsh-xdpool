/**
 * 历史备份 —— 存在浏览器 IndexedDB 里的加密备份。
 *
 * 为什么是 IndexedDB
 *
 * 渠道包的 `backup.export` 只把载荷交给卡片，卡片加密后让浏览器下载 —— 插件后端不留任何记录，
 * 所以以前的备份页列不出「历史备份」。这里把每次生成的**加密信封**再存一份到 IndexedDB：
 *
 *   - 只存密文（`encryptBackup` 的输出），密码从不落盘；恢复时仍要输入密码在浏览器里解开，
 *     再走 `backup.import`，和从文件导入是同一条路。
 *   - localStorage 只有约 5MB 且与宿主页面共用，一份备份就可能写满；IndexedDB 容量大得多，
 *     DSH 桌面端（Electron）的配置目录里持久保存。
 *   - 最多留 {@link MAX_BACKUPS} 份，超出删最旧的 —— 每份都是全部凭据，不该无限堆积。
 *
 * 局限：换一台机器、或清掉 DSH 的浏览器数据，历史备份就没了。真正的异地保存仍是「保存到…」
 * 导出的那个文件。
 *
 * @module dsh-xdpool/client/backup-history
 */
import type { EncryptedEnvelope } from './backup-crypto.ts'

const DB_NAME = 'dsh-xdpool-backups'
const STORE = 'backups'

/** 最多留几份。 */
export const MAX_BACKUPS = 30

/** 列表里的一行（不含密文本身）。 */
export interface BackupEntry {
  id: string
  /** 生成时间，毫秒时间戳。 */
  createdAt: number
  /** 字节数，等于「保存到…」下载下来的文件大小。 */
  size: number
  /** 生成时账号池里的账号数。 */
  accounts: number
}

interface BackupRecord extends BackupEntry {
  envelope: EncryptedEnvelope
}

/** 这个环境能不能存历史备份。 */
export function historyAvailable(): boolean {
  return typeof indexedDB !== 'undefined'
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!historyAvailable()) { reject(new Error('indexedDB unavailable')); return }
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' })
    }
    request.onsuccess = () => { resolve(request.result) }
    request.onerror = () => { reject(request.error ?? new Error('indexedDB open failed')) }
  })
}

function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(db => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    const request = work(tx.objectStore(STORE))
    let value = undefined as T
    request.onsuccess = () => { value = request.result }
    tx.oncomplete = () => { db.close(); resolve(value) }
    tx.onerror = () => { db.close(); reject(tx.error ?? new Error('indexedDB transaction failed')) }
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error('indexedDB transaction aborted')) }
  }))
}

function isRecord(value: unknown): value is BackupRecord {
  if (value === null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record['id'] === 'string'
    && typeof record['createdAt'] === 'number'
    && typeof record['size'] === 'number'
    && typeof record['accounts'] === 'number'
}

/** 全部历史备份，新的在前。 */
export async function listBackups(): Promise<BackupEntry[]> {
  const all = await run<unknown[]>('readonly', store => store.getAll())
  return (Array.isArray(all) ? all : [])
    .filter(isRecord)
    .map(({ id, createdAt, size, accounts }) => ({ id, createdAt, size, accounts }))
    .sort((a, b) => b.createdAt - a.createdAt)
}

/** 存一份新备份（只收加密信封），超出上限删最旧的。 */
export async function saveBackup(envelope: EncryptedEnvelope, accounts: number, size: number): Promise<BackupEntry> {
  const createdAt = Date.now()
  const id = `${String(createdAt)}-${Math.random().toString(16).slice(2, 8)}`
  const entry: BackupEntry = {
    id,
    createdAt,
    size: Number.isFinite(size) ? size : 0,
    accounts: Number.isFinite(accounts) ? Math.max(0, Math.trunc(accounts)) : 0,
  }
  const record: BackupRecord = { ...entry, envelope }
  await run('readwrite', store => store.put(record))
  const all = await listBackups()
  for (const extra of all.slice(MAX_BACKUPS)) {
    await deleteBackup(extra.id).catch(() => undefined)
  }
  return entry
}

/** 取回一份备份的密文，作为和导出文件一模一样的 JSON 文本。 */
export async function readBackupText(id: string): Promise<string> {
  const record = await run<unknown>('readonly', store => store.get(id))
  if (!isRecord(record)) throw new Error('backup not found')
  return JSON.stringify(record.envelope, null, 2)
}

/** 删一份。 */
export async function deleteBackup(id: string): Promise<void> {
  await run('readwrite', store => store.delete(id))
}

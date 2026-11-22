/**
 * 防止「下一次写盘时静默抹掉用户数据」的两个小工具。
 *
 * 背景（兼容性审计时发现，2.7.x 起就存在）：各个 store 读到坏 JSON 时一律当成「什么都没有」，
 * 紧接着的一次保存就用一份几乎为空的新文件把它盖掉；aggregate.json 里注册表不认识的厂商 id、
 * 当前版本不认识的顶层字段，也会在下一次保存时被 normalize 丢掉。
 *
 * 单独成一个模块、只依赖 node:fs，是为了让 store.ts / doubao-store.ts / compat-migrate.ts
 * 都能用它而不形成循环引用。
 *
 * @module dsh-xdpool/data-guard
 */
import { copyFileSync, existsSync, readFileSync } from 'node:fs'

/**
 * 覆盖一个 JSON 文件之前调用：文件在、内容非空、却不是合法 JSON 时，原样另存为
 * `<path>.unreadable-<毫秒时间戳>`，返回另存的路径。
 *
 * 文件不存在、是合法 JSON、或是空文件时什么都不做，返回 undefined。永不抛错。
 * 同一毫秒重复调用不会覆盖已有的另存文件。
 */
export function preserveUnreadableJson(path: string, now: number = Date.now()): string | undefined {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
  if (text.trim() === '') return undefined
  try {
    JSON.parse(text)
    return undefined
  } catch {
    // 读不懂：往下另存。
  }
  const target = `${path}.unreadable-${String(now)}`
  try {
    if (!existsSync(target)) copyFileSync(path, target)
    return target
  } catch {
    return undefined
  }
}

/** aggregate.json 里当前版本认识的顶层字段。 */
export const KNOWN_AGGREGATE_FIELDS: readonly string[] = ['version', 'enabled', 'providers', 'combos', 'relay']

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * 读磁盘上的 JSON 原文（不做任何 normalize）；不存在或读不懂时返回 undefined。永不抛错。
 */
export function readRawJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch {
    return undefined
  }
}

/**
 * 把磁盘上那份 aggregate.json 里「当前版本不认识」的东西带进即将写入的文档。
 *
 * 两类：
 *   1. `providers` 下注册表里没有的厂商 id —— normalizeStore 读的时候会跳过它们，下一次
 *      保存就永久丢了那家的 API Key。注册表改名 / 下架一家厂商时就会发生。
 *   2. 不认识的顶层字段 —— 更新的版本写过、用户又降级回来时会遇到。
 *
 * 认识的字段一律以 `next` 为准（用户刚做的修改，包括删除），这里只补、不改。
 * 返回新对象，不修改入参。
 */
export function carryUnknownAggregateEntries(
  onDisk: unknown,
  next: Readonly<Record<string, unknown>>,
  isKnownProvider: (id: string) => boolean,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...next }
  if (!isRecord(onDisk)) return out
  for (const [key, value] of Object.entries(onDisk)) {
    if (KNOWN_AGGREGATE_FIELDS.includes(key)) continue
    if (Object.hasOwn(out, key)) continue
    out[key] = value
  }
  const diskProviders = onDisk['providers']
  if (isRecord(diskProviders)) {
    const unknown = Object.entries(diskProviders).filter(([id]) => !isKnownProvider(id))
    if (unknown.length > 0) {
      const currentProviders = out['providers']
      const merged: Record<string, unknown> = isRecord(currentProviders) ? { ...currentProviders } : {}
      for (const [id, value] of unknown) {
        if (!Object.hasOwn(merged, id)) merged[id] = value
      }
      out['providers'] = merged
    }
  }
  return out
}

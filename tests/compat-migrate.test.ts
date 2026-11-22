/**
 * 老用户（npm 上的 2.7.0 ~ 2.7.5）升级到当前版本时，数据能被读到、不会在下一次保存时丢。
 *
 * 输入都是 2.7.5 真实写出的格式（从已发布的 lib/index.js 里的写入代码还原）：
 *   - aggregate.json：`{ version: 1, enabled, providers, combos, relay }`
 *   - doubao-session.json：单个会话 `{ cookies, userAgent, savedAt }`
 *
 * 全部在临时目录里跑（DSH_HOME 指向 mkdtemp），不碰用户真实数据。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  clearProviderSetting,
  readAggregateSettings,
  setAggregateEnabled,
  updateProviderSetting,
} from '../src/store.ts'
import { readStoredAccounts, writeStoredAccount } from '../src/doubao-store.ts'
import { migrateDoubaoLegacySession, runCompatMigrations } from '../src/compat-migrate.ts'
import { carryUnknownAggregateEntries, preserveUnreadableJson } from '../src/data-guard.ts'

/** 2.7.5 写出的 aggregate.json（两家真实厂商 + 一条路由链 + 局域网网关）。 */
const AGGREGATE_275 = {
  version: 1,
  enabled: true,
  providers: {
    open_router: {
      enabled: true,
      apiKey: 'sk-or-v1-aaaa',
      apiKeys: ['sk-or-v1-aaaa', 'sk-or-v1-bbbb'],
      distribution: 'round-robin',
      models: ['deepseek/deepseek-chat-v3-0324:free'],
      addedAt: '2026-10-01T08:00:00.000Z',
    },
    deepinfra: {
      apiKey: 'di-cccc',
      baseUrl: 'https://api.deepinfra.com/v1/openai',
      discovered: ['meta-llama/Llama-3.3-70B-Instruct'],
      addedAt: '2026-10-02T08:00:00.000Z',
    },
  },
  combos: [
    {
      id: 'combo:写作',
      name: '写作',
      models: ['hy3', 'open_router/deepseek/deepseek-chat-v3-0324:free'],
      platforms: [
        { owner: 'workbuddy', models: ['hy3'] },
        { owner: 'open_router', models: ['deepseek/deepseek-chat-v3-0324:free'] },
      ],
      strategy: 'fallback',
      stickyLimit: 1,
      enabled: true,
    },
  ],
  relay: { enabled: false, host: '127.0.0.1', port: 18790, key: 'relay-secret-key', models: [] },
}

/** 2.7.5 写出的 doubao-session.json。 */
const DOUBAO_275 = {
  cookies: { sessionid: 'legacy-session-0123456789', uin: '900', sid_guard: 'g' },
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/147.0.0.0 SamanthaDoubao/2.31.4',
  savedAt: '2026-10-05T12:00:00.000Z',
}

let home: string
let data: string
let savedHome: string | undefined

beforeEach(() => {
  savedHome = process.env['DSH_HOME']
  home = mkdtempSync(join(tmpdir(), 'xdpool-compat-'))
  process.env['DSH_HOME'] = home
  data = join(home, '.xdpool')
  mkdirSync(data, { recursive: true })
})

afterEach(() => {
  if (savedHome === undefined) delete process.env['DSH_HOME']
  else process.env['DSH_HOME'] = savedHome
  rmSync(home, { recursive: true, force: true })
})

function put(name: string, value: unknown): string {
  const path = join(data, name)
  writeFileSync(path, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  return path
}

function raw(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(data, name), 'utf8')) as Record<string, unknown>
}

describe('2.7.5 的 aggregate.json 原样可读', () => {
  it('API Key（含多 key）、路由链、局域网网关全部读得到', async () => {
    put('aggregate.json', AGGREGATE_275)
    const store = await readAggregateSettings()
    expect(store.enabled).toBe(true)
    expect(store.providers).toEqual(AGGREGATE_275.providers)
    expect(store.relay).toEqual(AGGREGATE_275.relay)
    expect(store.combos).toHaveLength(1)
    expect(store.combos?.[0]).toMatchObject({
      id: 'combo:写作',
      name: '写作',
      models: ['hy3', 'open_router/deepseek/deepseek-chat-v3-0324:free'],
      strategy: 'fallback',
      enabled: true,
    })
  })

  it('改一家厂商之后，其他厂商、路由链和网关一个字段都不少', async () => {
    put('aggregate.json', AGGREGATE_275)
    await updateProviderSetting('open_router', { enabled: false })
    const after = raw('aggregate.json')
    const providers = after['providers'] as Record<string, Record<string, unknown>>
    expect(providers['open_router']?.['enabled']).toBe(false)
    expect(providers['open_router']?.['apiKeys']).toEqual(['sk-or-v1-aaaa', 'sk-or-v1-bbbb'])
    expect(providers['deepinfra']).toEqual(AGGREGATE_275.providers.deepinfra)
    expect(after['relay']).toEqual(AGGREGATE_275.relay)
    expect((after['combos'] as unknown[])).toHaveLength(1)
  })
})

describe('下一次保存不再静默抹掉不认识的数据', () => {
  it('注册表里没有的厂商的 key 被原样带回去', async () => {
    put('aggregate.json', {
      ...AGGREGATE_275,
      providers: { ...AGGREGATE_275.providers, some_vendor_renamed_later: { apiKey: 'sk-keep-me', enabled: true } },
    })
    await updateProviderSetting('open_router', { enabled: false })
    const providers = raw('aggregate.json')['providers'] as Record<string, unknown>
    expect(providers['some_vendor_renamed_later']).toEqual({ apiKey: 'sk-keep-me', enabled: true })
    // 读的一侧依然看不见它（注册表不认识的厂商不该出现在页面上）。
    const store = await readAggregateSettings()
    expect(Object.keys(store.providers ?? {})).not.toContain('some_vendor_renamed_later')
  })

  it('更新版本写的顶层字段被原样带回去', async () => {
    put('aggregate.json', { ...AGGREGATE_275, futureField: { a: 1 } })
    await setAggregateEnabled(false)
    const after = raw('aggregate.json')
    expect(after['futureField']).toEqual({ a: 1 })
    expect(after['enabled']).toBe(false)
  })

  it('认识的字段以本次修改为准：删除就是删除', async () => {
    put('aggregate.json', {
      ...AGGREGATE_275,
      providers: { ...AGGREGATE_275.providers, some_vendor_renamed_later: { apiKey: 'sk-keep-me' } },
    })
    await clearProviderSetting('deepinfra')
    const providers = raw('aggregate.json')['providers'] as Record<string, unknown>
    expect(providers['deepinfra']).toBeUndefined()
    expect(providers['open_router']).toBeDefined()
    expect(providers['some_vendor_renamed_later']).toEqual({ apiKey: 'sk-keep-me' })
  })

  it('读不懂的 aggregate.json 在被覆盖前另存一份', async () => {
    const broken = '{"version":1,"providers":{"open_router":{"apiKey":"sk-half-written'
    put('aggregate.json', broken)
    await setAggregateEnabled(true)
    const copies = readdirSync(data).filter(name => name.startsWith('aggregate.json.unreadable-'))
    expect(copies).toHaveLength(1)
    expect(readFileSync(join(data, copies[0] ?? ''), 'utf8')).toBe(broken)
    expect(raw('aggregate.json')['enabled']).toBe(true)
  })

  it('正常文件保存时不会多出另存副本', async () => {
    put('aggregate.json', AGGREGATE_275)
    await setAggregateEnabled(false)
    expect(readdirSync(data).filter(name => name.includes('.unreadable-'))).toEqual([])
  })

  it('读不懂的豆包账号列表在被覆盖前另存一份', async () => {
    put('doubao-sessions.json', '[{"id":"uin-1","session":')
    await writeStoredAccount({ cookies: { sessionid: 'new-session', uin: '2' }, userAgent: 'UA', savedAt: '' })
    const copies = readdirSync(data).filter(name => name.startsWith('doubao-sessions.json.unreadable-'))
    expect(copies).toHaveLength(1)
    expect(readFileSync(join(data, copies[0] ?? ''), 'utf8')).toBe('[{"id":"uin-1","session":')
  })
})

describe('data-guard 的边界', () => {
  it('不存在、合法、空文件都不另存', () => {
    expect(preserveUnreadableJson(join(data, 'missing.json'))).toBeUndefined()
    expect(preserveUnreadableJson(put('ok.json', { a: 1 }))).toBeUndefined()
    expect(preserveUnreadableJson(put('empty.json', ''))).toBeUndefined()
    expect(readdirSync(data).filter(name => name.includes('.unreadable-'))).toEqual([])
  })

  it('carryUnknownAggregateEntries 只补不改', () => {
    const next = carryUnknownAggregateEntries(
      { version: 1, enabled: true, extra: 1, providers: { known: { apiKey: 'old' }, ghost: { apiKey: 'g' } } },
      { version: 1, enabled: false, providers: { known: { apiKey: 'new' } } },
      id => id === 'known',
    )
    expect(next).toEqual({ version: 1, enabled: false, extra: 1, providers: { known: { apiKey: 'new' }, ghost: { apiKey: 'g' } } })
  })
})

describe('豆包：2.7.x 的单会话文件落盘成多账号格式', () => {
  it('迁移后新文件里有它，旧文件一个字节都没变', async () => {
    const legacy = put('doubao-session.json', DOUBAO_275)
    const before = readFileSync(legacy, 'utf8')
    const result = await migrateDoubaoLegacySession()
    expect(result.migrated).toBe(true)
    expect(result.accountIds).toEqual(['uin-900'])
    const rows = JSON.parse(readFileSync(join(data, 'doubao-sessions.json'), 'utf8')) as { id: string; session: { cookies: Record<string, string> } }[]
    expect(rows.map(row => row.id)).toEqual(['uin-900'])
    expect(rows[0]?.session.cookies['sessionid']).toBe('legacy-session-0123456789')
    expect(existsSync(legacy)).toBe(true)
    expect(readFileSync(legacy, 'utf8')).toBe(before)
  })

  it('幂等：第二次什么都不写', async () => {
    put('doubao-session.json', DOUBAO_275)
    await migrateDoubaoLegacySession()
    const first = readFileSync(join(data, 'doubao-sessions.json'), 'utf8')
    const again = await migrateDoubaoLegacySession()
    expect(again.migrated).toBe(false)
    expect(again.skipped).toBe('already-migrated')
    expect(readFileSync(join(data, 'doubao-sessions.json'), 'utf8')).toBe(first)
    // 读出来也不会重复。
    expect((await readStoredAccounts()).map(account => account.id)).toEqual(['uin-900'])
  })

  it('新文件里已有的行（包括读不懂的行）原样保留，只在末尾追加', async () => {
    put('doubao-session.json', DOUBAO_275)
    const existing = [
      { id: 'uin-111', session: { cookies: { sessionid: 'aaa', uin: '111' }, userAgent: 'UA', savedAt: 'x' }, savedAt: 'x' },
      { id: 'written-by-a-newer-build', future: true },
    ]
    put('doubao-sessions.json', existing)
    const result = await migrateDoubaoLegacySession()
    expect(result.migrated).toBe(true)
    const rows = JSON.parse(readFileSync(join(data, 'doubao-sessions.json'), 'utf8')) as unknown[]
    expect(rows.slice(0, 2)).toEqual(existing)
    expect((rows[2] as { id: string }).id).toBe('uin-900')
  })

  it('新文件读不懂时不覆盖它，也不动旧文件', async () => {
    put('doubao-session.json', DOUBAO_275)
    put('doubao-sessions.json', '{not json')
    const result = await migrateDoubaoLegacySession()
    expect(result.migrated).toBe(false)
    expect(result.skipped).toBe('sessions-unreadable')
    expect(result.error).toMatch(/[\u4e00-\u9fff]/u)
    expect(readFileSync(join(data, 'doubao-sessions.json'), 'utf8')).toBe('{not json')
    expect(existsSync(join(data, 'doubao-session.json'))).toBe(true)
  })

  it('没有旧文件 / 旧文件不是合法会话时什么都不做', async () => {
    expect((await migrateDoubaoLegacySession()).skipped).toBe('no-legacy')
    put('doubao-session.json', { cookies: {}, userAgent: 'UA' })
    expect((await migrateDoubaoLegacySession()).skipped).toBe('legacy-invalid')
    expect(existsSync(join(data, 'doubao-sessions.json'))).toBe(false)
  })

  it('启动入口返回一行中文说明', async () => {
    put('doubao-session.json', DOUBAO_275)
    const notes = await runCompatMigrations()
    expect(notes).toHaveLength(1)
    expect(notes[0]).toContain('豆包')
    expect(await runCompatMigrations()).toEqual([])
  })
})

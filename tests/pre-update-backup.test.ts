/**
 * 更新前自动备份 + 回退。
 *
 * 全部在 mkdtemp 临时目录里：DSH_HOME、profile、假的用户主目录都是临时的，网络用 stub 的
 * fetch 代替，不碰用户真实数据，也不访问 npm。
 *
 * 数据样例是 2.7.5 真实写出的文件格式（aggregate.json / accounts.json / ignored.json /
 * preferred.json / sticky-affinity.json / doubao-session.json / 导入的 .info 快照 /
 * channel-pack 的 state.json 和 token-ledger.json / 宿主 settings.yaml）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { gzipSync } from 'node:zlib'
import {
  backupBeforeUpdate,
  listPreUpdateBackups,
  PRE_UPDATE_KEEP,
  pruneOldBackups,
  RESTORE_FILE_NAME,
  ROLLBACK_NOTE_NAME,
  rollbackPackageSpec,
  type RestoreManifest,
} from '../src/pre-update-backup.ts'
import { installVersion } from '../src/update-install.ts'
import { POOL_VERSION } from '../src/version.ts'

/** 2.7.5 在 <DSH_HOME>/.xdpool 下写的文件。 */
const DATA_FILES: Record<string, string> = {
  'aggregate.json': JSON.stringify({
    version: 1,
    enabled: true,
    providers: { open_router: { enabled: true, apiKey: 'sk-or-v1-aaaa', addedAt: '2026-10-01T08:00:00.000Z' } },
    combos: [{ id: 'combo:写作', name: '写作', models: ['hy3'], strategy: 'fallback', stickyLimit: 1, enabled: true }],
    relay: { enabled: true, host: '0.0.0.0', port: 18790, key: 'relay-secret' },
  }, null, 2),
  'accounts.json': JSON.stringify({
    version: 1,
    accounts: [{
      id: '0123456789abcdef',
      label: '小明#12345678',
      credential: { accessToken: 'at-xxx', refreshToken: 'rt-yyy', uin: '12345678', domain: 'copilot.tencent.com' },
      savedAtMs: 1_790_000_000_000,
    }],
  }, null, 2),
  'ignored.json': JSON.stringify({ version: 1, accounts: [{ id: 'deadbeefdeadbeef', label: '旧号', ignoredAt: '2026-09-01T00:00:00.000Z' }] }, null, 2),
  'preferred.json': JSON.stringify({ version: 1, accountId: '0123456789abcdef' }, null, 2),
  'sticky-affinity.json': JSON.stringify({ version: 1, bindings: { 'conv-1': '0123456789abcdef' } }, null, 2),
  'doubao-session.json': JSON.stringify({ cookies: { sessionid: 'sid-123', uin: '900' }, userAgent: 'UA', savedAt: '2026-10-05T12:00:00.000Z' }),
  'startup.log': '2026-11-01T00:00:00.000Z apply entered host=desktop\n',
  '3f2a9c1d.info': '{"account":{"uin":"555"},"accessToken":"x","refreshToken":"y"}',
}

/** channel-pack 在 <DSH_HOME>/channel-pack 下写的文件。 */
const PACK_FILES: Record<string, string> = {
  'state.json': JSON.stringify({ accounts: [{ provider: 'trae', id: 'a1', credential: { token: 't' } }], disabledModels: {} }),
  'token-ledger.json': JSON.stringify({ days: { '2026-11-20': { 'direct|trae|a1|m': { input: 10, output: 20 } } } }),
  'dead-models.json': JSON.stringify({ trae: ['old-model'] }),
}

const SETTINGS_YAML = [
  'llm-xdpool:',
  '  distribution: sticky',
  '  creditReserves:',
  '    0123456789abcdef: 50',
  '  automation:',
  '    enabled: true',
  '    checkinHours: [9]',
  '',
].join('\n')

interface World {
  root: string
  home: string
  dsh: string
  data: string
  profile: string
  env: NodeJS.ProcessEnv
}

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text, 'utf8')
}

function makeWorld(options: { dshHomeSet?: boolean; spec?: string } = {}): World {
  const root = mkdtempSync(join(tmpdir(), 'xdpool-preupdate-'))
  const home = join(root, 'user-home')
  const dshHomeSet = options.dshHomeSet ?? true
  const dsh = dshHomeSet ? join(root, 'dsh-home') : join(home, '.dsh')
  const data = join(dsh, '.xdpool')
  const profile = join(dsh, 'profiles', 'desktop')
  for (const [name, text] of Object.entries(DATA_FILES)) write(join(data, name), text)
  write(join(data, 'backups', '1790000000000-abcdef.a3.json'), '{"format":"dsh-xdpool/backup-encrypted"}')
  // 不该进备份的：临时浏览器配置、写到一半的 .tmp。
  write(join(data, 'login-profiles', 'marvis-1', 'Default', 'Cookies'), 'chrome-cookies')
  write(join(data, 'aggregate.json.tmp'), 'half')
  for (const [name, text] of Object.entries(PACK_FILES)) write(join(dsh, 'channel-pack', name), text)
  write(join(profile, 'package.json'), `${JSON.stringify({
    name: 'dsh-profile-desktop',
    private: true,
    dependencies: { 'dsh-xdpool': options.spec ?? '2.7.5', 'some-other-plugin': '1.0.0' },
  }, null, 2)}\n`)
  write(join(profile, 'settings.yaml'), SETTINGS_YAML)
  const env: NodeJS.ProcessEnv = dshHomeSet ? { DSH_HOME: dsh } : {}
  return { root, home, dsh, data, profile, env }
}

function manifestOf(dir: string): RestoreManifest {
  return JSON.parse(readFileSync(join(dir, RESTORE_FILE_NAME), 'utf8')) as RestoreManifest
}

const worlds: string[] = []
afterEach(() => {
  for (const root of worlds.splice(0)) rmSync(root, { recursive: true, force: true })
})
function world(options: { dshHomeSet?: boolean; spec?: string } = {}): World {
  const made = makeWorld(options)
  worlds.push(made.root)
  return made
}

describe('backupBeforeUpdate', () => {
  it('把 2.7.5 的全部数据原样复制到 <数据目录>/pre-update/<旧版本>-<时间>/', () => {
    const w = world()
    const result = backupBeforeUpdate({
      profileDir: w.profile,
      previousVersion: '2.7.5',
      targetVersion: '2.7.6',
      previousSpecs: { dependencies: '2.7.5' },
      newSpec: 'file:C:/Temp/dsh-xdpool-2.7.6.tgz',
      env: w.env,
      home: w.home,
      now: new Date('2026-11-22T04:37:00.000Z'),
    })
    expect(result.ok, result.error).toBe(true)
    const dir = result.path ?? ''
    expect(dir).toBe(join(w.data, 'pre-update', '2.7.5-2026-11-22T04-37-00-000Z'))
    for (const [name, text] of Object.entries(DATA_FILES)) {
      expect(readFileSync(join(dir, 'xdpool', name), 'utf8'), name).toBe(text)
    }
    expect(existsSync(join(dir, 'xdpool', 'backups', '1790000000000-abcdef.a3.json'))).toBe(true)
    for (const [name, text] of Object.entries(PACK_FILES)) {
      expect(readFileSync(join(dir, 'channel-pack@dsh-home', name), 'utf8'), name).toBe(text)
    }
    expect(readFileSync(join(dir, 'profile', 'settings.yaml'), 'utf8')).toBe(SETTINGS_YAML)
    expect(readFileSync(join(dir, 'profile', 'package.json'), 'utf8'))
      .toBe(readFileSync(join(w.profile, 'package.json'), 'utf8'))
    // 跳过的东西确实没进来，备份也不会把自己复制进自己。
    expect(existsSync(join(dir, 'xdpool', 'login-profiles'))).toBe(false)
    expect(existsSync(join(dir, 'xdpool', 'pre-update'))).toBe(false)
    expect(existsSync(join(dir, 'xdpool', 'aggregate.json.tmp'))).toBe(false)
  })

  it('restore.json 记下原 spec、旧版本号和时间，回退说明.txt 是中文', () => {
    const w = world()
    const result = backupBeforeUpdate({
      profileDir: w.profile,
      previousVersion: '2.7.5',
      targetVersion: '2.7.6',
      previousSpecs: { dependencies: '2.7.5' },
      newSpec: 'file:C:/Temp/dsh-xdpool-2.7.6.tgz',
      env: w.env,
      home: w.home,
      now: new Date('2026-11-22T04:37:00.000Z'),
    })
    const manifest = manifestOf(result.path ?? '')
    expect(manifest).toMatchObject({
      package: 'dsh-xdpool',
      previousVersion: '2.7.5',
      targetVersion: '2.7.6',
      previousSpec: '2.7.5',
      previousSpecs: { dependencies: '2.7.5' },
      rollbackSpec: '2.7.5',
      newSpec: 'file:C:/Temp/dsh-xdpool-2.7.6.tgz',
      createdAt: '2026-11-22T04:37:00.000Z',
      packageJsonPath: join(w.profile, 'package.json'),
    })
    expect(manifest.entries.map(entry => entry.label)).toEqual(['xdpool', 'channel-pack@dsh-home', 'profile'])
    expect(manifest.files).toBeGreaterThan(10)
    const note = readFileSync(join(result.path ?? '', ROLLBACK_NOTE_NAME), 'utf8')
    expect(note).toContain('回退')
    expect(note).toContain('2.7.5')
  })

  it('原数据一个字节都不改', () => {
    const w = world()
    backupBeforeUpdate({
      profileDir: w.profile, previousVersion: '2.7.5', targetVersion: '2.7.6',
      previousSpecs: { dependencies: '2.7.5' }, env: w.env, home: w.home,
    })
    for (const [name, text] of Object.entries(DATA_FILES)) {
      expect(readFileSync(join(w.data, name), 'utf8')).toBe(text)
    }
  })

  it('没设 DSH_HOME 时 aggregate.json 在 ~/.xdpool（store.ts 一直如此），那一份也备份', () => {
    const w = world({ dshHomeSet: false })
    write(join(w.home, '.xdpool', 'aggregate.json'), '{"version":1,"providers":{"open_router":{"apiKey":"sk-home"}}}')
    const result = backupBeforeUpdate({
      profileDir: w.profile, previousVersion: '2.7.5', targetVersion: '2.7.6',
      previousSpecs: { dependencies: '2.7.5' }, env: w.env, home: w.home,
    })
    expect(result.ok, result.error).toBe(true)
    expect(result.path?.startsWith(join(w.home, '.dsh', '.xdpool', 'pre-update'))).toBe(true)
    expect(readFileSync(join(result.path ?? '', 'home-xdpool', 'aggregate.json'), 'utf8')).toContain('sk-home')
    expect(readFileSync(join(result.path ?? '', 'xdpool', 'accounts.json'), 'utf8')).toBe(DATA_FILES['accounts.json'])
  })

  it('原 spec 是本地 .tgz 时把它也复制进来，回退用备份里那份', () => {
    const w = world()
    const tarball = join(w.root, 'Temp', 'dsh-xdpool-2.7.5.tgz')
    write(tarball, 'old-tarball-bytes')
    const spec = `file:${tarball.replaceAll('\\', '/')}`
    const result = backupBeforeUpdate({
      profileDir: w.profile, previousVersion: '2.7.5', targetVersion: '2.7.6',
      previousSpecs: { dependencies: spec }, env: w.env, home: w.home,
    })
    const manifest = manifestOf(result.path ?? '')
    expect(manifest.previousSpec).toBe(spec)
    expect(manifest.previousTarball).toBe(join(result.path ?? '', 'previous-package', 'dsh-xdpool-2.7.5.tgz'))
    expect(readFileSync(manifest.previousTarball ?? '', 'utf8')).toBe('old-tarball-bytes')
    expect(manifest.rollbackSpec).toBe(`file:${(manifest.previousTarball ?? '').replaceAll('\\', '/')}`)
  })

  it('复制失败就返回中文原因，并删掉写了一半的备份目录', () => {
    const w = world()
    // 备份根目录被一个同名文件占着：mkdir 一定失败。
    write(join(w.data, 'pre-update'), 'not a directory')
    const result = backupBeforeUpdate({
      profileDir: w.profile, previousVersion: '2.7.5', targetVersion: '2.7.6',
      previousSpecs: { dependencies: '2.7.5' }, env: w.env, home: w.home,
    })
    expect(result.ok).toBe(false)
    expect(result.path).toBeUndefined()
    expect(result.error).toMatch(/更新前备份失败/u)
    expect(result.error).toMatch(/已取消更新/u)
    expect(readFileSync(join(w.data, 'pre-update'), 'utf8')).toBe('not a directory')
  })
})

describe('只保留最近 5 份', () => {
  function fakeBackup(root: string, name: string, createdAt: string): string {
    const dir = join(root, name)
    write(join(dir, RESTORE_FILE_NAME), JSON.stringify({ package: 'dsh-xdpool', format: 1, createdAt, previousVersion: name, targetVersion: 'x' }))
    return dir
  }

  it('删最旧的，只删自己建的目录', () => {
    const w = world()
    const root = join(w.data, 'pre-update')
    const made: string[] = []
    for (let day = 1; day <= 7; day += 1) {
      made.push(fakeBackup(root, `2.7.${String(day)}-x`, `2026-11-0${String(day)}T00:00:00.000Z`))
    }
    write(join(root, 'user-notes', 'keep.txt'), '用户自己放的')
    write(join(root, 'stray-file.txt'), 'x')
    const removed = pruneOldBackups(root)
    expect(removed.sort()).toEqual([made[0], made[1]].sort())
    expect(listPreUpdateBackups(root)).toHaveLength(PRE_UPDATE_KEEP)
    expect(existsSync(join(root, 'user-notes', 'keep.txt'))).toBe(true)
    expect(existsSync(join(root, 'stray-file.txt'))).toBe(true)
  })

  it('刚建的那一份无论排第几都不删', () => {
    const w = world()
    const root = join(w.data, 'pre-update')
    const made: string[] = []
    for (let day = 1; day <= 7; day += 1) {
      made.push(fakeBackup(root, `2.7.${String(day)}-x`, `2026-11-0${String(day)}T00:00:00.000Z`))
    }
    const oldest = made[0] ?? ''
    pruneOldBackups(root, PRE_UPDATE_KEEP, oldest)
    const left = listPreUpdateBackups(root).map(backup => backup.path)
    expect(left).toHaveLength(PRE_UPDATE_KEEP)
    expect(left).toContain(oldest)
  })
})

describe('rollbackPackageSpec', () => {
  it('把 package.json 里的 dsh-xdpool 改回更新前的 spec，别的依赖不动', () => {
    const w = world()
    const result = backupBeforeUpdate({
      profileDir: w.profile, previousVersion: '2.7.5', targetVersion: '2.7.6',
      previousSpecs: { dependencies: '2.7.5' }, env: w.env, home: w.home,
    })
    const pkgPath = join(w.profile, 'package.json')
    const updated = JSON.parse(readFileSync(pkgPath, 'utf8')) as { dependencies: Record<string, string> }
    updated.dependencies['dsh-xdpool'] = 'file:C:/Temp/dsh-xdpool-2.7.6.tgz'
    writeFileSync(pkgPath, JSON.stringify(updated), 'utf8')
    const rollback = rollbackPackageSpec(result.path ?? '')
    expect(rollback).toEqual({ ok: true, spec: '2.7.5', restartRequired: true })
    const after = JSON.parse(readFileSync(pkgPath, 'utf8')) as { dependencies: Record<string, string> }
    expect(after.dependencies).toEqual({ 'dsh-xdpool': '2.7.5', 'some-other-plugin': '1.0.0' })
  })

  it('目录里没有 restore.json 时给中文错误', () => {
    const w = world()
    const rollback = rollbackPackageSpec(join(w.root, 'nowhere'))
    expect(rollback.ok).toBe(false)
    expect(rollback.error).toMatch(/无法回退/u)
  })
})

describe('installVersion：下载 → 校验 → 备份 → 写入', () => {
  const saved: Record<string, string | undefined> = {}
  const KEYS = ['DSH_HOME', 'DSH_PROFILE_DIR', 'DSH_CHANNEL_PACK_STATE_DIR'] as const
  let version = ''

  beforeEach(() => {
    for (const key of KEYS) saved[key] = process.env[key]
    version = `0.0.0-compat-test-${String(Date.now())}-${String(Math.floor(Math.random() * 1e6))}`
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    for (const key of KEYS) {
      const value = saved[key]
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    rmSync(join(tmpdir(), `dsh-xdpool-${version}.tgz`), { force: true })
    rmSync(join(tmpdir(), `dsh-xdpool-${version}.tgz.part`), { force: true })
  })

  function point(w: World): void {
    process.env['DSH_HOME'] = w.dsh
    process.env['DSH_PROFILE_DIR'] = w.profile
    delete process.env['DSH_CHANNEL_PACK_STATE_DIR']
  }

  function serve(body: Uint8Array | string, status = 200): void {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status })))
  }

  it('成功时四步都打勾，返回备份目录和旧版本号，package.json 指向新包', async () => {
    const w = world()
    point(w)
    serve(gzipSync(Buffer.from('fake tarball')))
    const result = await installVersion(version)
    expect(result.ok, result.error).toBe(true)
    expect(result.restartRequired).toBe(true)
    expect(result.previousVersion).toBe(POOL_VERSION)
    expect(result.steps?.map(step => [step.id, step.ok])).toEqual([
      ['download', true], ['verify', true], ['backup', true], ['write', true],
    ])
    const backupPath = result.backupPath ?? ''
    expect(backupPath.startsWith(join(w.data, 'pre-update'))).toBe(true)
    const manifest = manifestOf(backupPath)
    expect(manifest.previousSpec).toBe('2.7.5')
    expect(manifest.previousVersion).toBe(POOL_VERSION)
    expect(manifest.targetVersion).toBe(version)
    expect(readFileSync(join(backupPath, 'xdpool', 'aggregate.json'), 'utf8')).toBe(DATA_FILES['aggregate.json'])
    const pkg = JSON.parse(readFileSync(join(w.profile, 'package.json'), 'utf8')) as { dependencies: Record<string, string> }
    expect(pkg.dependencies['dsh-xdpool']).toMatch(new RegExp(`^file:.*dsh-xdpool-${version.replaceAll('.', '\\.')}\\.tgz$`, 'u'))
    expect(pkg.dependencies['some-other-plugin']).toBe('1.0.0')
    expect(existsSync(join(w.profile, 'package.json.tmp'))).toBe(false)
  })

  it('备份失败就中止：package.json 不动，错误是中文，最后一步是 backup 失败', async () => {
    const w = world()
    point(w)
    write(join(w.data, 'pre-update'), 'not a directory')
    const before = readFileSync(join(w.profile, 'package.json'), 'utf8')
    serve(gzipSync(Buffer.from('fake tarball')))
    const result = await installVersion(version)
    expect(result.ok).toBe(false)
    expect(result.restartRequired).toBe(false)
    expect(result.backupPath).toBeUndefined()
    expect(result.error).toMatch(/已取消更新/u)
    expect(result.steps?.at(-1)).toMatchObject({ id: 'backup', ok: false })
    expect(result.steps?.some(step => step.id === 'write')).toBe(false)
    expect(readFileSync(join(w.profile, 'package.json'), 'utf8')).toBe(before)
  })

  it('下载到的不是压缩包：停在校验，不备份也不写', async () => {
    const w = world()
    point(w)
    const before = readFileSync(join(w.profile, 'package.json'), 'utf8')
    serve('<html>proxy login</html>')
    const result = await installVersion(version)
    expect(result.ok).toBe(false)
    expect(result.error).toBe('下载到的不是压缩包（可能被代理拦截）')
    expect(result.steps?.map(step => [step.id, step.ok])).toEqual([['download', true], ['verify', false]])
    expect(existsSync(join(w.data, 'pre-update'))).toBe(false)
    expect(readFileSync(join(w.profile, 'package.json'), 'utf8')).toBe(before)
  })

  it('HTTP 失败：错误是中文并带状态码', async () => {
    const w = world()
    point(w)
    serve('not found', 404)
    const result = await installVersion(version)
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/下载失败.*404/u)
    expect(result.steps).toEqual([{ id: 'download', ok: false, detail: 'HTTP 404' }])
  })

  it('网络错误也给中文', async () => {
    const w = world()
    point(w)
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    const result = await installVersion(version)
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/[\u4e00-\u9fff]/u)
    expect(result.steps?.[0]).toMatchObject({ id: 'download', ok: false })
  })

  it('profile 里没有 dsh-xdpool：不建备份，停在写入', async () => {
    const w = world()
    point(w)
    writeFileSync(join(w.profile, 'package.json'), JSON.stringify({ dependencies: { other: '1' } }), 'utf8')
    serve(gzipSync(Buffer.from('fake tarball')))
    const result = await installVersion(version)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('没有 dsh-xdpool')
    expect(result.steps?.at(-1)).toMatchObject({ id: 'write', ok: false })
    expect(existsSync(join(w.data, 'pre-update'))).toBe(false)
  })

  it('连续更新 7 次只留 5 份备份，最新那份一定在', async () => {
    const w = world()
    point(w)
    let last = ''
    for (let round = 0; round < 7; round += 1) {
      serve(gzipSync(Buffer.from(`fake tarball ${String(round)}`)))
      const result = await installVersion(version)
      expect(result.ok, result.error).toBe(true)
      last = result.backupPath ?? ''
    }
    const left = readdirSync(join(w.data, 'pre-update'))
    expect(left).toHaveLength(PRE_UPDATE_KEEP)
    expect(left.map(name => join(w.data, 'pre-update', name))).toContain(last)
  })
})

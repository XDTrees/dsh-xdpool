/**
 * 更新前自动备份，以及回退。
 *
 * WHY
 *
 * 自动更新只改 profile 的 package.json，但新版本一启动就会读、迁移、再写插件的数据文件。
 * 新版本万一读错了一个字段，下一次保存就把用户的 API Key、账号、路由链写坏 —— 而这些都是
 * 用户自己的凭据，没有任何上游能还给他。所以在动 package.json 之前，先把插件的全部数据
 * 原样复制一份，再把原来的 dsh-xdpool spec 记下来，这样任何时候都能回到更新前的样子。
 *
 * 备份了什么（只复制存在的；一律原样复制，不解析、不改写）：
 *
 *   xdpool/            <DSH home>/.xdpool —— 插件自己的数据目录：aggregate.json（API Key、
 *                      路由链、局域网网关）、accounts.json（账号池凭据）、ignored.json、
 *                      preferred.json、sticky-affinity.json、channel-usage.json、各渠道会话
 *                      （doubao-session(s).json、marvis/astudio/monkeycode/baizhi/autoclaw/
 *                      accio/magicrew…-accounts.json）、导入的 *.info 快照、backups/、
 *                      startup.log。跳过 pre-update/（备份自己）和 login-profiles/（临时
 *                      浏览器配置，几十上百 MB，且每次登录都会重建）。
 *   home-xdpool/       DSH_HOME 未设置时 aggregate.json 写在 ~/.xdpool 而不是 ~/.dsh/.xdpool
 *                      （store.ts 一直如此），两处不同时这一份也备份。
 *   workbuddy-xdpool/  改名前的旧数据目录（若还在）。
 *   channel-pack@…/    channel-pack 的状态目录：state.json（扫码登录的账号）、token-ledger.json
 *                      （用量账本）、dead-models.json（模型黑名单）、permanent-locks.json、
 *                      auto-checkin.json、ui-preferences.json 等。pack 的根目录可能是
 *                      DSH_CHANNEL_PACK_STATE_DIR、profile 目录或 DSH home，存在的都备份。
 *   profile/           profile 的 package.json，以及宿主的 settings 文档（settings.yaml 等，
 *                      插件设置里的 automation、automationEarnings、creditReserves、模型选择
 *                      都在这里）和 cordis.patch.yml。
 *   previous-package/  更新前 spec 指向的本地 .tgz（若是 file: 且文件还在）—— 它通常在
 *                      %TEMP% 里，随时可能被清理，复制一份回退才靠得住。
 *
 * 不在备份里的：浏览器侧的 localStorage / IndexedDB（xdpool.tab、渠道计数缓存、豆包模型
 * 开关、备份历史），Node 侧碰不到；豆包的浏览器配置目录 ~/.dsh/doubao-browser-profile
 * （Chrome 配置，太大，且会话本身已在 doubao-session(s).json 里）。
 *
 * 备份放在 <插件数据目录>/pre-update/<旧版本>-<时间戳>/，和数据同一个根目录，只保留最近
 * {@link PRE_UPDATE_KEEP} 份。目录里的 restore.json 记录原 spec、旧版本号、时间和每一份
 * 数据原来在哪；回退说明.txt 是给人看的同一份信息。
 *
 * @module dsh-xdpool/pre-update-backup
 */
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'

/** 本插件发布用的包名。 */
const PACKAGE = 'dsh-xdpool'
/** 备份根目录名，位于插件数据目录下。 */
export const PRE_UPDATE_DIR_NAME = 'pre-update'
/** 只保留最近几份。 */
export const PRE_UPDATE_KEEP = 5
/** 机器读的回退信息。 */
export const RESTORE_FILE_NAME = 'restore.json'
/** 人读的回退说明。 */
export const ROLLBACK_NOTE_NAME = '回退说明.txt'
/** package.json 里可能出现本插件的依赖块。 */
export const DEPENDENCY_BLOCKS = ['dependencies', 'devDependencies', 'optionalDependencies'] as const

/** 插件数据目录顶层不进备份的条目。 */
const SKIP_TOP_LEVEL: ReadonlySet<string> = new Set([PRE_UPDATE_DIR_NAME, 'login-profiles'])
/** profile 目录里要备份的文件。 */
const PROFILE_FILES = ['package.json', 'settings.yaml', 'settings.yml', 'settings.json', 'cordis.patch.yml'] as const

/** 一份数据：原来在哪，备份到哪。 */
export interface BackupEntry {
  label: string
  from: string
  to: string
  files: number
  bytes: number
}

/** restore.json 的内容。 */
export interface RestoreManifest {
  package: typeof PACKAGE
  format: 1
  createdAt: string
  previousVersion: string
  targetVersion: string
  profileDir: string
  packageJsonPath: string
  /** 更新前 dsh-xdpool 的 spec（第一处依赖块里的）。 */
  previousSpec?: string
  /** 每个依赖块各自的原 spec。 */
  previousSpecs: Record<string, string>
  /** 将要写入的新 spec。 */
  newSpec?: string
  /** 回退时写回 package.json 的 spec：优先用备份里那份 .tgz，没有就用原 spec。 */
  rollbackSpec?: string
  /** 备份里那份旧 .tgz 的绝对路径。 */
  previousTarball?: string
  entries: BackupEntry[]
  files: number
  bytes: number
}

export interface PreUpdateBackupOptions {
  /** profile 目录（package.json 所在）。 */
  profileDir: string
  previousVersion: string
  targetVersion: string
  /** 依赖块 -> 原 spec。 */
  previousSpecs: Readonly<Record<string, string>>
  newSpec?: string
  env?: NodeJS.ProcessEnv
  /** 用户主目录，测试用。 */
  home?: string
  now?: Date
}

export interface PreUpdateBackupResult {
  ok: boolean
  /** 备份目录的绝对路径。 */
  path?: string
  manifest?: RestoreManifest
  /** 中文原因。 */
  error?: string
}

/** 和 ignored.ts 的 dshHome 同一规则，但主目录可注入。 */
function dshHomeOf(env: NodeJS.ProcessEnv, home: string): string {
  const fromEnv = env['DSH_HOME']
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv.trim()
  return join(home, '.dsh')
}

/** 插件数据目录（和 ignored.ts 的 pluginDataDir 相同）。 */
export function backupDataDir(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  return join(dshHomeOf(env, home), '.xdpool')
}

/** 备份根目录。 */
export function preUpdateRoot(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  return join(backupDataDir(env, home), PRE_UPDATE_DIR_NAME)
}

/** 要备份的来源，按顺序，已去重、只含存在的。 */
export function backupSources(
  profileDir: string,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): { label: string; from: string; kind: 'data' | 'dir' | 'profile' }[] {
  const out: { label: string; from: string; kind: 'data' | 'dir' | 'profile' }[] = []
  const seen = new Set<string>()
  const add = (label: string, from: string, kind: 'data' | 'dir' | 'profile'): void => {
    const key = resolve(from).toLowerCase()
    if (seen.has(key)) return
    if (!existsSync(from)) return
    seen.add(key)
    out.push({ label, from, kind })
  }
  const dsh = dshHomeOf(env, home)
  add('xdpool', join(dsh, '.xdpool'), 'data')
  // store.ts：`env.DSH_HOME ?? homedir()` —— DSH_HOME 未设置时是 ~/.xdpool，不是 ~/.dsh/.xdpool。
  const aggregateHome = env['DSH_HOME'] ?? home
  if (aggregateHome !== '') add('home-xdpool', join(aggregateHome, '.xdpool'), 'data')
  add('workbuddy-xdpool', join(dsh, '.workbuddy-xdpool'), 'dir')
  const packOverride = env['DSH_CHANNEL_PACK_STATE_DIR']
  if (typeof packOverride === 'string' && packOverride.trim() !== '') {
    add('channel-pack@state-dir', join(packOverride.trim(), 'channel-pack'), 'dir')
  }
  add('channel-pack@profile', join(profileDir, 'channel-pack'), 'dir')
  add('channel-pack@dsh-home', join(dsh, 'channel-pack'), 'dir')
  add('profile', profileDir, 'profile')
  return out
}

/** 把一个错误翻成一句中文。 */
export function describeFsError(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code
  const message = error instanceof Error ? error.message : String(error)
  switch (code) {
    case 'ENOSPC': return '磁盘空间不足'
    case 'EPERM':
    case 'EACCES': return '没有写入权限（可能被杀毒软件拦截）'
    case 'EBUSY': return '文件被其他程序占用'
    case 'ENOTDIR':
    case 'EEXIST': return '备份位置被同名文件占用'
    case 'ENOENT': return '文件在复制过程中消失了'
    case 'EMFILE': return '打开的文件太多'
    default: break
  }
  if (/[\u4e00-\u9fff]/u.test(message)) return message
  return `文件操作失败（${message}）`
}

interface CopyTally { files: number; bytes: number }

/**
 * 递归复制，逐个文件核对大小。跳过符号链接和写到一半的 *.tmp / *.part。
 * `skipTop` 只作用于最顶层。
 */
function copyTree(from: string, to: string, tally: CopyTally, skipTop: ReadonlySet<string>): void {
  mkdirSync(to, { recursive: true, mode: 0o700 })
  for (const name of readdirSync(from)) {
    if (skipTop.has(name)) continue
    if (name.endsWith('.tmp') || name.endsWith('.part')) continue
    const source = join(from, name)
    const target = join(to, name)
    const info = lstatSync(source)
    if (info.isSymbolicLink()) continue
    if (info.isDirectory()) {
      copyTree(source, target, tally, new Set<string>())
      continue
    }
    if (!info.isFile()) continue
    copyFile(source, target, tally)
  }
}

function copyFile(source: string, target: string, tally: CopyTally): void {
  copyFileSync(source, target)
  const want = statSync(source).size
  const got = statSync(target).size
  if (want !== got) throw new Error(`复制后大小不一致：${source}`)
  tally.files += 1
  tally.bytes += got
}

/** `2026-11-22T04-37-00-123Z`：能当目录名，按字典序就是时间序。 */
function stampOf(now: Date): string {
  return now.toISOString().replace(/[:.]/gu, '-')
}

/** 版本号里只留能进目录名的字符。 */
function safeSegment(text: string): string {
  const cleaned = text.replace(/[^0-9A-Za-z._-]+/gu, '_').slice(0, 64)
  return cleaned === '' ? 'unknown' : cleaned
}

/** `file:` spec 指向的本地路径；不是本地 .tgz 时 undefined。 */
function localTarballOf(spec: string | undefined, profileDir: string): string | undefined {
  if (spec === undefined || !spec.startsWith('file:')) return undefined
  let path = spec.slice('file:'.length)
  if (path.startsWith('//')) path = path.slice(2)
  // `file:/C:/…` 在 Windows 上要去掉开头那个斜杠。
  if (/^\/[A-Za-z]:[\\/]/u.test(path)) path = path.slice(1)
  if (!/\.(tgz|tar\.gz)$/iu.test(path)) return undefined
  const absolute = resolve(profileDir, path)
  try {
    return statSync(absolute).isFile() ? absolute : undefined
  } catch {
    return undefined
  }
}

function rollbackNote(manifest: RestoreManifest, dir: string): string {
  const lines = [
    `XD Pool 更新前备份`,
    ``,
    `创建时间：${manifest.createdAt}`,
    `更新前版本：${manifest.previousVersion}`,
    `准备更新到：${manifest.targetVersion}`,
    `profile 的 package.json：${manifest.packageJsonPath}`,
    `更新前的 dsh-xdpool spec：${manifest.previousSpec ?? '（未记录）'}`,
    ``,
    `—— 回退到更新前的版本 ——`,
    `1. 完全退出 DSH。`,
    `2. 打开 ${manifest.packageJsonPath}，把 "${PACKAGE}" 那一行的值改回：`,
    `     ${manifest.rollbackSpec ?? manifest.previousSpec ?? '（见 restore.json）'}`,
    `   （或者直接用本目录 profile\\package.json 覆盖它。）`,
    `3. 重新打开 DSH。`,
    ``,
    `—— 需要连数据一起恢复时（一般不需要）——`,
    `先完全退出 DSH，再把下面每个子目录里的内容复制回原位置（覆盖前建议先把原位置另存一份）：`,
  ]
  for (const entry of manifest.entries) {
    lines.push(`   ${join(dir, entry.label)}  ->  ${entry.from}`)
  }
  lines.push('', '本目录由插件自动创建，只保留最近 5 份；要长期保留请复制到别处。', '')
  return lines.join('\r\n')
}

/**
 * 在改 package.json 之前把插件数据完整复制一份。
 *
 * 任何一步失败都返回 ok:false 和中文原因，并删除这次写了一半的备份目录（只删自己刚建的
 * 那个目录，别的什么都不碰）。成功时 restore.json 和回退说明.txt 已落盘。
 */
export function backupBeforeUpdate(options: PreUpdateBackupOptions): PreUpdateBackupResult {
  const env = options.env ?? process.env
  const home = options.home ?? homedir()
  const now = options.now ?? new Date()
  const root = preUpdateRoot(env, home)
  const base = join(root, `${safeSegment(options.previousVersion)}-${stampOf(now)}`)
  let dir = base
  for (let attempt = 2; existsSync(dir); attempt += 1) dir = `${base}-${String(attempt)}`
  const fail = (stage: string, error: unknown): PreUpdateBackupResult => {
    try {
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
    } catch {
      // 清理失败不影响结论：更新已经取消。
    }
    return { ok: false, error: `更新前备份失败（${stage}：${describeFsError(error)}），已取消更新，插件和数据都没有改动` }
  }
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
  } catch (error: unknown) {
    return fail(`创建备份目录 ${dir}`, error)
  }
  const entries: BackupEntry[] = []
  const total: CopyTally = { files: 0, bytes: 0 }
  for (const source of backupSources(options.profileDir, env, home)) {
    const to = join(dir, source.label)
    const tally: CopyTally = { files: 0, bytes: 0 }
    try {
      if (source.kind === 'profile') {
        mkdirSync(to, { recursive: true, mode: 0o700 })
        for (const name of PROFILE_FILES) {
          const file = join(source.from, name)
          if (existsSync(file) && statSync(file).isFile()) copyFile(file, join(to, name), tally)
        }
      } else {
        copyTree(source.from, to, tally, source.kind === 'data' ? SKIP_TOP_LEVEL : new Set<string>())
      }
    } catch (error: unknown) {
      return fail(`复制 ${source.from}`, error)
    }
    entries.push({ label: source.label, from: source.from, to, files: tally.files, bytes: tally.bytes })
    total.files += tally.files
    total.bytes += tally.bytes
  }
  const specs: Record<string, string> = { ...options.previousSpecs }
  const firstBlock = DEPENDENCY_BLOCKS.find(block => specs[block] !== undefined)
  const previousSpec = firstBlock === undefined ? undefined : specs[firstBlock]
  let previousTarball: string | undefined
  const tarball = localTarballOf(previousSpec, options.profileDir)
  if (tarball !== undefined) {
    const to = join(dir, 'previous-package')
    try {
      mkdirSync(to, { recursive: true, mode: 0o700 })
      const tally: CopyTally = { files: 0, bytes: 0 }
      previousTarball = join(to, basename(tarball))
      copyFile(tarball, previousTarball, tally)
      entries.push({ label: 'previous-package', from: tarball, to: previousTarball, files: tally.files, bytes: tally.bytes })
      total.files += tally.files
      total.bytes += tally.bytes
    } catch (error: unknown) {
      return fail(`复制旧安装包 ${tarball}`, error)
    }
  }
  const manifest: RestoreManifest = {
    package: PACKAGE,
    format: 1,
    createdAt: now.toISOString(),
    previousVersion: options.previousVersion,
    targetVersion: options.targetVersion,
    profileDir: options.profileDir,
    packageJsonPath: join(options.profileDir, 'package.json'),
    ...(previousSpec === undefined ? {} : { previousSpec }),
    previousSpecs: specs,
    ...(options.newSpec === undefined ? {} : { newSpec: options.newSpec }),
    ...(previousTarball !== undefined
      ? { rollbackSpec: `file:${previousTarball.replaceAll('\\', '/')}`, previousTarball }
      : previousSpec === undefined ? {} : { rollbackSpec: previousSpec }),
    entries,
    files: total.files,
    bytes: total.bytes,
  }
  try {
    const restorePath = join(dir, RESTORE_FILE_NAME)
    writeFileSync(`${restorePath}.tmp`, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    renameSync(`${restorePath}.tmp`, restorePath)
    writeFileSync(join(dir, ROLLBACK_NOTE_NAME), rollbackNote(manifest, dir), 'utf8')
    // 读回来确认真的落盘了 —— 回退全靠这一份。
    const check = JSON.parse(readFileSync(restorePath, 'utf8')) as Partial<RestoreManifest>
    if (check.previousVersion !== manifest.previousVersion) throw new Error('restore.json 读回内容不一致')
  } catch (error: unknown) {
    return fail('写入 restore.json', error)
  }
  return { ok: true, path: dir, manifest }
}

/** 一份已有的更新前备份。 */
export interface PreUpdateBackupInfo {
  path: string
  createdAt: string
  previousVersion: string
  targetVersion: string
  previousSpec?: string
}

/** 列出备份根目录下的备份（只认带 restore.json 的目录），新的在前。永不抛错。 */
export function listPreUpdateBackups(root: string): PreUpdateBackupInfo[] {
  let names: string[]
  try {
    names = readdirSync(root)
  } catch {
    return []
  }
  const out: (PreUpdateBackupInfo & { sortKey: number })[] = []
  for (const name of names) {
    const path = join(root, name)
    try {
      if (!statSync(path).isDirectory()) continue
      const manifest = JSON.parse(readFileSync(join(path, RESTORE_FILE_NAME), 'utf8')) as Partial<RestoreManifest>
      if (manifest.package !== PACKAGE) continue
      const createdAt = typeof manifest.createdAt === 'string' ? manifest.createdAt : ''
      const parsed = Date.parse(createdAt)
      out.push({
        path,
        createdAt,
        previousVersion: typeof manifest.previousVersion === 'string' ? manifest.previousVersion : '',
        targetVersion: typeof manifest.targetVersion === 'string' ? manifest.targetVersion : '',
        ...(typeof manifest.previousSpec === 'string' ? { previousSpec: manifest.previousSpec } : {}),
        sortKey: Number.isNaN(parsed) ? statSync(path).mtimeMs : parsed,
      })
    } catch {
      // 不是我们的目录，或者 restore.json 坏了：不列出，也绝不删除。
    }
  }
  out.sort((a, b) => b.sortKey - a.sortKey || (a.path < b.path ? 1 : a.path > b.path ? -1 : 0))
  return out.map(({ sortKey: _sortKey, ...info }) => info)
}

/**
 * 只保留最近 `keep` 份备份，返回删掉的目录。
 *
 * 只删带合法 restore.json 的目录（我们自己建的）；用户放进来的其他东西一律不碰。永不抛错。
 * `keepPath`（通常是刚建好的那一份）无论排第几都不删。
 */
export function pruneOldBackups(root: string, keep: number = PRE_UPDATE_KEEP, keepPath?: string): string[] {
  const removed: string[] = []
  const protectedKey = keepPath === undefined ? undefined : resolve(keepPath).toLowerCase()
  const backups = listPreUpdateBackups(root)
  const pinned = backups.filter(backup => resolve(backup.path).toLowerCase() === protectedKey)
  const others = backups.filter(backup => resolve(backup.path).toLowerCase() !== protectedKey)
  const room = Math.max(0, keep - pinned.length)
  for (const backup of others.slice(room)) {
    try {
      rmSync(backup.path, { recursive: true, force: true })
      removed.push(backup.path)
    } catch {
      // 删不掉就留着，下次再试。
    }
  }
  return removed
}

/** 回退的结果。 */
export interface RollbackResult {
  ok: boolean
  /** 写回 package.json 的 spec。 */
  spec?: string
  restartRequired: boolean
  error?: string
}

/**
 * 按备份目录里的 restore.json 把 profile 的 package.json 改回更新前的 spec。
 *
 * 只改 spec，不动任何数据文件 —— 数据要不要恢复由用户自己决定（见回退说明.txt），
 * 自动覆盖正在用的数据比不恢复更危险。需要重启 DSH 才生效。
 */
export function rollbackPackageSpec(backupDir: string): RollbackResult {
  let manifest: Partial<RestoreManifest>
  try {
    manifest = JSON.parse(readFileSync(join(backupDir, RESTORE_FILE_NAME), 'utf8')) as Partial<RestoreManifest>
  } catch {
    return { ok: false, restartRequired: false, error: `读不到 ${join(backupDir, RESTORE_FILE_NAME)}，无法回退` }
  }
  const specs = manifest.previousSpecs
  const pkgPath = manifest.packageJsonPath
  if (specs === undefined || specs === null || typeof specs !== 'object' || typeof pkgPath !== 'string') {
    return { ok: false, restartRequired: false, error: 'restore.json 缺少原来的 spec 或 package.json 路径，无法回退' }
  }
  const rollbackSpec = typeof manifest.rollbackSpec === 'string' ? manifest.rollbackSpec : undefined
  const previousTarball = typeof manifest.previousTarball === 'string' ? manifest.previousTarball : undefined
  // 备份里的旧 .tgz 还在就用它（原 spec 可能指向已被清理的 %TEMP%）。
  const useTarball = rollbackSpec !== undefined && previousTarball !== undefined && existsSync(previousTarball)
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as Record<string, unknown>
    let written: string | undefined
    for (const block of DEPENDENCY_BLOCKS) {
      const original = (specs as Record<string, unknown>)[block]
      if (typeof original !== 'string') continue
      const current = pkg[block]
      const record: Record<string, unknown> = current !== null && typeof current === 'object' && !Array.isArray(current)
        ? current as Record<string, unknown>
        : {}
      const spec = useTarball && rollbackSpec !== undefined ? rollbackSpec : original
      record[PACKAGE] = spec
      pkg[block] = record
      written ??= spec
    }
    if (written === undefined) {
      return { ok: false, restartRequired: false, error: 'restore.json 里没有记录 dsh-xdpool 原来的 spec，无法回退' }
    }
    writeFileSync(`${pkgPath}.tmp`, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
    renameSync(`${pkgPath}.tmp`, pkgPath)
    return { ok: true, spec: written, restartRequired: true }
  } catch (error: unknown) {
    return { ok: false, restartRequired: false, error: `回退失败：${describeFsError(error)}` }
  }
}

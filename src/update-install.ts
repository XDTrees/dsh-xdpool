/**
 * Installing a newer build of this plugin.
 *
 * HOW THE HOST UPDATES A PLUGIN
 *
 * There is no install API to call. A profile's `package.json` names each plugin by a spec, and
 * the host resolves that spec when it starts — so "update" means "change the spec, then restart".
 * That is the whole mechanism, and it is what every plugin that self-updates is really doing.
 *
 * WHAT THIS DOES
 *
 * A newer version is downloaded from the npm registry to a local file, and the profile's
 * dependency is pointed at it with a `file:` spec. On the next start the host installs from that
 * file. Nothing is written outside the profile's own directory, and nothing is changed if the
 * download fails — a half-applied update is worse than an unapplied one.
 *
 * 更新前自动备份：改 package.json 之前，插件的全部数据（账号池、API Key、路由链、各渠道会话、
 * channel-pack 状态、宿主 settings 文档）先复制到 `<插件数据目录>/pre-update/<旧版本>-<时间>/`，
 * 原 spec 写进那里的 restore.json，只保留最近 5 份。复制失败就中止更新，package.json 不动。
 * 回退见 `pre-update-backup.ts` 的 rollbackPackageSpec 和备份目录里的「回退说明.txt」。
 *
 * WHY `file:` AND NOT THE PUBLISHED VERSION
 *
 * Naming the version (`"dsh-xdpool": "2.7.5"`) makes the host fetch from the registry on every
 * start, which fails on a machine whose registry is proxied or slow — and the failure mode is a
 * plugin that does not load. Pinning the tarball that was just verified to download keeps the
 * update as local as the install it replaces.
 *
 * A RESTART IS REQUIRED, AND SAYS SO
 *
 * Modules already loaded cannot be swapped in place. The panel reports `restartRequired` and the
 * user restarts when convenient — claiming the update took effect immediately would be a lie the
 * user discovers on the next crash.
 *
 * @module dsh-xdpool/update-install
 */
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { checkForUpdate } from './update-check.ts'
import { backupBeforeUpdate, DEPENDENCY_BLOCKS, preUpdateRoot, pruneOldBackups } from './pre-update-backup.ts'
import { POOL_VERSION } from './version.ts'

/** The package this plugin publishes under. */
const PACKAGE = 'dsh-xdpool'

/** The profile directory whose `package.json` names this plugin. */
function profileDir(): string | undefined {
  // The host sets this for plugins it loaded from a profile; the environment is the only way a
  // plugin can learn where its own spec lives.
  const candidates = [
    process.env['DSH_PROFILE_DIR'],
    process.env['DSH_HOME'] === undefined ? undefined : join(process.env['DSH_HOME'], 'profiles', 'desktop'),
    join(homedir(), '.dsh', 'profiles', 'desktop'),
  ]
  for (const candidate of candidates) {
    if (candidate === undefined) continue
    if (existsSync(join(candidate, 'package.json'))) return candidate
  }
  return undefined
}

/** 一步的执行结果；id 和前端 UpdatePanel 的四步（下载 · 校验 · 备份数据 · 写入配置）一一对应。 */
export interface InstallStep {
  id: 'download' | 'verify' | 'backup' | 'write'
  ok: boolean
  detail?: string
}

/** What an install attempt produced. */
export interface InstallResult {
  ok: boolean
  /** The version written into the profile, when it landed. */
  version?: string
  /** Where the tarball was saved. */
  path?: string
  /** Whether a restart is needed for it to take effect. */
  restartRequired: boolean
  /** Why it did not land. */
  error?: string
  /** 更新前备份目录的绝对路径（备份成功后才有；里面的 restore.json 记着原 spec）。 */
  backupPath?: string
  /** 更新前正在运行的版本。 */
  previousVersion?: string
  /** 实际执行到的步骤，按执行顺序；没执行到的步骤不出现。 */
  steps?: InstallStep[]
}

/** 把下载 / 读写文件时的错误翻成一句中文（前端直接展示）。 */
function chineseFailure(prefix: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const name = error instanceof Error ? error.name : ''
  const cause = error instanceof Error ? (error as { cause?: unknown }).cause : undefined
  const code = (error as { code?: unknown } | null)?.code ?? (cause as { code?: unknown } | null | undefined)?.code
  const codeText = typeof code === 'string' ? code : ''
  if (name === 'TimeoutError' || name === 'AbortError' || /timeout|timed out|aborted/iu.test(message)) {
    return `${prefix}：连接超时，请检查网络后重试`
  }
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|fetch failed|network/iu.test(`${codeText} ${message}`)) {
    return `${prefix}：连不上 npm（离线或代理没放行）`
  }
  if (codeText === 'EPERM' || codeText === 'EACCES' || codeText === 'EBUSY') {
    return `${prefix}：没有权限或文件被占用（可能被杀毒软件拦截）`
  }
  if (codeText === 'ENOSPC') return `${prefix}：磁盘空间不足`
  if (error instanceof SyntaxError) return `${prefix}：文件不是合法的 JSON`
  if (/[\u4e00-\u9fff]/u.test(message)) return `${prefix}：${message}`
  return `${prefix}（${message}）`
}

/** 只读地读 profile 的 package.json；读不了时返回中文原因。 */
function readProfilePackage(pkgPath: string): { pkg: Record<string, unknown> } | { error: string } {
  try {
    const parsed = JSON.parse(readFileSync(pkgPath, 'utf8')) as unknown
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { error: `${pkgPath} 不是一个 JSON 对象，已取消更新` }
    }
    return { pkg: parsed as Record<string, unknown> }
  } catch (error: unknown) {
    return { error: chineseFailure('读取 profile 的 package.json 失败，已取消更新', error) }
  }
}

/**
 * Download a version and point the profile at it.
 *
 * The order matters, and it is the order the panel draws:
 *
 *   1. download — to a `.part` file, so a cut connection never leaves a plausible tarball;
 *   2. verify   — a gzip member starts with 1f 8b, which keeps a proxy's HTML page out;
 *   3. backup   — every data file this plugin (and its channel pack) owns is copied to
 *                 `<data dir>/pre-update/<old version>-<time>/`, with the old spec in
 *                 `restore.json` (see `pre-update-backup.ts`). A failed copy STOPS here;
 *   4. write    — only now is `package.json` touched.
 *
 * A failure at any step leaves the working install and its data exactly as they were.
 */
export async function installVersion(version: string): Promise<InstallResult> {
  const previousVersion = POOL_VERSION
  const steps: InstallStep[] = []
  const failed = (error: string, extra: { path?: string; backupPath?: string } = {}): InstallResult => ({
    ok: false,
    restartRequired: false,
    previousVersion,
    steps,
    error,
    ...extra,
  })
  const profile = profileDir()
  if (profile === undefined) {
    return failed('找不到插件所在的 profile 目录，无法自动更新；请在 DSH 的插件设置里更新')
  }
  const target = join(tmpdir(), `${PACKAGE}-${version}.tgz`)
  const partial = `${target}.part`

  // 1. 下载
  try {
    const response = await fetch(`https://registry.npmjs.org/${PACKAGE}/-/${PACKAGE}-${version}.tgz`, {
      signal: AbortSignal.timeout(120_000),
    })
    if (!response.ok || response.body === null) {
      steps.push({ id: 'download', ok: false, detail: `HTTP ${String(response.status)}` })
      return failed(`下载失败：服务器返回 HTTP ${String(response.status)}`)
    }
    mkdirSync(dirname(target), { recursive: true })
    const sink = createWriteStream(partial)
    // Streamed rather than buffered: the package is a few megabytes and there is no reason to
    // hold all of it to write it back out.
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      sink.write(chunk)
    }
    await new Promise<void>((resolve, reject) => {
      sink.end(() => { resolve() })
      sink.on('error', reject)
    })
    steps.push({ id: 'download', ok: true })
  } catch (error: unknown) {
    try { rmSync(partial, { force: true }) } catch { /* a stale .part is harmless */ }
    steps.push({ id: 'download', ok: false, detail: error instanceof Error ? error.message : String(error) })
    return failed(chineseFailure('下载新版本失败', error))
  }

  // 2. 校验 —— a gzip member starts with 1f 8b; this keeps a proxy's HTML error page from
  // being installed as a plugin.
  try {
    const head = readFileSync(partial).subarray(0, 2)
    if (head[0] !== 0x1f || head[1] !== 0x8b) {
      rmSync(partial, { force: true })
      steps.push({ id: 'verify', ok: false, detail: '不是 gzip 压缩包' })
      return failed('下载到的不是压缩包（可能被代理拦截）')
    }
    renameSync(partial, target)
    steps.push({ id: 'verify', ok: true })
  } catch (error: unknown) {
    steps.push({ id: 'verify', ok: false, detail: error instanceof Error ? error.message : String(error) })
    return failed(chineseFailure('校验安装包失败', error))
  }
  const newSpec = `file:${target.replaceAll('\\', '/')}`

  // 3. 备份 —— 先只读地记下原来的 spec，再复制数据。这里任何失败都不碰 package.json。
  const pkgPath = join(profile, 'package.json')
  const read = readProfilePackage(pkgPath)
  if ('error' in read) {
    steps.push({ id: 'backup', ok: false, detail: read.error })
    return failed(read.error, { path: target })
  }
  const pkg = read.pkg
  const previousSpecs: Record<string, string> = {}
  for (const block of DEPENDENCY_BLOCKS) {
    const record = pkg[block]
    if (record === null || typeof record !== 'object' || Array.isArray(record)) continue
    const deps = record as Record<string, unknown>
    if (!Object.hasOwn(deps, PACKAGE)) continue
    const spec = deps[PACKAGE]
    previousSpecs[block] = typeof spec === 'string' ? spec : JSON.stringify(spec)
  }
  if (Object.keys(previousSpecs).length === 0) {
    steps.push({ id: 'write', ok: false, detail: `package.json 里没有 ${PACKAGE}` })
    return failed(`profile 的 package.json 里没有 ${PACKAGE}，无法自动更新`, { path: target })
  }
  const backup = backupBeforeUpdate({
    profileDir: profile,
    previousVersion,
    targetVersion: version,
    previousSpecs,
    newSpec,
  })
  if (!backup.ok || backup.path === undefined) {
    const reason = backup.error ?? '更新前备份失败，已取消更新，插件和数据都没有改动'
    steps.push({ id: 'backup', ok: false, detail: reason })
    return failed(reason, { path: target })
  }
  const backupPath = backup.path
  steps.push({ id: 'backup', ok: true, detail: `${String(backup.manifest?.files ?? 0)} 个文件已备份到 ${backupPath}` })
  // 只保留最近几份；刚建的这一份无论如何都留着。删旧备份失败不影响这次更新。
  pruneOldBackups(preUpdateRoot(), undefined, backupPath)

  // 4. 写入 package.json —— staged through a sibling temp file, so a crash cannot leave the
  // profile with half a manifest (the backup holds the original either way).
  try {
    for (const block of Object.keys(previousSpecs)) {
      const deps = pkg[block] as Record<string, unknown>
      deps[PACKAGE] = newSpec
    }
    writeFileSync(`${pkgPath}.tmp`, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
    renameSync(`${pkgPath}.tmp`, pkgPath)
    steps.push({ id: 'write', ok: true })
    return { ok: true, version, path: target, restartRequired: true, backupPath, previousVersion, steps }
  } catch (error: unknown) {
    steps.push({ id: 'write', ok: false, detail: error instanceof Error ? error.message : String(error) })
    return failed(chineseFailure('写入 profile 的 package.json 失败', error), { path: target, backupPath })
  }
}

/**
 * Check, then install if there is something newer.
 *
 * Kept together so the route cannot install a version the check never saw — the alternative is a
 * caller passing an arbitrary version string to an endpoint that writes `package.json`.
 */
export async function updateToLatest(): Promise<InstallResult> {
  const status = await checkForUpdate({ force: true })
  if (status.error !== undefined) {
    return { ok: false, restartRequired: false, previousVersion: POOL_VERSION, error: chineseFailure('检查更新失败', new Error(status.error)) }
  }
  if (status.latest === undefined) {
    return { ok: false, restartRequired: false, previousVersion: POOL_VERSION, error: '检查更新失败：没有读到最新版本号' }
  }
  if (!status.newer) {
    return { ok: true, version: status.current, restartRequired: false }
  }
  return await installVersion(status.latest)
}

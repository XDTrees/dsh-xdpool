/**
 * 插件自己的外观主题。
 *
 * WHY A SETTING AND NOT `prefers-color-scheme`
 *
 * 插件整块界面都是自己画的（`.app` 有自己的 `--bg` / `--surface` / `--text`），
 * 不是宿主那套 alias 变量的消费者。跟着系统走的结果是：暗色宿主的用户被强制套进
 * 一块亮色面板，或者反过来。主题因此做成插件内的一个开关，默认保持现状（暗色），
 * 选过之后记住。
 *
 * WHY localStorage AND NOT THE PLUGIN CONFIG
 *
 * 这是纯前端的显示偏好：它只影响这台机器的这块界面，不参与账号池、不做跨机同步，
 * 写进宿主配置反而会让「换一台机器看着不一样」变成配置漂移。同一个文件里的
 * `shell.tsx` 也是用 localStorage 记住当前页签的，沿用同一条路径。
 *
 * 读失败一律回落 `dark`：隐私模式、配额满、别的插件写坏了同一个键 —— 都不该让
 * 一个显示偏好把界面卡死。
 *
 * @module dsh-xdpool/client/theme
 */

/** 两套主题。`dark` 是设计稿那一套，也是默认值。 */
export type XdTheme = 'dark' | 'light'

/** localStorage 键。跟 `xdpool.tab` 同前缀，便于排查。 */
export const THEME_STORAGE_KEY = 'xdpool.theme'

/** 默认主题：保持插件原来的样子，升级后不会突然变脸。 */
export const DEFAULT_THEME: XdTheme = 'dark'

/** 把任意外来值收窄成主题名。 */
export function isXdTheme(value: unknown): value is XdTheme {
  return value === 'dark' || value === 'light'
}

/**
 * 只用到两个方法的存储接口。
 *
 * 为什么不直接写 `globalThis.localStorage`：`tsconfig.json`（host 侧）把
 * src 下所有 .ts 都收进程序，本文件在覆盖范围内，而那份配置的 `lib` 只有
 * ES2023、没有 DOM —— 直接引用 `localStorage` 会触发 TS7017。按结构声明
 * 一个小接口，两边配置都编得过，运行时行为一字不变。
 */
interface ThemeStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** 取存储；宿主没给（Node、SSR、被禁用）就是 undefined。 */
function themeStorage(): ThemeStorage | undefined {
  return (globalThis as { localStorage?: ThemeStorage }).localStorage
}

/** 读记住的主题；任何异常都当没选过。 */
export function readTheme(): XdTheme {
  try {
    const raw = themeStorage()?.getItem(THEME_STORAGE_KEY)
    return isXdTheme(raw) ? raw : DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

/**
 * 记住主题。
 *
 * 写失败只影响「下次打开还亮着没有」，不值得打断这一次切换，
 * 所以吞掉异常而不是上抛。
 */
export function rememberTheme(theme: XdTheme): void {
  try {
    themeStorage()?.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // 无痕模式 / 配额满：这次切换仍然生效，只是下次打开会回到默认。
  }
}

/** 两档互切。 */
export function toggleTheme(theme: XdTheme): XdTheme {
  return theme === 'dark' ? 'light' : 'dark'
}

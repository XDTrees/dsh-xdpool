/**
 * 每个渠道该走哪条登录路 —— 两张表，两个页面共用。
 *
 * 原来这两张表只写在 `ChannelsPage.tsx` 里（不导出），于是账号池那边的
 * 「添加账号」只能跳转到登录通道去，没法自己发起登录。抽出来之后两边都能用。
 *
 * @module dsh-xdpool/login-routes
 */
import {
  POOL_ACCIO_SESSION_PATH,
  POOL_ASTUDIO_BROWSER_LOGIN_PATH,
  POOL_ASTUDIO_LOGIN_PATH,
  POOL_AUTOCLAW_CN_SESSION_PATH,
  POOL_AUTOCLAW_INTL_SESSION_PATH,
  POOL_BAIZHI_BROWSER_LOGIN_PATH,
  POOL_BAIZHI_SESSION_PATH,
  POOL_DOUBAO_SESSION_PATH,
  POOL_MAGICREW_CN_LOGIN_PATH,
  POOL_MAGICREW_CN_SESSION_PATH,
  POOL_MAGICREW_INTL_LOGIN_PATH,
  POOL_MAGICREW_INTL_SESSION_PATH,
  POOL_MARVIS_LOGIN_PATH,
  POOL_MONKEYCODE_CN_BROWSER_LOGIN_PATH,
  POOL_MONKEYCODE_CN_SESSION_PATH,
  POOL_MONKEYCODE_INTL_BROWSER_LOGIN_PATH,
  POOL_MONKEYCODE_INTL_SESSION_PATH,
} from '../status-paths.ts'

/**
 * 插件自己开独立浏览器窗口登录的渠道。
 *
 * POST 一次，后端开 Chromium 窗口等用户登录，登录完成（或窗口关掉、超时）才返回。
 * 这几家不在 pack 里，走 `account.create` 只会得到「unknown provider」。
 */
export const WINDOW_LOGIN_ROUTES: Readonly<Record<string, string>> = Object.freeze({
  'doubao': POOL_DOUBAO_SESSION_PATH,
  'marvis': POOL_MARVIS_LOGIN_PATH,
  'astudio': POOL_ASTUDIO_BROWSER_LOGIN_PATH,
  'monkeycode': POOL_MONKEYCODE_CN_BROWSER_LOGIN_PATH,
  'monkeycode-intl': POOL_MONKEYCODE_INTL_BROWSER_LOGIN_PATH,
  'baizhi': POOL_BAIZHI_BROWSER_LOGIN_PATH,
  /* 超级麦吉两站：开窗登录，登完从 localStorage 读 authorization */
  'magicrew': POOL_MAGICREW_CN_LOGIN_PATH,
  'magicrew-intl': POOL_MAGICREW_INTL_LOGIN_PATH,
})

/**
 * 要粘贴凭据的渠道。
 *
 * AStudio 走 LOGIN 而不是 SESSION：它是唯一一个必须先解析「你给的是什么」才能入库的。
 * 渠道 id 与 `channel-roster.ts` 一致：`autoclaw` 是国际站，`autoclaw-cn` 是国内站。
 */
export const PASTE_ROUTES: Readonly<Record<string, string>> = Object.freeze({
  'astudio': POOL_ASTUDIO_LOGIN_PATH,
  'accio': POOL_ACCIO_SESSION_PATH,
  'monkeycode': POOL_MONKEYCODE_CN_SESSION_PATH,
  'monkeycode-intl': POOL_MONKEYCODE_INTL_SESSION_PATH,
  'baizhi': POOL_BAIZHI_SESSION_PATH,
  'autoclaw': POOL_AUTOCLAW_INTL_SESSION_PATH,
  'autoclaw-cn': POOL_AUTOCLAW_CN_SESSION_PATH,
  /* 超级麦吉两站：网页登录拿到的 JWT 粘进来即可 */
  'magicrew': POOL_MAGICREW_CN_SESSION_PATH,
  'magicrew-intl': POOL_MAGICREW_INTL_SESSION_PATH,
})

/** 一个渠道该怎么登录。 */
export type LoginKind = 'window' | 'paste' | 'pack'

/**
 * 判断一家渠道走哪条路。
 *
 * 顺序是有意的：先看开窗（那几家既不在 pack 里，也没有粘贴框），
 * 再看粘贴，剩下的都是 pack 自己带登录页的。
 */
export function loginKindOf(channelId: string): LoginKind {
  if (WINDOW_LOGIN_ROUTES[channelId] !== undefined) return 'window'
  if (PASTE_ROUTES[channelId] !== undefined) return 'paste'
  return 'pack'
}

/** 这家能不能由页面自己发起登录（也就是不需要跳去别处）。 */
export function canStartLoginInPlace(channelId: string): boolean {
  return loginKindOf(channelId) !== 'pack'
}

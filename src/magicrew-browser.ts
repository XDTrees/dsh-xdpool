/**
 * Magicrew（超级麦吉）的浏览器登录：开一个窗口让用户登，从 localStorage 里取凭据。
 *
 * ## 为什么是窗口而不是粘贴框
 *
 * 上游没有能直接 POST 的登录端点（短信要先过旋转验证码），凭据只存在于网页的
 * `localStorage` 里：
 *
 * ```
 * authorization    → JWT（30 天）
 * organizationCode → 组织码（国际站必需，且必须与 apiKey 配对）
 * ```
 *
 * 让用户开 devtools 抄出来是让用户替插件干活。所以插件自己起一个浏览器窗口，
 * 指向网页登录页，登完之后用 DevTools 协议把这两个键读出来。
 *
 * ## 三个必须记住的点（来自参考实现的实测记录）
 *
 * 1. **打开的是网页域（`webOrigin`），不是 API 子域（`host`）。**
 *    写错了不报错 —— 只是用户在错误的页面上永远登不完。
 * 2. **路径必须带 `/login`。** 弹根路径时用户面对的是一个营销页。
 * 3. **页面在登录过程中会导航**（`/login` → `/global/super/workspace/...`），
 *    所以读取是按间隔重试的，不是读一次。
 *
 * @module dsh-xdpool/magicrew-browser
 */
import {
  closeLoginBrowser,
  launchLoginBrowser,
  waitForCredential,
  type BrowserSession,
} from './browser-login.ts'
import type { MagicrewProduct } from './magicrew-protocol.ts'

/**
 * 从页面里读凭据。
 *
 * 没有 JWT 时返回空串，`waitForCredential` 会继续等 ——
 * 那正是「用户还没登完」的正常状态，不是错误。
 */
const READ_CREDENTIAL = `(() => {
  let jwt = ''
  try { jwt = localStorage.getItem('authorization') || '' } catch (e) { return '' }
  if (!jwt) return ''
  let org = ''
  try { org = localStorage.getItem('organizationCode') || '' } catch (e) { org = '' }
  /* 有的版本把整个登录态放在一个 JSON 里 */
  if (!org) {
    try {
      const raw = localStorage.getItem('userInfo') || localStorage.getItem('user') || ''
      if (raw) {
        const parsed = JSON.parse(raw)
        org = parsed.organizationCode || parsed.orgCode || parsed.organization_code || ''
      }
    } catch (e) { org = '' }
  }
  /* 昵称：能读到就带上，读不到让调用方回退到产品名 */
  let nickname = ''
  try {
    const raw = localStorage.getItem('userInfo') || localStorage.getItem('user') || ''
    if (raw) {
      const parsed = JSON.parse(raw)
      nickname = parsed.nickname || parsed.nickName || parsed.nick_name || parsed.name || ''
    }
  } catch (e) { nickname = '' }
  return JSON.stringify({ jwt: jwt, org: org, nickname: nickname })
})()`

export interface MagicrewBrowserResult {
  jwt: string
  organizationCode?: string
  nickname?: string
}

/**
 * 开窗登录一站。
 *
 * 返回 undefined 表示用户没在时限内登完（或关掉了窗口）——
 * 调用方据此回一句「还没检测到登录完成」，而不是报错。
 */
export async function magicrewBrowserSignIn(input: {
  product: MagicrewProduct
  timeoutMs?: number
}): Promise<MagicrewBrowserResult | undefined> {
  let session: BrowserSession | undefined
  try {
    /*
      网页域 + /login。两个都要对（参考实现实测：弹根路径时用户面对的是营销页，
      弹 API 子域时那个域名根本没有登录界面）。
    */
    session = await launchLoginBrowser(`${input.product.webOrigin}/login`, input.product.id)
    const raw = await waitForCredential({
      session,
      hostFragment: new URL(input.product.webOrigin).hostname,
      read: READ_CREDENTIAL,
      timeoutMs: input.timeoutMs ?? 300_000,
      /* 登录后页面会换 origin（/global/super/...）——放宽匹配，别因导航错过 */
      intervalMs: 1_500,
    })
    if (raw === undefined || raw === '') return undefined
    const parsed = JSON.parse(raw) as { jwt?: unknown; org?: unknown; nickname?: unknown }
    const jwt = typeof parsed.jwt === 'string' ? parsed.jwt : ''
    if (jwt === '') return undefined
    const org = typeof parsed.org === 'string' && parsed.org !== '' ? parsed.org : undefined
    const nickname = typeof parsed.nickname === 'string' && parsed.nickname !== ''
      ? parsed.nickname
      : undefined
    return {
      jwt,
      ...org === undefined ? {} : { organizationCode: org },
      ...nickname === undefined ? {} : { nickname },
    }
  } finally {
    await closeLoginBrowser(session)
  }
}

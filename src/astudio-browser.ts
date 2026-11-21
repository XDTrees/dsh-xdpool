/**
 * AStudio's sign-in: a browser window on the console, and the session it leaves.
 *
 * THE WEB CONSOLE HAS ITS OWN DOOR
 *
 * The reference notes are clear that the DESKTOP CLIENT's sign-in is a WeChat QR flow held inside
 * the app, with no programmatic exchange, and that inventing a login URL would be worse than
 * nothing. That is about the client — measured, `agent.xfyun.cn` offers a phone number plus an SMS
 * code, in ordinary inputs on the page:
 *
 *   text: 请输入手机号     text: 请输入验证码
 *
 * So a browser window can complete this sign-in the way a user would, and the cookies it leaves
 * are what the points endpoints already accept. The paste box can go.
 *
 * @module dsh-xdpool/astudio-browser
 */
import { closeLoginBrowser, launchLoginBrowser, waitForCookies, type BrowserSession } from './browser-login.ts'
import { safeDecode } from './marvis-session.ts'

/** The console a user signs into. The plugin already talks to this host for points. */
export const ASTUDIO_CONSOLE = 'https://agent.xfyun.cn/'

/**
 * The cookies that mean "signed in".
 *
 * The landing page already sets five cookies (`appid`, `daas_st`, `di_c_mti`, …) before anyone has
 * signed in, so their presence proves nothing. `ssoSessionId` is the web session — the same name
 * the desktop client's own storage uses — and it appears only after the code is accepted.
 */
const SESSION_COOKIES = ['ssoSessionId'] as const

/** What one browser sign-in produced. */
export interface AstudioBrowserResult {
  /** The `Cookie` header value. */
  cookie: string
  /** The account id when the console exposes it in a cookie of its own. */
  accountId?: string
  /**
   * The name the console shows for this account, when it publishes one as a cookie.
   *
   * Read here rather than fetched afterwards: the card labels the account with it, and an id
   * like `astudio` repeated down a list tells a reader nothing about which account is which.
   */
  nickname?: string
}

/** Open the console and wait for the session cookie. */
export async function astudioBrowserSignIn(input: {
  timeoutMs?: number
}): Promise<AstudioBrowserResult | undefined> {
  let session: BrowserSession | undefined
  try {
    session = await launchLoginBrowser(ASTUDIO_CONSOLE, 'astudio')
    const cookies = await waitForCookies({
      session,
      url: ASTUDIO_CONSOLE,
      names: SESSION_COOKIES,
      timeoutMs: input.timeoutMs ?? 300_000,
    })
    if (cookies === undefined) return undefined
    const header = cookies
      .filter(cookie => cookie.value !== '')
      .map(cookie => `${cookie.name}=${cookie.value}`)
      .join('; ')
    if (header === '') return undefined
    /**
     * The account id travels as its own cookie on this console.
     *
     * It is read when present and left absent otherwise: the points endpoint can work it out from
     * the session, and a guessed id would be worse than none.
     */
    const account = cookies.find(cookie => /account_?id/iu.test(cookie.name))
    /**
     * The display name also travels as a cookie on this console. The pattern covers the names
     * the console has used (`nickName`, `nickname`, `user_name`, `displayName`) because only
     * some builds set it — a missing one leaves the field absent and the card falls back to the
     * id, which is what happens today.
     */
    const named = cookies.find(cookie => /^(?:nick_?name|user_?name|display_?name)$/iu.test(cookie.name))
    const nickname = named === undefined ? undefined : safeDecode(named.value).trim()
    return {
      cookie: header,
      ...(account === undefined ? {} : { accountId: account.value }),
      ...(nickname === undefined || nickname === '' ? {} : { nickname }),
    }
  } finally {
    await closeLoginBrowser(session)
  }
}

/**
 * 百智云's sign-in: a browser window, and the two cookies its console keeps.
 *
 * WHY A KEY ALONE IS NOT ENOUGH
 *
 * `sk-` keys work for messages, but the points endpoints (`/api/v1/user/wallet/balance`) accept
 * only cookies — a key sent as `x-api-key` is answered 401. A key-only account therefore "works"
 * and shows no balance, which on a card whose whole job is telling you what you have left is a
 * broken account.
 *
 * The console session is also how the key is obtained at all: `GET /api/v1/user/api-keys` with
 * the login cookie returns the key IN PLAIN TEXT, so the user never has to open the console and
 * copy one out.
 *
 * ⚠️ BOTH COOKIES ARE REQUIRED
 *
 * The console sets `sl-session` (device / anti-abuse) and `baizhi_session` (login). Measured: with
 * only `baizhi_session`, `/api/v1/user/profile` answers 401 — the pair is what authenticates.
 *
 * @module dsh-xdpool/baizhi-browser
 */
import { closeLoginBrowser, launchLoginBrowser, waitForCredential, type BrowserSession } from './browser-login.ts'
import { safeDecode } from './marvis-session.ts'

/** The console a user signs into. */
export const BAIZHI_CONSOLE = 'https://baizhi.cloud/console'

/** What one browser sign-in produced. */
export interface BaizhiBrowserResult {
  /** The two cookies, already joined into a `Cookie` header value. */
  sessionCookie: string
  /** The account's API key, read from the console. */
  apiKey?: string
  /** True when the key could not be read (the console may not have created one yet). */
  keyMissing?: boolean
  /**
   * The name the console shows for this account, when it leaves one in a cookie.
   *
   * Optional on purpose: the console does not always publish it, and an account with no name
   * still works. The card falls back to a short id in that case.
   */
  nickname?: string
}

/**
 * Read the two cookies.
 *
 * `document.cookie` covers the non-HttpOnly ones, which is what these are — an HttpOnly session
 * cookie would be invisible here, and the console's own JS reads them the same way.
 */
const READ_COOKIES = `(() => {
  const get = (name) => {
    const parts = document.cookie ? document.cookie.split(";") : []
    for (const part of parts) {
      const at = part.indexOf("=")
      if (at < 0) continue
      if (part.slice(0, at).trim() === name) return part.slice(at + 1).trim()
    }
    return ""
  }
  const session = get("baizhi_session")
  const device = get("sl-session")
  if (!session) return ""
  /*
   * The display name, when the console leaves one where JavaScript can see it.
   *
   * Four names because the console has shipped under more than one: only the first that is
   * non-empty is used, and none found is a normal outcome rather than a failure.
   */
  let nickname = ""
  for (const key of ["nickname", "nickName", "user_name", "userName", "display_name"]) {
    const value = get(key)
    if (value) { nickname = value; break }
  }
  // Joined in the order the console sends them; both are required.
  return JSON.stringify({ session, device, nickname, cookie: [session === "" ? "" : "baizhi_session=" + session, device === "" ? "" : "sl-session=" + device].filter(Boolean).join("; ") })
})()`

/** Open the console and wait for the user to finish. */
export async function baizhiBrowserSignIn(input: {
  timeoutMs?: number
}): Promise<BaizhiBrowserResult | undefined> {
  let session: BrowserSession | undefined
  try {
    session = await launchLoginBrowser(BAIZHI_CONSOLE, 'baizhi')
    const raw = await waitForCredential({
      session,
      hostFragment: 'baizhi.cloud',
      read: READ_COOKIES,
      timeoutMs: input.timeoutMs ?? 300_000,
    })
    if (raw === undefined || raw === '') return undefined
    const parsed = JSON.parse(raw) as { cookie?: string; nickname?: string }
    const cookie = parsed.cookie ?? ''
    if (cookie === '') return undefined
    const nickname = typeof parsed.nickname === 'string' ? safeDecode(parsed.nickname).trim() : ''
    return {
      sessionCookie: cookie,
      ...(nickname === '' ? {} : { nickname }),
    }
  } finally {
    await closeLoginBrowser(session)
  }
}

/**
 * Read the account's API key from the console.
 *
 * Called after the cookie is stored, so the account can be created without the user visiting the
 * API-key page at all. A missing key is not a failure: the account still works for the points
 * endpoints, and the card says the key has not been created yet.
 */
export async function baizhiReadApiKey(sessionCookie: string, signal?: AbortSignal): Promise<string | undefined> {
  try {
    const response = await fetch('https://baizhi.cloud/api/v1/user/api-keys', {
      headers: {
        cookie: sessionCookie,
        accept: 'application/json',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.7390.55 Safari/537.36',
      },
      signal: signal ?? AbortSignal.timeout(20_000),
    })
    if (!response.ok) return undefined
    const body = await response.json() as { items?: { key?: unknown }[] }
    const first = body.items?.[0]?.key
    return typeof first === 'string' && first !== '' ? first : undefined
  } catch {
    return undefined
  }
}

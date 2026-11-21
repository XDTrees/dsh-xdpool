/**
 * Exchanging the OAuth code for a session, and keeping it.
 *
 * THE EXCHANGE CONTRACT, MEASURED
 *
 *   - No `guid` → `-109 RC_PARAMS_INVALID`. The parameter check runs BEFORE the code is
 *     validated, so a missing device reads like a malformed request.
 *   - Guid present but the code is fake, expired or already used → `-107 RC_NO_AUTH_ERR`.
 *   - Success → **302 + Set-Cookie**, not JSON. Following the redirect throws the session away,
 *     so the response is read with `redirect: "manual"`.
 *
 * The cookies that matter are `openid` and `accesstoken`; a risk-control page also answers 302
 * but sets different cookies, which is why their absence is the success test.
 *
 * @module dsh-xdpool/marvis-session
 */
import { MARVIS_BASE, MARVIS_BROWSER_UA, type MarvisAccount } from './marvis-protocol.ts'

/** The fixed exchange endpoint. */
const REDIRECT = `${MARVIS_BASE}/marvis_client_login/marvis_oauth`

/** `Set-Cookie` lines from a `Headers`, split correctly. */
export function setCookies(headers: Headers): Map<string, string> {
  const jar = new Map<string, string>()
  /**
   * `getSetCookie()` is the reliable source on Node 22+.
   *
   * Splitting `get('set-cookie')` on commas breaks on `Expires=Wed, 01 Jan…`, whose comma cuts
   * one cookie in half.
   */
  const lines = typeof headers.getSetCookie === 'function'
    ? headers.getSetCookie()
    : String(headers.get('set-cookie') ?? '').split(/,(?=\s*[^;=]+=)/u).filter(Boolean)
  for (const line of lines) {
    const pair = line.split(';')[0] ?? ''
    const at = pair.indexOf('=')
    if (at <= 0) continue
    const name = pair.slice(0, at).trim()
    const value = pair.slice(at + 1).trim()
    if (name !== '' && !jar.has(name)) jar.set(name, value)
  }
  return jar
}

/** What a failed exchange means, in words the user can act on. */
function loginFailure(code: number, message: string): Error {
  const hint = code === -109
    ? '（-109：请求参数没通过检查，最常见是缺设备标识。请重试一次；仍失败请反馈）'
    : code === -107
      ? '（-107：授权码无效、已过期或已被使用。请重新走一遍登录；与账号本身无关）'
      : ''
  return new Error(`登录失败（code=${String(code)}）：${message}${hint}`)
}

/** Decode a cookie value that may be percent-encoded. */
export function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * Turn an OAuth code into an account.
 *
 * `state` is passed through verbatim: QQ's is a decimal (`31.1177412`) and the service compares
 * the string, so re-formatting it fails the check.
 */
export async function exchangeCode(input: {
  code: string
  loginType: 'QC' | 'WX'
  guid: string
  state?: string
  signal?: AbortSignal
}): Promise<MarvisAccount> {
  const { code, loginType, guid, state } = input
  if (code === '') throw new Error('没有授权码（回调地址里取不到 code）。请重新走一遍登录')

  /**
   * Only `login_type`, `code` and `state`.
   *
   * One extra parameter is answered `-109`, so nothing else is added even when it looks harmless.
   */
  const params = new URLSearchParams({ login_type: loginType, code })
  if (state !== undefined && state !== '') params.set('state', state)
  const url = `${REDIRECT}?${params.toString()}`

  const response = await fetch(url, {
    method: 'GET',
    // Success is 302 + Set-Cookie. Following it lands on a "completing…" page and drops the
    // session cookies.
    redirect: 'manual',
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
      // The client's browser identity — the service recognises callers by UA.
      'User-Agent': MARVIS_BROWSER_UA,
      // A device id, not a signature.
      'Ual-Access-Guid': guid,
    },
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  })

  const jar = setCookies(response.headers)
  const openid = jar.get('openid')
  const accessToken = jar.get('accesstoken') ?? jar.get('access_token')
  if (openid !== undefined && openid !== '' && accessToken !== undefined && accessToken !== '') {
    const expiresRaw = jar.get('access_token_expire_time')
    const expiresAt = expiresRaw !== undefined && expiresRaw !== ''
      ? Number(expiresRaw) * (Number(expiresRaw) < 1e12 ? 1000 : 1)
      : Date.now() + 30 * 24 * 3600_000
    return {
      openid,
      accessToken,
      ...(jar.get('refreshtoken') === undefined ? {} : { refreshToken: jar.get('refreshtoken') as string }),
      ...(jar.get('nickname') === undefined ? {} : { nickname: safeDecode(jar.get('nickname') as string) }),
      // QC → "1", WX → "2"; that is what `Ual-Access-Login-Type` carries.
      loginType: loginType === 'WX' ? '2' : '1',
      guid,
      expiresAt: Number.isFinite(expiresAt) ? expiresAt : Date.now() + 30 * 24 * 3600_000,
    }
  }

  if (response.status >= 300 && response.status < 400) {
    const to = response.headers.get('location') ?? ''
    throw new Error(
      `登录失败：服务端返回 ${String(response.status)}，但没有下发登录 Cookie`
      + `（Location=${to === '' ? '空' : to}）。请重新走一遍登录`,
    )
  }

  // The compatibility shape: 200 + JSON.
  const text = await response.text().catch(() => '')
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new Error(`登录接口返回的内容无法识别（HTTP ${String(response.status)}）：${text.slice(0, 200)}`)
  }
  const code2 = Number(parsed['code'] ?? 0)
  const info = (parsed['user_info'] ?? parsed['data'] ?? parsed) as Record<string, unknown>
  const token = info['access_token'] ?? info['accessToken']
  const id = info['openid'] ?? info['openId']
  if (typeof token === 'string' && typeof id === 'string' && (code2 === 0 || Number.isNaN(code2))) {
    return {
      openid: id,
      accessToken: token,
      ...(typeof info['refresh_token'] === 'string' ? { refreshToken: info['refresh_token'] } : {}),
      ...(typeof info['nick_name'] === 'string' ? { nickname: info['nick_name'] } : {}),
      loginType: loginType === 'WX' ? '2' : '1',
      guid,
      expiresAt: Date.now() + 30 * 24 * 3600_000,
    }
  }
  throw loginFailure(code2 === 0 ? response.status : code2, String(parsed['msg'] ?? '未返回 access_token / openid'))
}

/**
 * Pull an authorization code out of whatever the user pasted.
 *
 * Accepts a bare code, a whole callback URL, or a JSON blob — because the three are what people
 * actually copy from a browser.
 */
export function extractCode(input: string): string | undefined {
  const text = input.trim()
  if (text === '') return undefined
  try {
    const code = new URL(text).searchParams.get('code')
    if (code !== null && code !== '') return code
  } catch {
    // Not a URL; keep looking.
  }
  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>
      const code = parsed['code'] ?? (parsed['data'] as Record<string, unknown> | undefined)?.['code']
      // A success code is a long string; a failure `code` is a number.
      if (typeof code === 'string' && code.length > 4) return code
    } catch {
      // Not JSON.
    }
  }
  const match = /(?:^|[?&])code=([^&\s]+)/u.exec(text)
  if (match?.[1] !== undefined) return decodeURIComponent(match[1])
  if (/^[A-Za-z0-9_-]{8,}$/u.test(text)) return text
  return undefined
}

import { afterEach, describe, expect, it, vi } from 'vitest'
import { passportSessionState, profileCookieFiles } from '../src/doubao-auth.ts'

/**
 * The window that closed two seconds after it opened.
 *
 * A dedicated profile is REUSED between sign-ins, so the second attempt to add an account
 * found a complete jar already sitting in the browser — `sessionid`, `sid_tt`, `uid_tt` and
 * all — and the old loop treated "every cookie is here" as "the sign-in finished". It
 * returned, the caller closed the window, and the user watched it flash.
 *
 * The cookies being present is not the question. The question is whether the passport still
 * accepts them, and only the server can answer it. These tests pin that three-way answer down,
 * because the fix is entirely in the difference between the three:
 *
 *   live    — return, store, close the window
 *   dead    — wipe the jar and put the window back on the sign-in page
 *   unknown — keep waiting; neither close nor store
 *
 * Collapsing `unknown` into either neighbour re-creates a bug: into `live` it stores an
 * unverified session, into `dead` it throws away a working sign-in on a flaky network.
 */
describe('the passport verdict on a harvested jar', () => {
  const cookies = { sessionid: 'abc123', sid_tt: 's1', uid_tt: 'u1' }
  const userAgent = 'Mozilla/5.0 Chrome/147.0.0.0 SamanthaDoubao/2.31.4'

  /** Answer the next `fetch` with one JSON body, and record what was asked. */
  const answer = (body: unknown, init: { ok?: boolean } = {}) => {
    const calls: { url: string; headers?: Record<string, string> }[] = []
    vi.stubGlobal('fetch', (url: string, options: { headers?: Record<string, string> } = {}) => {
      calls.push({ url, ...(options.headers === undefined ? {} : { headers: options.headers }) })
      return Promise.resolve({
        ok: init.ok ?? true,
        json: () => Promise.resolve(body),
      })
    })
    return calls
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('calls a jar with a user id live', async () => {
    answer({ data: { error_code: 0, user_id: 7300000000000000000, name: '豆包用户' } })
    expect(await passportSessionState(cookies, userAgent)).toBe('live')
  })

  it('calls a jar with only a name live', async () => {
    // The passport has answered with a name and no numeric id; a name is a live account.
    answer({ data: { name: '豆包用户' } })
    expect(await passportSessionState(cookies, userAgent)).toBe('live')
  })

  it('calls a jar the passport refuses dead', async () => {
    // What a session retired by a sign-in elsewhere leaves behind: a 200 with an error code.
    answer({ data: { error_code: 10001, name: '' } })
    expect(await passportSessionState(cookies, userAgent)).toBe('dead')
  })

  it('calls a 200 with no account document dead', async () => {
    answer({})
    expect(await passportSessionState(cookies, userAgent)).toBe('dead')
  })

  it('treats a network failure as unknown, not dead', async () => {
    // Offline is not "the session is over". Wiping the profile here would log the user out
    // every time the network hiccups during a sign-in.
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')))
    expect(await passportSessionState(cookies, userAgent)).toBe('unknown')
  })

  it('treats a server error as unknown, not dead', async () => {
    answer({ data: { user_id: 1 } }, { ok: false })
    expect(await passportSessionState(cookies, userAgent)).toBe('unknown')
  })

  it('treats an unreadable body as unknown', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve({
      ok: true,
      json: () => Promise.reject(new Error('not json')),
    }))
    expect(await passportSessionState(cookies, userAgent)).toBe('unknown')
  })

  it('asks the same endpoint the card uses for the account name', async () => {
    const calls = answer({ data: { user_id: 42 } })
    await passportSessionState(cookies, userAgent)
    expect(calls[0]?.url).toBe('https://www.doubao.com/passport/account/info/v2/')
    // The jar has to travel, or the question is "is anyone signed in" rather than "is THIS
    // jar signed in" — and the answer would be live for a session this plugin does not hold.
    expect(calls[0]?.headers?.['cookie']).toContain('sessionid=abc123')
    expect(calls[0]?.headers?.['User-Agent']).toContain('SamanthaDoubao/')
  })
})

/**
 * The jar the profile keeps on disk.
 *
 * Sign-out has to delete it: the stored session and the browser's copy are two halves of one
 * state, and forgetting the second is what let the next 「添加账号」 open on a dead jar and
 * close itself.
 */
describe('the profile cookie stores', () => {
  it('names both layouts Chromium has used', () => {
    const files = profileCookieFiles()
    const normalized = files.map(file => file.replace(/\\/gu, '/'))
    // Modern: Default/Network/Cookies. Older: Default/Cookies.
    expect(normalized.some(file => file.endsWith('/Default/Network/Cookies'))).toBe(true)
    expect(normalized.some(file => file.endsWith('/Default/Cookies'))).toBe(true)
  })

  it('keeps them all inside the dedicated profile', () => {
    for (const file of profileCookieFiles()) {
      expect(file.replace(/\\/gu, '/')).toContain('/.dsh/doubao-browser-profile/')
    }
  })
})

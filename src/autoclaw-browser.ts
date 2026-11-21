/**
 * AutoClaw's sign-in: a browser window on its own site, and the tokens its storage holds.
 *
 * WHY NOT THE TWO DOCUMENTED DOORS
 *
 *   · SMS (domestic) — needs a phone number and a code typed into a card. Workable, but it asks
 *     the user to transcribe two things when the site already has a signed-in session.
 *   · Z.ai OAuth (international) — its `state.nh` field is an unsolved 64-hex value, and the
 *     upstream notes record that leaving `state` to the authorization page makes the flow stall
 *     at `chat.z.ai` with no callback ever arriving.
 *
 * The site itself signs in fine, and — measured — the credential lands in `localStorage` under
 * `autoglm/token` and `autoglm/refreshToken`, both prefixed with `Bearer `. That is the same door
 * MagiCrew uses, and the one a user already knows how to walk through.
 *
 * @module dsh-xdpool/autoclaw-browser
 */
import { closeLoginBrowser, launchLoginBrowser, waitForCredential, type BrowserSession } from './browser-login.ts'
import type { AutoclawSite } from './autoclaw-protocol.ts'

/** What one browser sign-in produced. */
export interface AutoclawBrowserResult {
  accessToken: string
  refreshToken?: string
  deviceId?: string
  userId?: string
}

/**
 * Read the four keys in one evaluation.
 *
 * The values are stored JSON-encoded strings (`"Bearer eyJ…"`), so each is parsed once to unwrap
 * the quotes — reading `localStorage.getItem` directly returns the quotes as part of the token,
 * and a request carrying `"Bearer …"` with the quote is refused as malformed.
 */
const READ_CREDENTIALS = `(() => {
  const read = (k) => {
    try {
      const raw = localStorage.getItem(k)
      if (!raw) return ""
      let value = raw
      try {
        const parsed = JSON.parse(raw)
        if (typeof parsed === "string") value = parsed
        else if (parsed && typeof parsed === "object") value = String(parsed.value ?? parsed.token ?? "")
      } catch {}
      return String(value).replace(/^Bearer\\s+/i, "").trim()
    } catch { return "" }
  }
  const token = read("autoglm/token")
  if (!token || token.indexOf("eyJ") !== 0) return ""
  return JSON.stringify({
    accessToken: token,
    refreshToken: read("autoglm/refreshToken"),
    deviceId: read("autoglm/deviceId"),
    userId: read("autoglm/userId"),
  })
})()`

/** The host to match a tab against. */
function hostOf(site: AutoclawSite): string {
  try {
    return new URL(site.web).hostname.replace(/^www\./u, '')
  } catch {
    return 'autoglm'
  }
}

/**
 * Open AutoClaw's site and wait for the user to sign in there.
 *
 * `previousToken` is passed so an already-open tab that still holds the old session does not
 * answer instantly and look like a fresh sign-in.
 */
export async function autoclawBrowserSignIn(input: {
  site: AutoclawSite
  previousToken?: string
  timeoutMs?: number
}): Promise<AutoclawBrowserResult | undefined> {
  let session: BrowserSession | undefined
  try {
    session = await launchLoginBrowser(input.site.web, input.site.id)
    const raw = await waitForCredential({
      session,
      hostFragment: hostOf(input.site),
      read: READ_CREDENTIALS,
      timeoutMs: input.timeoutMs ?? 300_000,
      accept: (value) => {
        if (input.previousToken === undefined || input.previousToken === '') return true
        try {
          const parsed = JSON.parse(value) as { accessToken?: string }
          return parsed.accessToken !== input.previousToken
        } catch {
          return true
        }
      },
    })
    if (raw === undefined || raw === '') return undefined
    const parsed = JSON.parse(raw) as {
      accessToken?: string
      refreshToken?: string
      deviceId?: string
      userId?: string
    }
    if (typeof parsed.accessToken !== 'string' || parsed.accessToken === '') return undefined
    return {
      accessToken: parsed.accessToken,
      ...(typeof parsed.refreshToken === 'string' && parsed.refreshToken !== ''
        ? { refreshToken: parsed.refreshToken }
        : {}),
      ...(typeof parsed.deviceId === 'string' && parsed.deviceId !== '' ? { deviceId: parsed.deviceId } : {}),
      ...(typeof parsed.userId === 'string' && parsed.userId !== '' ? { userId: parsed.userId } : {}),
    }
  } finally {
    await closeLoginBrowser(session)
  }
}

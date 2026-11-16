/**
 * Whether a browser request may reach this plugin's routes.
 *
 * THE PROBLEM
 *
 * The plugin's own routes accepted only a loopback `Origin` (or none at all). That is correct
 * when the UI is opened at `127.0.0.1:3080`, and wrong the moment it is opened any other way:
 * behind `tailscale serve`, a phone on the same LAN, or any reverse proxy, the browser sends the
 * PUBLIC hostname as `Origin` — so every mutating call answered `403 origin-not-trusted` while
 * the read-only ones worked, because a GET the page issues from `fetch()` without credentials
 * carries no `Origin` at all. The card showed its data and refused every button.
 *
 * The host had already decided this was allowed: `connection.trustedHosts` names the authorities
 * a deployment serves, and the host's own `/api` bridge accepts them. The plugin was the only
 * thing still saying no.
 *
 * WHAT IS ACCEPTED
 *
 *   1. No `Origin` — a same-origin request, and the ordinary case for the card's own fetches.
 *   2. A loopback `Origin` — the default deployment.
 *   3. An `Origin` whose authority matches a configured `trustedHosts` entry.
 *   4. An `Origin` whose hostname equals the request's own `Host` — same-origin in the browser's
 *      sense. A cross-site attacker cannot forge this: the browser sets `Origin` from the page's
 *      real origin and `Host` from the URL it dialled, so they agree only when the page really
 *      is served from the address being called.
 *
 * Rule 4 is what makes a reverse proxy work without configuration; rule 3 is what makes an
 * explicitly configured surface work even when the proxy rewrites `Host`.
 *
 * @module dsh-xdpool/origin-trust
 */
import type { IncomingMessage } from 'node:http'

/** The authorities a deployment says it serves, as the host reports them. */
export type TrustedHosts = readonly string[]

/** Whether a hostname is the local machine. */
function isLoopback(hostname: string): boolean {
  const bare = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
  return bare === 'localhost' || bare === '127.0.0.1' || bare === '::1' || bare.startsWith('127.')
}

/**
 * A `trustedHosts` entry and an origin, compared the way the host compares them.
 *
 * An entry WITH a port matches exactly; a port-less entry matches the hostname on any port. The
 * host's own `isTrustedAuthority` works this way, and agreeing with it matters more than picking
 * a rule of our own — two components disagreeing about trust is how this defect happened.
 */
function matchesTrusted(origin: URL, trusted: TrustedHosts): boolean {
  for (const entry of trusted) {
    if (typeof entry !== 'string' || entry.trim() === '') continue
    const wanted = entry.trim().toLowerCase()
    const hasPort = /:\d+$/u.test(wanted)
    if (hasPort) {
      if (origin.host.toLowerCase() === wanted) return true
      continue
    }
    // A port-less entry compares the hostname, ignoring the port entirely.
    if (origin.hostname.toLowerCase() === wanted) return true
  }
  return false
}

/** The `Host` header's hostname, or undefined when it is absent or unparseable. */
function hostHeaderName(req: IncomingMessage): string | undefined {
  const host = req.headers.host
  if (typeof host !== 'string' || host === '') return undefined
  try {
    return new URL(`http://${host}`).hostname.toLowerCase()
  } catch {
    return undefined
  }
}

/**
 * Decide whether `req` may act.
 *
 * `trusted` is read fresh on each call so a configuration change reaches the next request
 * without a plugin restart — the host's own bridge does the same.
 */
export function originTrusted(req: IncomingMessage, trusted: TrustedHosts = []): boolean {
  const origin = req.headers.origin
  /**
   * No `Origin` at all.
   *
   * A same-origin `fetch()` in Chromium omits it for GET/HEAD, and the card's own reads are
   * exactly that. Refusing this would break the page on the machine it was installed on.
   */
  if (typeof origin !== 'string' || origin === '') return true

  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return false
  }

  if (isLoopback(url.hostname)) return true
  if (matchesTrusted(url, trusted)) return true

  /**
   * Same-origin, judged by the browser's own two headers.
   *
   * This is the case a reverse proxy produces: the page is served from
   * `https://node.tailXXXX.ts.net`, so that is what `Origin` says, and the request arrives at a
   * plugin route on that same authority — so `Host` says the same thing. A malicious page on
   * another site cannot make these agree.
   */
  const host = hostHeaderName(req)
  if (host !== undefined && url.hostname.toLowerCase() === host) return true

  return false
}

/**
 * What an HTTP status means to a user, per channel.
 *
 * EVERY CHANNEL SHOWED `HTTP 401`
 *
 * A 401 is not "the request failed" — it is "your credential is no longer accepted, sign in
 * again", which is a different action from retrying. Reporting the bare status sent users to
 * check their network when the fix was to paste a fresh key. These helpers turn the two statuses
 * that actually mean something into a sentence, and leave everything else alone so a genuinely
 * unexpected status still reads as what it is.
 *
 * @module dsh-xdpool/credential-errors
 */

/** What a status means for a credential, or undefined when it means nothing special. */
export function credentialMessage(status: number, channel: string): string | undefined {
  if (status === 401) return `${channel} 的登录态已失效，请重新登录一次`
  if (status === 403) return `${channel} 拒绝了这个凭据（可能权限不足或被风控），请重新登录或换一个账号`
  if (status === 429) return `${channel} 触发了限流，稍等一会儿再试`
  return undefined
}

/**
 * Turn a failed response into a sentence.
 *
 * `body` is whatever text the vendor returned; when it carries something readable the sentence
 * keeps it, because a vendor's own words are often more specific than anything generic.
 */
export function explainFailure(input: {
  status: number
  channel: string
  body?: string
}): string {
  const known = credentialMessage(input.status, input.channel)
  const detail = input.body === undefined ? '' : input.body.trim().slice(0, 200)
  if (known !== undefined) return detail === '' ? known : `${known}（上游：${detail}）`
  return detail === '' ? `HTTP ${String(input.status)}` : `HTTP ${String(input.status)}：${detail}`
}

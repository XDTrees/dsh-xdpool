import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ROUTE_OWNED_ELSEWHERE } from './status-paths.ts'
/**
 * Mount the vendored free-channel pack.
 *
 * Thirteen login channels — CodeArts, WorkBuddy 国内版/国际版, LobsterAI, Qoder ×2,
 * TRAE, Cline, Loomy, Raccoon, MiniMax Code, ZCode and Gemini — arrive as one
 * MIT-licensed bundle we carry rather than re-implement. Each is a real protocol
 * adapter with its own login handshake; rewriting twelve of them here would only
 * produce a slower, drift-prone copy of work that upstream already validates.
 *
 * Provenance and rebuild notes live in `vendor/channel-pack/NOTICE.md`.
 */
/** Directory of this module, used to locate the sibling `vendor/` tree. */
const HERE = dirname(fileURLToPath(import.meta.url))
/**
 * Where the pack lives relative to the built entry.
 *
 * `src/index.ts` compiles to `lib/index.js`, so from there `vendor/` is one level
 * up. Kept as a computed path rather than `import.meta.resolve` because the
 * installed layout is a flat `node_modules/dsh-xdpool/{lib,vendor}`,
 * which is not resolvable as a bare specifier.
 */
const PACK_ENTRY = join(HERE, '..', 'vendor', 'channel-pack', 'pack.js')
/**
 * `PACK_ENTRY` as a URL, which is the only spelling `import()` accepts.
 *
 * On POSIX the two are interchangeable enough that the bug hid for a while; on
 * Windows a bare `D:\...` path is not a specifier at all, and the loader answers
 * `Only URLs with a scheme in: file, data, node, and electron are supported`
 * before it ever looks at the disk. `pathToFileURL` also handles the drive
 * letter and the backslashes, so this is the portable spelling rather than a
 * Windows special case.
 */
const PACK_ENTRY_URL = pathToFileURL(PACK_ENTRY).href
/** The minimal shape we consume. The pack exports more; we need only these. */
interface ChannelPackModule {
  name?: string
  inject?: readonly string[]
  apply?: (ctx: unknown, config?: unknown) => unknown
}
/** What the card shows when the pack could not be mounted. */
export type ChannelPackState =
  | { state: 'pending' }
  | { state: 'ready'; providers: number }
  | { state: 'unavailable'; reason: string }
export interface MountedChannelPack {
  /** Current mount state, read by the card on every poll. */
  state(): ChannelPackState
}
/** The ids the pack registers. Spelled out rather than derived from the table. */
export type ChannelProviderId =
  | 'codearts'
  | 'buddy'
  | 'workbuddy'
  | 'qoder'
  | 'qodercn'
  | 'lobsterai'
  | 'trae'
  | 'cline'
  | 'loomy'
  | 'raccoon'
  | 'minimax'
  | 'zcode'
  | 'gemini'
export interface ChannelDescriptor {
  id: ChannelProviderId
  name: string
  org: string
  /**
   * The vendor's own API host, when the pack publishes one.
   *
   * Only two of the thirteen carry it: the pack's `buddy` adapter names
   * `apiDomain: "copilot.tencent.com"` and its `workbuddy` adapter names
   * `apiDomain: "www.workbuddy.ai"`. The other eleven have no such field —
   * they carry a `portalBase` / `apiBase` constant instead, which is where the
   * user finishes a sign-in rather than where requests go.
   *
   * This is a real value from the pack, not a guess, and that is the whole
   * reason it is optional. A card whose subtitle printed a domain we inferred
   * would be the one line on the card a user could not verify, and they would
   * have no way to tell our inference from the vendor's.
   */
  domain?: string
  accent: string
  note: string
  /**
   * How the card offers to sign in.
   *
   * Only `browser` exists any more. A second kind (`browser+sms`) used to be
   * here for Loomy, because the reference build's roster marked it
   * `login: 'browser+sms'` — its note read "微信扫码，或短信验证码备用". Copying
   * that flag made the card print "登录（短信）" on a channel whose card sat
   * next to twelve buttons reading "登录", and the user asked, fairly, "这个怎么
   * 还有个短信". The pack drives the actual flow: `account.create` returns a
   * `loginUrl` and the user finishes there, so the phone-code fallback is
   * something the vendor's own page offers, not something this card chooses.
   * Carrying it here claimed a choice we do not make.
   */
  login: 'browser'
  /**
   * Whether the vendor offers a phone-code path on its own login page.
   *
   * Raccoon's local page (`/raccoon/login` in the pack) puts a QR code and an
   * SMS form on the same screen, and its QR is the one that goes stale while
   * the user reads the message: the poll never reports "expired", so the page
   * just sits there until the five-minute timeout. The card says so next to the
   * button rather than leaving the user to rediscover it — the alternative
   * (nothing) cost the user a login attempt per channel.
   */
  smsHint?: boolean
  /**
   * What the pack can tell us about this vendor's credits.
   *
   * Presence of the field is itself the answer: it means `credits.balances`
   * has a branch for this provider, so a balance can be shown at all. The
   * shape of that balance is not ours to invent — codearts returns a bare
   * number, cline returns US dollars, zcode returns token buckets and gemini
   * returns quota percentages — so `unit` says which of those the user is
   * looking at rather than assuming one currency for thirteen vendors.
   *
   * `claim` is `credits.claimAll` (daily check-in), `status` is
   * `credits.status` (today's claim badge). Both are absent for vendors whose
   * backend has no such endpoint; the pack answers "unsupported provider"
   * there, and a button that always fails is worse than no button.
   */
  credits?: {
    claim?: boolean
    status?: boolean
    unit?: 'tokens' | 'dollars'
    /** Percentages per quota bucket rather than a credit total. */
    quota?: boolean
  }
}
/**
 * The thirteen channels the pack registers, with the copy the card shows.
 *
 * `org`, `accent` and the login flow are lifted from the pack's own table
 * (`CHANNEL_PROVIDERS` in its client bundle) so the card and the pack cannot
 * disagree about what a channel is. Nothing here decides behaviour — the pack
 * still owns the protocol — so a channel that changes its login flow upstream
 * needs a data edit here, not a code change.
 *
 * `note` is the exception: it is ours, not the pack's, and it is Chinese on
 * purpose. The user asked for each card to state in Chinese how much of that
 * vendor's model usage is actually free, because the roster they were reading
 * said "每日免费额度" eleven times over — a phrase that names the existence of a
 * free allowance without ever saying what it is. Each line below names the
 * models on the free line and, where the vendor publishes a figure, the figure
 * itself. Where no figure is published, the line says so rather than inventing
 * a number: a quota we guessed would be the one number on the card a user would
 * plan their day around.
 */
export const REGISTERED_CHANNELS: readonly ChannelDescriptor[] = [
  {
    id: 'codearts',
    name: 'CodeArts',
    org: '华为云',
    accent: '#C7000B',
    note: '已开通免费体验套餐，自动续期不收费；新人积分 + DeepSeek · GLM · openPangu 每日免费额度',
    login: 'browser',
    credits: { claim: true },
  },
  {
    id: 'buddy',
    name: 'WorkBuddy 国内版',
    org: '腾讯',
    domain: 'copilot.tencent.com',
    accent: '#0A7AFF',
    note: '与 CodeBuddy 共用端点：DeepSeek · Kimi · GLM 免费线，每日赠送积分',
    login: 'browser',
    credits: { claim: true, status: true },
  },
  {
    id: 'workbuddy',
    name: 'WorkBuddy 国际版',
    org: '腾讯',
    domain: 'www.workbuddy.ai',
    accent: '#0B63CE',
    note: '独立端点与账号体系，积分与国内版不互通；国际版后端没有每日签到接口',
    login: 'browser',
    credits: { status: true },
  },
  {
    id: 'lobsterai',
    name: 'LobsterAI',
    org: '有道',
    accent: '#FF6A00',
    note: '每日签到领积分，积分换模型调用额度',
    login: 'browser',
    credits: { claim: true },
  },
  {
    id: 'qoder',
    name: 'Qoder 国际版',
    org: '阿里云',
    accent: '#615CED',
    note: '每日 100 Credits，加密推理端点',
    login: 'browser',
    credits: { claim: true },
  },
  {
    id: 'qodercn',
    name: 'Qoder 国内版',
    org: '阿里云',
    accent: '#7A6CF0',
    note: '每日 100 Credits，国内端点与模型池',
    login: 'browser',
    credits: { claim: true },
  },
  {
    id: 'trae',
    name: 'TRAE',
    org: '字节跳动',
    accent: '#00BFA6',
    note: '手机号注册即送免费额度，按天重置',
    login: 'browser',
    credits: { claim: true },
  },
  {
    id: 'cline',
    name: 'Cline',
    org: 'Cline Bot',
    accent: '#5B5BD6',
    note: '绑定 GitHub 账号后送美元计价的免费额度；其后端没有每日签到接口',
    login: 'browser',
    // US dollars, not credits — the pack scales Cline's balance by its own
    // factor, so a "credits" label here would be a unit error, not a rounding.
    credits: { unit: 'dollars' },
  },
  {
    id: 'loomy',
    name: 'Loomy',
    org: '讯飞星火',
    accent: '#2F6BFF',
    note: '星火模型每日免费额度，扫码或手机号均可登录',
    login: 'browser',
    credits: { claim: true },
  },
  {
    id: 'raccoon',
    name: 'Raccoon',
    org: '商汤',
    accent: '#00A6A6',
    note: '手机号注册即送免费额度；每日积分由服务端自动发放，登录奖励需在「新手任务」领取',
    login: 'browser',
    smsHint: true,
    /**
     * `credits: {}` is deliberate and does NOT mean "nothing to collect".
     *
     * Raccoon pays two different things and they arrive two different ways:
     *
     *   - the DAILY points are credited by the server on its own schedule, so
     *     there is no check-in call to make. `credits.claimAll` answers "不支持每日
     *     签到" for this channel, and that answer is correct;
     *   - the DESKTOP LOGIN BONUS is a one-off, per account, and it is collectable
     *     — through `onboarding.claim`, not through the daily claim.
     *
     * The empty object is what keeps the daily "Claim credits" button off this card
     * (pressing it would only ever print that refusal). The login bonus has its own
     * button, which the card draws for the channels in `ONBOARDING_CHANNELS`.
     * `credits` staying present keeps the balance row on the card.
     */
    credits: {},
  },
  {
    id: 'minimax',
    name: 'MiniMax Code',
    org: 'MiniMax',
    accent: '#E4007F',
    note: '设备码 + PKCE 登录，每日签到领额度',
    login: 'browser',
    credits: { claim: true, status: true },
  },
  {
    id: 'zcode',
    name: 'ZCode',
    org: '智谱',
    accent: '#3B6EF6',
    note: 'GLM 模型按 token 计免费额度，需本机可开浏览器',
    login: 'browser',
    credits: { claim: true, unit: 'tokens' },
  },
  {
    id: 'gemini',
    name: 'Gemini Code Assist',
    org: 'Google',
    accent: '#4285F4',
    note: '个人 Google 账号的免费配额，走本地回调 OAuth',
    login: 'browser',
    // Quota, not credits: Gemini reports percentage windows, so a total is
    // the wrong number to print even though the pack returns one.
    credits: { quota: true },
  },
]
/**
 * The two channels this plugin already serves from its own account pool.
 *
 * Mounting the pack alongside them means both register an adapter for the same
 * id. The pack's `registerAdapterIdempotent` swallows duplicate registrations and
 * keeps the incumbent, and our own registration happens first, so the account
 * pool wins and the pack's duplicate is skipped. This set is what the card uses
 * to say "already handled above" instead of offering a login for a channel the
 * user manages elsewhere.
 */
export const POOL_OWNED_CHANNELS: ReadonlySet<string> = new Set(['buddy', 'workbuddy'])
/** Whether `value` names a channel this build knows about. */
export function isChannelProviderId(value: string): value is ChannelProviderId {
  return REGISTERED_CHANNELS.some((channel) => channel.id === value)
}
export function channelPackEntryPath(): string {
  return PACK_ENTRY
}
/** Whether the pack and its WASM sibling are both present on disk. */
export function channelPackFilesPresent(): boolean {
  return existsSync(PACK_ENTRY) && existsSync(join(dirname(PACK_ENTRY), 'qoder-auth-wasm.wasm'))
}
/**
 * Mount the pack on `ctx`.
 *
 * Failure-tolerant on purpose: the pack is a bonus lane, so a host composition
 * that lacks `credentials`, `commands` or `llm` must still load the account
 * pool. The caller is expected to have gated the call on the pack's own declared
 * `inject` (all three services); this function then only has to survive a load
 * or mount failure, which it reports rather than throwing.
 *
 * THE `/api/channel-pack` ROUTE IS NOT OURS TO REGISTER
 *
 * This bundle is byte-identical to the one the sibling login-channel build
 * (`dsh-our-free-model`) already mounts, and both register the exact same fetch
 * route. The host's connection service throws on a duplicate — `connection:
 * exact Fetch route "/api/channel-pack" is already registered` — and it exposes
 * only `register`, with no query for what is already claimed, so nothing here
 * can ask "is that mine?" before reaching for it. Whichever plugin mounts first
 * owns the route, and the other's card talks to the owner's pack, which serves
 * the same thirteen channels either way.
 *
 * THE SAME COLLISION ARRIVES EARLIER, AS A CORDIS SERVICE
 *
 * A second copy of the pack does not reach the fetch route at all. Its
 * `apply` builds `new CodeArtsAuth(ctx)` (:67588) long before it registers the
 * RPC endpoints, and the cordis `Service` base class registers itself in its
 * constructor (`@deepseek-ai/cordis`, `Service.constructor` →
 * `ctx.reflect.provide`), which throws `service "codeartsAuth" has been
 * registered at <our-free-model>` on the first duplicate. That is why the page
 * used to print "the login channel could not start" while scanning worked
 * perfectly: the winner had the route, the loser never got as far as asking
 * for it. Both throws describe one event — a second mount of an identical pack
 * — so both are reported as the same cosmetic outcome.
 *
 * Losing that race is therefore a cosmetic failure, not a functional one, and it
 * is reported as such: the page says the channels are already served elsewhere
 * and offers the sibling's own page, instead of printing a raw host error at the
 * user. The distinction is kept in the state because "someone else owns it" and
 * "this host cannot run it" call for different wording.
 *
 * The dynamic import is deliberate even though the file is vendored: pulling a
 * 68k-line bundle into the module graph would add its own top-level cost to
 * every startup of a plugin that is really an account pool, and the pack is only
 * needed when the user opens the channel page.
 *
 * Returns a handle whose `state()` reports what happened. A silently absent
 * channel list is the one failure mode a user cannot diagnose for themselves.
 */
export function mountChannelPack(ctx: unknown, logger?: ChannelPackLogger): MountedChannelPack {
  let state: ChannelPackState = { state: 'pending' }
  if (!channelPackFilesPresent()) {
    state = {
      state: 'unavailable',
      reason: 'vendor/channel-pack is missing from the installed package',
    }
    logger?.warn?.(`[xdpool] ${state.reason}; the login channels are disabled`)
    return { state: () => state }
  }
  void import(PACK_ENTRY_URL)
    .then((loaded) => {
      const pack = loaded as ChannelPackModule
      if (typeof pack.apply !== 'function') {
        state = { state: 'unavailable', reason: 'the channel pack exposes no apply()' }
        logger?.warn?.(`[xdpool] ${state.reason}; the login channels are disabled`)
        return
      }
      // `disableOpencode` because OpenCode is not an IDE this host runs. The pack
      // would otherwise register an OpenCode account lane with no way to reach
      // it, and its `account.create` for that provider would fail at the point
      // where a user is waiting on a login.
      pack.apply(ctx, { disableOpencode: true })
      state = { state: 'ready', providers: REGISTERED_CHANNELS.length }
      logger?.info?.(`[xdpool] free-channel pack mounted (${REGISTERED_CHANNELS.length} login channels)`)
    })
    .catch((error: unknown) => {
      // Losing the mount race to the sibling build is one event with two
      // spellings: the fetch route if the pack got that far, the cordis service
      // if it did not. Both mean "the other copy already owns this", so both get
      // the sibling's own words rather than the host's internal wording.
      if (isDuplicateMountError(error)) {
        state = { state: 'unavailable', reason: ROUTE_OWNED_ELSEWHERE }
        logger?.info?.(
          `[xdpool] the login channels are already served by another plugin (${ROUTE_OWNED_ELSEWHERE}); the account pool is unaffected`,
        )
        return
      }
      state = { state: 'unavailable', reason: errorMessage(error) }
      logger?.warn?.(`[xdpool] free-channel pack unavailable (${state.reason}); the account pool is unaffected`)
    })
  return { state: () => state }
}
/**
 * Why a duplicate mount is not a failure worth an error line.
 *
 * Re-exported from the wire module so both halves cannot drift: the host writes
 * it into the document's `reason`, and the card compares against it to choose
 * between "this host cannot run the channels" and "another plugin already runs
 * them". The value lives in `status-paths.ts` because that module is what the
 * browser bundle is allowed to import by value — `channels.ts` reaches `node:fs`.
 */
export { ROUTE_OWNED_ELSEWHERE }
/**
 * Whether this throw means another copy of the pack is already mounted.
 *
 * Both hosts spellings are matched, each on both halves of its sentence, because
 * the API offers no error type and no code — the message is the only signal.
 *
 * - `connection: exact Fetch route "/api/channel-pack" is already registered`
 *   from `@deepseek-ai/dsh-client-connection`: the pack reached its own
 *   `connection.fetch.register` and the sibling owns that route. Half-matched on
 *   purpose: a message that merely mentions a route is not proof of a collision,
 *   and treating one as the other would hide a real mount failure behind "someone
 *   else has it".
 * - `service "codeartsAuth" has been registered at <our-free-model>` from
 *   `@deepseek-ai/cordis`: the sibling already constructed the same service
 *   class, so this copy dies before it reaches the route. Half-matched again —
 *   `service "…"` is generic enough that an unrelated provider clash would
 *   otherwise be misreported as a takeover.
 *
 * The `<our-free-model>` in the message is the winning fiber's name, not a
 * contract, so no name is matched: this build must keep working when the sibling
 * is absent.
 */
function isDuplicateMountError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const message = error.message
  const route = /exact Fetch route/u.test(message) && /already registered/u.test(message)
  const service = /service "/u.test(message) && /has been registered at </u.test(message)
  return route || service
}
/**
 * The shapes the card reads back from the pack's own RPC route.
 *
 * Declared here rather than imported: the bundle is untyped and publishes no
 * types, so a cast at the call site would hide the real contract — and this
 * contract is the one thing on the card that is not ours to change.
 */
export interface ChannelRpcEnvelope {
  ok: boolean
  value?: unknown
  error?: { code?: string; message?: string }
}
/** `account.create` → the account being created and where to sign in. */
export interface ChannelAccountCreated {
  accountId: string
  loginUrl: string
}
/** `login.poll` → whether the login finished. */
export interface ChannelLoginPoll {
  done: boolean
  success?: boolean
  error?: string
}
/** `account.list` → one connected account. */
export interface ChannelAccount {
  id: string
  provider: string
  nickname?: string
  enabled?: boolean
  /**
   * When the credential runs out, in epoch milliseconds; absent when the
   * vendor does not publish an expiry or the login never finished.
   *
   * The two are not the same and are not merged here: a placeholder row
   * (nickname still the generated id) and a completed login can both exist in
   * the pack's list, and only the difference in this field tells them apart.
   */
  expiresAt?: number
  /** Whether the pack can renew this credential without a new login. */
  refreshable?: boolean
}
/** What `apply` and `inject` look like on the bundle. */
export interface ChannelPackLogger {
  info?: (message: string) => void
  warn?: (message: string) => void
}
function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 300)
  return String(error).slice(0, 300)
}
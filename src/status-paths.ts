/**
 * Node-free constants and types shared by the Host and browser halves of the
 * XD Pool settings card.
 *
 * Pool's runtime state already lives in `src/status.ts` (`buildStatus` /
 * `WorkBuddyStatus`); this module only carves the cross-domain (Host→browser)
 * JSON document into a shape that stays token-free and matches what the
 * browser card renders. Route paths are plugin-owned and mounted on the Host's
 * same-origin web server (see `src/web-status.ts`).
 *
 * @module dsh-xdpool/status-paths
 */
/** Plugin-owned read-only pool status endpoint (account rows + models + shim). */
export const POOL_STATUS_PATH = '/plugins/dsh-xdpool/status'
/** Plugin-owned local account rescan endpoint (re-read desktop snapshots). */
export const POOL_RESCAN_PATH = '/plugins/dsh-xdpool/accounts/rescan'
/**
 * Re-fetch the upstream model catalog for both regions.
 *
 * Separate from {@link POOL_RESCAN_PATH} because they answer different
 * questions, and conflating them misled users: "detect accounts again" only
 * re-read the desktop snapshots, so it could NOT recover a model list that had
 * fallen back to the static table after a failed startup fetch. The only way
 * out was restarting DSH.
 */
export const POOL_CATALOG_REFRESH_PATH = '/plugins/dsh-xdpool/models/refresh'
/** Plugin-owned cooldown reset endpoint (clear all 429 cooldowns). */
export const POOL_RESET_COOLDOWN_PATH = '/plugins/dsh-xdpool/cooldowns/reset'
/** Plugin-owned daily check-in action endpoint (claim today's reward). */
export const POOL_CHECKIN_PATH = '/plugins/dsh-xdpool/checkin'
/** Plugin-owned model-selection save endpoint (writes the settings section). */
export const POOL_MODELS_SAVE_PATH = '/plugins/dsh-xdpool/models/save'
/** Switch one account in or out of the pool (card toggle). */
export const POOL_ACCOUNT_DISABLE_PATH = '/plugins/dsh-xdpool/accounts/disabled'
/**
 * Throw one account out of the pool for good, or take it back.
 *
 * Separate from the disable route because the semantics differ: disabling is a
 * rotation preference the account survives, ignoring survives the account.
 */
export const POOL_ACCOUNT_IGNORE_PATH = '/plugins/dsh-xdpool/accounts/ignored'
/** Run one automation job immediately, so the card can verify it on demand. */
export const POOL_AUTOMATION_RUN_PATH = '/plugins/dsh-xdpool/automation/run'
/** Set or clear one account's reserved-credit floor. */
export const POOL_CREDIT_RESERVE_PATH = '/plugins/dsh-xdpool/accounts/credit-reserve'
/**
 * Name the account to try first, or hand the choice back to the strategy.
 *
 * A route rather than a settings write for the reason the ignore list is a file:
 * the CLI has no settings service, so a card-only settings key could be written
 * by the card and never by `dsh-xdpool prefer`. The route owns the
 * write, pushes it into the pool immediately so the very next request sees it,
 * and is the one path both halves share.
 */
export const POOL_ACCOUNT_PREFER_PATH = '/plugins/dsh-xdpool/accounts/preferred'
/**
 * Read the aggregate lane's state: every registry provider, its saved setting
 * (never its key), and whether it can serve anything right now.
 *
 * Separate from {@link POOL_STATUS_PATH} because it answers a different
 * question — "what can I configure" rather than "what is my pool doing" — and
 * because its payload is the WHOLE roster. Folding 76 provider records into the
 * status document would make every 30-second poll of the pool card carry a
 * directory nobody reads most of the time.
 */
export const POOL_AGGREGATE_PATH = '/plugins/dsh-xdpool/aggregate'
/**
 * Save one aggregate provider's setting: its key, its on/off switch, its base-URL
 * override, or the model ids a listing round discovered.
 *
 * POST only, and one provider per request — read-modify-write on the host side,
 * so two tabs editing two providers cannot clobber each other.
 */
export const POOL_AGGREGATE_SAVE_PATH = '/plugins/dsh-xdpool/aggregate/save'
/**
 * Verify one provider's key with a cheap non-generating call, and report what
 * its listing answered.
 *
 * Its own route because it is the only aggregate action that talks to the
 * network: a probe must never run as a side effect of saving a setting, or
 * "save" would silently spend the user's rate limit.
 */
export const POOL_AGGREGATE_TEST_PATH = '/plugins/dsh-xdpool/aggregate/test'
/**
 * Send one real streaming call to one model and report how it answered.
 *
 * Its own route, and POST-only, for the same reason the provider probe is: this
 * is the one action in the plugin that spends the user's credits, so it must
 * never be reachable by a prefetch, a GET, or any side effect of opening a
 * settings page. A GET here would let a browser — or anything else that can
 * reach a loopback port — fire unlimited billed calls by walking URLs.
 *
 * `provider` and `model` are resolved through the host's own adapter registry
 * rather than through this plugin's lanes, because that registry is the only
 * place that knows which credential and endpoint a given provider id serves.
 */
export const POOL_MODEL_PROBE_PATH = '/plugins/dsh-xdpool/model/test'
/**
 * POST-only: ask what models several login channels contribute right now.
 *
 * A route rather than more fields on {@link POOL_CHANNELS_PATH} because the
 * answer changes as accounts come and go while the roster does not, and the
 * login page polls only its own logins — folding live per-provider catalogues
 * into the roster document would either go stale the moment someone signed in,
 * or make every page refresh spend a round trip on thirteen providers.
 *
 * Read from the host rather than from the pack's own `model.list`, because the
 * pack keeps only `id`, `name` and two flags and throws away exactly the fields
 * this is for. The host's catalogue is the same one the model picker reads, so
 * the two agree by construction instead of by luck.
 */
export const POOL_CHANNEL_MODELS_PATH = '/plugins/dsh-xdpool/channels/models'
/** The body of {@link POOL_CHANNEL_MODELS_PATH}. */
export interface PoolWebChannelModelsRequest {
  providers: readonly string[]
  /**
   * Model ids the caller already knows, per provider.
   *
   * The listing (`llm.listModels`) is the natural place to read a channel's ids
   * from, but it sits behind the pack's credential gate: a provider the host
   * considers invisible answers `[]`, and the card then had nothing to attach
   * facts to — which is why every channel row printed no window and "text
   * only". The ids are not in question here (the caller just rendered them from
   * `model.list`), so when they are supplied the host resolves facts for them
   * directly and only falls back to the listing for providers it was not told
   * about.
   */
  ids?: Readonly<Record<string, readonly string[]>>
}
/**
 * One model's facts, exactly as the host's catalogue spells them.
 *
 * Every optional field is absent when the host does not know it, which is the
 * common case: modalities are only reported by adapters that publish them, and a
 * missing window is missing rather than a default.
 */
export interface PoolWebChannelModel {
  id: string
  name: string
  contextWindow?: number
  maxTokens?: number
  inputModalities?: readonly string[]
  description?: string
}
/**
 * The answer, keyed by the provider ids that were asked about.
 *
 * A provider missing from the map was not answered for at all — not signed in,
 * or no adapter under that id. An empty array is a provider that was asked and
 * genuinely publishes nothing; the two are different and the page shows them
 * differently.
 */
export interface PoolWebChannelModels {
  models: Readonly<Record<string, readonly PoolWebChannelModel[]>>
}
/**
 * Fetch one provider's live model list and write it back as its discovered set.
 *
 * Separate from the probe on purpose. The probe ANSWERS; this one COMMITS — it
 * changes what the provider contributes to the picker — so it is its own route
 * with its own confirmation, and a failed round keeps the previous roster.
 */
export const POOL_AGGREGATE_DISCOVER_PATH = '/plugins/dsh-xdpool/aggregate/discover'
/**
 * The thirteen login channels the vendored pack provides.
 *
 * Separate from the aggregate document for the same reason: the two lanes answer
 * different questions. The aggregate roster is "what can I point a key at", the
 * channel list is "what can I scan a QR code into", and mixing them in one poll
 * would put a third-party directory on the critical path of the pool card.
 */
export const POOL_CHANNELS_PATH = '/plugins/dsh-xdpool/channels'
/**
 * The `reason` the channel document carries when the login-channel route is
 * already owned by another plugin.
 *
 * The pack we vendor is byte-identical to the one the sibling login-channel
 * build mounts, and both claim the same fetch route; the host has no query for
 * what is already registered, so the loser of that race can only tell it lost.
 * Both halves need the same string — the host to say it, the card to choose
 * between "this host cannot run the channels" and "another plugin already runs
 * them", which are opposite sentences — so it is declared with the other wire
 * constants rather than in `channels.ts`, which the browser bundle may not
 * import for value.
 */
export const ROUTE_OWNED_ELSEWHERE = 'already-mounted-elsewhere'
/**
 * The routing chains, and the whole model roster a member may name.
 *
 * One route for both because the editor cannot be drawn without the roster: a
 * member is chosen from a list, and a list of ids with no names, windows or
 * vendors is a list nobody can pick from. Reading two documents on one panel
 * open would also mean the roster could be a second older than the chains.
 */
export const POOL_COMBOS_PATH = '/plugins/dsh-xdpool/combos'
/**
 * Replace the whole chain list in one write.
 *
 * A single table replace rather than a per-chain patch: the editor's unit of
 * intent is "this is my routing table", and deleting one member is
 * indistinguishable from deleting that member's chain once ids are equal — so a
 * merge rule would have to guess, and a wrong guess silently resurrects a row the
 * user deleted.
 */
export const POOL_COMBOS_SAVE_PATH = '/plugins/dsh-xdpool/combos/save'
/**
 * The LAN relay's own state, and the only way to change it.
 *
 * One GET and one POST rather than a separate settings surface, because the relay
 * is a switch you have to be able to kill from the same card that turns it on —
 * a relay left listening on a network interface is the one failure here that
 * keeps mattering after the plugin is closed.
 */
export const POOL_RELAY_PATH = '/plugins/dsh-xdpool/relay'
/**
 * The pack's own management route, which the card posts to directly.
 *
 * Not a re-export of anything: the vendored bundle registers this path itself
 * and speaks its own RPC envelope (`{type, rpcId, method, payload}` →
 * `{type, rpcId, result}`). Proxying it through a second route would mean
 * translating that envelope in one direction and back in the other, for no gain
 * — the pack is on the same loopback origin as this card either way.
 *
 * Only three methods are ever sent: `account.create` to begin a login, `login.poll`
 * to watch it finish, and `account.list` to show what is connected. `provider.status`
 * was added so the account pool could mirror the login page's per-channel counts,
 * and it left again with that section: the user removed the mirror ("在扫码登录页
 * 登录过什么，这里就同步显示什么，这个不需要"), so nothing asks for counts now.
 * The method still exists in the pack for anyone who wants it; it is simply not on
 * this card's origin.
 */
export const CHANNEL_PACK_RPC_PATH = '/api/channel-pack'
/**
 * Every pack method our UI sends.
 *
 * The pack answers far more (credits.claim, opencode.*, and so on); this is the
 * list of what we actually ask for, split by what it is for:
 *
 * - Login: `account.create` to begin, `login.poll` to watch it finish,
 *   `account.list` to show what is connected.
 * - Pool page, per channel: `provider.status` to learn which channels hold
 *   accounts, `model.list` for the catalogue, `model.setDisabled` for a single
 *   toggle, `model.setAllDisabled` for the two bulk buttons.
 * - Per account: `account.test`, `account.refresh`, `account.update` to pause a
 *   sign-in, `account.delete` to remove it.
 * - Credits: `credits.balances` for the balance, `credits.status` for today's
 *   check-in badge, `credits.claimAll` for the claim button, and
 *   `usage.autoCheckin` for the one global automatic-claim switch.
 *
 * Note this is documentation, not enforcement: the vendored pack registers
 * `/api/channel-pack` itself and accepts anything it implements, so nothing at
 * runtime rejects a method outside this set. A test asserts that every
 * `callPack` call site in src/client is named here, which is what keeps the
 * list honest — widen it deliberately, never silently. Note the test only sees
 * literal `callPack('…')` sites, so the four account methods dispatched through
 * a computed `method` variable in ChannelPoolSection's `accountAction` are
 * listed here by hand and would not fail a test if a caller dropped them.
 */
export const CHANNEL_PACK_METHODS: ReadonlySet<string> = new Set([
  'account.create',
  'account.delete',
  'account.list',
  'account.refresh',
  'account.test',
  'account.update',
  'credits.balances',
  'credits.claimAll',
  'credits.status',
  'login.poll',
  'model.list',
  'model.setAllDisabled',
  'model.setContextBudget',
  'model.setDisabled',
  'provider.status',
  'usage.autoCheckin',
])
/**
 * Where a registry provider's key goes: `apiKey`, `baseUrl`, or `enabled`.
 */
export type PoolWebAggregatePatch =
  | {
      kind: 'provider'
      providerId: string
      enabled?: boolean
      apiKey?: string
      baseUrl?: string
      /**
       * The chosen model set, replacing whatever this provider exposed before.
       *
       * This is a REPLACEMENT, not a delta, because the card sends the whole
       * selection in one go: the browser half holds no server-side roster to
       * patch against, and a delta would let two open tabs silently interleave
       * into a set neither of them chose. An empty array is not "zero models" —
       * `updateProviderSetting` drops the field, which returns the provider to
       * its discovered listing or the registry's own.
       */
      models?: readonly string[]
    }
  /** Flip the lane's own master switch; `false` contributes no models at all. */
  | { kind: 'lane'; enabled: boolean }
  /** Forget one provider's stored setting entirely, key included. */
  | { kind: 'clear'; providerId: string }
/** One provider as the card renders it. Never carries the key itself. */
export interface PoolWebAggregateProvider {
  id: string
  name: string
  category: string
  authKind: string
  format: string
  /** Where the user obtains a key, for the "get one" link. */
  authUrl?: string
  website?: string
  /** True when this lane can serve the provider with a pasted key. */
  supported: boolean
  /** True when a key is present (or none is needed). */
  configured: boolean
  /**
   * True when this vendor contributes models right now.
   *
   * Not simply "the user did not switch it off": with no explicit flag the
   * answer follows the credential, so an unconfigured vendor reads as off. The
   * roster is a directory to choose from, and a page that drew every one of the
   * seventy-six with its switch already on could not show what was configured.
   */
  enabled: boolean
  /**
   * The vendor's own one-line description, from the registry.
   *
   * This is the row's small print. The registry carries no per-model blurb —
   * `models[]` entries are id/name/contextWindow/vision/reasoning only — so the
   * description belongs to the vendor, and the card must not imply otherwise.
   */
  notes?: string
  /** A base-URL override the user typed, if any. */
  baseUrl?: string
  /** True when the provider declares a model listing this lane can read. */
  hasListing: boolean
  /** Model ids currently exposed: the chosen set, or the whole roster. */
  models: readonly string[]
  /**
   * Every id this provider could offer, which is the roster after a fetch.
   *
   * Equal to `models` until the user narrows the choice. It exists so the card
   * can offer a checkbox per id — without it, choosing could only ever remove
   * rows and never put one back.
   */
  availableModels: readonly string[]
  /**
   * True when the registry declares no models, so the ids are the user's to
   * type.
   *
   * Four records are in that state today: `custom` (a gateway the registry
   * cannot know about), Azure (ids are per-deployment) and the three local
   * servers (the ids are whatever the user loaded). None of them can be served
   * until someone names a model, and none can offer a chooser over a roster
   * that does not exist — so this flag is what tells the card to draw a text
   * field instead. The flag travels rather than the id, because the card must
   * not keep a list of vendor names that mean "empty on purpose".
   */
  manualModels: boolean
  /** True when the exposed set came from a live listing rather than the registry. */
  discovered: boolean
  /** When the provider was first configured. */
  addedAt?: string
}
/** The document {@link POOL_AGGREGATE_PATH} answers with. */
export interface PoolWebAggregateStatus {
  /** The lane's own master switch. */
  enabled: boolean
  /** How many providers hold a setting at all. */
  configured: number
  /** How many model rows the lane currently offers. */
  modelCount: number
  /** The rows, in provider-then-model order. */
  models: readonly {
    id: string
    name: string
    providerId: string
    modelId: string
    contextWindow: number
    maxOutputTokens: number
    supportsImages: boolean
    source: 'static' | 'discovered'
  }[]
  /** The whole registry, in registry order. */
  providers: readonly PoolWebAggregateProvider[]
}
/**
 * One login channel as the card renders it.
 *
 * `loginKind` is presentation only: `browser` means "open a link and sign in
 * there". The card never learns which protocol a channel speaks — that stays
 * inside the pack, which hands back a `loginUrl` per sign-in attempt.
 */
export interface PoolWebChannel {
  id: string
  name: string
  /** Who runs it. */
  org: string
  /**
   * The vendor's published API host, when it publishes one.
   *
   * Absent for eleven of the thirteen: the pack names `apiDomain` only for the
   * two WorkBuddy lanes, and everything else would be a host we guessed. The
   * card falls back to `org` when this is missing, so the subtitle is never
   * blank and never invented.
   */
  domain?: string
  /** Accent colour, for the channel's chip. */
  accent: string
  /** One Chinese line on what the free allowance actually is. */
  note: string
  loginKind: 'browser'
  /** True when this plugin's own account pool already serves this channel. */
  ownedByPool: boolean
  /**
   * True when the vendor's own login page offers a phone-code path.
   *
   * Not a capability this plugin provides — the pack drives the page, and all
   * this says is that the page behind the button holds a second door. Raccoon's
   * does (QR and SMS on one screen), and its QR is the one that goes stale while
   * the user reads the message.
   */
  smsHint?: boolean
  /**
   * What the pack can report about this vendor's credits, when it can report
   * something at all.
   *
   * Absent is meaningful: it means `credits.balances` has no branch for this
   * provider, so no balance exists to show. Present-but-empty means balances
   * work but there is no daily check-in behind them.
   *
   * `unit` is the vendor's own currency and is never normalised across
   * vendors: Cline pays US dollars and ZCode pays token buckets, so a single
   * "credits" label would be wrong for a third of the roster.
   */
  credits?: {
    claim?: boolean
    status?: boolean
    unit?: 'tokens' | 'dollars'
    /** Percentages per quota bucket rather than a credit total. */
    quota?: boolean
  }
}
/** The document {@link POOL_CHANNELS_PATH} answers with. */
export interface PoolWebChannelsStatus {
  /** Whether the vendored pack mounted, and if not, why. */
  state: 'pending' | 'ready' | 'unavailable'
  /** Human text for a non-ready state; absent when ready. */
  reason?: string
  channels: readonly PoolWebChannel[]
}
/** One model a chain member may name, from either lane. */
export interface PoolWebComboCandidate {
  id: string
  name: string
  /** `workbuddy` for a pool model, the provider id for a third-party one. */
  owner: string
  /** True when a third-party model already has a usable key. */
  usable: boolean
  contextWindow: number
  supportsImages: boolean
}
/** One chain, resolved against the live roster. */
export interface PoolWebCombo {
  /** `combo:<slug>`, always. */
  id: string
  name: string
  /** Members that exist right now, in order. Empty means the chain is dead. */
  models: readonly string[]
  /** Members the user configured but which the roster no longer serves. */
  missing: readonly string[]
  strategy: 'fallback' | 'round-robin'
  stickyLimit: number
  enabled: boolean
  contextWindow: number
  supportsImages: boolean
}
/**
 * The document {@link POOL_COMBOS_PATH} answers with.
 *
 * `candidates` is the whole roster rather than only what is chainable, because
 * a chain that cannot add a new model is not an editor.
 */
export interface PoolWebCombosStatus {
  combos: readonly PoolWebCombo[]
  candidates: readonly PoolWebComboCandidate[]
}
/**
 * What a relay patch can change.
 *
 * `key: ''` rotates rather than clears: the card sends an empty string when the
 * user asks for a new key, and "no key" is not a state the relay can serve — a
 * keyless relay would have to accept everyone.
 */
export interface PoolWebRelayPatch {
  enabled?: boolean
  host?: string
  port?: number
  key?: string
  /**
   * The models to share with LAN clients, by gateway id.
   *
   * An empty array is an answer, not an absence: it means the user unticked
   * everything, and the gateway then refuses every model. Only "never set"
   * leaves the gateway open.
   */
  models?: string[]
}
/**
 * What {@link POOL_RELAY_PATH} answers with.
 *
 * `listening` is separate from `enabled` because "you turned it on and it could
 * not bind" is a state the user has to be able to see. Collapsing the two would
 * tell them to switch on something that is already on.
 *
 * `key` is the RELAY key, in full, on purpose: the card has to show it so it can
 * be pasted into another device. It is the key the plugin minted for LAN
 * clients — the shim's own per-process secret is never returned by any route.
 *
 * The type lives here rather than beside the listener because the client card
 * renders it, and importing the listener's module would drag `node:http` into a
 * browser bundle.
 */
export interface PoolWebRelayStatus {
  enabled: boolean
  listening: boolean
  host: string
  port: number
  /** Where a client should point; '' until something is listening. */
  endpoint: string
  key: string
  /** Why nothing is bound; '' when there is nothing to explain. */
  error: string
  /**
   * Every model the gateway could serve, with the name a human reads.
   *
   * Built from the shim's own roster, so the picker cannot offer a model the
   * gateway would then refuse. The name is here because the OpenAI `/v1/models`
   * schema has no such field: `qfmodel` is what a client sends, and
   * `Qwen3.8-Flash · 免费` is what the user knows it as, and only this card can
   * show both together.
   *
   * REQUIRED, and required on the POST answer too: the card treats a write
   * response as the new state, so a save that answered without the roster emptied
   * the picker until the next poll. Declaring it optional let the write path
   * return the bare listener status and typecheck clean.
   */
  candidates: readonly PoolWebGatewayModel[]
  /**
   * The shared list in force. `undefined` means the user has never chosen, which
   * the card must render as "everything is shared" rather than an empty picker.
   */
  shared?: readonly string[]
}
/** One row of the gateway's model picker. */
export interface PoolWebGatewayModel {
  /** What a client sends, and what the allowlist stores. */
  id: string
  /** The display name from the lane that serves it. */
  name: string
  /** The lane or channel it belongs to; what the picker groups under. */
  source: string
}
/**
 * What a key probe answered.
 *
 * `modelIds` is present only when the provider's listing was readable, and the
 * "discover models" action turns it into a save. `committed` reports how many
 * ids that action actually wrote — a listing that came back empty is a real
 * answer (the provider serves nothing) and must not be reported as a failure.
 */
export interface PoolWebAggregateProbe {
  ok: boolean
  /** The provider's HTTP status, or 0 when it was never reached. */
  status: number
  message: string
  modelCount?: number
  /** Ids the provider listed, when it declared a listing and answered. */
  modelIds?: readonly string[]
  /** How many ids the discover action wrote back. Absent on a plain probe. */
  committed?: number
}
/**
 * Read the usage panel's aggregate.
 *
 * GET only, and token-free by construction: the recorder holds counts and
 * timings, never a prompt. The document type is `UsageSummary` from
 * `src/stats.ts` rather than a copy declared here, because that module stays
 * Node-free precisely so the browser half can import the SAME declaration
 * instead of a second one that could quietly drift.
 */
export const POOL_USAGE_PATH = '/plugins/dsh-xdpool/usage'
/** Body of the reserve route: exactly one account per request. */
export interface PoolWebCreditReserve {
  /** Pool account id, as reported in `PoolWebAccount.id`. */
  accountId: string
  /** Credits to keep. 0 clears the reserve. */
  reserve: number
}
/** Body of the "run now" endpoint: exactly one job per request. */
export interface PoolWebAutomationRun {
  /** Which job to run: checkin / report / tasks / streak. */
  job: string
  /**
   * Re-run even if the job already ran today. Every job is idempotent, so this
   * only costs upstream calls; it is what a second button press means.
   */
  force?: boolean
}
/** Result of a manual run, echoing the job's refreshed state. */
export interface PoolWebAutomationRunResult {
  ok: true
  job: string
  /** Accounts that finished without error. */
  okCount: number
  /** Accounts that failed (each one skipped, the run continued). */
  failed: number
  /** Credits claimed by a task run. */
  credit: number
  /** Energy claimed by a task run. */
  energy: number
  /** Tasks claimed by a task run. */
  claimed: number
  /** One-line summary of the run. */
  message?: string
}
/** One account's row, token-free. */
export interface PoolWebAccount {
  id: string
  label: string
  nickname?: string
  domain: string
  /** ISO timestamp; absent when the credential carries no expiry. */
  expiresAt?: string
  /** Account-wide cooldown (every model blocked); only after a no-model penalize. */
  cooling: boolean
  /** ISO timestamp when the account-wide 429 cooldown lifts; only while cooling. */
  cooldownUntil?: string
  /**
   * The upstream REJECTED this account's sign-in (401/403) — the credential file
   * still looks valid because the upstream never rewrites its expiry when it
   * revokes a token. Distinct from `cooling`: waiting does not fix it, only
   * signing in again in the desktop app does.
   */
  credentialDead?: boolean
  /** ISO timestamp when the dead mark expires and the account is retried; only while `credentialDead`. */
  credentialDeadUntil?: string
  /**
   * Per-model cooldowns currently active. The account is NOT `cooling` while a
   * model is limited — its other models still serve — but each entry tells the
   * card which model is out until when (e.g. `hy4-preview` cooling to 10:14,
   * `hy3` normal).
   */
  modelCooldowns?: ReadonlyArray<{ modelId: string; until: string }>
  /**
   * Whether the user switched this account off. A disabled account never
   * serves a request, but it stays listed so the card can switch it back on.
   */
  disabled: boolean
  /**
   * Whether the user pinned this account to be tried first.
   *
   * Distinct from `disabled`, and the card has to tell them apart: a disabled
   * account is skipped entirely, a preferred one is merely first in line. It
   * stays `false` when nothing is pinned, so the row never borrows a mark that
   * describes a global choice rather than this account.
   */
  preferred: boolean
  rateLimitHits: number
  /**
   * Credits the user asked to keep for this account. The pool stops picking the
   * account once its balance reaches the reserve, so this many credits survive.
   * 0 means the account may be spent down as before.
   */
  creditReserve: number
  /**
   * Whether the account is held back purely by its reserve right now. Kept
   * distinct from `cooling`: a reserved account is healthy and simply
   * protected, which is a different thing to tell the user than rate-limited.
   */
  reserved: boolean
  /**
   * What the automation earned for this account today. Absent when it earned
   * nothing (or the automation never ran for it), so the card can stay quiet
   * instead of printing a row of zeroes.
   */
  automationToday?: PoolWebAutomationEarnings
  /** ISO timestamp of the last successful use (best-effort pool bookkeeping). */
  lastUsedAt?: string
  /** Aggregated credit summary for the account, read-only. */
  credits?: PoolWebCredits
  creditsError?: string
  /**
   * Today's check-in state for this account, read-only. Present only when the
   * per-account check-in probe succeeded and the program is active. The card
   * renders one claim button per account, so a multi-account pool can collect
   * every account's daily reward without switching accounts by hand.
   */
  checkin?: PoolWebCheckin
  checkinError?: string
}
/** One credit package (as surfaced by the pool's upstream client), node-free. */
export interface PoolWebCreditPackage {
  packageName: string
  remain?: number
  size?: number
  /** CapacityType 4 — refreshed each cycle and never expires. */
  monthly?: boolean
  /** Next cycle refresh point, ms. */
  cycleRefreshMs?: number
  /** One-off expiry, ms. */
  expiresAtMs?: number
}
/** Aggregated credit answer the card renders under one account. */
export interface PoolWebCredits {
  total?: number
  packages: readonly PoolWebCreditPackage[]
  /** Credits expiring within 3 days. */
  expiringSoon?: number
  /** When the nearest package expires, ms. */
  nearestExpiryMs?: number
}
/**
 * Daily check-in state the card renders under one account's credits. Mirrors
 * the upstream activity endpoint, minus anything the browser does not need.
 */
export interface PoolWebCheckin {
  /** The activity is running; a claim button is offered only while true. */
  active: boolean
  /** Already collected today — the button renders as a done state. */
  todayCheckedIn: boolean
  /** Consecutive days checked in. */
  streakDays: number
  /** Credits a single day grants. */
  dailyCredit: number
  /** Credits collected today (0 before claiming). */
  todayCredit: number
  /** Today is a streak milestone day. */
  isStreakDay: boolean
  /** The day count the next milestone lands on. */
  nextStreakDay: number
  /** Bonus credits granted on a milestone day. */
  streakBonusCredit: number
}
/** Result of one claim, so the card can confirm what was collected. */
export interface PoolWebCheckinClaim {
  credit: number
  streakDays: number
  isStreakDay: boolean
}
/** One model the pool exposes to DSH, with cost / free tags. */
export interface PoolWebModel {
  id: string
  name: string
  /** Relative credit cost, e.g. 0.79 for x0.79. */
  multiplier?: number
  /** Upstream tags: free / limited-free / night-discount. */
  tags?: readonly string[]
  /** Effective image support after the user's per-model toggle. */
  supportsImages: boolean
  /** Effective context window after the user's budget cap. */
  contextWindow: number
  /** The window the upstream advertises, before any cap. */
  nativeContextWindow: number
  /** Upstream output ceiling, so the card can show both limits. */
  maxOutputTokens: number
  /** Thinking levels the upstream declares, when it declares any. */
  supportedEfforts?: readonly string[]
  /** Whether this model is currently enabled in the picker. */
  enabled: boolean
}
/**
 * Body of the model-probe route: one model to test.
 *
 * `provider` and `model` are both the ids the picker already shows, rather than
 * a row id this plugin invented, so a probe cannot drift from what the user
 * clicked. The host resolves the pair through its own adapter registry, which is
 * the only place that knows which lane a given provider id actually serves.
 */
export interface PoolWebModelProbe {
  /** Provider id, exactly as the row printed it. */
  provider: string
  /** Model id within that provider, exactly as the row printed it. */
  model: string
}
/**
 * What one connectivity probe measured.
 *
 * Deliberately three numbers and nothing else. The card asks "can this model
 * answer at all", so a probe that reported token counts or a verdict about
 * quality would be answering a question nobody asked, and one that reported
 * "0 output tokens" for a refusal would be reporting a bug as a fact.
 *
 * `outputChars` is a character count, not a token count: this plugin cannot
 * tokenize for a model it does not own, and a character count answers "did it
 * say anything" without pretending to know more.
 */
export interface PoolWebModelProbeResult {
  /** True when the model produced at least one character of output. */
  ok: boolean
  /** Milliseconds until the first output character arrived. Absent when none did. */
  firstFrameMs?: number
  /** Characters of output produced before the probe stopped reading. */
  outputChars: number
  /**
   * Why the probe failed, when it did.
   *
   * Rendered verbatim, and it is a failure to SHOW rather than to hide: a
   * connectivity test that swallows its error teaches the user the button is
   * broken.
   */
  error?: string
}
/** The user's saved model selection, echoed back so the card can diff a draft. */
/** Body of the account enable/disable route: exactly one account per request. */
export interface PoolWebAccountToggle {
  /** Pool account id, as reported in `PoolWebAccount.id`. */
  accountId: string
  /** `true` switches the account off; `false` puts it back in rotation. */
  disabled: boolean
}
/**
 * Body of the account ignore/unignore route: exactly one account per request.
 *
 * `ignored: true` throws the account out of the pool for good (its credential is
 * not even read on the next scan, and a fresh desktop sign-in will not bring it
 * back). `false` restores it, at which point the next scan discovers it again.
 */
export interface PoolWebAccountIgnore {
  /** Pool account id, as reported in `PoolWebAccount.id`. */
  accountId: string
  /** `true` ignores the account permanently; `false` takes it back. */
  ignored: boolean
}
/**
 * Body of the prefer route: one account id, or `null` to hand the choice back
 * to the distribution strategy.
 *
 * `null` rather than an empty string because "no preference" is a real state
 * the user must be able to return to, and it is the only value that means it.
 */
export interface PoolWebAccountPrefer {
  /** Pool account id, as reported in `PoolWebAccount.id`, or null to clear. */
  accountId: string | null
}
/**
 * One account the user has thrown out of the pool.
 *
 * Kept on the status document so the card can list what was ignored and offer a
 * way back: without that, "ignored" is a one-way door the user cannot inspect or
 * undo from the UI, which is how a hidden list becomes a support burden.
 */
export interface PoolWebIgnoredAccount {
  /** Pool account id, the same key `PoolWebAccount.id` uses. */
  id: string
  /** Human label captured at ignore time, so the row reads without a rescan. */
  label: string
  /** ISO timestamp of when it was ignored. */
  ignoredAt: string
}
export interface PoolWebModelSelection {
  /** Absent = every model is enabled. */
  enabledModelIds?: readonly string[]
  /** Absent = each model follows its upstream image capability. */
  imageModelIds?: readonly string[]
  /** Per-model context-window cap, keyed by model id. */
  contextBudgets?: Readonly<Record<string, number | undefined>>
}
/** The JSON document the pool card renders. */
export interface PoolWebStatus {
  ok: boolean
  accounts: readonly PoolWebAccount[]
  /** The next account the pool would use (rotation cursor). */
  activeAccountId?: string
  /**
   * The account the user pinned to be tried first, when one is pinned and it is
   * still in the pool.
   *
   * Reported at document level rather than as a per-row flag because it is a
   * single global choice, and omitting it when the pinned account has been
   * scanned away keeps the card from drawing a "preferred" badge on nothing.
   */
  preferredAccountId?: string
  cooling: number
  models: readonly PoolWebModel[]
  /** The saved selection the card diffs its draft against. */
  selection: PoolWebModelSelection
  /**
   * How the pool spreads requests: `priority` drains one account before
   * moving on, `round-robin` splits the spend evenly.
   */
  distribution: PoolDistribution
  /** Which region this document describes. */
  region: PoolRegion
  /** Every region holding at least one account, in display order. */
  regions: readonly PoolRegion[]
  shim: { running: boolean; baseUrl?: string }
  /** Daily-points automation state, so the card can show what ran and when. */
  automation: PoolWebAutomation
  /** Per-account credit floors currently in force, keyed by account id. */
  creditReserves: Readonly<Record<string, number>>
  /**
   * Accounts thrown out of the pool, in the order they were ignored.
   *
   * Reported so the card can show the list and offer a way back. These accounts
   * are NOT in `accounts`: they are filtered out before their credentials are
   * read, which is the whole point of the feature.
   */
  ignored: readonly PoolWebIgnoredAccount[]
  /**
   * Where THIS region's model list came from.
   *
   * `live` = fetched from the gateway (or a cached fetch survived a restart).
   * `fallback` = the built-in static table, which means the startup fetch
   * failed and the user is looking at a SHORTER, possibly stale roster — models
   * they had enabled can be missing from it entirely.
   *
   * Surfaced because the failure used to be log-only: the picker quietly lost
   * half its entries and nothing on screen said why, so it read as "the plugin
   * deleted my models".
   */
  catalogSource?: PoolWebCatalogSource
  /** When the live catalog was last successfully fetched, ISO. */
  catalogUpdatedAt?: string
  /** Why the last fetch failed, when it did. Redacted and length-capped. */
  catalogError?: string
  /**
   * Credential files on disk that did NOT become accounts.
   *
   * Reported so the account count can be trusted: without this, a directory
   * holding four files that yields two accounts looks like two accounts were
   * deleted, when really two files could not be opened (most often an encrypted
   * credential the desktop app was not running to unlock).
   */
  skippedFiles?: readonly PoolWebSkippedFile[]
}
/** A credential file the pool could not read. */
export interface PoolWebSkippedFile {
  /** Basename only; the full path lives in the desktop app's auth directory. */
  file: string
  reason: 'encrypted' | 'unreadable' | 'malformed'
}
/** How a region's model list was obtained. */
export type PoolWebCatalogSource = 'live' | 'fallback'
/** One automation job's last run, as shown on the card. */
export interface PoolWebAutomationJob {
  /** `YYYY-MM-DD` of the last run in this process, if it has run. */
  lastRunDate?: string
  /**
   * Epoch ms of the last run, so the card can show the TIME.
   *
   * Carried because a date-only stamp cannot tell one run from eight: every
   * repeat inside the same day rendered as the identical `2026-09-28 · 2`,
   * which is what kept a "re-runs every hour" defect invisible on the card.
   */
  lastRunAtMs?: number
  /**
   * Configured slots consumed today, as `YYYY-MM-DDTHH`.
   *
   * Shown so "which of today's hours already ran" is answerable at a glance
   * rather than inferred from a counter.
   */
  firedSlots?: readonly string[]
  /** Accounts that finished without error on the last run. */
  ok: number
  /** Accounts that failed on the last run (each one skipped, the run continued). */
  failed: number
  /** Credits claimed by the task job on the last run. */
  credit: number
  /** Energy claimed by the task job on the last run. */
  energy: number
  /** Tasks claimed by the task job on the last run. */
  claimed: number
  /** One-line summary of the last run. */
  message?: string
  /**
   * What the last run actually did, in the words of the task board.
   *
   * `message` is a count; this is the list a person can check off, which is
   * what turns a row from "it ran" into "it did the things I care about".
   */
  detail?: readonly string[]
  /** A pending milestone worth naming, e.g. the next streak tier countdown. */
  progress?: string
}
/**
 * Automation block on the status document.
 *
 * Carries the schedule and each job's last outcome so the card can answer
 * "is it on, when does it run, and what did it last do" without reaching into
 * the scheduler itself.
 */
export interface PoolWebAutomation {
  /** Master switch, mirrored from the saved config. */
  enabled: boolean
  /** Whether the loop is currently running. */
  running: boolean
  /** Configured hours per job, so the card can show the schedule. */
  checkinHours: readonly number[]
  reportHours: readonly number[]
  taskHours: readonly number[]
  streakHours: readonly number[]
  travelHours: readonly number[]
  compensationHours: readonly number[]
  jobs: {
    checkin: PoolWebAutomationJob
    report: PoolWebAutomationJob
    tasks: PoolWebAutomationJob
    streak: PoolWebAutomationJob
    travel: PoolWebAutomationJob
    compensation: PoolWebAutomationJob
  }
  /** Claimable tasks seen on the most recent task pass, across accounts. */
  claimableSeen: number
  /**
   * Whether a manual run is in flight. The card polls this to know when to
   * stop showing progress and report the result.
   */
  runInProgress: boolean
  /**
   * Per-account credits/energy/tasks the automation earned TODAY, keyed by
   * account id. An account that earned nothing is simply absent, so the card
   * can say "nothing yet" instead of showing a bare zero.
   */
  earningsToday: Readonly<Record<string, PoolWebAutomationEarnings>>
}
/** Today's automation take for one account. */
export interface PoolWebAutomationEarnings {
  /** Credits claimed from the task centre today. */
  credit: number
  /** Energy claimed from the task centre today. */
  energy: number
  /** Tasks claimed today. */
  claimed: number
  /** Credits collected from check-in today. */
  checkinCredit: number
  /** Credits from streak redemption and the lottery today. */
  bonusCredit: number
  /** Credits from buddy adoption and the travel loop today. */
  travelCredit: number
  /** Credits collected from the outage-compensation offer today. */
  compensationCredit: number
  /** Local date the counters belong to (YYYY-MM-DD). */
  date: string
}
/**
 * The two gateways, matching the provider ids the host registers. `cn` is the
 * domestic gateway (`copilot.tencent.com` / `codebuddy.cn`); `global` is the
 * international one (`workbuddy.ai`).
 */
export type PoolRegion = 'cn' | 'global'
/** How the pool spreads requests across its accounts. */
export type PoolDistribution = 'priority' | 'round-robin' | 'balanced' | 'sticky' | 'expiry'
/**
 * The schedule every automation job falls back to.
 *
 * Shared by both halves on purpose. The host uses it when a configured hour
 * list arrives empty (the settings schema materializes "never configured" into
 * `[]`), and the card uses it when it writes the `automation` block back, so a
 * document that already holds an empty list is healed instead of being saved
 * back as an unrunnable schedule.
 *
 * This lives here rather than in `scheduler.ts` because the browser half cannot
 * import the host module: `scheduler.ts` pulls in `node:crypto` and the whole
 * upstream client, none of which exists in the browser bundle. Two hand-written
 * copies would drift, and the drift is invisible — the card would write a
 * schedule the scheduler does not run.
 */
export const DEFAULT_AUTOMATION_HOURS = {
  checkin: [9],
  report: [10],
  tasks: [11],
  streak: [12],
  // Two passes: a trip loop needs a departure AND a collection, so a cat sent
  // out at a single pass of the day would sit there until tomorrow.
  travel: [9, 21],
  // Late morning: an outage offer is announced during the incident, so an early
  // slot finds nothing; mid-morning is early enough to leave room before the
  // deadline.
  compensation: [13],
} as const satisfies Record<string, readonly number[]>
/** One automation job kind, matching the scheduler's `AUTOMATION_JOB_KINDS`. */
export type PoolWebAutomationKind = keyof typeof DEFAULT_AUTOMATION_HOURS

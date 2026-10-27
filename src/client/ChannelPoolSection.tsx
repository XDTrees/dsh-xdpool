/**
 * Account-pool page, scan-channel section.
 *
 * The pool page's two region cards only ever showed the WorkBuddy lanes — the
 * thirteen scan-login channels lived in a parallel world on the login page.
 * This section closes that gap: every scan channel that holds at least one
 * account gets a card here, laid out like the reference build's channel card —
 * identity on top, a one-line note about what the vendor actually gives away,
 * a numbers row (accounts, models, credits), then two collapsible lists.
 *
 * Three decisions worth stating, because each of them is a way this could have
 * looked wrong:
 *
 * 1. The enable state IS the pack's model blacklist — `model.setDisabled` with
 *    `disabled: false` unhides a model, `disabled: true` hides it again — and
 *    each row saves on its own. A channel can publish thirty models; a Save
 *    button at the bottom of a list the user has to scroll back down to turns
 *    "pick the two you want" into bookkeeping.
 * 2. Credits come from the pack and are shown in the vendor's own unit, never
 *    normalised: Cline pays dollars, ZCode pays tokens, Gemini publishes
 *    percentage windows. A single "credits" column would be wrong for a third
 *    of the roster.
 * 3. Model descriptions are the ONE thing the pack cannot answer. Its
 *    `model.list` keeps only `id`, `name` and two flags, so descriptions come
 *    from the host's catalogue — the same one the model picker reads.
 *
 * @module dsh-xdpool/client/ChannelPoolSection
 */

import { useEffect, useRef, useState, type ReactElement } from 'react'
import { BrandTile } from './brand-tile.tsx'
import { channelIcon, channelInitials } from './channel-icons.ts'
import { ModelFactsRow } from './model-facts-row.tsx'
import { modelFactsFor, formatModelCapacity, type ModelFacts } from './model-facts.ts'
import { recommendUse } from './recommend-use.ts'
import {
  accountsFrom,
  autoCheckinFrom,
  balancesFrom,
  balancesTotal,
  balanceAmount,
  balancePackages,
  callPack,
  claimResultFrom,
  creditStatusesFrom,
  fetchChannelModels,
  fetchChannels,
  modelsFrom,
  providerStatusesFrom,
  setChannelModelContextBudget,
  sortChannelModels,
  type ChannelBalance,
  type ChannelCreditStatus,
  type ChannelModel,
  type ChannelProviderStatus,
} from './channel-rpc.ts'
import type { ChannelAccount, ChannelRpcEnvelope } from '../channels.ts'
import type { PoolWebChannel, PoolWebChannelModel } from '../status-paths.ts'
import type { XdPoolSettingsKey } from './locales.ts'

type Translate = (key: XdPoolSettingsKey, params?: Record<string, unknown>) => string

/** Which of the two lists a card has open. At most one, like the reference. */
type Fold = 'accounts' | 'models'

/** How many automatic retries a cold-start mount gets before giving up. */
const LOAD_RETRIES = 5
/** Gap between those retries, in milliseconds. */
const RETRY_INTERVAL_MS = 2_000

/**
 * Channels whose accounts are shown by the two region cards instead.
 *
 * `buddy` (CodeBuddy CN) and `workbuddy` (WorkBuddy international) are the
 * two lanes the pool itself serves. A scan login for either writes into the
 * same place the desktop app's credentials land, so listing them again as
 * channel cards would show every account twice — once with credits and
 * cooldowns, once bare. They are filtered out here rather than special-cased
 * in the renderer, so an account added on the login page shows up in exactly
 * one place no matter which path created it.
 */
/**
 * The catalogue length at which a model search box earns its place.
 *
 * Below this the reader scrolls faster than they type, and the field would be
 * one more control to look past on every card.
 */
const MODEL_SEARCH_THRESHOLD = 8

/**
 * The window a channel model is capped to when the user does not ask for more.
 *
 * Same number as the region cards' `DEFAULT_CONTEXT_BUDGET`, and for the same
 * reason: a published window is a ceiling the vendor supports, not a size every
 * request can carry, so the picker offers a conservative default next to the
 * native figure instead of presenting the maximum as the everyday choice.
 */
const CONTEXT_BUDGET_DEFAULT = 200_000

const REGION_OWNED_CHANNELS: ReadonlySet<string> = new Set(['buddy', 'workbuddy'])

interface ChannelEntry {
  channel: PoolWebChannel
  accounts: readonly ChannelAccount[]
  models: readonly ChannelModel[]
  /** Host-catalogue facts, keyed by model id. Empty when the host refused. */
  facts: ReadonlyMap<string, PoolWebChannelModel>
  /** One balance row per account, in the pack's order. */
  balances: readonly ChannelBalance[]
  /** Today's check-in state, when the pack reports one. */
  statuses: readonly ChannelCreditStatus[]
  /** True while the first balance read is in flight. */
  balancePending: boolean
  /** Why the balance read failed, in the pack's words. */
  balanceError?: string | undefined
  /**
   * Why `model.list` could not answer, when it refused. Surfaced instead of
   * being folded into "no models published": the pack's `model.list` needs the
   * host's `llm` service, and when that service is missing it answers an error
   * for a channel that in fact publishes a full catalogue.
   */
  modelError?: string | undefined
  /** The counts the pack reports, for the numbers row. */
  status?: ChannelProviderStatus | undefined
}

/**
 * Collapse repeated accounts by id.
 */
function dedupeAccounts(accounts: readonly ChannelAccount[]): readonly ChannelAccount[] {
  const byId = new Map<string, ChannelAccount>()
  for (const account of accounts) {
    byId.set(account.id, account)
  }
  return [...byId.values()]
}

/** A refusal shaped like the pack's own envelope, so one catch covers both. */
function refused(message: string): ChannelRpcEnvelope {
  return { ok: false, error: { message } }
}

/**
 * "3 days left" / "expired" / "no expiry", from a millisecond stamp.
 *
 * `never` is the honest answer for the channels whose credentials carry no
 * expiry at all (ZCode among them), and printing "expired" or a date for those
 * would be a number the user cannot check.
 */
function expiryText(
  expiresAt: number | undefined,
  t: Translate | undefined,
): string | undefined {
  if (expiresAt === undefined || !Number.isFinite(expiresAt) || expiresAt <= 0) {
    return t?.('channelpool.expiryNever') ?? 'no expiry'
  }
  const days = Math.ceil((expiresAt - Date.now()) / 86_400_000)
  if (days <= 0) return t?.('channelpool.expiryNever') ?? 'no expiry'
  return days === 1 ? '1d' : `${days}d`
}

/** The vendor's currency, spelled the way that vendor spells it. */
function creditUnitLabel(channel: PoolWebChannel, t: Translate | undefined): string {
  const unit = channel.credits?.unit
  if (unit === 'dollars') return t?.('channelpool.creditsDollar') ?? 'USD'
  if (unit === 'tokens') return t?.('channelpool.creditsToken') ?? 'tokens'
  if (channel.credits?.quota === true) return t?.('channelpool.creditsQuota') ?? 'quota'
  return t?.('channelpool.creditsUnit') ?? 'credits'
}

/** Trim a decimal to something a card can print without lying about it. */
function amount(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

export function ChannelPoolSection({ t }: { readonly t?: Translate | undefined }): ReactElement {
  const [entries, setEntries] = useState<readonly ChannelEntry[]>([])
  const [error, setError] = useState<string | undefined>(undefined)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  /** provider → the open list, or `undefined` for a card with both folded. */
  const [folds, setFolds] = useState<ReadonlyMap<string, Fold | undefined>>(new Map())
  /** provider → the set of model ids the user has ticked. */
  const [enabled, setEnabled] = useState<ReadonlyMap<string, ReadonlySet<string>>>(new Map())
  /** provider → true while one of its actions is in flight. */
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())
  /** provider → what the reader typed into that card's model search box. */
  const [queries, setQueries] = useState<ReadonlyMap<string, string>>(new Map())
  const entriesRef = useRef(entries)
  entriesRef.current = entries
  const mountedRef = useRef(true)
  useEffect(() => () => { mountedRef.current = false }, [])

  const markBusy = (provider: string, on: boolean): void => {
    setBusy(previous => {
      const next = new Set(previous)
      if (on) next.add(provider)
      else next.delete(provider)
      return next
    })
  }

  const load = async (): Promise<void> => {
    try {
      const channels = (await fetchChannels()).filter(channel => !REGION_OWNED_CHANNELS.has(channel.id))
      // `account.list` filters by provider on its very first line
      // (pool.listAccounts), so an empty payload matches nothing and answers
      // "no accounts" for a channel that has three. The cheap way to learn
      // *which* providers hold accounts is one `provider.status` round trip:
      // it counts every named provider in a single answer, so the pool pays
      // two extra calls only for channels that actually have an account.
      const statusAnswer = await callPack('provider.status', {
        providers: channels.map(channel => channel.id),
      })
      const statuses = providerStatusesFrom(statusAnswer)
      const scanProviders = channels
        .map(channel => channel.id)
        .filter(id => (statuses.get(id)?.accountsTotal ?? 0) > 0)
      // Facts are fetched AFTER the model lists below, not before: the host's
      // own listing is gated per provider, and a gated channel answers "no
      // models" even while its card shows nine. The ids this page just rendered
      // are the authoritative set, so they are handed back to the host as a
      // hint — see `PoolWebChannelModelsRequest.ids`.
      const perProvider = await Promise.all(scanProviders.map(async provider => {
        const wantBalances = channels.find(channel => channel.id === provider)?.credits !== undefined
        // The calls are independent: a channel whose catalogue cannot be
        // listed still has accounts worth showing, so one failure must not
        // blank the other half of the card.
        const accountsPromise = callPack('account.list', { provider })
        const modelsPromise = callPack('model.list', { provider })
        // In phase 1 we only await accounts and models (local in-memory queries in pack.js),
        // so cards land on screen immediately without being blocked by network requests.
        const [accounts, models] = await Promise.all([
          accountsPromise.catch(() => refused('account.list failed')),
          modelsPromise.catch(() => refused('model.list failed')),
        ])
        // `model.list` answers with a FLAT array for the one provider it was
        // asked about (`{models: [...]}`), not a provider→rows map, so it is
        // read with modelsFrom — reading it as a map found no key for this
        // provider and rendered an empty list under a plausible "no models
        // published" line.
        const modelRows = modelsFrom(models.value)
        const modelEmptyBecauseRefused = modelRows.length === 0 && models.ok !== true
        return [
          provider,
          {
            accounts: dedupeAccounts(accountsFrom(accounts)),
            // Sorted at read time so the order survives every re-load: the pack
            // returns each vendor's own chronology, which is not the order a
            // reader answers "which one do I pick?" in.
            models: sortChannelModels(modelRows),
            facts: new Map<string, PoolWebChannelModel>(),
            balances: [] as readonly ChannelBalance[],
            statuses: [] as readonly ChannelCreditStatus[],
            balancePending: wantBalances,
            balanceError: undefined as string | undefined,
            modelError: modelEmptyBecauseRefused
              ? (models.error?.message ?? 'model.list refused')
              : undefined,
          },
        ] as const
      }))
      const byProvider = new Map(perProvider)
      const next = channels
        .filter(channel => byProvider.has(channel.id))
        .map(channel => ({
          channel,
          ...byProvider.get(channel.id)!,
          facts: new Map<string, PoolWebChannelModel>(),
          status: statuses.get(channel.id),
        }))
      if (!mountedRef.current) return

      // Two phases: Phase 1 renders all available channel cards immediately.
      // Balances, credit statuses and fact descriptors are enriched per provider
      // asynchronously in Phase 2 so slow remote requests cannot gate the cards.
      setEntries(next)
      setError(undefined)

      if (next.length === 0) {
        if (!statusAnswer.ok) {
          setError(statusAnswer.error?.message ?? 'provider.status refused')
        }
        return
      }

      // Phase 2: Enrich each provider independently in the background.
      const updateProvider = (provider: string, patch: Partial<ChannelEntry>): void => {
        if (!mountedRef.current) return
        setEntries(previous => previous.map(entry =>
          entry.channel.id === provider ? { ...entry, ...patch } : entry
        ))
      }

      for (const entry of next) {
        const provider = entry.channel.id
        if (entry.channel.credits !== undefined) {
          void callPack('credits.balances', { provider })
            .catch(() => refused('credits.balances failed'))
            .then(answer => {
              const balances = balancesFrom(answer)
              updateProvider(provider, {
                balances,
                balancePending: false,
                balanceError: !answer.ok && balances.length === 0
                  ? (answer.error?.message ?? 'credits.balances refused')
                  : undefined,
              })
            })
          if (entry.channel.credits.status === true) {
            void callPack('credits.status', { provider })
              .catch(() => refused('credits.status failed'))
              .then(answer => {
                updateProvider(provider, {
                  statuses: creditStatusesFrom(answer),
                })
              })
          }
        }
        const ids = entry.models.map(model => model.id)
        void fetchChannelModels([provider], ids.length > 0 ? { [provider]: ids } : {})
          .catch((): ReadonlyMap<string, readonly PoolWebChannelModel[]> => new Map())
          .then(facts => {
            if (!facts.has(provider)) return
            updateProvider(provider, {
              facts: new Map((facts.get(provider) ?? []).map(model => [model.id, model])),
            })
          })
      }
    } catch (cause) {
      if (!mountedRef.current) return
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  /**
   * Retry-on-mount race: the pack's `/api/channel-pack` route may not be up
   * yet when this section first renders (the login-page plugin mounts the
   * pack asynchronously, and a cold start can take a few seconds). Retry a
   * bounded number of times before showing the empty state, so a slow mount
   * is not misread as "no accounts".
   */
  const loadWithRetry = async (attempt = 0): Promise<void> => {
    await load()
    if (!mountedRef.current) return
    if (entriesRef.current.length > 0) return
    if (attempt >= LOAD_RETRIES) return
    window.setTimeout(() => { if (mountedRef.current) void loadWithRetry(attempt + 1) }, RETRY_INTERVAL_MS)
  }

  useEffect(() => { void loadWithRetry() }, [])

  const foldFor = (provider: string): Fold | undefined => folds.get(provider)
  const toggleFold = (provider: string, fold: Fold): void => {
    setFolds(previous => {
      const next = new Map(previous)
      next.set(provider, previous.get(provider) === fold ? undefined : fold)
      return next
    })
  }

  const enabledFor = (provider: string, models: readonly ChannelModel[]): ReadonlySet<string> =>
    enabled.get(provider) ??
    new Set(models.filter(model => model.disabled !== true).map(model => model.id))

  const queryFor = (provider: string): string => queries.get(provider) ?? ''

  const setQuery = (provider: string, query: string): void => {
    setQueries(previous => {
      const next = new Map(previous)
      if (query === '') next.delete(provider)
      else next.set(provider, query)
      return next
    })
  }

  /**
   * Narrow one channel's catalogue to whatever the reader typed.
   *
   * Matching on the model *name* and *id* is not enough: the descriptors live
   * in the host catalogue under the same id, and "vision" is exactly the word
   * somebody hunting for an image-capable model reaches for. So the host row
   * is joined in and its description and modalities are searched too.
   */
  const modelsMatching = (entry: ChannelEntry, query: string): readonly ChannelModel[] => {
    const needle = query.trim().toLowerCase()
    if (needle === '') return entry.models
    return entry.models.filter(model => {
      const fact = entry.facts.get(model.id)
      const haystack = [
        model.id,
        model.name ?? '',
        model.description ?? '',
        fact?.description ?? '',
        fact?.contextWindow === undefined ? '' : String(fact.contextWindow),
        ...(fact?.inputModalities ?? []),
      ].join(' ').toLowerCase()
      return haystack.includes(needle)
    })
  }

  /**
   * Flip one model and write it through immediately.
   *
   * `model.setDisabled` is the endpoint that also broadcasts
   * `llm/adapters-updated`; writing only to the blacklist would leave the picker
   * showing the old catalogue until something else happened to refresh it.
   */
  const toggleModel = async (provider: string, modelId: string, on: boolean): Promise<void> => {
    const entry = entries.find(item => item.channel.id === provider)
    if (entry === undefined) return
    const next = new Set(enabledFor(provider, entry.models))
    if (on) next.add(modelId)
    else next.delete(modelId)
    setEnabled(previous => new Map(previous).set(provider, next))
    markBusy(provider, true)
    try {
      const envelope = await callPack('model.setDisabled', { provider, modelId, disabled: !on })
      if (!envelope.ok) {
        throw new Error(envelope.error?.message ?? 'model.setDisabled refused')
      }
    } catch (cause) {
      setNotice(t?.('channelpool.saveError', {
        message: cause instanceof Error ? cause.message : String(cause),
      }) ?? `Could not save: ${cause instanceof Error ? cause.message : String(cause)}`)
      setEnabled(previous => {
        const restored = new Map(previous)
        restored.delete(provider)
        return restored
      })
    } finally {
      markBusy(provider, false)
      await load()
    }
  }

  /**
   * Cap one model's advertised window, or take the cap off.
   *
   * The optimistic update writes the number straight onto the row so the radio
   * moves immediately; `load()` re-reads the authoritative table afterwards and
   * corrects it if the pack disagreed.
   */
  const setContextBudget = async (
    provider: string,
    modelId: string,
    budget: number | undefined,
  ): Promise<void> => {
    markBusy(provider, true)
    setEntries(previous => previous.map(entry => entry.channel.id !== provider
      ? entry
      : {
        ...entry,
        models: entry.models.map(model => model.id !== modelId
          ? model
          : {
            ...model,
            /*
              Clearing the cap restores the native window as the ACTIVE one and
              keeps `nativeContextWindow` in place. Dropping the native figure
              too would make the row stop looking cappable mid-click, and the
              radio pair would disappear from under the pointer — the same
              "it cancels itself" symptom from the other side.
            */
            ...budget === undefined
              ? { contextBudget: undefined, contextWindow: model.nativeContextWindow ?? model.contextWindow }
              : { contextBudget: budget, contextWindow: budget, nativeContextWindow: model.nativeContextWindow ?? model.contextWindow },
          }),
      }))
    try {
      const envelope = await setChannelModelContextBudget(provider, modelId, budget)
      if (!envelope.ok) {
        throw new Error(envelope.error?.message ?? 'model.setContextBudget refused')
      }
    } catch (cause) {
      setNotice(t?.('channelpool.saveError', {
        message: cause instanceof Error ? cause.message : String(cause),
      }) ?? `Could not save: ${cause instanceof Error ? cause.message : String(cause)}`)
    } finally {
      markBusy(provider, false)
      await load()
    }
  }

  /** Enable every published model, or switch all of them off, in one write. */
  const setAllModels = async (provider: string, on: boolean): Promise<void> => {
    const entry = entries.find(item => item.channel.id === provider)
    if (entry === undefined || entry.models.length === 0) return
    setEnabled(previous => new Map(previous).set(
      provider,
      new Set(on ? entry.models.map(model => model.id) : []),
    ))
    markBusy(provider, true)
    try {
      await callPack('model.setAllDisabled', { provider, disabled: !on })
      setNotice(t?.('channelpool.modelsSaved') ?? 'Model selection saved.')
    } catch (cause) {
      setNotice(t?.('channelpool.saveError', {
        message: cause instanceof Error ? cause.message : String(cause),
      }) ?? `Could not save: ${cause instanceof Error ? cause.message : String(cause)}`)
      setEnabled(previous => {
        const restored = new Map(previous)
        restored.delete(provider)
        return restored
      })
    } finally {
      markBusy(provider, false)
      await load()
    }
  }

  const refreshBalances = async (provider: string, force: boolean): Promise<void> => {
    markBusy(provider, true)
    setEntries(previous => previous.map(entry =>
      entry.channel.id === provider ? { ...entry, balancePending: true } : entry))
    try {
      const envelope = await callPack('credits.balances', force ? { provider, force: true } : { provider })
      if (!mountedRef.current) return
      if (!envelope.ok) {
        setEntries(previous => previous.map(entry =>
          entry.channel.id === provider
            ? { ...entry, balancePending: false, balanceError: envelope.error?.message ?? 'credits.balances refused' }
            : entry))
        return
      }
      const rows = balancesFrom(envelope)
      setEntries(previous => previous.map(entry =>
        entry.channel.id === provider
          ? { ...entry, balancePending: false, balanceError: undefined, balances: rows }
          : entry))
    } finally {
      if (mountedRef.current) markBusy(provider, false)
    }
  }

  const claim = async (provider: string): Promise<void> => {
    markBusy(provider, true)
    try {
      const envelope = await callPack('credits.claimAll', { provider })
      if (!mountedRef.current) return
      const result = claimResultFrom(envelope)
      if (result === undefined) {
        setNotice(envelope.error?.message ?? t?.('channelpool.loadError', { message: 'credits.claimAll refused' }) ?? 'Claim refused.')
      } else if (result.claimed > 0) {
        setNotice(t?.('channelpool.claimResult', {
          claimed: result.claimed,
          total: result.claimed + result.alreadyClaimed + result.inactive + result.failed,
          credit: amount(result.totalCredit),
          unit: result.unit === 'token'
            ? (t?.('channelpool.creditsToken') ?? 'tokens')
            : (t?.('channelpool.creditsUnit') ?? 'credits'),
        }) ?? `Claimed ${result.claimed}: +${result.totalCredit}.`)
      } else {
        setNotice(t?.('channelpool.claimNone', {
          already: result.alreadyClaimed,
          inactive: result.inactive,
        }) ?? 'Nothing to claim today.')
      }
      if (result?.failed !== undefined && result.failed > 0) {
        setNotice(t?.('channelpool.claimFailed', { failed: result.failed }) ?? `${result.failed} failed.`)
      }
      await refreshBalances(provider, true)
    } finally {
      if (mountedRef.current) markBusy(provider, false)
    }
  }

  const accountAction = async (
    provider: string,
    accountId: string,
    action: 'refresh' | 'test' | 'toggle' | 'delete',
  ): Promise<void> => {
    if (action === 'delete' && typeof window !== 'undefined') {
      const prompt = t?.('channelpool.deleteConfirm') ?? 'Remove this account?'
      if (!window.confirm(prompt)) return
    }
    markBusy(provider, true)
    try {
      const entry = entries.find(item => item.channel.id === provider)
      const enabledNow = entry?.accounts.find(account => account.id === accountId)?.enabled !== false
      const method = action === 'refresh' ? 'account.refresh'
        : action === 'test' ? 'account.test'
        : action === 'delete' ? 'account.delete'
        : 'account.update'
      const payload = action === 'toggle'
        ? { accountId, patch: { enabled: !enabledNow } }
        : { accountId }
      const envelope = await callPack(method, payload)
      if (!mountedRef.current) return
      if (!envelope.ok) {
        setNotice(envelope.error?.message ?? `${action} refused`)
        return
      }
      if (action === 'test') setNotice(t?.('channelpool.testOk') ?? 'Reachable.')
      await load()
    } finally {
      if (mountedRef.current) markBusy(provider, false)
    }
  }

  // No channel accounts yet is not a state worth a block of its own: the page
  // above already explains what this pool is, and an empty grid that says
  // "add an account on the login page" only repeats the nav row the reader
  // just clicked. Render nothing rather than a placeholder that reads like a
  // failure. A load ERROR still speaks, because that one is a real problem.
  if (entries.length === 0 && error === undefined) return <></>
  return (
    <section className="dsm-xdpool-cpool" aria-label={t?.('channelpool.title') ?? 'Channels'}>
      {error === undefined ? null
        : <p className="dsm-xdpool-error">{t?.('channelpool.loadError', { message: error }) ?? `Could not load channels: ${error}`}</p>}
      {notice === undefined ? null : <p className="dsm-xdpool-note">{notice}</p>}
      <div className="dsm-xdpool-cpool-grid">
        {entries.map(entry => {
          const { channel, accounts, models, facts, balances, statuses, status } = entry
          const icon = channelIcon(channel.id)
          const tileMark = icon === undefined ? { initials: channelInitials(channel.name) } : { icon }
          const fold = foldFor(channel.id)
          const enabledIds = enabledFor(channel.id, models)
          const isBusy = busy.has(channel.id)
          const unit = creditUnitLabel(channel, t)
          const total = channel.credits === undefined ? undefined : balancesTotal(balances)
          const modelsEnabled = models.filter(model => enabledIds.has(model.id)).length
          const statusOf = (accountId: string): ChannelCreditStatus | undefined =>
            statuses.find(row => row.accountId === accountId)
          // Whether every enabled account on this channel has already claimed
          // its daily credit. An unknown status is treated as "not yet" so the
          // button stays in the claimable state until the first refresh lands;
          // a zero-account channel never reads as "all claimed", because there
          // is nothing to have claimed.
          const enabledAccounts = accounts.filter(account => account.enabled !== false)
          const allClaimedToday = enabledAccounts.length > 0
            && enabledAccounts.every(account => statusOf(account.id)?.todayCheckedIn === true)
          const balanceOf = (accountId: string): ChannelBalance | undefined =>
            balances.find(row => row.accountId === accountId)
          const query = queryFor(channel.id)
          const visibleModels = modelsMatching(entry, query)
          return (
            <article
              key={channel.id}
              className="dsm-xdpool-cpool-card"
              data-state={accounts.length > 0 ? 'on' : 'idle'}
              style={{ '--dsm-xdpool-cpool-accent': channel.accent } as Record<string, string>}
            >
              <div className="dsm-xdpool-cpool-head">
                <BrandTile accent={channel.accent} glyph="login" {...tileMark} />
                <span className="dsm-xdpool-cpool-id">
                  <b>{channel.name}</b>
                  <span>{channel.org}</span>
                </span>
                <span className="dsm-xdpool-cpool-state" data-on={accounts.length > 0}>
                  {accounts.length > 0
                    ? (t?.('channelpool.stateReady') ?? 'connected')
                    : (t?.('channelpool.stateNone') ?? 'not connected')}
                </span>
              </div>
              <p className="dsm-xdpool-cpool-note">{channel.note}</p>
              <div className="dsm-xdpool-cpool-meta">
                <span>
                  {t?.('channelpool.metaAccounts', {
                    enabled: accounts.filter(account => account.enabled !== false).length,
                    total: accounts.length,
                  }) ?? `${accounts.filter(account => account.enabled !== false).length}/${accounts.length}`}
                </span>
                <span>
                  {models.length === 0
                    ? (t?.('channelpool.metaModelsUnknown') ?? 'models —')
                    : (t?.('channelpool.metaModels', { enabled: modelsEnabled, total: models.length })
                      ?? `${modelsEnabled}/${models.length}`)}
                </span>
                {channel.credits === undefined ? null : (
                  <span className="dsm-xdpool-cpool-credit">
                    {entry.balancePending && total === undefined
                      ? (t?.('channelpool.balanceLoading') ?? '…')
                      : total === undefined
                        ? (t?.('channelpool.balanceNone') ?? '—')
                        : `${amount(total)} ${unit}`}
                  </span>
                )}
              </div>
              <div className="dsm-xdpool-cpool-acts">
                {/* Only rendered when the pack really has a claim path for this
                    vendor. Drawing it for the others would put a button on the
                    card that answers `unsupported provider` every time it is
                    pressed, which reads as a broken feature, not a missing one.
                    The claim button leads and is the only solid one on the row:
                    it is the single action here that pays the reader back, so it
                    should not have to compete with "reload the number". */}
                {channel.credits?.claim === true && (
                  <button
                    type="button"
                    className="dsm-xdpool-btn"
                    data-tone={allClaimedToday ? 'claimed' : 'primary'}
                    disabled={isBusy || allClaimedToday}
                    onClick={() => { void claim(channel.id) }}
                  >
                    {isBusy
                      ? (t?.('channelpool.claiming') ?? 'Claiming…')
                      : allClaimedToday
                        ? (t?.('channelpool.claimClaimed') ?? '今日已领取')
                        : (t?.('channelpool.claim') ?? 'Claim credits')}
                  </button>
                )}
                {channel.credits !== undefined && (
                  <button
                    type="button"
                    className="dsm-xdpool-btn"
                    data-tone="quiet"
                    disabled={isBusy}
                    onClick={() => { void refreshBalances(channel.id, true) }}
                  >
                    {t?.('channelpool.refreshBalance') ?? 'Refresh balances'}
                  </button>
                )}
                {/* The two lists are this card's real navigation, so they are
                    pushed to the far edge: reading order runs credit → refresh →
                    accounts → models, and the model list is what most readers
                    came for in the first place. */}
                <span className="dsm-xdpool-cpool-acts-gap" />
                <button
                  type="button"
                  className="dsm-xdpool-cpool-fold"
                  aria-expanded={fold === 'accounts'}
                  disabled={accounts.length === 0}
                  onClick={() => toggleFold(channel.id, 'accounts')}
                >
                  {t?.('channelpool.accounts') ?? 'Accounts'} ({accounts.length})
                </button>
                <button
                  type="button"
                  className="dsm-xdpool-cpool-fold"
                  aria-expanded={fold === 'models'}
                  disabled={models.length === 0}
                  onClick={() => toggleFold(channel.id, 'models')}
                >
                  {t?.('channelpool.models') ?? 'Models'} ({modelsEnabled}/{models.length})
                </button>
              </div>
              {entry.balanceError !== undefined && (
                <p className="dsm-xdpool-cpool-balanceerror" role="status">
                  {entry.balanceError}
                </p>
              )}
              {fold === 'accounts' && (
                <ul className="dsm-xdpool-cpool-acctlist">
                  {accounts.map(account => {
                    const balance = balanceOf(account.id)
                    const amount1 = balance === undefined ? undefined : balanceAmount(balance.balance)
                    const checkin = statusOf(account.id)
                    const buckets = balance === undefined ? [] : balancePackages(balance.balance)
                    const disabled = account.enabled === false
                    return (
                      <li key={account.id} className="dsm-xdpool-cpool-acct" data-off={disabled}>
                        <span className="dsm-xdpool-cpool-acctname">{account.nickname ?? account.id}</span>
                        <span className="dsm-xdpool-cpool-acctmeta">
                          {disabled
                            ? (t?.('channelpool.disableAccount') ?? 'disabled')
                            : (t?.('channelpool.enableAccount') ?? 'enabled')}
                          {expiryText(account.expiresAt, t) === undefined ? null : ` · ${expiryText(account.expiresAt, t)}`}
                        </span>
                        {checkin?.todayCheckedIn === true && (
                          <span className="dsm-xdpool-cpool-creditbadge">
                            {t?.('channelpool.claim') ?? 'claimed'}
                            {typeof checkin.todayCredit === 'number' ? ` +${amount(checkin.todayCredit)}` : ''}
                          </span>
                        )}
                        {balance?.error !== undefined
                          ? <span className="dsm-xdpool-cpool-acctbalance" data-tone="err">{balance.error}</span>
                          : amount1 !== undefined
                            ? (
                              <span className="dsm-xdpool-cpool-acctbalance">
                                {amount(amount1)} {unit}
                                {buckets.length > 0
                                  ? ` · ${t?.('channelpool.balancePackages', { count: buckets.length }) ?? `${buckets.length} window(s)`}`
                                  : ''}
                              </span>
                            )
                            : null}
                        <span className="dsm-xdpool-cpool-acctacts">
                          <button
                            type="button"
                            className="dsm-xdpool-minibtn"
                            disabled={isBusy}
                            onClick={() => { void accountAction(channel.id, account.id, 'test') }}
                          >
                            {t?.('channelpool.testAccount') ?? 'Test'}
                          </button>
                          <button
                            type="button"
                            className="dsm-xdpool-minibtn"
                            disabled={isBusy}
                            onClick={() => { void accountAction(channel.id, account.id, 'refresh') }}
                          >
                            {t?.('channelpool.refreshAccount') ?? 'Refresh'}
                          </button>
                          <button
                            type="button"
                            className="dsm-xdpool-minibtn"
                            disabled={isBusy}
                            onClick={() => { void accountAction(channel.id, account.id, 'toggle') }}
                          >
                            {disabled
                              ? (t?.('channelpool.enableAccount') ?? 'Enable')
                              : (t?.('channelpool.disableAccount') ?? 'Disable')}
                          </button>
                          <button
                            type="button"
                            className="dsm-xdpool-minibtn"
                            data-tone="danger"
                            disabled={isBusy}
                            onClick={() => { void accountAction(channel.id, account.id, 'delete') }}
                          >
                            {t?.('channelpool.deleteAccount') ?? 'Remove'}
                          </button>
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}
              {fold === 'models' && (
                <div className="dsm-xdpool-cpool-models">
                  <div className="dsm-xdpool-cpool-modelhead">
                    <span>
                      {t?.('channelpool.metaModels', { enabled: modelsEnabled, total: models.length })
                        ?? `${modelsEnabled}/${models.length}`}
                    </span>
                    <div className="dsm-xdpool-cpool-modeltools">
                      <button
                        type="button"
                        className="dsm-xdpool-minibtn"
                        disabled={isBusy || models.length === 0}
                        onClick={() => { void setAllModels(channel.id, true) }}
                      >
                        {t?.('channelpool.allModels') ?? 'Enable all'}
                      </button>
                      <button
                        type="button"
                        className="dsm-xdpool-minibtn"
                        disabled={isBusy || models.length === 0}
                        onClick={() => { void setAllModels(channel.id, false) }}
                      >
                        {t?.('channelpool.noModelsAll') ?? 'Disable all'}
                      </button>
                    </div>
                  </div>
                  {/*
                    A catalogue of thirty rows is a wall of checkboxes with no
                    way to find the one model the reader wants. The box only
                    appears once the list is long enough to need it — a search
                    field over two rows is noise, and it costs a keystroke of
                    attention on every card.
                  */}
                  {models.length >= MODEL_SEARCH_THRESHOLD && (
                    <div className="dsm-xdpool-cpool-search">
                      <input
                        type="search"
                        className="dsm-xdpool-cpool-searchbox"
                        value={query}
                        placeholder={t?.('channelpool.searchModels') ?? 'Search models'}
                        aria-label={t?.('channelpool.searchModels') ?? 'Search models'}
                        onChange={event => { setQuery(channel.id, event.target.value) }}
                      />
                      <span className="dsm-xdpool-cpool-searchnote" role="status">
                        {query === ''
                          ? (t?.('channelpool.searchHint') ?? 'Matches name, id, description and image input')
                          : (t?.('channelpool.searchHit', { count: visibleModels.length })
                            ?? `${visibleModels.length} of ${models.length}`)}
                      </span>
                    </div>
                  )}
                  {visibleModels.length === 0 && models.length > 0 ? (
                    <p className="dsm-xdpool-cpool-empty">
                      {t?.('channelpool.searchNone', { query: query.trim() })
                        ?? `No model matches “${query.trim()}”.`}
                    </p>
                  ) : models.length === 0 ? (
                    <p className="dsm-xdpool-cpool-empty">
                      {entry.modelError === undefined
                        ? (t?.('channelpool.noModels') ?? 'No models published yet.')
                        // A refusal and an empty catalogue look identical on the
                        // wire (no rows), but only one of them is a bug the user
                        // can act on, so the reason is shown instead of a
                        // plausible-sounding "nothing published yet".
                        : (t?.('channelpool.modelError', { message: entry.modelError })
                          ?? `Could not list models: ${entry.modelError}`)}
                    </p>
                  ) : (
                    <ul className="dsm-xdpool-cpool-modellist">
                      {visibleModels.map(model => {
                        const fact = facts.get(model.id)
                        const on = enabledIds.has(model.id)
                        /*
                          Facts come from two places and are merged rather than
                          chosen between: the pack now answers `model.list` with
                          the adapter's own `resolveModel` result (window, image
                          input, output ceiling, reasoning), and the host
                          catalogue adds a vendor-written description. The pack
                          wins on every figure because it does not pass through
                          the host's "hide models without a valid credential"
                          gate, which is what used to leave eight of nine channels
                          with no numbers at all; the description is taken from
                          the host because the pack does not carry one.
                        */
                        const modalities = model.inputModalities ?? fact?.inputModalities
                        const merged = modelFactsFor({
                          contextWindow: model.contextWindow ?? fact?.contextWindow,
                          maxOutputTokens: model.maxTokens ?? fact?.maxTokens,
                          vision: modalities?.includes('image') === true
                            || modalities?.includes('images') === true,
                          supportedEfforts: model.reasoning === true ? ['thinking'] : undefined,
                          description: model.description ?? fact?.description,
                        })
                        // A recommended-use line, when the merged facts prove
                        // enough to base one on. Free and metered models alike
                        // get it; the helper returns undefined (nothing printed)
                        // when the upstream published no context window, image
                        // input or thinking levels to reason from.
                        const recuse = recommendUse(merged)
                        /*
                          The native window is only ever different from the
                          advertised one when the user already capped this
                          model, and the picker needs both to render "full" next
                          to "cap it".
                        */
                        const native = model.nativeContextWindow ?? model.contextWindow
                        const capped = native !== undefined && native > CONTEXT_BUDGET_DEFAULT
                        /*
                          The APPLIED budget, not the default one.

                          This used to fall back to CONTEXT_BUDGET_DEFAULT
                          whenever the model was merely *eligible* to be capped,
                          which made the radio claim a cap that had never been
                          saved — and worse, made the pair unclickable in one
                          direction: choosing "full" clears the stored budget,
                          after which the fallback computed the capped value
                          again and the selection snapped straight back to the
                          first radio. No stored budget means the native window
                          is what actually applies, so that is what to show.
                        */
                        const budget = model.contextBudget ?? native
                        return (
                          <li key={model.id} className="dsm-xdpool-cpool-modelrow" data-off={!on}>
                            <label className="dsm-xdpool-cpool-modelrow-toggle">
                              <input
                                type="checkbox"
                                checked={on}
                                disabled={isBusy}
                                onChange={() => { void toggleModel(channel.id, model.id, !on) }}
                              />
                              <span className="dsm-xdpool-cpool-modelname" title={model.id}>
                                {model.name ?? model.id}
                              </span>
                              {model.isFree === true && (
                                <span className="dsm-xdpool-cpool-tag" data-tone="free">
                                  {t?.('channelpool.modelFree') ?? 'free'}
                                </span>
                              )}
                              {model.dead === true && (
                                <span className="dsm-xdpool-cpool-tag" data-tone="dead">
                                  {t?.('channelpool.modelDead') ?? 'dead'}
                                </span>
                              )}
                            </label>
                            {/*
                              ModelFactsRow prints the context window, the output
                              ceiling, the image-input flag and the description,
                              and returns null when the vendor published none —
                              so a thin row stays thin instead of growing dashes.
                            */}
                            <ModelFactsRow facts={merged} className="dsm-xdpool-cpool-mfacts" t={t} />
                            {recuse === undefined ? null : (
                              <p className="dsm-xdpool-recuse">
                                <span className="dsm-xdpool-recuse-label">{t?.('recuse.label') ?? '推荐用途'}</span>
                                {recuse}
                              </p>
                            )}
                            {capped && (
                              <fieldset
                                className="dsm-xdpool-model-budget dsm-xdpool-cpool-budget"
                                aria-label={t?.('channelpool.modelBudget') ?? 'Context window'}
                              >
                                <label>
                                  <input
                                    type="radio"
                                    name={`cpool-budget-${channel.id}-${model.id}`}
                                    checked={budget === CONTEXT_BUDGET_DEFAULT}
                                    disabled={isBusy}
                                    onChange={() => {
                                      void setContextBudget(channel.id, model.id, CONTEXT_BUDGET_DEFAULT)
                                    }}
                                  />
                                  <span>{formatModelCapacity(CONTEXT_BUDGET_DEFAULT)}</span>
                                </label>
                                <label>
                                  <input
                                    type="radio"
                                    name={`cpool-budget-${channel.id}-${model.id}`}
                                    checked={budget === native}
                                    disabled={isBusy}
                                    onChange={() => { void setContextBudget(channel.id, model.id, undefined) }}
                                  />
                                  <span>{formatModelCapacity(native)}</span>
                                </label>
                              </fieldset>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              )}
              {/*
                `closed` is the pack's own word for "this channel has models but
                every one of them is in the blacklist" — its status row answers
                a question the per-model list cannot: not "which ones did I pick"
                but "are any of them available at all".
              */}
              {status?.closed === true && (
                <p className="dsm-xdpool-cpool-note">
                  {t?.('channelpool.everyModelOff', { total: status.modelsTotal })
                    ?? `All ${status.modelsTotal} models are switched off.`}
                </p>
              )}
            </article>
          )
        })}
        <div className="dsm-xdpool-cpool-acts">
          <button
            type="button"
            className="dsm-xdpool-btn"
            onClick={() => { setEnabled(new Map()); void load() }}
          >
            {t?.('channelpool.retry') ?? 'Reload'}
          </button>
        </div>
      </div>
    </section>
  )
}

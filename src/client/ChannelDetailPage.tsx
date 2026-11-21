/**
 * One channel's detail page.
 *
 * THE SHAPE, AND WHY
 *
 * The page answers a fixed sequence of questions, in the order they are asked:
 *
 *   1. What is this channel doing right now?      → the header: name, state, its figures
 *   2. How does it behave?                        → usage mode and automation, side by side,
 *                                                    because they are two switches over the same
 *                                                    thing and reading one without the other is
 *                                                    how a "why did it use that account" question
 *                                                    goes unanswered
 *   3. Who is signed in, and what does each hold?  → one card per account, because the numbers
 *                                                    belong to the account, not to the channel
 *   4. Which models may it offer?                  → a list with a switch each
 *
 * NOTHING COLLAPSES. The previous design hid all four behind disclosure triggers, so a reader had
 * to open a drawer to find out whether there was anything in it. The rail on the left already does
 * the one cut that matters — which channel — and everything inside a channel is worth showing at
 * once.
 *
 * @module dsh-xdpool/client/ChannelDetailPage
 */
import { useState, type ReactElement, type ReactNode } from 'react'
import type { XdPoolSettingsKey } from './locales.ts'

/** The translator. */
type Translate = (key: XdPoolSettingsKey, params?: Record<string, unknown>) => string

/** One account, as the page shows it. */
export interface DetailAccount {
  id: string
  name: string
  enabled: boolean
  /** Epoch ms, when the vendor publishes an expiry for the credential itself. */
  expiresAt?: number | undefined
  /** The number worth printing for this account, already formatted. */
  amount?: string | undefined
  /** 已用百分比（0–100），用来画那条细进度条；厂商不报额度时没有这个值。 */
  fill?: number | undefined
  unit?: string | undefined
  /** When this account's own credit expires. */
  amountExpiresAt?: number | undefined
  /** Why this account's balance could not be read. */
  error?: string | undefined
  /** Whether today's credit has been claimed. */
  claimedToday?: boolean | undefined
  /** Whatever else the channel reports about this account, one line. */
  meta?: string | undefined
}

/** One model row. */
export interface DetailModel {
  id: string
  name: string
  enabled: boolean
  multiplier?: number | undefined
  /** 当前生效的上下文窗口（可能已被用户设的上限压过）。 */
  contextWindow?: number | undefined
  /** 上游宣称的窗口，用来生成可选档位。 */
  nativeContextWindow?: number | undefined
  /** 上游标签：free / limited-free / night-discount。 */
  tags?: readonly string[] | undefined
  /** 上游声明的图像能力。 */
  supportsImages?: boolean | undefined
  /** 上游声明的思考档位，有就画一行。 */
  supportedEfforts?: readonly string[] | undefined
  vip?: boolean | undefined
}

/** The channel's own figures. */
export interface DetailStats {
  accounts: { total: number; active: number }
  models: { total: number; active: number }
  credit?: { amount: string; unit: string } | undefined
  creditError?: string | undefined
  /** True while the first balance read is out; the cell shows an ellipsis rather than a zero. */
  pending?: boolean | undefined
}

/** A titled band with an optional count and its own controls. */
function Band({ title, count, actions, children }: {
  title: string
  count?: string | undefined
  actions?: ReactNode
  children: ReactNode
}): ReactElement {
  return (
    <section className="sec">
      <header className="sec-head">
        <span className="sec-title">{title}</span>
        {count === undefined ? null : <span className="sec-n">{count}</span>}
        {actions === undefined ? null : <span className="sec-actions">{actions}</span>}
      </header>
      {children}
    </section>
  )
}

/** One switch, with a label and a line of explanation. */
function Toggle({ label, hint, on, disabled, onChange }: {
  label: string
  hint?: string | undefined
  on: boolean
  disabled: boolean
  onChange: (next: boolean) => void
}): ReactElement {
  return (
    <label className="sw">
      <span className="policy-hint">
        <span className="policy-k">{label}</span>
        {hint === undefined ? null : <span className="policy-hint">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        className="sw"
        data-on={on}
        disabled={disabled}
        onClick={() => { onChange(!on) }}
      >
        <span />
      </button>
    </label>
  )
}

/** The channel's figures, as cells. */
function Stats({ stats, t }: { stats: DetailStats; t?: Translate | undefined }): ReactElement {
  const credit = stats.credit === undefined
    ? stats.pending === true
      // Not "—": a balance that has not arrived is not a balance of zero, and once printed the
      // two are indistinguishable.
      ? '…'
      : stats.creditError === undefined
        ? '—'
        : (t?.('channelpool.creditFailed') ?? '读取失败')
    : stats.credit.amount
  return (
    <div className="kpis">
      <div className="kpi">
        <span className="kpi-k">{t?.('channelpool.statAccounts') ?? '账号'}</span>
        <span className="kpi-v">
          {stats.accounts.total === 0
            ? '—'
            : stats.accounts.active === stats.accounts.total
              ? String(stats.accounts.total)
              : `${String(stats.accounts.active)}/${String(stats.accounts.total)}`}
        </span>
      </div>
      <div className="kpi">
        <span className="kpi-k">{t?.('channelpool.statModels') ?? '模型'}</span>
        <span className="kpi-v">
          {stats.models.total === 0 ? '—' : `${String(stats.models.active)}/${String(stats.models.total)}`}
        </span>
      </div>
      <div className="kpi">
        <span className="kpi-k">{t?.('channelpool.statCredit') ?? '剩余积分'}</span>
        <span className="kpi-v">
          {credit}
          {stats.credit === undefined ? null : (
            <span className="kpi-u">{stats.credit.unit}</span>
          )}
        </span>
      </div>
    </div>
  )
}

/** "6 天后" / "今天", from an epoch. */
function expiryLabel(at: number, t?: Translate | undefined): string {
  const days = Math.floor((at - Date.now()) / 86_400_000)
  if (days <= 0) return t?.('channelpool.expiresToday') ?? '今天'
  return t?.('channelpool.expiresInDays', { days }) ?? `${String(days)} 天后`
}

/** Whether an expiry is close enough to flag. */
function soon(at: number): boolean {
  return at - Date.now() < 3 * 86_400_000
}

/**
 * One account, as its own card.
 *
 * A card rather than a row because the numbers belong to it: an account's balance, its expiry and
 * whether its credit has been claimed are three facts about one credential, and a row forces them
 * into columns that have to line up with every other account's — which they do not, since one
 * account has a balance and another has an error.
 */
function AccountCard({ account, busy, onToggle, onPrefer, onRemove, onOpen, t }: {
  account: DetailAccount
  busy: boolean
  onToggle: (enabled: boolean) => void
  onPrefer?: (() => void) | undefined
  onRemove?: (() => void) | undefined
  /** Opens the detail window, anchored to this card. */
  onOpen?: ((anchor: { left: number; top: number }) => void) | undefined
  t?: Translate | undefined
}): ReactElement {
  return (
    <article
      className="acct"
      onClick={(event) => {
        if (onOpen === undefined) return
        // Anchored to the card, not the pointer: a window that jumps to wherever the click
        // landed moves every time the reader clicks a different part of the same card.
        const box = event.currentTarget.getBoundingClientRect()
        onOpen({ left: box.left, top: box.bottom + 6 })
      }} data-off={!account.enabled}
    >
      <header className="acct-head">
        <span className="acct-dot" data-on={account.enabled} aria-hidden="true" />
        <span className="acct-name" title={account.id}>{account.name}</span>
        <span className="">
          <button
            type="button"
            role="switch"
            aria-checked={account.enabled}
            aria-label={account.name}
            className="sw"
            data-on={account.enabled}
            disabled={busy}
            onClick={() => { onToggle(!account.enabled) }}
          >
            <span />
          </button>
        </span>
      </header>

      {account.error === undefined ? null : (
        <p className="acct-k">{account.error}</p>
      )}

      {/*
        积分：先给一个总数，明细折起来。

        之前是「剩余积分 / 额外积分」两行平铺，读者得自己加总才知道这个账号一共有多少。
        现在卡片上只有一个总数（带到期提示），点「积分明细」看分项。
        用 <details> 而不是自己管开合状态：键盘、Esc、无障碍角色都是白拿的。
      */}
      {account.amount === undefined ? null : (
        <div className="acct-total">
          <span className="acct-total-v">
            {account.amount}
            <span className="kpi-u">{account.unit ?? ''}</span>
          </span>
          {account.amountExpiresAt === undefined ? null : (
            <span className="acct-soon" data-soon={soon(account.amountExpiresAt)}>
              {expiryLabel(account.amountExpiresAt, t)}
            </span>
          )}
        </div>
      )}
      {/*
        进度条：还剩多少，一眼可见。

        设计稿里这条是 3px 的细条，出现在总数下面。它回答的是总数的形状 ——
        「5,725」是多是少要跟上限比才知道，而横条把那个比较直接画出来。
        没有上限（厂商不报额度）时不画，空槽比没有更让人困惑。
      */}
      {account.fill === undefined ? null : (
        <div className="acct-bar" data-low={account.fill < 15}>
          <span style={{ width: `${String(Math.max(1, Math.min(100, account.fill)))}%` }} />
        </div>
      )}
      <details className="acct-detail">
        <summary>{t?.('channelpool.creditDetail') ?? '积分明细'}</summary>
        <dl className="facts facts">
          {account.amount === undefined ? null : (
          <div className="fact fact">
            <dt>{t?.('channelpool.statCredit') ?? '剩余积分'}</dt>
            <dd>
              {account.amount}
              <span className="kpi-u">{account.unit ?? ''}</span>
            </dd>
          </div>
        )}
        {account.expiresAt === undefined ? null : (
          <div className="fact fact">
            <dt>{t?.('channelpool.credentialExpiry') ?? '凭据有效期'}</dt>
            <dd>{expiryLabel(account.expiresAt, t)}</dd>
          </div>
        )}
        {account.claimedToday === undefined ? null : (
          <div className="fact fact">
            <dt>{t?.('channelpool.todayClaim') ?? '今日签到'}</dt>
            <dd data-done={account.claimedToday}>
              {account.claimedToday
                ? (t?.('channelpool.claimedToday') ?? '已领')
                : (t?.('channelpool.notClaimed') ?? '未领')}
            </dd>
          </div>
        )}
        {account.meta === undefined ? null : (
          <div className="fact fact">
            <dt>{t?.('channelpool.accountMeta') ?? '账号信息'}</dt>
            <dd>{account.meta}</dd>
          </div>
        )}
      </dl>
      </details>

      <footer className="acct-more">
        {onPrefer === undefined ? null : (
          <button
            type="button"
            className="tiny"
            disabled={busy || !account.enabled}
            title={t?.('channelpool.preferHint') ?? '优先用这个账号接下一次请求'}
            onClick={onPrefer}
          >
            {t?.('channelpool.prefer') ?? '优先'}
          </button>
        )}
        {onRemove === undefined ? null : (
          <button
            type="button"
            className="tiny tiny btn-danger"
            disabled={busy}
            onClick={onRemove}
          >
            {t?.('channelpool.remove') ?? '移除'}
          </button>
        )}
      </footer>
    </article>
  )
}


/**
 * One account's details, in a window anchored to its card.
 *
 * WHY A POPOVER
 *
 * The card shows what a reader scans for — a name, a balance, an expiry. Everything else (the
 * credential's own expiry, the credit's, whether today's has been claimed, why a read failed) is
 * detail they ask for when they ask for it. Drawing all of it on every card made a list of six
 * accounts a wall of small type; drawing none of it put the answers where they could not be found.
 *
 * Rule 009: information, not a decision — so no mask, and a click outside closes it.
 */
function AccountWindow({ account, anchor, onClose, t }: {
  account: DetailAccount
  /** Where to draw it, in viewport coordinates. */
  anchor: { left: number; top: number }
  onClose: () => void
  t?: Translate | undefined
}): ReactElement {
  return (
    <div
      className="pop"
      role="dialog"
      aria-modal="false"
      aria-label={account.name}
      style={{ left: anchor.left, top: anchor.top }}
    >
      <header className="pop-head">
        <span className="acct-dot" data-on={account.enabled} aria-hidden="true" />
        <span className="pop-name">{account.name}</span>
        <button
          type="button"
          className="pop-close"
          aria-label={t?.('channelpool.close') ?? '关闭'}
          onClick={onClose}
        >
          ×
        </button>
      </header>
      {account.error === undefined ? null : (
        <p className="acct-k">{account.error}</p>
      )}
      {/*
        进度条：还剩多少，一眼可见。

        设计稿里这条是 3px 的细条，出现在总数下面。它回答的是总数的形状 ——
        「5,725」是多是少要跟上限比才知道，而横条把那个比较直接画出来。
        没有上限（厂商不报额度）时不画，空槽比没有更让人困惑。
      */}
      {account.fill === undefined ? null : (
        <div className="acct-bar" data-low={account.fill < 15}>
          <span style={{ width: `${String(Math.max(1, Math.min(100, account.fill)))}%` }} />
        </div>
      )}
      <details className="acct-detail">
        <summary>{t?.('channelpool.creditDetail') ?? '积分明细'}</summary>
        <dl className="facts facts">
          {account.amount === undefined ? null : (
          <div className="fact fact">
            <dt>{t?.('channelpool.statCredit') ?? '剩余积分'}</dt>
            <dd>
              {account.amount}
              <span className="kpi-u">{account.unit ?? ''}</span>
            </dd>
          </div>
        )}
        {account.amountExpiresAt === undefined ? null : (
          <div className="fact fact">
            <dt>{t?.('channelpool.creditExpiry') ?? '积分到期'}</dt>
            <dd data-soon={soon(account.amountExpiresAt)}>
              {expiryLabel(account.amountExpiresAt, t)}
            </dd>
          </div>
        )}
        {account.expiresAt === undefined ? null : (
          <div className="fact fact">
            <dt>{t?.('channelpool.credentialExpiry') ?? '凭据有效期'}</dt>
            <dd>{expiryLabel(account.expiresAt, t)}</dd>
          </div>
        )}
        {account.claimedToday === undefined ? null : (
          <div className="fact fact">
            <dt>{t?.('channelpool.todayClaim') ?? '今日签到'}</dt>
            <dd data-done={account.claimedToday}>
              {account.claimedToday
                ? (t?.('channelpool.claimedToday') ?? '已领')
                : (t?.('channelpool.notClaimed') ?? '未领')}
            </dd>
          </div>
        )}
        <div className="fact fact">
          <dt>{t?.('channelpool.accountId') ?? '账号 ID'}</dt>
          <dd className="mono">{account.id}</dd>
        </div>
        {account.meta === undefined ? null : (
          <div className="fact fact">
            <dt>{t?.('channelpool.accountMeta') ?? '账号信息'}</dt>
            <dd>{account.meta}</dd>
          </div>
        )}
      </dl>
      </details>
    </div>
  )
}

/**
 * The page.
 *
 * Every band is always drawn. A band with nothing in it says so once rather than disappearing —
 * an absent section reads as "not supported", which is a different claim from "nothing here yet".
 */
export function ChannelDetailPage({
  name,
  org,
  note,
  state,
  stateLabel,
  stats,
  actions,
  addAccount,
  accountActions,
  modelActions,
  accounts,
  models,
  usage,
  automation,
  onToggleModel,
  onSetContext,
  onToggleAccount,
  onPreferAccount,
  onRemoveAccount,
  onSaveModels,
  busy,
  notice,
  t,
}: {
  name: string
  org: string
  note?: string | undefined
  state: 'ok' | 'idle' | 'error'
  stateLabel: string
  stats: DetailStats
  actions?: ReactNode
  /** The sign-in control; the page places it above the accounts. */
  addAccount?: ReactNode
  /** 账号分区头部的按钮：重新检测账号 / 全部领取 */
  accountActions?: ReactNode
  /** 模型分区头部的按钮：重新获取模型 / 全开 / 全关 */
  modelActions?: ReactNode
  accounts: readonly DetailAccount[]
  models: readonly DetailModel[]
  /** The usage-mode control, drawn beside automation. */
  usage?: ReactNode
  /** The automation control, drawn beside usage mode. */
  automation?: ReactNode
  onToggleModel: (id: string, enabled: boolean) => void
  /** 设定某个模型的上下文档位（单位 token）。 */
  onSetContext?: ((id: string, tokens: number) => void) | undefined
  onToggleAccount: (id: string, enabled: boolean) => void
  onPreferAccount?: ((id: string) => void) | undefined
  onRemoveAccount?: ((id: string) => void) | undefined
  /** Called once with the whole selection, because the pack saves one blacklist. */
  onSaveModels: (enabledIds: ReadonlySet<string>) => void
  busy: boolean
  notice?: ReactNode
  t?: Translate | undefined
}): ReactElement {
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState<ReadonlySet<string> | undefined>(undefined)
  /** Which account's window is open, and where it is anchored. */
  const [window_, setWindow] = useState<{ id: string; anchor: { left: number; top: number } } | undefined>(undefined)

  /**
   * Model switches write to a draft, then one save.
   *
   * The pack stores the blacklist as a single write, so a per-click save would be 91 requests for
   * "turn everything on" and would leave the list half-applied while they ran.
   */
  const shown = draft === undefined
    ? models
    : models.map(model => ({ ...model, enabled: draft.has(model.id) }))
  const trimmed = query.trim().toLowerCase()
  const filtered = trimmed === ''
    ? shown
    : shown.filter(model => model.name.toLowerCase().includes(trimmed))
  const enabledCount = shown.filter(model => model.enabled).length
  const dirty = draft !== undefined

  const toggleModel = (id: string, enabled: boolean): void => {
    const next = new Set(draft ?? new Set(models.filter(model => model.enabled).map(model => model.id)))
    if (enabled) next.add(id)
    else next.delete(id)
    setDraft(next)
  }

  return (
    <div className="main">
      <header className="mhead">
        <div className="mhead-title">
          <span className="mhead-name">{name}</span>
          <span className="mhead-org">{org}</span>
          <span className="pill" data-state={state}>{stateLabel}</span>
        </div>
        {actions === undefined ? null : <div className="mhead-actions">{actions}</div>}
      </header>

      <div className="mbody">
      {note === undefined ? null : <p className="note">{note}</p>}
      {notice === undefined ? null : notice}

      <Stats stats={stats} t={t} />

      {/**
        * Usage mode and automation, side by side and above the accounts.
        *
        * They are two decisions about the same subject — which account serves, and whether credits
        * are collected unattended — so they belong where the reader makes decisions, not folded
        * away under the account list where a "why did it use that account" question goes to die.
        */}
      {usage === undefined && automation === undefined ? null : (
        <div className="policies">
          {usage === undefined ? null : (
            <div className="policy">
              <span className="policy-k">
                {t?.('channelpool.usageTitle') ?? '账号使用方式'}
              </span>
              {usage}
            </div>
          )}
          {automation === undefined ? null : (
            <div className="policy">
              <span className="policy-k">
                {t?.('channelpool.autoTitle') ?? '积分自动化'}
              </span>
              {automation}
            </div>
          )}
        </div>
      )}

      <Band
        title={t?.('channelpool.accountsTitle') ?? '账号'}
        count={accounts.length === 0 ? undefined : String(accounts.length)}
        actions={<>{accountActions}{addAccount}</>}
      >
        {accounts.length === 0 ? (
          <p className="note">
            {t?.('channelpool.accountsEmpty') ?? '这个渠道还没有账号。点右上角的按钮登录一个。'}
          </p>
        ) : (
          <div className="accts">
            {accounts.map(account => (
              <AccountCard
                key={account.id}
                account={account}
                busy={busy}
                onToggle={enabled => { onToggleAccount(account.id, enabled) }}
                onPrefer={onPreferAccount === undefined
                  ? undefined
                  : () => { onPreferAccount(account.id) }}
                onRemove={onRemoveAccount === undefined
                  ? undefined
                  : () => { onRemoveAccount(account.id) }}
                onOpen={anchor => { setWindow({ id: account.id, anchor }) }}
                t={t}
              />
            ))}
          </div>
        )}
      </Band>

      {/**
        * The account's window, drawn last so it sits above the bands.
        *
        * Rule 009: information, not a decision — the page stays usable and a click outside closes
        * it, which a mask would prevent.
        */}
      {window_ === undefined ? null : (() => {
        const open = accounts.find(account => account.id === window_.id)
        return open === undefined ? null : (
          <AccountWindow
            account={open}
            anchor={window_.anchor}
            onClose={() => { setWindow(undefined) }}
            t={t}
          />
        )
      })()}

      <Band
        title={t?.('channelpool.modelsTitle') ?? '模型'}
        count={models.length === 0 ? undefined : `${String(enabledCount)}/${String(models.length)}`}
        actions={models.length === 0 ? undefined : (
          <>
            <input
              className="search"
              type="search"
              value={query}
              placeholder={t?.('channelpool.searchModel') ?? '搜索模型'}
              onChange={(event) => { setQuery(event.target.value) }}
            />
            <button
              type="button"
              className="tiny"
              disabled={busy}
              onClick={() => { setDraft(new Set(models.map(model => model.id))) }}
            >
              {t?.('channelpool.allOn') ?? '全开'}
            </button>
            <button
              type="button"
              className="tiny"
              disabled={busy}
              onClick={() => { setDraft(new Set()) }}
            >
              {t?.('channelpool.allOff') ?? '全关'}
            </button>
            {!dirty ? null : (
              <>
                <button
                  type="button"
                  className="tiny"
                  onClick={() => { setDraft(undefined) }}
                >
                  {t?.('channelpool.discard') ?? '放弃'}
                </button>
                <button
                  type="button"
                  className="tiny tiny tiny-primary"
                  disabled={busy}
                  onClick={() => {
                    onSaveModels(draft ?? new Set())
                    setDraft(undefined)
                  }}
                >
                  {t?.('channelpool.save') ?? '保存'}
                </button>
              </>
            )}
          </>
        )}
      >
        {models.length === 0 ? (
          <p className="note">
            {t?.('channelpool.modelsEmpty') ?? '这个渠道还没有发布模型。'}
          </p>
        ) : filtered.length === 0 ? (
          <p className="note">
            {t?.('channelpool.noMatch') ?? '没有匹配的模型。'}
          </p>
        ) : (
          <ul className="models">
            {filtered.map(model => (
              <li key={model.id} className="model" data-off={!model.enabled}>
                <button
                  type="button"
                  role="switch"
                  aria-checked={model.enabled}
                  aria-label={model.name}
                  className="sw"
                  data-on={model.enabled}
                  disabled={busy}
                  onClick={() => { toggleModel(model.id, !model.enabled) }}
                >
                  <span />
                </button>
                {/*
                  模型行：左边名字 + 徽章，下边一行倍率，右边一个上下文档位下拉。

                  照设计稿排成两行而不是一行：一行放不下「名字 + 三个徽章 + 倍率 + 档位」，
                  挤到最后每个都只剩两个字的宽度。分两行之后，模型名能完整显示，
                  而右侧那个下拉有固定的位置，扫一眼就知道能改。
                */}
                <span className="model-main">
                  <span className="model-top">
                    <span className="model-name" title={model.name}>{model.name}</span>
                    {isFree(model) ? (
                      <span className="badge" data-kind="free">
                        {t?.('channelpool.badgeFree') ?? '免费'}
                      </span>
                    ) : null}
                    {model.vip === true ? (
                      <span className="badge" data-kind="plan">
                        {t?.('channelpool.badgePlan') ?? '订阅'}
                      </span>
                    ) : null}
                    {model.supportsImages === true ? (
                      <span className="badge" data-kind="vision">
                        {t?.('channelpool.badgeVision') ?? '图像'}
                      </span>
                    ) : null}
                  </span>
                  {model.multiplier === undefined ? null : (
                    <span className="model-sub">
                      <span
                        className="model-mult"
                        data-free={isFree(model)}
                      >
                        ×{String(model.multiplier)}
                      </span>
                    </span>
                  )}
                </span>
                {/*
                  上下文档位。

                  上游给的窗口是上限，读者常常想压小来省积分，所以这里给的是
                  「可以选到哪里」，不是只把当前值印出来。选中的那档就是当前生效值。
                */}
                {/*
                  上下文档位。

                  能改就画下拉，不能改就画一个只读的数字 —— 两种情况都告诉读者
                  「这个模型的窗口有多大」，而不是干脆不显示。写不进去时给下拉，
                  点了没反应比不显示更糟。
                */}
                {model.nativeContextWindow === undefined || model.nativeContextWindow <= 0
                  ? null
                  : onSetContext === undefined
                    ? (
                      <span className="ctx-select">
                        {contextLabel(model.contextWindow ?? model.nativeContextWindow)}
                      </span>
                    )
                    : (
                      <select
                        className="ctx-select"
                        aria-label={`${model.name} ${t?.('channelpool.contextWindow') ?? '上下文'}`}
                        value={String(model.contextWindow ?? model.nativeContextWindow)}
                        disabled={busy || !model.enabled}
                        onChange={(event) => { onSetContext(model.id, Number(event.currentTarget.value)) }}
                      >
                        {contextTiers(model.nativeContextWindow).map(tier => (
                          <option key={tier} value={String(tier)}>{contextLabel(tier)}</option>
                        ))}
                      </select>
                    )}
              </li>
            ))}
          </ul>
        )}
      </Band>
      </div>
    </div>
  )
}

/**
 * 这个模型是不是免费的。
 *
 * 上游用标签表达：「free」是完全免费，「limited-free」是有免费额度。
 * 两个都算免费徽章 —— 读者关心的是「要不要花积分」，而不是免费到哪一档。
 */
function isFree(model: DetailModel): boolean {
  const tags = model.tags ?? []
  return tags.includes('free') || tags.includes('limited-free')
}

/**
 * 可选的上文档位。
 *
 * 从上游宣称的窗口往下取整到 64k 的倍数，最多给四档 —— 档位太多反而选不过来。
 * 最高档永远是上游原值，因为那才是真实上限，不能因为取整就把上限压掉。
 */
function contextTiers(native: number): readonly number[] {
  const out: number[] = [native]
  const steps = [1_000_000, 512_000, 256_000, 128_000, 64_000]
  for (const step of steps) {
    if (step < native && out.length < 4 && (out[out.length - 1] ?? native) > step) out.push(step)
  }
  return out
}

/** "128k" for a context window, in the unit people quote. */
function contextLabel(tokens: number): string {
  if (tokens >= 1_000_000) return `${String(Math.round(tokens / 100_000) / 10)}M`
  if (tokens >= 1_000) return `${String(Math.round(tokens / 1_000))}k`
  return String(tokens)
}

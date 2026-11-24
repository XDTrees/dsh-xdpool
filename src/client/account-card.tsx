/**
 * 账号卡 —— 一个自包含的小卡片。
 *
 * WHY THIS IS NOT `AccountBlock`
 *
 * 文件底部那个 `AccountBlock` 是 2.x 的组件：它的根元素用 `.ch-head` /
 * `.ch-title`（3.0 里那是「渠道行」的类名），内部还依赖 `.kpis` / `.facts`
 * 等一批在 3.0 被重新定义或删掉的类。把它挂进 3.0 的页面，结果是卡片没有
 * 边框和内边距、内容横向挤成一行、相互重叠 —— 3.0.4 就是这么把账号池页弄坏
 * 的。与其去修复 260 行旧结构，不如用一组独立类名（`xdp-acct*`）画一张
 * 只包含「用户真正要看的东西」的卡：它不引用任何现有页面的类，所以不会再
 * 跟设计体系打架。
 *
 * 按钮仍然复用设计稿的 `.tiny`，外观与页面其它按钮一致。
 *
 * @module dsh-xdpool/client/account-card
 */
import type { ReactElement } from 'react'
import type { PoolWebAccount } from '../status-paths.ts'

/** The translator the settings section injects, narrowed to what this card uses. */
type Translate = (key: never, params?: Record<string, unknown>) => string

export interface AccountCardProps {
  account: PoolWebAccount
  /** 池子上一次真正服务过的账号 —— 卡上的「正在使用」徽章。 */
  serving?: boolean | undefined
  /** An account operation (prefer / toggle / ignore) is in flight. */
  busy?: boolean | undefined
  /** This account's check-in claim is in flight. */
  claiming?: boolean | undefined
  t?: Translate | undefined
  onClaim: () => void
  onToggle: (disabled: boolean) => void
  onPrefer: (id: string | null) => void
  onIgnore: () => void
}

/** 积分走千分位，和卡片其它数字一致。 */
const CREDITS = new Intl.NumberFormat()

/** `12/19 20:32` —— 令牌到期只需要到分钟。 */
function formatExpiry(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const at = Date.parse(value)
  if (!Number.isFinite(at)) return undefined
  return new Intl.DateTimeFormat(undefined, {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(at))
}

export function AccountCard({
  account,
  serving = false,
  busy = false,
  claiming = false,
  t,
  onClaim,
  onToggle,
  onPrefer,
  onIgnore,
}: AccountCardProps): ReactElement {
  const total = account.credits?.total
  const expiry = formatExpiry(account.expiresAt)
  const checkin = account.checkin
  const claimed = checkin?.todayCheckedIn === true
  return (
    <article className="xdp-acct" data-serving={serving ? 'true' : undefined}>
      {/*
        名字与徽章分两行：昵称是不可信的长文本，和徽章挤在同一行时，
        省略号与徽章会争同一段空间（第一版就是这么叠在一起的）。
        独占一行之后，长度只影响它自己。
      */}
      <header className="xdp-acct-head">
        <span className="xdp-acct-name" title={account.nickname ?? account.label}>
          {account.nickname ?? account.label}
        </span>
      </header>
      {!serving && !account.disabled && !account.cooling ? null : (
        <div className="xdp-acct-badges">
          {serving
            ? <span className="xdp-acct-badge">{t?.('row.currentAccount' as never) ?? '当前使用'}</span>
            : null}
          {account.disabled ? <span className="xdp-acct-badge is-off">已停用</span> : null}
          {account.cooling ? <span className="xdp-acct-badge is-warn">冷却中</span> : null}
        </div>
      )}

      <p className="xdp-acct-meta">
        {expiry === undefined ? '令牌有效期未知' : `令牌到期 ${expiry}`}
        {account.lastUsedAt === undefined ? '' : ` · 上次使用 ${formatExpiry(account.lastUsedAt) ?? ''}`}
      </p>

      <div className="xdp-acct-credits">
        <strong>{total === undefined ? '—' : CREDITS.format(total)}</strong>
        <span>{t?.('row.creditsTotal' as never) ?? '积分'}</span>
        {checkinError(account)}
      </div>

      <footer className="xdp-acct-actions">
        <button
          type="button"
          className={account.preferred ? 'tiny is-on' : 'tiny'}
          aria-pressed={account.preferred}
          disabled={busy}
          title={account.preferred
            ? (t?.('row.accountPreferClearHint' as never) ?? '取消优先，交回按使用方式选号')
            : (t?.('row.accountPreferHint' as never) ?? '让它排在前面，仍然健康时才用')}
          onClick={() => { onPrefer(account.preferred ? null : account.id) }}
        >
          {account.preferred
            ? (t?.('row.accountPreferOn' as never) ?? '优先')
            : (t?.('row.accountPrefer' as never) ?? '优先')}
        </button>
        <button
          type="button"
          className="tiny"
          disabled={busy}
          onClick={() => { onToggle(!account.disabled) }}
        >
          {account.disabled ? '启用' : '停用'}
        </button>
        {/* 签到：一张卡一个按钮，多账号池可以逐个领，不用换号 */}
        {checkin === undefined
          ? null
          : (
            <button
              type="button"
              className="tiny"
              disabled={claiming || claimed || checkin.active !== true}
              title={checkin.active === true ? undefined : '这个账号当前没有签到活动'}
              onClick={onClaim}
            >
              {claimed
                ? (t?.('row.checkinClaimed' as never) ?? '今日已签')
                : claiming
                  ? (t?.('row.checkinClaiming' as never) ?? '签到中…')
                  : (t?.('row.checkinClaim' as never) ?? '签到')}
            </button>
          )}
        <button
          type="button"
          className="tiny"
          disabled={busy}
          title={'把这个账号从池子里永久移除（可在「已忽略」里恢复）'}
          onClick={onIgnore}
        >
          移出池子
        </button>
      </footer>
    </article>
  )
}

/** 签到不可用的原因，作为一个小标记而不是整段文字。 */
function checkinError(account: PoolWebAccount): ReactElement | null {
  if (account.checkinError === undefined) return null
  return <span className="xdp-acct-warn" title={account.checkinError}>{'签到不可用'}</span>
}

/**
 * 账号卡的样式，全部挂在自己的类名上。
 *
 * 只用 `.app` 上的设计变量（颜色、圆角、间距、字号档位），不引用任何页面级的
 * 类 —— 3.0 的设计体系改了也不会连带把这张卡弄坏。
 */
export const ACCOUNT_CARD_CSS = `
.xdp-accts{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:var(--s3)}
.xdp-acct{display:flex;flex-direction:column;gap:var(--s2);min-width:0;padding:var(--s3);border:1px solid var(--line);border-radius:var(--r-lg);background:var(--surface)}
.xdp-acct[data-serving="true"]{border-color:var(--accent-line)}
.xdp-acct .xdp-acct-head{display:block;min-width:0}
.xdp-acct .xdp-acct-name{display:block;max-width:100%;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--fs-sm);font-weight:600;color:var(--text)}
.xdp-acct .xdp-acct-badges{display:flex;flex-wrap:wrap;gap:var(--s1)}
.xdp-acct .xdp-acct-badge{flex:0 0 auto;padding:0 6px;border:1px solid var(--accent-line);border-radius:var(--r-pill);background:var(--accent-dim);color:var(--accent);font-size:var(--fs-xs);line-height:16px;white-space:nowrap}
.xdp-acct-badge.is-off{border-color:var(--line-2);background:transparent;color:var(--faint)}
.xdp-acct-badge.is-warn{border-color:color-mix(in oklch, var(--warn) 40%, transparent);background:color-mix(in oklch, var(--warn) 10%, transparent);color:var(--warn)}
.xdp-acct-meta{margin:0;font-size:var(--fs-xs);line-height:1.5;color:var(--faint);font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.xdp-acct-credits{display:flex;align-items:baseline;gap:var(--s2);min-width:0;flex-wrap:wrap}
.xdp-acct-credits strong{font-size:var(--fs-lg);font-weight:600;color:var(--text);font-variant-numeric:tabular-nums}
.xdp-acct-credits > span{font-size:var(--fs-xs);color:var(--faint)}
.xdp-acct-warn{font-size:var(--fs-xs);color:var(--warn)}
.xdp-acct-actions{display:flex;flex-wrap:wrap;gap:var(--s1);padding-top:2px}
`

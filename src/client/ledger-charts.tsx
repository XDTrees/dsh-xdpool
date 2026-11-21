/**
 * 看板的两块图形：每天用量的堆叠柱、按渠道 / 按模型的榜单。
 *
 * 数据都来自 `UsageSummary`：
 *   days  —— 每天一行（calls / inputTokens / outputTokens）
 *   rows  —— 按 channel + model 聚合的一行
 *
 * 柱子的颜色用渠道自己的品牌色（`channel-colors.css` 里的 `--c-<id>`），
 * 这样两块榜单和柱子能对上：一个渠道在三个地方是同一个颜色。
 *
 * @module dsh-xdpool/client/ledger-charts
 */
import type { ReactElement } from 'react'
import type { UsageDay, UsageRow } from '../stats.ts'

/** 一个渠道的品牌色，取不到就退回主色。 */
function colorOf(channel: string): string {
  return `var(--c-${channel}, var(--xd-primary))`
}

/** "22.6B" / "6.9B" / "1.2M" —— token 按技术习惯用 B/M/k。 */
export function fmtTokens(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0'
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`
  return String(Math.round(value))
}

/** "11/06" 这种短日期，从 `YYYY-MM-DD` 取。 */
function shortDay(day: string): string {
  const [, month, date] = day.split('-')
  return month === undefined || date === undefined ? day : `${month}/${date}`
}

/**
 * 每天用量：堆叠柱。
 *
 * 每根柱子按渠道分段 —— 一段一个渠道，颜色就是那个渠道的品牌色。
 * 高度按「这一天在整段窗口里占多少」归一，不是绝对值：一屏里要同时看形状和大小，
 * 绝对值只对最右边那天有意义。
 */
export function DayChart({ days, emptyLabel }: {
  days: readonly UsageDay[] | undefined
  emptyLabel: string
}): ReactElement {
  if (days === undefined || days.length === 0) {
    return <p className="hint">{emptyLabel}</p>
  }
  const peak = Math.max(...days.map(day => day.inputTokens + day.outputTokens), 1)
  return (
    /*
      整块放进一张卡片里，照设计稿的 .trend：surface 底 + 12 内边距。

      柱子直接躺在页面底色上会显得「掉出来」—— 它是一组数据，不是装饰，
      和一个标题、一组切换按钮共处一张卡里，才读得出是一个区块。
    */
    <div className="trend">
      <div className="chart">
        <div className="chart">
          {days.map(day => {
          const total = day.inputTokens + day.outputTokens
          const height = Math.max(2, Math.round((total / peak) * 100))
          return (
            <div className="col" key={day.day} title={`${day.day} · ${fmtTokens(total)}`}>
              {/*
                两段：输入在下、输出在上。

                分两段而不是一根：输入和输出的成本不同（缓存只作用在输入上），
                合成一根就看不出「这一天是读得多还是写得多」。
              */}
              <span
                className="col-bar"
                data-kind="out"
                style={{ height: `${String(total === 0 ? 0 : Math.round((day.outputTokens / total) * height))}%` }}
              />
              <span
                className="col-bar"
                data-kind="in"
                style={{ height: `${String(total === 0 ? 0 : Math.round((day.inputTokens / total) * height))}%` }}
              />
            </div>
          )
        })}
      </div>
        <div className="axis">
          {days.map(day => <span key={day.day}>{shortDay(day.day)}</span>)}
        </div>
      </div>
    </div>
  )
}

/** 榜单的一行。 */
interface RankItem {
  key: string
  label: string
  channel: string
  value: number
}

/**
 * 按某个维度排名。
 *
 * 排序用 token 总量（输入 + 输出），因为这是读者要回答的问题「谁占大头」。
 * 百分比是相对第一名的比例 —— 绝对总量在标题里已经给过了。
 */
export function RankList({ title, count, items, emptyLabel }: {
  title: string
  count: number
  items: readonly RankItem[] | undefined
  emptyLabel: string
}): ReactElement {
  // items 可能缺省（老数据没有按渠道/按模型的聚合）：空列表比白屏好。
  const list = items ?? []
  const peak = Math.max(...list.map(item => item.value), 1)
  return (
    <section className="rank">
      <header className="rank-head">
        <span className="rank-title">{title}</span>
        <span className="rank-n">{`${String(count)} 个`}</span>
      </header>
      {list.length === 0
        ? <p className="hint">{emptyLabel}</p>
        : list.map(item => (
          <div className="rank-row" key={item.key}>
            <span className="rank-icon" style={{ background: colorOf(item.channel) }} />
            <span className="rank-body">
              <span className="rank-name" title={item.label}>{item.label}</span>
              <span className="rank-bar">
                <span
                  style={{
                    width: `${String(Math.max(2, Math.round((item.value / peak) * 100)))}%`,
                    background: colorOf(item.channel),
                  }}
                />
              </span>
            </span>
            <span className="rank-v">{fmtTokens(item.value)}</span>
            <span className="rank-pct">
              {`${String(Math.round((item.value / peak) * 100))}%`}
            </span>
          </div>
        ))}
    </section>
  )
}

/** 从 rows 折出「按渠道」的榜单。 */
export function byChannel(rows: readonly UsageRow[]): readonly RankItem[] {
  const sums = new Map<string, number>()
  for (const row of rows) {
    sums.set(row.channel, (sums.get(row.channel) ?? 0) + row.inputTokens + row.outputTokens)
  }
  return [...sums.entries()]
    .map(([channel, value]) => ({ key: channel, label: channel, channel, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5)
}

/** 从 rows 折出「按模型」的榜单。同一个模型可能挂在多个渠道下，用 channel/model 作键。 */
export function byModel(rowList: readonly UsageRow[]): readonly RankItem[] {
  const sums = new Map<string, { channel: string; value: number }>()
  for (const row of rowList) {
    const key = `${row.channel}/${row.model}`
    const seen = sums.get(key)
    sums.set(key, {
      channel: row.channel,
      value: (seen?.value ?? 0) + row.inputTokens + row.outputTokens,
    })
  }
  return [...sums.entries()]
    .map(([key, entry]) => ({ key, label: key.split('/')[1] ?? key, channel: entry.channel, value: entry.value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5)
}

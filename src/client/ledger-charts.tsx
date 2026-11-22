/**
 * 数据看板的图形块：每天用量的堆叠柱（.trend）、按渠道 / 按模型 / 按账号的榜单（.rank）。
 *
 * 结构、类名一律照设计稿 xdpool-design/ledger.html：
 *   .trend > .trend-head(.trend-title + .trend-actions .chip) + .chart > .col > .col-seg + .axis
 *   .rank  > .rank-head(.rank-title + .rank-n) + .rank-row(.rank-icon + .rank-body + .rank-v + .rank-pct)
 *
 * 颜色用渠道自己的品牌色（`channel-colors.css` 里的 `--c-<id>`），图标用 `icons.css`
 * 的 `--icon-<id>`：一个渠道在柱子、榜单、明细表三处是同一个颜色、同一个图标。
 *
 * 数据可能缺字段、可能是空数组 —— 每个入口都先兜底，宁可显示「暂无数据」也不能白屏。
 *
 * @module dsh-xdpool/client/ledger-charts
 */
import type { CSSProperties, ReactElement } from 'react'
import type { UsageDay, UsageRow } from '../stats.ts'
import { REGISTERED_CHANNELS } from '../channel-roster.ts'
import { channelIcon } from './channel-icons.ts'

/**
 * 一条用量记录属于哪个「品牌」（决定名字、图标、颜色）。
 *
 * 号池自己的 WorkBuddy 线路记成 channel=`workbuddy` + region=`cn`/`global`，
 * 而设计稿的图标 / 颜色变量把国内版叫 `buddy`、国际版叫 `workbuddy`（与 channel-roster 一致）。
 * 老样本没有 channel 字段，只能按 region 判断。
 */
export function brandKey(channel: string, region: string): string {
  if (channel === 'workbuddy') return region === 'cn' ? 'buddy' : 'workbuddy'
  if (channel === '') return region === 'global' ? 'workbuddy' : 'buddy'
  return channel
}

const NAME_BY_ID: ReadonlyMap<string, string> = new Map(REGISTERED_CHANNELS.map(c => [c.id, c.name] as const))

/** 品牌的中文显示名；花名册里没有的（聚合厂商 id）原样显示 id。 */
export function brandName(key: string): string {
  if (key === 'free') return '免密通道'
  if (key === '') return '未知渠道'
  return NAME_BY_ID.get(key) ?? key
}

/** 品牌色，取不到就退回主色。 */
export function brandColor(key: string): string {
  return key === '' ? 'var(--accent)' : `var(--c-${key}, var(--accent))`
}

/** 图标块（.rank-icon / .td-ch .m）的背景图。没有图标时只剩设计稿给的底色。 */
export function brandIconStyle(key: string): CSSProperties {
  const icon = key === '' ? undefined : channelIcon(key)
  if (icon === undefined) return {}
  if (icon.startsWith('css:')) return { backgroundImage: `var(${icon.slice(4)})` }
  return { backgroundImage: `url("${icon}")` }
}

/** token 数拆成「数字 + 单位」，给 .sum-v 和 .sum-u 用：35.7 / B。 */
export function splitTokens(value: number): readonly [string, string] {
  if (!Number.isFinite(value) || value <= 0) return ['0', '']
  if (value >= 1_000_000_000) return [(value / 1_000_000_000).toFixed(1), 'B']
  if (value >= 1_000_000) return [(value / 1_000_000).toFixed(1), 'M']
  if (value >= 1_000) return [(value / 1_000).toFixed(1), 'k']
  return [String(Math.round(value)), '']
}

/** "22.6B" / "6.9B" / "1.2M" —— token 按技术习惯用 B/M/k。 */
export function fmtTokens(value: number): string {
  const [num, unit] = splitTokens(value)
  return `${num}${unit}`
}

/** "11/06" 这种短日期，从 `YYYY-MM-DD` 取。 */
function shortDay(day: string): string {
  const [, month, date] = day.split('-')
  return month === undefined || date === undefined ? day : `${month}/${date}`
}

/** 趋势图在数什么。费用没有数据源（没有价格表），所以只有这两种。 */
export type TrendMetric = 'tokens' | 'calls'

/** 某一天里一个渠道的那一段。 */
export interface DaySegment {
  key: string
  tokens: number
  calls: number
}

/**
 * 每天用量：按渠道分段的堆叠柱。
 *
 * 高度按「这一天占整段窗口峰值的多少」归一，段的顺序由调用方给（小的在上、大的在下，
 * 和设计稿一样）。没有分段数据时（老版本后端只给 days）退成一整根。
 */
export function DayChart({ title, days, emptyLabel, segments, metric, onMetric, todayKey }: {
  /** 区块名，显示在趋势图上方的标题行。 */
  title: string
  days: readonly UsageDay[] | undefined
  emptyLabel: string
  segments?: ReadonlyMap<string, readonly DaySegment[]> | undefined
  metric: TrendMetric
  onMetric: (metric: TrendMetric) => void
  /** 今天的 `YYYY-MM-DD`，轴上那一天写「今天」。 */
  todayKey: string
}): ReactElement {
  const empty = days === undefined || days.length === 0
  const list = days ?? []
  const columns = list.map(day => {
    const own = segments?.get(day.day)
    const segs: readonly DaySegment[] = own ?? [{
      key: '',
      tokens: (Number.isFinite(day.inputTokens) ? day.inputTokens : 0) + (Number.isFinite(day.outputTokens) ? day.outputTokens : 0),
      calls: Number.isFinite(day.calls) ? day.calls : 0,
    }]
    const parts = segs
      .map(seg => ({ key: seg.key, value: metric === 'tokens' ? seg.tokens : seg.calls }))
      .filter(part => Number.isFinite(part.value) && part.value > 0)
    const total = parts.reduce((n, part) => n + part.value, 0)
    return { day: day.day, parts, total }
  })
  const peak = Math.max(1, ...columns.map(column => column.total))
  /* 30 天时轴标签放不下，隔几天写一个，并且总是从「今天」往回数 */
  const step = Math.max(1, Math.ceil(list.length / 15))
  const fmtValue = (value: number): string => (metric === 'tokens' ? `${fmtTokens(value)} token` : `${String(value)} 次调用`)
  return (
    <section className="trend">
      <div className="trend-head">
        <span className="trend-title">{title}</span>
        <span className="trend-actions">
          <button type="button" className="chip" aria-pressed={metric === 'tokens'} onClick={() => { onMetric('tokens') }}>
            Token
          </button>
          <button type="button" className="chip" aria-pressed={metric === 'calls'} onClick={() => { onMetric('calls') }}>
            调用
          </button>
        </span>
      </div>
      {empty
        ? (
          <div
            className="chart"
            style={{ alignItems: 'center', justifyContent: 'center', color: 'var(--faint)', fontSize: 'var(--fs-xs)' }}
          >
            {emptyLabel}
          </div>
        )
        : (
          <>
            <div className="chart">
              {columns.map(column => (
                <div
                  className="col"
                  key={column.day}
                  title={[
                    `${column.day} · ${fmtValue(column.total)}`,
                    ...column.parts.slice().reverse().map(part => `${brandName(part.key)}：${fmtValue(part.value)}`),
                  ].join('\n')}
                >
                  {column.parts.map(part => (
                    <span
                      key={part.key === '' ? '*' : part.key}
                      className="col-seg"
                      style={{
                        height: `${String(Math.max(1, Math.round((part.value / peak) * 100)))}%`,
                        background: brandColor(part.key),
                        borderRadius: 2,
                        flex: '0 0 auto',
                      }}
                    />
                  ))}
                </div>
              ))}
            </div>
            <div className="axis">
              {list.map((day, index) => (
                <span key={day.day} style={{ flex: '1 1 0', minWidth: 0 }}>
                  {(list.length - 1 - index) % step === 0
                    ? (day.day === todayKey ? '今天' : shortDay(day.day))
                    : ''}
                </span>
              ))}
            </div>
          </>
        )}
    </section>
  )
}

/** 榜单的一行。 */
export interface RankItem {
  key: string
  label: string
  /** 品牌 key，决定图标和进度条颜色。 */
  brand: string
  tokens: number
  calls: number
  /** 鼠标悬停时的补充说明。 */
  title?: string
}

/**
 * 一张榜单。
 *
 * 按 token 总量（输入 + 输出）排；网关没上报 token 时改按调用次数排，免得一列全是 0。
 * 进度条相对第一名，百分比是占全部的份额（设计稿里五行加起来是 100%）。
 * 只画前五 —— 「谁占大头」看前三行就有答案了，右上角写出总共几个。
 */
export function RankList({ title, unit, items, by, emptyLabel }: {
  title: string
  /** 右上角计数的量词：渠道 / 模型 / 账号。 */
  unit: string
  items: readonly RankItem[] | undefined
  by: 'tokens' | 'calls'
  emptyLabel: string
}): ReactElement {
  // items 可能缺省（老数据没有这个聚合）：空列表比白屏好。
  const list = items ?? []
  const valueOf = (item: RankItem): number => {
    const value = by === 'tokens' ? item.tokens : item.calls
    return Number.isFinite(value) && value > 0 ? value : 0
  }
  const sorted = [...list].sort((a, b) => valueOf(b) - valueOf(a))
  const total = sorted.reduce((n, item) => n + valueOf(item), 0)
  const peak = Math.max(1, ...sorted.map(valueOf))
  return (
    <section className="rank">
      <div className="rank-head">
        <span className="rank-title">{title}</span>
        <span className="rank-n">{`${String(list.length)} 个${unit}`}</span>
      </div>
      {sorted.length === 0
        ? (
          <div className="rank-row" style={{ gridTemplateColumns: 'minmax(0,1fr)', color: 'var(--faint)', fontSize: 'var(--fs-xs)' }}>
            {emptyLabel}
          </div>
        )
        : sorted.slice(0, 5).map(item => {
          const value = valueOf(item)
          return (
            <div className="rank-row" key={item.key} title={item.title ?? item.label}>
              <span className="rank-icon" style={brandIconStyle(item.brand)} />
              <span className="rank-body">
                <span className="rank-name">{item.label}</span>
                <span className="rank-bar">
                  <span
                    style={{
                      width: `${String(value === 0 ? 0 : Math.max(2, Math.round((value / peak) * 100)))}%`,
                      background: brandColor(item.brand),
                    }}
                  />
                </span>
              </span>
              <span className="rank-v num">{by === 'tokens' ? fmtTokens(value) : `${String(value)} 次`}</span>
              <span className="rank-pct num">
                {total <= 0 ? '—' : `${((value / total) * 100).toFixed(1)}%`}
              </span>
            </div>
          )
        })}
    </section>
  )
}

/** 从 rows 折出「按渠道」的榜单（全部，排序和截断由 RankList 做）。 */
export function byChannel(rows: readonly UsageRow[] | undefined): readonly RankItem[] {
  const sums = new Map<string, { tokens: number; calls: number }>()
  for (const row of rows ?? []) {
    const brand = brandKey(row.channel, row.region)
    const seen = sums.get(brand) ?? { tokens: 0, calls: 0 }
    sums.set(brand, { tokens: seen.tokens + row.inputTokens + row.outputTokens, calls: seen.calls + row.calls })
  }
  return [...sums.entries()].map(([brand, sum]) => ({
    key: brand,
    label: brandName(brand),
    brand,
    tokens: sum.tokens,
    calls: sum.calls,
  }))
}

/** 从 rows 折出「按模型」的榜单。同一个模型可能挂在多个渠道下，用 渠道 + 模型 作键。 */
export function byModel(rows: readonly UsageRow[] | undefined): readonly RankItem[] {
  const sums = new Map<string, { brand: string; model: string; tokens: number; calls: number; tps: number | null }>()
  for (const row of rows ?? []) {
    const brand = brandKey(row.channel, row.region)
    const key = `${brand}\u0000${row.model}`
    const seen = sums.get(key)
    sums.set(key, {
      brand,
      model: row.model,
      tokens: (seen?.tokens ?? 0) + row.inputTokens + row.outputTokens,
      calls: (seen?.calls ?? 0) + row.calls,
      tps: seen?.tps ?? row.tps,
    })
  }
  return [...sums.entries()].map(([key, entry]) => ({
    key,
    label: entry.model === '' ? '未知模型' : entry.model,
    brand: entry.brand,
    tokens: entry.tokens,
    calls: entry.calls,
    title: `${brandName(entry.brand)} · 调用 ${String(entry.calls)} 次${entry.tps === null ? '' : ` · 输出 ${String(entry.tps)} tok/s`}`,
  }))
}

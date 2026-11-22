/**
 * 聊天输入框旁边的积分小图标，以及点开后的「本会话积分」小卡片。
 *
 * 跟着当前模型走
 *
 * 小卡片说的是「我现在选的这个模型，走的是哪个渠道、那个渠道还剩多少、今天花了多少」。
 * 2.7.x 只统计 WorkBuddy 账号池，用 TRAE、CodeArts 这类登录渠道的模型时显示的却是
 * WorkBuddy 的积分 —— 一个和当前模型无关的数字。现在按下面的顺序认出当前模型的渠道：
 *
 *   1. 宿主自己存的「当前选择」里带了渠道（provider）且这家确实有这个模型 → 用它；
 *   2. 本次启动以来最近一次调用这个模型的渠道（POOL_USAGE_PATH 的逐条记录）；
 *   3. 今天的用量账本里调用这个模型最多的渠道；
 *   4. 模型目录：哪几家发布了这个模型（倍率对得上的优先，有余额的优先）。
 *
 * 认出来的依据会写在卡片上（「依据：最近一次调用」），读者能判断这个数字可不可信。
 *
 * 数据从哪来
 *
 *   - WorkBuddy 国内 / 国际：账号池状态（POOL_STATUS_PATH），按地区合并 —— 和账号池卡片一个数。
 *   - 登录渠道：账号池页面存在本机的快照（dsh-xdpool.pool-snapshot.v2）里的余额和模型；
 *     卡片打开或轮询时，再向 pack 现读一次当前渠道的余额（只读这一家）。
 *   - 今日已用：token 账本（POOL_CREDITS_SPEND_PATH?days=1），按渠道取。
 *   - Marvis：按 token 计，用快照里每个账号的「已用 / 总量」。
 *
 * 绿点 = 当前渠道还有余额；灰点 = 没余额或读不到（读不到不能说「还有」）；
 * 不按积分计费的渠道（免密通道、聚合渠道填 key 的）是中性色，卡片上写明「不按积分计费」。
 *
 * 样式在 credit-dot-css.ts（dsm-xdpool-dot* 命名空间）：小图标在 DSH 的聊天框里，
 * 不在插件页面的 .app 里，设计稿的类名在这里没有样式。
 *
 * @module dsh-xdpool/client/CreditDot
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { POOL_CREDITS_SPEND_PATH, POOL_STATUS_PATH, POOL_USAGE_PATH } from '../status-paths.ts'
import { POOL_NAV_ICON_MASK_URL } from './nav-icon.ts'
import { brandKey, brandName } from './ledger-charts.tsx'
import { balancesFrom, balancesTotal, callPack, type ChannelBalance as PackBalance } from './channel-rpc.ts'
import { baseName, multiplierOf } from './model-facts.ts'
import type { XdPoolSettingsKey } from './locales.ts'

type Translate = (key: XdPoolSettingsKey, params?: Record<string, unknown>) => string

/** WorkBuddy 账号池按地区合并后的一行。 */
interface RegionBalance {
  id: string
  name: string
  total: number
  accounts: number
}

/** 一家渠道在卡片上的样子。 */
interface Lane {
  /** 和用量账本、账号池一致的渠道 id：buddy / workbuddy / trae / codearts / free / 聚合厂商 id… */
  id: string
  name: string
  /** 剩余；undefined = 这家不报余额，或者还没读到 */
  total: number | undefined
  /** 余额的单位 */
  unit: string
  /** 这家按积分 / 额度计费（免密通道、填 key 的聚合厂商不算） */
  metered: boolean
  accounts: number
  /** 今天花了多少（和 total 同单位）；undefined = 不知道 */
  spent: number | undefined
  /** 今天经它走的 token（花费没定价时的兜底） */
  tokensToday: number
  /** 今天确实服务过请求 */
  served: boolean
  /** Marvis 这类按 token 计的：今天的总额度 */
  quotaTotal?: number | undefined
  /** 发布的模型（用来认「当前模型是谁家的」） */
  models: readonly { id: string; name: string }[]
}

/** 卡片要画的全部。 */
interface Snapshot {
  /** 当前模型所在的渠道；认不出来时 undefined */
  channel: Lane | undefined
  /** 同一个模型还能走的其他渠道 */
  all: readonly Lane[]
  /** 认出渠道的依据，写在卡片上 */
  why: string
  model: string
  multiplier: number | undefined
  /** 余额 + 今日已用 = 今天开始时有多少，用来画用量条 */
  baseline: number
  /** 今天服务过请求的那几家 */
  usedChannels: readonly Lane[]
  /** 本机还没有账号池快照（没打开过账号池页面），登录渠道的余额读不到 */
  noStore: boolean
}

/** 轮询间隔。余额只在花钱时变，不用太勤。 */
const POLL_MS = 45_000
/** 账号池页面写的本机快照（见 ChannelPoolSection.tsx 的 writeStoredPool）。 */
const POOL_STORE_KEY = 'dsh-xdpool.pool-snapshot.v2'
/** Marvis 每个账号每天的 token 额度。 */
const MARVIS_DAILY_TOKENS = 10_000_000
/**
 * 余额不走 pack credits.balances 的渠道：它们有插件自己的钱包路由，
 * 卡片直接用快照里的数，不在聊天框里再发一次请求。
 */
const OWN_WALLET: ReadonlySet<string> = new Set([
  'buddy', 'workbuddy', 'doubao', 'marvis', 'astudio', 'accio', 'monkeycode', 'monkeycode-intl',
  'baizhi', 'autoclaw', 'autoclaw-intl', 'autoclaw-cn', 'magicrew', 'magicrew-intl',
])

/** `21887` → `21,887`。 */
function grouped(value: number): string {
  return Number.isFinite(value) ? Math.round(value).toLocaleString('en-US') : '0'
}

/** `0.11` → `0.11`。倍率是价格，原样写。 */
function rate(value: number): string {
  return Number.isFinite(value) ? String(value) : '—'
}

/** token 数写成「123.4 万」。 */
function wan(value: number): string {
  if (!Number.isFinite(value)) return '0'
  if (value < 10_000) return grouped(value)
  return `${(value / 10_000).toLocaleString('en-US', { maximumFractionDigits: 1 })} 万`
}

/** 一个数加单位。token 用「万」，其余分千位。 */
function withUnit(value: number, unit: string): string {
  if (unit === 'token') return `${wan(value)} token`
  if (unit === '%') return `${String(Math.round(value))}%`
  if (unit === '美元') return `$${value.toFixed(2)}`
  return `${grouped(value)} ${unit}`
}

/**
 * 按地区分 WorkBuddy 账号，不按凭据域名。
 *
 * 一个号池是服务同一个网关的一组账号；从 copilot.tencent.com、codebuddy.cn 还是
 * workbuddy.cn 登进来，只是凭据的签发方不同，不是另一个池。按域名分会把账号池卡片上的
 * 「WorkBuddy 国内版 · 14,089」拆成 13,990 + 99 两行，两个界面对不上。
 */
function regionOfDomain(domain: string): 'cn' | 'global' {
  // `www.workbuddy.ai` 是国际站；其余（copilot.tencent.com / codebuddy.cn / workbuddy.cn）都是国内池。
  return domain.toLowerCase().includes('workbuddy.ai') ? 'global' : 'cn'
}

function channelsOf(value: unknown): RegionBalance[] {
  if (value === null || typeof value !== 'object') return []
  const accounts = (value as { accounts?: unknown }).accounts
  if (!Array.isArray(accounts)) return []
  const byRegion = new Map<string, { total: number; accounts: number }>()
  for (const raw of accounts) {
    if (raw === null || typeof raw !== 'object') continue
    const row = raw as Record<string, unknown>
    const credits = row['credits']
    if (credits === null || typeof credits !== 'object') continue
    const total = (credits as Record<string, unknown>)['total']
    // 没读到余额的账号不算进总数（算成 0 会低估），但它仍属于这个地区
    if (typeof total !== 'number' || !Number.isFinite(total)) continue
    const domain = typeof row['domain'] === 'string' ? row['domain'] : ''
    const region = regionOfDomain(domain)
    const current = byRegion.get(region) ?? { total: 0, accounts: 0 }
    current.total += total
    current.accounts += 1
    byRegion.set(region, current)
  }
  return [...byRegion.entries()]
    .map(([region, value2]) => ({
      // 和用量账本、账号池页面同一套 id：国内 buddy，国际 workbuddy
      id: region === 'global' ? 'workbuddy' : 'buddy',
      name: region === 'global' ? 'WorkBuddy 国际版' : 'WorkBuddy 国内版',
      total: value2.total,
      accounts: value2.accounts,
    }))
    .sort((a, b) => b.total - a.total)
}

/**
 * 输入框里当前选中的模型名。
 *
 * 账号池状态里没有「当前模型」字段（`selection` 是启用的模型列表，取第一个永远是
 * hy4-preview）。宿主把当前选择渲染在输入框那一行的按钮上 ——
 * `DeepSeek-V4.1-Flash · x0.11 High`，读它就和输入框永远一致。
 */
function readSelectedModel(): string {
  return readSelectedCaption()?.model ?? ''
}

/** 当前模型的按钮文字，拆成「模型名」和「倍率」。 */
function readSelectedCaption(): { model: string; multiplier: number | undefined } | undefined {
  if (typeof document === 'undefined') return undefined
  // 只在输入框那一块找，免得把聊天记录里的模型名当成当前选择
  const roots = document.querySelectorAll('[data-composer-seat], [data-composer-dock]')
  for (const root of roots) {
    for (const button of root.querySelectorAll('button')) {
      const text = (button.textContent ?? '').trim()
      if (text === '') continue
      // 模型按钮的文字带倍率后缀，这是它和返回、发送按钮的区别
      const priced = /·\s*x\d/u.test(text)
      // 登录渠道的免费模型写的是「· 免费」而不是倍率
      const free = /·\s*(?:限时)?免费/u.test(text)
      if (!priced && !free) continue
      const model = text.split('·')[0]?.trim() ?? ''
      if (model === '') continue
      const mult = /·\s*x\s*([\d.]+)/u.exec(text)?.[1]
      const multiplier = free ? 0 : mult === undefined ? undefined : Number(mult)
      return { model, multiplier: multiplier !== undefined && Number.isFinite(multiplier) ? multiplier : undefined }
    }
  }
  return undefined
}

/**
 * 宿主自己存的当前选择里带的渠道 id（如果有）。
 *
 * 宿主的模型选择存在 localStorage 里，但键名和结构插件拿不到正式说明，所以这里只做
 * 宽松的查找：键名带 model、值是 JSON、里面某层有 current / selected 对象带 provider。
 * 找到的 provider 只有在那家渠道真的发布了当前模型时才会被采用（pickLane 里把关），
 * 找错了也只是退回下一个依据，不会显示错的渠道。
 */
function readSelectedProvider(): string | undefined {
  try {
    const store = globalThis.localStorage
    if (store === undefined || store === null) return undefined
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i)
      if (key === null || !/model/iu.test(key) || key.startsWith('dsh-xdpool')) continue
      const raw = store.getItem(key)
      if (raw === null || raw.length > 50_000 || !raw.trimStart().startsWith('{')) continue
      const found = findProvider(JSON.parse(raw) as unknown, 0)
      if (found !== undefined) return found
    }
  } catch {
    // 读不了就算了
  }
  return undefined
}

function findProvider(node: unknown, depth: number): string | undefined {
  if (depth > 4 || node === null || typeof node !== 'object' || Array.isArray(node)) return undefined
  const record = node as Record<string, unknown>
  for (const slot of ['current', 'selected', 'active']) {
    const value = record[slot]
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const row = value as Record<string, unknown>
      const provider = row['providerId'] ?? row['provider']
      const model = row['modelId'] ?? row['model']
      if (typeof provider === 'string' && provider !== '' && typeof model === 'string' && model !== '') return provider
    }
  }
  for (const value of Object.values(record)) {
    const found = findProvider(value, depth + 1)
    if (found !== undefined) return found
  }
  return undefined
}

/**
 * 模型名的比较键：去掉倍率后缀、渠道前缀和标点，只留小写字母数字。
 * `DeepSeek-V4.1-Flash · x0.11`、`deepseek-v4.1-flash`、`trae:deepseek-v4.1-flash`
 * 都是 `deepseekv41flash`。
 */
function modelKey(text: string): string {
  const bare = baseName(text).toLowerCase()
  const last = bare.split('/').pop() ?? bare
  return last.replace(/^[a-z0-9-]+:(?=.)/u, '').replace(/[^a-z0-9]/gu, '')
}

/** 两个模型是不是同一个：完全相同，或只差一个日期 / 版本号尾巴（`…flash` 和 `…flash1017`）。 */
function sameModel(a: string, b: string): boolean {
  if (a === '' || b === '') return false
  if (a === b) return true
  const [short, long] = a.length < b.length ? [a, b] : [b, a]
  return short.length >= 5 && long.startsWith(short) && /^(?:\d+|free|batch)+$/u.test(long.slice(short.length))
}

/** 本机快照里的一家渠道。 */
interface StoredLane {
  id: string
  name: string
  unit: string
  metered: boolean
  accounts: number
  total: number | undefined
  models: readonly { id: string; name: string }[]
}

/** 读账号池页面存下的快照。没打开过账号池页面就是空的。 */
function readStoredLanes(): { lanes: StoredLane[]; marvis: { used: number; total: number; available: number }[] } {
  const empty = { lanes: [], marvis: [] }
  try {
    const raw = globalThis.localStorage?.getItem(POOL_STORE_KEY)
    if (raw === null || raw === undefined) return empty
    const parsed = JSON.parse(raw) as { v?: unknown; entries?: unknown; marvis?: unknown } | null
    if (parsed === null || parsed.v !== 2 || !Array.isArray(parsed.entries)) return empty
    const lanes: StoredLane[] = []
    for (const item of parsed.entries as unknown[]) {
      if (item === null || typeof item !== 'object') continue
      const entry = item as { channel?: unknown; accounts?: unknown; models?: unknown; balances?: unknown }
      const channel = entry.channel as { id?: unknown; name?: unknown; credits?: unknown } | undefined
      if (channel === undefined || typeof channel.id !== 'string') continue
      const credits = channel.credits !== null && typeof channel.credits === 'object'
        ? channel.credits as { unit?: unknown; quota?: unknown }
        : undefined
      const accounts = Array.isArray(entry.accounts)
        ? (entry.accounts as { id?: unknown }[]).filter(row => typeof row.id === 'string' && !row.id.startsWith('cached-')).length
        : 0
      const models = Array.isArray(entry.models)
        ? (entry.models as { id?: unknown; name?: unknown }[])
          .filter((row): row is { id: string; name: string } =>
            typeof row.id === 'string' && !row.id.startsWith('cached-') && typeof row.name === 'string')
          .map(row => ({ id: row.id, name: row.name }))
        : []
      const balances = Array.isArray(entry.balances) ? entry.balances as PackBalance[] : []
      lanes.push({
        id: channel.id,
        name: typeof channel.name === 'string' ? channel.name : brandName(channel.id),
        unit: channel.id === 'marvis' ? 'token'
          : credits?.unit === 'dollars' ? '美元'
            : credits?.unit === 'tokens' ? 'token'
              : credits?.quota === true ? '%' : '积分',
        metered: credits !== undefined || channel.id === 'marvis',
        accounts,
        total: balancesTotal(balances),
        models,
      })
    }
    const marvis = Array.isArray(parsed.marvis)
      ? (parsed.marvis as { used?: unknown; total?: unknown; available?: unknown; error?: unknown }[])
        .filter(row => row.error === undefined || row.error === null)
        .map(row => {
          const used = typeof row.used === 'number' ? row.used : 0
          const total = typeof row.total === 'number' && row.total > 0 ? row.total : MARVIS_DAILY_TOKENS
          const available = typeof row.available === 'number' ? row.available : Math.max(0, total - used)
          return { used, total, available }
        })
      : []
    return { lanes, marvis }
  } catch {
    return empty
  }
}

/** 一次轮询拿到的原始数据；换模型时不用重新请求，直接用它重新认渠道。 */
interface Raw {
  status: Record<string, unknown> | undefined
  spendChannels: readonly { channel: string; credits: number | undefined; requests: number; tokens: number }[]
  spendRows: readonly { channel: string; model: string; requests: number }[]
  usage: readonly { channel: string; region: string; model: string; at: number }[]
}

/** 把几处数据合成每家渠道一行。 */
function buildLanes(raw: Raw, live: ReadonlyMap<string, number>): Map<string, Lane> {
  const lanes = new Map<string, Lane>()
  const stored = readStoredLanes()
  const startOfToday = new Date(new Date().setHours(0, 0, 0, 0)).getTime()
  const spendOf = (id: string): Raw['spendChannels'][number] | undefined =>
    raw.spendChannels.find(row => row.channel === id)
  const usageToday = (id: string): number =>
    raw.usage.filter(row => row.at >= startOfToday && brandKey(row.channel, row.region) === id).length
  const base = (id: string, name: string): Lane => {
    const spend = spendOf(id)
    return {
      id,
      name,
      total: undefined,
      unit: '',
      metered: false,
      accounts: 0,
      spent: spend?.credits,
      tokensToday: spend?.tokens ?? 0,
      served: (spend?.requests ?? 0) > 0 || usageToday(id) > 0,
      models: [],
    }
  }
  for (const row of stored.lanes) {
    lanes.set(row.id, {
      ...base(row.id, row.name),
      total: live.get(row.id) ?? row.total,
      unit: row.unit,
      metered: row.metered,
      accounts: row.accounts,
      models: row.models,
    })
  }
  /* WorkBuddy：账号池状态是现读的，比快照新；模型列表也在状态里 */
  const statusModels = raw.status?.['models']
  const poolModels = Array.isArray(statusModels)
    ? (statusModels as Record<string, unknown>[])
      .filter(row => typeof row['id'] === 'string')
      .map(row => ({ id: row['id'] as string, name: typeof row['name'] === 'string' ? row['name'] as string : row['id'] as string }))
    : []
  for (const region of channelsOf(raw.status)) {
    const before = lanes.get(region.id)
    lanes.set(region.id, {
      ...(before ?? base(region.id, region.name)),
      name: region.name,
      total: region.total,
      unit: '积分',
      metered: true,
      accounts: region.accounts,
      models: poolModels.length > 0 ? poolModels : before?.models ?? [],
    })
  }
  /* Marvis：按 token 计，用每个账号自己的「已用 / 总量」 */
  const marvis = lanes.get('marvis')
  if (marvis !== undefined && stored.marvis.length > 0) {
    const used = stored.marvis.reduce((sum, row) => sum + row.used, 0)
    const total = stored.marvis.reduce((sum, row) => sum + row.total, 0)
    lanes.set('marvis', {
      ...marvis,
      unit: 'token',
      total: stored.marvis.reduce((sum, row) => sum + row.available, 0),
      spent: used,
      quotaTotal: total,
    })
  }
  /* 账本里出现、但快照里没有的渠道（免密通道、聚合厂商）：不按积分计费 */
  for (const row of raw.spendChannels) {
    if (!lanes.has(row.channel)) lanes.set(row.channel, base(row.channel, brandName(row.channel)))
  }
  for (const row of raw.usage) {
    const id = brandKey(row.channel, row.region)
    if (!lanes.has(id)) lanes.set(id, base(id, brandName(id)))
  }
  return lanes
}

/** 这家渠道发布了这个模型吗。 */
function publishes(lane: Lane, key: string): boolean {
  return lane.models.some(model => sameModel(modelKey(model.id), key) || sameModel(modelKey(model.name), key))
}

/** 认出当前模型走的是哪家。 */
function pickLane(
  selected: string,
  multiplier: number | undefined,
  raw: Raw,
  lanes: ReadonlyMap<string, Lane>,
): { lane: Lane | undefined; why: string; candidates: readonly Lane[] } {
  const key = modelKey(selected)
  const candidates = [...lanes.values()].filter(lane => publishes(lane, key))
  if (key === '') return { lane: undefined, why: '', candidates: [] }

  /* 1. 宿主当前选择里的 provider */
  const provider = readSelectedProvider()
  if (provider !== undefined) {
    const direct = lanes.get(provider)
    if (direct !== undefined && publishes(direct, key)) return { lane: direct, why: '当前选择', candidates }
  }
  /* 2. 本次启动以来最近一次调用这个模型的渠道 */
  const latest = [...raw.usage]
    .filter(row => sameModel(modelKey(row.model), key))
    .sort((a, b) => b.at - a.at)[0]
  if (latest !== undefined) {
    const lane = lanes.get(brandKey(latest.channel, latest.region))
    if (lane !== undefined) return { lane, why: '最近一次调用', candidates }
  }
  /* 3. 今天账本里调这个模型最多的渠道 */
  const busiest = [...raw.spendRows]
    .filter(row => row.requests > 0 && sameModel(modelKey(row.model), key))
    .sort((a, b) => b.requests - a.requests)[0]
  if (busiest !== undefined) {
    const lane = lanes.get(busiest.channel)
    if (lane !== undefined) return { lane, why: '今天的调用记录', candidates }
  }
  /* 4. 模型目录：倍率对得上的优先，有余额的优先，有账号的优先 */
  const score = (lane: Lane): number => {
    let points = 0
    if (multiplier !== undefined) {
      const hit = lane.models.find(model => sameModel(modelKey(model.name), key) || sameModel(modelKey(model.id), key))
      const text = hit === undefined ? undefined : multiplierOf(hit.name)
      const value = text === undefined ? undefined : /免费/u.test(text) ? 0 : Number(/[\d.]+/u.exec(text.split('→').pop() ?? '')?.[0])
      if (value !== undefined && Number.isFinite(value) && Math.abs(value - multiplier) < 0.005) points += 4
    }
    if (lane.metered && (lane.total ?? 0) > 0) points += 2
    if (lane.accounts > 0) points += 1
    return points
  }
  const best = [...candidates].sort((a, b) => score(b) - score(a))[0]
  if (best !== undefined) return { lane: best, why: candidates.length > 1 ? '模型目录（多家都有，按倍率和余额推断）' : '模型目录', candidates }
  return { lane: undefined, why: '', candidates }
}

/** 把一次轮询的原始数据和当前模型合成卡片。 */
function compose(raw: Raw, live: ReadonlyMap<string, number>, caption: { model: string; multiplier: number | undefined } | undefined, poolMultiplier: number | undefined): Snapshot {
  const lanes = buildLanes(raw, live)
  const model = caption?.model ?? ''
  const multiplier = caption?.multiplier ?? poolMultiplier
  const { lane, why, candidates } = pickLane(model, multiplier, raw, lanes)
  const all = candidates.filter(row => row.id !== lane?.id && (row.accounts > 0 || row.total !== undefined))
  const usedChannels = [...lanes.values()].filter(row => row.served)
  const baseline = lane === undefined
    ? 0
    : lane.quotaTotal ?? ((lane.total ?? 0) + (lane.spent ?? 0))
  return {
    channel: lane,
    all,
    why,
    model,
    multiplier,
    baseline,
    usedChannels,
    noStore: readStoredLanes().lanes.length === 0,
  }
}

export function CreditDot({ t }: { readonly t?: Translate | undefined }): ReactElement | null {
  const [snapshot, setSnapshot] = useState<Snapshot | undefined>(undefined)
  const [open, setOpen] = useState(false)
  const [failed, setFailed] = useState(false)
  const anchorRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | undefined>(undefined)
  const mounted = useRef(true)
  /** 最近一次轮询的原始数据：换模型时直接拿它重新认渠道，不再发请求 */
  const rawRef = useRef<Raw | undefined>(undefined)
  /** 向 pack 现读到的余额（只读当前那一家），渠道 id → 余额 */
  const liveRef = useRef<Map<string, number>>(new Map())
  const liveAtRef = useRef<Map<string, number>>(new Map())

  /** 用手上的数据重新合成卡片（换模型、现读余额回来时调用）。 */
  const recompose = useCallback((): void => {
    const raw = rawRef.current
    if (raw === undefined || !mounted.current) return
    const caption = readSelectedCaption()
    const statusModels = raw.status?.['models']
    const models = Array.isArray(statusModels) ? statusModels as Record<string, unknown>[] : []
    const chosen = caption?.model ?? ''
    const row = chosen === '' ? undefined : models.find(candidate => candidate['id'] === chosen || candidate['name'] === chosen)
    const poolMultiplier = typeof row?.['multiplier'] === 'number' ? row['multiplier'] as number : undefined
    const next = compose(raw, liveRef.current, caption, poolMultiplier)
    setSnapshot(next)
    /* 当前渠道是走 pack 的登录渠道：现读一次它的余额（45 秒内不重复） */
    const lane = next.channel
    if (lane !== undefined && lane.metered && !OWN_WALLET.has(lane.id)
      && Date.now() - (liveAtRef.current.get(lane.id) ?? 0) > POLL_MS) {
      liveAtRef.current.set(lane.id, Date.now())
      void callPack('credits.balances', { provider: lane.id })
        .then(envelope => {
          if (!envelope.ok) return
          const total = balancesTotal(balancesFrom(envelope))
          if (total === undefined || liveRef.current.get(lane.id) === total) return
          liveRef.current.set(lane.id, total)
          recompose()
        })
        .catch(() => undefined)
    }
  }, [])

  const load = useCallback(async (): Promise<void> => {
    try {
      const [statusRes, spendRes, usageRes] = await Promise.all([
        fetch(POOL_STATUS_PATH, { headers: { accept: 'application/json' } }).catch(() => undefined),
        fetch(`${POOL_CREDITS_SPEND_PATH}?days=1`, { headers: { accept: 'application/json' } }).catch(() => undefined),
        fetch(POOL_USAGE_PATH, { headers: { accept: 'application/json' }, credentials: 'same-origin' }).catch(() => undefined),
      ])
      if (!mounted.current) return
      const status = statusRes?.ok === true
        ? await statusRes.json().catch(() => undefined) as Record<string, unknown> | undefined
        : undefined

      /* 今天每家渠道花了多少（activeChannels：今天真正服务过请求的渠道） */
      const activeChannels = new Set<string>()
      const spendChannels: Raw['spendChannels'][number][] = []
      const spendRows: Raw['spendRows'][number][] = []
      if (spendRes !== undefined && spendRes.ok) {
        const spend = await spendRes.json().catch(() => undefined) as { channels?: unknown; rows?: unknown } | undefined
        const spendChannelList = spend?.channels
        const spendRowList = spend?.rows
        for (const item of Array.isArray(spendChannelList) ? spendChannelList as unknown[] : []) {
          if (item === null || typeof item !== 'object') continue
          const record = item as Record<string, unknown>
          const rawId = record['channel']
          const id = typeof rawId === 'string' ? rawId : ''
          if (id === '') continue
          const num = (key: string): number => {
            const value = record[key]
            return typeof value === 'number' && Number.isFinite(value) ? value : 0
          }
          const credits = record['credits']
          const requests = num('requests')
          if (requests > 0) activeChannels.add(id)
          spendChannels.push({
            channel: id,
            // 0 积分但有调用：这家的模型没有公布系数，不是「没花」
            credits: typeof credits === 'number' && Number.isFinite(credits) && (credits > 0 || num('unpricedModels') === 0)
              ? Math.round(credits * 100) / 100
              : undefined,
            requests,
            tokens: num('inputTokens') + num('outputTokens') + num('cacheTokens'),
          })
        }
        for (const item of Array.isArray(spendRowList) ? spendRowList as unknown[] : []) {
          if (item === null || typeof item !== 'object') continue
          const record = item as Record<string, unknown>
          const rowChannel = record['channel']
          const rowModel = record['model']
          if (typeof rowChannel !== 'string' || typeof rowModel !== 'string') continue
          spendRows.push({
            channel: rowChannel,
            model: rowModel,
            requests: typeof record['requests'] === 'number' ? record['requests'] : 0,
          })
        }
      }
      const usage: Raw['usage'][number][] = []
      if (usageRes !== undefined && usageRes.ok) {
        const body = await usageRes.json().catch(() => undefined) as { entries?: unknown } | undefined
        const entries = body?.entries
        for (const item of Array.isArray(entries) ? entries as unknown[] : []) {
          if (item === null || typeof item !== 'object') continue
          const record = item as Record<string, unknown>
          const callModel = record['model']
          const callAt = record['at']
          const callChannel = record['channel']
          const callRegion = record['region']
          if (typeof callModel !== 'string' || typeof callAt !== 'number') continue
          usage.push({
            channel: typeof callChannel === 'string' ? callChannel : '',
            region: typeof callRegion === 'string' ? callRegion : '',
            model: callModel,
            at: callAt,
          })
        }
      }
      if (!mounted.current) return
      if (status === undefined && spendChannels.length === 0 && usage.length === 0 && readStoredLanes().lanes.length === 0) {
        throw new Error('nothing readable')
      }
      rawRef.current = { status, spendChannels, spendRows, usage }
      void activeChannels
      recompose()
      setFailed(false)
    } catch {
      if (mounted.current) setFailed(true)
    }
  }, [recompose])

  useEffect(() => {
    mounted.current = true
    void load()
    const timer = window.setInterval(() => { void load() }, POLL_MS)
    return () => {
      mounted.current = false
      window.clearInterval(timer)
    }
  }, [load])

  /* 打开卡片时立刻刷新一次：读者点开就是要看现在的数 */
  useEffect(() => {
    if (open) void load()
  }, [open, load])

  /**
   * 跟着输入框里的模型变。
   *
   * 余额 45 秒轮询一次就够，模型却是用户一选就变。MutationObserver 在按钮文字变化时
   * 触发，用手上的数据重新认渠道，不发网络请求；合并到下一帧，一次重渲染只算一次。
   */
  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return undefined
    let scheduled = false
    let lastModel = readSelectedModel()
    const sync = (): void => {
      scheduled = false
      if (!mounted.current) return
      const next = readSelectedModel()
      if (next === '' || next === lastModel) return
      lastModel = next
      recompose()
    }
    const observer = new MutationObserver(() => {
      if (scheduled) return
      scheduled = true
      window.requestAnimationFrame(sync)
    })
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    return () => { observer.disconnect() }
  }, [recompose])

  /**
   * Place the panel above the dot.
   *
   * Measured rather than CSS-anchored because the composer row can be at the bottom of
   * the viewport, and a panel that opens downward would be clipped by it. `side: top`
   * with a viewport clamp is the same rule the host's own meters follow.
   */
  useLayoutEffect(() => {
    if (!open) { setPos(undefined); return }
    const anchor = anchorRef.current
    if (anchor === null) return
    const box = anchor.getBoundingClientRect()
    /**
     * The panel sizes to its content (`width: max-content`), so its width can only be
     * read AFTER it has rendered. A hard-coded number here was what made a short line of
     * text sit in a 300px box: the width came from this layout maths rather than from
     * what the text needed. Measuring the element keeps the two in step.
     *
     * Falling back to 200 when the ref is not attached yet (first frame) is safe: the
     * effect re-runs on `open`, and the panel is `visibility: hidden` until `pos` exists.
     */
    const width = panelRef.current?.offsetWidth ?? 200
    const margin = 8
    const left = Math.min(
      Math.max(margin, box.left + box.width / 2 - width / 2),
      Math.max(margin, window.innerWidth - width - margin),
    )
    // Above the dot by default; if there is no room, below it.
    const panelHeight = panelRef.current?.offsetHeight ?? 240
    const above = box.top - panelHeight - 8
    const top = above >= margin ? above : box.bottom + 8
    setPos({ top, left })
  }, [open])

  /**
   * Re-measure once the panel has painted.
   *
   * `width: max-content` means the first pass measures a zero-width element: the panel is
   * attached but `pos` is still undefined, so it is laid out at its min-width. Re-running
   * after the content exists is what makes the width follow the text rather than the
   * placeholder. Keyed on the model and the channel so a longer name (a real possibility
   * with a `· 14,031` suffix) triggers a fresh measurement.
   */
  useLayoutEffect(() => {
    if (!open) return
    const anchor = anchorRef.current
    const panel = panelRef.current
    if (anchor === null || panel === null) return
    const box = anchor.getBoundingClientRect()
    const width = panel.offsetWidth
    const margin = 8
    const left = Math.min(
      Math.max(margin, box.left + box.width / 2 - width / 2),
      Math.max(margin, window.innerWidth - width - margin),
    )
    const above = box.top - panel.offsetHeight - 8
    setPos(current => {
      if (current === undefined) return current
      const top = above >= margin ? above : box.bottom + 8
      // Skip the write when nothing moved: an identical setState still schedules a render.
      if (current.top === top && current.left === left) return current
      return { top, left }
    })
  }, [open, snapshot?.model, snapshot?.channel?.total, snapshot?.channel?.spent])

  /** Outside click and Escape, the two ways any popover on this host closes. */
  useEffect(() => {
    if (!open) return undefined
    const onPointer = (event: MouseEvent): void => {
      const target = event.target as Node | null
      if (target === null) return
      if (anchorRef.current?.contains(target) === true) return
      if (panelRef.current?.contains(target) === true) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointer, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])


  /*
    小图标永远画出来，读不到数据时在卡片里说明 —— 否则新会话点下去是一个空框。

    颜色三种：
      alive  当前渠道还有余额（绿）
      empty  没余额，或者读不到（灰）—— 读不到不能说「还有」
      none   当前渠道本来就不按积分计费（免密通道、填 key 的聚合厂商）
  */
  const ready = snapshot !== undefined && !failed
  const total = snapshot?.channel?.total ?? 0
  const alive = ready && snapshot.channel !== undefined && snapshot.channel.metered && total > 0
  const unmetered = ready && snapshot.channel !== undefined && !snapshot.channel.metered
  const state = alive ? 'alive' : unmetered ? 'none' : 'empty'
  const lane = ready ? snapshot.channel : undefined
  const label = alive
    ? (t?.('dot.alive') ?? '还有积分')
    : unmetered
      ? '当前渠道不按积分计费'
      : (t?.('dot.empty') ?? '没有积分了')
  /** 今日已用：有定价就是积分 / token，没定价就写经它走了多少 token。 */
  const spentText = lane === undefined
    ? '—'
    : lane.spent !== undefined && lane.unit !== ''
      ? withUnit(lane.spent, lane.unit)
      : lane.tokensToday > 0
        ? `${wan(lane.tokensToday)} token`
        : lane.served ? '—' : '0'
  const fill = snapshot === undefined || snapshot.baseline <= 0 || lane === undefined
    ? undefined
    : Math.min(100, Math.max(0, (lane.spent ?? 0) / snapshot.baseline * 100))

  return (
    <span
      className="dsm-xdpool-dotwrap"
      style={{ ['--xdpool-dot-mask' as string]: `url("${POOL_NAV_ICON_MASK_URL}")` }}
    >
      <button
        ref={anchorRef}
        type="button"
        className="dsm-xdpool-dot"
        data-state={state}
        aria-label={label}
        aria-expanded={open}
        title={lane === undefined
          ? label
          : `${lane.name} · ${lane.total === undefined ? '—' : withUnit(lane.total, lane.unit)}`}
        onClick={() => { setOpen(current => !current) }}
      >
        {/* 插件自己的图标做遮罩，颜色跟着 data-state 走 */}
        <span className="dsm-xdpool-dot-glyph" aria-hidden="true" />
      </button>
      {/*
        卡片 portal 到 document.body：输入框外层带 will-change: transform，
        fixed 定位会以它为参照，卡片会跑到窗口下面几百像素、还把会话区撑出一块空白。
      */}
      {!open ? null : createPortal((
        <div
          ref={panelRef}
          className="dsm-xdpool-dotpanel"
          role="dialog"
          aria-label={t?.('dot.panelTitle') ?? '本会话积分'}
          style={pos === undefined ? { visibility: 'hidden' } : { top: `${String(pos.top)}px`, left: `${String(pos.left)}px` }}
        >
          {!ready ? (
            <p className="dsm-xdpool-dotpanel-hint">
              {failed
                ? (t?.('dot.loadFailed') ?? '积分数据读取失败')
                : (t?.('dot.loading') ?? '正在读取积分…')}
            </p>
          ) : null}
          {!ready ? null : (
            <>
              {/* 头部：当前模型走的渠道 · 它还剩多少 */}
              <div className="dsm-xdpool-dotpanel-head">
                <span className="dsm-xdpool-dotpanel-channel">
                  {lane === undefined
                    ? (t?.('dot.channelUnknown') ?? '没认出当前模型的渠道')
                    : !lane.metered
                      ? `${lane.name} · 不按积分计费`
                      : `${lane.name} · ${lane.total === undefined ? '—' : withUnit(lane.total, lane.unit)}`}
                </span>
              </div>
              {lane === undefined || snapshot.why === '' ? null : (
                <span className="dsm-xdpool-dotpanel-k-sub">{`依据：${snapshot.why}`}</span>
              )}
              {/* 用量条：今天用掉的占比，越满用得越多，过 90% 变琥珀色 */}
              {fill === undefined || lane === undefined || !lane.metered ? null : (
                <div className="dsm-xdpool-dotbar" role="img" aria-label={t?.('dot.barLabel') ?? '今日已用占比'}>
                  <div
                    className="dsm-xdpool-dotbar-fill"
                    data-full={fill >= 90 ? 'true' : 'false'}
                    style={{ width: `${String(fill)}%` }}
                  />
                </div>
              )}
              <div className="dsm-xdpool-dotpanel-sec">
                <span className="dsm-xdpool-dotpanel-k">{t?.('dot.spentToday') ?? '今日已用'}</span>
                <span className="dsm-xdpool-dotpanel-v">
                  {lane?.quotaTotal === undefined ? spentText : `${spentText} / ${wan(lane.quotaTotal)}`}
                </span>
              </div>
              <div className="dsm-xdpool-dotpanel-sec">
                <span className="dsm-xdpool-dotpanel-k">{t?.('dot.model') ?? '模型'}</span>
                <span className="dsm-xdpool-dotpanel-v">
                  {snapshot.model === '' ? '—' : snapshot.model}
                  {snapshot.multiplier === undefined ? '' : ` · x${rate(snapshot.multiplier)}`}
                </span>
              </div>
              {/* 同一个模型还能走的其他渠道：今天用过的名字亮一点 */}
              {(snapshot.all ?? []).length === 0 ? null : (
                <div className="dsm-xdpool-dotpanel-more">
                  <span className="dsm-xdpool-dotpanel-k-sub">同一模型的其他渠道</span>
                  {(snapshot.all ?? []).map(other => {
                    const used = snapshot.usedChannels.some(row => row.id === other.id)
                    return (
                      <div className="dsm-xdpool-dotpanel-row" key={other.id}>
                        <span className="dsm-xdpool-dotpanel-rowname" data-used={used ? 'true' : 'false'}>
                          {other.name}
                        </span>
                        <span className="dsm-xdpool-dotpanel-rowval">
                          {!other.metered ? '不计积分' : other.total === undefined ? '—' : withUnit(other.total, other.unit)}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
              {lane === undefined && snapshot.noStore ? (
                <p className="dsm-xdpool-dotpanel-hint">打开一次 XD Pool 的账号池页面，这里就能认出登录渠道的模型和积分。</p>
              ) : null}
            </>
          )}
        </div>
      ), document.body)}
    </span>
  )
}

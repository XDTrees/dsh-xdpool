/**
 * Magicrew 的上游调用：余额、目录、签到、网关 key 续期。
 *
 * ## 端点（来自参考实现的实测协议表）
 *
 * | 用途 | 方法 | 地址 | 认证 |
 * |---|---|---|---|
 * | 目录 | GET | `/api/v1/flows/models` | JWT |
 * | 积分 | GET | `/api/v1/quota/points/total` | JWT |
 * | 签到 | POST | `/api/v1/login-gift` | JWT |
 * | 新人任务 | GET | `/api/v1/onboarding/tasks` | JWT |
 * | 续 gateway key | PUT | `/api/v1/model-gateway/tokens` | refresh_token |
 *
 * ## 两个必须记住的坑
 *
 * 1. **错误藏在 body 里**：错配的 key 会得到 `HTTP 200 + {"code":403}`。
 *    所以每个调用都要判 `body.code`，不能只判 `res.ok`。
 * 2. **积分有三个来源**：`quota/points/total` 给总数，`expiring_quota_details`
 *    只覆盖**带到期时间的批次**，两者的差就是「永久积分」。
 *    不合成这个包，卡片上会出现「批次加起来 1661、合计 2661」，
 *    读者以为丢了 1000 分。
 *
 * @module dsh-xdpool/magicrew-upstream
 */
import {
  MAGICREW_CN,
  magicrewJwtClaims,
  parseMagicrewCredential,
  type MagicrewCredential,
  type MagicrewProduct,
} from './magicrew-protocol.ts'

/** 一次请求的超时。上游偶发长时间不回，没有超时会把界面卡死。 */
const REQUEST_TIMEOUT_MS = 20_000

export interface MagicrewFetchResult {
  ok: boolean
  /** HTTP 状态；网络层就失败时是 0。 */
  status: number
  /** 解析后的 JSON；解析不出来是 undefined。 */
  body?: unknown
  /** 一句话的错误，已经翻成中文。 */
  error?: string
}

/**
 * 打一个上游请求。
 *
 * 把「HTTP 失败」和「HTTP 200 但 body.code 是错误码」合成一个判据 ——
 * 上游两种都用，只判前者会漏掉一半。
 */
async function call(
  product: MagicrewProduct,
  path: string,
  init: {
    method?: string
    jwt?: string
    apiKey?: string
    body?: unknown
    signal?: AbortSignal | undefined
  } = {},
): Promise<MagicrewFetchResult> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    /* Origin 必带 —— 缺了上游偶发 403（实测） */
    origin: product.webOrigin,
    referer: `${product.webOrigin}/`,
  }
  if (init.jwt !== undefined) headers['authorization'] = `Bearer ${init.jwt}`
  if (init.apiKey !== undefined) headers['x-api-key'] = init.apiKey
  if (init.body !== undefined) headers['content-type'] = 'application/json'

  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, REQUEST_TIMEOUT_MS)
  const onAbort = (): void => { controller.abort() }
  init.signal?.addEventListener('abort', onAbort)
  try {
    const response = await fetch(`${product.host}${path}`, {
      method: init.method ?? 'GET',
      headers,
      ...init.body === undefined ? {} : { body: JSON.stringify(init.body) },
      signal: controller.signal,
    })
    const text = await response.text()
    let parsed: unknown
    try {
      parsed = text === '' ? undefined : JSON.parse(text)
    } catch {
      parsed = undefined
    }
    /*
      上游的错误码走 body.code。常见的三个：
        401 / 403 → 登录态失效，要重新登
        2182      → 国际站缺 organizationCode
    */
    const code = parsed !== null && typeof parsed === 'object'
      ? (parsed as { code?: unknown }).code
      : undefined
    const numericCode = typeof code === 'number' ? code : undefined
    if (numericCode !== undefined && numericCode !== 0 && numericCode !== 200) {
      const message = parsed !== null && typeof parsed === 'object'
        ? String((parsed as { message?: unknown }).message ?? '')
        : ''
      if (numericCode === 2182) {
        return { ok: false, status: response.status, body: parsed, error: '缺少组织码（国际站必需）' }
      }
      if (numericCode === 401 || numericCode === 403) {
        return { ok: false, status: response.status, body: parsed, error: '登录态已失效，请重新登录' }
      }
      return {
        ok: false,
        status: response.status,
        body: parsed,
        error: message === '' ? `上游返回错误码 ${String(numericCode)}` : message,
      }
    }
    if (!response.ok) {
      return { ok: false, status: response.status, body: parsed, error: `HTTP ${String(response.status)}` }
    }
    return { ok: true, status: response.status, body: parsed }
  } catch (cause: unknown) {
    const aborted = cause instanceof Error && cause.name === 'AbortError'
    return {
      ok: false,
      status: 0,
      error: aborted ? '请求超时（20 秒）' : (cause instanceof Error ? cause.message : String(cause)),
    }
  } finally {
    clearTimeout(timer)
    init.signal?.removeEventListener('abort', onAbort)
  }
}

/** 一个积分包。 */
export interface MagicrewPackage {
  name: string
  /** 剩余比例 0-100。 */
  remaining?: number
  /** 这份包的总量。 */
  total?: number
  /** 剩余绝对量。 */
  amount?: number
  /** 扣费截止时刻，epoch ms。 */
  expiresAt?: number
}

export interface MagicrewBalance {
  /** 总积分。 */
  total: number
  packages: readonly MagicrewPackage[]
}

/**
 * 读积分。
 *
 * `total` 与 `expiring_quota_details` 的差**合成一个「永久积分」包** ——
 * 上游只给带到期时间的批次，不给的那部分是永久的。不补这个包，
 * 卡片上批次和会小于总数，看起来像少了积分。
 */
export async function magicrewBalance(
  credential: MagicrewCredential,
  product: MagicrewProduct = MAGICREW_CN,
  signal?: AbortSignal,
): Promise<{ ok: true; value: MagicrewBalance } | { ok: false; error: string }> {
  const answer = await call(product, '/api/v1/quota/points/total', { jwt: credential.jwt, signal })
  if (!answer.ok) return { ok: false, error: answer.error ?? '读取积分失败' }
  const body = answer.body
  if (body === null || typeof body !== 'object') return { ok: false, error: '积分接口返回了空内容' }
  const record = body as Record<string, unknown>
  /* 有的版本包一层 data */
  const data = (record['data'] ?? record) as Record<string, unknown>
  const total = readNumber(data['total']) ?? readNumber(data['points']) ?? 0

  const rawPackages = data['expiring_quota_details'] ?? data['expiringQuotaDetails']
  const packages: MagicrewPackage[] = []
  let covered = 0
  if (Array.isArray(rawPackages)) {
    for (const entry of rawPackages) {
      if (entry === null || typeof entry !== 'object') continue
      const row = entry as Record<string, unknown>
      const amount = readNumber(row['remaining']) ?? readNumber(row['quota']) ?? readNumber(row['amount'])
      if (amount === undefined) continue
      covered += amount
      const rawExpiry = row['deductionEndTime'] ?? row['deduction_end_time'] ?? row['expireTime']
      const expiresAt = readEpochMsFrom(rawExpiry)
      const name = typeof row['name'] === 'string' && row['name'] !== ''
        ? row['name']
        : (expiresAt === undefined ? '永久积分' : '限时积分')
      packages.push({
        name,
        amount,
        ...expiresAt === undefined ? {} : { expiresAt },
      })
    }
  }
  /*
    残差 = 永久积分。上游不给它们到期时间，所以上面的循环收不到；
    不补这一条，卡片上「包加起来」会小于「合计」。
  */
  const permanent = Math.max(0, total - covered)
  if (permanent > 0) packages.unshift({ name: '永久积分', amount: permanent })
  return { ok: true, value: { total, packages } }
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

/** 上游的到期时间：无时区串按 UTC+8。与 protocol 里那份同规则。 */
function readEpochMsFrom(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value < 1e12 ? Math.round(value * 1000) : Math.round(value)
  }
  if (typeof value !== 'string' || value.trim() === '') return undefined
  const text = value.trim()
  const bare = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/u.exec(text)
  if (bare !== null) {
    const ms = Date.UTC(
      Number(bare[1]), Number(bare[2]) - 1, Number(bare[3]),
      Number(bare[4]), Number(bare[5]), Number(bare[6]),
    ) - 8 * 3600_000
    return Number.isFinite(ms) ? ms : undefined
  }
  const parsed = Date.parse(text)
  return Number.isFinite(parsed) ? parsed : undefined
}

/** 一个模型。 */
export interface MagicrewModel {
  id: string
  name: string
  contextWindow?: number
  maxTokens?: number
}

/** 读模型目录。 */
export async function magicrewCatalog(
  credential: MagicrewCredential,
  product: MagicrewProduct = MAGICREW_CN,
  signal?: AbortSignal,
): Promise<{ ok: true; value: readonly MagicrewModel[] } | { ok: false; error: string }> {
  const answer = await call(product, '/api/v1/flows/models', { jwt: credential.jwt, signal })
  if (!answer.ok) return { ok: false, error: answer.error ?? '读取模型目录失败' }
  const body = answer.body
  const data = body !== null && typeof body === 'object'
    ? ((body as Record<string, unknown>)['data'] ?? body)
    : undefined
  const rows = Array.isArray(data)
    ? data
    : (data !== null && typeof data === 'object'
      ? (data as Record<string, unknown>)['models'] ?? (data as Record<string, unknown>)['list']
      : undefined)
  if (!Array.isArray(rows)) return { ok: true, value: [] }
  const models: MagicrewModel[] = []
  for (const entry of rows) {
    if (entry === null || typeof entry !== 'object') continue
    const row = entry as Record<string, unknown>
    const id = typeof row['id'] === 'string' ? row['id'] : (typeof row['model'] === 'string' ? row['model'] : undefined)
    if (id === undefined || id === '') continue
    const name = typeof row['name'] === 'string' && row['name'] !== '' ? row['name'] : id
    const contextWindow = readNumber(row['contextWindow'] ?? row['context_window'] ?? row['ctx'])
    const maxTokens = readNumber(row['maxTokens'] ?? row['max_tokens'])
    models.push({
      id,
      name,
      ...contextWindow === undefined ? {} : { contextWindow },
      ...maxTokens === undefined ? {} : { maxTokens },
    })
  }
  return { ok: true, value: models }
}

/**
 * 签到（领每日登录积分）。
 *
 * `login-gift` 是**发放**积分，不消耗东西 —— 参考实现最初写「刻意不接，
 * 会消耗真实积分」是误判，后来更正了。
 */
export async function magicrewCheckin(
  credential: MagicrewCredential,
  product: MagicrewProduct = MAGICREW_CN,
  signal?: AbortSignal,
): Promise<{ ok: true; gained?: number; message: string } | { ok: false; error: string }> {
  const answer = await call(product, '/api/v1/login-gift', { method: 'POST', jwt: credential.jwt, body: {}, signal })
  if (!answer.ok) return { ok: false, error: answer.error ?? '签到失败' }
  const body = answer.body
  const data = body !== null && typeof body === 'object'
    ? ((body as Record<string, unknown>)['data'] ?? body)
    : undefined
  const gained = data !== null && typeof data === 'object'
    ? readNumber((data as Record<string, unknown>)['points'] ?? (data as Record<string, unknown>)['amount'])
    : undefined
  const already = data !== null && typeof data === 'object'
    ? (data as Record<string, unknown>)['alreadyCheckedIn'] === true
      || (data as Record<string, unknown>)['already'] === true
    : false
  if (already) return { ok: true, message: '今天已领过' }
  return {
    ok: true,
    ...gained === undefined ? {} : { gained },
    message: gained === undefined ? '签到成功' : `签到成功 +${String(gained)}`,
  }
}

/**
 * 续模型网关的 key。
 *
 * `mgw_` key 只有 2 小时，用 `refresh_token` 换一把新的。
 * 参考实现记的路径是 `PUT /api/v1/model-gateway/tokens`。
 */
export async function magicrewRefreshKey(
  credential: MagicrewCredential,
  product: MagicrewProduct = MAGICREW_CN,
  signal?: AbortSignal,
): Promise<{ ok: true; credential: MagicrewCredential } | { ok: false; error: string }> {
  if (credential.refreshToken === undefined) {
    return { ok: false, error: '这份凭据没有 refresh_token，请重新登录' }
  }
  const body: Record<string, unknown> = { refresh_token: credential.refreshToken }
  if (credential.organizationCode !== undefined) body['organizationCode'] = credential.organizationCode
  const answer = await call(product, '/api/v1/model-gateway/tokens', {
    method: 'PUT',
    jwt: credential.jwt,
    body,
    signal,
  })
  if (!answer.ok) return { ok: false, error: answer.error ?? '续期失败' }
  const parsed = parseMagicrewCredential(
    answer.body !== null && typeof answer.body === 'object'
      ? ((answer.body as Record<string, unknown>)['data'] ?? answer.body)
      : answer.body,
    credential.site,
  )
  if (parsed === undefined) return { ok: false, error: '续期返回里没有可用的 key' }
  return {
    ok: true,
    credential: {
      ...credential,
      ...parsed,
      /* 续期不换 JWT，保留原来的 */
      jwt: credential.jwt,
      ...credential.refreshToken === undefined ? {} : { refreshToken: credential.refreshToken },
      ...credential.nickname === undefined ? {} : { nickname: credential.nickname },
      ...credential.phone === undefined ? {} : { phone: credential.phone },
    },
  }
}

/**
 * 凭据里的 JWT 还能用多久（epoch ms）。
 *
 * 拿不到就返回 undefined —— 卡片如实显示「未知」，不写 0 假装知道。
 */
export function magicrewJwtExpiry(credential: MagicrewCredential): number | undefined {
  const exp = magicrewJwtClaims(credential.jwt).exp
  return exp === undefined ? undefined : exp * 1000
}

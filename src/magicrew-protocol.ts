/**
 * Magicrew（超级麦吉）的协议常量与凭据解析。
 *
 * ## 来源
 *
 * 端点和约束来自 `iJetLi/dsh-providers-hub` 的 `src/magicrew-product.ts` 与
 * `docs/agent-notes/providers-magicrew.md`，那份文档里的协议表是**本机实发实测**的
 * 结果，不是照抄文档写的。这里只取我们需要的部分。
 *
 * ## 两站
 *
 * 国内站与国际站是**独立账号体系**（不互通），所以是两个 provider id，
 * 和 autoclaw / monkeycode 的两站处理方式一致。
 *
 * ## 登录方式：只走浏览器登录态
 *
 * 上游能登的路径有三条，我们只用一条：
 *
 * | 方式 | 为什么不用 |
 * |---|---|
 * | 手机号 + 密码 | 参考实现里那个 `login()` **零调用者**，是未被采用的探索代码 |
 * | 短信验证码 | 要先解「旋转验证码」，需要识图模型 |
 * | **网页登录** | ✅ 用这条：插件开一个浏览器窗口，用户登完，我们从 cookie / 回调拿凭据 |
 *
 * ## 两条实测出来的硬约束（都不在厂商文档里）
 *
 * 1. **api_key 与 organizationCode 必须配对**。用错配的 key 会得到
 *    `HTTP 200 + {"code":403,"message":"token无效"}` —— 错误藏在 body 里，
 *    只判 `res.ok` 会误判成功。
 * 2. **`expires_at` 无时区**（形如 `2026-11-27 13:47:42`）⇒ 按 **UTC+8** 解释。
 *
 * @module dsh-xdpool/magicrew-protocol
 */

/** 一站的全部固定信息。 */
export interface MagicrewProduct {
  /** provider id，全小写无连字符（与参考实现一致，便于将来对齐凭据）。 */
  readonly id: 'magicrew' | 'magicrewintl'
  readonly site: 'cn' | 'intl'
  readonly displayName: string
  /** 业务 API 与模型网关共用这个 host。 */
  readonly host: string
  /** 网页 origin —— `Origin` 头必带，缺了偶发 403。 */
  readonly webOrigin: string
  /**
   * 这一站是否强制要求 `organization-code`。
   *
   * 国内站不强制（缺了仍 200）；国际站缺了会被上游拒：
   * 业务 API 答 `{"code":2182,"message":"用户所在组织不存在"}`。
   */
  readonly needsOrg: boolean
  /** 凭据文件的默认名字。 */
  readonly defaultRef: string
}

export const MAGICREW_CN: MagicrewProduct = Object.freeze({
  id: 'magicrew',
  site: 'cn',
  displayName: '超级麦吉',
  /*
    真实业务 API 是 i-magic-service.letsmagic.cn。
    ⚠️ `api.magicrew.ai` 不是这套 API —— 它是 teamshare 网关，
    对 /api/v1/* 一律回 "not match rule path"（参考项目实测）。
  */
  host: 'https://i-magic-service.letsmagic.cn',
  webOrigin: 'https://www.letsmagic.cn',
  needsOrg: false,
  defaultRef: 'magicrew',
})

export const MAGICREW_INTL: MagicrewProduct = Object.freeze({
  id: 'magicrewintl',
  site: 'intl',
  displayName: 'MagiCrew 国际',
  host: 'https://magic-service.magicrew.ai',
  webOrigin: 'https://www.magicrew.ai',
  needsOrg: true,
  defaultRef: 'magicrewintl',
})

export const MAGICREW_PRODUCTS: readonly MagicrewProduct[] = Object.freeze([
  MAGICREW_CN,
  MAGICREW_INTL,
])

export function magicrewProductOf(site: string): MagicrewProduct | undefined {
  return MAGICREW_PRODUCTS.find(product => product.site === site)
}

/**
 * 一个账号存下来的凭据。
 *
 * 字段都是可选的，因为来源有两条腿（浏览器 callback / 读本机登录态），
 * 两条腿能拿到的字段不一样。
 */
export interface MagicrewCredential {
  readonly site: 'cn' | 'intl'
  /** 业务 API 的 JWT（30 天）。 */
  readonly jwt: string
  /** 刷新 JWT 用的 token。 */
  readonly refreshToken?: string
  /**
   * 模型网关的 `mgw_` key（只有 2 小时，会自动续期）。
   *
   * 与 `jwt` 是两把不同的钥匙：`jwt` 走 `/api/v1/*`，`mgw_` 走 `/v1/chat/completions`。
   */
  readonly apiKey?: string
  /** `apiKey` 的到期时刻，epoch ms。 */
  readonly apiKeyExpiresAt?: number
  /** 组织码 —— 国际站必需，且**必须与 apiKey 配对**。 */
  readonly organizationCode?: string
  /** 账号昵称，上游给的。 */
  readonly nickname?: string
  /** 手机号，上游给的（打码前）。 */
  readonly phone?: string
  /** 登录时的账号 id，用来区分同名账号。 */
  readonly accountId?: string
}

/**
 * 从任意形状的对象里读出一条可用凭据。
 *
 * 宽容是必要的：浏览器回调、本机登录态、用户手工粘贴，三种来源的字段名不完全一致
 * （`access_token` / `jwt` / `token`）。读不出来就返回 undefined，让调用方报
 * 「这份凭据不完整」而不是存进去一个半残的账号。
 */
export function parseMagicrewCredential(
  raw: unknown,
  site: 'cn' | 'intl',
): MagicrewCredential | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const record = raw as Record<string, unknown>
  const text = (keys: readonly string[]): string | undefined => {
    for (const key of keys) {
      const value = record[key]
      if (typeof value === 'string' && value !== '') return value
    }
    return undefined
  }
  const jwt = text(['jwt', 'access_token', 'accessToken', 'token'])
  if (jwt === undefined) return undefined
  const apiKey = text(['apiKey', 'api_key'])
  const apiKeyExpiresAt = readEpochMs(record['apiKeyExpiresAt'] ?? record['api_key_expires_at'])
  return {
    site,
    jwt,
    ...(text(['refreshToken', 'refresh_token']) === undefined
      ? {}
      : { refreshToken: text(['refreshToken', 'refresh_token']) as string }),
    ...(apiKey === undefined ? {} : { apiKey }),
    ...(apiKeyExpiresAt === undefined ? {} : { apiKeyExpiresAt }),
    ...(text(['organizationCode', 'organization_code']) === undefined
      ? {}
      : { organizationCode: text(['organizationCode', 'organization_code']) as string }),
    ...(text(['nickname', 'nick_name', 'name']) === undefined
      ? {}
      : { nickname: text(['nickname', 'nick_name', 'name']) as string }),
    ...(text(['phone', 'mobile']) === undefined
      ? {}
      : { phone: text(['phone', 'mobile']) as string }),
    ...(text(['accountId', 'account_id', 'userId', 'user_id', 'uid']) === undefined
      ? {}
      : { accountId: text(['accountId', 'account_id', 'userId', 'user_id', 'uid']) as string }),
  }
}

/**
 * 把上游的到期时间读成 epoch ms。
 *
 * 认三种形状：
 * - 数字（已经是 ms 或秒，按量级判断）
 * - 形如 `2026-11-27 13:47:42` 的裸时间串 —— **没有时区**，按 UTC+8 解释
 * - ISO 串（带 Z 或偏移量，`Date.parse` 能直接认）
 */
function readEpochMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    /* 秒级时间戳（1e12 以下是秒）换成毫秒，否则「2026 年」会被算成 1970 年 */
    return value < 1e12 ? Math.round(value * 1000) : Math.round(value)
  }
  if (typeof value !== 'string' || value.trim() === '') return undefined
  const text = value.trim()
  const bare = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/u.exec(text)
  if (bare !== null) {
    /* 无时区串按 UTC+8 解释 —— 上游就是这么发的 */
    const ms = Date.UTC(
      Number(bare[1]), Number(bare[2]) - 1, Number(bare[3]),
      Number(bare[4]), Number(bare[5]), Number(bare[6]),
    ) - 8 * 3600_000
    return Number.isFinite(ms) ? ms : undefined
  }
  const parsed = Date.parse(text)
  return Number.isFinite(parsed) ? parsed : undefined
}

/**
 * 解 JWT 的 payload（不验签 —— 我们只读自己刚拿到的 token 里的字段）。
 *
 * 拿 `exp` 和昵称：前者决定「有效期」那一格，后者决定账号卡上的名字。
 */
export function magicrewJwtClaims(jwt: string): {
  exp?: number
  nickname?: string
  phone?: string
  subject?: string
} {
  const parts = jwt.split('.')
  if (parts.length < 2) return {}
  try {
    const payload = JSON.parse(Buffer.from(parts[1] as string, 'base64url').toString('utf8')) as
      Record<string, unknown>
    const pick = (keys: readonly string[]): string | undefined => {
      for (const key of keys) {
        const value = payload[key]
        if (typeof value === 'string' && value !== '') return value
      }
      return undefined
    }
    const exp = payload['exp']
    const nickname = pick(['nickname', 'preferred_username', 'name', 'nick_name'])
    const phone = pick(['phone', 'mobile', 'phone_number'])
    const subject = pick(['sub', 'user_id', 'userId', 'uid'])
    return {
      ...typeof exp === 'number' && Number.isFinite(exp) ? { exp } : {},
      ...nickname === undefined ? {} : { nickname },
      ...phone === undefined ? {} : { phone },
      ...subject === undefined ? {} : { subject },
    }
  } catch {
    return {}
  }
}

/**
 * 账号卡上该显示什么名字。
 *
 * 顺序：上游给的真昵称 → 打码手机号 → JWT 里的昵称 → 产品名。
 *
 * **不返回账号 id**：`magicrew-3f7d7baf` 这种名字对读者没有意义，
 * 参考实现在这里也是回落到产品名，而不是 id。
 */
export function magicrewDisplayNickname(
  credential: MagicrewCredential,
  product: MagicrewProduct = MAGICREW_CN,
): string {
  const nickname = credential.nickname
  if (nickname !== undefined && nickname.trim() !== '') return nickname.trim()
  const phone = credential.phone
  if (phone !== undefined && /^\d{11}$/u.test(phone)) {
    return `${phone.slice(0, 3)}****${phone.slice(7)}`
  }
  const fromJwt = magicrewJwtClaims(credential.jwt).nickname
  if (fromJwt !== undefined) return fromJwt
  return product.displayName
}

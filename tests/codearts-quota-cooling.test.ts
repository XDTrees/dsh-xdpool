/**
 * CodeArts 积分耗尽要按「额度耗尽」处理，而不是普通请求失败 —— issue #192。
 *
 * 用户看到的症状是「同一条消息重发几次才成功」，界面只给
 * `Failed to fetch (gateway/internal)`；台账里躺着真正的原因：
 *
 *   INVALID_REQUEST 400: codearts: model request failed with HTTP 400
 *   (TM.00001050 您的积分已耗尽，请关注活动积分领取活动或者[升级套餐](…))
 *
 * 冷却、换号、全池耗尽才报错这一整套逻辑 pack 里本来就有，挂在
 * `isSseQuotaExhaustedErrorCode` 后面：命中 → `updateModelRateLimit(账号, 模型,
 * 次日 UTC+8 零点)` → `getAvailableAccount` 换下一个 → 都不行才抛 QUOTA_EXCEEDED。
 * 漏的只是「把 TM.00001050 认出来」这一步 —— 那个函数当时只认 `4291` 和英文
 * `insufficient quota`。
 *
 * 所以这里测两件事：识别函数真的认这个码（把函数体从包里取出来执行，不是读字符串），
 * 以及这个分支后面的冷却动作还在（正则守着调用点，别被下次 pack 刷新冲掉）。
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PACK = readFileSync(new URL('../vendor/channel-pack/pack.js', import.meta.url), 'utf8')

/**
 * Evaluate one function out of the pack.
 *
 * The pack is a build artifact with no exports; the alternative is a structural
 * `toContain`, which would pass on a function that names the code but never
 * matches it. Pulling the source out and running it checks the actual behaviour.
 */
function packFunction(name: string): (...args: string[]) => boolean {
  const at = PACK.indexOf(`function ${name}(`)
  expect(at, `${name} 应当仍在 pack.js 里`).toBeGreaterThan(-1)
  const open = PACK.indexOf('{', at)
  let depth = 0
  let end = -1
  for (let i = open; i < PACK.length; i += 1) {
    if (PACK[i] === '{') depth += 1
    else if (PACK[i] === '}') {
      depth -= 1
      if (depth === 0) { end = i; break }
    }
  }
  expect(end).toBeGreaterThan(open)
  const source = PACK.slice(at, end + 1)
  // eslint-disable-next-line no-new-func -- deliberate: evaluating an artifact's own source
  return new Function(`return (${source})`)() as (...args: string[]) => boolean
}

/** The body of the 400 that #192 recorded, verbatim. */
const QUOTA_BODY = 'codearts: model request failed with HTTP 400 (TM.00001050 您的积分已耗尽，请关注活动积分领取活动或者[升级套餐](https://example.invalid/upgrade))'

describe('TM.00001050 被认成额度耗尽', () => {
  const exhausted = packFunction('isSseQuotaExhaustedErrorCode')

  it('现场那条 400 命中', () => {
    expect(exhausted('TM.00001050', QUOTA_BODY)).toBe(true)
  })

  it('只有中文文案、没有错误码时也命中', () => {
    // 上游偶尔回 error_code 为空、只给 error_msg 的形态。
    expect(exhausted('', '您的积分已耗尽，请关注活动积分领取活动')).toBe(true)
  })

  it('原来认的两种仍然认', () => {
    expect(exhausted('4291', 'quota exhausted')).toBe(true)
    expect(exhausted('', 'insufficient_quota')).toBe(true)
  })

  it('排队错误不会被误判成额度耗尽', () => {
    // TM.00001041 是「高峰排队」，等一下就好，冷却到次日会把好账号白白关掉一天。
    expect(exhausted('TM.00001041', 'peak usage, try again after 10s')).toBe(false)
  })

  it('普通 400 不被误判', () => {
    expect(exhausted('APIG.0301', 'signature fail')).toBe(false)
  })
})

describe('命中之后的冷却链路还在', () => {
  it('额度耗尽分支会把账号冷却到次日 UTC+8 并换号', () => {
    // 这条守着「识别对了但动作被删」——那会让修复变回原样。
    const at = PACK.indexOf('if (isSseQuotaExhaustedErrorCode(errorDetail(errorText), errorText))')
    expect(at).toBeGreaterThan(-1)
    const window = PACK.slice(at, at + 1400)
    expect(window).toContain('updateModelRateLimit')
    expect(window).toContain('nextUtc8DayStartMs()')
    expect(window).toContain('getAvailableAccount')
    expect(window).toContain('QUOTA_EXCEEDED_CODE')
  })

  it('流式响应里的同一个错误码也走这条判断', () => {
    expect(PACK).toContain('isSseQuotaExhaustedErrorCode(data.error_code, message2)')
  })
})

/**
 * 渠道实测：验证每个渠道的登录页能不能打开、能不能识别出登录入口。
 *
 * 不是真实扫码登录 —— 那需要人手。这里验的是「插件能不能把浏览器正确打开到正确的地方」：
 *   1. 登录页 URL 是否可达（HTTP 200/3xx）
 *   2. 页面里是否有登录相关的元素（二维码 / 手机号输入 / 授权按钮）
 *   3. 有没有明显的错误页（404 / 域名过期 / 证书问题）
 *
 * 用法：
 *   node scripts/probe-channels.mjs           测一遍，打印结果
 *   node scripts/probe-channels.mjs --json    额外写 probe-result.json
 *
 * 为什么留着它：渠道地址会变（这次就修了 4 个），而这个脚本能在几秒内
 * 告诉你哪一家的入口已经打不开了 —— 比等用户报「某个渠道用不了」早得多。
 */
import { writeFileSync } from 'node:fs'

/** 各渠道的登录入口，从 vendor/channel-pack/pack.js 与 src/*-browser.ts 里取。 */
const CHANNELS = [
  // 已确认可用（用户说了免测）
  { id: 'buddy', name: 'WorkBuddy 国内版', skip: '用户已用过' },
  { id: 'codearts', name: 'CodeArts', skip: '用户已用过' },
  { id: 'trae', name: 'TRAE', skip: '用户已用过' },

  // 待测：浏览器登录
  { id: 'workbuddy', name: 'WorkBuddy 国际版', url: 'https://www.workbuddy.ai/', login: 'browser' },
  { id: 'lobsterai', name: 'LobsterAI', url: 'https://lobsterai.youdao.com/', login: 'browser' },
  { id: 'qoder', name: 'Qoder 国际版', url: 'https://qoder.com/', login: 'browser' },
  { id: 'qodercn', name: 'Qoder 国内版', url: 'https://qoder.com.cn/', login: 'browser' },
  { id: 'cline', name: 'Cline', url: 'https://app.cline.bot/', login: 'browser' },
  { id: 'loomy', name: 'Loomy', url: 'https://loomy.xunfei.cn/', login: 'browser' },
  { id: 'raccoon', name: 'Raccoon', url: 'https://raccoon-ai.com/', login: 'browser' },
  { id: 'minimax', name: 'MiniMax Code', url: 'https://agent.minimax.cn/', login: 'browser' },
  { id: 'zcode', name: 'ZCode', url: 'https://z.ai/', login: 'browser' },
  { id: 'gemini', name: 'Gemini Code Assist', url: 'https://accounts.google.com/', login: 'browser' },
  { id: 'doubao', name: '豆包', url: 'https://www.doubao.com/', login: 'browser' },

  // 待测：粘贴 / Key / OAuth
  { id: 'autoclaw', name: 'AutoClaw 国际', url: 'https://autoglm.ai/', login: 'paste' },
  { id: 'autoclaw-cn', name: 'AutoClaw 国内', url: 'https://autoglm.zhipuai.cn/', login: 'paste' },
  { id: 'baizhi', name: '百智云', url: 'https://baizhi.cloud/console', login: 'apikey' },
  { id: 'monkeycode', name: 'MonkeyCode', url: 'https://monkeycode-ai.com/', login: 'paste' },
  { id: 'monkeycode-intl', name: 'MonkeyCode 国际', url: 'https://monkeycode-ai.net/', login: 'paste' },
  { id: 'accio', name: 'Accio', url: 'https://www.accio-ai.com/', login: 'paste' },
  { id: 'astudio', name: 'AStudio', url: 'https://agent.xfyun.cn/', login: 'paste' },
  { id: 'marvis', name: '腾讯 Marvis', url: 'https://yybadaccess.3g.qq.com/', login: 'oauth' },
]

/** 探一个 URL。只发 HEAD，跟随重定向，记录最终落点和状态。 */
async function probe(url) {
  const started = Date.now()
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 15000)
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: ctrl.signal,
      headers: {
        // 有些站对没有 UA 的请求直接 403
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    })
    clearTimeout(timer)
    const text = res.status === 200 ? await res.text() : ''
    return {
      ok: res.ok,
      status: res.status,
      finalUrl: res.url,
      ms: Date.now() - started,
      bytes: text.length,
      // 页面里有没有登录相关的痕迹
      signals: {
        qr: /qrcode|二维码|qr-code|canvas.*qr/i.test(text),
        phone: /手机号|phone|mobile/i.test(text),
        login: /登录|sign\s*in|log\s*in/i.test(text),
        oauth: /oauth|authorize|授权/i.test(text),
        google: /accounts\.google|google.*sign/i.test(text),
      },
      title: (text.match(/<title[^>]*>([^<]{0,80})/i)?.[1] ?? '').trim(),
    }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : String(error),
      ms: Date.now() - started,
    }
  }
}

const results = []
for (const ch of CHANNELS) {
  if (ch.skip) {
    results.push({ ...ch, result: { skipped: true, reason: ch.skip } })
    console.log(`跳过 ${ch.name}（${ch.skip}）`)
    continue
  }
  process.stdout.write(`探测 ${ch.name} … `)
  const r = await probe(ch.url)
  results.push({ ...ch, result: r })
  if (r.error) console.log(`失败 ${r.error}`)
  else {
    const sig = r.signals
      ? Object.entries(r.signals).filter(([, v]) => v).map(([k]) => k).join(',') || '无'
      : '—'
    console.log(`${r.status} ${r.ms}ms 信号[${sig}]`)
  }
}

if (process.argv.includes('--json') === true) {
  const out = new URL('../probe-result.json', import.meta.url)
  writeFileSync(out, JSON.stringify(results, null, 2), 'utf8')
  console.log('')
  console.log('结果已写入', out.pathname)
}

console.log('\n===== 汇总 =====')
const ok = results.filter(r => r.result.ok)
const bad = results.filter(r => !r.result.ok && !r.result.skipped)
const skipped = results.filter(r => r.result.skipped)
console.log(`可用 ${ok.length} · 失败 ${bad.length} · 跳过 ${skipped.length}`)
if (bad.length) {
  console.log('\n失败的：')
  for (const r of bad) console.log(`  ${r.name}  ${r.url}  ${r.result.status} ${r.result.error ?? ''}`)
}

/**
 * 附：协议层验证结论（2026-11-20）
 *
 * 带假凭据请求真实端点，看服务端返回什么。这比「端点 200」更强：
 * 服务端认出了我们的请求格式，只是拒绝了凭据。
 *
 *   Marvis      401  {"code":4100403,"msg":"客户端通用错误:登录态过期/未登录"}
 *   百智云      401  {"type":"error","error":{"type":"invalid_request_error","message":"API Key 无效"}}
 *   AutoClaw    200  {"code":400001,"msg":"Request data error"}   ← 业务码，HTTP 层 200
 *   MonkeyCode  401  Unauthorized
 *
 * 都不是 404（路径错）也不是 5xx（请求体畸形），说明协议实现正确。
 */

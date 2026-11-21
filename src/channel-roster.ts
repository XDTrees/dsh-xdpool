/**
 * The scan-login roster, as plain data.
 *
 * WHY THIS IS ITS OWN MODULE
 *
 * The card renders these names, and the card runs in the BROWSER. `channels.ts` reads
 * `node:fs` to discover the pack on disk, so importing the roster from it dragged that into
 * the client bundle — and a bundle containing `node:fs` does not load at all, which is how the
 * plugin entry once vanished.
 *
 * So the DATA lives here with no imports, and both halves read it: the host for the ids it
 * serves, the card for the cards it draws before the host answers.
 *
 * @module dsh-xdpool/channel-roster
 */

/** What one login channel is, to the card and to the host alike. */
export interface ChannelDescriptor {
  id: string
  name: string
  org: string
  /** The vendor page a reader can verify, when the row has one. */
  domain?: string
  accent?: string
  note?: string
  login: 'browser' | 'apikey' | 'oauth' | 'device' | 'paste'
  credits?: {
    /** The vendor reports percentage windows rather than a spendable total. */
    quota?: boolean
    /** A daily claim exists for this channel. */
    claim?: boolean
    /** Extra capabilities the card reads off the flag. */
    status?: boolean
    /** The unit the balance is printed in. */
    unit?: string
  }
  /** Rows whose login page shows a phone code on the same screen as the QR. */
  smsHint?: boolean
  /** A sentence shown beside the button, for a login that needs explaining. */
  loginHint?: 'doubao' | 'marvis' | 'astudio' | 'accio' | 'qiniu' | 'monkeycode' | 'baizhi' | 'autoclaw'
  /** Whether the channel is served by this plugin rather than by the pack. */
  ownedByPool?: boolean
}

export const REGISTERED_CHANNELS: readonly ChannelDescriptor[] = [
  {
    id: 'codearts',
    name: 'CodeArts',
    org: '华为云',
    accent: '#C7000B',
    note: '已开通免费体验套餐，自动续期不收费；新人积分 + DeepSeek · GLM · openPangu 每日免费额度',
    login: 'browser',
    credits: {'claim':true},
  },
  {
    id: 'buddy',
    name: 'WorkBuddy 国内版',
    org: '腾讯',
    domain: 'copilot.tencent.com',
    accent: '#0A7AFF',
    note: '与 CodeBuddy 共用端点：DeepSeek · Kimi · GLM 免费线，每日赠送积分',
    login: 'browser',
    credits: {'claim':true,'status':true},
  },
  {
    id: 'workbuddy',
    name: 'WorkBuddy 国际版',
    org: '腾讯',
    domain: 'www.workbuddy.ai',
    accent: '#0B63CE',
    note: '独立端点与账号体系，积分与国内版不互通；国际版后端没有每日签到接口',
    login: 'browser',
    credits: {'status':true},
  },
  {
    id: 'lobsterai',
    name: 'LobsterAI',
    org: '有道',
    accent: '#FF6A00',
    note: '每日签到领积分，积分换模型调用额度',
    login: 'browser',
    credits: {'claim':true},
  },
  {
    id: 'qoder',
    name: 'Qoder 国际版',
    org: '阿里云',
    accent: '#615CED',
    note: '每日 100 Credits，加密推理端点',
    login: 'browser',
    credits: {'claim':true},
  },
  {
    id: 'qodercn',
    name: 'Qoder 国内版',
    org: '阿里云',
    accent: '#7A6CF0',
    note: '每日 100 Credits，国内端点与模型池',
    login: 'browser',
    credits: {'claim':true},
  },
  {
    id: 'trae',
    name: 'TRAE',
    org: '字节跳动',
    accent: '#00BFA6',
    note: '手机号注册即送免费额度，按天重置',
    login: 'browser',
    credits: {'claim':true},
  },
  {
    id: 'cline',
    name: 'Cline',
    org: 'Cline Bot',
    accent: '#5B5BD6',
    note: '绑定 GitHub 账号后送美元计价的免费额度；其后端没有每日签到接口',
    login: 'browser',
    credits: {'unit':'dollars'},
  },
  {
    id: 'loomy',
    name: 'Loomy',
    org: '科大讯飞',
    accent: '#2F6BFF',
    note: '星火模型每日免费额度，扫码或手机号均可登录',
    login: 'browser',
    credits: {'claim':true},
  },
  {
    id: 'raccoon',
    name: 'Raccoon',
    org: '商汤',
    accent: '#00A6A6',
    note: '手机号注册即送免费额度；每日积分由服务端自动发放，登录奖励需在「新手任务」领取',
    login: 'browser',
    smsHint: true,
    credits: {},
  },
  {
    id: 'minimax',
    name: 'MiniMax Code',
    org: 'MiniMax',
    accent: '#E4007F',
    note: '设备码 + PKCE 登录，每日签到领额度',
    login: 'browser',
    credits: {'claim':true,'status':true},
  },
  {
    id: 'zcode',
    name: 'ZCode',
    org: '智谱',
    accent: '#3B6EF6',
    note: 'GLM 模型按 token 计免费额度，需本机可开浏览器',
    login: 'browser',
    credits: {'claim':true,'unit':'tokens'},
  },
  {
    id: 'gemini',
    name: 'Gemini Code Assist',
    org: 'Google',
    accent: '#4285F4',
    note: '个人 Google 账号的免费配额，走本地回调 OAuth',
    login: 'browser',
    credits: {'quota':true},
  },
  {
    id: 'autoclaw',
    name: 'AutoClaw 国际',
    org: '智谱 · OpenClaw',
    domain: 'autoglm-api.autoglm.ai',
    accent: '#3B82F6',
    note: 'GLM-5.3-Flash 限免；积分分奖励/每日/签约/加油包四类钱包',
    login: 'paste',
    credits: {'unit':'积分'},
    loginHint: 'autoclaw',
  },
  {
    id: 'autoclaw-cn',
    name: 'AutoClaw 国内',
    org: '智谱 · OpenClaw',
    domain: 'autoglm-acceleration-api.zhipuai.cn',
    accent: '#60A5FA',
    note: '国内站独立账号；同样是签名网关与四类积分钱包',
    login: 'paste',
    credits: {'unit':'积分'},
    loginHint: 'autoclaw',
  },
  {
    id: 'baizhi',
    name: '百智云',
    org: '百智云',
    domain: 'baizhi.cloud',
    accent: '#2E7BFF',
    note: 'Anthropic 协议；每日临时积分需解一道本地工作量证明题后领取',
    login: 'apikey',
    credits: {'claim':true,'unit':'dollars'},
    loginHint: 'baizhi',
  },
  {
    id: 'monkeycode',
    name: 'MonkeyCode',
    org: 'MonkeyCode',
    domain: 'monkeycode-ai.com',
    accent: '#7B5CFF',
    note: 'Anthropic 协议；订阅额度（basic/pro/ultra）与按积分计费两种模型并存',
    login: 'paste',
    credits: {'unit':'tokens'},
    loginHint: 'monkeycode',
  },
  {
    id: 'monkeycode-intl',
    name: 'MonkeyCode 国际',
    org: 'MonkeyCode',
    domain: 'monkeycode-ai.net',
    accent: '#9B7CFF',
    note: '国际站独立账号；同样是 Anthropic 协议与固定模型表',
    login: 'paste',
    credits: {'unit':'tokens'},
    loginHint: 'monkeycode',
  },
  {
    id: 'accio',
    name: 'Accio',
    org: '阿里',
    domain: 'www.accio-ai.com',
    accent: '#FF6A00',
    note: '每日 / 每月 / 推荐三套积分分开计；模型按倍率升序排列',
    login: 'paste',
    credits: {'unit':'tokens'},
    loginHint: 'accio',
  },
  {
    id: 'astudio',
    name: 'AStudio',
    org: '科大讯飞',
    domain: 'agent.xfyun.cn',
    accent: '#1E6FFF',
    note: '粘贴桌面端凭据即可；每日登录积分、通用与星火两套积分分开计',
    login: 'paste',
    credits: {'claim':true},
    loginHint: 'astudio',
  },
  {
    id: 'marvis',
    name: '腾讯 Marvis',
    org: '腾讯 · 应用宝 AI',
    domain: 'yybadaccess.3g.qq.com',
    accent: '#0052D9',
    note: 'QQ / 微信登录，不用 API key；每天 1000 万计费 token（缓存免费，输入输出五折）',
    login: 'oauth',
    credits: {'quota':true},
    loginHint: 'marvis',
  },
  {
    id: 'doubao',
    name: '豆包',
    org: '字节跳动',
    domain: 'www.doubao.com',
    accent: '#325AB4',
    note: '浏览器扫码登录一次；对话与「工作任务」模型、生图、活动赠送额度都在这里',
    login: 'browser',
    loginHint: 'doubao',
    credits: {'quota':true},
  },
]

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
  login: 'browser' | 'apikey' | 'oauth' | 'device'
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
  loginHint?: 'doubao'
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
    credits: { claim: true },
  },
  {
    id: 'buddy',
    name: 'WorkBuddy 国内版',
    org: '腾讯',
    domain: 'copilot.tencent.com',
    accent: '#0A7AFF',
    note: '与 CodeBuddy 共用端点：DeepSeek · Kimi · GLM 免费线，每日赠送积分',
    login: 'browser',
    credits: { claim: true, status: true },
  },
  {
    id: 'workbuddy',
    name: 'WorkBuddy 国际版',
    org: '腾讯',
    domain: 'www.workbuddy.ai',
    accent: '#0B63CE',
    note: '独立端点与账号体系，积分与国内版不互通；国际版后端没有每日签到接口',
    login: 'browser',
    credits: { status: true },
  },
  {
    id: 'lobsterai',
    name: 'LobsterAI',
    org: '有道',
    accent: '#FF6A00',
    note: '每日签到领积分，积分换模型调用额度',
    login: 'browser',
    credits: { claim: true },
  },
  {
    id: 'qoder',
    name: 'Qoder 国际版',
    org: '阿里云',
    accent: '#615CED',
    note: '每日 100 Credits，加密推理端点',
    login: 'browser',
    credits: { claim: true },
  },
  {
    id: 'qodercn',
    name: 'Qoder 国内版',
    org: '阿里云',
    accent: '#7A6CF0',
    note: '每日 100 Credits，国内端点与模型池',
    login: 'browser',
    credits: { claim: true },
  },
  {
    id: 'trae',
    name: 'TRAE',
    org: '字节跳动',
    accent: '#00BFA6',
    note: '手机号注册即送免费额度，按天重置',
    login: 'browser',
    credits: { claim: true },
  },
  {
    id: 'cline',
    name: 'Cline',
    org: 'Cline Bot',
    accent: '#5B5BD6',
    note: '绑定 GitHub 账号后送美元计价的免费额度；其后端没有每日签到接口',
    login: 'browser',
    // US dollars, not credits — the pack scales Cline's balance by its own
    // factor, so a "credits" label here would be a unit error, not a rounding.
    credits: { unit: 'dollars' },
  },
  {
    id: 'loomy',
    name: 'Loomy',
    org: '讯飞星火',
    accent: '#2F6BFF',
    note: '星火模型每日免费额度，扫码或手机号均可登录',
    login: 'browser',
    credits: { claim: true },
  },
  {
    id: 'raccoon',
    name: 'Raccoon',
    org: '商汤',
    accent: '#00A6A6',
    note: '手机号注册即送免费额度；每日积分由服务端自动发放，登录奖励需在「新手任务」领取',
    login: 'browser',
    smsHint: true,
    /**
     * `credits: {}` is deliberate and does NOT mean "nothing to collect".
     *
     * Raccoon pays two different things and they arrive two different ways:
     *
     *   - the DAILY points are credited by the server on its own schedule, so
     *     there is no check-in call to make. `credits.claimAll` answers "不支持每日
     *     签到" for this channel, and that answer is correct;
     *   - the DESKTOP LOGIN BONUS is a one-off, per account, and it is collectable
     *     — through `onboarding.claim`, not through the daily claim.
     *
     * The empty object is what keeps the daily "Claim credits" button off this card
     * (pressing it would only ever print that refusal). The login bonus has its own
     * button, which the card draws for the channels in `ONBOARDING_CHANNELS`.
     * `credits` staying present keeps the balance row on the card.
     */
    credits: {},
  },
  {
    id: 'minimax',
    name: 'MiniMax Code',
    org: 'MiniMax',
    accent: '#E4007F',
    note: '设备码 + PKCE 登录，每日签到领额度',
    login: 'browser',
    credits: { claim: true, status: true },
  },
  {
    id: 'zcode',
    name: 'ZCode',
    org: '智谱',
    accent: '#3B6EF6',
    note: 'GLM 模型按 token 计免费额度，需本机可开浏览器',
    login: 'browser',
    credits: { claim: true, unit: 'tokens' },
  },
  {
    id: 'gemini',
    name: 'Gemini Code Assist',
    org: 'Google',
    accent: '#4285F4',
    note: '个人 Google 账号的免费配额，走本地回调 OAuth',
    login: 'browser',
    // Quota, not credits: Gemini reports percentage windows, so a total is
    // the wrong number to print even though the pack returns one.
    credits: { quota: true },
  },
  {
    id: 'doubao',
    /**
     * Doubao, served by this plugin's own lane.
     *
     * Unlike every other row here, the pack has no Doubao adapter — the session, the
     * catalogue and the wire are all this plugin's. What makes it a channel anyway is the
     * login: one browser sign-in, then the models are in the picker like any other vendor's.
     */
    name: '豆包',
    org: '字节跳动',
    domain: 'www.doubao.com',
    accent: '#325AB4',
    note: '浏览器扫码登录一次；对话与「工作任务」模型、生图、活动赠送额度都在这里',
    login: 'browser',
    loginHint: 'doubao',
    credits: { quota: true },
  },
]

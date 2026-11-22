/**
 * 亮 / 暗切换。
 *
 * 为什么插件自己带一个开关，而 2.x 的注释里写着「故意不做主题开关」：
 *
 * 那一段的理由是「宿主已经有一个了，插件再放一个就有两处可看，两边一改就打架」。
 * 3.0.0 把设计稿整套接进来之后，这个理由不成立了 —— 插件现在自带一整套暗色
 * 变量（`.app` 上的 --bg / --surface / --text……），根本不问宿主要颜色，
 * 宿主切成亮色插件也还是暗的。一个自己决定颜色的界面，就必须自己给出切换，
 * 否则「只有暗色」不是取舍，是缺陷。
 *
 * 两条边界：
 *
 * 1. **状态挂在 .app 上，不挂 documentElement。** 插件跑在宿主的设置对话框里，
 *    往 <html> 上写 data-theme 会和宿主自己的主题标记抢同一个位置。
 * 2. **默认跟随系统，选中之后跟随选择。** 没存过值时读
 *    `prefers-color-scheme`（暗色系统给人暗色，亮色系统给人亮色）；一旦用户
 *    按过按钮，那个选择优先，并且系统再变也不动它 —— 用户按过的东西不该
 *    被系统设置悄悄改回去。
 *
 * 存储失败（无痕窗口、storage 被禁）时退回「跟随系统」并且不抛：切换按钮
 * 在当次会话里照常工作，只是记不住。
 *
 * @module dsh-xdpool/client/theme
 */

/** 两种主题。`'light'` 对应 `.app[data-theme="light"]` 那一段变量。 */
export type PoolTheme = 'light' | 'dark'

/** localStorage 键。带插件前缀，避免和宿主或别的插件撞。 */
const THEME_KEY = 'xdpool.theme'

/** 系统的偏好，读不到（SSR、老浏览器）时按暗色算 —— 这是 3.0.0 的样子。 */
export function systemTheme(): PoolTheme {
  try {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
    }
  } catch {
    // matchMedia 在受限的 iframe 里会抛；跟随系统不成，就按暗色。
  }
  return 'dark'
}

/** 用户存下来的主题，没有或不可读时返回 undefined（= 还没选过）。 */
export function storedTheme(): PoolTheme | undefined {
  try {
    const raw = window.localStorage.getItem(THEME_KEY)
    return raw === 'light' || raw === 'dark' ? raw : undefined
  } catch {
    return undefined
  }
}

/**
 * 宿主现在是亮的还是暗的，读不出来时返回 undefined。
 *
 * 为什么先问宿主、再问系统：插件是嵌在 DSH 对话框里的一块界面，用户看到的是
 * 宿主 + 插件叠在一起。系统是亮色而宿主被设成暗色时，按系统走会让插件突兀地
 * 白一块。宿主自己的层底色（`--dsw-alias-bg-layer-0`，credit-dot 用的也是这
 * 一族变量）就是它此刻的答案，量一下亮度即可，不必去猜宿主的主题键叫什么。
 *
 * 探测用一个临时元素：`var()` 只在有元素承接时才解析出颜色，直接读
 * document.documentElement 拿不到这层的最终值。
 */
export function hostTheme(): PoolTheme | undefined {
  try {
    if (typeof document === 'undefined' || document.body === null) return undefined
    const probe = document.createElement('div')
    probe.style.cssText = 'position:absolute;left:-9999px;top:0;width:0;height:0;'
      + 'background:var(--dsw-alias-bg-layer-0, transparent)'
    document.body.appendChild(probe)
    const color = window.getComputedStyle(probe).backgroundColor
    probe.remove()
    const rgb = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/u.exec(color)
    if (rgb === null) return undefined
    // 没有宿主变量的宿主体上会是 transparent，正则匹配不到 → undefined → 落到系统。
    const [r, g, b] = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
    return luminance > 140 ? 'light' : 'dark'
  } catch {
    return undefined
  }
}

/** 首屏要用的主题：存过就用存的，否则跟宿主，再否则跟系统。同步求值，避免首帧闪一下。 */
export function initialTheme(): PoolTheme {
  return storedTheme() ?? hostTheme() ?? systemTheme()
}

/** 记下用户的选择。写不进去不算失败。 */
export function rememberTheme(theme: PoolTheme): void {
  try {
    window.localStorage.setItem(THEME_KEY, theme)
  } catch {
    // 记不住就记不住：本次会话照样生效。
  }
}

/** 另一个方向。 */
export function otherTheme(theme: PoolTheme): PoolTheme {
  return theme === 'light' ? 'dark' : 'light'
}

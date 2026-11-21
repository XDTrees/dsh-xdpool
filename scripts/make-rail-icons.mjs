/**
 * 设计稿的 rail 图标（SVG 线性、24 网格、stroke-width 1.8）。
 *
 * 插件原来用汉字「池登聚量路关备」当图标 —— 那是 Cette 早期没有图标资源时的
 * 占位。设计稿每一行都是一个描边图标，和 DSH 自己的侧栏风格一致。
 */
import { writeFileSync } from 'node:fs'

const PATHS = {
  pool: 'M3 7h18M3 12h18M3 17h12',
  login: 'M4 8V5a1 1 0 011-1h14a1 1 0 011 1v3M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3M8 12h8',
  aggregate: 'M12 3l8 4.5v9L12 21l-8-4.5v-9z M12 12l8-4.5M12 12v9M12 12L4 7.5',
  ledger: 'M4 19V9M10 19V5M16 19v-7M22 19H2',
  routing: 'M6 3v18M18 3v18M6 8h12M6 16h12',
  gateway: 'M3 5h18v14H3z M3 10h18',
  backup: 'M12 3v12M8 11l4 4 4-4 M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2',
  star: 'M12 3l2.6 5.6 6.4.8-4.7 4.4 1.2 6.2L12 17l-5.5 3 1.2-6.2L3 9.4l6.4-.8z',
  group: 'M21 12a9 9 0 11-4.5-7.8L21 3l-1 4.5',
  dock: 'M4 6h16M4 12h16M4 18h16',
}

const lines = Object.entries(PATHS).map(([id, d]) => {
  // 一条 path 里可能有多个子路径（空格分隔的 M）
  const parts = d.split(/\s+(?=M)/u)
  const inner = parts.map(sub => `<path d="${sub.trim()}"/>`).join('')
  return `  ${id}: '${inner}',`
})

const out = `/**
 * 设计稿的功能页图标。
 *
 * 全部是 24 网格、stroke-width 1.8、圆头描边 —— 和设计稿的 rail-item 一致。
 * 用法：<RailIcon name="pool" />
 *
 * 之前这些位置是汉字（池 / 登 / 聚 / 量 / 路 / 关 / 备）。那是占位，
 * 一屏七个汉字看着像标签而不像导航。
 */
export const RAIL_ICONS = {
${lines.join('\n')}
} as const

export type RailIconName = keyof typeof RAIL_ICONS
`

writeFileSync('D:/dsh-home/_xdpool-src/src/client/rail-icons.ts', out, 'utf8')
console.log('生成 rail-icons.ts，', Object.keys(PATHS).length, '个图标')

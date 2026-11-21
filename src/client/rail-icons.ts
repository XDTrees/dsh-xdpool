/**
 * 设计稿的功能页图标。
 *
 * 全部是 24 网格、stroke-width 1.8、圆头描边 —— 和设计稿的 rail-item 一致。
 * 用法：<RailIcon name="pool" />
 *
 * 之前这些位置是汉字（池 / 登 / 聚 / 量 / 路 / 关 / 备）。那是占位，
 * 一屏七个汉字看着像标签而不像导航。
 */
export const RAIL_ICONS = {
  pool: '<path d="M3 7h18M3 12h18M3 17h12"/>',
  login: '<path d="M4 8V5a1 1 0 011-1h14a1 1 0 011 1v3M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3M8 12h8"/>',
  aggregate: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>',
  ledger: '<path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/>',
  routing: '<path d="M6 3v18M18 3v18M6 8h12M6 16h12"/>',
  gateway: '<path d="M3 5h18v14H3z"/><path d="M3 10h18"/>',
  backup: '<path d="M12 3v12M8 11l4 4 4-4"/><path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2"/>',
  star: '<path d="M12 3l2.6 5.6 6.4.8-4.7 4.4 1.2 6.2L12 17l-5.5 3 1.2-6.2L3 9.4l6.4-.8z"/>',
  group: '<path d="M21 12a9 9 0 11-4.5-7.8L21 3l-1 4.5"/>',
  dock: '<path d="M4 6h16M4 12h16M4 18h16"/>',
} as const

export type RailIconName = keyof typeof RAIL_ICONS

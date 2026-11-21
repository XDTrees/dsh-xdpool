/**
 * 设计稿样式表只注入一次。
 *
 * 之前每个组件各自 `<style>{DESIGN_TOKENS_CSS + DESIGN_DETAIL_CSS}</style>`，
 * 一共 20 处。那是 113KB × 20 ≈ 2.2MB 的样式文本，浏览器要为每条规则
 * 建立索引，重复二十遍 —— 打开一页就卡一下。
 *
 * 改成：全部合并成一份，挂在 <head> 上一次。组件那边不再自带样式块。
 *
 * 为什么要用 JS 注入而不是让每个组件带 <style>：这几个页面是分别挂载的
 * （账号池、设置面板、输入框旁的余额点），任何一屏都可能先出现，
 * 所以不能指望「某一页的 <style> 顺带给别人带上样式」。
 */
import { DESIGN_DETAIL_CSS, DESIGN_TOKENS_CSS } from './design-css.ts'

const STYLE_ID = 'dsh-xdpool/design.css'
const FULL_CSS = `${DESIGN_TOKENS_CSS}\n${DESIGN_DETAIL_CSS}`

/**
 * 装一次。重复调用不会重复插入。
 *
 * 幂等靠 `data-plugin-css` 标记：热重载时旧节点还在，直接替换内容，
 * 不会在 <head> 里堆出十几个同名 style。
 */
export function installDesignCss(): void {
  if (typeof document === 'undefined') return
  const head = document.head
  if (head === null) return
  const existing = head.querySelector<HTMLStyleElement>(`style[data-plugin-css="${STYLE_ID}"]`)
  if (existing !== null) {
    // 内容不同才写：热重载时避免无谓的重排。
    if (existing.textContent !== FULL_CSS) existing.textContent = FULL_CSS
    return
  }
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-xdpool'
  tag.dataset.pluginCss = STYLE_ID
  tag.textContent = FULL_CSS
  head.appendChild(tag)
}

/** 卸载（插件停用时调用）。 */
export function removeDesignCss(): void {
  if (typeof document === 'undefined') return
  document.head?.querySelector(`style[data-plugin-css="${STYLE_ID}"]`)?.remove()
}

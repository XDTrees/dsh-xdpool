/**
 * The wrapper that makes the pool usable as a *sidebar panel*.
 *
 * Two problems it solves, both invisible from inside `PoolShell`:
 *
 * 1. Scrolling. The settings dialog owns a scroll container, so a page dropped
 *    into `settings.plugin.item` can be as tall as it likes. The main column
 *    cannot: `@deepseek-ai/dsh-client-ui-layout` styles `.centerCol` as
 *    `display:flex; flex-direction:column; overflow:hidden`, and the slot is
 *    rendered into that box with no scrolling of its own. Without a scrollport
 *    here the page simply clips — which is what happens if you register
 *    `PoolCard` into the `main` slot directly. The reference community plugin
 *    solves it the same way, with `height:100%; min-height:0; overflow:auto` on
 *    its page root.
 *
 * 2. Insets. The settings dialog supplies padding around the card; the main
 *    column supplies none, so the same markup arrives flush against the window
 *    edge. The padding below restores the frame the dialog used to provide.
 *
 * `PAGE_CSS` is injected here rather than living in `SHARED_CARD_CSS` because
 * the stylesheets in `PoolShell` are rendered *inside* the shell — this wrapper
 * is its parent, so nothing from that subtree could style it.
 *
 * @module dsh-xdpool/client/page
 */

import { type ReactNode } from 'react'

import { PoolCard, type PoolCardProps } from './PoolCard.tsx'
import { PAGE_CSS } from './styles.ts'

/**
 * `PoolCard`, sized and scrolled for the main column.
 *
 * Kept as a separate component instead of an option on `PoolCard` so the
 * settings registration stays exactly what it was: the dialog already provides
 * both the scrollport and the insets, and adding either again would double
 * them.
 */
export function PoolPage(props: PoolCardProps): ReactNode {
  return (
    <div className="page">
      <style>{PAGE_CSS}</style>
      <PoolCard {...props} />
    </div>
  )
}

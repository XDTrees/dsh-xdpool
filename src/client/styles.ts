/*
 * The plugin's stylesheets.
 *
 * RECOVERED FROM THE COMPILED BUNDLE, NOT HAND-WRITTEN: this file was lost to a bad
 * PowerShell string replace (a literal backtick inside a double-quoted argument closed the
 * quoting and the write truncated the file to zero bytes). The nine constants below
 * were lifted back out of the deployed client.js, which holds each one verbatim as a
 * template literal. Only the module header and the export keywords were retyped.
 *
 * Every rule below is byte-identical to what shipped in build
 * 2026-10-14T16:30. Do not reformat: the test suites slice this file with indexOf()
 * on marker comments, so moving a marker moves a slice boundary.
 */

export const POOL_CARD_CSS = `

/*
 * Page shell. The settings shell renders this inside its own scrollable content
 * column, so the page supplies only the rhythm and the cards — no outer border
 * and no extra margin (the column pads its own edges).
 */
/*
 * Header row: identity on the left, primary actions on the right. Wraps so a
 * narrow panel drops the buttons below the title instead of squeezing it.
 */
/*
 * One feature area per card. The surface separates the sections the way the
 * built-in settings pages do; without it every panel ran together into a single
 * column of text with no visible boundary.
 */
.dsm-xdpool-card{border:1px solid var(--dsw-alias-border-l2,#36373b);background:var(--dsw-alias-bg-layer-2,#232529);border-radius:14px;flex-direction:column;gap:12px;padding:14px 16px;display:flex}
/* Status card: the region switch sits above the state line, then the switch. */
.dsm-xdpool-status{gap:14px}
/* Reusable button primitives shared with the rest of the card body. */
/* A disabled button must not MOVE. The outline button's hover changes only
   colour, so opacity alone was enough there; the pool card's own buttons lift on
   hover (see the region-card rules), and a control that rises under the cursor
   while refusing the click reads as broken rather than unavailable. */
/* Region tabs: two independent suppliers, one shown at a time. */
.dsm-xdpool-tabs{display:flex;gap:6px;padding:4px;border:1px solid var(--dsw-alias-border-l2,#3a3d45);border-radius:10px;background:var(--dsw-alias-bg-layer-3,#2a2c33)}
/* Empty-region guide: steps for signing in on the other gateway. */
.dsm-xdpool-empty{gap:10px}
.dsm-xdpool-empty-title{margin:0;color:var(--dsw-alias-label-primary,#e6e6e6);font-size:14px;font-weight:600;line-height:20px}
.dsm-xdpool-empty-steps{display:flex;flex-direction:column;gap:6px;padding:12px;border-radius:10px;background:var(--dsw-alias-bg-layer-3,#2a2c33)}
.dsm-xdpool-empty-steps-title{margin:0;color:var(--dsw-alias-label-secondary,#c6c9d0);font-size:12px;font-weight:600;line-height:18px}
.dsm-xdpool-empty-list{margin:0;padding-left:20px;display:flex;flex-direction:column;gap:5px;color:var(--dsw-alias-label-tertiary,#9aa0a8);font-size:12px;line-height:18px}
.dsm-xdpool-empty-list li{min-width:0}
.dsm-xdpool-empty-note{margin:0;color:var(--dsw-alias-label-tertiary,#9aa0a8);font-size:11px;line-height:17px}
.dsm-xdpool-tab{appearance:none;font:inherit;cursor:pointer;flex:1;border:0;border-radius:7px;padding:7px 10px;color:var(--dsw-alias-label-tertiary,#999);font-size:13px;font-weight:500;line-height:18px;background:transparent;transition:color .16s,background .16s,box-shadow .16s}
.dsm-xdpool-tab:hover:not(.dsm-xdpool-tab-active){color:var(--dsw-alias-label-primary,#e6e6e6)}
.dsm-xdpool-tab:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px}
.dsm-xdpool-tab-active{color:var(--dsw-alias-label-primary,#e6e6e6);background:var(--dsw-alias-bg-layer-2,#232529);box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l2,#3a3d45)}
.dsm-xdpool-tab-dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:6px;vertical-align:baseline;background:var(--dsw-alias-state-success-primary,#22a06b)}
.dsm-xdpool-tab-dot[data-state="error"]{background:var(--dsw-alias-state-error-primary,#ef4444)}
.dsm-xdpool-tab-dot[data-state="idle"]{background:var(--dsw-alias-label-dimmed,#9aa0a6)}
.dsm-xdpool-usage-head{display:flex;flex-direction:column;gap:12px;min-width:0}
.dsm-xdpool-usage-copy{display:flex;flex-direction:column;gap:3px;min-width:0}
.dsm-xdpool-usage-status{display:flex;align-items:center;gap:10px;font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary,#e6e6e6)}
.dsm-xdpool-usage-dot{width:9px;height:9px;border-radius:50%;flex:0 0 auto}
.dsm-xdpool-usage-hint{margin:0;color:var(--dsw-alias-label-tertiary,#9aa0a8);font-size:12px;line-height:18px}
/*
 * Distribution picker: four modes, so the old three-column grid left the
 * fourth card wrapped onto a line of its own. Two columns give every card room
 * for a full hint sentence and keep the reading order 2x2.
 *
 * The selection cue is this card's own: an inset accent bar plus a solid
 * surface, the same "current one is a raised chip" language the account list
 * uses for the serving account. It is deliberately NOT the brand blue (that is
 * the host's, not ours) and not the health green (that already means "this
 * account works" two cards down).
 */
.dsm-xdpool-dist{display:flex;flex-direction:column;gap:9px}
.dsm-xdpool-dist-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.dsm-xdpool-dist-title{color:var(--dsw-alias-label-tertiary,#9aa0a8);font-size:11px;line-height:16px;letter-spacing:.03em;text-transform:uppercase;font-weight:600}
/* "now: X" — repeats the answer in the header so the user does not have to
   scan four cards for the raised one. */
.dsm-xdpool-dist-now{flex:none;padding:2px 10px;border-radius:999px;border:1px solid color-mix(in oklab, var(--dsw-alias-label-primary,#e6e6e6) 26%, transparent);background:color-mix(in oklab, var(--dsw-alias-label-primary,#e6e6e6) 10%, transparent);color:var(--dsw-alias-label-primary,#e6e6e6);font-size:12px;font-weight:600;line-height:18px;white-space:nowrap}
/* One row of equal chips, and let the row itself decide when it has to break.
   flex-wrap plus a 112px basis keeps the five modes side by side for as long as
   the card can hold them (a chip is ~112px: the longest label plus padding), so
   a 700px panel still reads as one row of choices instead of a hard 760px cliff
   dropping it to two columns. A flex line stretches its items to fill the row,
   so when the chips finally do wrap, the odd last one spans the width on its own
   — no last-child span rule, and therefore no way to accidentally strand the
   last chip on a second row while the first row was still wide enough for all
   five. */
.dsm-xdpool-dist-options{display:flex;flex-wrap:wrap;gap:8px}
.dsm-xdpool-dist-option{flex:1 1 112px;min-width:0;appearance:none;font:inherit;cursor:pointer;text-align:left;display:flex;flex-direction:column;justify-content:center;gap:3px;min-height:46px;border:1px solid color-mix(in oklab, var(--dsw-alias-border-l2,#3a3d45) 80%, transparent);border-radius:12px;padding:9px 11px;background:transparent;color:var(--dsw-alias-label-tertiary,#9aa0a8);transition:color .16s,border-color .16s,background .16s,box-shadow .16s}
.dsm-xdpool-dist-option:hover:not(:disabled):not(.dsm-xdpool-dist-option-active){color:var(--dsw-alias-label-secondary,#c6c9d0);border-color:var(--dsw-alias-label-dimmed,#777);background:rgba(255,255,255,.03)}
.dsm-xdpool-dist-option:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px}
/* Selected: raised onto layer-3 (the same surface the region tabs use when
   active) with an inset accent bar. The bar is what survives a glance — a
   tinted wash alone is indistinguishable from hover. */
.dsm-xdpool-dist-option-active{background:var(--dsw-alias-bg-layer-3,#2a2c33);border-color:color-mix(in oklab, var(--dsw-alias-label-primary,#e6e6e6) 34%, transparent);box-shadow:inset 3px 0 0 var(--dsw-alias-label-primary,#e6e6e6);color:var(--dsw-alias-label-primary,#e6e6e6)}
.dsm-xdpool-dist-option-active .dsm-xdpool-dist-option-name{color:var(--dsw-alias-label-primary,#e6e6e6)}
.dsm-xdpool-dist-option:disabled{cursor:default;opacity:.6}
.dsm-xdpool-dist-option-top{display:flex;align-items:center;gap:6px;min-width:0}
/* The name is the only thing in a chip, so it may wrap rather than ellipsize:
   a truncated mode name is unreadable, a two-line one is merely taller. */
.dsm-xdpool-dist-option-name{font-size:12.5px;line-height:17px;font-weight:600;min-width:0;overflow-wrap:anywhere}
/* "recommended" chip: quiet, and only on the mode this release argues for. */
.dsm-xdpool-dist-option-badge{flex:none;margin-left:auto;padding:1px 6px;border-radius:999px;background:var(--dsw-alias-state-success-subtle,rgba(34,160,107,.14));color:var(--dsw-alias-state-success-primary,#22a06b);font-size:10px;font-weight:600;line-height:15px;white-space:nowrap}
/* One line of prose under the row explains the mode that is selected. Five
   chips cannot each carry a sentence without becoming five paragraphs. */
.dsm-xdpool-dist-hint{color:var(--dsw-alias-label-tertiary,#9aa0a8);font-size:11px;line-height:16px}
.dsm-xdpool-usage-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
/* Account list (each account = a labeled subpanel, same as dingminhua). */
.dsm-xdpool-accounts{gap:14px}
.dsm-xdpool-accounts-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
/* "In use now": a marker ON the serving account's own row, not a bar floating
   above the list. It used to be its own green strip between the section title
   and the first account, which put a fact about one row in a place that read as
   a summary of all of them — and made the eye hunt for which row it belonged to.
   The dot now sits on the row itself, so the answer and its subject are the
   same object. The strip's styling survives as the dot's halo. */
/* The account the pool served its last request with. It is a badge ON that
   account's row, not a strip above the list — so it is a capsule sized for a
   row of chips. The account's own name is right next to it, which is why this
   no longer carries one (the strip above the list had to, and that is what made
   it read as a summary of the whole pool). */
.dsm-xdpool-current{display:inline-flex;align-items:center;gap:5px;flex:none;padding:0 9px 0 7px;border-radius:999px;border:1px solid color-mix(in oklab, var(--dsw-alias-state-success-primary,#22a06b) 32%, transparent);background:color-mix(in oklab, var(--dsw-alias-state-success-primary,#22a06b) 9%, transparent)}
.dsm-xdpool-current-dot{width:6px;height:6px;border-radius:50%;flex:none;background:var(--dsw-alias-state-success-primary,#22a06b);box-shadow:0 0 0 3px color-mix(in oklab, var(--dsw-alias-state-success-primary,#22a06b) 18%, transparent)}
.dsm-xdpool-current-label{color:var(--dsw-alias-state-success-primary,#22a06b);font-size:10.5px;line-height:18px;font-weight:600;letter-spacing:.02em;flex:none;white-space:nowrap}
.dsm-xdpool-accounts-title{margin:0;color:var(--dsw-alias-label-primary,#e6e6e6);font-size:14px;font-weight:600;line-height:20px}
.dsm-xdpool-accounts-summary{margin:2px 0 0;color:var(--dsw-alias-label-tertiary,#999);font-size:12px;line-height:18px}
/* One account = one flat row, the shape the reference build uses: name, state
   chips, actions, all on one line with the numbers. It used to be a card whose
   left half held a single token-expiry line next to a two-column credit grid,
   which produced a tall box mostly made of padding and a left column that said
   almost nothing — and, at the card's real width inside a lane, a grid that
   collapsed to one column anyway. The flat row puts the account's identity and
   its state on the same line, and lets the credit figures be a quiet inline
   group underneath rather than two boxed sub-panels. */
.dsm-xdpool-account{display:flex;flex-direction:column;gap:0;padding:0;border:1px solid color-mix(in oklab, var(--dsw-alias-border-l2,#3a3d45) 55%, transparent);border-radius:13px;background:var(--dsw-alias-bg-layer-2,#24262c);box-shadow:0 1px 3px rgba(0,0,0,.04);overflow:hidden}
/* The row that served the last request. One green hairline on the leading edge,
   the same trick the lane cards use for their accent, so the answer reads as
   "this row is the live one" without tinting the whole card — a tinted card
   would also imply the others are not usable, which is the opposite of the
   rotation this pool is built around. */
.dsm-xdpool-account[data-serving="true"]{border-color:color-mix(in oklab, var(--dsw-alias-state-success-primary,#22a06b) 40%, var(--dsw-alias-border-l2,#3a3d45))}
/* Body row inside a card: identity and state on the top line, the credit
   figures and the automation's takings underneath. */
.dsm-xdpool-account-body{display:flex;flex-direction:column;align-items:stretch;gap:0;padding:9px 13px 11px}
.dsm-xdpool-account-copy{display:flex;flex-direction:column;align-items:flex-start;gap:6px;flex:1 1 auto;min-width:0}
.dsm-xdpool-account-label{color:var(--dsw-alias-label-primary,#e6e6e6);font-size:13.5px;font-weight:650;letter-spacing:-.1px;line-height:20px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsm-xdpool-account-head .dsm-xdpool-account-toggle{margin-left:auto}
/* Identity on the left, state chips in the middle, the two decisions on the
   right. flex-wrap is what lets a long account name push the chips down a line
   instead of squeezing them — the name is what has to shrink first, and it is the
   only thing here allowed to. */
.dsm-xdpool-account-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0;padding:9px 13px}
/* Account switched off on the card: still listed (so it can be turned back on) but visually muted. */
.dsm-xdpool-account-off{opacity:.55}
/* Small pill switch: "in rotation" vs "off". Native checkbox styled by the label. */
.dsm-xdpool-account-toggle{appearance:none;font:inherit;display:inline-flex;align-items:center;gap:5px;cursor:pointer;flex:none;border:1px solid color-mix(in oklab, var(--dsw-alias-border-l2,#3a3d45) 70%, transparent);border-radius:999px;padding:3px 10px;font-size:11px;line-height:17px;background:transparent;color:var(--dsw-alias-label-tertiary,#9aa0a8);transition:color .16s,border-color .16s,background .16s}
.dsm-xdpool-account-toggle:hover:not(:disabled){color:var(--dsw-alias-label-primary,#e6e6e6);border-color:var(--dsw-alias-label-dimmed,#777)}
.dsm-xdpool-account-toggle:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px}
.dsm-xdpool-account-toggle:disabled{cursor:default;opacity:.6}
.dsm-xdpool-account-toggle-on{background:color-mix(in oklab, var(--dsw-alias-state-success-primary,#22a06b) 14%, transparent);border-color:color-mix(in oklab, var(--dsw-alias-state-success-primary,#22a06b) 55%, transparent);color:var(--dsw-alias-state-success-primary,#22a06b);font-weight:600}
.dsm-xdpool-account-toggle-dot{width:6px;height:6px;border-radius:50%;flex:none;background:currentColor;opacity:.9}
/* "Remove" button: destructive and reversible, so it is quiet until hovered. */
.dsm-xdpool-account-ignore{appearance:none;font:inherit;flex:none;cursor:pointer;border:1px solid transparent;border-radius:999px;padding:3px 10px;font-size:11px;line-height:17px;background:transparent;color:var(--dsw-alias-label-tertiary,#9aa0a8);transition:color .16s,border-color .16s,background .16s}
.dsm-xdpool-account-ignore:hover:not(:disabled){color:var(--dsw-alias-state-error-primary,#ef4444);border-color:color-mix(in oklab, var(--dsw-alias-state-error-primary,#ef4444) 45%, transparent);background:color-mix(in oklab, var(--dsw-alias-state-error-primary,#ef4444) 10%, transparent)}
.dsm-xdpool-account-ignore:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px}
.dsm-xdpool-account-ignore:disabled{cursor:default;opacity:.6}
 /* "Prefer" button: same pill family as the toggle and "Remove", so three
    controls on one row read as siblings. It is the only one with a glyph, which
    is what tells the eye where to look first among three equally-weighted
    buttons; the star dims to 35% when the row is not the pinned one so the
    pinned row is the only one that shouts. */
.dsm-xdpool-account-prefer{appearance:none;font:inherit;flex:none;cursor:pointer;display:inline-flex;align-items:center;gap:5px;border:1px solid transparent;border-radius:999px;padding:3px 10px;font-size:11px;line-height:17px;background:transparent;color:var(--dsw-alias-label-tertiary,#9aa0a8);transition:color .16s,border-color .16s,background .16s}
.dsm-xdpool-account-prefer-star{font-size:10px;line-height:1;opacity:.35;transition:opacity .16s,transform .2s}
.dsm-xdpool-account-prefer:hover:not(:disabled){color:var(--dsw-alias-label-primary,#e6e6e6);border-color:var(--dsw-alias-label-dimmed,#777)}
.dsm-xdpool-account-prefer:hover:not(:disabled) .dsm-xdpool-account-prefer-star{opacity:.7;transform:rotate(72deg)}
.dsm-xdpool-account-prefer:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px}
.dsm-xdpool-account-prefer:disabled{cursor:default;opacity:.6}
.dsm-xdpool-account-prefer-on{background:color-mix(in oklab, var(--dsw-alias-state-success-primary,#22a06b) 14%, transparent);border-color:color-mix(in oklab, var(--dsw-alias-state-success-primary,#22a06b) 55%, transparent);color:var(--dsw-alias-state-success-primary,#22a06b);font-weight:600}
.dsm-xdpool-account-prefer-on .dsm-xdpool-account-prefer-star{opacity:1}
.dsm-xdpool-account-prefer:disabled .dsm-xdpool-account-prefer-star{transform:none}
/* Ignored-account list: visible proof that "remove" can be undone. */
/* The container the ignored-account list renders into. It had no rule at all:
   the rows inside it were styled, so the list looked like a stray block of text
   pinned to the card's edge rather than a panel. */
.dsm-xdpool-ignored{margin:6px 0 0;border-radius:10px;border:1px solid color-mix(in srgb, var(--dsw-alias-border-l2,#36373b) 70%, transparent);background:color-mix(in srgb, var(--dsw-alias-bg-layer-1,#191a1e) 55%, transparent);overflow:hidden}
.dsm-xdpool-ignored-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding:12px 16px;border-bottom:1px solid color-mix(in oklab, var(--dsw-alias-border-l2,#3a3d45) 45%, transparent)}
.dsm-xdpool-ignored-title{margin:0;color:var(--dsw-alias-label-primary,#e6e6e6);font-size:13px;font-weight:600;line-height:19px}
.dsm-xdpool-ignored-summary{margin:0;color:var(--dsw-alias-label-tertiary,#9aa0a8);font-size:11px;line-height:17px}
.dsm-xdpool-ignored-list{display:flex;flex-direction:column}
.dsm-xdpool-ignored-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 16px}
.dsm-xdpool-ignored-row+.dsm-xdpool-ignored-row{border-top:1px solid color-mix(in oklab, var(--dsw-alias-border-l2,#3a3d45) 30%, transparent)}
.dsm-xdpool-ignored-label{color:var(--dsw-alias-label-secondary,#c6c9d0);font-size:12px;line-height:18px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsm-xdpool-ignored-restore{appearance:none;font:inherit;flex:none;cursor:pointer;border:1px solid color-mix(in oklab, var(--dsw-alias-border-l2,#3a3d45) 70%, transparent);border-radius:999px;padding:3px 10px;font-size:11px;line-height:17px;background:transparent;color:var(--dsw-alias-label-secondary,#c6c9d0);transition:color .16s,border-color .16s}
.dsm-xdpool-ignored-restore:hover:not(:disabled){color:var(--dsw-alias-label-primary,#e6e6e6);border-color:var(--dsw-alias-label-dimmed,#777)}
.dsm-xdpool-ignored-restore:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px}
.dsm-xdpool-ignored-restore:disabled{cursor:default;opacity:.6}
.dsm-xdpool-account-tags{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.dsm-xdpool-account-tag{padding:1px 8px;border-radius:999px;font-size:11px;line-height:18px;background:var(--dsw-alias-state-success-subtle,rgba(34,160,107,.12));color:var(--dsw-alias-state-success-primary,#22a06b)}
.dsm-xdpool-account-tag-cooling{background:var(--dsw-alias-state-warning-subtle,rgba(217,119,6,.15));color:var(--dsw-alias-state-warning-primary,#d97706)}
.dsm-xdpool-account-tag-error{background:var(--dsw-alias-state-error-subtle,rgba(239,68,68,.12));color:var(--dsw-alias-state-error-primary,#ef4444)}
/* A rejected sign-in is red, not amber: unlike a cooldown it will not clear by
   waiting, and it is the one state where the user has to go do something. */
.dsm-xdpool-account-tag-dead{background:var(--dsw-alias-state-error-subtle,rgba(239,68,68,.12));color:var(--dsw-alias-state-error-primary,#ef4444)}
.dsm-xdpool-account-meta{color:var(--dsw-alias-label-tertiary,#9aa0a8);font-size:12px;line-height:18px;display:flex;flex-wrap:wrap;gap:10px}
.dsm-xdpool-account-meta-dead{color:var(--dsw-alias-state-error-primary,#ef4444)}
.dsm-xdpool-account-modelcool{display:flex;flex-wrap:wrap;gap:6px;margin-top:2px}
.dsm-xdpool-account-modelcool-chip{display:inline-flex;align-items:center;gap:4px;padding:1px 8px;border-radius:999px;font-size:11px;line-height:18px;background:var(--dsw-alias-state-warning-subtle,rgba(217,119,6,.12));color:var(--dsw-alias-state-warning-primary,#d97706)}
/* "→ deepseek-v4.1-flash-sg (0.03x) still works" inside a cooling chip. Keeps
   the warning tint of its parent but drops the weight: it is the way out, not
   a second problem. */
.dsm-xdpool-account-modelcool-twin{color:var(--dsw-alias-label-secondary,#c6c9d0);cursor:help}
.dsm-xdpool-account-error{margin:0;color:var(--dsw-alias-state-error-primary,#ef4444);font-size:13px;line-height:20px}
/* Credit figures: one quiet inline line — the total, the check-in action, then
   the package breakdown as chips underneath. A grid of two boxed panels said
   "these are two systems" when they are one balance and its breakdown, and the
   28px green total inside a tinted box with a 3px cap made a routine number read
   like a headline. The total keeps its emphasis as a figure among figures. */
.dsm-xdpool-stats{display:flex;align-items:center;gap:9px 15px;flex-wrap:wrap;min-width:0;margin-top:7px;padding-top:8px;border-top:1px dashed var(--dsw-alias-border-l2,#36373b)}
.dsm-xdpool-panel{display:flex;align-items:center;gap:6px;min-width:0;padding:0}
.dsm-xdpool-panel-title{color:var(--dsw-alias-label-tertiary,#999);font-size:11.5px;line-height:17px;font-weight:500}
/* A rejected sign-in gets a compact chip: the upstream paragraph is long, and
   printed inline it pushed the neighbouring "Total" panel off screen. */
.dsm-xdpool-panel-error-dead{display:inline-flex;align-items:center;align-self:flex-start;padding:1px 8px;border-radius:999px;background:var(--dsw-alias-state-error-subtle,rgba(239,68,68,.12));font-size:11px;line-height:18px;white-space:nowrap;cursor:help}
/* The package breakdown rides along on the same line as the figures above it.
   As its own column it needed a heading to say what it was; as a chip list the
   name says it, and the amounts stay comparable across accounts. */
.dsm-xdpool-packages{display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0;margin:0;padding:0;list-style:none}
/* One credit package: name, then what is left of it. A grid gave the numbers a
   column of their own, which is right for a table and wrong for three chips
   sharing a line with a total. */
.dsm-xdpool-packages li{display:inline-flex;align-items:baseline;gap:5px;min-width:0;padding:1px 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1,#2f3035);background:color-mix(in srgb, var(--dsw-alias-bg-layer-1,#191a1e) 62%, transparent);color:var(--dsw-alias-label-secondary,#c6c9d0);font-size:11px;line-height:17px}
.dsm-xdpool-packages-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* Per-package deadline: the upstream grants one-off packs at arbitrary clock
   times, so each pack carries its own timestamp. It sits inside its own chip on
   its own line — a pack name plus two timestamps did not fit on one line, and
   dropping the timestamp to the row's left edge made the list look ragged. */
.dsm-xdpool-packages-when{color:var(--dsw-alias-label-tertiary,#9aa0a8);font-size:10.5px;line-height:15px;font-variant-numeric:tabular-nums}
.dsm-xdpool-packages-when-soon{color:var(--dsw-alias-state-warning-primary,#d97706)}
/* The balance. Still the most important figure on the row — colour and weight,
   not size: at 28px it outweighed the account name it belongs to. The green is
   pinned rather than taken from the theme alias: at 16px/700 the alias green
   read darker than the 11px figures beside it on the same row — the same hex
   looks dimmer in large bold type than in small text — and the user read the
   balance as grey next to the bright green streak chips. A slightly brighter
   literal keeps the two readings of "green" on this row identical. */
.dsm-xdpool-total-value{color:#2fbf7f;font-size:16px;line-height:22px;font-weight:700;letter-spacing:-.2px;white-space:nowrap;font-variant-numeric:tabular-nums}
/* Per-package figures share the balance's green: they are the same credit
   balance broken down, and rendering them in grey made the packages look
   spent while the total looked alive. */
.dsm-xdpool-packages-value{color:#2fbf7f;font-variant-numeric:tabular-nums}
/* Model directory list. */
.dsm-xdpool-models{gap:10px}
.dsm-xdpool-models-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
.dsm-xdpool-models-title{margin:0;color:var(--dsw-alias-label-primary,#e6e6e6);font-size:14px;font-weight:600;line-height:20px}
.dsm-xdpool-models-summary{margin:2px 0 0;color:var(--dsw-alias-label-tertiary,#999);font-size:12px;line-height:18px}
.dsm-xdpool-model-list{display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2,#36373b);border-radius:10px;overflow:hidden}
.dsm-xdpool-model{display:grid;grid-template-columns:minmax(0,1fr);gap:7px;padding:10px 12px;background:var(--dsw-alias-bg-layer-2,#232529);transition:opacity .16s}
.dsm-xdpool-model+.dsm-xdpool-model{border-top:1px solid var(--dsw-alias-border-l2,#36373b)}
.dsm-xdpool-model-head{display:flex;align-items:center;justify-content:space-between;gap:12px;min-width:0}
.dsm-xdpool-model-copy{display:flex;align-items:baseline;gap:8px;min-width:0;flex-wrap:wrap}
.dsm-xdpool-model-name{display:inline-flex;align-items:baseline;gap:7px;color:var(--dsw-alias-label-primary,#e6e6e6);font-size:13px;font-weight:500;line-height:19px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsm-xdpool-model-name-rate{color:var(--dsw-alias-label-tertiary,#999);font-size:11px;font-weight:400;line-height:16px;flex:none}
.dsm-xdpool-model-id{color:var(--dsw-alias-label-tertiary,#999);font-size:11px;line-height:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsm-xdpool-model-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;color:var(--dsw-alias-label-tertiary,#999);font-size:11px;line-height:16px}
.dsm-xdpool-model-meta-tag{padding:1px 8px;border-radius:999px;font-size:11px;line-height:16px;background:rgba(174,179,187,.11);color:var(--dsw-alias-label-secondary,#c6c9d0)}
/* "free from HH:00": quieter than the badge on purpose — the model costs
   credits right now, so it must not read as a promo the user can spend against. */
.dsm-xdpool-model-meta-later{padding:1px 8px;border-radius:999px;font-size:11px;line-height:16px;border:1px dashed color-mix(in oklab, var(--dsw-alias-label-dimmed,#9aa0a8) 55%, transparent);color:var(--dsw-alias-label-tertiary,#9aa0a8)}
/* "活动至 10-31": the campaign's end date. Muted — it is context for planning,
   not a claim about the current price. */
.dsm-xdpool-model-meta-promo{color:var(--dsw-alias-label-tertiary,#9aa0a8);font-size:11px;line-height:16px;opacity:.85}
/* "付费同款 deepseek-v4.1-flash-sg (0.03x)": the way out when the free row is
   rate-limited. Muted like the other meta chips — it is an alternative, not a
   warning, and the row it sits on is still the free one. */
.dsm-xdpool-model-meta-twin{color:var(--dsw-alias-label-tertiary,#9aa0a8);font-size:11px;line-height:16px;opacity:.85;cursor:help}
/* Unreadable credential files: a warning tint, since it explains a smaller pool
   and "encrypted" is actionable (start the app once). */
.dsm-xdpool-skipped{margin:6px 0 0;padding:7px 10px;border-radius:8px;background:var(--dsw-alias-state-warning-subtle,rgba(217,119,6,.12));display:flex;flex-direction:column;gap:3px}
.dsm-xdpool-skipped-summary{margin:0;font-size:12px;line-height:18px;font-weight:600;color:var(--dsw-alias-state-warning-primary,#d97706)}
.dsm-xdpool-skipped-row{margin:0;display:flex;gap:8px;align-items:baseline;font-size:11px;line-height:16px;flex-wrap:wrap}
.dsm-xdpool-skipped-file{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--dsw-alias-label-secondary,#c6c9d0);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsm-xdpool-skipped-reason{color:var(--dsw-alias-label-tertiary,#9aa0a8)}
.dsm-xdpool-model-cap{color:var(--dsw-alias-label-tertiary,#999);font-size:11px;line-height:16px;font-variant-numeric:tabular-nums}
/* Model row: checkbox + image toggle + context-budget radios. */
.dsm-xdpool-model-off{opacity:.55}
.dsm-xdpool-model-check{display:flex;align-items:center;gap:8px;min-width:0;flex:1;cursor:pointer}
.dsm-xdpool-model-check input{margin:0;accent-color:var(--dsw-alias-brand-primary,#5686fe);flex:none}
.dsm-xdpool-model-controls{display:flex;align-items:center;gap:10px;flex:none;flex-wrap:wrap;justify-content:flex-end}
.dsm-xdpool-model-image{display:inline-flex;align-items:center;gap:5px;flex:none;cursor:pointer;color:var(--dsw-alias-label-secondary,#c6c9d0);font-size:11px;line-height:16px}
.dsm-xdpool-model-image input{margin:0;accent-color:var(--dsw-alias-brand-primary,#5686fe)}
.dsm-xdpool-model-budget{display:flex;align-items:center;gap:9px;flex:none;margin:0;padding:0;border:0;color:var(--dsw-alias-label-secondary,#c6c9d0);font-size:11px;line-height:16px}
.dsm-xdpool-model-budget label{display:inline-flex;align-items:center;gap:4px;cursor:pointer}
.dsm-xdpool-model-budget input{margin:0;accent-color:var(--dsw-alias-brand-primary,#5686fe)}
.dsm-xdpool-models-heading{display:flex;flex-direction:column;gap:2px;min-width:0}
.dsm-xdpool-usage{display:flex;flex-direction:column;gap:10px}
.dsm-xdpool-usage-head{display:flex;flex-direction:column;gap:2px}
.dsm-xdpool-usage-title{margin:0;font-size:13px;font-weight:600}
.dsm-xdpool-usage-summary{margin:0;color:var(--dsw-alias-label-tertiary,#999);font-size:12px;line-height:18px}
.dsm-xdpool-usage-rows{display:flex;flex-direction:column;gap:6px}
.dsm-xdpool-usage-row{display:flex;flex-direction:column;gap:2px;padding:8px 10px;border:1px solid var(--dsw-alias-border-subtle,rgba(127,127,127,.25));border-radius:8px}
.dsm-xdpool-usage-model{font-size:12px;font-weight:600;word-break:break-all}
.dsm-xdpool-usage-numbers{color:var(--dsw-alias-label-tertiary,#999);font-size:11px;line-height:17px;word-break:break-word}
.dsm-xdpool-usage-note{margin:0;color:var(--dsw-alias-label-tertiary,#999);font-size:11px;line-height:17px}
.dsm-xdpool-models-actions{display:flex;align-items:center;gap:8px;flex:none}
/* "Built-in list (offline)" chip: a warning tint, since the user is looking at
   a SHORTER roster than the gateway offers and may wonder where models went. */
.dsm-xdpool-catalog-offline{flex:none;padding:2px 9px;border-radius:999px;font-size:11px;line-height:17px;font-weight:600;background:var(--dsw-alias-state-warning-subtle,rgba(217,119,6,.15));color:var(--dsw-alias-state-warning-primary,#d97706);white-space:nowrap}
/* Automation: run-now button and the per-job progress line. */
.dsm-xdpool-auto-run{flex:none}
.dsm-xdpool-auto-job-detail{grid-column:1/-1;color:var(--dsw-alias-label-tertiary,#9aa0a8);font-size:11px;line-height:16px}
/* Credit packages ride on the figures line above the check-in row. */
.dsm-xdpool-panel-packages{display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0}
/* Check-in: the action and its state on ONE line. It was a centred column under
   a huge number with a hairline above it, which put the one daily thing the
   user can actually do here behind a divider inside a card that is not a
   dialog. The streak stays beside the button because it is the reason the
   button is still worth pressing. */
.dsm-xdpool-checkin{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
.dsm-xdpool-checkin-meta{display:flex;align-items:center;gap:7px;flex-wrap:wrap;min-width:0}
.dsm-xdpool-checkin-streak{color:var(--dsw-alias-label-secondary,#c6c9d0);font-size:11.5px;line-height:17px;font-variant-numeric:tabular-nums}
.dsm-xdpool-checkin-daily{color:var(--dsw-alias-state-success-primary,#22a06b);font-size:11px;line-height:16px;font-variant-numeric:tabular-nums}
.dsm-xdpool-checkin-bonus{padding:1px 8px;border-radius:999px;font-size:11px;line-height:16px;background:var(--dsw-alias-state-success-subtle,rgba(51,160,107,.14));color:var(--dsw-alias-state-success-primary,#22a06b)}
.dsm-xdpool-checkin-btn{flex:none;padding:3px 11px;border-radius:8px;border:1px solid transparent;font-size:11.5px;font-weight:600;line-height:18px;cursor:pointer;background:var(--dsw-alias-state-success-primary,#22a06b);color:#fff;transition:opacity .16s,border-color .16s,background .16s}
.dsm-xdpool-checkin-btn:hover:not(:disabled){opacity:.88}
.dsm-xdpool-checkin-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px}
.dsm-xdpool-checkin-btn:disabled{cursor:default;background:transparent;border-color:var(--dsw-alias-border-l2,#3a3d45);color:var(--dsw-alias-label-tertiary,#9aa0a8);opacity:1}
.dsm-xdpool-checkin-error{color:var(--dsw-alias-state-error-primary,#ef4444);font-size:11px;line-height:16px;word-break:break-word}
/* Inline notes + error messages. */
.dsm-xdpool-error{margin:0;color:var(--dsw-alias-state-error-primary,#ef4444);font-size:13px;line-height:20px}
/* Responsive: the figures line is already one wrapping row, so nothing about
   it needs a column count at narrow widths. */
@media (max-width:760px){
  /* The chips wrap on their own (auto-fit), so the only thing left to do here
     is stop reserving desktop height for rows that are now one chip tall. */
  .dsm-xdpool-dist-option{min-height:0}
}
/* Automation panel: schedule and last-run summary, collapsed behind a switch. */
.dsm-xdpool-auto{margin-top:12px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2,#36373b);border-radius:10px;background:var(--dsw-alias-bg-module-platform,#202126)}
.dsm-xdpool-auto-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.dsm-xdpool-auto-title{color:var(--dsw-alias-label-primary,#e8e8ea);font-size:12px;font-weight:600}
.dsm-xdpool-auto-switch{padding:3px 12px;border:1px solid var(--dsw-alias-border-l2,#36373b);border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary,#c6c9d0);font-size:12px;cursor:pointer;transition:color .16s,border-color .16s,background .16s}
.dsm-xdpool-auto-switch:hover:not(:disabled){border-color:var(--dsw-alias-label-dimmed,#777);color:var(--dsw-alias-label-primary,#e8e8ea)}
.dsm-xdpool-auto-switch:disabled{opacity:.5;cursor:not-allowed}
.dsm-xdpool-auto-switch-on{border-color:#28c8b4;color:#28c8b4;background:rgba(40,200,180,.12)}
.dsm-xdpool-auto-hint{margin:6px 0 0;color:var(--dsw-alias-label-secondary,#c6c9d0);font-size:12px;line-height:1.6}
.dsm-xdpool-auto-total{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-top:8px;padding:6px 8px;border-radius:8px;background:rgba(40,200,180,.08);font-size:11px}
.dsm-xdpool-auto-total-label{color:var(--dsw-alias-label-secondary,#c6c9d0);font-size:12px}
.dsm-xdpool-auto-total{display:flex;flex-direction:column;gap:4px;margin-top:8px;padding:6px 8px;border-radius:8px;background:rgba(40,200,180,.08);font-size:11px}
.dsm-xdpool-auto-total-list{display:flex;flex-direction:column;gap:2px}
.dsm-xdpool-auto-total-row{color:#28c8b4;font-variant-numeric:tabular-nums}
.dsm-xdpool-earned{display:flex;flex-direction:column;gap:4px;margin-top:8px;padding-top:8px;border-top:1px dashed var(--dsw-alias-border-l2,#36373b);font-size:11px}
.dsm-xdpool-earned-label{color:var(--dsw-alias-label-secondary,#c6c9d0);font-size:12px}
.dsm-xdpool-earned-list{display:flex;flex-direction:column;gap:2px}
.dsm-xdpool-earned-row{color:#28c8b4;font-variant-numeric:tabular-nums}
.dsm-xdpool-earned-value{color:#28c8b4;font-weight:600;font-variant-numeric:tabular-nums}
.dsm-xdpool-auto-jobs{margin-top:8px;display:flex;flex-direction:column;gap:4px}
.dsm-xdpool-auto-job{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px;color:var(--dsw-alias-label-secondary,#c6c9d0)}
.dsm-xdpool-auto-job-name{flex:0 0 auto;min-width:72px;color:var(--dsw-alias-label-primary,#e8e8ea);font-weight:500}
.dsm-xdpool-auto-job-when{flex:1 1 auto;color:var(--dsw-alias-label-secondary,#c6c9d0);font-variant-numeric:tabular-nums}
.dsm-xdpool-auto-job-last{flex:0 0 auto;text-align:right;color:var(--dsw-alias-label-secondary,#c6c9d0);font-variant-numeric:tabular-nums;white-space:nowrap}
.dsm-xdpool-auto-job-note{flex:0 0 auto;color:var(--dsw-alias-label-secondary,#c6c9d0)}
/* Reserved credits: one inline number field per account. */
.dsm-xdpool-reserve{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:8px;padding-top:8px;border-top:1px dashed var(--dsw-alias-border-l2,#36373b);font-size:11px;color:var(--dsw-alias-label-dimmed,#8a97b5)}
.dsm-xdpool-reserve-label{flex:0 0 auto}
.dsm-xdpool-reserve-input{width:84px;padding:3px 8px;border:1px solid var(--dsw-alias-border-l2,#3a3d45);border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary,#e8e8ea);font:inherit;font-variant-numeric:tabular-nums;transition:border-color .16s,background .16s}
.dsm-xdpool-reserve-input:focus{outline:none;border-color:var(--dsw-alias-state-success-primary,#22a06b);background:color-mix(in oklab, var(--dsw-alias-state-success-primary,#22a06b) 7%, transparent)}
.dsm-xdpool-reserve-input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px}
.dsm-xdpool-reserve-input:disabled{opacity:.6}
.dsm-xdpool-reserve-unit{flex:0 0 auto}
.dsm-xdpool-reserve-badge{flex:0 0 auto;padding:1px 7px;border-radius:999px;background:rgba(232,90,90,.14);color:#e85a5a;font-size:10px}
/* Explicit Save: the field is a draft, so the button (not a blur) is what
   commits it — and the outcome is reported right here, next to the control. */
.dsm-xdpool-reserve-save{flex:0 0 auto;appearance:none;font:inherit;font-size:11px;font-weight:600;line-height:16px;padding:3px 12px;border-radius:6px;border:1px solid color-mix(in oklab, var(--dsw-alias-state-success-primary,#22a06b) 55%, transparent);background:color-mix(in oklab, var(--dsw-alias-state-success-primary,#22a06b) 14%, transparent);color:var(--dsw-alias-state-success-primary,#22a06b);cursor:pointer;transition:opacity .16s,background .16s,border-color .16s,color .16s}
.dsm-xdpool-reserve-save:hover:not(:disabled){background:color-mix(in oklab, var(--dsw-alias-state-success-primary,#22a06b) 24%, transparent);border-color:var(--dsw-alias-state-success-primary,#22a06b)}
.dsm-xdpool-reserve-save:disabled{cursor:default;border-color:var(--dsw-alias-border-l2,#3a3d45);background:transparent;color:var(--dsw-alias-label-tertiary,#8a90a0);opacity:.75}
.dsm-xdpool-reserve-note{flex:0 0 auto;font-size:11px;line-height:16px}
.dsm-xdpool-reserve-note-ok{color:var(--dsw-alias-state-success-primary,#22a06b)}
.dsm-xdpool-reserve-note-bad{color:var(--dsw-alias-state-error-primary,#ef4444);font-weight:600}
/* Page switch between the account pool and the aggregate lane. */
/* Region cards: one per supplier lane, side by side.
 *
 * Placed at the END of this constant on purpose. The mode-picker suite reads
 * this stylesheet with two indexOf calls to carve out the block it asserts on
 * (the narrow-screen media query, and the Automation-panel comment that
 * follows it), so anything inserted between those two markers leaks into that
 * block and the assertions start failing for reasons that have nothing to do
 * with the modes. Appended rules cannot move either marker.
 *
 * A card is a two-column grid at 1080px: the shell leaves 1080 - 48 of
 * padding, minus a 12px gap, so each lane gets 510px. Below 900px the two
 * lanes stop being comparable side by side, so they stack. */
.dsm-xdpool-regions{display:flex;flex-direction:column;gap:12px}
/* Stacked, full width, one lane per row — the same arrangement the login-channel
   page uses. The two lanes are not a comparison table; each one is a supplier
   the user signs into and reads on its own, and side-by-side columns made the
   shorter lane look like it was missing something. */
.dsm-xdpool-region-grid{display:flex;flex-direction:column;gap:12px;min-width:0}
/* ── Scan-channel cards on the pool page (ChannelPoolSection) ──
   One card per scan channel that holds an account, laid out like the
   reference build's channel card: identity, the vendor's own note, a numbers
   row, then two collapsible lists. The shell mirrors the region lane above
   (13px radius, translucent layer-3 fill) so the pool page reads as one
   family; the accent comes from the channel's own colour.

   The class is "cpool", not "channelpool", because these rules are a
   different vocabulary: the earlier ones described a flat card with every
   model always visible, and keeping the old names on the new shapes would
   leave two rule sets fighting over one element. */
.dsm-xdpool-cpool{display:flex;flex-direction:column;gap:10px}
.dsm-xdpool-cpool-grid{display:flex;flex-direction:column;gap:12px;min-width:0}
.dsm-xdpool-cpool-card{--dsm-xdpool-cpool-accent:var(--dsw-alias-brand-primary,#5686fe);position:relative;display:flex;flex-direction:column;gap:8px;padding:12px 13px 12px 15px;overflow:hidden;border:1px solid var(--dsw-alias-border-l2,#36373b);border-radius:13px;background:color-mix(in srgb, var(--dsw-alias-bg-layer-3,#2a2c33) 80%, transparent);box-shadow:inset 0 1px 0 rgb(255 255 255 / 6%), 0 1px 2px rgb(0 0 0 / 6%);transition:transform .22s cubic-bezier(.32,.72,0,1),box-shadow .24s ease,border-color .2s ease}
.dsm-xdpool-cpool-card:hover{transform:translateY(-3px);border-color:color-mix(in srgb, var(--dsm-xdpool-cpool-accent,#5686fe) 55%, var(--dsw-alias-border-l2,#36373b));box-shadow:inset 0 1px 0 rgb(255 255 255 / 8%),0 18px 40px rgb(0 0 0 / 15%)}
.dsm-xdpool-cpool-card:hover .dsm-xdpool-tile{transform:scale(1.06) rotate(-3deg);transition:transform .35s cubic-bezier(.34,1.56,.64,1)}
.dsm-xdpool-cpool-card::before{content:"";position:absolute;left:0;top:0;right:0;height:2px;background:linear-gradient(90deg,var(--dsm-xdpool-cpool-accent,#5686fe),color-mix(in srgb,var(--dsm-xdpool-cpool-accent,#5686fe) 30%,transparent));opacity:.85;transition:opacity .24s ease}
.dsm-xdpool-cpool-card:hover::before{opacity:1}
/* Identity row. The name is a block so the org sits under it, which keeps a
   long vendor name from pushing the state text off the card. */
.dsm-xdpool-cpool-head{display:flex;align-items:center;gap:11px}
.dsm-xdpool-cpool-id{display:flex;flex-direction:column;gap:1px;min-width:0}
.dsm-xdpool-cpool-id b{font-size:14px;font-weight:600;line-height:19px;color:var(--dsw-alias-label-primary,#f2f3f5)}
.dsm-xdpool-cpool-id span{font-size:11px;line-height:15px;color:var(--dsw-alias-label-tertiary,#9aa0a8)}
.dsm-xdpool-cpool-state{margin-left:auto;flex:none;font-size:11px;padding:2px 8px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2,#36373b);color:var(--dsw-alias-label-tertiary,#9aa0a8)}
.dsm-xdpool-cpool-state[data-on=true]{border-color:color-mix(in srgb, var(--dsm-xdpool-cpool-accent,#5686fe) 45%, transparent);color:color-mix(in srgb, var(--dsm-xdpool-cpool-accent,#5686fe) 70%, var(--dsw-alias-label-primary,#f2f3f5))}
.dsm-xdpool-cpool-note{margin:0;font-size:12px;line-height:17px;color:var(--dsw-alias-label-tertiary,#9aa0a8)}
.dsm-xdpool-cpool-meta{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:12px;color:var(--dsw-alias-label-secondary,#c9ccd1)}
.dsm-xdpool-cpool-credit{color:var(--dsw-alias-label-primary,#f2f3f5);font-variant-numeric:tabular-nums}
.dsm-xdpool-cpool-acts{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.dsm-xdpool-cpool-fold{font:inherit;font-size:12px;padding:4px 10px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2,#36373b);background:transparent;color:var(--dsw-alias-label-secondary,#c9ccd1);cursor:pointer;transition:border-color .2s ease,color .2s ease,transform .18s cubic-bezier(.32,.72,0,1),box-shadow .22s ease}
.dsm-xdpool-cpool-fold:hover:not(:disabled){transform:translateY(-1px);border-color:color-mix(in srgb, var(--dsm-xdpool-cpool-accent,#5686fe) 55%, var(--dsw-alias-border-l2,#36373b));color:var(--dsw-alias-label-primary,#f2f3f5);box-shadow:0 3px 8px rgb(0 0 0 / 9%)}
.dsm-xdpool-cpool-fold[aria-expanded=true]{border-color:color-mix(in srgb, var(--dsm-xdpool-cpool-accent,#5686fe) 62%, transparent);color:var(--dsw-alias-label-primary,#f2f3f5)}
.dsm-xdpool-cpool-fold:active:not(:disabled){transform:scale(.985)}
.dsm-xdpool-cpool-fold:disabled{opacity:.45;cursor:default}
.dsm-xdpool-minibtn{font:inherit;font-size:11px;padding:3px 8px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,#36373b);background:transparent;color:var(--dsw-alias-label-secondary,#c9ccd1);cursor:pointer;transition:border-color .18s ease,color .18s ease,background-color .18s ease}
.dsm-xdpool-minibtn:hover:not(:disabled){border-color:color-mix(in srgb, var(--dsm-xdpool-cpool-accent,#5686fe) 55%, var(--dsw-alias-border-l2,#36373b));color:var(--dsw-alias-label-primary,#f2f3f5);background:color-mix(in srgb, var(--dsm-xdpool-cpool-accent,#5686fe) 7%, transparent)}
.dsm-xdpool-minibtn:disabled{opacity:.45;cursor:default}
.dsm-xdpool-minibtn[data-tone=danger]:hover:not(:disabled){border-color:color-mix(in srgb, #e5484d 55%, var(--dsw-alias-border-l2,#36373b));color:#ff8a8f;background:color-mix(in srgb, #e5484d 9%, transparent)}
.dsm-xdpool-cpool-balanceerror{margin:0;font-size:12px;line-height:17px;color:#ff8a8f}
/* Accounts fold. One row per sign-in: who it is, whether it is live, today's
   credit badge, the balance in the vendor's own unit, then four actions. The
   row wraps instead of scrolling sideways so a long balance line cannot push
   the delete button out of reach. */
.dsm-xdpool-cpool-acctlist{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px}
.dsm-xdpool-cpool-acct{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;padding:7px 9px;border:1px solid var(--dsw-alias-border-l1,#2f3034);border-radius:10px;background:color-mix(in srgb, var(--dsw-alias-bg-layer-2,#24262b) 60%, transparent)}
.dsm-xdpool-cpool-acct[data-off=true]{opacity:.6}
.dsm-xdpool-cpool-acctname{font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary,#f2f3f5)}
.dsm-xdpool-cpool-acctmeta{font-size:11px;color:var(--dsw-alias-label-tertiary,#9aa0a8)}
.dsm-xdpool-cpool-creditbadge{font-size:11px;padding:1px 7px;border-radius:9px;border:1px solid color-mix(in srgb, #2fbf7f 45%, transparent);color:#2fbf7f;background:color-mix(in srgb, #2fbf7f 10%, transparent)}
.dsm-xdpool-cpool-acctbalance{font-size:12px;color:var(--dsw-alias-label-secondary,#c9ccd1);font-variant-numeric:tabular-nums}
.dsm-xdpool-cpool-acctbalance[data-tone=err]{color:#ff8a8f}
.dsm-xdpool-cpool-acctacts{display:flex;flex-wrap:wrap;gap:6px;margin-left:auto}
/* Models fold. The description line is the reason this list is a fold and not
   a grid of checkboxes: a thirty-model channel with descriptions is a wall of
   text unless it opens. */
.dsm-xdpool-cpool-models{display:flex;flex-direction:column;gap:8px}
.dsm-xdpool-cpool-modelhead{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-tertiary,#9aa0a8)}
.dsm-xdpool-cpool-modelhead button{margin-left:auto}
.dsm-xdpool-cpool-modelhead button+button{margin-left:0}
.dsm-xdpool-cpool-modellist{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px}
.dsm-xdpool-cpool-modelrow{display:flex;flex-direction:column;gap:2px;padding:6px 8px;border:1px solid var(--dsw-alias-border-l1,#2f3034);border-radius:10px}
.dsm-xdpool-cpool-modelrow[data-off=true]{opacity:.62}
.dsm-xdpool-cpool-modelrow-toggle{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--dsw-alias-label-secondary,#c9ccd1);cursor:pointer}
.dsm-xdpool-cpool-modelname{user-select:none;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsm-xdpool-cpool-tag{font-size:10px;padding:1px 6px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,#36373b);color:var(--dsw-alias-label-tertiary,#9aa0a8);flex:none}
.dsm-xdpool-cpool-tag[data-tone=free]{border-color:color-mix(in srgb, #2fbf7f 45%, transparent);color:#2fbf7f}
.dsm-xdpool-cpool-tag[data-tone=dead]{border-color:color-mix(in srgb, #e5484d 45%, transparent);color:#ff8a8f}
/* One line under an empty or fully-filtered list. Both cases print it, because
   "nothing published" and "nothing matched your search" must not look alike. */
.dsm-xdpool-cpool-empty{margin:0;font-size:13px;color:var(--dsw-alias-label-tertiary,#9aa0a8)}
/* Model figures ride inside the row they describe, indented to clear the
   checkbox column so the numbers line up with the model name above them.
   The description itself is printed by ModelFactsRow in its own style — this
   block only places the block. */
.dsm-xdpool-cpool-mfacts{margin:2px 0 0 22px;padding:0}
/* The per-model window cap, on the same control the region cards use. It sits
   one level further in (indented under the row) because a channel list holds up
   to thirty rows and an un-indented radio pair would read as a setting for the
   whole list rather than for the model above it. */
.dsm-xdpool-cpool-budget{margin:1px 0 0 22px}
.dsm-xdpool-cpool-modeltools{display:flex;align-items:center;gap:6px;margin-left:auto}
/* The search row pairs the field with a live count, because "nothing matched"
   is otherwise indistinguishable from "the list is empty". */
.dsm-xdpool-cpool-search{display:flex;align-items:center;gap:9px;margin:1px 0 3px}
.dsm-xdpool-cpool-searchbox{flex:1 1 auto;min-width:0;appearance:none;font:inherit;font-size:12px;line-height:18px;padding:5px 10px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2,#36373b);background:color-mix(in srgb, var(--dsw-alias-bg-layer-1,#191a1e) 78%,transparent);box-shadow:inset 0 1px 2px rgb(0 0 0/5%);color:var(--dsw-alias-label-primary,#f2f3f5)}
.dsm-xdpool-cpool-searchbox::placeholder{color:var(--dsw-alias-label-tertiary,#9aa0a8)}
.dsm-xdpool-cpool-searchbox:focus{outline:none;border-color:color-mix(in srgb, var(--dsm-xdpool-cpool-accent,var(--dsw-alias-brand-primary,#5686fe)) 70%, transparent);box-shadow:0 0 0 3px color-mix(in srgb, var(--dsm-xdpool-cpool-accent,var(--dsw-alias-brand-primary,#5686fe)) 20%, transparent)}
.dsm-xdpool-cpool-searchnote{flex:none;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#9aa0a8);white-space:nowrap}
/* Credit actions stay left, list toggles sit right: "acts" is a flex row and
   this spacer is what pushes the fold buttons away from the credit buttons. */
.dsm-xdpool-cpool-acts-gap{flex:1 1 auto;min-width:4px}
/* The claim button is the only solid one on the row — it is the action that
   pays the reader back, and a solid fill is how that is said without a label
   explaining it. "quiet" is the other end: same shape, no lift of colour. */
/*
 * Buttons inside a channel card stop wearing the channel's brand colour.
 *
 * The accent belongs to the card: it tints the top hairline, the hover border
 * and the state pill, and those are what identify the channel at a glance. Ten
 * buttons repeating that same hue stops reading as identity and starts reading
 * as decoration — and on a card whose accent is a pale yellow or a dark green,
 * "Claim credits" came out looking like a different product. So the controls
 * are neutral and the card keeps the colour. The sweep below still picks the
 * accent up on hover, which is where it does its job: it is a response to the
 * pointer rather than a static fill.
 *
 * The primary tone is the one exception, because a filled button has to read as
 * the actionable one, and a grey fill would not.
 */
.dsm-xdpool-cpool-card .dsm-xdpool-btn:not([data-tone="primary"]):hover:not(:disabled){border-color:var(--dsw-alias-border-l2,#36373b);background:color-mix(in srgb, var(--dsw-alias-bg-layer-3,#2a2c33) 70%, transparent)}
.dsm-xdpool-cpool-card .dsm-xdpool-cpool-fold:hover:not(:disabled),.dsm-xdpool-cpool-card .dsm-xdpool-cpool-fold[aria-expanded=true]{border-color:var(--dsw-alias-border-l2,#36373b)}
.dsm-xdpool-cpool-card .dsm-xdpool-cpool-fold:hover:not(:disabled){background:color-mix(in srgb, var(--dsw-alias-label-primary,#f2f3f5) 7%, transparent)}
.dsm-xdpool-cpool-card .dsm-xdpool-minibtn:hover:not(:disabled){border-color:var(--dsw-alias-border-l2,#36373b);background:color-mix(in srgb, var(--dsw-alias-label-primary,#f2f3f5) 6%, transparent)}
.dsm-xdpool-btn[data-tone="primary"]{border-color:transparent;background:color-mix(in srgb, var(--dsw-alias-brand-primary,#5686fe) 82%, #ffffff 4%);color:#0d1014;font-weight:640}
.dsm-xdpool-btn[data-tone="primary"]:hover:not(:disabled){background:color-mix(in srgb, var(--dsw-alias-brand-primary,#5686fe) 94%, #ffffff 6%);color:#0d1014}
.dsm-xdpool-btn[data-tone="quiet"]{border-color:transparent;background:transparent;color:var(--dsw-alias-label-secondary,#c9ccd1);font-weight:500}
.dsm-xdpool-btn[data-tone="claimed"]{border-color:var(--dsw-alias-border-l2,#36373b);background:transparent;color:var(--dsw-alias-label-tertiary,#9aa0a8);font-weight:600;cursor:default}
@media (prefers-reduced-motion: reduce){
.dsm-xdpool-cpool-card,.dsm-xdpool-cpool-card:hover,.dsm-xdpool-cpool-fold,.dsm-xdpool-cpool-fold:active:not(:disabled){transition:none;transform:none}
.dsm-xdpool-cpool-card:hover .dsm-xdpool-tile{transition:none;transform:none}
}
/* One lane. The colour variables are injected inline by regionCardStyle(); the
   fallbacks here keep the card legible if that call is ever dropped.

   The SHELL is deliberately identical to the login-channel card below in this
   file: same 13px radius, same 12px/13px/12px/15px padding, same translucent
   layer-3 fill, same 5px gap. The user asked for the account pool to be the
   same size as the login page, and "same size" has to mean the same shell -
   three numbers carry it, and if one drifts the two pages stop reading as the
   same object. Only the colour differs. */
.dsm-xdpool-region{--dsm-xdpool-region-accent:var(--dsw-alias-brand-primary,#5686fe);position:relative;display:flex;flex-direction:column;gap:5px;padding:12px 13px 12px 15px;overflow:hidden;border:1px solid var(--dsw-alias-border-l2,#36373b);border-radius:13px;background:color-mix(in srgb, var(--dsw-alias-bg-layer-3,#2a2c33) 80%, transparent);box-shadow:inset 0 1px 0 rgb(255 255 255 / 6%), 0 1px 2px rgb(0 0 0 / 6%);transition:border-color .2s ease,box-shadow .24s ease,transform .22s cubic-bezier(.32,.72,0,1)}
/* The accent hairline across the top, in the lane's own colour, is what welds
   the two pages into one family at a glance. Error breaks the lane's colour,
   because a red hairline beside a purple one is the only place the failure
   stays visible once the card has scrolled below the fold. */
.dsm-xdpool-region::before{content:"";position:absolute;left:0;top:0;right:0;height:2px;background:linear-gradient(90deg,var(--dsm-xdpool-region-accent,#5686fe),color-mix(in srgb,var(--dsm-xdpool-region-accent,#5686fe) 30%,transparent));opacity:.85}
.dsm-xdpool-region[data-state="error"]::before{background:linear-gradient(90deg,var(--dsw-alias-state-error-primary,#ef4444),transparent)}
/* The card enters on one short upward ease. One animation, not one per child:
   staggered children make a settings panel feel like a loading screen. */
.dsm-xdpool-region-in{animation:dsm-xdpool-region-in .32s var(--ease-instrument, cubic-bezier(.16,1,.3,1)) both}
@keyframes dsm-xdpool-region-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
@media (prefers-reduced-motion:reduce){.dsm-xdpool-region-in{animation:none}}
/* Tile, titles, state pill. Centred, not flex-start: the reference build's
   ".ofm_chanhead" aligns its three parts on one optical line, and a top-aligned
   head put the pill above the tile's midline beside a 40px logo. */
.dsm-xdpool-region-head{display:flex;align-items:center;gap:11px}
/* The glyph is a MASK, not a background-image: hovering the tile rotates the
   glyph, and if the glyph were painted as a background the gradient would be
   repainted with it and the animation would stutter. */
.dsm-xdpool-region:hover .dsm-xdpool-tile{transform:translateY(-1px) rotate(-4deg);box-shadow:inset 0 1px 0 rgb(255 255 255 / 26%),inset 0 -1px 2px rgb(0 0 0 / 20%),0 8px 18px color-mix(in srgb,var(--dsm-xdpool-tile-accent,#5686fe) 34%,transparent)}
.dsm-xdpool-region-titles{flex:1 1 auto;min-width:0}
/* 14px / 700 / -.2px, the reference build's ".ofm_chanid b". The lane is a
   supplier the user signs into, so it reads at the same weight as a channel
   name on the login page rather than as a section heading. */
.dsm-xdpool-region-title{display:block;font-size:14px;font-weight:700;letter-spacing:-.2px;color:var(--dsw-alias-label-primary,#e8e8ea);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* "腾讯 · copilot.tencent.com" — the vendor, then the host it publishes, because
   those two are what the user is looking for when two lanes both say "Tencent".
   Tertiary, 11px, ".ofm_chanid span". */
.dsm-xdpool-region-sub{display:block;margin-top:2px;font-size:11px;line-height:1.4;color:var(--dsw-alias-label-tertiary,#8a90a0);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* Three states, three meanings: healthy / every account cooling / the status
   document could not be read. "No accounts" is NOT one of them; that reads as
   the copy under the pill, not as a health colour.

   This is the login-channel list's badge in the reference build (the class
   ".ofm_poolbadge" there) rather than a pill I invented: 999px radius, 6px/14px
   padding, 8px gap, a translucent
   layer-1 fill and an inset top highlight, copied value for value. It carries a
   dot as well as a word, because a colour on its own is unreadable for anyone
   who cannot separate the tint from the surface, and "cooling" must never be
   told from "connected" by hue alone. */
.dsm-xdpool-region-state{flex:none;display:inline-flex;align-items:center;gap:8px;padding:6px 14px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1,#ffffff14);background:color-mix(in srgb, var(--dsw-alias-bg-layer-1,#191a1e) 72%, transparent);box-shadow:inset 0 1px 0 rgb(255 255 255 / 4%);font-size:12.5px;font-weight:650;white-space:nowrap;color:var(--dsw-alias-label-secondary,#c6c9d0)}
.dsm-xdpool-region-state::before{content:"";width:8px;height:8px;flex:none;border-radius:50%;background:currentColor}
/* Each state tints the badge's OWN fill. A coloured box-shadow RING was the
   earlier treatment and it read as a notification rather than as a status.
   Cooling stays neutral grey on purpose: grey means "waiting", and painting it
   green or red would assert something the card has not measured. */
.dsm-xdpool-region[data-state="ok"] .dsm-xdpool-region-state{color:var(--dsw-alias-state-success-primary,#22a06b);border-color:color-mix(in srgb, var(--dsw-alias-state-success-primary,#22a06b) 34%, transparent);background:color-mix(in srgb, var(--dsw-alias-state-success-primary,#22a06b) 11%, transparent)}
.dsm-xdpool-region[data-state="cooling"] .dsm-xdpool-region-state{color:var(--dsw-alias-label-secondary,#c6c9d0);border-color:var(--dsw-alias-border-l1,#ffffff14);background:color-mix(in srgb, var(--dsw-alias-bg-layer-1,#191a1e) 72%, transparent)}
.dsm-xdpool-region[data-state="error"] .dsm-xdpool-region-state{color:var(--dsw-alias-state-error-primary,#ef4444);border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary,#ef4444) 34%, transparent);background:color-mix(in srgb, var(--dsw-alias-state-error-primary,#ef4444) 11%, transparent)}
/* One line, clamped to two. A card that grows with its copy stops being a
   card, and a 40px tile beside four wrapped lines reads as a broken layout.

   This is what the lane actually IS, in Chinese, from the channel roster: what
   the free line covers and what it costs. The reference build's ".ofm_note" is
   11px tertiary for the same reason — it is context, not a claim, and it must
   not compete with the figures above it. */
.dsm-xdpool-region-note{font-size:11px;line-height:1.5;color:var(--dsw-alias-label-tertiary,#8a90a0);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
/* Three figures in ONE quiet line: the label is a dim noun, the number beside it
   is the loud part.

   This replaced three recessed tiles (the reference build's ".ofm_stat" look).
   The user asked for the account-pool card to match the reference build's
   channel card, and there the figures are ".ofm_chanmeta": a wrapped flex line
   of "label <b>number</b>" pairs, 11.5px, tertiary labels, secondary numbers.
   The tile version read as three more boxes competing with the brand tile above
   them, and it gave a 7.1K credit balance more weight than the note explaining
   what it buys.

   Label BEFORE number, because that is what the reference build does and the
   user's screenshot shows: "账号 4/4", not "4/4 账号". */
.dsm-xdpool-region-stats{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;font-size:11.5px;line-height:16px;color:var(--dsw-alias-label-tertiary,#8a90a0)}
.dsm-xdpool-region-stat{display:inline-flex;align-items:baseline;gap:5px;min-width:0}
.dsm-xdpool-region-num{font-weight:650;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary,#c6c9d0);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* "Not measured" is dimmer than a measured figure, including a measured zero.
   A gateway that never answered has not spent nothing; it has told us nothing. */
.dsm-xdpool-region-num[data-tone="quiet"]{color:var(--dsw-alias-label-dimmed,#8a90a0)}
.dsm-xdpool-region-label{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* The button row. The reference build's ".ofm_chanacts" is a left-aligned
   wrapping row with no space-between, and that is the shape here: the segmented
   disclosure is part of the row, not pinned to the right edge. It wraps as a
   WHOLE, because one line squeezing three buttons plus a segmented control into
   510px is how the control that used to sit at the right end ends up
   overlapping the leftmost button. */
.dsm-xdpool-region-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dsm-xdpool-region-btns{display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0}
/* The three outlined actions. Sized by content rather than by a column track, so
   a short label like "Clear cooldown" and a long one like "Refresh models"
   both fit without a fixed width that the narrower of the two would have to
   stretch to. */
.dsm-xdpool-region-btn{flex:0 1 auto;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* The segmented disclosure: a recessed groove, so the open half reads as
   raised rather than tinted. */
.dsm-xdpool-region-seg{display:inline-flex;align-items:center;gap:2px;padding:3px;border-radius:10px;background:color-mix(in srgb, var(--dsw-alias-bg-layer-1,#191a1e) 70%, transparent);border:1px solid var(--dsw-alias-border-l1,#2f3035);flex:none}
.dsm-xdpool-region-seg-btn{appearance:none;display:inline-flex;align-items:center;gap:5px;padding:5px 11px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#c6c9d0);font:inherit;font-size:11.5px;font-weight:600;line-height:16px;cursor:pointer;transition:background .18s ease,color .18s ease,box-shadow .2s ease,transform .18s var(--ease-instrument, cubic-bezier(.16,1,.3,1))}
.dsm-xdpool-region-seg-btn:hover{background:color-mix(in srgb, var(--dsm-xdpool-region-accent,#5686fe) 14%, transparent);color:var(--dsw-alias-label-primary,#e8e8ea)}
/* Inside a 3px groove the default 2px outline offset escapes the groove and
   draws over the card border, so the ring is pulled IN here. */
.dsm-xdpool-region-seg-btn:focus-visible{outline:2px solid var(--dsm-xdpool-region-accent,#5686fe);outline-offset:-2px;box-shadow:none}
.dsm-xdpool-region-seg-btn[aria-expanded="true"]{background:var(--dsw-alias-bg-layer-3,#0f1013);color:var(--dsw-alias-label-primary,#e8e8ea);box-shadow:0 1px 3px rgb(0 0 0 / 14%)}
.dsm-xdpool-region-seg-btn[aria-expanded="true"] .dsm-xdpool-region-seg-glyph{opacity:1}
.dsm-xdpool-region-seg-btn:disabled{opacity:.4;filter:saturate(.35);cursor:default;transform:none}
.dsm-xdpool-region-seg-btn:disabled:hover{transform:none;background:transparent;color:var(--dsw-alias-label-secondary,#c6c9d0)}
.dsm-xdpool-region-seg-glyph{font-size:9px;line-height:1;opacity:.72;transition:opacity .18s ease,transform .22s var(--ease-settle, cubic-bezier(.34,1.4,.4,1))}
.dsm-xdpool-region-seg-btn:hover .dsm-xdpool-region-seg-glyph{transform:scale(1.12)}
.dsm-xdpool-region-seg-text{white-space:nowrap}
.dsm-xdpool-region-seg-count{font-size:10.5px;font-weight:600;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-dimmed,#8a90a0)}
/* hidden, never max-height:0. A collapsed panel whose height is animated to
   zero CLIPS the focus ring of everything inside it, so the first Tab after
   expanding lands somewhere invisible. */
.dsm-xdpool-region-pane{margin-top:10px;padding-top:10px;border-top:1px dashed var(--dsw-alias-border-l1,#2f3035)}
.dsm-xdpool-region-pane[hidden]{display:none}
.dsm-xdpool-region-pane-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:8px}
.dsm-xdpool-region-pane-title{font-size:12px;font-weight:650;letter-spacing:.1px;color:var(--dsw-alias-label-primary,#e8e8ea)}
/* The CN-only tools: two triggers for the two panels that only exist there. */
.dsm-xdpool-region-cntools{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.dsm-xdpool-region-tool{appearance:none;display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border:1px solid var(--dsw-alias-border-l2,#36373b);border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#c6c9d0);font:inherit;font-size:11px;font-weight:600;line-height:16px;cursor:pointer;transition:border-color .18s ease,color .18s ease,background .18s ease,transform .18s var(--ease-instrument, cubic-bezier(.16,1,.3,1))}
.dsm-xdpool-region-tool:hover:not(:disabled){border-color:color-mix(in srgb, var(--dsm-xdpool-region-accent,#5686fe) 60%, transparent);color:var(--dsw-alias-label-primary,#e8e8ea);background:color-mix(in srgb, var(--dsm-xdpool-region-accent,#5686fe) 9%, transparent)}
.dsm-xdpool-region-tool:focus-visible{outline:2px solid var(--dsm-xdpool-region-accent,#5686fe);outline-offset:2px;box-shadow:0 0 0 4px color-mix(in srgb, var(--dsm-xdpool-region-accent,#5686fe) 13%, transparent)}
.dsm-xdpool-region-tool[aria-expanded="true"]{border-color:color-mix(in srgb, var(--dsm-xdpool-region-accent,#5686fe) 70%, transparent);color:var(--dsw-alias-label-primary,#e8e8ea);background:color-mix(in srgb, var(--dsm-xdpool-region-accent,#5686fe) 13%, transparent)}
.dsm-xdpool-region-tool:disabled{opacity:.4;filter:saturate(.35);cursor:default;transform:none}
.dsm-xdpool-region-tool:disabled:hover{transform:none;background:transparent;border-color:var(--dsw-alias-border-l2,#36373b);color:var(--dsw-alias-label-secondary,#c6c9d0)}
.dsm-xdpool-region-tool-caret{font-size:9px;line-height:1;opacity:.7;transition:transform .2s var(--ease-instrument, cubic-bezier(.16,1,.3,1))}
.dsm-xdpool-region-tool[aria-expanded="true"] .dsm-xdpool-region-tool-caret{transform:rotate(90deg)}
/* The chosen value sits at the end of the trigger, dimmed, so a collapsed
   trigger still answers "which mode is this card on?" without being opened. */
.dsm-xdpool-region-tool-value{margin-left:auto;padding-left:8px;font-size:11px;color:var(--dsw-alias-label-dimmed,#8a90a0);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsm-xdpool-region-tool[aria-expanded="true"] .dsm-xdpool-region-tool-value{color:var(--dsw-alias-label-secondary,#c6c9d0)}
/* An empty pane says so here rather than rendering nothing: a disclosure that
   opens onto blank space reads as a broken control. */
.dsm-xdpool-region-empty{margin:0;font-size:11.5px;line-height:1.6;color:var(--dsw-alias-label-tertiary,#8a90a0)}
/* A busy button keeps its WIDTH. Swapping the label for a spinner-sized box
   reflows the row and shoves the segmented control sideways mid-click. */
.dsm-xdpool-region-btn[aria-busy="true"]{position:relative;padding-left:26px;cursor:progress;pointer-events:none}
.dsm-xdpool-region-btn[aria-busy="true"]::before{content:"";position:absolute;left:10px;top:50%;width:11px;height:11px;margin-top:-5.5px;border:1.6px solid color-mix(in srgb, currentColor 28%, transparent);border-top-color:currentColor;border-radius:50%;animation:dsm-xdpool-region-spin .7s linear infinite}
@keyframes dsm-xdpool-region-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.dsm-xdpool-region-btn[aria-busy="true"]::before{animation-duration:1.6s}}
/* Inside a 510px column the shared two-column stats grid is crushed, so it is
   overridden HERE and only here: a selector scoped to .region cannot leak into
   the aggregate and relay pages that use the same classes at full width. */
/* The account card sits inside a lane card about 510px wide. The figures line is
   a wrapping row, so the only thing the narrow column still needs is the room to
   wrap: no grid columns and no left divider to inherit from the wider pages that
   share these class names. */
.dsm-xdpool-region .dsm-xdpool-stats{gap:8px 14px}
.dsm-xdpool-region .dsm-xdpool-usage-head{flex-wrap:wrap;row-gap:8px}
.dsm-xdpool-region .dsm-xdpool-usage-actions{flex:1 1 100%;justify-content:flex-start}
@media (max-width:900px){
  /* The figure row tightens its gap on the way down. It gets its own 900px block
     rather than joining the 760px one: the layout test's mediaRule helper takes the
     FIRST 760px query in the region slice, and that has to stay the one holding the
     button groups. */
  .dsm-xdpool-region-stats{gap:12px}
}
@media (max-width:760px){
  /* Each group takes its own line instead of sharing one, and the two halves of
     the segmented control split it evenly, so neither can push the other out
     of the card at the narrowest width the host dialog reaches. */
  .dsm-xdpool-region-btns{flex:1 1 100%}
  .dsm-xdpool-region-btns .dsm-btn{flex:1 1 0;min-width:0}
  .dsm-xdpool-region-seg{width:100%}
  .dsm-xdpool-region-seg-btn{flex:1 1 0;min-width:0;justify-content:center}
  .dsm-xdpool-region-cntools{flex:1 1 100%}
  .dsm-xdpool-region-tool{flex:1 1 0;min-width:0;justify-content:center}
}

`.trim()

export const AGGREGATE_CARD_CSS = `

.dsm-xdpool-agg{display:flex;flex-direction:column;gap:10px;min-width:0}
.dsm-xdpool-agg-pill{display:inline-flex;align-items:center;padding:2px 9px;border-radius:999px;font-size:11px;line-height:17px;white-space:nowrap;border:1px solid var(--dsw-alias-border-l2,#36373b);color:var(--dsw-alias-label-secondary,#c6c9d0)}
.dsm-xdpool-agg-pill[data-tone="ok"]{border-color:color-mix(in oklab, var(--dsw-alias-state-success-primary,#22a06b) 45%, transparent);color:var(--dsw-alias-state-success-primary,#22a06b)}
.dsm-xdpool-agg-pill[data-tone="off"]{border-color:color-mix(in oklab, var(--dsw-alias-label-tertiary,#8a90a0) 40%, transparent);color:var(--dsw-alias-label-tertiary,#8a90a0)}
.dsm-xdpool-agg-pill[data-tone="info"]{border-color:color-mix(in srgb, var(--dsw-alias-brand-primary,#5686fe) 38%, transparent);color:var(--dsw-alias-brand-primary,#5686fe)}
.dsm-xdpool-agg-lanebar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 10px;border-radius:8px;background:color-mix(in oklab, var(--dsw-alias-state-business-primary,#5686fe) 6%, transparent);border:1px solid var(--dsw-alias-border-l2,#36373b)}
.dsm-xdpool-agg-hint{color:var(--dsw-alias-label-tertiary,#8a90a0);font-size:11px;line-height:17px}
.dsm-xdpool-agg-filter{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dsm-xdpool-agg-list{display:flex;flex-direction:column;gap:8px;min-width:0}
.dsm-xdpool-agg-row{position:relative;display:flex;flex-direction:column;gap:5px;padding:12px 13px 12px 15px;border-radius:13px;border:1px solid var(--dsw-alias-border-l2,#36373b);background:color-mix(in srgb, var(--dsw-alias-bg-layer-3,#2a2c33) 80%, transparent);box-shadow:inset 0 1px 0 rgb(255 255 255 / 6%), 0 1px 2px rgb(0 0 0 / 6%);transition:transform .2s cubic-bezier(.32,.72,0,1),box-shadow .24s ease,border-color .18s ease}
.dsm-xdpool-agg-row::before{content:"";position:absolute;left:0;top:10px;bottom:10px;width:3px;border-radius:0 3px 3px 0;background:var(--dsm-xdpool-agg-accent,#5686fe);opacity:.85}
.dsm-xdpool-agg-row:hover{transform:translateY(-2px);border-color:color-mix(in srgb, var(--dsw-alias-brand-primary,#5686fe) 66%, var(--dsw-alias-border-l2,#36373b));box-shadow:inset 0 1px 0 rgb(255 255 255 / 9%), 0 16px 34px color-mix(in srgb, var(--dsw-alias-brand-primary,#5686fe) 12%, transparent)}
.dsm-xdpool-agg-row:hover .dsm-xdpool-tile{transform:translateY(-1px) rotate(-4deg)}
/* "Off" is dimmed rather than greyed out: a vendor that is not in the pool is
   still one the user may want, and a row they cannot read is a row they
   cannot judge. */
.dsm-xdpool-agg-row[data-off="true"]{opacity:.68}
.dsm-xdpool-agg-row[data-open="true"]{border-color:color-mix(in srgb, var(--dsm-xdpool-agg-accent,#5686fe) 52%, var(--dsw-alias-border-l2,#36373b))}
.dsm-xdpool-agg-rowhead{display:flex;align-items:center;gap:9px;flex-wrap:wrap;min-width:0}
.dsm-xdpool-agg-titles{flex:1 1 180px;display:flex;flex-direction:column;gap:1px;min-width:0}
.dsm-xdpool-agg-name{font-size:13.5px;line-height:19px;font-weight:650;letter-spacing:-.1px;color:var(--dsw-alias-label-primary,#e8e8ea);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsm-xdpool-agg-org{color:var(--dsw-alias-label-tertiary,#8a90a0);font-size:11px;line-height:16px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* The state pill is a word and a colour together, never a colour alone. */
.dsm-xdpool-agg-state{flex:none;display:inline-flex;align-items:center;gap:5px;margin-left:auto;padding:2px 9px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,#36373b);color:var(--dsw-alias-label-secondary,#c6c9d0);font-size:10.5px;line-height:16px;white-space:nowrap}
.dsm-xdpool-agg-state::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}
.dsm-xdpool-agg-state[data-tone="ok"]{border-color:color-mix(in oklab, var(--dsw-alias-state-success-primary,#22a06b) 45%, transparent);color:var(--dsw-alias-state-success-primary,#22a06b)}
.dsm-xdpool-agg-state[data-tone="off"]{border-color:color-mix(in oklab, var(--dsw-alias-label-tertiary,#8a90a0) 40%, transparent);color:var(--dsw-alias-label-tertiary,#8a90a0)}
/* The vendor's own description. Clamped to two lines because the longest entry
   in the registry runs to 259 characters and a full-height paragraph pushes the
   next dozen rows off the screen. */
.dsm-xdpool-agg-note{margin:0;color:var(--dsw-alias-label-secondary,#c6c9d0);font-size:11px;line-height:17px;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}
.dsm-xdpool-agg-foot{display:flex;align-items:center;gap:9px;flex-wrap:wrap;min-width:0}
.dsm-xdpool-agg-foot .dsm-xdpool-agg-tags{flex:1 1 200px;min-width:0}
.dsm-xdpool-agg-open{appearance:none;display:inline-flex;align-items:center;gap:6px;margin-left:auto;flex:none;padding:4px 12px;border-radius:8px;border:1px solid color-mix(in srgb, var(--dsw-alias-border-l2,#36373b) 85%, transparent);background:color-mix(in srgb, var(--dsw-alias-bg-layer-3,#2a2c33) 70%, transparent);color:var(--dsw-alias-label-secondary,#c6c9d0);font:inherit;font-size:11.5px;font-weight:560;line-height:17px;white-space:nowrap;cursor:pointer;transition:border-color .16s ease,color .16s ease,background .16s ease,transform .18s cubic-bezier(.16,1,.3,1)}
.dsm-xdpool-agg-open:hover{border-color:color-mix(in srgb, var(--dsm-xdpool-agg-accent,#5686fe) 55%, var(--dsw-alias-border-l2,#36373b));color:var(--dsw-alias-label-primary,#e8e8ea);transform:translateY(-1px)}
.dsm-xdpool-agg-open:active{transform:translateY(0);box-shadow:inset 0 2px 4px rgb(0 0 0 / 22%)}
.dsm-xdpool-agg-open:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:2px}
.dsm-xdpool-agg-open-caret{width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;border-top:5px solid currentColor;transition:transform .2s cubic-bezier(.34,1.4,.4,1)}
.dsm-xdpool-agg-open[aria-expanded="true"] .dsm-xdpool-agg-open-caret{transform:rotate(180deg)}
/* The "hidden" attribute, never "max-height:0": a collapsed pane that clips
   its own box cuts the focus ring off the first field when the user tabs
   into it. */
.dsm-xdpool-agg-pane{display:flex;flex-direction:column;gap:8px;margin-top:3px;padding-top:9px;border-top:1px dashed color-mix(in srgb, var(--dsw-alias-border-l2,#36373b) 75%, transparent)}
.dsm-xdpool-agg-pane[hidden]{display:none}
.dsm-xdpool-agg-switch{align-self:flex-start}
.dsm-xdpool-agg-warn{margin:0;color:var(--dsw-alias-state-warning-primary,#e8a33d);font-size:11px;line-height:17px}
.dsm-xdpool-agg-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px}
.dsm-xdpool-agg-field{display:flex;flex-direction:column;gap:3px;min-width:0}
.dsm-xdpool-agg-field span{color:var(--dsw-alias-label-tertiary,#8a90a0);font-size:11px;line-height:16px}
.dsm-xdpool-agg-field input{padding:6px 10px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2,#36373b);background:color-mix(in srgb, var(--dsw-alias-bg-layer-1,#191a1e) 78%, transparent);box-shadow:inset 0 1px 2px rgb(0 0 0 / 5%);color:var(--dsw-alias-label-primary,#e8e8ea);font:inherit;font-size:12px;transition:border-color .16s ease,box-shadow .16s ease}
.dsm-xdpool-agg-field input:focus{outline:none;border-color:var(--dsw-alias-brand-primary,#5686fe);box-shadow:0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary,#5686fe) 20%, transparent)}
.dsm-xdpool-agg-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.dsm-xdpool-agg-models{margin:0;color:var(--dsw-alias-label-tertiary,#8a90a0);font-size:11px;line-height:17px;word-break:break-word}
.dsm-xdpool-agg-facts{display:flex;flex-direction:column;gap:1px;min-width:0;margin:7px 0 0;padding:0;list-style:none}
.dsm-xdpool-agg-fact{display:flex;flex-direction:column;min-width:0;padding:5px 8px;border-radius:8px;background:color-mix(in srgb, var(--dsw-alias-bg-layer-1,#191a1e) 55%, transparent)}
.dsm-xdpool-agg-fact:nth-child(even){background:color-mix(in srgb, var(--dsw-alias-bg-layer-1,#191a1e) 30%, transparent)}
.dsm-xdpool-agg-fact-name{display:block;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11.5px;line-height:16px;color:var(--dsw-alias-label-secondary,#c3c7d4);font-weight:600}
.dsm-xdpool-agg-fact[data-live="true"] .dsm-xdpool-agg-fact-name::after{content:"";display:inline-block;width:5px;height:5px;margin-left:6px;border-radius:50%;vertical-align:middle;background:var(--dsw-alias-state-success-primary,#22a06b)}
/* The free pill on a fact row. The name is a truncating nowrap block, so the
   pill has to sit inside it and shrink to nothing rather than push the name out
   of the row; it is the same tag the channel cards use, only re-sized down to a
   caption. */
.dsm-xdpool-agg-fact-name .dsm-xdpool-cpool-tag{display:inline-block;margin-left:6px;vertical-align:middle;padding:0 5px;font-size:9.5px;font-weight:600;line-height:14px}
.dsm-xdpool-agg-fact .dsm-xdpool-mfacts{margin-top:1px}
.dsm-xdpool-agg-fact .dsm-xdpool-mfacts-probe,.dsm-xdpool-agg-fact .dsm-xdpool-mfacts-result{margin-left:0}
.dsm-xdpool-agg-flash{margin:0;padding:5px 9px;border-radius:6px;background:color-mix(in oklab, var(--dsw-alias-label-primary,#e8e8ea) 5%, transparent);color:var(--dsw-alias-label-secondary,#c6c9d0);font-size:11px;line-height:17px;word-break:break-word}
/* The per-vendor model chooser. Sits below the action row and above the id
   summary, and reads as a nested panel rather than a second list: its border is
   the vendor accent at low opacity, which is the same device the pool and
   channel cards use for a card inside a card. */
.dsm-xdpool-agg-picker{display:flex;flex-direction:column;gap:6px;min-width:0;margin:9px 0 0;padding:9px 10px;border:1px solid color-mix(in srgb, var(--dsm-xdpool-agg-accent,#8a90a0) 26%, transparent);border-radius:10px;background:color-mix(in srgb, var(--dsw-alias-bg-layer-1,#191a1e) 45%, transparent)}
.dsm-xdpool-agg-pickerhead{display:flex;align-items:center;gap:8px;min-width:0}
.dsm-xdpool-agg-pickerlabel{min-width:0;flex:1 1 auto;font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-secondary,#c3c7d4);font-weight:600}
.dsm-xdpool-agg-picker .dsm-xdpool-agg-hint{margin:0}
.dsm-xdpool-agg-modellist{display:flex;flex-direction:column;gap:1px;min-width:0;margin:0;padding:0;list-style:none;max-height:260px;overflow-y:auto;overscroll-behavior:contain}
.dsm-xdpool-agg-modelrow{display:flex;align-items:baseline;gap:8px;min-width:0;padding:3px 6px;border-radius:7px}
.dsm-xdpool-agg-modelrow:hover{background:color-mix(in srgb, var(--dsw-alias-bg-layer-1,#191a1e) 62%, transparent)}
.dsm-xdpool-agg-modelrow label{display:flex;align-items:baseline;gap:7px;min-width:0;flex:1 1 auto;cursor:pointer}
.dsm-xdpool-agg-modelrow input[type="checkbox"]{flex:0 0 auto;margin:0;align-self:center}
.dsm-xdpool-agg-modelid{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,#c3c7d4)}
/* An unticked row is still a real model the vendor serves, so it dims rather
   than disappearing: the user has to be able to see what they removed. */
.dsm-xdpool-agg-modelrow:has(input:not(:checked)) .dsm-xdpool-agg-modelid{color:var(--dsw-alias-label-tertiary,#8a90a0)}
.dsm-xdpool-agg-modelrow .dsm-xdpool-mfacts{flex:0 1 auto;margin-left:auto}
/* The search box sits on an accent-tinted border on focus rather than a sweep:
   a text field must not light up under the cursor, or every character typed
   would look like a press. */
.dsm-xdpool-agg-picker .dsm-xdpool-cpool-searchbox{--dsm-xdpool-cpool-accent:var(--dsm-xdpool-agg-accent,#8a90a0)}
.dsm-xdpool-agg-modelrow .dsm-xdpool-mfacts-probe,.dsm-xdpool-agg-modelrow .dsm-xdpool-mfacts-result{margin-left:0}
.dsm-xdpool-agg-pickeracts{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding-top:1px}
@media (max-width:760px){
  .dsm-xdpool-agg-fields{grid-template-columns:1fr}
  .dsm-xdpool-agg-foot .dsm-xdpool-agg-tags{flex:1 1 100%}
  .dsm-xdpool-agg-open{margin-left:0;flex:1 1 100%;justify-content:center}
  .dsm-xdpool-agg-state{margin-left:auto}
}

`.trim()

export const CHANNEL_CARD_CSS = `

.dsm-xdpool-channels{display:flex;flex-direction:column;gap:8px;min-width:0}
/* The brand tile itself lives in SHARED_CARD_CSS: the pool's region cards and
   the aggregate rows render it too, and neither page loads this sheet. Keeping
   it here is why those two pages showed a bare 40px gap where the logo should
   be. Only the channel row's own hover belongs to this page. */
/* The channel action button, its hover/active/focus/disabled states and the
   reduced-motion opt-out live in SHARED_CARD_CSS. They used to sit here, and
   that is exactly the bug the account pool kept showing: four pages render
   ".dsm-xdpool-btn" but only this one loads this sheet, so on the pool and the
   aggregate page the claim and refresh controls fell back to bare browser
   buttons — no radius, no padding, no tone. The shell is the only component
   every page renders inside, which is where a primitive shared by four of them
   has to be declared. */
.dsm-xdpool-channel:hover .dsm-xdpool-tile{transform:translateY(-1px) rotate(-4deg);box-shadow:inset 0 1px 0 rgb(255 255 255 / 26%),inset 0 -1px 2px rgb(0 0 0 / 20%),0 8px 18px color-mix(in srgb,var(--dsm-xdpool-tile-accent,#5686fe) 30%,transparent)}
.dsm-xdpool-channel{position:relative;display:flex;flex-direction:column;gap:5px;padding:12px 13px 12px 15px;border-radius:13px;border:1px solid var(--dsw-alias-border-l2,#36373b);background:color-mix(in srgb, var(--dsw-alias-bg-layer-3,#2a2c33) 80%, transparent);box-shadow:inset 0 1px 0 rgb(255 255 255 / 6%), 0 1px 2px rgb(0 0 0 / 6%);transition:transform .2s cubic-bezier(.32,.72,0,1),box-shadow .24s ease,border-color .18s ease}
.dsm-xdpool-channel:hover{transform:translateY(-2px);border-color:color-mix(in srgb, var(--dsw-alias-brand-primary,#5686fe) 66%, var(--dsw-alias-border-l2,#36373b));box-shadow:inset 0 1px 0 rgb(255 255 255 / 9%), 0 16px 34px color-mix(in srgb, var(--dsw-alias-brand-primary,#5686fe) 12%, transparent)}
.dsm-xdpool-channel::before{content:"";position:absolute;left:0;top:10px;bottom:10px;width:3px;border-radius:0 3px 3px 0;background:var(--dsm-xdpool-channel-accent,#5686fe);opacity:.85}
.dsm-xdpool-channel-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
.dsm-xdpool-channel-name{font-size:13.5px;line-height:19px;font-weight:650;letter-spacing:-.1px;color:var(--dsw-alias-label-primary,#e8e8ea);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsm-xdpool-channel-org{color:var(--dsw-alias-label-tertiary,#8a90a0);font-size:11px;line-height:16px}
.dsm-xdpool-channel-tag{margin-left:auto;display:inline-flex;align-items:center;padding:1px 8px;border-radius:999px;font-size:10px;line-height:16px;white-space:nowrap;border:1px solid color-mix(in oklab, var(--dsw-alias-state-success-primary,#22a06b) 45%, transparent);color:var(--dsw-alias-state-success-primary,#22a06b)}
.dsm-xdpool-channel-note{margin:0;color:var(--dsw-alias-label-secondary,#c6c9d0);font-size:11px;line-height:17px}
.dsm-xdpool-channel-owned{margin:0;color:var(--dsw-alias-label-tertiary,#8a90a0);font-size:11px;line-height:17px;font-style:italic}
.dsm-xdpool-channel-actions{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
/* The auto-claim row is a setting, not a channel, so it sits on its own line
   under the hero instead of borrowing a channel card's shell. It reuses the
   shared switch so it reads as the same control family as the aggregate page. */
.dsm-xdpool-autocheckin{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:9px 12px;border:1px solid var(--dsw-alias-border-l2,#36373b);border-radius:11px;background:color-mix(in srgb, var(--dsw-alias-bg-layer-3,#2a2c33) 60%, transparent)}
.dsm-xdpool-autocheckin-note{font-size:11px;line-height:17px;color:var(--dsw-alias-label-tertiary,#8a90a0);min-width:0}
/* Advice that belongs beside a button rather than in a card body. */
.dsm-xdpool-channel-hint{font-size:11px;line-height:17px;color:var(--dsw-alias-label-tertiary,#8a90a0)}
.dsm-xdpool-channel-waiting{color:var(--dsw-alias-state-business-primary,#5686fe);font-size:11px;line-height:17px}
.dsm-xdpool-channel-ok{color:var(--dsw-alias-state-success-primary,#22a06b);font-size:11px;line-height:17px;font-weight:600}
.dsm-xdpool-channel-error{color:var(--dsw-alias-state-error-primary,#e5534b);font-size:11px;line-height:17px;word-break:break-word}
/* The per-model facts and the connectivity test, from the same component the
   aggregate and pool pages use. A signed-in channel contributes nothing here
   until it has models, so the list appearing is itself the sign-in signal —
   there is no separate empty state to keep in step with this. */
.dsm-xdpool-channel-models{display:flex;flex-direction:column;gap:1px;min-width:0;margin:7px 0 0;padding:0;list-style:none}
.dsm-xdpool-channel-model{display:flex;flex-direction:column;min-width:0;padding:5px 8px;border-radius:8px;background:color-mix(in srgb, var(--dsw-alias-bg-layer-1,#191a1e) 55%, transparent)}
.dsm-xdpool-channel-model:nth-child(even){background:color-mix(in srgb, var(--dsw-alias-bg-layer-1,#191a1e) 30%, transparent)}
.dsm-xdpool-channel-model-name{display:block;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11.5px;line-height:16px;color:var(--dsw-alias-label-secondary,#c3c7d4);font-weight:600}
.dsm-xdpool-channel-model .dsm-xdpool-mfacts{margin-top:1px}
.dsm-xdpool-channel-model .dsm-xdpool-mfacts-probe,.dsm-xdpool-channel-model .dsm-xdpool-mfacts-result{margin-left:0}

`.trim()

export const SHELL_CSS = `

.dsm-xdpool-shell{--ease-instrument:cubic-bezier(.16,1,.3,1);--ease-settle:cubic-bezier(.34,1.4,.4,1);--gap:14px;position:relative;display:flex;flex-direction:column;gap:calc(var(--gap)*1.4);max-width:1080px;font-size:13px;line-height:1.55;color:var(--dsw-alias-label-primary,#e8e8ea);-webkit-font-smoothing:antialiased;box-sizing:border-box}
/* A 180px fractal-noise tile at 2.2% opacity. It is the same grain the sibling
   plugin lays over its root, and it exists for one reason: large flat dark
   panels read as plastic, and a whisper of noise makes them read as a
   surface. "position:absolute" (not "fixed") so it travels with the card
   instead of floating over the host dialog when the panel scrolls. */
.dsm-xdpool-shell::before{content:"";position:absolute;inset:0;z-index:0;pointer-events:none;opacity:.022;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23n)'/%3E%3C/svg%3E")}
.dsm-xdpool-shell *,.dsm-xdpool-shell *::before,.dsm-xdpool-shell *::after{box-sizing:border-box}
/* Scrollbars are part of the chrome here, not the host's: this card scrolls
   inside the settings dialog, and a default 15px bar eats a settings panel
   that is already narrow. "background-clip:padding-box" keeps the 2.5px
   transparent ring from painting over the thumb's own colour. */
.dsm-xdpool-shell ::-webkit-scrollbar{width:10px;height:10px}
.dsm-xdpool-shell ::-webkit-scrollbar-thumb{background:color-mix(in srgb, var(--dsw-alias-label-tertiary,#8a90a0) 32%, transparent);border-radius:99px;border:2.5px solid transparent;background-clip:padding-box}
.dsm-xdpool-shell ::-webkit-scrollbar-thumb:hover{background:color-mix(in srgb, var(--dsw-alias-label-tertiary,#8a90a0) 52%, transparent);background-clip:padding-box}
.dsm-xdpool-shell{scrollbar-width:thin;scrollbar-color:color-mix(in srgb, var(--dsw-alias-label-tertiary,#8a90a0) 32%, transparent) transparent}
.dsm-xdpool-shell ::selection{background:color-mix(in srgb, var(--dsw-alias-state-business-primary,#5686fe) 24%, transparent)}
/* One focus ring for the whole card. Every control below inherits it, so a
   rewrite of an individual button cannot invent a second, louder one. */
.dsm-xdpool-shell :focus-visible{outline:2px solid color-mix(in srgb, var(--dsw-alias-state-business-primary,#5686fe) 78%, transparent);outline-offset:2px;box-shadow:0 0 0 4px color-mix(in srgb, var(--dsw-alias-state-business-primary,#5686fe) 13%, transparent)}
.dsm-xdpool-glass{border:1px solid color-mix(in srgb, var(--dsw-alias-border-l2,#ffffff1f) 78%, transparent);border-radius:16px;background:color-mix(in srgb, var(--dsw-alias-bg-layer-2,#1c1e22) 68%, transparent);box-shadow:inset 0 1px 0 rgb(255 255 255 / 6%), 0 12px 34px rgb(0 0 0 / 9%)}
/* Three soft colour washes behind the chrome. Low opacity and no
   "filter:blur()" on purpose — see the note on the nav above: a blurred child
   inside a dialog whose ancestors already use "backdrop-filter" is the
   expensive way to spell "soft gradient". Two of them are cool and one is
   warm so the top of the card does not read as a single blue smear. */
.dsm-xdpool-aurora{position:absolute;inset:-10% -6% auto;height:280px;pointer-events:none;overflow:hidden;border-radius:18px;z-index:0}
.dsm-xdpool-aurora i{position:absolute;display:block;border-radius:50%;opacity:.18;filter:none}
.dsm-xdpool-aurora i:nth-child(1){width:280px;height:280px;left:4%;top:-40px;background:radial-gradient(circle, rgba(86,134,254,.55), transparent 70%)}
.dsm-xdpool-aurora i:nth-child(2){width:240px;height:240px;right:8%;top:-30px;background:radial-gradient(circle, rgba(150,97,255,.45), transparent 70%)}
.dsm-xdpool-aurora i:nth-child(3){width:220px;height:220px;left:38%;top:20px;background:radial-gradient(circle, rgba(46,207,160,.32), transparent 70%)}
.dsm-xdpool-shell > *:not(.dsm-xdpool-aurora){position:relative;z-index:1}
/* Sticky brand bar. "backdrop-filter" is deliberately absent even though the
   sibling plugin's nav uses it: this card is rendered inside a host dialog
   that already applies "backdrop-filter" to some ancestors, and stacking a
   backdrop-filtered ancestor with another one is where GPUs go to die. Large
   radius + a low-opacity solid fill gives the same frosted read for a
   fraction of the cost. */
.dsm-xdpool-nav{position:sticky;top:0;z-index:30;display:grid;grid-template-columns:1fr auto;align-items:center;gap:8px 12px;padding:10px 12px;border-radius:16px;border:1px solid color-mix(in srgb, var(--dsw-alias-border-l2,#ffffff1f) 82%, transparent);background:color-mix(in srgb, var(--dsw-alias-bg-layer-2,#1c1e22) 62%, transparent);box-shadow:inset 0 1px 0 rgb(255 255 255 / 7%), 0 8px 26px rgb(0 0 0 / 10%)}
.dsm-xdpool-brand{display:flex;align-items:center;gap:9px;min-width:0}
.dsm-xdpool-avatar{width:26px;height:26px;flex:none;border-radius:9px;object-fit:cover;box-shadow:inset 0 1px 0 rgb(255 255 255 / 22%), 0 4px 12px rgb(0 0 0 / 34%)}
.dsm-xdpool-brand-copy{display:flex;flex-direction:column;min-width:0}
.dsm-xdpool-brand-title{display:flex;align-items:baseline;gap:6px;font-size:14px;line-height:19px;font-weight:700;letter-spacing:-.2px;color:var(--dsw-alias-label-primary,#e8e8ea);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsm-xdpool-version{font-size:10.5px;line-height:14px;font-weight:500;color:var(--dsw-alias-label-tertiary,#8a90a0);font-variant-numeric:tabular-nums}
/* The star is pinned to the brand row explicitly. Grid auto-placement would
   put it below the tab strip (the strip comes first in the DOM) and stretch it
   across that row instead of hugging the right edge of the brand row. */
.dsm-xdpool-star{grid-column:2;grid-row:1;justify-self:end;position:relative;display:inline-flex;gap:7px;align-items:center;padding:7px 15px;border-radius:999px;overflow:hidden;text-decoration:none;white-space:nowrap;font-size:12.5px;line-height:17px;font-weight:650;border:1px solid color-mix(in srgb, var(--dsw-alias-state-business-primary,#5686fe) 55%, transparent);background:linear-gradient(140deg, color-mix(in srgb, var(--dsw-alias-state-business-primary,#5686fe) 16%, transparent), transparent 70%);color:var(--dsw-alias-state-business-primary,#5686fe);transition:transform .18s ease, box-shadow .22s ease, color .22s ease, background .22s ease}
.dsm-xdpool-star:hover{transform:translateY(-1px);box-shadow:0 0 0 4px color-mix(in srgb, var(--dsw-alias-state-business-primary,#5686fe) 10%, transparent), 0 8px 22px color-mix(in srgb, var(--dsw-alias-state-business-primary,#5686fe) 34%, transparent)}
.dsm-xdpool-star svg{fill:currentColor;transition:transform .5s cubic-bezier(.34,1.56,.64,1)}
.dsm-xdpool-star:hover svg{transform:rotate(72deg) scale(1.12)}
.dsm-xdpool-star:active svg{transform:rotate(72deg) scale(.94)}
.dsm-xdpool-navtabs{grid-column:1/-1;position:relative;display:flex;flex-wrap:wrap;gap:2px;padding:3px;border-radius:13px;border:1px solid color-mix(in srgb, var(--dsw-alias-border-l1,#ffffff14) 80%, transparent);background:color-mix(in srgb, var(--dsw-alias-bg-layer-1,#191a1e) 62%, transparent);box-shadow:inset 0 1px 2px rgb(0 0 0 / 4%)}
/* A raised surface, not a tinted wash: the glider has to read as "this one is
   sitting on top of the strip" from across the panel, and a wash alone is
   indistinguishable from hover. */
.dsm-xdpool-navglider{position:absolute;left:0;top:0;border-radius:10px;background:linear-gradient(150deg, color-mix(in srgb, var(--dsw-alias-bg-layer-3,#23252b) 92%, transparent), color-mix(in srgb, var(--dsw-alias-bg-layer-2,#1c1e22) 88%, transparent));box-shadow:0 3px 10px rgb(0 0 0 / 14%), inset 0 1px 0 rgb(255 255 255 / 9%);transition:transform .34s cubic-bezier(.22,.61,.36,1), width .34s cubic-bezier(.22,.61,.36,1), height .34s cubic-bezier(.22,.61,.36,1);pointer-events:none}
.dsm-xdpool-navtab{position:relative;z-index:1;display:inline-flex;align-items:center;gap:5px;padding:6px 13px;border:none;border-radius:10px;background:transparent;color:var(--dsw-alias-label-secondary,#c6c9d0);font:inherit;font-size:12px;line-height:17px;font-weight:600;white-space:nowrap;cursor:pointer;transition:color .2s ease}
.dsm-xdpool-navtab:hover{color:var(--dsw-alias-label-primary,#e8e8ea)}
.dsm-xdpool-navtab-on{color:var(--dsw-alias-label-primary,#e8e8ea)}
.dsm-xdpool-navtabnum{display:inline-flex;align-items:center;justify-content:center;min-width:16px;height:16px;padding:0 4px;border-radius:6px;font-size:11px;line-height:16px;font-weight:600;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary,#8a90a0)}
.dsm-xdpool-navtab-on .dsm-xdpool-navtabnum{color:var(--dsw-alias-label-primary,#e8e8ea)}
.dsm-xdpool-body{display:flex;flex-direction:column;gap:calc(var(--gap)*1.4);min-width:0}
/* Page hero: a raised panel with two soft highlights behind the title, the same
   three-layer read the shell uses everywhere else. */
.dsm-xdpool-hero{position:relative;display:flex;flex-direction:column;gap:14px;padding:22px 24px;border-radius:20px;overflow:hidden}
.dsm-xdpool-hero::before{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;background:radial-gradient(120% 150% at 12% -20%, color-mix(in srgb, var(--dsw-alias-state-business-primary,#5686fe) 13%, transparent), transparent 58%), radial-gradient(90% 120% at 88% 130%, color-mix(in srgb, var(--dsw-alias-state-success-primary,#22a06b) 7%, transparent), transparent 60%)}
.dsm-xdpool-hero > *{position:relative}
.dsm-xdpool-pagehead{position:relative;display:flex;align-items:flex-end;gap:14px;flex-wrap:wrap}
.dsm-xdpool-pagecopy{display:flex;flex-direction:column;gap:6px;min-width:0;flex:1 1 220px}
.dsm-xdpool-pagetitle{margin:0;font-size:23px;line-height:1.2;font-weight:760;letter-spacing:-.6px;background:linear-gradient(120deg, var(--dsw-alias-label-primary,#e8e8ea) 20%, color-mix(in srgb, var(--dsw-alias-label-primary,#e8e8ea) 55%, var(--dsw-alias-state-business-primary,#5686fe)));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent}
.dsm-xdpool-pagesub{margin:0;color:var(--dsw-alias-label-secondary,#c6c9d0);font-size:12.5px;line-height:1.55;max-width:70ch}
.dsm-xdpool-pageactions{margin-left:auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dsm-xdpool-pills{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-left:auto}
/* One statistic above the usage tables: same surface language as a page
   section, a smaller radius than the hero so a row of them does not compete
   with the page title above it. */
.dsm-xdpool-kpi{display:flex;flex-direction:column;gap:3px;padding:10px 12px;border-radius:12px;border:1px solid color-mix(in srgb, var(--dsw-alias-border-l1,#ffffff14) 100%, transparent);background:color-mix(in srgb, var(--dsw-alias-bg-layer-1,#191a1e) 78%, transparent);box-shadow:inset 0 1px 0 rgb(255 255 255 / 4%)}
.dsm-xdpool-kpi-label{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#8a90a0)}
.dsm-xdpool-kpi-value{display:block;font-size:16px;line-height:23px;font-weight:700;letter-spacing:-.3px;color:var(--dsw-alias-label-primary,#e8e8ea);font-variant-numeric:tabular-nums}
.dsm-xdpool-kpi-sub{font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,#c6c9d0)}
/* Generic status pill. Owned by the shell rather than by any one page, because
   the hero's pill slot is shared and a second definition per page would let two
   pages disagree about what "ok" looks like. */
.dsm-xdpool-pill{display:inline-flex;align-items:center;padding:2px 9px;border-radius:999px;font-size:11px;line-height:17px;white-space:nowrap;border:1px solid var(--dsw-alias-border-l2,#36373b);color:var(--dsw-alias-label-secondary,#c6c9d0)}
.dsm-xdpool-pill[data-tone="ok"]{border-color:color-mix(in oklab, var(--dsw-alias-state-success-primary,#22a06b) 45%, transparent);color:var(--dsw-alias-state-success-primary,#22a06b)}
.dsm-xdpool-pill[data-tone="warn"]{border-color:color-mix(in oklab, var(--dsw-alias-state-warning-primary,#e8a33d) 45%, transparent);color:var(--dsw-alias-state-warning-primary,#e8a33d)}
.dsm-xdpool-pill[data-tone="off"]{border-color:color-mix(in oklab, var(--dsw-alias-label-tertiary,#8a90a0) 40%, transparent);color:var(--dsw-alias-label-tertiary,#8a90a0)}

`.trim()

export const LEDGER_CARD_CSS = `

/* The tables carry many columns; the wrapper scrolls rather than forcing the
   settings section itself to, which would drag the whole card sideways. */
/* A failed turn stays visible instead of being greyed into the background: the
   point of a recent-calls table is being able to see the failures. */
/* Long model ids and account emails get clipped rather than wrapped: a wrapped
   number column breaks the alignment that makes it scannable. */

`.trim()

export const BILLION_CARD_CSS = `

.dsm-xdpool-steps{margin:0;padding-left:20px;display:flex;flex-direction:column;gap:6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#c6c9d0)}
.dsm-xdpool-steps code{font-family:var(--dsw-alias-font-mono,ui-monospace,Menlo,Consolas,monospace);font-size:11px;background:color-mix(in srgb, var(--dsw-alias-bg-layer-3,#26282e) 80%, transparent);border-radius:6px;padding:2px 6px}
/* A session with requests still in flight. The dot is the only motion on this
   page; nothing animates while idle, so a still dot means still idle. */
.dsm-xdpool-live{display:inline-block;width:6px;height:6px;border-radius:50%;margin-left:6px;vertical-align:middle;background:var(--dsw-alias-state-success,#22c55e)}
/* Section header that carries its own controls: title on the left, actions on
   the right, both on one baseline. */
.dsm-xdpool-sechead{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.dsm-xdpool-sechead .dsm-xdpool-sectitle{margin:0}
.dsm-xdpool-secbtns{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
/* A control that reads as a link-shaped button: it only navigates or reveals,
   it never commits state, so it stays quiet until hovered. */
.dsm-xdpool-secghost{appearance:none;display:inline-flex;align-items:center;font:inherit;font-size:11.5px;font-weight:560;line-height:17px;padding:3px 10px;border-radius:8px;border:1px solid color-mix(in srgb, var(--dsw-alias-border-l2,#36373b) 85%, transparent);background:color-mix(in srgb, var(--dsw-alias-bg-layer-3,#2a2c33) 70%, transparent);color:var(--dsw-alias-label-secondary,#c6c9d0);text-decoration:none;cursor:pointer;white-space:nowrap;transition:border-color .16s ease,color .16s ease,background .16s ease,transform .18s var(--ease-instrument)}
.dsm-xdpool-secghost:hover{border-color:color-mix(in srgb, var(--dsw-alias-brand-primary,#5686fe) 66%, var(--dsw-alias-border-l2,#36373b));color:var(--dsw-alias-label-primary,#e8e8ea);transform:translateY(-1px)}
.dsm-xdpool-secghost:focus-visible{outline:2px solid color-mix(in srgb, var(--dsw-alias-brand-primary,#5686fe) 78%, transparent);outline-offset:2px;box-shadow:0 0 0 4px color-mix(in srgb, var(--dsw-alias-brand-primary,#5686fe) 13%, transparent)}
/* The session id itself. A deep link into another plugin's UI, so it has to
   read as a link without pretending to be the pool's own navigation. */
.dsm-xdpool-sesslink{color:color-mix(in srgb, var(--dsw-alias-brand-primary,#5686fe) 88%, var(--dsw-alias-label-primary,#e8e8ea));text-decoration:none;border-bottom:1px solid color-mix(in srgb, var(--dsw-alias-brand-primary,#5686fe) 30%, transparent);transition:color .16s ease,border-color .16s ease}
.dsm-xdpool-sesslink:hover{color:var(--dsw-alias-brand-primary,#5686fe);border-bottom-color:color-mix(in srgb, var(--dsw-alias-brand-primary,#5686fe) 70%, transparent)}

`.trim()

export const ROUTING_CARD_CSS = `

/* The page root. It had no rule while the three sibling pages all declared one,
   so the routing page's cards sat flush against the hero with no gap. */
.dsm-xdpool-rt{display:flex;flex-direction:column;gap:10px;min-width:0}
.dsm-xdpool-rt-new{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
.dsm-xdpool-rt-editor{display:flex;flex-direction:column;gap:12px;padding:16px;border-radius:16px;border:1px solid color-mix(in srgb, var(--dsw-alias-border-l2,#36373b) 88%, transparent);background:color-mix(in srgb, var(--dsw-alias-bg-layer-2,#1c1e22) 82%, transparent);box-shadow:inset 0 1px 0 rgb(255 255 255 / 5%), 0 2px 6px rgb(0 0 0 / 4%)}
.dsm-xdpool-rt-editorhead{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
.dsm-xdpool-rt-edname{font-size:13px;line-height:19px;font-weight:600;color:var(--dsw-alias-label-primary,#e8e8ea)}
.dsm-xdpool-rt-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:9px}
.dsm-xdpool-rt-field{display:flex;flex-direction:column;gap:3px;min-width:0}
.dsm-xdpool-rt-field span{color:var(--dsw-alias-label-tertiary,#8a90a0);font-size:11px;line-height:16px}
.dsm-xdpool-rt-field input,.dsm-xdpool-rt-field select{padding:6px 10px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2,#36373b);background:color-mix(in srgb, var(--dsw-alias-bg-layer-1,#191a1e) 78%, transparent);box-shadow:inset 0 1px 2px rgb(0 0 0 / 5%);color:var(--dsw-alias-label-primary,#e8e8ea);font:inherit;font-size:12px;transition:border-color .16s ease,box-shadow .16s ease}
.dsm-xdpool-rt-field input:focus,.dsm-xdpool-rt-field select:focus{outline:none;border-color:var(--dsw-alias-brand-primary,#5686fe);box-shadow:0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary,#5686fe) 20%, transparent)}
.dsm-xdpool-rt-hint{margin:0;color:var(--dsw-alias-label-tertiary,#8a90a0);font-size:11px;line-height:17px}
/* Members render as an ordered, numbered list: order IS the semantics of a
   chain, so a two-column tag cloud would throw away the thing that matters. */
.dsm-xdpool-rt-members{display:flex;flex-direction:column;gap:5px;margin:0;padding:0;list-style:none}
.dsm-xdpool-rt-member{display:flex;align-items:center;gap:8px;padding:6px 9px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2,#36373b);background:color-mix(in srgb, var(--dsw-alias-bg-layer-1,#191a1e) 72%, transparent)}
.dsm-xdpool-rt-ord{flex:none;width:19px;height:19px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:10px;line-height:19px;color:var(--dsw-alias-label-tertiary,#8a90a0);border:1px solid var(--dsw-alias-border-l2,#36373b);font-variant-numeric:tabular-nums}
.dsm-xdpool-rt-mid{flex:1 1 auto;min-width:0;font-family:var(--dsw-alias-font-mono,ui-monospace,Menlo,Consolas,monospace);font-size:11px;line-height:17px;color:var(--dsw-alias-label-primary,#e8e8ea);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsm-xdpool-rt-mtag{flex:none}
.dsm-xdpool-rt-drop{flex:none;appearance:none;font:inherit;font-size:10px;line-height:16px;padding:2px 9px;border-radius:8px;border:1px solid color-mix(in srgb, var(--dsw-alias-border-l2,#36373b) 85%, transparent);background:color-mix(in srgb, var(--dsw-alias-bg-layer-3,#2a2c33) 70%, transparent);color:var(--dsw-alias-label-secondary,#c6c9d0);cursor:pointer;transition:border-color .16s ease,color .16s ease}
.dsm-xdpool-rt-drop:hover{border-color:var(--dsw-alias-state-error-primary,#ef4444);color:var(--dsw-alias-state-error-primary,#ef4444)}
.dsm-xdpool-rt-addrow{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
/* The model-id picker wore ".rt-field", whose rules style ".rt-field input,
   .rt-field select" - a DESCENDANT contract. This control IS the ".rt-field",
   so it matched nothing at all and rendered as a bare browser dropdown while
   every other control on the page was restyled, which is what the user
   reported. It gets its own rule now.

   The treatment is a recessed strip rather than a chrome dropdown, because the
   member rows directly beneath it are recessed strips too and the picker belongs
   to that row of controls: same 9px radius, same 72%-opacity layer-1 fill, same
   hover deepening. The monospace family is deliberate - these are model ids, and
   in a proportional face "deepseek-v4" and "deepseekv4" are near-identical
   strings to the eye. */
.dsm-xdpool-rt-pick{flex:1 1 220px;min-width:0;appearance:none;padding:6px 10px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2,#36373b);background:color-mix(in srgb, var(--dsw-alias-bg-layer-1,#191a1e) 72%, transparent);box-shadow:inset 0 1px 2px rgb(0 0 0 / 5%);color:var(--dsw-alias-label-primary,#e8e8ea);font-family:var(--dsw-alias-font-mono,ui-monospace,Menlo,Consolas,monospace);font-size:11.5px;line-height:17px;cursor:pointer;transition:border-color .16s ease,box-shadow .16s ease,background .15s ease}
.dsm-xdpool-rt-pick:hover{background:color-mix(in srgb, var(--dsw-alias-bg-layer-1,#191a1e) 88%, transparent);border-color:color-mix(in srgb, var(--dsw-alias-brand-primary,#5686fe) 50%, var(--dsw-alias-border-l2,#36373b))}
.dsm-xdpool-rt-pick:focus-visible{outline:none;border-color:var(--dsw-alias-brand-primary,#5686fe);box-shadow:0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary,#5686fe) 20%, transparent)}
/* The option list is painted by the OS, not by us, so the page's own tokens are
   re-stated here or a dark page opens a white popup. The empty option is greyed
   because a picker with nothing chosen must not read as a value. */
.dsm-xdpool-rt-pick option{background:var(--dsw-alias-bg-layer-2,#1c1e22);color:var(--dsw-alias-label-primary,#e8e8ea)}
.dsm-xdpool-rt-pick option[value=""]{color:var(--dsw-alias-label-tertiary,#8a90a0)}
.dsm-xdpool-rt-list{display:flex;flex-direction:column;gap:8px;min-width:0}
.dsm-xdpool-rt-row{display:flex;flex-direction:column;gap:8px;padding:12px 13px;border-radius:13px;border:1px solid var(--dsw-alias-border-l2,#36373b);background:color-mix(in srgb, var(--dsw-alias-bg-layer-3,#2a2c33) 80%, transparent);box-shadow:inset 0 1px 0 rgb(255 255 255 / 6%), 0 1px 2px rgb(0 0 0 / 6%);transition:transform .2s cubic-bezier(.32,.72,0,1),box-shadow .24s ease,border-color .18s ease}
.dsm-xdpool-rt-row:hover{transform:translateY(-2px);border-color:color-mix(in srgb, var(--dsw-alias-brand-primary,#5686fe) 66%, var(--dsw-alias-border-l2,#36373b));box-shadow:inset 0 1px 0 rgb(255 255 255 / 9%), 0 16px 34px color-mix(in srgb, var(--dsw-alias-brand-primary,#5686fe) 12%, transparent)}
.dsm-xdpool-rt-row[data-off="true"]{opacity:.68}
.dsm-xdpool-rt-rowhead{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dsm-xdpool-rt-name{font-size:13.5px;line-height:19px;font-weight:650;letter-spacing:-.1px;color:var(--dsw-alias-label-primary,#e8e8ea)}
.dsm-xdpool-rt-cid{font-family:var(--dsw-alias-font-mono,ui-monospace,Menlo,Consolas,monospace);font-size:10px;line-height:16px;color:var(--dsw-alias-label-tertiary,#8a90a0)}
.dsm-xdpool-rt-chain{display:flex;align-items:center;gap:5px;flex-wrap:wrap}
.dsm-xdpool-rt-actions{display:flex;align-items:center;gap:7px;flex-wrap:wrap;padding-top:2px}
/* A missing member is the one thing on this page that must not be quiet: the
   user believes the chain they typed is the chain that answered. */
.dsm-xdpool-rt-warn{margin:0;color:var(--dsw-alias-state-warning-primary,#e8a33d);font-size:11px;line-height:17px;word-break:break-word}
.dsm-xdpool-rt-flash{margin:0;padding:5px 9px;border-radius:6px;background:color-mix(in srgb, var(--dsw-alias-label-primary,#e8e8ea) 5%, transparent);color:var(--dsw-alias-label-secondary,#c6c9d0);font-size:11px;line-height:17px}

`.trim()

export const GATEWAY_CARD_CSS = `

.dsm-xdpool-gw{display:flex;flex-direction:column;gap:10px;min-width:0}
.dsm-xdpool-gw-note{margin:0;color:var(--dsw-alias-label-tertiary,#8a90a0);font-size:11px;line-height:17px;word-break:break-word}
.dsm-xdpool-gw-warn{margin:0;color:var(--dsw-alias-state-warning-primary,#e8a33d);font-size:11px;line-height:17px}
.dsm-xdpool-gw-field{display:grid;grid-template-columns:minmax(0,132px) minmax(0,1fr);align-items:center;gap:8px}
.dsm-xdpool-gw-field>span{color:var(--dsw-alias-label-secondary,#c6c9d0);font-size:12px;line-height:17px}
.dsm-xdpool-gw-field>select,.dsm-xdpool-gw-field>input{appearance:none;font:inherit;font-size:12px;line-height:17px;padding:6px 10px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2,#36373b);background:color-mix(in srgb, var(--dsw-alias-bg-layer-1,#191a1e) 78%, transparent);box-shadow:inset 0 1px 2px rgb(0 0 0 / 5%);color:var(--dsw-alias-label-primary,#e8e8ea);min-width:0}
.dsm-xdpool-gw-field>select:focus-visible,.dsm-xdpool-gw-field>input:focus-visible{outline:none;border-color:var(--dsw-alias-brand-primary,#5686fe);box-shadow:0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary,#5686fe) 20%, transparent)}
.dsm-xdpool-gw-key{margin:0;font-family:var(--dsw-alias-font-mono,ui-monospace,Menlo,Consolas,monospace);font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary,#e8e8ea);word-break:break-all;user-select:all}
.dsm-xdpool-gw-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.dsm-xdpool-gw-flash{margin:0;padding:6px 10px;border-radius:9px;border:1px solid color-mix(in srgb, var(--dsw-alias-border-l1,#ffffff14) 70%, transparent);background:color-mix(in srgb, var(--dsw-alias-bg-layer-1,#191a1e) 72%, transparent);color:var(--dsw-alias-label-secondary,#c6c9d0);font-size:11px;line-height:17px;word-break:break-word}
.dsm-xdpool-gw-btn{appearance:none;display:inline-flex;align-items:center;gap:6px;font:inherit;font-size:11.5px;font-weight:560;line-height:17px;padding:4px 12px;border-radius:8px;border:1px solid color-mix(in srgb, var(--dsw-alias-border-l2,#36373b) 85%, transparent);background:color-mix(in srgb, var(--dsw-alias-bg-layer-3,#2a2c33) 70%, transparent);color:var(--dsw-alias-label-secondary,#c6c9d0);cursor:pointer;white-space:nowrap;transition:border-color .16s ease,color .16s ease,background .16s ease,transform .18s var(--ease-instrument,cubic-bezier(.16,1,.3,1))}
.dsm-xdpool-gw-btn:hover:not(:disabled){transform:translateY(-1px);border-color:color-mix(in srgb, var(--dsw-alias-brand-primary,#5686fe) 55%, var(--dsw-alias-border-l2,#36373b));color:var(--dsw-alias-label-primary,#e8e8ea)}
.dsm-xdpool-gw-btn:active:not(:disabled){transform:translateY(0);box-shadow:inset 0 2px 4px rgb(0 0 0 / 22%)}
.dsm-xdpool-gw-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:2px}
.dsm-xdpool-gw-btn[data-on="true"]{border-color:color-mix(in oklab, var(--dsw-alias-state-success-primary,#22a06b) 55%, transparent);background:color-mix(in oklab, var(--dsw-alias-state-success-primary,#22a06b) 14%, transparent);color:var(--dsw-alias-state-success-primary,#22a06b);font-weight:600}
.dsm-xdpool-gw-btn[data-on="true"]:hover:not(:disabled){border-color:color-mix(in oklab, var(--dsw-alias-state-success-primary,#22a06b) 78%, transparent);color:var(--dsw-alias-state-success-primary,#22a06b)}
.dsm-xdpool-gw-btn:disabled{opacity:.5;cursor:default;filter:saturate(.35);transform:none}

`.trim()

export const SHARED_CARD_CSS = `

/* The one action button. Four pages render it — the sign-in list, the account
   pool's channel cards, the aggregate lane and the gateway card — and only the
   shell reaches all four, so the metrics have to live here. It sat in
   CHANNEL_CARD_CSS until the pool's claim/refresh controls were reported as
   "not the same UI as everything else": they were bare browser buttons, because
   that sheet is injected by one page out of four. Smaller than a page-level
   button on purpose — it shares a 40px row with a 40px brand tile — but it
   reads as the same family: same radius, same inset highlight, same lift. */
.dsm-xdpool-btn{appearance:none;display:inline-flex;align-items:center;gap:6px;font:inherit;font-size:11.5px;font-weight:560;line-height:17px;padding:4px 12px;border-radius:8px;border:1px solid color-mix(in srgb, var(--dsw-alias-border-l2,#36373b) 85%, transparent);background:color-mix(in srgb, var(--dsw-alias-bg-layer-3,#2a2c33) 70%, transparent);color:var(--dsw-alias-label-secondary,#c6c9d0);text-decoration:none;cursor:pointer;white-space:nowrap;transition:border-color .16s ease,color .16s ease,background .16s ease,transform .18s var(--ease-instrument,cubic-bezier(.16,1,.3,1))}
.dsm-xdpool-btn:hover:not(:disabled){transform:translateY(-1px);border-color:color-mix(in srgb, var(--dsm-xdpool-channel-accent,#5686fe) 62%, var(--dsw-alias-border-l2,#36373b));color:var(--dsw-alias-label-primary,#e8e8ea);background:color-mix(in srgb, var(--dsm-xdpool-channel-accent,#5686fe) 7%, color-mix(in srgb, var(--dsw-alias-bg-layer-3,#2a2c33) 70%, transparent));box-shadow:inset 0 1px 0 rgb(255 255 255 / 7%),0 3px 8px rgb(0 0 0 / 9%)}
.dsm-xdpool-btn:active:not(:disabled){transform:scale(.985);box-shadow:inset 0 2px 4px rgb(0 0 0 / 22%)}
.dsm-xdpool-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:2px}
.dsm-xdpool-btn:disabled{opacity:.5;cursor:default;filter:saturate(.35);transform:none}
@media (prefers-reduced-motion: reduce){
  .dsm-xdpool-cpool-card,.dsm-xdpool-cpool-card:hover,.dsm-xdpool-cpool-card .dsm-xdpool-tile,.dsm-xdpool-btn,.dsm-xdpool-btn:hover,.dsm-xdpool-btn:active{transform:none;transition:none}
}

/* Per-model facts, shared by the sign-in page, the aggregate lane and the pool.
   Declared here for the same reason the tile below is: three pages render one
   component, and only the shared sheet reaches all three. The typography is
   deliberately quieter than the model name it sits under — these are the facts
   you check, not the thing you are choosing. */
.dsm-xdpool-mfacts{display:flex;flex-direction:column;gap:4px;min-width:0;margin-top:5px}
.dsm-xdpool-mfacts-note{font-size:11px;line-height:1.5;color:var(--dsw-alias-label-tertiary,#8a90a0)}
.dsm-xdpool-mfacts-line{display:flex;align-items:baseline;gap:6px 13px;flex-wrap:wrap;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#8a90a0)}
.dsm-xdpool-mfacts-fig{display:inline-flex;align-items:baseline;gap:4px;min-width:0}
.dsm-xdpool-mfacts-fig-label{white-space:nowrap}
.dsm-xdpool-mfacts-fig-value{color:var(--dsw-alias-label-secondary,#c3c7d4);font-weight:650;font-variant-numeric:tabular-nums;white-space:nowrap}
/* The test-connection button sits at the end of the figures line so the row
   reads left-to-right as "what it is" then "prove it". It is a plain text
   affordance rather than a filled button because most rows never need it: it
   only matters when a model stops answering, which is exactly when the user is
   already looking closely. */
.dsm-xdpool-mfacts-probe{flex:none;align-self:center;appearance:none;border:0;background:none;padding:1px 6px;margin-left:auto;border-radius:7px;font:inherit;font-size:11px;color:var(--dsw-alias-label-tertiary,#8a90a0);cursor:pointer;transition:color .16s ease,background-color .16s ease}
.dsm-xdpool-mfacts-probe:hover:not(:disabled){color:var(--dsw-alias-label-secondary,#c3c7d4);background:color-mix(in srgb,var(--dsw-alias-bg-layer-1,#191a1e) 70%,transparent)}
.dsm-xdpool-mfacts-probe:active:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-bg-layer-1,#191a1e) 90%,transparent)}
.dsm-xdpool-mfacts-probe:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px}
.dsm-xdpool-mfacts-probe:disabled{cursor:default;opacity:.45}
/* The result line replaces the button in place rather than opening a dialog: a
   connection test answers in under a second, and a dialog that flashes open and
   shut is worse than the answer appearing where the button was. */
.dsm-xdpool-mfacts-result{display:inline-flex;align-items:baseline;gap:4px;flex:none;margin-left:auto;font-size:11px;white-space:nowrap}
.dsm-xdpool-mfacts-result[data-ok="true"]{color:var(--dsw-alias-state-success-primary,#22a06b)}
.dsm-xdpool-mfacts-result[data-ok="false"]{color:var(--dsw-alias-state-error-primary,#e5484d)}
.dsm-xdpool-mfacts-result-error{display:block;font-size:10.5px;line-height:1.4;color:var(--dsw-alias-state-error-primary,#e5484d);margin-top:2px;overflow-wrap:anywhere}
.dsm-xdpool-recuse{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px;margin:3px 0 0;font-size:11px;line-height:1.5;color:var(--dsw-alias-label-tertiary,#8a90a0)}
.dsm-xdpool-recuse-label{flex:none;font-weight:650;color:var(--dsw-alias-brand-primary,#5686fe)}

/* The brand tile. Three pages render it — the login channels, the pool's region
   cards and the aggregate rows — so it is declared here rather than in any one
   page's sheet: a rule that lives in a page stylesheet has no effect on the
   other two, and the symptom is a 40px hole where the vendor's logo should be.
   brand-tile.tsx pushes the accent, the glyph mask and the artwork in as
   custom properties; the three classes below are the three states it can ask
   for. */
.dsm-xdpool-tile{flex:none;display:inline-block;width:40px;height:40px;border-radius:13px;background:linear-gradient(145deg,color-mix(in srgb,var(--dsm-xdpool-tile-accent,#5686fe) 82%,#fff 18%),color-mix(in srgb,var(--dsm-xdpool-tile-accent,#5686fe) 88%,#000 12%));box-shadow:inset 0 1px 0 rgb(255 255 255 / 22%),inset 0 -1px 2px rgb(0 0 0 / 22%),0 2px 6px rgb(0 0 0 / 20%);position:relative;transition:transform .2s cubic-bezier(.32,.72,0,1),box-shadow .24s ease}
.dsm-xdpool-tile::after{content:"";position:absolute;inset:0;background:#fff;-webkit-mask:var(--dsm-xdpool-tile-glyph,none) center / 21px 21px no-repeat;mask:var(--dsm-xdpool-tile-glyph,none) center / 21px 21px no-repeat;opacity:.94}
/* A vendor that has real artwork wears it instead of the gradient and glyph.
   The image IS the whole tile, so the gradient and the mask are both switched
   off rather than layered under an opaque PNG. "contain" and a transparent
   background keep a non-square logo from being cropped. */
.dsm-xdpool-tile-art{background-color:transparent;background-image:var(--dsm-xdpool-tile-icon,none);background-repeat:no-repeat;background-position:center;background-size:contain;box-shadow:none}
.dsm-xdpool-tile-art::after{content:none}
/* Two letters drawn in white on the tile's own gradient, for the vendors that
   ship no artwork anywhere. The gradient stays; only the glyph mask is switched
   off (brand-tile.tsx sets the custom property to "none" when letters are
   present), because otherwise the two marks stack and the tile turns to mud.
   Grid plus place-items rather than a line-height nudge: the tile is aria-hidden
   with one bare text node in it, and inline-block vertical centring lands a full
   pixel low for this set of metrics. */
.dsm-xdpool-tile-letters{display:grid;place-items:center;color:#fff;font-size:15px;line-height:1;font-weight:800;letter-spacing:-.4px;text-shadow:0 1px 2px rgb(0 0 0 / 28%);-webkit-user-select:none;user-select:none;pointer-events:none}
.dsm-xdpool-tile-letters::after{content:none}
.dsm-btn{appearance:none;font:inherit;cursor:pointer;border:1px solid transparent;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}
.dsm-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px}
.dsm-btn:disabled{opacity:.4;cursor:default;filter:saturate(.35);transform:none}
/* Only the transform is neutralised here. Every variant's hover background is
   already gated with ":not(:disabled)", so a disabled button never acquires one
   and this rule has nothing to undo — but background:transparent used to sit
   beside it, and at specificity (0,3,0) it beat .dsm-btn-primary's (0,1,0)
   fill. The primary label is a dark colour designed for a light background, so
   on a dark panel the fill went transparent, the text stayed dark, and the
   button appeared to vanish the moment the cursor reached it. */
.dsm-btn:disabled:hover{transform:none}
.dsm-btn-outline{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:transparent;font-weight:500}
.dsm-btn-outline:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed);background:rgba(255,255,255,.04)}
.dsm-btn-primary{background:var(--dsw-alias-label-primary,#e6e6e6);color:var(--dsw-alias-bg-layer-3,#202126)}
.dsm-btn-primary:hover:not(:disabled){opacity:.9}
/* The borderless third of the button family: links out to a vendor's console
   and the destructive "forget this key" action. It had no rule at all, so the
   aggregate row's three links and the billion page's "open its dashboard"
   rendered as bare browser buttons — which is how a secondary action ends up
   looking like the primary one. */
.dsm-btn-ghost{border-color:transparent;background:transparent;color:var(--dsw-alias-label-tertiary,#8a90a0)}
.dsm-btn-ghost:hover:not(:disabled){border-color:var(--dsw-alias-border-l2,#36373b);color:var(--dsw-alias-label-primary,#e8e8ea);background:rgba(255,255,255,.04);text-decoration:none}
.dsm-xdpool-panel-empty{color:var(--dsw-alias-label-tertiary,#999);font-size:14px;line-height:20px}
.dsm-xdpool-panel-error{color:var(--dsw-alias-state-error-primary,#ef4444);font-size:12px;line-height:18px;word-break:break-word}
.dsm-xdpool-note{margin:0;color:var(--dsw-alias-label-tertiary,#9aa0a8);font-size:13px;line-height:20px}
.dsm-xdpool-agg-search{flex:1 1 220px;min-width:0;padding:6px 10px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2,#36373b);background:color-mix(in srgb, var(--dsw-alias-bg-layer-1,#191a1e) 78%, transparent);box-shadow:inset 0 1px 2px rgb(0 0 0 / 5%);color:var(--dsw-alias-label-primary,#e8e8ea);font:inherit;font-size:12px}
.dsm-xdpool-agg-search:focus{outline:none;border-color:var(--dsw-alias-brand-primary,#5686fe);box-shadow:0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary,#5686fe) 20%, transparent)}
.dsm-xdpool-agg-cats{display:flex;align-items:center;gap:4px;flex-wrap:wrap}
.dsm-xdpool-agg-cat{appearance:none;font:inherit;font-size:11px;line-height:16px;padding:3px 10px;border-radius:999px;border:1px solid color-mix(in srgb, var(--dsw-alias-border-l1,#ffffff14) 70%, transparent);background:color-mix(in srgb, var(--dsw-alias-bg-layer-1,#191a1e) 72%, transparent);color:var(--dsw-alias-label-secondary,#c6c9d0);cursor:pointer;transition:border-color .16s ease,color .16s ease,background .16s ease}
.dsm-xdpool-agg-cat:hover{border-color:color-mix(in srgb, var(--dsw-alias-brand-primary,#5686fe) 66%, var(--dsw-alias-border-l2,#36373b));color:var(--dsw-alias-label-primary,#e8e8ea)}
.dsm-xdpool-agg-cat[data-on="true"]{border-color:color-mix(in srgb, currentColor 55%, transparent);background:color-mix(in srgb, var(--dsw-alias-bg-layer-2,#1c1e22) 70%, transparent)}
.dsm-xdpool-agg-tags{display:flex;align-items:center;gap:5px;flex-wrap:wrap}
.dsm-xdpool-agg-tag{display:inline-flex;align-items:center;padding:1px 7px;border-radius:999px;font-size:10px;line-height:16px;white-space:nowrap;border:1px solid var(--dsw-alias-border-l2,#36373b);color:var(--dsw-alias-label-tertiary,#8a90a0)}
.dsm-xdpool-agg-tag[data-tone="ok"]{border-color:color-mix(in oklab, var(--dsw-alias-state-success-primary,#22a06b) 45%, transparent);color:var(--dsw-alias-state-success-primary,#22a06b)}
.dsm-xdpool-agg-tag[data-tone="busy"]{border-color:color-mix(in oklab, var(--dsw-alias-state-business-primary,#5686fe) 45%, transparent);color:var(--dsw-alias-state-business-primary,#5686fe)}
.dsm-xdpool-agg-tag[data-tone="live"]{border-color:color-mix(in oklab, var(--dsw-alias-state-success-primary,#22a06b) 45%, transparent);color:var(--dsw-alias-state-success-primary,#22a06b);font-weight:600}
.dsm-xdpool-switch{display:inline-flex;align-items:center;gap:9px;font-size:12.5px;line-height:18px;color:var(--dsw-alias-label-secondary,#c6c9d0);cursor:pointer;user-select:none;-webkit-tap-highlight-color:transparent}
.dsm-xdpool-switch input{appearance:none;-webkit-appearance:none;position:relative;flex:none;width:36px;height:20px;margin:0;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,#36373b);background:color-mix(in srgb, var(--dsw-alias-bg-layer-1,#191a1e) 70%, transparent);box-shadow:inset 0 1px 3px rgb(0 0 0 / 8%);cursor:pointer;transition:background .2s ease,border-color .2s ease,box-shadow .2s ease}
.dsm-xdpool-switch input::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-secondary,#c6c9d0);box-shadow:0 1px 3px rgb(0 0 0 / 22%);transition:transform .26s cubic-bezier(.34,1.3,.64,1),background .2s ease}
.dsm-xdpool-switch input:checked{background:var(--dsw-alias-state-business-primary,#5686fe);border-color:color-mix(in srgb, var(--dsw-alias-state-business-primary,#5686fe) 85%, #000);box-shadow:inset 0 1px 3px rgb(0 0 0 / 12%)}
.dsm-xdpool-switch input:checked::after{transform:translateX(16px);background:#fff}
.dsm-xdpool-switch input:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#5686fe);outline-offset:2px;box-shadow:0 0 0 4px color-mix(in srgb, var(--dsw-alias-state-business-primary,#5686fe) 13%, transparent)}
.dsm-xdpool-switch input:disabled{opacity:.55;cursor:default}
.dsm-xdpool-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(112px,1fr));gap:8px}
.dsm-xdpool-sec{display:flex;flex-direction:column;gap:10px;padding:16px;border-radius:16px;border:1px solid color-mix(in srgb, var(--dsw-alias-border-l2,#36373b) 88%, transparent);background:color-mix(in srgb, var(--dsw-alias-bg-layer-2,#1c1e22) 82%, transparent);box-shadow:inset 0 1px 0 rgb(255 255 255 / 5%), 0 2px 6px rgb(0 0 0 / 4%)}
.dsm-xdpool-sectitle{margin:0;font-size:12px;font-weight:680;line-height:18px;letter-spacing:.2px;color:var(--dsw-alias-label-secondary,#c6c9d0);display:flex;align-items:center;gap:8px}
.dsm-xdpool-tablewrap{overflow-x:auto;max-width:100%}
.dsm-xdpool-table{width:100%;min-width:760px;border-collapse:collapse;font-size:11.5px;line-height:17px}
.dsm-xdpool-table th{text-align:left;font-weight:560;font-size:10.5px;letter-spacing:.4px;text-transform:uppercase;color:var(--dsw-alias-label-tertiary,#8a90a0);padding:0 10px 8px;border-bottom:1px solid color-mix(in srgb, var(--dsw-alias-border-l1,#ffffff14) 70%, transparent);white-space:nowrap}
.dsm-xdpool-table td{padding:7px 10px;border-bottom:1px solid color-mix(in srgb, var(--dsw-alias-border-l1,#ffffff14) 62%, transparent);color:var(--dsw-alias-label-secondary,#c6c9d0);font-variant-numeric:tabular-nums}
.dsm-xdpool-table tbody tr:last-child td{border-bottom:none}
.dsm-xdpool-table tbody tr[data-ok="false"] td{color:var(--dsw-alias-state-error-primary,#ef4444)}
.dsm-xdpool-num{text-align:right;font-variant-numeric:tabular-nums}
.dsm-xdpool-ellipsis{max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/*
 * Hover light sweep — ported from the our-free-model button sweep.
 *
 * Every pressable surface in this plugin gets the same two-layer move: the
 * shell lifts on ":hover" and sinks slightly on ":active", while a skewed
 * highlight slides across the inside from left to right. The intent is
 * "kinetic tension" — the shell presses in while the light pushes back out.
 *
 * The accent is a variable rather than a literal because these buttons sit in
 * two different worlds: a channel card owns --dsm-xdpool-cpool-accent, while
 * everything else falls back to the host's brand colour. One sweep, tinted by
 * whatever card it happens to be in.
 *
 * Buttons that already own a busy-spinner ::after (.dsm-xdpool-btn when
 * data-busy) are excluded in the class list below so the two never collide.
 */
.dsm-xdpool-shell :is(
  .dsm-xdpool-btn,
  .dsm-xdpool-cpool-fold,
  .dsm-xdpool-minibtn,
  .dsm-xdpool-tab,
  .dsm-xdpool-dist-option,
  .dsm-xdpool-account-toggle,
  .dsm-xdpool-account-ignore,
  .dsm-xdpool-account-prefer,
  .dsm-xdpool-ignored-restore,
  .dsm-xdpool-model-image,
  .dsm-xdpool-model-budget label,
  .dsm-xdpool-checkin-btn,
  .dsm-xdpool-auto-switch,
  .dsm-xdpool-reserve-save,
  .dsm-xdpool-region-seg-btn,
  .dsm-xdpool-region-tool,
  .dsm-xdpool-agg-open,
  .dsm-xdpool-agg-cat,
  .dsm-xdpool-navtab,
  .dsm-xdpool-secghost,
  .dsm-xdpool-rt-drop,
  .dsm-xdpool-gw-btn,
  .dsm-xdpool-mfacts-probe
){position:relative;overflow:hidden;--dsm-xdpool-sweep:color-mix(in srgb, var(--dsm-xdpool-cpool-accent, var(--dsm-xdpool-region-accent, var(--dsm-xdpool-agg-accent, var(--dsw-alias-brand-primary,#5686fe)))) 88%, #ffffff);transition:transform .16s var(--ease-settle, cubic-bezier(.34,1.4,.4,1)),border-color .2s var(--ease-instrument, cubic-bezier(.16,1,.3,1)),background .2s var(--ease-instrument, cubic-bezier(.16,1,.3,1)),box-shadow .2s var(--ease-instrument, cubic-bezier(.16,1,.3,1)),color .16s var(--ease-instrument, cubic-bezier(.16,1,.3,1))}
.dsm-xdpool-shell :is(
  .dsm-xdpool-btn,
  .dsm-xdpool-cpool-fold,
  .dsm-xdpool-minibtn,
  .dsm-xdpool-tab,
  .dsm-xdpool-dist-option,
  .dsm-xdpool-account-toggle,
  .dsm-xdpool-account-ignore,
  .dsm-xdpool-account-prefer,
  .dsm-xdpool-ignored-restore,
  .dsm-xdpool-model-image,
  .dsm-xdpool-model-budget label,
  .dsm-xdpool-checkin-btn,
  .dsm-xdpool-auto-switch,
  .dsm-xdpool-reserve-save,
  .dsm-xdpool-region-seg-btn,
  .dsm-xdpool-region-tool,
  .dsm-xdpool-agg-open,
  .dsm-xdpool-agg-cat,
  .dsm-xdpool-navtab,
  .dsm-xdpool-secghost,
  .dsm-xdpool-rt-drop,
  .dsm-xdpool-gw-btn,
  .dsm-xdpool-mfacts-probe
)::after{content:"";position:absolute;top:0;bottom:0;left:-60%;width:42%;pointer-events:none;background:linear-gradient(100deg,transparent,color-mix(in srgb, var(--dsm-xdpool-sweep,#ffffff) 14%,transparent),transparent);transform:skewX(-18deg);transition:left .5s var(--ease-instrument, cubic-bezier(.16,1,.3,1))}
.dsm-xdpool-shell :is(
  .dsm-xdpool-btn,
  .dsm-xdpool-cpool-fold,
  .dsm-xdpool-minibtn,
  .dsm-xdpool-tab,
  .dsm-xdpool-dist-option,
  .dsm-xdpool-account-toggle,
  .dsm-xdpool-account-ignore,
  .dsm-xdpool-account-prefer,
  .dsm-xdpool-ignored-restore,
  .dsm-xdpool-model-image,
  .dsm-xdpool-model-budget label,
  .dsm-xdpool-checkin-btn,
  .dsm-xdpool-auto-switch,
  .dsm-xdpool-reserve-save,
  .dsm-xdpool-region-seg-btn,
  .dsm-xdpool-region-tool,
  .dsm-xdpool-agg-open,
  .dsm-xdpool-agg-cat,
  .dsm-xdpool-navtab,
  .dsm-xdpool-secghost,
  .dsm-xdpool-rt-drop,
  .dsm-xdpool-gw-btn,
  .dsm-xdpool-mfacts-probe
):hover:not(:disabled)::after{left:118%}
/*
 * The lift is deliberately one pixel and the settle curve overshoots, so the
 * button arrives a fraction late — the same trick our-free-model uses. Rows
 * that are already cards (tabs, dist options) must not also translate, or the
 * text inside them visibly detaches from its own border.
 */
.dsm-xdpool-shell :is(
  .dsm-xdpool-btn,
  .dsm-xdpool-cpool-fold,
  .dsm-xdpool-minibtn,
  .dsm-xdpool-account-toggle,
  .dsm-xdpool-account-ignore,
  .dsm-xdpool-account-prefer,
  .dsm-xdpool-ignored-restore,
  .dsm-xdpool-model-image,
  .dsm-xdpool-model-budget label,
  .dsm-xdpool-checkin-btn,
  .dsm-xdpool-auto-switch,
  .dsm-xdpool-reserve-save,
  .dsm-xdpool-region-seg-btn,
  .dsm-xdpool-region-tool,
  .dsm-xdpool-agg-open,
  .dsm-xdpool-agg-cat,
  .dsm-xdpool-navtab,
  .dsm-xdpool-secghost,
  .dsm-xdpool-rt-drop,
  .dsm-xdpool-gw-btn,
  .dsm-xdpool-mfacts-probe
):hover:not(:disabled){transform:translateY(-1px);box-shadow:inset 0 1px 0 rgb(255 255 255 / 10%)}
.dsm-xdpool-shell :is(
  .dsm-xdpool-btn,
  .dsm-xdpool-cpool-fold,
  .dsm-xdpool-minibtn,
  .dsm-xdpool-account-toggle,
  .dsm-xdpool-account-ignore,
  .dsm-xdpool-account-prefer,
  .dsm-xdpool-ignored-restore,
  .dsm-xdpool-model-image,
  .dsm-xdpool-model-budget label,
  .dsm-xdpool-checkin-btn,
  .dsm-xdpool-auto-switch,
  .dsm-xdpool-reserve-save,
  .dsm-xdpool-region-seg-btn,
  .dsm-xdpool-region-tool,
  .dsm-xdpool-agg-open,
  .dsm-xdpool-agg-cat,
  .dsm-xdpool-navtab,
  .dsm-xdpool-secghost,
  .dsm-xdpool-rt-drop,
  .dsm-xdpool-gw-btn,
  .dsm-xdpool-mfacts-probe
):active:not(:disabled){transform:scale(.985);transition-duration:.09s;box-shadow:inset 0 2px 5px rgb(0 0 0 / 14%),inset 0 1px 0 rgb(255 255 255 / 3%)}
.dsm-xdpool-shell :is(
  .dsm-xdpool-btn,
  .dsm-xdpool-cpool-fold,
  .dsm-xdpool-minibtn,
  .dsm-xdpool-account-toggle,
  .dsm-xdpool-account-ignore,
  .dsm-xdpool-account-prefer,
  .dsm-xdpool-ignored-restore,
  .dsm-xdpool-model-image,
  .dsm-xdpool-model-budget label,
  .dsm-xdpool-checkin-btn,
  .dsm-xdpool-auto-switch,
  .dsm-xdpool-reserve-save,
  .dsm-xdpool-region-seg-btn,
  .dsm-xdpool-region-tool,
  .dsm-xdpool-agg-open,
  .dsm-xdpool-agg-cat,
  .dsm-xdpool-navtab,
  .dsm-xdpool-secghost,
  .dsm-xdpool-rt-drop,
  .dsm-xdpool-gw-btn,
  .dsm-xdpool-mfacts-probe
):disabled{opacity:.45}
/* Keyboard focus must stay visible through the sweep, or the highlight reads
   as decoration on a control the user is currently driving. */
.dsm-xdpool-shell :is(
  .dsm-xdpool-btn,
  .dsm-xdpool-cpool-fold,
  .dsm-xdpool-minibtn,
  .dsm-xdpool-account-toggle,
  .dsm-xdpool-account-ignore,
  .dsm-xdpool-account-prefer,
  .dsm-xdpool-ignored-restore,
  .dsm-xdpool-checkin-btn,
  .dsm-xdpool-auto-switch,
  .dsm-xdpool-reserve-save,
  .dsm-xdpool-region-seg-btn,
  .dsm-xdpool-region-tool,
  .dsm-xdpool-agg-open,
  .dsm-xdpool-agg-cat,
  .dsm-xdpool-secghost,
  .dsm-xdpool-rt-drop,
  .dsm-xdpool-gw-btn
):focus-visible{outline:2px solid var(--dsm-xdpool-sweep,var(--dsw-alias-brand-primary,#5686fe));outline-offset:2px}
/* A sweep that keeps moving after the pointer leaves is a seizure risk, so
   prefers-reduced-motion removes the travel and keeps only the tint change. */
@media (prefers-reduced-motion:reduce){
.dsm-xdpool-shell :is(
  .dsm-xdpool-btn,
  .dsm-xdpool-cpool-fold,
  .dsm-xdpool-minibtn,
  .dsm-xdpool-tab,
  .dsm-xdpool-dist-option,
  .dsm-xdpool-account-toggle,
  .dsm-xdpool-account-ignore,
  .dsm-xdpool-account-prefer,
  .dsm-xdpool-ignored-restore,
  .dsm-xdpool-model-image,
  .dsm-xdpool-model-budget label,
  .dsm-xdpool-checkin-btn,
  .dsm-xdpool-auto-switch,
  .dsm-xdpool-reserve-save,
  .dsm-xdpool-region-seg-btn,
  .dsm-xdpool-region-tool,
  .dsm-xdpool-agg-open,
  .dsm-xdpool-agg-cat,
  .dsm-xdpool-navtab,
  .dsm-xdpool-secghost,
  .dsm-xdpool-rt-drop,
  .dsm-xdpool-gw-btn,
  .dsm-xdpool-mfacts-probe
)::after{display:none}
.dsm-xdpool-shell :is(
  .dsm-xdpool-btn,
  .dsm-xdpool-cpool-fold,
  .dsm-xdpool-minibtn,
  .dsm-xdpool-account-toggle,
  .dsm-xdpool-account-ignore,
  .dsm-xdpool-account-prefer,
  .dsm-xdpool-ignored-restore,
  .dsm-xdpool-model-image,
  .dsm-xdpool-model-budget label,
  .dsm-xdpool-checkin-btn,
  .dsm-xdpool-auto-switch,
  .dsm-xdpool-reserve-save,
  .dsm-xdpool-region-seg-btn,
  .dsm-xdpool-region-tool,
  .dsm-xdpool-agg-open,
  .dsm-xdpool-agg-cat,
  .dsm-xdpool-navtab,
  .dsm-xdpool-secghost,
  .dsm-xdpool-rt-drop,
  .dsm-xdpool-gw-btn,
  .dsm-xdpool-mfacts-probe
):hover:not(:disabled){transform:none}
.dsm-xdpool-shell :is(
  .dsm-xdpool-btn,
  .dsm-xdpool-cpool-fold,
  .dsm-xdpool-minibtn,
  .dsm-xdpool-account-toggle,
  .dsm-xdpool-account-ignore,
  .dsm-xdpool-account-prefer,
  .dsm-xdpool-ignored-restore,
  .dsm-xdpool-model-image,
  .dsm-xdpool-model-budget label,
  .dsm-xdpool-checkin-btn,
  .dsm-xdpool-auto-switch,
  .dsm-xdpool-reserve-save,
  .dsm-xdpool-region-seg-btn,
  .dsm-xdpool-region-tool,
  .dsm-xdpool-agg-open,
  .dsm-xdpool-agg-cat,
  .dsm-xdpool-navtab,
  .dsm-xdpool-secghost,
  .dsm-xdpool-rt-drop,
  .dsm-xdpool-gw-btn,
  .dsm-xdpool-mfacts-probe
):active:not(:disabled){transform:none}
}

`.trim()

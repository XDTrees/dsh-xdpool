window.__ModuleLoader__.load({
	id: "dsh-xdpool",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#endregion
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/sidebar-row.ts
		/**
		* The `sidebarRow` switch, read and written from one place.
		*
		* Two independent owners need this flag: the page card draws the checkbox, and
		* `apply()` decides whether to register the sidebar row before that card has ever
		* mounted. Both therefore have to read the same source of truth — the settings
		* mirror the host exposes — instead of one asking the server and the other
		* guessing.
		*
		* The scope is typed structurally here rather than imported from `PoolCard.tsx`:
		* this module is pulled into both tsconfigs (the server one has no JSX setting),
		* and the only thing it needs from that component is `getSnapshot().value`.
		*
		* The default is ON, and the read is fail-open on purpose: "the mirror has no
		* opinion yet" and "the user turned it off" must not be the same answer, or a
		* host that has not populated the mirror would silently hide a feature nobody
		* switched off. That is also why only the literal `false` disables the row.
		*/
		/** Settings field the switch writes (declared in the plugin Config schema). */
		const SIDEBAR_ROW_FIELD = "sidebarRow";
		/**
		* Whether the sidebar entry should exist.
		*
		* Never throws: a locked-down host makes `getSnapshot()` unusable, and the
		* documented degradation there is the settings page, not a missing entry.
		*/
		function readSidebarRow(scope) {
			if (scope === void 0) return true;
			try {
				const value = scope.getSnapshot().value;
				if (value === null || typeof value !== "object") return true;
				return value[SIDEBAR_ROW_FIELD] !== false;
			} catch {
				return true;
			}
		}
		//#endregion
		//#region src/client/distribution.ts
		/** Display order: the default first, then the rest by how often they are wanted. */
		const DIST_OPTIONS = [
			"sticky",
			"priority",
			"balanced",
			"round-robin",
			"expiry"
		];
		/** Localized name of one distribution mode. */
		function distLabel(option, t) {
			const at = t;
			if (option === "sticky") return at?.("row.distSticky") ?? "Per conversation";
			if (option === "priority") return at?.("row.distPriority") ?? "Priority";
			if (option === "balanced") return at?.("row.distBalanced") ?? "Balanced";
			if (option === "expiry") return at?.("row.distExpiry") ?? "Expiring first";
			return at?.("row.distRoundRobin") ?? "Round-robin";
		}
		/** One-line explanation of what a mode does to caching and spend. */
		function distHint(option, t) {
			const at = t;
			if (option === "sticky") return at?.("row.distStickyHint") ?? "";
			if (option === "priority") return at?.("row.distPriorityHint") ?? "";
			if (option === "balanced") return at?.("row.distBalancedHint") ?? "";
			if (option === "expiry") return at?.("row.distExpiryHint") ?? "";
			return at?.("row.distRoundRobinHint") ?? "";
		}
		//#endregion
		//#region src/status-paths.ts
		/**
		* Node-free constants and types shared by the Host and browser halves of the
		* XD Pool settings card.
		*
		* Pool's runtime state already lives in `src/status.ts` (`buildStatus` /
		* `WorkBuddyStatus`); this module only carves the cross-domain (Host→browser)
		* JSON document into a shape that stays token-free and matches what the
		* browser card renders. Route paths are plugin-owned and mounted on the Host's
		* same-origin web server (see `src/web-status.ts`).
		*
		* @module dsh-xdpool/status-paths
		*/
		/** Plugin-owned read-only pool status endpoint (account rows + models + shim). */
		const POOL_STATUS_PATH = "/plugins/dsh-xdpool/status";
		/** Plugin-owned local account rescan endpoint (re-read desktop snapshots). */
		const POOL_RESCAN_PATH = "/plugins/dsh-xdpool/accounts/rescan";
		/**
		* Re-fetch the upstream model catalog for both regions.
		*
		* Separate from {@link POOL_RESCAN_PATH} because they answer different
		* questions, and conflating them misled users: "detect accounts again" only
		* re-read the desktop snapshots, so it could NOT recover a model list that had
		* fallen back to the static table after a failed startup fetch. The only way
		* out was restarting DSH.
		*/
		const POOL_CATALOG_REFRESH_PATH = "/plugins/dsh-xdpool/models/refresh";
		/** Plugin-owned cooldown reset endpoint (clear all 429 cooldowns). */
		const POOL_RESET_COOLDOWN_PATH = "/plugins/dsh-xdpool/cooldowns/reset";
		/** Plugin-owned daily check-in action endpoint (claim today's reward). */
		const POOL_CHECKIN_PATH = "/plugins/dsh-xdpool/checkin";
		/**
		* Throw one account out of the pool for good, or take it back.
		*
		* Separate from the disable route because the semantics differ: disabling is a
		* rotation preference the account survives, ignoring survives the account.
		*/
		const POOL_ACCOUNT_IGNORE_PATH = "/plugins/dsh-xdpool/accounts/ignored";
		/** Run one automation job immediately, so the card can verify it on demand. */
		const POOL_AUTOMATION_RUN_PATH = "/plugins/dsh-xdpool/automation/run";
		/** Set or clear one account's reserved-credit floor. */
		const POOL_CREDIT_RESERVE_PATH = "/plugins/dsh-xdpool/accounts/credit-reserve";
		/**
		* Name the account to try first, or hand the choice back to the strategy.
		*
		* A route rather than a settings write for the reason the ignore list is a file:
		* the CLI has no settings service, so a card-only settings key could be written
		* by the card and never by `dsh-xdpool prefer`. The route owns the
		* write, pushes it into the pool immediately so the very next request sees it,
		* and is the one path both halves share.
		*/
		const POOL_ACCOUNT_PREFER_PATH = "/plugins/dsh-xdpool/accounts/preferred";
		/**
		* Read the aggregate lane's state: every registry provider, its saved setting
		* (never its key), and whether it can serve anything right now.
		*
		* Separate from {@link POOL_STATUS_PATH} because it answers a different
		* question — "what can I configure" rather than "what is my pool doing" — and
		* because its payload is the WHOLE roster. Folding 76 provider records into the
		* status document would make every 30-second poll of the pool card carry a
		* directory nobody reads most of the time.
		*/
		const POOL_AGGREGATE_PATH = "/plugins/dsh-xdpool/aggregate";
		/**
		* Save one aggregate provider's setting: its key, its on/off switch, its base-URL
		* override, or the model ids a listing round discovered.
		*
		* POST only, and one provider per request — read-modify-write on the host side,
		* so two tabs editing two providers cannot clobber each other.
		*/
		const POOL_AGGREGATE_SAVE_PATH = "/plugins/dsh-xdpool/aggregate/save";
		/**
		* Verify one provider's key with a cheap non-generating call, and report what
		* its listing answered.
		*
		* Its own route because it is the only aggregate action that talks to the
		* network: a probe must never run as a side effect of saving a setting, or
		* "save" would silently spend the user's rate limit.
		*/
		const POOL_AGGREGATE_TEST_PATH = "/plugins/dsh-xdpool/aggregate/test";
		/**
		* Send one real streaming call to one model and report how it answered.
		*
		* Its own route, and POST-only, for the same reason the provider probe is: this
		* is the one action in the plugin that spends the user's credits, so it must
		* never be reachable by a prefetch, a GET, or any side effect of opening a
		* settings page. A GET here would let a browser — or anything else that can
		* reach a loopback port — fire unlimited billed calls by walking URLs.
		*
		* `provider` and `model` are resolved through the host's own adapter registry
		* rather than through this plugin's lanes, because that registry is the only
		* place that knows which credential and endpoint a given provider id serves.
		*/
		const POOL_MODEL_PROBE_PATH = "/plugins/dsh-xdpool/model/test";
		/**
		* POST-only: ask what models several login channels contribute right now.
		*
		* A route rather than more fields on {@link POOL_CHANNELS_PATH} because the
		* answer changes as accounts come and go while the roster does not, and the
		* login page polls only its own logins — folding live per-provider catalogues
		* into the roster document would either go stale the moment someone signed in,
		* or make every page refresh spend a round trip on thirteen providers.
		*
		* Read from the host rather than from the pack's own `model.list`, because the
		* pack keeps only `id`, `name` and two flags and throws away exactly the fields
		* this is for. The host's catalogue is the same one the model picker reads, so
		* the two agree by construction instead of by luck.
		*/
		const POOL_CHANNEL_MODELS_PATH = "/plugins/dsh-xdpool/channels/models";
		/**
		* Fetch one provider's live model list and write it back as its discovered set.
		*
		* Separate from the probe on purpose. The probe ANSWERS; this one COMMITS — it
		* changes what the provider contributes to the picker — so it is its own route
		* with its own confirmation, and a failed round keeps the previous roster.
		*/
		const POOL_AGGREGATE_DISCOVER_PATH = "/plugins/dsh-xdpool/aggregate/discover";
		/**
		* The thirteen login channels the vendored pack provides.
		*
		* Separate from the aggregate document for the same reason: the two lanes answer
		* different questions. The aggregate roster is "what can I point a key at", the
		* channel list is "what can I scan a QR code into", and mixing them in one poll
		* would put a third-party directory on the critical path of the pool card.
		*/
		const POOL_CHANNELS_PATH = "/plugins/dsh-xdpool/channels";
		/**
		* The routing chains, and the whole model roster a member may name.
		*
		* One route for both because the editor cannot be drawn without the roster: a
		* member is chosen from a list, and a list of ids with no names, windows or
		* vendors is a list nobody can pick from. Reading two documents on one panel
		* open would also mean the roster could be a second older than the chains.
		*/
		const POOL_COMBOS_PATH = "/plugins/dsh-xdpool/combos";
		/**
		* Replace the whole chain list in one write.
		*
		* A single table replace rather than a per-chain patch: the editor's unit of
		* intent is "this is my routing table", and deleting one member is
		* indistinguishable from deleting that member's chain once ids are equal — so a
		* merge rule would have to guess, and a wrong guess silently resurrects a row the
		* user deleted.
		*/
		const POOL_COMBOS_SAVE_PATH = "/plugins/dsh-xdpool/combos/save";
		/**
		* The LAN relay's own state, and the only way to change it.
		*
		* One GET and one POST rather than a separate settings surface, because the relay
		* is a switch you have to be able to kill from the same card that turns it on —
		* a relay left listening on a network interface is the one failure here that
		* keeps mattering after the plugin is closed.
		*/
		const POOL_RELAY_PATH = "/plugins/dsh-xdpool/relay";
		/**
		* The pack's own management route, which the card posts to directly.
		*
		* Not a re-export of anything: the vendored bundle registers this path itself
		* and speaks its own RPC envelope (`{type, rpcId, method, payload}` →
		* `{type, rpcId, result}`). Proxying it through a second route would mean
		* translating that envelope in one direction and back in the other, for no gain
		* — the pack is on the same loopback origin as this card either way.
		*
		* Only three methods are ever sent: `account.create` to begin a login, `login.poll`
		* to watch it finish, and `account.list` to show what is connected. `provider.status`
		* was added so the account pool could mirror the login page's per-channel counts,
		* and it left again with that section: the user removed the mirror ("在扫码登录页
		* 登录过什么，这里就同步显示什么，这个不需要"), so nothing asks for counts now.
		* The method still exists in the pack for anyone who wants it; it is simply not on
		* this card's origin.
		*/
		const CHANNEL_PACK_RPC_PATH = "/api/channel-pack";
		/**
		* Read the usage panel's aggregate.
		*
		* GET only, and token-free by construction: the recorder holds counts and
		* timings, never a prompt. The document type is `UsageSummary` from
		* `src/stats.ts` rather than a copy declared here, because that module stays
		* Node-free precisely so the browser half can import the SAME declaration
		* instead of a second one that could quietly drift.
		*/
		const POOL_USAGE_PATH = "/plugins/dsh-xdpool/usage";
		Object.freeze([
			"priority",
			"round-robin",
			"balanced",
			"sticky",
			"expiry"
		]);
		/**
		* The schedule every automation job falls back to.
		*
		* Shared by both halves on purpose. The host uses it when a configured hour
		* list arrives empty (the settings schema materializes "never configured" into
		* `[]`), and the card uses it when it writes the `automation` block back, so a
		* document that already holds an empty list is healed instead of being saved
		* back as an unrunnable schedule.
		*
		* This lives here rather than in `scheduler.ts` because the browser half cannot
		* import the host module: `scheduler.ts` pulls in `node:crypto` and the whole
		* upstream client, none of which exists in the browser bundle. Two hand-written
		* copies would drift, and the drift is invisible — the card would write a
		* schedule the scheduler does not run.
		*/
		const DEFAULT_AUTOMATION_HOURS = {
			checkin: [9],
			report: [10],
			tasks: [11],
			streak: [12],
			travel: [9, 21],
			compensation: [13]
		};
		//#endregion
		//#region src/client/styles.ts
		const POOL_CARD_CSS = `

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
/* The expander under a collapsed model list. A full-width quiet strip rather
   than a floating link: it belongs to the list above it, and a centred pill
   would read as a separate action. */
.dsm-xdpool-model-more{margin-top:8px;width:100%;appearance:none;padding:8px 12px;border-radius:10px;border:1px dashed color-mix(in srgb, var(--dsw-alias-border-l2,#36373b) 92%, transparent);background:transparent;color:var(--dsw-alias-label-secondary,#c6c9d0);font:inherit;font-size:12px;line-height:17px;font-weight:600;cursor:pointer;transition:color .18s ease, border-color .18s ease, background .18s ease}
.dsm-xdpool-model-more:hover{color:var(--dsw-alias-state-business-primary,#5686fe);border-color:color-mix(in srgb, var(--dsw-alias-state-business-primary,#5686fe) 48%, transparent);background:color-mix(in srgb, var(--dsw-alias-state-business-primary,#5686fe) 7%, transparent)}
/* "N saved models not offered right now": the one line that stops a roster
   change from reading as lost settings. Amber, not red — nothing is broken. */
.dsm-xdpool-region-pane-warn{font-size:11px;line-height:15px;color:color-mix(in srgb, #f0a441 78%, var(--dsw-alias-label-secondary,#c6c9d0));white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:210px;cursor:help}
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
.dsm-xdpool-sidebar-row-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:6px}
.dsm-xdpool-models-actions{display:flex;align-items:center;gap:8px;flex:none}
/* "Built-in list (offline)" chip: a warning tint, since the user is looking at
   a SHORTER roster than the gateway offers and may wonder where models went. */
.dsm-xdpool-catalog-offline{flex:none;padding:2px 9px;border-radius:999px;font-size:11px;line-height:17px;font-weight:600;background:var(--dsw-alias-state-warning-subtle,rgba(217,119,6,.15));color:var(--dsw-alias-state-warning-primary,#d97706);white-space:nowrap}
/* Automation: run-now button and the per-job progress line. */
.dsm-xdpool-auto-run{flex:none}
.dsm-xdpool-auto-job-detail{grid-column:1/-1;color:var(--dsw-alias-label-tertiary,#9aa0a8);font-size:11px;line-height:16px}
/* Per-item counts, grouped by status. Deliberately quieter than the detail
   line above: the sentences are the narrative, these are the tally. Colour
   carries the meaning so four chips stay scannable — grey for a non-event, amber
   for "not yet" (the only one that implies something may still happen), red only
   for a real failure. */
.dsm-xdpool-auto-job-items{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:6px;margin-top:2px}
.dsm-xdpool-auto-job-item{appearance:none;padding:1px 7px;border-radius:999px;border:1px solid transparent;font-size:10px;line-height:15px;font-weight:600;letter-spacing:.01em;cursor:default;background:color-mix(in srgb, var(--dsw-alias-label-tertiary,#9aa0a8) 12%, transparent);color:var(--dsw-alias-label-secondary,#c6c9d0)}
.dsm-xdpool-auto-job-item-claimed{background:color-mix(in srgb, #3ec98a 16%, transparent);border-color:color-mix(in srgb, #3ec98a 38%, transparent);color:color-mix(in srgb, #3ec98a 86%, var(--dsw-alias-label-primary,#e9ebef))}
.dsm-xdpool-auto-job-item-already{background:color-mix(in srgb, var(--dsw-alias-label-tertiary,#9aa0a8) 10%, transparent);color:var(--dsw-alias-label-tertiary,#9aa0a8)}
.dsm-xdpool-auto-job-item-skipped{background:color-mix(in srgb, #f0a441 14%, transparent);border-color:color-mix(in srgb, #f0a441 34%, transparent);color:color-mix(in srgb, #f0a441 82%, var(--dsw-alias-label-primary,#e9ebef))}
.dsm-xdpool-auto-job-item-failed{background:color-mix(in srgb, #ef5f5f 16%, transparent);border-color:color-mix(in srgb, #ef5f5f 40%, transparent);color:color-mix(in srgb, #ef5f5f 86%, var(--dsw-alias-label-primary,#e9ebef))}
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

`.trim();
		const AGGREGATE_CARD_CSS = `

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

`.trim();
		const CHANNEL_CARD_CSS = `

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

`.trim();
		const SHELL_CSS = `

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
/* The group button, next to the star, sharing the brand row.
   The nav is a grid of 1fr auto; a second control in the same cell would
   STACK on top of the star rather than sit beside it (grid items in one cell
   overlap). So the track list grows to three: brand | star | group, and both
   buttons are pinned to row 1 on their own columns. Auto-placement alone puts
   them under the tab strip, because the strip comes first in the DOM. */
.dsm-xdpool-nav{grid-template-columns:1fr auto auto}
.dsm-xdpool-star{grid-column:2;grid-row:1}
.dsm-xdpool-group{grid-column:3;grid-row:1;margin-left:6px;cursor:pointer;font:inherit;font-size:12.5px;line-height:17px;font-weight:650;color:color-mix(in srgb, var(--dsw-alias-state-business-primary,#5686fe) 82%, var(--dsw-alias-label-secondary,#c6c9d0));border-color:color-mix(in srgb, var(--dsw-alias-border-l2,#ffffff1f) 88%, transparent);background:linear-gradient(140deg, color-mix(in srgb, var(--dsw-alias-bg-layer-3,#23252b) 72%, transparent), transparent 70%)}
.dsm-xdpool-group:hover{transform:translateY(-1px);color:var(--dsw-alias-state-business-primary,#5686fe);box-shadow:0 0 0 4px color-mix(in srgb, var(--dsw-alias-state-business-primary,#5686fe) 9%, transparent), 0 8px 22px rgb(0 0 0 / 22%)}
/* The pulse is on the icon only, and slow: this button is a door, not a call to
   action, and a card that nags is a card people mute. */
.dsm-xdpool-group:hover svg{transform:scale(1.1)}
.dsm-xdpool-group svg{fill:currentColor;transition:transform .28s cubic-bezier(.34,1.56,.64,1)}
/* The invite dialog. Positioned against the shell (which is the containing
   block) so it covers the card and nothing of the host dialog around it. */
/* The invite, expanded in the flow directly under the tab strip.
   No overlay and no positioning: it is a disclosure, so it pushes the panels below
   down by its own height and appears exactly where the 交流群 button sits. Two earlier
   attempts are worth remembering — absolute measured against the page column (so it
   landed half-way down the scroll), and fixed centred it as a modal (correct for a
   modal, but the ask was "show it HERE"). */
.dsm-xdpool-groupinline{display:flex;justify-content:center}
.dsm-xdpool-groupcard{display:flex;flex-direction:column;align-items:center;gap:10px;max-width:520px;padding:16px 18px 18px;border-radius:16px;border:1px solid color-mix(in srgb, var(--dsw-alias-border-l2,#ffffff1f) 86%, transparent);background:var(--dsw-alias-bg-layer-2,#1c1e22);box-shadow:0 18px 48px rgb(0 0 0 / 34%), inset 0 1px 0 rgb(255 255 255 / 7%)}
/* The two codes sit side by side and WRAP to a column before either shrinks:
   a QR squeezed narrower than its module grid is a QR that stops scanning, so
   the layout gives up the row rather than the size. */
.dsm-xdpool-groupcodes{display:flex;flex-wrap:wrap;justify-content:center;gap:14px;width:100%}
.dsm-xdpool-groupcode{display:flex;flex-direction:column;align-items:center;gap:6px;flex:0 0 auto}
.dsm-xdpool-groupcode-label{font-size:12px;line-height:16px;font-weight:650;color:var(--dsw-alias-label-primary,#e8e8ea)}
.dsm-xdpool-groupcode-step{max-width:220px;font-size:11px;line-height:15px;color:var(--dsw-alias-label-tertiary,#8a90a0);text-align:center}
.dsm-xdpool-groupcardhead{display:flex;align-items:center;gap:10px;width:100%;font-size:13px;line-height:18px;color:var(--dsw-alias-label-primary,#e8e8ea)}
.dsm-xdpool-groupclose{margin-left:auto;appearance:none;border:none;background:transparent;padding:0 4px;font:inherit;font-size:18px;line-height:18px;color:var(--dsw-alias-label-tertiary,#8a90a0);cursor:pointer;border-radius:8px}
.dsm-xdpool-groupclose:hover{color:var(--dsw-alias-label-primary,#e8e8ea)}
/* A white plate under the code, always: a QR inverted onto a dark panel scans
   on some phones and not others, and there is no way to tell which from here. */
.dsm-xdpool-groupqr{display:block;width:220px;height:220px;border-radius:12px;background:#fff;padding:6px;object-fit:contain}
.dsm-xdpool-groupnote{width:100%;margin:0;font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-tertiary,#8a90a0);text-align:center}
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

`.trim();
		const LEDGER_CARD_CSS = `

/* The tables carry many columns; the wrapper scrolls rather than forcing the
   settings section itself to, which would drag the whole card sideways. */
/* A failed turn stays visible instead of being greyed into the background: the
   point of a recent-calls table is being able to see the failures. */
/* Long model ids and account emails get clipped rather than wrapped: a wrapped
   number column breaks the alignment that makes it scannable. */

`.trim();
		const ROUTING_CARD_CSS = `

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
/* Collapsed chain: one capsule per platform, numbered by priority.
   A wrapping row, not a list — these are labels to scan, not rows to operate, and
   the count after the dot is what makes "tries TRAE first, one model there" legible
   without opening the editor. */
.dsm-xdpool-rt-lanes{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 0;padding:0;list-style:none}
.dsm-xdpool-rt-lane{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,#36373b);background:color-mix(in srgb, var(--dsw-alias-bg-layer-1,#191a1e) 62%, transparent);font-size:12px;line-height:18px}
.dsm-xdpool-rt-lanename{color:var(--dsw-alias-label-primary,#e9ebef);font-weight:560;max-width:210px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsm-xdpool-rt-lanecount{color:var(--dsw-alias-label-tertiary,#9aa0a8);font-variant-numeric:tabular-nums}
/* Editor: one box per platform, visually nested so "these models belong to that
   platform" is spatial rather than something the reader has to infer from ids. */
.dsm-xdpool-rt-laneboxes{display:flex;flex-direction:column;gap:10px}
.dsm-xdpool-rt-lanebox{display:flex;flex-direction:column;gap:8px;padding:11px 12px;border-radius:12px;border:1px solid color-mix(in srgb, var(--dsw-alias-state-business-primary,#5686fe) 26%, var(--dsw-alias-border-l2,#36373b));background:color-mix(in srgb, var(--dsw-alias-bg-layer-1,#191a1e) 58%, transparent)}
.dsm-xdpool-rt-lanebox-head{display:flex;align-items:center;gap:8px;min-width:0}
.dsm-xdpool-rt-lanebox-name{font-size:13px;line-height:19px;font-weight:640;color:var(--dsw-alias-label-primary,#e9ebef);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsm-xdpool-rt-laneacts{display:flex;flex-wrap:wrap;gap:6px}
.dsm-xdpool-rt-laneacts .dsm-xdpool-rt-drop{min-width:0}
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

`.trim();
		const GATEWAY_CARD_CSS = `

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
/* The gateway's shared-model picker. Grouped by lane, and each row carries BOTH
   the display name and the wire id, because for the login channels they are
   different words: the user knows the model as "Qwen3.8-Flash · 免费" and has to
   type "qfmodel" into the client. Showing only one of the two makes the list
   either unreadable or unusable. */
.dsm-xdpool-gw-group{margin-top:10px;display:flex;flex-direction:column;gap:2px;min-width:0}
.dsm-xdpool-gw-group-title{margin:0 0 2px;color:var(--dsw-alias-label-tertiary,#8a90a0);font-size:11px;line-height:16px;font-weight:650;letter-spacing:.1px;text-transform:lowercase}
.dsm-xdpool-gw-model{display:grid;grid-template-columns:16px minmax(0,1fr) auto;align-items:center;gap:8px;padding:3px 6px;border-radius:8px;cursor:pointer;min-width:0}
.dsm-xdpool-gw-model:hover{background:color-mix(in srgb, var(--dsw-alias-bg-layer-1,#191a1e) 60%, transparent)}
.dsm-xdpool-gw-model input{appearance:none;width:14px;height:14px;margin:0;border-radius:4px;border:1px solid var(--dsw-alias-border-l2,#36373b);background:color-mix(in srgb, var(--dsw-alias-bg-layer-1,#191a1e) 78%, transparent);cursor:pointer;display:grid;place-items:center}
.dsm-xdpool-gw-model input:checked{background:var(--dsw-alias-brand-primary,#5686fe);border-color:var(--dsw-alias-brand-primary,#5686fe)}
.dsm-xdpool-gw-model input:checked::after{content:"";width:6px;height:3px;border-left:1.5px solid #fff;border-bottom:1.5px solid #fff;transform:rotate(-45deg) translateY(-1px)}
.dsm-xdpool-gw-model input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px}
.dsm-xdpool-gw-model-name{color:var(--dsw-alias-label-primary,#e8e8ea);font-size:12px;line-height:17px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.dsm-xdpool-gw-model-id{font-family:var(--dsw-alias-font-mono,ui-monospace,Menlo,Consolas,monospace);font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#8a90a0);white-space:nowrap}
.dsm-xdpool-gw-btn:hover:not(:disabled){transform:translateY(-1px);border-color:color-mix(in srgb, var(--dsw-alias-brand-primary,#5686fe) 55%, var(--dsw-alias-border-l2,#36373b));color:var(--dsw-alias-label-primary,#e8e8ea)}
.dsm-xdpool-gw-btn:active:not(:disabled){transform:translateY(0);box-shadow:inset 0 2px 4px rgb(0 0 0 / 22%)}
.dsm-xdpool-gw-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:2px}
.dsm-xdpool-gw-btn[data-on="true"]{border-color:color-mix(in oklab, var(--dsw-alias-state-success-primary,#22a06b) 55%, transparent);background:color-mix(in oklab, var(--dsw-alias-state-success-primary,#22a06b) 14%, transparent);color:var(--dsw-alias-state-success-primary,#22a06b);font-weight:600}
.dsm-xdpool-gw-btn[data-on="true"]:hover:not(:disabled){border-color:color-mix(in oklab, var(--dsw-alias-state-success-primary,#22a06b) 78%, transparent);color:var(--dsw-alias-state-success-primary,#22a06b)}
.dsm-xdpool-gw-btn:disabled{opacity:.5;cursor:default;filter:saturate(.35);transform:none}

`.trim();
		const SHARED_CARD_CSS = `

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
   aggregate row's three links rendered as bare browser buttons — which is how a
   secondary action ends up looking like the primary one. */
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
/* Numeric columns, header AND cells together.
   The bare .dsm-xdpool-num rule could never win: .dsm-xdpool-table th is (0,1,1)
   and .dsm-xdpool-num is (0,1,0), so every numeric HEADER stayed left-aligned
   while its cells went right — the column read as shifted against its own title.
   Both selectors below out-specify the th rule, so the pair moves together and
   the table lines up. */
.dsm-xdpool-table th.dsm-xdpool-num,
.dsm-xdpool-table td.dsm-xdpool-num,
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

`.trim();
		/**
		* Frame for hosting the pool in the main column instead of the settings dialog.
		*
		* `.centerCol` is `overflow:hidden`, so this element is the scrollport; without
		* it the page clips at the fold. The horizontal inset is asymmetric on purpose —
		* the sidebar sits on the left of this column, so the left edge needs less air
		* than the right one to look centred.
		*/
		const PAGE_CSS = `
.dsm-xdpool-page{flex:1 1 auto;height:100%;min-height:0;overflow:auto;box-sizing:border-box;padding:20px 28px 34px}
.dsm-xdpool-page > .dsm-xdpool-shell{margin:0 auto}
@media (max-width:720px){.dsm-xdpool-page{padding:14px 16px 26px}}
`.trim();
		//#endregion
		//#region src/client/avatar.ts
		/**
		* Plugin user avatar (data URI) for the XD Pool card nav.
		*
		* User-supplied artwork (940x940 JPEG), center-cropped to a square and scaled to
		* 128px at quality 88 before being embedded: a 57KB photo in a nav bar that is
		* re-rendered on every locale/theme change is waste, and the nav slot only ever
		* draws it at 16-32px. The full-resolution original lives in the host
		* attachment store; keeping a second full-size copy in the bundle buys nothing.
		*
		* REPLACED from the previous artwork on the user's instruction, so the nav now
		* shows the photo they supplied rather than the one that shipped with 1.9.0. The
		* processing rule above is unchanged — only the source pixels differ — so the
		* nav slot keeps its 128px square and its 5KB bundle cost either way.
		*
		* @module dsh-xdpool/client/avatar
		*/
		const POOL_CARD_AVATAR = "data:image/jpeg;base64,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";
		//#endregion
		//#region src/client/community-qr.ts
		/** WeChat bot's contact code. Scanning adds the bot; send `XD` to be pulled in. */
		const COMMUNITY_QR_WECHAT = "data:image/png;base64,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";
		/** QQ group join code. Scanning is joining — no message to send. */
		const COMMUNITY_QR_QQ = "data:image/png;base64,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";
		//#endregion
		//#region src/client/shell.tsx
		/**
		* The card shell: brand bar, page tabs, per-page hero.
		*
		* Everything here is chrome. The pages themselves own their data and their
		* actions, so this module never fetches anything — it is handed the tab list,
		* the current tab and a setter, and it draws.
		*
		* Three decisions worth stating, because they are the ones a rewrite usually
		* gets wrong:
		*
		* 1. **The active page is remembered in `localStorage`.** This card lives
		*    inside the host's Settings dialog, which the user opens to go look at one
		*    specific thing. Forgetting the page on every reopen turns "open Settings"
		*    into "re-orient", and a settings panel you always land at the top of is a
		*    settings panel people stop opening. A missing key (first run, private
		*    window with storage blocked, a quota error) falls back to the first tab
		*    rather than throwing: the shell must render even when storage does not.
		*
		* 2. **The glider tracks the button's real box, on both axes.** It is measured
		*    with `offsetLeft/offsetTop/offsetWidth/offsetHeight` and absolutely
		*    positioned, because the tab strip wraps to a second row in a narrow
		*    settings panel. A `translate` only — the usual choice — lands the
		*    highlight on the correct button at the correct x, in the wrong row.
		*
		* 3. **Nothing here is a gate.** The star button opens the repository in a new
		*    tab and nothing else, and the group button beside it opens a dialog with
		*    the WeChat invite code. A settings card that can refuse to render is a card
		*    that, on a machine without outbound network, looks exactly like a broken
		*    plugin.
		*
		* @module dsh-xdpool/client/shell
		*/
		/** localStorage key for the remembered page. */
		const SHELL_TAB_KEY = "xdpool.tab";
		/**
		* Read the remembered page, tolerating every way storage can refuse.
		*
		* `getItem` throws in a partitioned third-party context and when cookies are
		* blocked; JSON.parse throws on anything a previous version (or another plugin)
		* wrote under this key. Both mean "start at the beginning", not "fail".
		*/
		function readRememberedTab() {
			try {
				const raw = window.localStorage.getItem(SHELL_TAB_KEY);
				return raw === null || raw === "" ? void 0 : raw;
			} catch {
				return;
			}
		}
		function rememberTab(id) {
			try {
				window.localStorage.setItem(SHELL_TAB_KEY, id);
			} catch {}
		}
		/** A single statistic above the usage tables. */
		function KpiCard({ label, value, sub }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsm-xdpool-kpi dsm-xdpool-glass",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsm-xdpool-kpi-label",
						children: label
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsm-xdpool-kpi-value",
						children: value
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsm-xdpool-kpi-sub",
						children: sub ?? ""
					})
				]
			});
		}
		/**
		* A page's own header: title, one line of "what is this for", and whatever
		* pills or actions the page needs on the right.
		*
		* The actions slot is page-owned. The pool page re-detects accounts, the
		* channels page opens a login window, and neither belongs in the brand bar
		* above the tabs, where they would apply to whichever page you are not on.
		*/
		function PageHero({ title, sub, actions, pills }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dsm-xdpool-hero dsm-xdpool-glass",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsm-xdpool-pagehead",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "dsm-xdpool-pagecopy",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
								className: "dsm-xdpool-pagetitle",
								children: title
							}), sub === void 0 || sub === "" ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dsm-xdpool-pagesub",
								children: sub
							})]
						}),
						pills === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dsm-xdpool-pills",
							children: pills
						}),
						actions === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dsm-xdpool-pageactions",
							children: actions
						})
					]
				})
			});
		}
		/**
		* Brand bar + tab strip + page body.
		*
		* The remembered tab is resolved once on mount and then owned by the caller:
		* after that the parent is the only thing allowed to move the selection, so a
		* `storage` event from another window cannot fight a click in this one.
		*/
		function PoolShell({ t, version, avatar, tabs, active, onSelect, hero, children }) {
			/** Measured box of the active tab's button, in tab-strip coordinates. */
			const [glider, setGlider] = (0, react.useState)(void 0);
			/** Whether the group-invite dialog is open. Local: nothing outside needs it. */
			const [groupOpen, setGroupOpen] = (0, react.useState)(false);
			/**
			* Close the dialog on Escape.
			*
			* The overlay's own click handler covers the pointer, but a keyboard user who
			* opened this with Enter has no other way out — and a modal with no key exit
			* is a trap. Bound only while open, so the listener is not paid for on every
			* page of a card that is mostly not showing a dialog.
			*/
			(0, react.useEffect)(() => {
				if (!groupOpen) return void 0;
				const onKey = (event) => {
					if (event.key === "Escape") setGroupOpen(false);
				};
				window.addEventListener("keydown", onKey);
				return () => {
					window.removeEventListener("keydown", onKey);
				};
			}, [groupOpen]);
			const tabRefs = (0, react.useRef)(/* @__PURE__ */ new Map());
			const tabsRef = (0, react.useRef)(null);
			const measure = (0, react.useCallback)(() => {
				const strip = tabsRef.current;
				const button = tabRefs.current.get(active);
				if (strip === null || button === null || button === void 0) {
					setGlider(void 0);
					return;
				}
				setGlider({
					left: button.offsetLeft,
					top: button.offsetTop,
					width: button.offsetWidth,
					height: button.offsetHeight
				});
			}, [active]);
			(0, react.useLayoutEffect)(measure, [measure, tabs]);
			(0, react.useEffect)(() => {
				window.addEventListener("resize", measure);
				return () => {
					window.removeEventListener("resize", measure);
				};
			}, [measure]);
			const select = (0, react.useCallback)((id) => {
				rememberTab(id);
				onSelect(id);
			}, [onSelect]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsm-xdpool-shell",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("style", { children: SHARED_CARD_CSS }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("style", { children: SHELL_CSS }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-xdpool-aurora",
						"aria-hidden": "true",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", {}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", {}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", {})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("nav", {
						className: "dsm-xdpool-nav",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsm-xdpool-brand",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
									className: "dsm-xdpool-avatar",
									src: avatar,
									alt: ""
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsm-xdpool-brand-copy",
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: "dsm-xdpool-brand-title",
										children: [t?.("shell.brand") ?? "XD Pool", version === void 0 || version === "" ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: "dsm-xdpool-version",
											children: ["v", version]
										})]
									})
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("a", {
								className: "dsm-xdpool-star",
								href: "https://github.com/XDTrees/dsh-xdpool",
								target: "_blank",
								rel: "noreferrer",
								title: t?.("shell.starHint") ?? "Open this plugin on GitHub",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
									width: "15",
									height: "15",
									viewBox: "0 0 24 24",
									"aria-hidden": "true",
									focusable: "false",
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
										fill: "currentColor",
										d: "M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3-5.8 3 1.1-6.5L2.6 9.4l6.5-.9z"
									})
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t?.("shell.star") ?? "Star on GitHub" })]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: "dsm-xdpool-star dsm-xdpool-group",
								title: t?.("shell.groupHint") ?? "扫码加入 XD 交流群",
								onClick: () => {
									setGroupOpen(true);
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
									width: "15",
									height: "15",
									viewBox: "0 0 24 24",
									"aria-hidden": "true",
									focusable: "false",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
										fill: "currentColor",
										d: "M9.1 3.4c-3.6 0-6.5 2.4-6.5 5.4 0 1.7 1 3.2 2.6 4.2l-.7 2.1 2.4-1.2c.7.2 1.4.3 2.2.3h.4a5.6 5.6 0 0 1-.2-1.5c0-3 2.9-5.4 6.5-5.4h.5C15.7 5.1 12.7 3.4 9.1 3.4zm-2.3 2.9a.9.9 0 1 1 0 1.8.9.9 0 0 1 0-1.8zm4.6 0a.9.9 0 1 1 0 1.8.9.9 0 0 1 0-1.8z"
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
										fill: "currentColor",
										d: "M21.4 12.7c0-2.5-2.4-4.5-5.4-4.5s-5.4 2-5.4 4.5 2.4 4.5 5.4 4.5c.6 0 1.2-.1 1.8-.2l2 1-.6-1.7c1.4-.9 2.2-2.2 2.2-3.6zm-7.2-1.4a.8.8 0 1 1 0 1.6.8.8 0 0 1 0-1.6zm3.6 0a.8.8 0 1 1 0 1.6.8.8 0 0 1 0-1.6z"
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t?.("shell.group") ?? "交流群" })]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsm-xdpool-navtabs",
								role: "tablist",
								ref: tabsRef,
								children: [glider === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsm-xdpool-navglider",
									style: {
										transform: `translate(${String(glider.left)}px, ${String(glider.top)}px)`,
										width: `${String(glider.width)}px`,
										height: `${String(glider.height)}px`
									}
								}), tabs.map((tab) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									role: "tab",
									"aria-selected": tab.id === active,
									ref: (element) => {
										tabRefs.current.set(tab.id, element);
									},
									className: `dsm-xdpool-navtab${tab.id === active ? " dsm-xdpool-navtab-on" : ""}`,
									onClick: () => {
										select(tab.id);
									},
									children: [tab.label, tab.num === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dsm-xdpool-navtabnum",
										children: tab.num
									})]
								}, tab.id))]
							})
						]
					}),
					!groupOpen ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsm-xdpool-groupinline",
						role: "dialog",
						"aria-modal": "false",
						"aria-label": t?.("shell.groupTitle") ?? "XD 交流群",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsm-xdpool-groupcard",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dsm-xdpool-groupcardhead",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: t?.("shell.groupTitle") ?? "XD 交流群" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dsm-xdpool-groupclose",
										"aria-label": t?.("shell.groupClose") ?? "关闭",
										onClick: () => {
											setGroupOpen(false);
										},
										children: "×"
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dsm-xdpool-groupcodes",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "dsm-xdpool-groupcode",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
												className: "dsm-xdpool-groupqr",
												src: COMMUNITY_QR_WECHAT,
												alt: t?.("shell.groupWechatAlt") ?? "微信机器人二维码：扫码添加后发送 XD，即可被拉进群",
												width: 220,
												height: 220
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "dsm-xdpool-groupcode-label",
												children: t?.("shell.groupWechat") ?? "微信（机器人）"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "dsm-xdpool-groupcode-step",
												children: t?.("shell.groupWechatStep") ?? "扫码添加机器人后，发送「XD」拉你进群"
											})
										]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "dsm-xdpool-groupcode",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
												className: "dsm-xdpool-groupqr",
												src: COMMUNITY_QR_QQ,
												alt: t?.("shell.groupQqAlt") ?? "QQ 群二维码：直接扫码加入 XD 交流群",
												width: 220,
												height: 220
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "dsm-xdpool-groupcode-label",
												children: t?.("shell.groupQq") ?? "QQ 群"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "dsm-xdpool-groupcode-step",
												children: t?.("shell.groupQqStep") ?? "直接扫码即可加入"
											})
										]
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "dsm-xdpool-groupnote",
									children: t?.("shell.groupNote") ?? "两个群都在；哪个方便用哪个。二维码失效了在 GitHub 提 issue 说一声，会更新。"
								})
							]
						})
					}),
					hero === void 0 ? null : hero,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsm-xdpool-body",
						children
					})
				]
			});
		}
		/**
		* Pick the initial page from a remembered id, the tab list and a fallback.
		*
		* Exported so the parent can run exactly the same check while hydrating: a
		* remembered id that this build no longer carries must land on the first tab
		* instead of rendering a page whose component does not exist.
		*/
		function initialShellTab(remembered, tabs) {
			const first = tabs[0]?.id;
			if (first === void 0) return "";
			return remembered !== void 0 && tabs.some((tab) => tab.id === remembered) ? remembered : first;
		}
		/** Read the remembered page id, tolerating storage being unavailable. */
		function rememberedShellTab() {
			return typeof window === "undefined" ? void 0 : readRememberedTab();
		}
		//#endregion
		//#region src/client/LedgerPage.tsx
		/**
		* The 数据看板 (ledger) page.
		*
		* Five numbers across the top, three tables below: recent calls, accounts,
		* models. Every figure is read straight out of {@link UsageSummary} — this
		* page re-derives nothing, because a dashboard whose KPI disagrees with the
		* table under it is worse than no dashboard, because it gets trusted.
		*
		* Two distinctions this page is built around, both of which are easy to lose in
		* a rewrite and both of which are the whole reason the numbers are trustworthy:
		*
		* - **A turn is not a call.** One question that rotated three accounts is one
		*   turn and three calls. Both appear, always as separate numbers.
		* - **"no tokens" is not "no report".** A gateway that ignored
		*   `stream_options` produces the same zeroes as a gateway that reported zero,
		*   and only `usageReported` separates them. When it is false the KPI says the
		*   gateway said nothing — it never prints a confident `0` it cannot back up.
		*
		* The recorder is in-memory (see `UsageRecorder`), so the totals describe this
		* process only. The page says so rather than implying a history that does not
		* exist: a dashboard that looks durable and resets at midnight is the kind of
		* thing users stop trusting after exactly one midnight.
		*
		* @module dsh-xdpool/client/LedgerPage
		*/
		/** How many recent calls the detail table lists. */
		const DETAIL_ROWS = 12;
		function fmtInt(value) {
			return value.toLocaleString("en-US");
		}
		/** Milliseconds as `1.2s` / `340ms`, because `1200ms` is not a unit anyone reads. */
		function fmtMs(ms) {
			return ms >= 1e3 ? `${(ms / 1e3).toFixed(1)}s` : `${String(ms)}ms`;
		}
		/** Tokens per second, kept integer: 12.4 tok/s reads as false precision. */
		function fmtTps(value) {
			return value === null ? "—" : `${fmtInt(value)}`;
		}
		function fmtClock(at) {
			const d = new Date(at);
			return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
		}
		/**
		* Cache hit rate, or null when no input tokens were ever counted.
		*
		* Null rather than zero: with `usageReported === false` the numerator and
		* denominator are both absent, and printing `0%` there would claim the cache
		* never helped when the truth is that nothing was measured.
		*/
		function cacheHitRate(summary) {
			let input = 0;
			let cached = 0;
			for (const row of summary.rows) {
				input += row.inputTokens;
				cached += row.cachedTokens;
			}
			const total = input + cached;
			return total === 0 ? null : cached / total;
		}
		function regionLabel(region, t) {
			return region === "global" ? t?.("ledger.global") ?? "Global" : t?.("ledger.cn") ?? "CN";
		}
		/**
		* The channel a call went through, as the table's first column.
		*
		* A provider id (`opencode`, `raccoon`, `codearts`) is printed as-is, because that
		* is the same spelling the aggregate page and the model picker use — inventing a
		* second name here would make one vendor look like two. `workbuddy` and `free` get
		* a translated label since they are lanes of this plugin rather than vendors.
		*
		* Falls back to the region for a sample filed before this field existed, so an old
		* in-memory window still renders something true instead of a blank cell.
		*/
		function channelLabel(call, t) {
			const channel = call.channel ?? "";
			if (channel === "workbuddy" || channel === "") return regionLabel(call.region, t);
			if (channel === "free") return t?.("ledger.channelFree") ?? "Free lane";
			return channel;
		}
		/**
		* In / out / cached for one call, or `—` when that call reported no usage.
		*
		* `—` rather than `0`: a call that never received a usage block is a missing
		* measurement, and the model table's share column would then divide a total by
		* rows that contributed nothing and quietly shrink it.
		*/
		/**
		* The three numeric cells for one call: input, output, cached.
		*
		* A fixed-length TUPLE, not `string[]`, so the header can never drift out of step
		* with the body. The table renders these through `.map`, which means a fourth
		* header added without a fourth value here — or a third value dropped — would
		* silently shift every numeric column against its title. That is precisely the
		* misalignment this was rebuilt to fix, and a `string[]` type cannot see it.
		*/
		function tokenCells(call) {
			if (call.usage === void 0) return [
				"—",
				"—",
				"—"
			];
			return [
				fmtInt(call.usage.inputTokens),
				fmtInt(call.usage.outputTokens),
				fmtInt(call.usage.cachedTokens)
			];
		}
		function LedgerPage({ t, usage: shared }) {
			const [own, setOwn] = (0, react.useState)(shared);
			const [failed, setFailed] = (0, react.useState)(false);
			const mounted = (0, react.useRef)(true);
			(0, react.useEffect)(() => {
				if (shared !== void 0) setOwn(shared);
			}, [shared]);
			(0, react.useEffect)(() => () => {
				mounted.current = false;
			}, []);
			/**
			* Poll only while this page is mounted.
			*
			* The pool card already polls for its own panel, so when a copy is shared
			* there is nothing to fetch here. Without one this page owns the timer, and
			* unmounting it stops the timer — a hidden dashboard must not keep a 30s
			* request alive for a tab nobody is looking at.
			*/
			const load = (0, react.useCallback)(async (signal) => {
				try {
					const response = await fetch(POOL_USAGE_PATH, {
						headers: { accept: "application/json" },
						credentials: "same-origin",
						...signal === void 0 ? {} : { signal }
					});
					if (!response.ok) {
						if (mounted.current) setFailed(true);
						return;
					}
					const value = await response.json().catch(() => void 0);
					if (mounted.current && signal?.aborted !== true) {
						setOwn(value);
						setFailed(false);
					}
				} catch {
					if (mounted.current && signal?.aborted !== true) setFailed(true);
				}
			}, []);
			(0, react.useEffect)(() => {
				if (shared !== void 0) return;
				const controller = new AbortController();
				load(controller.signal);
				const timer = window.setInterval(() => {
					load(controller.signal);
				}, 3e4);
				return () => {
					window.clearInterval(timer);
					controller.abort();
				};
			}, [load, shared]);
			const summary = own;
			/**
			* Totals are summed here rather than read from a server-side total, because
			* the server publishes per-model rows and the page is the only place that
			* knows which rows are on screen. Summing the rows it is about to render is
			* what keeps the KPI and the table from being able to disagree.
			*/
			const totals = (0, react.useMemo)(() => {
				if (summary === void 0) return void 0;
				let input = 0;
				let output = 0;
				let reasoning = 0;
				let cached = 0;
				let tpsWeighted = 0;
				let tpsWeight = 0;
				let ttftWeighted = 0;
				let ttftWeight = 0;
				for (const row of summary.rows) {
					input += row.inputTokens;
					output += row.outputTokens;
					reasoning += row.reasoningTokens;
					cached += row.cachedTokens;
					if (row.tps !== null) {
						tpsWeighted += row.tps * row.calls;
						tpsWeight += row.calls;
					}
					if (row.avgTtftMs !== null) {
						ttftWeighted += row.avgTtftMs * row.calls;
						ttftWeight += row.calls;
					}
				}
				return {
					input,
					output,
					reasoning,
					cached,
					avgTps: tpsWeight === 0 ? null : Math.round(tpsWeighted / tpsWeight),
					avgTtftMs: ttftWeight === 0 ? null : Math.round(ttftWeighted / ttftWeight)
				};
			}, [summary]);
			const details = (0, react.useMemo)(() => summary?.entries.slice(0, DETAIL_ROWS) ?? [], [summary]);
			const accounts = summary?.accounts ?? [];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("style", { children: LEDGER_CARD_CSS }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(PageHero, {
					title: t?.("ledger.title") ?? "Data dashboard",
					sub: t?.("ledger.sub") ?? "What this machine actually sent and got back, since the pool last started.",
					pills: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsm-xdpool-pill",
						children: t?.("ledger.window", { count: summary?.samples ?? 0 }) ?? `last ${summary?.samples ?? 0} calls`
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsm-xdpool-pill",
						"data-tone": "off",
						children: t?.("ledger.memoryOnly") ?? "cleared on restart"
					})] })
				}),
				failed ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: "dsm-xdpool-note",
					role: "alert",
					children: t?.("ledger.failed") ?? "Could not read the usage numbers. The pool itself is unaffected."
				}) : null,
				summary === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: "dsm-xdpool-note",
					children: t?.("ledger.loading") ?? "Reading the recorded calls…"
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsm-xdpool-kpis",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(KpiCard, {
							label: t?.("ledger.tokens") ?? "Tokens",
							value: summary.usageReported ? fmtInt(totals?.input ?? 0) : t?.("ledger.notReported") ?? "not reported",
							sub: summary.usageReported ? t?.("ledger.tokenSplit", {
								input: fmtInt(totals?.input ?? 0),
								output: fmtInt(totals?.output ?? 0)
							}) ?? `in ${fmtInt(totals?.input ?? 0)} · out ${fmtInt(totals?.output ?? 0)}` : t?.("ledger.notReportedHint") ?? "the gateway ignored stream_options.include_usage"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(KpiCard, {
							label: t?.("ledger.turns") ?? "Turns",
							value: fmtInt(summary.turns),
							sub: t?.("ledger.callsSub", { calls: summary.calls }) ?? `${summary.calls} upstream calls`
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(KpiCard, {
							label: t?.("ledger.speed") ?? "Speed",
							value: totals?.avgTps === null || totals?.avgTps === void 0 ? "—" : `${fmtInt(totals.avgTps)} tok/s`,
							sub: totals?.avgTtftMs === null || totals?.avgTtftMs === void 0 ? t?.("ledger.speedNone") ?? "no timing reported" : t?.("ledger.ttft", { ms: fmtMs(totals.avgTtftMs) }) ?? `ttft ${fmtMs(totals.avgTtftMs)}`
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(KpiCard, {
							label: t?.("ledger.cache") ?? "Cache hit",
							value: (() => {
								const rate = cacheHitRate(summary);
								return rate === null || !summary.usageReported ? "—" : `${Math.round(rate * 100)}%`;
							})(),
							sub: summary.usageReported ? t?.("ledger.cacheSub", { cached: fmtInt(summary.rows.reduce((n, r) => n + r.cachedTokens, 0)) }) ?? "" : ""
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(KpiCard, {
							label: t?.("ledger.requests") ?? "Requests",
							value: fmtInt(summary.calls),
							sub: summary.failedTurns === 0 ? t?.("ledger.allOk") ?? "no turn failed outright" : t?.("ledger.failedSub", {
								failed: summary.failedTurns,
								recovered: summary.recoveredTurns
							}) ?? `${summary.failedTurns} failed · ${summary.recoveredTurns} recovered`
						})
					]
				}), details.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: "dsm-xdpool-note",
					children: t?.("ledger.empty") ?? "No calls recorded yet. Start a conversation and this fills in."
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: "dsm-xdpool-sec",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
							className: "dsm-xdpool-sectitle",
							children: t?.("ledger.recent") ?? "Recent calls"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dsm-xdpool-tablewrap",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("table", {
								className: "dsm-xdpool-table",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t?.("ledger.colTime") ?? "Time" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t?.("ledger.colChannel") ?? "Channel" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t?.("ledger.colModel") ?? "Model" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t?.("ledger.colAccount") ?? "Account" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
										className: "dsm-xdpool-num",
										children: t?.("ledger.colIn") ?? "In"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
										className: "dsm-xdpool-num",
										children: t?.("ledger.colOut") ?? "Out"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
										className: "dsm-xdpool-num",
										children: t?.("ledger.colCached") ?? "Cached"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
										className: "dsm-xdpool-num",
										children: t?.("ledger.colTtft") ?? "TTFT"
									})
								] }) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tbody", { children: details.map((entry, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", {
									"data-ok": entry.ok,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: fmtClock(entry.at) }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: channelLabel(entry, t) }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
											className: "dsm-xdpool-ellipsis",
											title: entry.model,
											children: entry.model
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
											className: "dsm-xdpool-ellipsis",
											title: entry.account ?? "",
											children: entry.account ?? t?.("ledger.noAccount") ?? "—"
										}),
										tokenCells(entry).map((cell, cellIndex) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
											className: "dsm-xdpool-num",
											children: cell
										}, String(cellIndex))),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
											className: "dsm-xdpool-num",
											children: entry.ttftMs === void 0 ? "—" : fmtMs(entry.ttftMs)
										})
									]
								}, `${entry.turnId}:${String(entry.at)}:${String(index)}`)) })]
							})
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: "dsm-xdpool-sec",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
							className: "dsm-xdpool-sectitle",
							children: t?.("ledger.accounts") ?? "By account"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dsm-xdpool-tablewrap",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("table", {
								className: "dsm-xdpool-table",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t?.("ledger.colAccount") ?? "Account" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t?.("ledger.colChannel") ?? "Channel" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
										className: "dsm-xdpool-num",
										children: t?.("ledger.colTurns") ?? "Turns"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
										className: "dsm-xdpool-num",
										children: t?.("ledger.colCalls") ?? "Calls"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
										className: "dsm-xdpool-num",
										children: t?.("ledger.colIn") ?? "In"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
										className: "dsm-xdpool-num",
										children: t?.("ledger.colOut") ?? "Out"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t?.("ledger.colModels") ?? "Usually runs" })
								] }) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tbody", { children: accounts.map((row) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
										className: "dsm-xdpool-ellipsis",
										title: row.account,
										children: row.account === "" ? t?.("ledger.unattributed") ?? "(unattributed)" : row.account
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: channelLabel(row, t) }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
										className: "dsm-xdpool-num",
										children: fmtInt(row.turns)
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
										className: "dsm-xdpool-num",
										children: fmtInt(row.calls)
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
										className: "dsm-xdpool-num",
										children: fmtInt(row.inputTokens)
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
										className: "dsm-xdpool-num",
										children: fmtInt(row.outputTokens)
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
										className: "dsm-xdpool-ellipsis",
										title: row.topModels.join(", "),
										children: row.topModels.join(", ") || "—"
									})
								] }, `${row.region}:${row.account}`)) })]
							})
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: "dsm-xdpool-sec",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
							className: "dsm-xdpool-sectitle",
							children: t?.("ledger.models") ?? "By model"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dsm-xdpool-tablewrap",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("table", {
								className: "dsm-xdpool-table",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t?.("ledger.colChannel") ?? "Channel" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t?.("ledger.colModel") ?? "Model" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
										className: "dsm-xdpool-num",
										children: t?.("ledger.colCalls") ?? "Calls"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
										className: "dsm-xdpool-num",
										children: t?.("ledger.colTps") ?? "tok/s"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
										className: "dsm-xdpool-num",
										children: t?.("ledger.colTtft") ?? "TTFT"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
										className: "dsm-xdpool-num",
										children: t?.("ledger.colShare") ?? "Share"
									})
								] }) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tbody", { children: summary.rows.map((row) => {
									const share = (totals?.input ?? 0) === 0 ? 0 : Math.round(row.inputTokens / (totals?.input ?? 1) * 100);
									return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: channelLabel(row, t) }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
											className: "dsm-xdpool-ellipsis",
											title: row.model,
											children: row.model
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
											className: "dsm-xdpool-num",
											children: fmtInt(row.calls)
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
											className: "dsm-xdpool-num",
											children: fmtTps(row.tps)
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
											className: "dsm-xdpool-num",
											children: row.avgTtftMs === null ? "—" : fmtMs(row.avgTtftMs)
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
											className: "dsm-xdpool-num",
											children: summary.usageReported ? `${share}%` : "—"
										})
									] }, `${row.channel}:${row.region}:${row.model}`);
								}) })]
							})
						})]
					})
				] })] })
			] });
		}
		//#endregion
		//#region src/client/brand-tile.tsx
		/**
		* The glyph shapes a tile can wear, as SVG `mask-image` payloads.
		*
		* Written with single-quoted attributes and percent-encoded `#` because the
		* payload lands inside a CSS `url("…")`: a double quote in the SVG closes the
		* url() early, and a raw `#` starts a colour.
		*/
		const BRAND_TILE_GLYPHS = Object.freeze({
			/** A key: for a sign-in channel. */
			login: "url('data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><circle cx='8.2' cy='8.2' r='3.6' fill='none' stroke='white' stroke-width='1.8'/><path d='M10.9 10.9 19 19M16.2 16.2l2.1-2.1M18.4 18.4l1.9-1.9' stroke='white' stroke-width='1.8' stroke-linecap='round'/></svg>')",
			/** Two stacked bubbles: for a lane that serves a conversation. */
			chat: "url('data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path d='M3.6 5.6h10.2A3.8 3.8 0 0 1 17.6 9.4v.6h.6a3.6 3.6 0 0 1 3.6 3.6a3.6 3.6 0 0 1-3.6 3.6H12l-4 3a.6.6 0 0 1-1-.46V17H7.4a3.8 3.8 0 0 1-3.8-3.8z' fill='none' stroke='white' stroke-width='1.7' stroke-linejoin='round'/></svg>')",
			/** A globe: for the international lane. */
			globe: "url('data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><circle cx='12' cy='12' r='8.2' fill='none' stroke='white' stroke-width='1.7'/><path d='M3.8 12h16.4' stroke='white' stroke-width='1.7'/><path d='M12 3.8c2.2 2.3 3.3 5.1 3.3 8.2s-1.1 5.9-3.3 8.2c-2.2-2.3-3.3-5.1-3.3-8.2S9.8 6.1 12 3.8z' fill='none' stroke='white' stroke-width='1.7'/></svg>')"
		});
		/**
		* At most two characters, upper-cased, punctuation dropped.
		*
		* A defensive clamp rather than a formatting nicety: the value is written as
		* text inside a fixed 40px tile, and a longer or lowercase string would either
		* overflow the tile or render at a size the caller did not measure.
		*/
		function tileInitials(value) {
			if (value === void 0) return void 0;
			const letters = [...value].filter((character) => /[0-9A-Za-z一-鿿]/u.test(character)).slice(0, 2).join("").toUpperCase();
			return letters === "" ? void 0 : letters;
		}
		/**
		* One 40px tile.
		*
		* The accent reaches CSS through a custom property rather than through an
		* inline `background`, because the gradient has to be composed with a neutral
		* underlay — see decision 3 in the module header.
		*/
		function BrandTile({ accent, glyph, icon, initials, className }) {
			const letters = icon === void 0 ? tileInitials(initials) : void 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				"aria-hidden": "true",
				className: `dsm-xdpool-tile${icon === void 0 ? "" : " dsm-xdpool-tile-art"}${letters === void 0 ? "" : " dsm-xdpool-tile-letters"}${className === void 0 ? "" : ` ${className}`}`,
				style: {
					"--dsm-xdpool-tile-accent": accent,
					"--dsm-xdpool-tile-glyph": letters === void 0 ? BRAND_TILE_GLYPHS[glyph] : "none",
					"--dsm-xdpool-tile-icon": icon === void 0 ? "none" : `url("${icon}")`
				},
				children: letters
			});
		}
		//#endregion
		//#region src/client/channel-icons.ts
		/**
		* Real channel logos, carried over from the upstream Channel Pack artwork.
		*
		* The pack itself ships no icons: `vendor/channel-pack/pack.js` contains a single
		* `data:image/` occurrence and it sits inside a CSP-violation string, not an
		* asset table. These eight are the same PNGs the Our Free Model plugin embeds
		* for the same thirteen channels, taken from the upstream pack artwork it cites,
		* so the mark a user sees here is the mark they already know from that product.
		*
		* Five channels have no artwork (LobsterAI, TRAE, Loomy, MiniMax, Gemini) and
		* fall back to the gradient-and-glyph tile, which is why `BrandTile` still exists
		* rather than being replaced outright.
		*
		* Keyed by `ChannelProviderId` but typed loosely on purpose: the map is consulted
		* with a plain string from the status payload, and a missing key is the normal
		* fallback path rather than an error.
		*/
		const CHANNEL_ICONS = Object.freeze({
			codearts: "data:image/png;base64,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",
			buddy: "data:image/png;base64,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",
			workbuddy: "data:image/png;base64,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",
			qoder: "data:image/png;base64,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",
			qodercn: "data:image/png;base64,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",
			cline: "data:image/png;base64,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",
			raccoon: "data:image/png;base64,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",
			zcode: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAgklEQVR42u3XsRGAIAyF4UxgYe0g7j+FpZtgRwN36stLAhruqP+v4ICIdNaybsViy92yCj+CeMW7CO94gwgFRMUrIgFTAPbzgPe/Aa5nAInTAGicAtDE1QBtXAVgxGEAeuIpAFYYArDj81xEoQDLd+A1ID8k3wTkXDDEaDbEcBo1nl/XXoK4yMqvMgAAAABJRU5ErkJggg=="
		});
		/**
		* Two letters from a vendor's own name, for the tile that has no logo.
		*
		* Shared rather than computed at each call site because the account-pool lanes
		* and the login-channel cards must agree: both are the same tile, and a reader
		* who learned that "WB" means WorkBuddy on one page must not see "Wor" on the
		* next. Words split on whitespace, so "WorkBuddy 国内版" yields "WO" rather than
		* "工" — the Latin part is the part a reader recognises.
		*/
		/**
		* Two letters from a vendor's own name, for the tile that has no logo.
		*
		* Shared rather than computed at each call site because the account-pool lanes
		* and the login-channel cards must agree: both are the same tile, and a reader
		* who learned that "WB" means WorkBuddy on one page must not see something else
		* on the next.
		*
		* The split is on whitespace AND on camelCase humps, then two letters come from
		* two DIFFERENT segments. Both rules are load-bearing. Whitespace alone gives
		* "Loomy" and "LobsterAI" the same "LO" - two vendors drawn identically, which
		* is the defect being fixed. Taking the first two letters of one segment gives
		* "TRAE" a bare "T", which looks sparse at 40px. CamelCase splitting resolves
		* both: LobsterAI -> LA, Loomy -> L, TRAE -> TR, MiniMax Code -> MM.
		*/
		function channelInitials(name) {
			const segments = name.split(/\s+/u).flatMap((word) => word.replace(/([a-z0-9])([A-Z])/gu, "$1 $2").split(" ")).map((segment) => [...segment].filter((character) => /[0-9A-Za-z]/u.test(character)).join("")).filter((segment) => segment !== "");
			if (segments.length >= 2) return (([...segments[0] ?? ""][0] ?? "") + ([...segments[1] ?? ""][0] ?? "")).toUpperCase();
			return [...segments[0] ?? ""].slice(0, 2).join("").toUpperCase();
		}
		/**
		* The artwork for `id`, or undefined when this build carries none.
		*
		* Returning undefined rather than a placeholder keeps the decision in one place:
		* the caller draws the initials tile, so there is exactly one fallback rule.
		*/
		function channelIcon(id) {
			return CHANNEL_ICONS[id];
		}
		//#endregion
		//#region src/client/provider-icons.ts
		/**
		* Vendor artwork for the aggregate channels list.
		*
		* Two shapes live in this table on purpose. Vendors simple-icons carries arrive as a
		* single path painted white, because the card paints no gradient behind an icon and a
		* near-black mark would vanish into the dark surface. The rest arrive as PNG favicons.
		* A vendor with neither is simply absent, and the row falls back to vendor initials.
		*/
		const PROVIDER_ICONS = {
			"agnes": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAAVFBMVEVHcEwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD////r6+uenp5JSUn4+PguLi6Li4u+vr5lZWXf398XFxesrKx8fHzNzc3T09P3FUjLAAAADHRSTlMARlz0jOmmdsPaDSjm2IwuAAAChklEQVRYhZ1XWaKDIAysda/gWtfe/56PVSCsvvlqwYmYTELyennwyeqqKXOE8rKp6uzje86NrigRQFl0yfQ6h2xho06iF242RxF/e4hO8Q7SP22Mj1Ab8Oc7TqfIfPwqje/1RBOhrVf/W/nP5j/8E1MMXgsxPsIcM/9XPf7+UxgQR4B+iPt/AQbMWHyifDQLA+u9oushQT/oy/g/tdAqflS/DAPhH/qCUnUSn2AH/yU/mH8h1A8PYOOJBwjm4TuYK/wInvpj0X+GDBhKyu/S+CPQEUeX7sKJGzjNVSpoq/46IZU8msttkoopGHvDGK6/XlkS/6L8b48nuJGlBZHnMsmnDe7USYWQZ+KxkkPArSpeiQh6ZoBm0wC3mpQg8EReqCNOuNcm6JBHsGdSGOFmGc+kVQpgx3YUUR41IErZwSxZUSQGIp+wcz5lHo4okk8IO3GflIJ/jigSJwbDKPmsFE6OKJIwhoQ0C37PjNm5iKiQAlIWJQBjVkwvmYuLXltrlUzW8eRlRu6SZVk2+usaYEJlKp17YOEr+cNdTRwlQSso5s7Yy+cv+ndT/FXnt6qkjbrt/X69DL08wzUbxyxUUV1VyVwVnQdAbuMN3k2s+eTfIIpev/UY23yR0oAu7tdaN2BCk+5gmBN4a1fb6eDryh1dJ9Av19HmL8bDDgN373w/YHy+6W8WB/cBRId0hF6PmBRAMmptM2txNPdPdtqhcQN8vVfkej64ie1YbboDRpsnU2qegxwdoOV+3OZY00vKBaPBanUfWnDwH4wLHv4DP3int7RewT/ypA1dzmlFIdr3h8c+imDLkja71p7rro2/XaIrLGe0D4ZvDjr+t2Wely0d/72P/QEnxpwy+WBTJgAAAABJRU5ErkJggg==",
			"alibaba_cloud": "data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22white%22 d=%22M3.996 4.517h5.291L8.01 6.324 4.153 7.506a1.668 1.668 0 0 0-1.165 1.601v5.786a1.668 1.668 0 0 0 1.165 1.6l3.857 1.183 1.277 1.807H3.996A3.996 3.996 0 0 1 0 15.487V8.513a3.996 3.996 0 0 1 3.996-3.996m16.008 0h-5.291l1.277 1.807 3.857 1.182c.715.227 1.17.889 1.165 1.601v5.786a1.668 1.668 0 0 1-1.165 1.6l-3.857 1.183-1.277 1.807h5.291A3.996 3.996 0 0 0 24 15.487V8.513a3.996 3.996 0 0 0-3.996-3.996m-4.007 8.345H8.002v-1.804h7.995Z%22/%3E%3C/svg%3E",
			"anthropic": "data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22white%22 d=%22M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z%22/%3E%3C/svg%3E",
			"azure_openai": "data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22white%22 d=%22M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z%22/%3E%3C/svg%3E",
			"baidu": "data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22white%22 d=%22M9.154 0C7.71 0 6.54 1.658 6.54 3.707c0 2.051 1.171 3.71 2.615 3.71 1.446 0 2.614-1.659 2.614-3.71C11.768 1.658 10.6 0 9.154 0zm7.025.594C14.86.58 13.347 2.589 13.2 3.927c-.187 1.745.25 3.487 2.179 3.735 1.933.25 3.175-1.806 3.422-3.364.252-1.555-.995-3.364-2.362-3.674a1.218 1.218 0 0 0-.261-.03zM3.582 5.535a2.811 2.811 0 0 0-.156.008c-2.118.19-2.428 3.24-2.428 3.24-.287 1.41.686 4.425 3.297 3.864 2.617-.561 2.262-3.68 2.183-4.362-.125-1.018-1.292-2.773-2.896-2.75zm16.534 1.753c-2.308 0-2.617 2.119-2.617 3.616 0 1.43.121 3.425 2.988 3.362 2.867-.063 2.553-3.238 2.553-3.988 0-.745-.62-2.99-2.924-2.99zm-8.264 2.478c-1.424.014-2.708.925-3.323 1.947-1.118 1.868-2.863 3.05-3.112 3.363-.25.309-3.61 2.116-2.864 5.42.746 3.301 3.365 3.237 3.365 3.237s1.93.19 4.171-.31c2.24-.495 4.17.123 4.17.123s5.233 1.748 6.665-1.616c1.43-3.364-.808-5.109-.808-5.109s-2.99-2.306-4.736-4.798c-1.072-1.665-2.348-2.268-3.528-2.257zm-2.234 3.84l1.542.024v8.197H7.758c-1.47-.291-2.055-1.292-2.13-1.462-.072-.173-.488-.976-.268-2.343.635-2.049 2.447-2.196 2.447-2.196h1.81zm3.964 2.39v3.881c.096.413.612.488.612.488h1.614v-4.343h1.689v5.782h-3.915c-1.517-.39-1.59-1.465-1.59-1.465v-4.317zm-5.458 1.147c-.66.197-.978.708-1.05.928-.076.22-.247.78-.1 1.269.294 1.095 1.248 1.144 1.248 1.144h1.37v-3.34z%22/%3E%3C/svg%3E",
			"bazaarlink": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAAZlBMVEXw8PMAAADz8/b////7+/74+PuZmZvj4+bHx8r6+vvOztDDw8U7OzxgYGHs7O+cnJ5DQ0SsrK7W1tmmpqgyMjNWVle1tbeMjI0ZGRmTk5Vra2xxcXJMTE0eHh4jIyQTExOBgYIrKywb6kVbAAACfklEQVRYhaWX2YKCMAxFm5CIA4ICivv2/z85KYpsLS2QF53anLZZOrcqEGNUMwxZ+6og+Jvj/bE/DVjgrwkqWOKvxJ2XAVjNil9jC93dfOZQ0exVkKIDAOzKeQikeAdwzLZvOGU8OdbM2Qnu4ohM8QagwEkIxi3Avt460lr2cvZHsFoB3OLWyQUh0Tgrn6ZBTo8ASd4LHFJ+AXiFLgRSeAW49t2/CNtPrTk6b6/Usgxy+AI4RDaE5O0meRvrjs/5dmsjgrOHJNwZ6ipB98IwbQOb2KvkWC+VUH/0CkXgW7FIV8h6k1MAv/UrQLCCU/cQGEnXHMzBGa6vaxvSIQBg4248ZN1jNgDAYzwPSOX+O9MCEFtZEajjD05A1TUGd0nfszUpHAFIPQ7KmbHoThkH6MZrx7Oqv1HA+rv5TTOjaWlW5767ANAECKuGqu221gWL6jh0twJQ2v7V2gUrjk3uI4CUKG0QFwrN/lZADklE1MSUVn6AuAHIxlP+EdQcAOyZzxMBvyN8jlyimgvAdCUFmyG9XQBjIWlsQFmBipw7sABCyUIg2S/nA6QCQ/qVPs4BAER8mAiIakBafb6J7w6A+UKRLJRv/YW5mAbIP6PSwiIoErhwPcKDi6A+m+oS6nFpYS1LlAtw69163FxYokxYuno7Dsj79z9/zl7ZYxvl2fc7GQGHgX+tygZmAthUhuiLZAgo+iNjOkcUzqs3PegBXEpL4t/dc5C1/9r6qHupoZMRcPcWrMhl/f/h+QPsJ0lmUZZJB+ApfzoILQvlCPpiuPlJjz6CQ7lZRQ5cRsXlqDFH8dpLIdu3gU7Ns4BeuS9+9i1+eC5/+i5+fC98/v8DkRwb4FPNflgAAAAASUVORK5CYII=",
			"bedrock": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAAdVBMVEUjLz7///8cKTkhLT0WJTYTIzQOIDIZJzcAFywAEyoAByQAECj19vcAGS7v8PHW2Nvm5+hTW2cIHDDf4eOipqySl51tdHxdZG6xtLkxO0gAAB56gIgpNUSBho2rrrNmbXa6vcFLU16JjpXOz9I8RlPDxckAAAMqqCy5AAACfUlEQVRYhe1V2Y7bMAwUdfuIJcvytb6P9P8/sZQTFCg29r4WhechAkhxRI7GCiE3bty48b+CCp0kkaSECKlCgEt+xKXAH4c5py7rl3KztvALF6WvcCvt/BDitV8Fz0fMNdMFA9tTOJAtiYEsIaxNIV0oiQwUX9U72bPzBnKYh7weAZ7xCrAzDABMKvD4OIOiyuvSXBAQqp2g6muGNMlTWIUsAUslrwCWBak0pcJd1AcKIYTuABJewCzdBh6Mlh6s3gEa5tR1OeP5WpZdCRA5LOKtBQZZj4J499gA7Fj34orAzfBGpGqAtgbzy0ItASpO2y0kisGd12Or8Kzq4YkErC2gG2D8aqCcwBJGaJSPBVJ0/HQAYmGLuYpQgyh0M8/Q6QHmEebHIZAUdQbbqREYyaDRjOk5EPAJigxavqTZBhPHasoYw4YMPZ/BgmlZj4NAjrtxsRFTFo2Flpj80jOWW5jPZRRYmpkUthSegkgUrXFEoyKbZArnsiZosF90EI0Zblvj0uAu3hUFGl9Nx0LUoWC6LacaHj20+94Lpmg4hRL2WshxpiD7vrfq4vwARul3r70jDJNcSHFKwS+bC5CkHvxan9hZ+C6+fC1IP75s6uXHtKqgmJw4/1rY3gzT1BVnBEQs6IOu1R9UeIHGj7qKPQxns6oePWibvJf8Owc6cV8LsMkTXXbaZFLZ8MXNHYuclByvkx7KO61zbzA1txq2K7H5o8xez+LW+G7KA6rVz8URNLmWHeTXUst+NfAJ6VYrRagpL5+UMAfetrfp39WZGZbwT8H6+qf6QKGczAf/fPWdmqas9uhtQPaDlf+AcqmT+ADq+eFWbty4ceOfw2/KDSaCQgTeSAAAAABJRU5ErkJggg==",
			"byteplus": "data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22white%22 d=%22M19.8772 1.4685L24 2.5326v18.9426l-4.1228 1.0563V1.4685zm-13.3481 9.428l4.115 1.0641v8.9786l-4.115 1.0642v-11.107zM0 2.572l4.115 1.0642v16.7354L0 21.428V2.572zm17.4553 5.6205v11.107l-4.1228-1.0642V9.2568l4.1228-1.0642z%22/%3E%3C/svg%3E",
			"cerebras": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAAb1BMVEVHcEz////////////////////////////////////////////vWijuSQDvVyHvUhfvTgkAAAD+9vP86+bvbELveFP31cv4xrj0rJnykHXyhWTymoL44dr1t6byooxvb2+kpKTFxcVLS0sgICBHcEy3IuSYAAAAJXRSTlMAzLsu8nMOjuRRp/////////////////////////////////8A+dnQ1AAAA95JREFUWIW9V9mS4jAMhCEQQPExzn0RYP7/H1eSA9g5DLtTtXqgQpVbllptWd5sVuxw2p+3xwggOm7P+9Nhbd2y7eIjTOwY7z6G72doa9H+I3jsYkyaej7it/DTc21RNYkQIpuEEY7isB2XlY3QSsokkfmMjACf4/amUhqxiJZKzxwAnN5kX2lFYKVFVl+qcoHNFSa+bOoJwZXIqs6GYxY8fK3jWyEJ3iL5xSUnFoVQWVtO3GxX8CbD7aVoEc0sJtY4nT4cA+efEu86S6FMxINFxcXAT62rAA/Mf0rciwrSjD5426a9XOpcCQ5GKZdRrxYHjp9WiQIq2l3qZGSRXfe5IG5F43Dh6oH1k0mEddBooiEvmEU5cog+mF5RvxwcJwk0uIVIgWhUSQFp/WSRkmk6SHOtPGG/VE3/SsHxEx63MQ2HTCxaDlWCa3rpF9OtgMHAkWYOo0dvTJrQeV1bDtH33GIngFbRuanQjSihxmgSLavHUU6rZHoo3RD2tIQSMB3+6p5pVAqF01X54zQuCfrBAvWfWiXqQnVQNdSUTYOsZBj6/Di7FhF+R/5payh1IhNmU1/A5JaHoAPYjRT2HADCRcG+WkgVq0lnbdBBPGaAsYu00MRjzWxaVedL1M9ysBnIDBqZ6ILY1IaCkboEcx3u9+Ea8HBgFWLyqgKESionfl5QDjqF4Xu0dRcnLiKidIcZIA8kBOZUdPDz/bTVXPabM/7mSAFU6KXoNBUSP1ULd0Ler1f0c1uN4MwHUVH5kAJhsByYOnFqboRn5LCOx95GRUAOG1YR1FQO+p9zAAHkaMdNxEXAuBVVgpPpmA3E/7zF43GI+CBgyrwtNRUgOnuDDob/5YB05KUgxhS+3+OjF4kkPhKyJTFjFYU0aO3olxFsGSmO9PaUYEjL25eQLiRHLABm02sKyQp5GILlPPtSroB6IoDtbPeXlLs1B7F3mDBze5h6zS36OsJ/1iM4OceZEulsc4Rc8SUHt+swXENd4eA0lJIztw2FaoJ3QZ8GsGSR19Jo144uCJSVveiVEOGeGHtNtWctlbYp2lFjYcjybOe3dcm3U0ttPTfQ0YwR7srR5GIp7P1IFwN1RDBl29QhB/vX1Wa5q5kGjJ4dvbfp5dpTOQhaCrqa3tpzzKE/9nqnKYXqb5p3BXQC8AYMo3T4LnLMGZt5xCHt6NQEWXPNGXH8IetT84Zub8z7zCYjtz9ofmCzgdsbdZfnEdcWxm1/2F7tINYWhu3nuC/9cf/T/Z884IND/OOD4/dPntmja7EfhB5dm18/+xwmxmz++uFJ9sunL9kvH99snz7//wAPm6ejJUXrRQAAAABJRU5ErkJggg==",
			"cheaperinference": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAAWlBMVEX///8EDRAAAAD6+vrt7u7Z2tqJiovw8fHe3t7p6urm5+e8vb329vawsbIAAAPj5OSZmps+QEIABgo2OTrP0NBJS0zGxsdYWlulpqdlZ2hxc3R+f4CUlZWfoKHUWrsYAAABuUlEQVRYhb2X4ZaCIBCFccRQIzPLanfb93/NxSwcQHB0TntPfxTuFwwIM0JY5VpJkpTORShVV6aBJK2qWnl2HbxZkKo1fpTVOvugSiK/jPeLa3Jt808+vWH8o6oxDvVW/8uqVsYf6+llDOBpzjdHYFCVC82YgZmDHn4Mmb+Xcx8GWbn8IECVk4pYpxjg2PbgqECNBVq3ecD1ZCwZFgaYxl0SIHvP7QJOphFkArAP7RjQg/MYAtoZO3LcIEsD7rN+6/iCLA24zPvfjm/wZ+QDoEsBfiBbAOwiAxgdU2sMkHuL724kFJ4Y4BcDOujveyvlDC8GODfYfxGulgEaDwCCk24ZgNcQWt9PABwwILxrlgF4F0Lg/w8AewpOEB8bAO4yHtcDvI10XQ/wtvKpPbx1pwF09GO60gCRz7kb+1MAswfKy08DzBxpHZTkIPpxdPxEgHiA57f7gQgwGxohGrSfqABRn6GxfnSskAHmdjuPl2sDOH/CAJ0GCFE+hgva8ZtbwepgX6YSDFm66VddvIWyqo+mOFQAO81jJ5rsVJedbPPTfXbBwS952EUXv+zjF5780lewi+9B28r/P+fyFG3EwYIaAAAAAElFTkSuQmCC",
			"chutes": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAANlBMVEUSEhIAAAALCwtkZGQSEhISEhL///8WFhYSEhISEhKTk5PU1NSqqqrBwcF8fHw+Pj7l5eX29vYwDG/MAAAACnRSTlMC////+///9dBvDmmoggAAAZRJREFUWIXtl9uWwiAMRUki9sK1//+zU2nHckmqU55cY550Lc8mOQQwSik1jTd9IW7jpFIMV9RbDJ36RJh69FpPauwDjOqSf0fcVJ9e6y/gC/gQAMIaeBHwEAfyRMP64e+AVWzjfYvFeSEPEYBA5l6E1VwaAgAhVPJHuNAieACAbeWPMFQjOADAzMuTG5UZLQCAFlm/myED+OLr8CABQDteEu1MRN46k9ILyAIk75Y59eNvBJpnYAAAni2+ti01KFMCUOTkdyd2cQkAwbtnskcJAsCf+b3KvDUxRuPmUFSUlcD5v60P1bkwGhmAhtaDXV+4sxhrie0DHFg9FntrQ2VD3gdIpd5CSj/mxGZLykayrT4cvWFe3wf5ai7ps6Rm9koqAYiVPjvXnu+n+jBRoXf5+qy+BuC+pkn+D7FM6A3A3tIGsi8pxKehASAsT/1RBIkHqr3SMMRsua0ksQD2UsXi1+mQnbxtrx/XdWOEHXwTsDbj2Y3yBgBP3uaP+IPxBfwPQPfQ1T32dQ+e3aNv//DdOf7/AI11UqRnfnfdAAAAAElFTkSuQmCC",
			"cline_pass": "data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22white%22 d=%22m23.365 13.556-1.442-2.895V8.994c0-2.764-2.218-5.002-4.954-5.002h-2.464c.178-.367.276-.779.276-1.213A2.77 2.77 0 0 0 12.018 0a2.77 2.77 0 0 0-2.763 2.779c0 .434.098.846.276 1.213H7.067c-2.736 0-4.954 2.238-4.954 5.002v1.667L.64 13.549c-.149.29-.149.636 0 .927l1.472 2.855v1.667C2.113 21.762 4.33 24 7.067 24h9.902c2.736 0 4.954-2.238 4.954-5.002V17.33l1.44-2.865c.143-.286.143-.622.002-.91m-12.854 2.36a2.27 2.27 0 0 1-2.261 2.273 2.27 2.27 0 0 1-2.261-2.273v-4.042A2.27 2.27 0 0 1 8.249 9.6a2.267 2.267 0 0 1 2.262 2.274zm7.285 0a2.27 2.27 0 0 1-2.26 2.273 2.27 2.27 0 0 1-2.262-2.273v-4.042A2.267 2.267 0 0 1 15.535 9.6a2.267 2.267 0 0 1 2.261 2.274z%22/%3E%3C/svg%3E",
			"cloudflare": "data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22white%22 d=%22M16.5088 16.8447c.1475-.5068.0908-.9707-.1553-1.3154-.2246-.3164-.6045-.499-1.0615-.5205l-8.6592-.1123a.1559.1559 0 0 1-.1333-.0713c-.0283-.042-.0351-.0986-.021-.1553.0278-.084.1123-.1484.2036-.1562l8.7359-.1123c1.0351-.0489 2.1601-.8868 2.5537-1.9136l.499-1.3013c.0215-.0561.0293-.1128.0147-.168-.5625-2.5463-2.835-4.4453-5.5499-4.4453-2.5039 0-4.6284 1.6177-5.3876 3.8614-.4927-.3658-1.1187-.5625-1.794-.499-1.2026.119-2.1665 1.083-2.2861 2.2856-.0283.31-.0069.6128.0635.894C1.5683 13.171 0 14.7754 0 16.752c0 .1748.0142.3515.0352.5273.0141.083.0844.1475.1689.1475h15.9814c.0909 0 .1758-.0645.2032-.1553l.12-.4268zm2.7568-5.5634c-.0771 0-.1611 0-.2383.0112-.0566 0-.1054.0415-.127.0976l-.3378 1.1744c-.1475.5068-.0918.9707.1543 1.3164.2256.3164.6055.498 1.0625.5195l1.8437.1133c.0557 0 .1055.0263.1329.0703.0283.043.0351.1074.0214.1562-.0283.084-.1132.1485-.204.1553l-1.921.1123c-1.041.0488-2.1582.8867-2.5527 1.914l-.1406.3585c-.0283.0713.0215.1416.0986.1416h6.5977c.0771 0 .1474-.0489.169-.126.1122-.4082.1757-.837.1757-1.2803 0-2.6025-2.125-4.727-4.7344-4.727%22/%3E%3C/svg%3E",
			"cohere": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAAS1BMVEVHcEw1UUbRjuM1UUbRjuLRjuI1UUY1UUY1UUY1UUbSjuLRjuL/dln/d1n/d1nRjuL/d1nRjuI1UUb/d1n/d1n/d1k1UUbRjuL/d1lpWQy+AAAAFnRSTlMAnGcT7cUmb8TnFowc3mc/t6lDQ4fwUU2yTQAAAedJREFUWIWlVlcChSAMAxURcT4H3v+kT3AxiqLk26RtOhAhHTnFBZufwDBNEQT6zD1R5C49nK1ATXpevOSvSej832v6ChzJ16r4yJ/n3cn0K/+w4b1/J9Iv/dOhXIjgqxpiEpjZKvBifgGsIxjFnyMrkAI4is+ihmBWXYjzkMZNgbQgTgBHjgGL3KRtmyPamH+6pSdYHneNroP4yUX9WfhggvmqvL6IzqP0LgXsvmkvXGAYfFVDbwqjEDt4FvDPRw9RYJ4/ghP341TcBT988C6VHrxNekJ63pZgGWAztOAlz8QB0oISdhZGcCIMEDALtP5kHaExvUZGD34i8fqRpqblbe+yJbhXwUACBIdyqIZmGCqH3vrpKy4rm3pRqBuTz+/oQmT7Z8O0nJgGje8p3i6iWQxcSSRP/C0Fi38plI985UJl85dl95I882UrO1egC05A9FACewoPHdiQoRESGEMrEAKqYK8hiC/QBAlMwQIZgvjLEuqhIH6BsAz4jcDtGh1IUA3x66BFkADnaO/C8ybIOXI3QWLbhoAa5GH0WRCSgtpmYBRHFLZN/faZY2N93IPyvghyXENrGKfrMt4q9OdnlZFDrV/W0l+FcZI1H0ZkwnPVuf0wNd2aRt1ZR1mh5cQQyQjXov8BJXEYJmaBteYAAAAASUVORK5CYII=",
			"deepinfra": "data:image/png;base64,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",
			"deepseek": "data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22white%22 d=%22M23.748 4.651c-.254-.124-.364.113-.512.233-.051.04-.094.09-.137.137-.372.397-.806.657-1.373.626-.829-.046-1.537.214-2.163.848-.133-.782-.575-1.248-1.247-1.548-.352-.155-.708-.311-.955-.65-.172-.24-.219-.509-.305-.774-.055-.16-.11-.323-.293-.35-.2-.031-.278.136-.356.276-.313.572-.434 1.202-.422 1.84.027 1.436.633 2.58 1.838 3.393.137.094.172.187.129.323-.082.28-.18.553-.266.833-.055.179-.137.218-.328.14a5.5 5.5 0 0 1-1.737-1.179c-.857-.828-1.631-1.743-2.597-2.46a12 12 0 0 0-.689-.47c-.985-.957.13-1.743.387-1.836.27-.098.094-.433-.778-.428-.872.003-1.67.295-2.687.685a3 3 0 0 1-.465.136 9.6 9.6 0 0 0-2.883-.101c-1.885.21-3.39 1.1-4.497 2.622C.082 8.776-.231 10.854.152 13.02c.403 2.284 1.568 4.175 3.36 5.653 1.857 1.533 3.997 2.284 6.438 2.14 1.482-.085 3.132-.284 4.994-1.86.47.234.962.328 1.78.398.629.058 1.235-.031 1.705-.129.735-.155.684-.836.418-.961-2.155-1.004-1.682-.595-2.112-.926 1.095-1.295 2.768-3.598 3.284-6.733.05-.346.115-.834.108-1.114-.004-.171.035-.238.23-.257a4.2 4.2 0 0 0 1.545-.475c1.397-.763 1.96-2.016 2.093-3.517.02-.23-.004-.467-.247-.588M11.58 18.168c-2.088-1.642-3.101-2.183-3.52-2.16-.39.024-.32.472-.234.763.09.288.207.487.371.74.114.167.192.416-.113.603-.673.416-1.842-.14-1.897-.168-1.361-.801-2.5-1.86-3.301-3.306-.775-1.393-1.225-2.888-1.299-4.482-.02-.385.094-.522.477-.592a4.7 4.7 0 0 1 1.53-.038c2.131.311 3.946 1.264 5.467 2.774.868.86 1.525 1.887 2.202 2.89.72 1.066 1.494 2.082 2.48 2.915.348.291.626.513.892.677-.802.09-2.14.109-3.055-.615zm1.001-6.44a.306.306 0 0 1 .415-.287.3.3 0 0 1 .113.074.3.3 0 0 1 .086.214c0 .17-.136.307-.308.307a.303.303 0 0 1-.306-.307m3.11 1.596c-.2.081-.4.151-.591.16a1.25 1.25 0 0 1-.798-.254c-.274-.23-.47-.358-.551-.758a1.7 1.7 0 0 1 .015-.588c.07-.327-.007-.537-.238-.727-.188-.156-.426-.199-.689-.199a.6.6 0 0 1-.254-.078.253.253 0 0 1-.114-.358 1 1 0 0 1 .192-.21c.356-.202.767-.136 1.146.016.352.144.618.408 1.001.782.392.451.462.576.685.915.176.264.336.536.446.848.066.194-.02.353-.25.45%22/%3E%3C/svg%3E",
			"experiential": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAAYFBMVEXt7e0AAADx8fH09PT39/fp6enX19cKCgqrq6vPz88dHR3i4uKjo6MsLCywsLBiYmJoaGh/f3/Gxsa5ubk6OjqampqMjIxxcXEYGBiSkpJOTk5ISEhYWFgSEhI/Pz8xMTGoj++nAAACPElEQVRYhe1W147iQBB0B4dxtsHkhf//y6seH+zC4ijdw0n0AxL2dHV1qnEQfOxj/6Exi8p6b1HXVellBAHwPOiu2e6LYCcd9m9on4T6FkOyPZy3eUL1CINwh0O1+x2C9Yg3+0g1oWasCMKdQYQvJDi8gnoEbiCZDGbZQwRGtX2KwhEeJT41vZEbB8CZjT/+4h95SM6Iptso5pA/EMwpzvqw0o3W8NvlQLS5H5QC8TnwCJrSZiqDe1Bz8j6NgXGY4y+X9DU8BU8ILXruj1oBasVvCQBJKZ9DwOJiInJLQi9EobRUin+Yzt4EReZ/CRy1pQ502KG/Mwn0SRzFBoeCCEnYNGEW51Wgp7C1liuchFIrIBd0W7LKqDiqD9au6rt4I8pmJ2AmxhirUVKjgbr40djZABWR1nQuKBDBMqbL4iOHHJxRCOokh5LUvNC/7xrFMZ1MSdoF9b8b5jk3AERv38vUlGESKKa9k2GlnAOwWa3jmLzuEC+Y3hezNUhOS8b/FQDS1poYrAUQbHSIee7WAuiVCkUrLysmwMxkbSd6JlrJwDKI2HZy4iYZZNCTl5gOqwbBxNj1QoxtWhHfkdcxIJ0XC4EHSL2mBn0xi8WrrCd6XKL+jliGwILLIHkkLgnReQkCh9uflyv4ACGN5laS/fVePo0fbiaDnEVCsvpNOM7Qi6ubhMCXGNqPCf51kC0NqiakjR2iU5O9zZY5QWmKcgxBqluzGRZA1qirKByjMPah2bOQlbv9sY/9Y/sDeN4RrSqiSrAAAAAASUVORK5CYII=",
			"featherless": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAASFBMVEVHcEz+9HoUFBMAAAb+9Hr+9Hr+9Hv+9Hr/9Hv+9Hr/+33/+Xz/9nuoolL//3+Ae0AODhG+tl3s43JpZTbZ0Gmclk1QTSs2NCD6lv+SAAAACnRSTlMA////tbNQ6hFTXTHRfQAAAaxJREFUWIXF19mWgyAMAFAwaiukCLj0//90Ak6XmVMQyEPznmtokyhCUIz9RVbHZZjEEdeG7F/jGvNb00MEofn5sQYhJk6+lKMYeEDPO0E4Ay9fymIAkQdo6T8LZYA2N9hUM4BmvQPcWgFUfgHbNQNabwBd1wqgcTakNwJo/E7VNwMoZzge3wioV3oH4HR9Bc98C4v/XEARYOG+mkQnlwDUQ+Zz+Rkgjk4EAGaZqD4DoA81E2Bh9ypVfQ5w4bma/gWXPHwW0A7C9MCSOfwZEE4P8/P0qBJUBiDiAdBE7reaRvoHqNDTVa38BwjrCCpnAV9AXEe2dphwjVuAgGMdVU8jHnsIZrM9JrJ2nFHJJRbB2AdmpVZ+DXTV33iEetsn1jH2AfXkplM9XQDEdZQcqdN9kF1HSQDD2zQC+XWUBNQGtAg0WJgxt47SAHX/7g3cT9ZRDqDid+rEk/QcEH6/+aT+E6D7IqDZgANgAVLHDwMGQMPsOmAB9CLYWEAgmAAN07cBerkyK0h9YJcCyU/8YqAk+FeengcMYuQBE//iyb/6si/fFNPQcv3vx5D7A+q4IB5afc9aAAAAAElFTkSuQmCC",
			"fireworks": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAAJ1BMVEVHcExnIP9nIP9pIP9nIP9nIP9oIP9nIP9sIP9nIP9oIP9nIP9nIP8ul31DAAAADHRSTlMAyX4LsOcvWwX3IJgKbYwRAAABbElEQVRYhe1V2bbDIAh0X/P/33uVaCKgrX285zhPlcrMgGiEODg4OFhDXwUSx2SN6V0G2O3GSLIlkrctuEpgxkguAetW++cW4rC+i9quQAhfExRZ+/18pmiIo+/ANf9soLQxjl3npzIDalGoFq7QVvehhEkSSkEM4DoPv5EBrQRDsvicaw023f/QwXQ2soJCkbEBr5ssa2Gws6mMZNZeXUn+ccwR7K8yyENvfbguJFj1CxJl8DfDq+TaNKLzaPrTqfDUQ7EQrSYtDMt87gEseNzCtT73EEDbmuc4v+gDQ0QeoPox4bN+hcIeWn6/h01/MoWMwY2rrqg38h+GoabYM8xOfmcw/TTT07/N/IeBhrfzOwO5LXk/vzOMFza4T/maoDBEWkQ1AN1ke8t0SApjGAE8y6aAbK025TWHog5mkO3hmAA/WvBKT1BuyYKbPnpuoWOEIjAAxR7N5LN5kfv23z43E3z5WBwcHPwj/AHMkBsrFcyoAQAAAABJRU5ErkJggg==",
			"gemini": "data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22white%22 d=%22M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81%22/%3E%3C/svg%3E",
			"github_copilot": "data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22white%22 d=%22M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12%22/%3E%3C/svg%3E",
			"glm": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAAXVBMVEUtLS3///8GBgbx8fHs7OwCAgL19fUqKio5OTknJycjIyMcHBwTExMPDw+ysrJUVFTMzMzg4OAYGBgzMzOjo6NhYWFHR0eVlZVOTk50dHSDg4PW1ta7u7uPj49CQkLBrYlSAAABsklEQVRYhc2X23KDMAxEBcE3jE0wSZtL2///zNJMS0C2hW0emn3UsCcaRbNjQbVT8FKAQ7JCANuzOlmstwjQyE5BhlQ3NktAY7LsD0TdLAAy2z8RxifAdvl+gM7OgL6ggamFywxgJX4A9gc41GWAxxhfDWD8bXQALSrpKMAMHG89P7r2uq5yq2OA3+VaSSqFKryLdhAA3DS7o9K8NSmAI3OfqHSa1zYA4OjjQasvXHpunQ8Qcq2xFgw3JQX1NwokMBb5bxooAFZ79mZCLxKScHgoWmQB2BH5zy3kAPQN+a2BHIAYkb9BubEFYAMCvKksQHdC/ncHOQDVI//dCz4aUB8QQIgsQP2B/NfW/4YAtFfk/wj9SBwgvBAxvp8CxEMkDUCESBKACpEkABUiKQAyRBIAdIhsAzZCZBuwESKbgFCIeFFLAAIhIsyI0l4QgECIaFzidRwQCBFvJlUTBwRCxJsJCTBeiCg8ExKgbcWXmkLE3bmnwUQ70GytaQMc8zRHw0u+0goBu5+6+x/bu5/7ZQeHrJ6AkpPHLE+egqNLro6unzlccs6+Cz77Htp3eJbq/wHf2bUZBseyLtYAAAAASUVORK5CYII=",
			"glm-cn": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAAQlBMVEVHcEwAAAD////Nzc0AAAAAAAAAAAAAAAAAAAAAAAAaGhrc3Nyrq6s5OTnAwMCFhYXz8/NSUlKWlpZtbW36+vpHcExYTHYjAAAAFnRSTlMA////odnB+RNH//////////////8AVjxUJAAAAYVJREFUWIXdl8mSgzAMRDE7ZgkO/P+3jiGpmsLdEti+RUdH/UgLIVBRHDHUTWfioqmHvvhG38aqP9F+CUOa3Ec3nNdP1ntCf/z/dL134Q3k6A8TdRbA1EWTB2iKPL3pcgHmtwB2qkhM/peFHRLAWJKYjXmFZ6t7DvDXcmt4+BIsEEDlz+G4kmpAANTA/LiIi0/dAOqMAOABBViuv98BllA/2ijAtpOqRAAsFOAdpugAMFDZMEUFTKF+xxwNMN8bUAHYWBPJUgBgoGRZMgBacHcsTQTMYIAUQAOAfuR5EkAdIg8A+hB5AHhqQAK8QR8+QzrAwTO4SXoOgA5iLagAoAXDIXIDgDsIQ+QGAAVQDBCArUL9wnQyAO5gqRSAABzopRYUAJEGAABTdL3RBwA04Ftwxs8DKwBm9gziu+HSWBcAFGBkrmQAHSI4WkUAHSL4bpAB+HnADtUipsQvADI2pg8ge+HIXnnSt8Yz/OaYt/b1+Ytn/uqbvLx27f/67tf/WLVf/0/tH+b0GyU6dpJTAAAAAElFTkSuQmCC",
			"groq": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAANlBMVEX0PgL0NgD0LwD3b0n0PgD////0OwD0PwL0PwH1PwL94Nb6qpT4knf+7+n1Uh/8y737u6r/+vet1+I9AAAACnRSTlPN////////2cClHGg5wwAAAZJJREFUWIXtl9tuxCAMRGMI3oZLCP//syWEzcPG2AikSq3qd04YPGPIsr2maluWdaqWf8APAXASgJohdABAO5gBIFg/BVDOTEkAbdI+AcDVGssoEAHqMCaqcUAWYIwbB+AeMkCPSzgFGLYJPAD8uT4MW/kSwDeBBah4rjcHd4YcQBUBxnBG5gC4pwvANoEBgL3Ws0ZmADlDVwV2fROgdBXAG7kJQKwCTiMrBQCI9E4agFtAlhAP57zWex4tGdUHKBn6qJSCtdF97oME4BqegAJ5moIEXBmi6nmiFAAJAfU8nrkiADVDVBGmJAA1Q0RRsXoCwLfWW2owEDvwR7Q2pCeATBUBAFX8smvvXWbd6+nZysQZ4UTdlrRAelm8F94nmhpjQQLAu6W+EUoBcI+l2BpLPTeT4caSBPC8ABFQY8VMJWkHxQaBmatSF0oTxp84uLcy1LsDTQ+BbkAx8ujNVABReJ9IgNwE27gP+gBrEgQIgDxdBQHiE4d/ncgAJwmQAOz7rAOwit//Nf9Mfx6wfU3V9g3dEURvNtjb0QAAAABJRU5ErkJggg==",
			"huggingface": "data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22white%22 d=%22M12.025 1.13c-5.77 0-10.449 4.647-10.449 10.378 0 1.112.178 2.181.503 3.185.064-.222.203-.444.416-.577a.96.96 0 0 1 .524-.15c.293 0 .584.124.84.284.278.173.48.408.71.694.226.282.458.611.684.951v-.014c.017-.324.106-.622.264-.874s.403-.487.762-.543c.3-.047.596.06.787.203s.31.313.4.467c.15.257.212.468.233.542.01.026.653 1.552 1.657 2.54.616.605 1.01 1.223 1.082 1.912.055.537-.096 1.059-.38 1.572.637.121 1.294.187 1.967.187.657 0 1.298-.063 1.921-.178-.287-.517-.44-1.041-.384-1.581.07-.69.465-1.307 1.081-1.913 1.004-.987 1.647-2.513 1.657-2.539.021-.074.083-.285.233-.542.09-.154.208-.323.4-.467a1.08 1.08 0 0 1 .787-.203c.359.056.604.29.762.543s.247.55.265.874v.015c.225-.34.457-.67.683-.952.23-.286.432-.52.71-.694.257-.16.547-.284.84-.285a.97.97 0 0 1 .524.151c.228.143.373.388.43.625l.006.04a10.3 10.3 0 0 0 .534-3.273c0-5.731-4.678-10.378-10.449-10.378M8.327 6.583a1.5 1.5 0 0 1 .713.174 1.487 1.487 0 0 1 .617 2.013c-.183.343-.762-.214-1.102-.094-.38.134-.532.914-.917.71a1.487 1.487 0 0 1 .69-2.803m7.486 0a1.487 1.487 0 0 1 .689 2.803c-.385.204-.536-.576-.916-.71-.34-.12-.92.437-1.103.094a1.487 1.487 0 0 1 .617-2.013 1.5 1.5 0 0 1 .713-.174m-10.68 1.55a.96.96 0 1 1 0 1.921.96.96 0 0 1 0-1.92m13.838 0a.96.96 0 1 1 0 1.92.96.96 0 0 1 0-1.92M8.489 11.458c.588.01 1.965 1.157 3.572 1.164 1.607-.007 2.984-1.155 3.572-1.164.196-.003.305.12.305.454 0 .886-.424 2.328-1.563 3.202-.22-.756-1.396-1.366-1.63-1.32q-.011.001-.02.006l-.044.026-.01.008-.03.024q-.018.017-.035.036l-.032.04a1 1 0 0 0-.058.09l-.014.025q-.049.088-.11.19a1 1 0 0 1-.083.116 1.2 1.2 0 0 1-.173.18q-.035.029-.075.058a1.3 1.3 0 0 1-.251-.243 1 1 0 0 1-.076-.107c-.124-.193-.177-.363-.337-.444-.034-.016-.104-.008-.2.022q-.094.03-.216.087-.06.028-.125.063l-.13.074q-.067.04-.136.086a3 3 0 0 0-.135.096 3 3 0 0 0-.26.219 2 2 0 0 0-.12.121 2 2 0 0 0-.106.128l-.002.002a2 2 0 0 0-.09.132l-.001.001a1.2 1.2 0 0 0-.105.212q-.013.036-.024.073c-1.139-.875-1.563-2.317-1.563-3.203 0-.334.109-.457.305-.454m.836 10.354c.824-1.19.766-2.082-.365-3.194-1.13-1.112-1.789-2.738-1.789-2.738s-.246-.945-.806-.858-.97 1.499.202 2.362c1.173.864-.233 1.45-.685.64-.45-.812-1.683-2.896-2.322-3.295s-1.089-.175-.938.647 2.822 2.813 2.562 3.244-1.176-.506-1.176-.506-2.866-2.567-3.49-1.898.473 1.23 2.037 2.16c1.564.932 1.686 1.178 1.464 1.53s-3.675-2.511-4-1.297c-.323 1.214 3.524 1.567 3.287 2.405-.238.839-2.71-1.587-3.216-.642-.506.946 3.49 2.056 3.522 2.064 1.29.33 4.568 1.028 5.713-.624m5.349 0c-.824-1.19-.766-2.082.365-3.194 1.13-1.112 1.789-2.738 1.789-2.738s.246-.945.806-.858.97 1.499-.202 2.362c-1.173.864.233 1.45.685.64.451-.812 1.683-2.896 2.322-3.295s1.089-.175.938.647-2.822 2.813-2.562 3.244 1.176-.506 1.176-.506 2.866-2.567 3.49-1.898-.473 1.23-2.037 2.16c-1.564.932-1.686 1.178-1.464 1.53s3.675-2.511 4-1.297c.323 1.214-3.524 1.567-3.287 2.405.238.839 2.71-1.587 3.216-.642.506.946-3.49 2.056-3.522 2.064-1.29.33-4.568 1.028-5.713-.624%22/%3E%3C/svg%3E",
			"hyperbolic": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAAe1BMVEXu7u5bJdTz9O/2+PBOANLw8O5ZIdRUFdNXHdNVGNNoOdZQCNPn5e1SENPKwOeDYtqql+Gfid/X0Orr6e7j3+xiL9XGu+bc1uuagt6lkOC8ruS2peNySdjRyehCANGHaNt6Vdl/XNqWfN13UNmSd92wnuJtQteNcdzBtOWOjRoqAAACu0lEQVRYhe1WyZajMAz0ImOD2cMSSCAhSaf7/7+wbQeyAHbemznMHKIjKsqSLKmM0Mc+9l8aI4T9iW+C0DpLkQXFUJrV1EnB2BY4nOm6l54lhy1zMLAwiDDGkK9iWA7KGQWhPUVUCgXB/mU1BHrxtVeUthQRyfT5OoTNCoRt4OaNMmIj8L0R8rUCIV8jvScsNUJoPAJ75QqElCM9BlsK9AGJFxgW3+kDWwRkN2FEssDQREzsra0GiB7kBCpmIbBiIpff1hKoGC5wy4I3s1NIw2/xw8l6vomhKqWm8PCcAJvPsowd5yMzLu0VuMDQveTAOsCCw7V9M05sF1JC63QP/Wu3kKyHfVorZ7hzMbCubxQFoZu4fY2gjTf6e5j1nTMEGkRwqJDCzmug/kbVASJrE4y4lGMh4dhUBaOaRhullBVVcwQpME+dl2CKpRuJS4Bg+N5mTZNtv4dAguSmkcCdwWPkzNAInyvzfeHdP64O6ksO3gO8Yp5wZ6Cr6CZ4U0MVwd8SUOwmmLf43BiCJ7Qqo7bnsoB1IY4EZvOqWul79K/HIUmG41WAvkVDY9nYjxLsIuxx4Ela1Uh3kDGC6ipN1GdvfV0+l+DMoWxyoprwWUCYmlJK8qYEblOdEVj3Q6c7mG7y2TiH5nM39LUrB5Kq3ymLt0F/eR3nUx+c9JDRzj0MTG2DUwS+B9VrBDF4PsiT2ghvilgcwAiYnF0XM6riQ1K4V2J7+30pj/R0cwjYOapI06mNFtc9Noh2NVaGcRnoc/ZLYdnfhWUpWxPmPGHkUnxYK+3sE+aufnzlGcL8t+JKpjP42guAZHyKz3YR4xNkRRlNBJM6+lZxZKGRNSyG9SfOTZ+9VfoxyjzSmFkX3vnNC0HI3NFKJDyD8G1bh5RcwNndioz+HBNbiKw4HH/cD01DYYe4fB/72L+1XwAgH1LRxEaHAAAAAElFTkSuQmCC",
			"kilo": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAAIVBMVEVHcEwjHx8jHx8jHh4jHx8iHh8iHh8jHh8iHh8iHh8iHyDjf9OoAAAACnRSTlMAsPEiEYbJOVyZGSk2swAAAb9JREFUWIXtl4FuwyAMRAMGbPL/HzzbEEozCoGoWqftIlVA6dOVmAvZ9pvaPgRgl/QAWLMkewCsQVgQKiEBYFsQ/AM+FeBEp6bLugJwngvMaw+lSfwrR6nu/NlmE2C4F1CaFPgbLwCfdk04E14B9heA3Z4ILQD0AHugyw4c//PA+1UBFERqwY0A6sBGz4ryqV4AEcHrKgwB6iDHBd+C6tbRhAMekItToppNEw4OPRGSg2t3oUmYcWA9sWI4/jRI1+s8aWEPAK1KpGD40kII3Cg2pisxy/QA/UrM9fhWB464/Eh7IE2UydKoRD1AM1BKopyC5Xdk4jSguYiJlh6obgBo1cGWcZwP0RP2Aa06UGG0ssM5bKALeOkAj21aEQYOMPLWoW+AKpYGDgB566bl5EykqMlqh6X8ABTpkykSU9CHid34AGggE9/JDYeApoMMkJVYd2AuApIDkmVTwZKDPRSRKwApZDI8FrsOYjq/6pOlTiRrhWcIAbuFtKXTZ1FK5TL0vDrtPEDxYGtAGroM4OnVcTqVMsR8Or8EqBPw2P7gW8ekmUg7DujPg58Zqn8YcPOl6/Zr3+KL514BbujnAV/7bDoRY90RwQAAAABJRU5ErkJggg==",
			"kimchi": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAAn1BMVEX/Uh3///8YGBr/SAAAFBoVGBr/Txf/TA8TFxr/VR3/RQDvThz//PoQFxoaGBoNFxoAERr/8+7/08f/uq3/l33/Zzn/5t//zMD/XS//bEX/3NP/wLH/g2T/qZThShwrHBr/n4jNRBz/r50xHRquPBvEQhxFIRqGMhv/kHX/dEz/elX/iWr/fVy3PxuRNBv/WSdoKRpYJhp9Lxs7HxpPJBro7UBHAAADTElEQVRYhZWX2WKqMBCGIwkJESwFBBQqonW3Fj31/Z/tJKhINsS5cuH/mI0wAwYGC8JovI8rUE3iQ5lnnuk6oP01PFYQQoIBN4wJ+xKPk74AL4rJXdsyTMgh7QMIlhOoqG9G4DR/Cchjk7x2Ax6yTkDw0yWvvSClZwakFemWc4PTxASYDV/c/uFEqgV442EfOTM8jDQA79hXz2y4VAG7N/SMkMuA2Vt6RkhFQPqmHmAatAEJ7pX/tpG91wIcetSf0sXapc/vw9kTkMMe+tMcIXRqR5E8AMHkdQD0F40sBy3aQXw9ALPXDtATsi0ffbvtH0l4AwRVtwPULYpi7lijTSHoAfm5AV44sD7z4B3LQicq/UWyGtCZgeKKfCbmhlbyn2TMAVlXCRe2bzWGfqV/MfUYoOyIoPBHltUmSEHAlAG6Itj4bb1lC2XkMZQDEHQ4cEKWaP5FdAHHA5CaAfRvJAFsv5BiCEBkBhS+LQFYJUQXYAbG5iIoETDAPwmQgr0xh/TsKwD/LAGWIDYXYaREoABICSZG/UKNQOkEMjbKAd3qAGvxInIElZGA1Agc8XmuAcYQNDVQe5mFYEoivag1cOaSAzyJPwZA8alxYCWfCDACpaGRNA6gi3IVayR9K9OF6oBjF8p1rJVDLcD9cGS9jdZyAAzgAU8HcDdqAJ9KAtjjvGcHylTJInU3agl1evYoMMBSdoEu5ore+VRO1FsKGCARy0DdLZLPEcsfaeKvDyR+rLcfaOqu5koL2+jq6vQAzmpA69Xqbv+QnH4bjbY6Nbi9Xvm78dnNc8V7B6Fzob096+Pd/eXa9JLcvraPPs4LvZo7kN0BXlNJC7EXmWNzc3yErOvKdHeegXEzYDTdWJy2l++P2ubX7bqgZjnAVfAccXZNHinTuNxol5jbfdK7AYKOo9UUwFEY87IeU5JgJPbEQTN/b1DE4DGyN6Nu9A4Bk2bveE7ry/4EjEN12OZR9Mwkoa29p71wpKTHwMryH7dXFmHlSaavi4GHO2FpEpcubwa6ncBwIm1+8tqXfHXEgSEog0E3gPXUkeh3Pwxpqa6/ut05KydQZmBIppF8dxOAWVjGkBthVn84LPW7twnAzEvCfFnudmWUhgYxt//R8DGhFArViwAAAABJRU5ErkJggg==",
			"kimi": "data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22white%22 d=%22M21.765.351C22.998.351 24 1.353 24 2.586S22.998 4.82 21.765 4.82h-1.974c-.15 0-.26-.12-.26-.26V2.586A2.237 2.237 0 0 1 21.765.35M9.41 13.388l8.447-8.377c.16-.16.07-.471-.14-.471h-4.55s-.1.02-.14.06l-9.099 9.029c-.14.14-.35.02-.35-.21V4.81c0-.15-.1-.27-.221-.27H.22c-.12 0-.22.12-.22.27v18.57c0 .15.1.27.22.27h3.137c.12 0 .22-.12.22-.27v-3.79c0-.08.03-.16.08-.21l2.826-2.796c.07-.07.16-.08.241-.03l7.546 5.551a8.9 8.9 0 0 0 4.018 1.493c.12.01.23-.11.23-.27V19.76c0-.14-.08-.25-.19-.26a5.8 5.8 0 0 1-2.355-.942l-6.533-4.73c-.14-.09-.15-.32-.03-.441%22/%3E%3C/svg%3E",
			"kimi_code": "data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22white%22 d=%22M21.765.351C22.998.351 24 1.353 24 2.586S22.998 4.82 21.765 4.82h-1.974c-.15 0-.26-.12-.26-.26V2.586A2.237 2.237 0 0 1 21.765.35M9.41 13.388l8.447-8.377c.16-.16.07-.471-.14-.471h-4.55s-.1.02-.14.06l-9.099 9.029c-.14.14-.35.02-.35-.21V4.81c0-.15-.1-.27-.221-.27H.22c-.12 0-.22.12-.22.27v18.57c0 .15.1.27.22.27h3.137c.12 0 .22-.12.22-.27v-3.79c0-.08.03-.16.08-.21l2.826-2.796c.07-.07.16-.08.241-.03l7.546 5.551a8.9 8.9 0 0 0 4.018 1.493c.12.01.23-.11.23-.27V19.76c0-.14-.08-.25-.19-.26a5.8 5.8 0 0 1-2.355-.942l-6.533-4.73c-.14-.09-.15-.32-.03-.441%22/%3E%3C/svg%3E",
			"lightning": "data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22white%22 d=%22M12 0L1.75 6v12L12 24l10.25-6V6zm-1.775 18l1.08-4.657-2.428-2.397L13.79 6l-1.082 4.665 2.414 2.384z%22/%3E%3C/svg%3E",
			"llm7": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAABCFBMVEVHcEwLI3knMIsoMospIYEesOYUNpMLF20YNpgnJos4PYEnLXcyJo4MHHEtHo4YU6o6G40rIoo2mssQInRKa5IxotUUH2wbhMkZN5IYYLUsK4kpJo0lgsMZhMsjhcY6O4UWR50YLIkgUaAtIowfuekbP5gwI48wHo44HY46nslPl7t6d0oZWbIgT6gkd7oep+EggsQcdL4aPZwnododot8SGWUfmNUclNQdj9ARGWglks8gHnccQZ4ZbLkdabk4SZYit+cei80chMkcjc8luOYcltUQF2wbdcANGmwrv+U9GY8jJpMtHIwbLpUqIZEbktYcnNsYPp8ZesUYSKcYZ7saUK0YcL8ZWbIkWATtAAAAUnRSTlMA/TctUP3i/v5gCRVF4MDq54MdoAQ0WMOi+yWTTf1eHeLQS6v+V3D01Q8IAb9vMONxrMts/aysyI1nQj2D3YwO39+i5432iL3AuP/////////+iAVG+AAAAzRJREFUWIXtVleT2jAYFNjgAqYaTO/dwMFxdLh+uYsrxpT//08iGUgyd5E8ectk2AeNYGdX+6l8AMAVV/yfEMl0x93hO4ks5Fz1sdrjq3xZLpZoF9qJ9oXLvR/u3fSJGoQvhmaTm7vNYrpJvJgvUgFFHx4Ou52LQ7v2WvNBgBFUbzaj2TSRj+Xz+e12+HAP5elut0fSdx6h+Obm7m422WxMc9JZvOQLscIW4tBH8uPxuK/g9fIjko/Q2glzWhA7kpQbPEs50B8ehvfp9LHXDe/3ey++AJ9vBMAILb5A2zCY9aXnwkKCU76/Th+PYQCoWxtfhJhIwBhvpvmWA+gkxFmukxPfT6fAd+HiMD5fJ+yBLMuxhWk+tf/I9mw7RdiAM6YDc4oLWLFLPeIhQEwmsyc8W7e8VoCoz5nPgxiBX1HWLdHgKS8ReVBn2SCBLuTdDIIsS4ogbbd9sgHw6zqFJWPb7dpFL9d1PYtlB4fDwMUA8LpaxpLDww5VUHFuS8W5cV5nzHAinYRA4cuqyuMM1rsd6mjhMPpQstCY0jk4Cp6A4PEwzDc4z6oq9jWtd2k4yqUS+nDLojHu8fBg7oEGH2DOLOE3nKpyOIP08bS2Y1C+GMQBIzBFOGcE9A2tGg2ygew/GegngznzwSSRwZxJOgYG3iC8dxL4/b8ZMEBgkjQyEBin2XKGgS0hvLdllID1+/3eskcQBBoaLMcAJaCdLQQgqhnYy9y1bVRrNpVKxaloPB4fL5NjtKx3HADz8ekdhjStiDNY2fap3cDG8oW8/GQZRgSnB5Tt8lhRGE2r4tmS5dIvnApoPLuyrBRZX9Q0fAXwpVgWm3ELECXxK5b1k3hO05rEBeAdYAlFUJqiEHYAIcPqOjZjpqkohCM4ReB0Xcdk8EI9aQfPaECH8vkwszRPi6GHM6FAPbaX/Iogwgevqk4ZjSwVqnLLFppTLahvufyDOjnI3iayyMLzDIWCXDYUBDyN5Aq+m35GFRoYRjMqLiNNLuN11EqE9IvyGZmqgRCMhoJKIOLIsV3kz3WIgWjLMLRiS6FCUF39m9V/gg826AeuGKXJt5sYxGkLX3vDFVf8c/gB2QJ12u4YV94AAAAASUVORK5CYII=",
			"lmstudio": "data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22white%22 d=%22M5.6 0A5.6 5.6 0 0 0 0 5.6v12.8A5.6 5.6 0 0 0 5.6 24h12.8a5.6 5.6 0 0 0 5.6-5.6V5.6A5.6 5.6 0 0 0 18.4 0zm0 2h12.8A3.6 3.6 0 0 1 22 5.6v12.8a3.6 3.6 0 0 1-3.6 3.6H5.6A3.6 3.6 0 0 1 2 18.4V5.6A3.6 3.6 0 0 1 5.6 2m-.4 2.8a1.2 1.2 0 0 0 0 2.4h10.4a1.2 1.2 0 0 0 0-2.4zm3.2 4a1.2 1.2 0 0 0 0 2.4h10.4a1.2 1.2 0 0 0 0-2.4zm-3.2 4a1.2 1.2 0 0 0 0 2.4h10.4a1.2 1.2 0 0 0 0-2.4zm3.2 4a1.2 1.2 0 0 0 0 2.4h10.4a1.2 1.2 0 0 0 0-2.4z%22/%3E%3C/svg%3E",
			"minimax": "data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22white%22 d=%22M11.43 3.92a.86.86 0 1 0-1.718 0v14.236a1.999 1.999 0 0 1-3.997 0V9.022a.86.86 0 1 0-1.718 0v3.87a1.999 1.999 0 0 1-3.997 0V11.49a.57.57 0 0 1 1.139 0v1.404a.86.86 0 0 0 1.719 0V9.022a1.999 1.999 0 0 1 3.997 0v9.134a.86.86 0 0 0 1.719 0V3.92a1.998 1.998 0 1 1 3.996 0v11.788a.57.57 0 1 1-1.139 0zm10.572 3.105a2 2 0 0 0-1.999 1.997v7.63a.86.86 0 0 1-1.718 0V3.923a1.999 1.999 0 0 0-3.997 0v16.16a.86.86 0 0 1-1.719 0V18.08a.57.57 0 1 0-1.138 0v2a1.998 1.998 0 0 0 3.996 0V3.92a.86.86 0 0 1 1.719 0v12.73a1.999 1.999 0 0 0 3.996 0V9.023a.86.86 0 1 1 1.72 0v6.686a.57.57 0 0 0 1.138 0V9.022a2 2 0 0 0-1.998-1.997%22/%3E%3C/svg%3E",
			"minimax-cn": "data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22white%22 d=%22M11.43 3.92a.86.86 0 1 0-1.718 0v14.236a1.999 1.999 0 0 1-3.997 0V9.022a.86.86 0 1 0-1.718 0v3.87a1.999 1.999 0 0 1-3.997 0V11.49a.57.57 0 0 1 1.139 0v1.404a.86.86 0 0 0 1.719 0V9.022a1.999 1.999 0 0 1 3.997 0v9.134a.86.86 0 0 0 1.719 0V3.92a1.998 1.998 0 1 1 3.996 0v11.788a.57.57 0 1 1-1.139 0zm10.572 3.105a2 2 0 0 0-1.999 1.997v7.63a.86.86 0 0 1-1.718 0V3.923a1.999 1.999 0 0 0-3.997 0v16.16a.86.86 0 0 1-1.719 0V18.08a.57.57 0 1 0-1.138 0v2a1.998 1.998 0 0 0 3.996 0V3.92a.86.86 0 0 1 1.719 0v12.73a1.999 1.999 0 0 0 3.996 0V9.023a.86.86 0 1 1 1.72 0v6.686a.57.57 0 0 0 1.138 0V9.022a2 2 0 0 0-1.998-1.997%22/%3E%3C/svg%3E",
			"mistral": "data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22white%22 d=%22M17.143 3.429v3.428h-3.429v3.429h-3.428V6.857H6.857V3.43H3.43v13.714H0v3.428h10.286v-3.428H6.857v-3.429h3.429v3.429h3.429v-3.429h3.428v3.429h-3.428v3.428H24v-3.428h-3.43V3.429z%22/%3E%3C/svg%3E",
			"mistral_codestral": "data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22white%22 d=%22M17.143 3.429v3.428h-3.429v3.429h-3.428V6.857H6.857V3.43H3.43v13.714H0v3.428h10.286v-3.428H6.857v-3.429h3.429v3.429h3.429v-3.429h3.428v3.429h-3.428v3.428H24v-3.428h-3.43V3.429z%22/%3E%3C/svg%3E",
			"nebius": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAAkFBMVEXa/zMFK0Lb/zPk/zIAI0IAIkIAKEJRbj7T+TPg/zIAMkFQbD4ALkEAG0MAAEMAJkIAF0N7nToAHUIADkMAIEIAFUN/oznJ7zS12TakyjaKrjg3WT5TdD3O9DO+5DQVN0GStjgnSj9KZj9qjDxnhD0wT0CfwzcOOkBEZz4AEUIfRj9xkjtWeTyavDkYQEAACUPU9dZvAAACGElEQVRYhe2Wa3eCMAxAS6pInIXyEHkIc8I2dTr//79baZnAjtLBPo58E08vN6VNQsgUU0zRE4CI8IflNErcJKNjERilNmdre5v9IFReVejenz8HRhXrw6ZDAGvnVhH2E8B68gwV7IVA55+9zxjjDu1dj9GKB6Yi+En7ZWAtZuKhuewBAG6iXeGWhiMBzms7CeGmAwBJUmdPEN+eFcGLsQ3QGcDm/TgLFhYQzJnMYn6gbYDGALItE2sqAKHuWiocW9uoNcBLtUgBINvP5KdsbaPWALfzG4BgyGUO20ZBa0BPTgMA61oBzFXUAmgM6NJsAISmMgfe5KA3WLUBGDOpsGwBdAYdAOQn+SXtHG6AQQYEC3knvAJvgEEGIge5jU76fZyHGtS/Df6G4wwIfshtDM50pAFESsGuHww2EAVEHecLjjMgmKjj/P1hhxqI623Ls/SewzgDQg8qB1VGhxvUF9wwP+lIA8hfZWmzIxhnQKCULYK52Bg4pwEAjK5Nda4NWPGosdwBEFQtIqiOc23QqdR6gKuqgiEeKoNj0WlXOgBEprpRLoIAMM/u/P0LgLWYq0573iA5p0XcMzfcA4jqrBqEwdOyjLPe3n4XAGDWndZhL/njt0vAnIvu7e+7SWLi192el5qRBUM5P+y6AIDQlw7e6eH23wgqfg42EM6u66O9yHWzzaMQo1F8ueSjZ67a7S/Lp5jiH8QX4kUiYbI/smYAAAAASUVORK5CYII=",
			"novita": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAAG1BMVEVHcEwj130j1nwj1Xwj1Xwj1Hwm1X4j1nwj1Xy1f4V8AAAACHRSTlMAP9Lw7CoSt3qMASkAAADBSURBVFiF7dZHEsMgDAVQEKbc/8Rxoxjkicpkk9Ff8x9YsLBzFovlt4lRC4BXAiHohLgVnbADOuEAVMIJaIQLUAg3IBcqIBYaIBU6IBQGQCb4UlSC34pKmPpsYekzBaTPEtA+Q3jpk4XXPlGo/RBkQtsfZJPsLUhecIZhV0iOL4yn3gG28PjqA2AKz6mdAEuYpn4BDGG+tRsgC8utV4AorK+mASQBeXUdIAjYigH4KsQMa3Iad0AWQNb+w1gslj/LB6gHFTZm+3JRAAAAAElFTkSuQmCC",
			"nvidia_nim": "data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22white%22 d=%22M8.948 8.798v-1.43a6.7 6.7 0 0 1 .424-.018c3.922-.124 6.493 3.374 6.493 3.374s-2.774 3.851-5.75 3.851c-.398 0-.787-.062-1.158-.185v-4.346c1.528.185 1.837.857 2.747 2.385l2.04-1.714s-1.492-1.952-4-1.952a6.016 6.016 0 0 0-.796.035m0-4.735v2.138l.424-.027c5.45-.185 9.01 4.47 9.01 4.47s-4.08 4.964-8.33 4.964c-.37 0-.733-.035-1.095-.097v1.325c.3.035.61.062.91.062 3.957 0 6.82-2.023 9.593-4.408.459.371 2.34 1.263 2.73 1.652-2.633 2.208-8.772 3.984-12.253 3.984-.335 0-.653-.018-.971-.053v1.864H24V4.063zm0 10.326v1.131c-3.657-.654-4.673-4.46-4.673-4.46s1.758-1.944 4.673-2.262v1.237H8.94c-1.528-.186-2.73 1.245-2.73 1.245s.68 2.412 2.739 3.11M2.456 10.9s2.164-3.197 6.5-3.533V6.201C4.153 6.59 0 10.653 0 10.653s2.35 6.802 8.948 7.42v-1.237c-4.84-.6-6.492-5.936-6.492-5.936z%22/%3E%3C/svg%3E",
			"ollama": "data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22white%22 d=%22M16.361 10.26a.894.894 0 0 0-.558.47l-.072.148.001.207c0 .193.004.217.059.353.076.193.152.312.291.448.24.238.51.3.872.205a.86.86 0 0 0 .517-.436.752.752 0 0 0 .08-.498c-.064-.453-.33-.782-.724-.897a1.06 1.06 0 0 0-.466 0zm-9.203.005c-.305.096-.533.32-.65.639a1.187 1.187 0 0 0-.06.52c.057.309.31.59.598.667.362.095.632.033.872-.205.14-.136.215-.255.291-.448.055-.136.059-.16.059-.353l.001-.207-.072-.148a.894.894 0 0 0-.565-.472 1.02 1.02 0 0 0-.474.007Zm4.184 2c-.131.071-.223.25-.195.383.031.143.157.288.353.407.105.063.112.072.117.136.004.038-.01.146-.029.243-.02.094-.036.194-.036.222.002.074.07.195.143.253.064.052.076.054.255.059.164.005.198.001.264-.03.169-.082.212-.234.15-.525-.052-.243-.042-.28.087-.355.137-.08.281-.219.324-.314a.365.365 0 0 0-.175-.48.394.394 0 0 0-.181-.033c-.126 0-.207.03-.355.124l-.085.053-.053-.032c-.219-.13-.259-.145-.391-.143a.396.396 0 0 0-.193.032zm.39-2.195c-.373.036-.475.05-.654.086-.291.06-.68.195-.951.328-.94.46-1.589 1.226-1.787 2.114-.04.176-.045.234-.045.53 0 .294.005.357.043.524.264 1.16 1.332 2.017 2.714 2.173.3.033 1.596.033 1.896 0 1.11-.125 2.064-.727 2.493-1.571.114-.226.169-.372.22-.602.039-.167.044-.23.044-.523 0-.297-.005-.355-.045-.531-.288-1.29-1.539-2.304-3.072-2.497a6.873 6.873 0 0 0-.855-.031zm.645.937a3.283 3.283 0 0 1 1.44.514c.223.148.537.458.671.662.166.251.26.508.303.82.02.143.01.251-.043.482-.08.345-.332.705-.672.957a3.115 3.115 0 0 1-.689.348c-.382.122-.632.144-1.525.138-.582-.006-.686-.01-.853-.042-.57-.107-1.022-.334-1.35-.68-.264-.28-.385-.535-.45-.946-.03-.192.025-.509.137-.776.136-.326.488-.73.836-.963.403-.269.934-.46 1.422-.512.187-.02.586-.02.773-.002zm-5.503-11a1.653 1.653 0 0 0-.683.298C5.617.74 5.173 1.666 4.985 2.819c-.07.436-.119 1.04-.119 1.503 0 .544.064 1.24.155 1.721.02.107.031.202.023.208a8.12 8.12 0 0 1-.187.152 5.324 5.324 0 0 0-.949 1.02 5.49 5.49 0 0 0-.94 2.339 6.625 6.625 0 0 0-.023 1.357c.091.78.325 1.438.727 2.04l.13.195-.037.064c-.269.452-.498 1.105-.605 1.732-.084.496-.095.629-.095 1.294 0 .67.009.803.088 1.266.095.555.288 1.143.503 1.534.071.128.243.393.264.407.007.003-.014.067-.046.141a7.405 7.405 0 0 0-.548 1.873c-.062.417-.071.552-.071.991 0 .56.031.832.148 1.279L3.42 24h1.478l-.05-.091c-.297-.552-.325-1.575-.068-2.597.117-.472.25-.819.498-1.296l.148-.29v-.177c0-.165-.003-.184-.057-.293a.915.915 0 0 0-.194-.25 1.74 1.74 0 0 1-.385-.543c-.424-.92-.506-2.286-.208-3.451.124-.486.329-.918.544-1.154a.787.787 0 0 0 .223-.531c0-.195-.07-.355-.224-.522a3.136 3.136 0 0 1-.817-1.729c-.14-.96.114-2.005.69-2.834.563-.814 1.353-1.336 2.237-1.475.199-.033.57-.028.776.01.226.04.367.028.512-.041.179-.085.268-.19.374-.431.093-.215.165-.333.36-.576.234-.29.46-.489.822-.729.413-.27.884-.467 1.352-.561.17-.035.25-.04.569-.04.319 0 .398.005.569.04a4.07 4.07 0 0 1 1.914.997c.117.109.398.457.488.602.034.057.095.177.132.267.105.241.195.346.374.43.14.068.286.082.503.045.343-.058.607-.053.943.016 1.144.23 2.14 1.173 2.581 2.437.385 1.108.276 2.267-.296 3.153-.097.15-.193.27-.333.419-.301.322-.301.722-.001 1.053.493.539.801 1.866.708 3.036-.062.772-.26 1.463-.533 1.854a2.096 2.096 0 0 1-.224.258.916.916 0 0 0-.194.25c-.054.109-.057.128-.057.293v.178l.148.29c.248.476.38.823.498 1.295.253 1.008.231 2.01-.059 2.581a.845.845 0 0 0-.044.098c0 .006.329.009.732.009h.73l.02-.074.036-.134c.019-.076.057-.3.088-.516.029-.217.029-1.016 0-1.258-.11-.875-.295-1.57-.597-2.226-.032-.074-.053-.138-.046-.141.008-.005.057-.074.108-.152.376-.569.607-1.284.724-2.228.031-.26.031-1.378 0-1.628-.083-.645-.182-1.082-.348-1.525a6.083 6.083 0 0 0-.329-.7l-.038-.064.131-.194c.402-.604.636-1.262.727-2.04a6.625 6.625 0 0 0-.024-1.358 5.512 5.512 0 0 0-.939-2.339 5.325 5.325 0 0 0-.95-1.02 8.097 8.097 0 0 1-.186-.152.692.692 0 0 1 .023-.208c.208-1.087.201-2.443-.017-3.503-.19-.924-.535-1.658-.98-2.082-.354-.338-.716-.482-1.15-.455-.996.059-1.8 1.205-2.116 3.01a6.805 6.805 0 0 0-.097.726c0 .036-.007.066-.015.066a.96.96 0 0 1-.149-.078A4.857 4.857 0 0 0 12 3.03c-.832 0-1.687.243-2.456.698a.958.958 0 0 1-.148.078c-.008 0-.015-.03-.015-.066a6.71 6.71 0 0 0-.097-.725C8.997 1.392 8.337.319 7.46.048a2.096 2.096 0 0 0-.585-.041Zm.293 1.402c.248.197.523.759.682 1.388.03.113.06.244.069.292.007.047.026.152.041.233.067.365.098.76.102 1.24l.002.475-.12.175-.118.178h-.278c-.324 0-.646.041-.954.124l-.238.06c-.033.007-.038-.003-.057-.144a8.438 8.438 0 0 1 .016-2.323c.124-.788.413-1.501.696-1.711.067-.05.079-.049.157.013zm9.825-.012c.17.126.358.46.498.888.28.854.36 2.028.212 3.145-.019.14-.024.151-.057.144l-.238-.06a3.693 3.693 0 0 0-.954-.124h-.278l-.119-.178-.119-.175.002-.474c.004-.669.066-1.19.214-1.772.157-.623.434-1.185.68-1.382.078-.062.09-.063.159-.012z%22/%3E%3C/svg%3E",
			"ollama_cloud": "data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22white%22 d=%22M16.361 10.26a.894.894 0 0 0-.558.47l-.072.148.001.207c0 .193.004.217.059.353.076.193.152.312.291.448.24.238.51.3.872.205a.86.86 0 0 0 .517-.436.752.752 0 0 0 .08-.498c-.064-.453-.33-.782-.724-.897a1.06 1.06 0 0 0-.466 0zm-9.203.005c-.305.096-.533.32-.65.639a1.187 1.187 0 0 0-.06.52c.057.309.31.59.598.667.362.095.632.033.872-.205.14-.136.215-.255.291-.448.055-.136.059-.16.059-.353l.001-.207-.072-.148a.894.894 0 0 0-.565-.472 1.02 1.02 0 0 0-.474.007Zm4.184 2c-.131.071-.223.25-.195.383.031.143.157.288.353.407.105.063.112.072.117.136.004.038-.01.146-.029.243-.02.094-.036.194-.036.222.002.074.07.195.143.253.064.052.076.054.255.059.164.005.198.001.264-.03.169-.082.212-.234.15-.525-.052-.243-.042-.28.087-.355.137-.08.281-.219.324-.314a.365.365 0 0 0-.175-.48.394.394 0 0 0-.181-.033c-.126 0-.207.03-.355.124l-.085.053-.053-.032c-.219-.13-.259-.145-.391-.143a.396.396 0 0 0-.193.032zm.39-2.195c-.373.036-.475.05-.654.086-.291.06-.68.195-.951.328-.94.46-1.589 1.226-1.787 2.114-.04.176-.045.234-.045.53 0 .294.005.357.043.524.264 1.16 1.332 2.017 2.714 2.173.3.033 1.596.033 1.896 0 1.11-.125 2.064-.727 2.493-1.571.114-.226.169-.372.22-.602.039-.167.044-.23.044-.523 0-.297-.005-.355-.045-.531-.288-1.29-1.539-2.304-3.072-2.497a6.873 6.873 0 0 0-.855-.031zm.645.937a3.283 3.283 0 0 1 1.44.514c.223.148.537.458.671.662.166.251.26.508.303.82.02.143.01.251-.043.482-.08.345-.332.705-.672.957a3.115 3.115 0 0 1-.689.348c-.382.122-.632.144-1.525.138-.582-.006-.686-.01-.853-.042-.57-.107-1.022-.334-1.35-.68-.264-.28-.385-.535-.45-.946-.03-.192.025-.509.137-.776.136-.326.488-.73.836-.963.403-.269.934-.46 1.422-.512.187-.02.586-.02.773-.002zm-5.503-11a1.653 1.653 0 0 0-.683.298C5.617.74 5.173 1.666 4.985 2.819c-.07.436-.119 1.04-.119 1.503 0 .544.064 1.24.155 1.721.02.107.031.202.023.208a8.12 8.12 0 0 1-.187.152 5.324 5.324 0 0 0-.949 1.02 5.49 5.49 0 0 0-.94 2.339 6.625 6.625 0 0 0-.023 1.357c.091.78.325 1.438.727 2.04l.13.195-.037.064c-.269.452-.498 1.105-.605 1.732-.084.496-.095.629-.095 1.294 0 .67.009.803.088 1.266.095.555.288 1.143.503 1.534.071.128.243.393.264.407.007.003-.014.067-.046.141a7.405 7.405 0 0 0-.548 1.873c-.062.417-.071.552-.071.991 0 .56.031.832.148 1.279L3.42 24h1.478l-.05-.091c-.297-.552-.325-1.575-.068-2.597.117-.472.25-.819.498-1.296l.148-.29v-.177c0-.165-.003-.184-.057-.293a.915.915 0 0 0-.194-.25 1.74 1.74 0 0 1-.385-.543c-.424-.92-.506-2.286-.208-3.451.124-.486.329-.918.544-1.154a.787.787 0 0 0 .223-.531c0-.195-.07-.355-.224-.522a3.136 3.136 0 0 1-.817-1.729c-.14-.96.114-2.005.69-2.834.563-.814 1.353-1.336 2.237-1.475.199-.033.57-.028.776.01.226.04.367.028.512-.041.179-.085.268-.19.374-.431.093-.215.165-.333.36-.576.234-.29.46-.489.822-.729.413-.27.884-.467 1.352-.561.17-.035.25-.04.569-.04.319 0 .398.005.569.04a4.07 4.07 0 0 1 1.914.997c.117.109.398.457.488.602.034.057.095.177.132.267.105.241.195.346.374.43.14.068.286.082.503.045.343-.058.607-.053.943.016 1.144.23 2.14 1.173 2.581 2.437.385 1.108.276 2.267-.296 3.153-.097.15-.193.27-.333.419-.301.322-.301.722-.001 1.053.493.539.801 1.866.708 3.036-.062.772-.26 1.463-.533 1.854a2.096 2.096 0 0 1-.224.258.916.916 0 0 0-.194.25c-.054.109-.057.128-.057.293v.178l.148.29c.248.476.38.823.498 1.295.253 1.008.231 2.01-.059 2.581a.845.845 0 0 0-.044.098c0 .006.329.009.732.009h.73l.02-.074.036-.134c.019-.076.057-.3.088-.516.029-.217.029-1.016 0-1.258-.11-.875-.295-1.57-.597-2.226-.032-.074-.053-.138-.046-.141.008-.005.057-.074.108-.152.376-.569.607-1.284.724-2.228.031-.26.031-1.378 0-1.628-.083-.645-.182-1.082-.348-1.525a6.083 6.083 0 0 0-.329-.7l-.038-.064.131-.194c.402-.604.636-1.262.727-2.04a6.625 6.625 0 0 0-.024-1.358 5.512 5.512 0 0 0-.939-2.339 5.325 5.325 0 0 0-.95-1.02 8.097 8.097 0 0 1-.186-.152.692.692 0 0 1 .023-.208c.208-1.087.201-2.443-.017-3.503-.19-.924-.535-1.658-.98-2.082-.354-.338-.716-.482-1.15-.455-.996.059-1.8 1.205-2.116 3.01a6.805 6.805 0 0 0-.097.726c0 .036-.007.066-.015.066a.96.96 0 0 1-.149-.078A4.857 4.857 0 0 0 12 3.03c-.832 0-1.687.243-2.456.698a.958.958 0 0 1-.148.078c-.008 0-.015-.03-.015-.066a6.71 6.71 0 0 0-.097-.725C8.997 1.392 8.337.319 7.46.048a2.096 2.096 0 0 0-.585-.041Zm.293 1.402c.248.197.523.759.682 1.388.03.113.06.244.069.292.007.047.026.152.041.233.067.365.098.76.102 1.24l.002.475-.12.175-.118.178h-.278c-.324 0-.646.041-.954.124l-.238.06c-.033.007-.038-.003-.057-.144a8.438 8.438 0 0 1 .016-2.323c.124-.788.413-1.501.696-1.711.067-.05.079-.049.157.013zm9.825-.012c.17.126.358.46.498.888.28.854.36 2.028.212 3.145-.019.14-.024.151-.057.144l-.238-.06a3.693 3.693 0 0 0-.954-.124h-.278l-.119-.178-.119-.175.002-.474c.004-.669.066-1.19.214-1.772.157-.623.434-1.185.68-1.382.078-.062.09-.063.159-.012z%22/%3E%3C/svg%3E",
			"open_router": "data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22white%22 d=%22M16.778 1.844v1.919q-.569-.026-1.138-.032-.708-.008-1.415.037c-1.93.126-4.023.728-6.149 2.237-2.911 2.066-2.731 1.95-4.14 2.75-.396.223-1.342.574-2.185.798-.841.225-1.753.333-1.751.333v4.229s.768.108 1.61.333c.842.224 1.789.575 2.185.799 1.41.798 1.228.683 4.14 2.75 2.126 1.509 4.22 2.11 6.148 2.236.88.058 1.716.041 2.555.005v1.918l7.222-4.168-7.222-4.17v2.176c-.86.038-1.611.065-2.278.021-1.364-.09-2.417-.357-3.979-1.465-2.244-1.593-2.866-2.027-3.68-2.508.889-.518 1.449-.906 3.822-2.59 1.56-1.109 2.614-1.377 3.978-1.466.667-.044 1.418-.017 2.278.02v2.176L24 6.014Z%22/%3E%3C/svg%3E",
			"openai": "data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22white%22 d=%22M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z%22/%3E%3C/svg%3E",
			"openai_api": "data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22white%22 d=%22M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z%22/%3E%3C/svg%3E",
			"opencode": "data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22white%22 d=%22M22 24H2V0h20zM17 4.8H7v14.4h10z%22/%3E%3C/svg%3E",
			"opencode_go": "data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22white%22 d=%22M22 24H2V0h20zM17 4.8H7v14.4h10z%22/%3E%3C/svg%3E",
			"opencode_zen": "data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22white%22 d=%22M22 24H2V0h20zM17 4.8H7v14.4h10z%22/%3E%3C/svg%3E",
			"opper": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAAJFBMVEVHcEwbLkAZLD8aLkAbL0EbLkEbL0IbLkEbLkEaLkAaLT8bLkC+9fsvAAAAC3RSTlMA6BJWdKSOv9RBMDAEXzcAAAGpSURBVFiFpVdZlgMhCIx7lPvfd9IzExvtUuDJb6cIS1Hg64XMh5iKc0Tk4Pe91UTMrGifaTBjBL7QZG8TPs9womL5e/fEU9bjK4ATBTU+QDz5Q7y6CQ3jKWkdLPDUlPhH+40ZLApAFA8T0A5CXOG1LDoN4LgCpy1YZqBl8SoD9RgljP+SWI4DqQATEpHMHuK7knmxFVBHbiGrIpkQDdkQZ7GZQEh5/Z3YzaeQc0SVNWV2MBbtapEQwtjFqWS/HBGqwBy4uWX/HHPbGDo6z5Rpt+8dGci5kmKd/sTXOOUW2iKOy0HJsU34PDM8hZWD3r44/qJxF5vR5D8rdfjUObbd8SMP3OAiK/APOSg8kT/vWzwYJp6vkP9lYJwZ+6N85CBBYRiFNiJJuz0UebsAQWCSFOQrC98WXZQV6wnL8jd1xYmxWM7q82q12ww3Kiyj5URcrVe9g8V+1d4HH3ufhoAXpCUEnITltYE7UWVgN3hnqE/ly+CtZXEAY7DkAOtgygH1wvru9A9GGWYSB2GYqK+NlTA8+27ji9ny8GTW+nK2PX25fS6EVJxMpR+nBzhL2WkkEAAAAABJRU5ErkJggg==",
			"orcarouter": "data:image/png;base64,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",
			"perplexity": "data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22white%22 d=%22M22.3977 7.0896h-2.3106V.0676l-7.5094 6.3542V.1577h-1.1554v6.1966L4.4904 0v7.0896H1.6023v10.3976h2.8882V24l6.932-6.3591v6.2005h1.1554v-6.0469l6.9318 6.1807v-6.4879h2.8882V7.0896zm-3.4657-4.531v4.531h-5.355l5.355-4.531zm-13.2862.0676 4.8691 4.4634H5.6458V2.6262zM2.7576 16.332V8.245h7.8476l-6.1149 6.1147v1.9723H2.7576zm2.8882 5.0404v-3.8852h.0001v-2.6488l5.7763-5.7764v7.0111l-5.7764 5.2993zm12.7086.0248-5.7766-5.1509V9.0618l5.7766 5.7766v6.5588zm2.8882-5.0652h-1.733v-1.9723L13.3948 8.245h7.8478v8.087z%22/%3E%3C/svg%3E",
			"poolside": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAAgVBMVEVDN/////9BNf8zI/9AM/84Kv9NQv/p6P89MP87Lv/d2//19f+dmP/T0f/9/f+inv+7uP9kW/+rp//t7P8vHv/y8f9TSf9aUP/Myv9eVf9IPf/l5P/Z1/9nXv8nEv+uqv9tZf91bv/DwP+Tjf+Ff/+0sP+Xkv97dP+OiP8fAP9/ef95+YSIAAADfklEQVRYhe1XW5uiMAytSctVQKTcFcHbOPP/f+A2LaiMoM7u0+63eXAqNuHkJD3NMPbf/nUDAM7Vx+95c4GCWVlmMbXgPw0CAvOosP2FMt8OohLFT0IAwtpejCxZV8jffjtbLSZsZb2HguNycFHgiyKok/5rGL0DwrU2ZrsXxQyVfUJxBeFZ7it/EWviFkUsNfUgD+FdGv5WvPBvzZtKacA6IjDozwOM9mkEN9ablg0f49lJeSUmfpIFt2h/2GH/HY8GT47gdJQX/exbs0wCEn/hNU15Nq8n7nmuVvuc+NjgXDXFcpSk8Q8/9H6oCMpnpzOcoYFbFD9oOToa/0HTnpndAAq+LU2PVNMQcOi/TSeBCf2yhDl9eo5qpwRZ41FP4mQAeSv4Ct1c+8NAGLgUQAAv6fn0CUfv1jAbUavP1HLYtwBMUkOsJ1mA6rS7XA4rXfrkW8mHFBinVrGncwAhXNdFd+Di0CC6PVhgmkTKlIDmz04VNEOEsF4dpTmBYOkOUCsRqVX0tKGhqe/OzymjRtDk7SmAzqGYzmEw3XZ3IYTDXOrqnbgm80JbxMHe7PeB3Rc2KYXYqb9HTSoqtfPZC3FyJWmJZKcexMcnHZNM04F0wq231A3wSsaXwp2akmBxjfXKdOL1xxCkZ+79AEDZLo4yT02Ai1AyN59CpWwCQILgZn1bhPVOaYusJ0kES9n4kT4cB1U6cc1C1RR5OllGUNdgNnrikMCGDS3l/hYhKKcbCaw8z0eZySAMe/UBtkm9YGOuO3+mlauyLPO7AE7r+6Hf6x+goMbIBnEvJ4oA8Tbe3okVFql/J3/6By53pjWndBXytm1vkZ02Tf3U+bYRGo1hWlDYR9d1Vwi4StLwUX8dLWnTqsrbr6+vrhchHtd2mjxW+5moQnVRihYbGcRTnfiPXGtZD+fuJr5dns/LnCLw3KuT9AGAuXvn5ci5RMoyFQF3Xp0+UCW2JBDe7NWmkliflJWCANjp99EMO/J/crkS8r2y4vi5qx8A8Mbc8NunQ4pTBsq8Va0AjHqAy9LcO88HDHWEy8LzPPJfN0MKwIWMzXHy4xf+CkO1t2s7SX0asrQyIouj/tbbvB6yaMQ9237qa75qGvPMvEq2fG/WBGENYjyyVfX2uAtYrZOxt72G+fJPosDyNmwXUf6zYVuHGI/7P/QegvzRPxz/7S+yX6vIMVP5SZMlAAAAAElFTkSuQmCC",
			"qwencloud": "data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22white%22 d=%22M3.996 4.517h5.291L8.01 6.324 4.153 7.506a1.668 1.668 0 0 0-1.165 1.601v5.786a1.668 1.668 0 0 0 1.165 1.6l3.857 1.183 1.277 1.807H3.996A3.996 3.996 0 0 1 0 15.487V8.513a3.996 3.996 0 0 1 3.996-3.996m16.008 0h-5.291l1.277 1.807 3.857 1.182c.715.227 1.17.889 1.165 1.601v5.786a1.668 1.668 0 0 1-1.165 1.6l-3.857 1.183-1.277 1.807h5.291A3.996 3.996 0 0 0 24 15.487V8.513a3.996 3.996 0 0 0-3.996-3.996m-4.007 8.345H8.002v-1.804h7.995Z%22/%3E%3C/svg%3E",
			"qwencloud_coding": "data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22white%22 d=%22M3.996 4.517h5.291L8.01 6.324 4.153 7.506a1.668 1.668 0 0 0-1.165 1.601v5.786a1.668 1.668 0 0 0 1.165 1.6l3.857 1.183 1.277 1.807H3.996A3.996 3.996 0 0 1 0 15.487V8.513a3.996 3.996 0 0 1 3.996-3.996m16.008 0h-5.291l1.277 1.807 3.857 1.182c.715.227 1.17.889 1.165 1.601v5.786a1.668 1.668 0 0 1-1.165 1.6l-3.857 1.183-1.277 1.807h5.291A3.996 3.996 0 0 0 24 15.487V8.513a3.996 3.996 0 0 0-3.996-3.996m-4.007 8.345H8.002v-1.804h7.995Z%22/%3E%3C/svg%3E",
			"sambanova": "data:image/png;base64,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",
			"scaleway": "data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22white%22 d=%22M16.605 11.11v5.72a1.77 1.77 0 01-1.54 1.69h-4a1.43 1.43 0 01-1.31-1.22 1.09 1.09 0 010-.18 1.37 1.37 0 011.37-1.36h1.74a1 1 0 001-1v-3.62a1.4 1.4 0 011.18-1.39h.17a1.37 1.37 0 011.39 1.36zm-6.46 1.74V9.26a1 1 0 011-1h1.85a1.37 1.37 0 001.37-1.37 1 1 0 000-.17 1.45 1.45 0 00-1.41-1.2h-3.96a1.81 1.81 0 00-1.58 1.66v5.7a1.37 1.37 0 001.37 1.37h.21a1.4 1.4 0 001.15-1.4zm12-4.29V20a4.53 4.53 0 01-4.15 4h-7.58a8.57 8.57 0 01-8.56-8.57V4.54A4.54 4.54 0 016.395 0h7.18a8.56 8.56 0 018.56 8.56zm-2.74 0a5.83 5.83 0 00-5.82-5.82h-7.19a1.79 1.79 0 00-1.8 1.8v10.89a5.83 5.83 0 005.82 5.8h7.44a1.79 1.79 0 001.54-1.48z%22/%3E%3C/svg%3E",
			"siliconflow": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAABVUlEQVR4nO2bPUrEYBRF7/2cfQjRyj2Mg1O7hchYWomlYjFFwEVYODj7UGK2oYKrsDLPQgZErHMCeWcD93DyQxKITy+uNGUKLUCTAWgBmgxAC9BkAFqAJgPQAjQZgBagyQC0AE0GoAVoJh9gRo4fPt/t9+Xr2CrLobdD/dP74naLBgj3W4XnoQDWvarahrsEqrapQ5pT+5Kk8OPk7wEZgBagyQC0AE0GoAVoMgAtQIMFIJ7//wMJULVNHRErYvsvM+lHyCpLRRwMMYq/A/zCl0efD2M5GkNje1OGOupjw1Ln3uvZWE5H2xv3Xg+193py/SHBX4R2WOreFjfnxPYongPCcU9tjyIASQagBWgyAC1AkwFoAZoMQAvQFEsdLtHvvWDbjlLb3hDjljo5znYvJohD/i8wcTIALUCTAWgBmgxAC9BkAFqAJgPQAjQZgBagyQC0AM039UZByfn85ksAAAAASUVORK5CYII=",
			"tencent": "data:image/png;base64,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",
			"together": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAAwFBMVEX////KrvXvLMH8TALJrPXuE7770/DuALzvH8DGqPT8PwD8RQDFpvT8OgD8NQD8SQDw6Pz28f396vj83vPg0PnzctHZxvjm2frt5Pv6ze36yOz4teb0hdf+9Pz69/7xSsfQt/bo3/v1k9vSwfn5nd3zV8nHs/jzac//49X+w7P/3Mz6wObuEsT0kYn7eXjxW9P4rePu0uT9YhL7m6z2pef/9/D9kHP8a0D+1Mn+t6b9po/8UxX8XCL/6eH9g2P9mn/QM0WbAAABqUlEQVRYhe2Ty3aCMBRFwyMCgSAq4qMUsbZW1L4riq31//+qCQkKoxDW6qjsAYbB2bk5QQBaWlpa/pbI83rl9/5kOpCIjxSLoPvF+41qQGgY4W3N3RVLVyi6nk8RzaCaYxrTWnmWzg0ONaimWmBMagjiq4AAwPCaV1UYCfOeVc5b875RyqvmnVAQVAZQFvflAYhBKFCqguUDuQBK0UJfJChOsOA3MenkDGa8BOHnwAVWxBbLmckoJhAKYn6DwZwa9DisdmAIOxjxEZweVen+FJbz5qNQcCkh7pGVE4HqAB2xYOzwFsaBbo0AGJQ+BBiK8+QQDr+AyPFXSbLebC/71zgAxSP/JoLlP9kYIYyeX7b0HiB8rZenCj8I/DfN1iju6v3jczgMN7XjjJ3dzfN2miG8lgxT9mx/De8wecjnD5jlUZYSEzpKC1I2QPfr5NIfTVrwzRpA632+cHeyAt6AliHWxElWoLEJ+FU2mOCnGIF3KZsHCS7n7VRacDkDO4F0BQCs3Gsey38GhMTlNXTdc5M8AKe9i2wbYe3QLE8V2Tk9No+3tLT8L34B2aIay5uhmdMAAAAASUVORK5CYII=",
			"tokenrouter": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAAgVBMVEVHcEwra/86Yf8ic/9AXf85Zf8qcP9XT/8EhP82Zv8Nf/8Igv8Ahv////9VT/9PVP8OfP8vaP8Bhv8IgP8TeP9HWv9CXP88X/8ecv81ZP8kb/8pbP8ChP9JV/8Fgv8Wdv84Yv8cdf/k6v82Rv8Da//Bzv8TW/+Xtf+Io/93gP9Fkf90sHWvAAAADXRSTlMA4p1awRkob29Apb3QtJadmQAAAdRJREFUWIXtltuWgjAMRSuggFoGAUFERCj3///AScEbSgLzPOwnVptzCKkmZWxhYWGUjWoQqBtabeydSfbGGlGvt9Pqnt1oHtuLc6G4Xl3XvXaPzmX3/Xr3SuHaXltXVVU7nt1HmkO96Up/FK8t+IOi9WQqrjHU0/KMv5N1Fu8OG5siKfgnVQ7rrvo0IPVe9qWHJKSD/TiM3Z/10sGz7fReAI8gH9dDLXPY7cuwovQVoue8TmC/SyDxUoQkSVE953mSJDKFLSYH8u8DeFHlaboCgxNBTuihjqdTumYmpa8pA95CiMqMMw75BfIbzmeFKbg+Qs+wpwCDFdPOEUpJ6nlWRhEY4Po5BgfI4IAyaQAxTMP1cwxWTKEMJooIBhrTQ5xy4hjL8KAwkzAI6B9ScwtDaCo3nIAsQlZCCMwILcAhv6GGAPlnMnG97weEgYAIvWsoPgHeUBofXtC3NMpAoC1NwK7eN0XtiBMjDpmQu4+2Tuj9OB5zKEQMu88xvYkpxMhgEXLjNViY+UMhmo/RdhSwGuuD4Ug6WKJ5G66N6BYHehjvtIMlxLGp67o5CmF1Sx/jHVCsP6B9yWUSsy009KqlazPUOnbJuh+pqROYE9e8hYX/yy/5qqH9sWnEYAAAAABJRU5ErkJggg==",
			"venice": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAARVBMVEVHcEz///////oAGTj//vr//vr//vr39vP//vr//voAAygAIT0NKUJBT19RXWtrdH/X2dh+ho4qPVGTmqDu7uzEx8ivs7Zj49VaAAAACnRSTlMA////wXWm+jqJBIqveQAAA3pJREFUWIWtl9GCoyAMRRuYGdqAKGj9/0/di6IEqu50uzyMdsI9hhAC3G57uz++jPpFM1+P++21ff9GW9p3I7+/J0+t8uLxvl6pR9H//IteqZ+Pvi98OBs/Hb5WbY1DJSoTSWHKOpoCHfdRF/NHPeuVQBNzJpjWle/GAaEP3PcLAfq+53AyitMIkNU9eRCg99RrdwK4yymoBuoAAMEkPQCxMpbXx+1rf59CC1DknfN4NIAw7a9ftz2kZDm2AEWdT38lgFRku/8yJYbwV3fUAvrwAui09sUfMQkV4RTQ6CWgIpwBWr2q87AQyFlfAN5mwIu+BqSemUDR6kArAA5kAPS21jceDNq5TJisRfolAJLaOpP1sA+nHtDAzm0EWgkALHra9M7xcBKDrK8IYwhB1/qGcJN65qWLLYTkctHbBY9uw2EeDGizdjZuc5EIwO167aN1ek79zoJIT7bWpL47Qeg7MhjVk+g0D1QCoAYIQoxT0SciAJXkBSD7L04p+RvV4S+AqWScWFnlF02XAFVptpxr1mmtWAB0sKkWQq1v20lNFYRr/QUgE0712e0LwEJAbb/6vgAcxwGJZC/1VzFA3lBaC8vL+wAafaovaIikH2uCcPcUMLD2GL9HDHuveTjrd5AH2V+/jn+Ng5eWyyFgLxyGKfVM4+ek4RQHabkAkBlTvWA35vF3SnU5DqNLFj2ai7VAM2v9VAoP57Xtes3PJ+u+s9qjEs1KPTUe50V15LXeYVU7a+NS1Clgg4moK8s6TnWTqymRRTXJ8vqxa+lcYkFrubV5ZWXUEQAFj/u8rbDMwDQTnLcWnHycPQQgABzm7N44h1J7U72GJQ8zWUQYBKBHOdtmiVJ93caK2DylZcp+tgBd5yv1pSL1tWXUh4B6y8KQ9i091jOHND8GzM139rNC1/g2HwO6KPMUKbydDXFmrM69FEWJEIeskf2g1lVn8BL36UY842bBY/AilYw85rFlzomEFWFLpEjDonMiwcLymFcOmgius1siIRNLSDBo57ZEQrqJkDzkUTcdAPTyMiHj5dQhR1ze9LSriuy9Pmx7ToWcTLTcTD2OKdFQKvLspaE57tOMweJszrHZARHIuFpsNdnfLxcOGnCqmYfX4gXLHMLYWA6uPLS0Vr6b6v/c/8+l6/Nr3+cXz8+vvm9fvk17+f799Z9Mff3/A7uFPu3LjoWuAAAAAElFTkSuQmCC",
			"vercel": "data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22white%22 d=%22m12 1.608 12 20.784H0Z%22/%3E%3C/svg%3E",
			"vertex": "data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22white%22 d=%22M12.19 2.38a9.344 9.344 0 0 0-9.234 6.893c.053-.02-.055.013 0 0-3.875 2.551-3.922 8.11-.247 10.941l.006-.007-.007.03a6.717 6.717 0 0 0 4.077 1.356h5.173l.03.03h5.192c6.687.053 9.376-8.605 3.835-12.35a9.365 9.365 0 0 0-2.821-4.552l-.043.043.006-.05A9.344 9.344 0 0 0 12.19 2.38zm-.358 4.146c1.244-.04 2.518.368 3.486 1.15a5.186 5.186 0 0 1 1.862 4.078v.518c3.53-.07 3.53 5.262 0 5.193h-5.193l-.008.009v-.04H6.785a2.59 2.59 0 0 1-1.067-.23h.001a2.597 2.597 0 1 1 3.437-3.437l3.013-3.012A6.747 6.747 0 0 0 8.11 8.24c.018-.01.04-.026.054-.023a5.186 5.186 0 0 1 3.67-1.69z%22/%3E%3C/svg%3E",
			"vertex-partner": "data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22white%22 d=%22M12.19 2.38a9.344 9.344 0 0 0-9.234 6.893c.053-.02-.055.013 0 0-3.875 2.551-3.922 8.11-.247 10.941l.006-.007-.007.03a6.717 6.717 0 0 0 4.077 1.356h5.173l.03.03h5.192c6.687.053 9.376-8.605 3.835-12.35a9.365 9.365 0 0 0-2.821-4.552l-.043.043.006-.05A9.344 9.344 0 0 0 12.19 2.38zm-.358 4.146c1.244-.04 2.518.368 3.486 1.15a5.186 5.186 0 0 1 1.862 4.078v.518c3.53-.07 3.53 5.262 0 5.193h-5.193l-.008.009v-.04H6.785a2.59 2.59 0 0 1-1.067-.23h.001a2.597 2.597 0 1 1 3.437-3.437l3.013-3.012A6.747 6.747 0 0 0 8.11 8.24c.018-.01.04-.026.054-.023a5.186 5.186 0 0 1 3.67-1.69z%22/%3E%3C/svg%3E",
			"volcengine-ark": "data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22white%22 d=%22M19.8772 1.4685L24 2.5326v18.9426l-4.1228 1.0563V1.4685zm-13.3481 9.428l4.115 1.0641v8.9786l-4.115 1.0642v-11.107zM0 2.572l4.115 1.0642v16.7354L0 21.428V2.572zm17.4553 5.6205v11.107l-4.1228-1.0642V9.2568l4.1228-1.0642z%22/%3E%3C/svg%3E",
			"wafer": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAAWlBMVEVHcEz////////////////////////////////7+/v///////8A1br///8AAADV1dW6urp3d3efn5/v7++vr6+NjY3i4uIfHx9GRkZhYWHJyckvLy/Dw8PR0dGD8c/vAAAADHRSTlMAcZurD1flvpH7MtSZCFsnAAACF0lEQVRYhd2X2ZaDIAyGq22ttkesG1qX93/NaZBNCZDTnrmYySX4fxIIITmd/qtdrkl6vgUtoL7nWRm3zCdPCoIaLEXlVy0v+LQ8vdaWZY65/pDqpR5Y0FYUcN3U1SssBqswQLrJx7gcB9yE54S/ewBCP9HkGEDoe6reBZxBby+/7vh2mmuDbcoRkOz183MXMq27sgPgDp/VerZzw64OAyD8OjX3QgO3CgHy9wdcTfWe0C9mL+AC82q68d+e0Qc4Ww74/i9swAFiAXJ8DOnLFgfAETZyPJILOhSQmQUg57e3GQGAB6scjunNXbEAkARq4gLMPlqA1HhAyIaNC3jo3cVDcG/cBbx/u0RjyJgLMOtaKYAaA8jBlgLoAwCKXsXS54Dnt4DlV1yQG8MpgCZwjBMF4B5jpq8IKZAGB3DToRzOJpupnGIBcoMlRBJymeA692QfkOsMCUUl/aheRsE+pT0MOLqEAQNAUlXZMrILagcO7wJMMcpB6NfrAICkJu8IqwP6gnkA4mVR71bgaRp8ABEK+tXxEdpd4Yc878oJNqLJeWEsABAFhilD3PehPRZvaIljVSF7BD/WJ0iRlR4I7NVVIij41M+OHCvzRJnWIJ/ihhSagvBFoSkJhesuGSDC4e30x8W2LveRTScCrIYD3XrL8IbjZLc8Ja8mb8fTeVoegaC0bGB40wVGbPsuXoCAJPnnjecfsx/WK6AE/eY01gAAAABJRU5ErkJggg==",
			"wandb": "data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22white%22 d=%22M2.48 0a1.55 1.55 0 1 0 0 3.1 1.55 1.55 0 0 0 0-3.1zm19.04 0a1.55 1.55 0 1 0 0 3.101 1.55 1.55 0 0 0 0-3.101zM12 2.295a1.55 1.55 0 1 0 0 3.1 1.55 1.55 0 0 0 0-3.1zM2.48 5.272a2.48 2.48 0 1 0 0 4.96 2.48 2.48 0 0 0 0-4.96zm19.04 0a2.48 2.48 0 1 0 0 4.96 2.48 2.48 0 0 0 0-4.96zM12 8.496a1.55 1.55 0 1 0 0 3.1 1.55 1.55 0 0 0 0-3.1zm-9.52 3.907a1.55 1.55 0 1 0 0 3.1 1.55 1.55 0 0 0 0-3.1zm19.04 0a1.55 1.55 0 1 0 0 3.102 1.55 1.55 0 0 0 0-3.102zM12 13.767a2.48 2.48 0 1 0 0 4.962 2.48 2.48 0 0 0 0-4.962zm-9.52 3.907a2.48 2.48 0 1 0 .001 4.962 2.48 2.48 0 0 0 0-4.962zm19.04.93a1.55 1.55 0 1 0 0 3.102 1.55 1.55 0 0 0 0-3.101zM12 20.9a1.55 1.55 0 1 0 0 3.1 1.55 1.55 0 0 0 0-3.1Z%22/%3E%3C/svg%3E",
			"xai": "data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22white%22 d=%22M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z%22/%3E%3C/svg%3E",
			"xiaomi-tokenplan": "data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22white%22 d=%22M12 0C8.016 0 4.756.255 2.493 2.516.23 4.776 0 8.033 0 12.012c0 3.98.23 7.235 2.494 9.497C4.757 23.77 8.017 24 12 24c3.983 0 7.243-.23 9.506-2.491C23.77 19.247 24 15.99 24 12.012c0-3.984-.233-7.243-2.502-9.504C19.234.252 15.978 0 12 0zM4.906 7.405h5.624c1.47 0 3.007.068 3.764.827.746.746.827 2.233.83 3.676v4.54a.15.15 0 0 1-.152.147h-1.947a.15.15 0 0 1-.152-.148V11.83c-.002-.806-.048-1.634-.464-2.051-.358-.36-1.026-.441-1.72-.458H7.158a.15.15 0 0 0-.151.147v6.98a.15.15 0 0 1-.152.148H4.906a.15.15 0 0 1-.15-.148V7.554a.15.15 0 0 1 .15-.149zm12.131 0h1.949a.15.15 0 0 1 .15.15v8.892a.15.15 0 0 1-.15.148h-1.949a.15.15 0 0 1-.151-.148V7.554a.15.15 0 0 1 .151-.149zM8.92 10.948h2.046c.083 0 .15.066.15.147v5.352a.15.15 0 0 1-.15.148H8.92a.15.15 0 0 1-.152-.148v-5.352a.15.15 0 0 1 .152-.147Z%22/%3E%3C/svg%3E",
			"xkiro": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAAKlBMVEVHcEwixV4ixV4ixV4ixV4ixV4ixV4ixV4ixV4ixV4ixV4ixV4ixV4ixV4Z7RiHAAAADXRSTlMADB/khnemtPdLOWHEgOsvlQAAAelJREFUWIWVl1sSgyAMRVEQEM3+t1tfVPKCyEenkpxjbwdRnbvH6j6OdcbHM6QPjhIg0LkJwOiYQwZY+PxpAIgDxxz82Sbw1XA4ikov/m4R+dcgO6ZKE34SDdTR0JifXNQMkP+ObYcs83NwK6iGwxHKSaOBeDhWA+SOgQ/M5+MzfTJg/lpOK3wwEB6u9Qx2A+Xz9S2aDZR/LogVjAbGw3NFgs3Aef8cRZOB8/9LuoDBIPDw31NgbJB4/5+JQ4PEN5tSgYFB5KHZFXPfIPO+mQ0gG3KHR9MFZIPb0h5mmQe0r2fNgEfLe1QJYDG0PNlYUUkzoCYgTX5swLwn1YCqecizWwMp71zgcQf7kaM6OQNN4NyCG9itacX1jQniN0FkAlwH/h8MGsgJ2OPDMCNOkDhPW2iGMU8NnQQKTwz4USZZeGzAGWw8NigJML/GFCbF0GZICn+v70U2tK1dnqyK1yAkkHnN8GZIA14xvO1DXjHU423My4Z6TScDLxrqvmXiRUOTYMxLhjvDbuQFw14T2HjB8CSw8tywXQnsPDOcGT7xzHC+C/T4WNCrBjOkxS06X1/iiAMZyC3Sc1pwCHs+5Xd+53pf2XSD1+nHEXzP4Ps0ckiGo+CXzgNW48iSIdvo6mCGbRY79VEe4AdjcVNeJgX43gAAAABJRU5ErkJggg==",
			"zai": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAAXVBMVEUtLS3///8GBgbx8fHs7OwCAgL19fUqKio5OTknJycjIyMcHBwTExMPDw+ysrJUVFTMzMzg4OAYGBgzMzOjo6NhYWFHR0eVlZVOTk50dHSDg4PW1ta7u7uPj49CQkLBrYlSAAABsklEQVRYhc2X23KDMAxEBcE3jE0wSZtL2///zNJMS0C2hW0emn3UsCcaRbNjQbVT8FKAQ7JCANuzOlmstwjQyE5BhlQ3NktAY7LsD0TdLAAy2z8RxifAdvl+gM7OgL6ggamFywxgJX4A9gc41GWAxxhfDWD8bXQALSrpKMAMHG89P7r2uq5yq2OA3+VaSSqFKryLdhAA3DS7o9K8NSmAI3OfqHSa1zYA4OjjQasvXHpunQ8Qcq2xFgw3JQX1NwokMBb5bxooAFZ79mZCLxKScHgoWmQB2BH5zy3kAPQN+a2BHIAYkb9BubEFYAMCvKksQHdC/ncHOQDVI//dCz4aUB8QQIgsQP2B/NfW/4YAtFfk/wj9SBwgvBAxvp8CxEMkDUCESBKACpEkABUiKQAyRBIAdIhsAzZCZBuwESKbgFCIeFFLAAIhIsyI0l4QgECIaFzidRwQCBFvJlUTBwRCxJsJCTBeiCg8ExKgbcWXmkLE3bmnwUQ70GytaQMc8zRHw0u+0goBu5+6+x/bu5/7ZQeHrJ6AkpPHLE+egqNLro6unzlccs6+Cz77Htp3eJbq/wHf2bUZBseyLtYAAAAASUVORK5CYII=",
			"zai_api": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAAXVBMVEUtLS3///8GBgbx8fHs7OwCAgL19fUqKio5OTknJycjIyMcHBwTExMPDw+ysrJUVFTMzMzg4OAYGBgzMzOjo6NhYWFHR0eVlZVOTk50dHSDg4PW1ta7u7uPj49CQkLBrYlSAAABsklEQVRYhc2X23KDMAxEBcE3jE0wSZtL2///zNJMS0C2hW0emn3UsCcaRbNjQbVT8FKAQ7JCANuzOlmstwjQyE5BhlQ3NktAY7LsD0TdLAAy2z8RxifAdvl+gM7OgL6ggamFywxgJX4A9gc41GWAxxhfDWD8bXQALSrpKMAMHG89P7r2uq5yq2OA3+VaSSqFKryLdhAA3DS7o9K8NSmAI3OfqHSa1zYA4OjjQasvXHpunQ8Qcq2xFgw3JQX1NwokMBb5bxooAFZ79mZCLxKScHgoWmQB2BH5zy3kAPQN+a2BHIAYkb9BubEFYAMCvKksQHdC/ncHOQDVI//dCz4aUB8QQIgsQP2B/NfW/4YAtFfk/wj9SBwgvBAxvp8CxEMkDUCESBKACpEkABUiKQAyRBIAdIhsAzZCZBuwESKbgFCIeFFLAAIhIsyI0l4QgECIaFzidRwQCBFvJlUTBwRCxJsJCTBeiCg8ExKgbcWXmkLE3bmnwUQ70GytaQMc8zRHw0u+0goBu5+6+x/bu5/7ZQeHrJ6AkpPHLE+egqNLro6unzlccs6+Cz77Htp3eJbq/wHf2bUZBseyLtYAAAAASUVORK5CYII=",
			"zenmux": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAAY1BMVEX///8AAADz8/Pv7+/V1dWkpKSHh4eMjIze3t7R0dFJSUn6+volJSVGRkbAwMCoqKh/f3+ysrLk5OTHx8dpaWlbW1s/Pz+VlZVxcXEVFRU1NTUwMDANDQ2cnJxOTk5kZGQdHR04kvM1AAACWUlEQVRYhaVXaYOCIBAFPPIoM7W07Pr/v3ITGESNmdnd90mK94S5FSIElSd1VxTFs35UTRncFkL8kj72Q/wrenaQG9wqPn+3pU84ZDx6ef7O/yBhCXw5vkPK4F8QPkdhQPlSUqasCL68K1xgTwnIHuUfSb6U/zwAboWMwZcv+gaHJHkuSfWxv8PzHsksk0H19Jj6fJ1Jb1g1YQEThNH0qO4zv9N/nmgjKP2Swiy8S5z0Dw0sH0GBSHoC57VABMtwJNgtOtZKz6OD/tcF6Y4S0EdchJQ224UWUFfrtDxeOOFziayasxwJ5pvk4BQWCNciH0hlq1kCUViArAYTnmG+KDkCYScw75BjApx8xvgcP2DlQHDMSDUXUoDqb1RfwKKAdYcbwZ+zPoADJaDeuMCFFLjjApJobXPlC6ElBMjmNhACdHPD/chI6DPGp5yoUSMChd2Du+IV9ERndwxQF1YWccs6/9phIZdHMdon6IeFKepp57TeW1u27twKcnJUcCSTY1dvBtwIzMNx5nxxBKMOJ5DurfQmqx9Av0azLRTE5c7WuqmnqLyNv1jAKmsLw8E7EYMt7KWQkm4m5HPunyYTrX1qYWLBMiFrG2sY6V4HXmggyUZEwCFxLHcx4VoGY2CHitDPrKmOQdeiPxoGz152qNAzOvgWGdKEt2+v4905YULKOgPYXduzWb60ZihUiz125Qppv1pvYdPpZv2Zri0fG6ME0zme7a9hh00/cNsObfCfgjL2br9NJawCrVE2/lduy/NbGOYDFB1pcJiA+Dtf+A75E/piQKZSgx+juhgecWVbXAAAAABJRU5ErkJggg=="
		};
		/**
		* The artwork for one vendor, or undefined when we hold none. An absent vendor is a
		* normal outcome, not an error: the row then shows its initials.
		*/
		function providerIcon(id) {
			return PROVIDER_ICONS[id];
		}
		//#endregion
		//#region src/client/model-facts.ts
		/**
		* The pool's own serving cap on a context window.
		*
		* This is the number the account-pool lane actually advertises to DSH, so a
		* model whose published window is larger is served with this one. It is stated
		* here rather than imported from the pool's Node-only catalog module, because
		* the browser half must not pull in `node:fs`.
		*/
		const MODEL_CONTEXT_CAP = 131072;
		/** A raw number a model row may carry, narrowed to something printable. */
		function capacityOf(value) {
			return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : void 0;
		}
		/** An upstream-declared effort list, kept only when it has real entries. */
		function effortsOf(value) {
			if (!Array.isArray(value)) return void 0;
			const seen = /* @__PURE__ */ new Set();
			const out = [];
			for (const raw of value) {
				if (typeof raw !== "string") continue;
				const effort = raw.trim();
				if (effort === "" || seen.has(effort)) continue;
				seen.add(effort);
				out.push(effort);
			}
			return out.length === 0 ? void 0 : out;
		}
		/**
		* Collect whatever a caller can prove about one model, dropping anything
		* unusable.
		*
		* Takes `unknown` on every field because all three callers read rows that came
		* off the wire: a live catalog, a registry, or a route document. Narrowing here
		* is what keeps a malformed row from printing `NaN` or `undefined KB` into the
		* settings dialog.
		*/
		function modelFactsFor(row) {
			const out = {};
			const contextWindow = capacityOf(row.contextWindow);
			if (contextWindow !== void 0) out.contextWindow = contextWindow;
			const maxOutputTokens = capacityOf(row.maxOutputTokens);
			if (maxOutputTokens !== void 0) out.maxOutputTokens = maxOutputTokens;
			const images = typeof row.supportsImages === "boolean" ? row.supportsImages : typeof row.vision === "boolean" ? row.vision : void 0;
			if (images !== void 0) out.vision = images;
			const supportedEfforts = effortsOf(row.supportedEfforts);
			if (supportedEfforts !== void 0) out.supportedEfforts = supportedEfforts;
			const description = typeof row.description === "string" ? row.description.trim() : typeof row.notes === "string" ? row.notes.trim() : "";
			if (description !== "") out.description = description;
			return out;
		}
		/** Format a token count the way every page in the plugin already does. */
		function formatModelCapacity(value) {
			if (!Number.isFinite(value) || value <= 0) return "—";
			if (value >= 1e6) {
				const millions = value / 1e6;
				return `${millions >= 10 ? Math.round(millions) : Number(millions.toFixed(2))}M`;
			}
			if (value >= 1e3) {
				const thousands = value / 1e3;
				return `${thousands >= 100 ? Math.round(thousands) : Number(thousands.toFixed(1))}K`;
			}
			return String(Math.trunc(value));
		}
		/**
		* One model's line of figures, already resolved for printing.
		*
		* `capped` is the single inference in this module and it is about our own
		* number, not the model's: when the published window exceeds the cap the pool
		* lane enforces, the row says so rather than implying the model can actually
		* take that many tokens.
		*/
		function modelFigureLine(facts) {
			const capped = facts.contextWindow !== void 0 && facts.contextWindow > 131072;
			const out = { capped };
			if (facts.contextWindow !== void 0) out.context = formatModelCapacity(capped ? MODEL_CONTEXT_CAP : facts.contextWindow);
			if (facts.maxOutputTokens !== void 0) out.output = formatModelCapacity(facts.maxOutputTokens);
			if (facts.vision !== void 0) out.vision = facts.vision ? "both" : "text";
			if (facts.supportedEfforts !== void 0) out.efforts = facts.supportedEfforts.join(" / ");
			return out;
		}
		//#endregion
		//#region src/client/model-facts-row.tsx
		/** One labelled figure, omitted entirely when the value is unknown. */
		function Figure({ label, value, title }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: "dsm-xdpool-mfacts-fig",
				...title === void 0 ? {} : { title },
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "dsm-xdpool-mfacts-fig-label",
					children: label
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "dsm-xdpool-mfacts-fig-value",
					children: value
				})]
			});
		}
		/**
		* Print one model's figures, or nothing when there are none.
		*
		* The whole-row-is-null case matters: a settings dialog full of rows reading
		* "context — · output — · images —" teaches the user that the dashes mean
		* "broken", when they actually mean "not published". An absent row is quieter
		* and truer.
		*/
		function ModelFactsRow({ row, t, className, facts, onTest, probe, probing }) {
			const resolved = facts ?? (row === void 0 ? void 0 : modelFactsFor(row));
			if (resolved === void 0) return null;
			const figures = modelFigureLine(resolved);
			const say = (key, fallback, params) => {
				const translated = t?.(key, params);
				return translated === void 0 || translated === "" ? fallback : translated;
			};
			const hasFigures = figures.context !== void 0 || figures.output !== void 0 || figures.vision !== void 0 || figures.efforts !== void 0;
			if (!hasFigures && resolved.description === void 0 && onTest === void 0 && probe === void 0) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: `dsm-xdpool-mfacts${className === void 0 ? "" : ` ${className}`}`,
				children: [
					resolved.description === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsm-xdpool-mfacts-note",
						children: resolved.description
					}),
					hasFigures || onTest !== void 0 || probe !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-xdpool-mfacts-line",
						children: [
							figures.context === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Figure, {
								label: say("facts.context", "context"),
								value: figures.context,
								...figures.capped && resolved.contextWindow !== void 0 ? { title: say("facts.capped", "capped by this pool", {
									served: figures.context ?? "",
									published: formatModelCapacity(resolved.contextWindow)
								}) } : {}
							}),
							figures.output === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Figure, {
								label: say("facts.output", "out"),
								value: figures.output
							}),
							figures.vision === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Figure, {
								label: say("facts.input", "input"),
								value: figures.vision === "both" ? say("facts.textAndImage", "text+image") : say("facts.textOnly", "text only")
							}),
							figures.efforts === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Figure, {
								label: say("facts.thinking", "thinking"),
								value: figures.efforts,
								title: say("facts.thinkingHint", "thinking levels the model publishes")
							}),
							probe === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "dsm-xdpool-mfacts-result",
								"data-ok": probe.ok ? "true" : "false",
								title: probe.error ?? void 0,
								children: [
									probe.firstFrameMs === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
										say("facts.firstFrame", "first token"),
										" ",
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("b", { children: [probe.firstFrameMs, "ms"] })
									] }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
										say("facts.outputChars", "output"),
										" ",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: probe.outputChars })
									] }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: probe.ok ? say("facts.probeOk", "answered") : say("facts.probeFailed", "no answer") })
								]
							}),
							probe !== void 0 || onTest === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dsm-xdpool-mfacts-probe",
								onClick: () => {
									onTest();
								},
								disabled: probing === true,
								"aria-busy": probing === true,
								title: say("facts.testHint", "Sends one short real request and reports what came back"),
								children: probing === true ? say("facts.testing", "Testing…") : say("facts.test", "Test connection")
							})
						]
					}) : null,
					probe?.error === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsm-xdpool-mfacts-result-error",
						children: probe.error
					})
				]
			});
		}
		//#endregion
		//#region src/providers.ts
		/**
		* The registry, frozen at import so no caller can mutate shared state.
		*
		* The JSON import is typed by inference: TypeScript reads the file and gives the
		* array a structural type. It is then widened to `readonly ProviderRecord[]`
		* through a cast, because the inferred type of `contextWindow: null` is `null`
		* where the interface says `number | null` — a contravariance that no amount of
		* `satisfies` can reconcile without second-guessing the data. The cast is the
		* boundary: after it, every helper in this module sees exactly the interface.
		*/
		const PROVIDERS = Object.freeze([
			{
				"id": "agnes",
				"name": "Agnes AI",
				"category": "apikey",
				"auth": {
					"kind": "apiKey",
					"env": "AGNES_API_KEY",
					"url": "https://agnes-ai.com/"
				},
				"baseUrl": "https://apihub.agnes-ai.com/v1",
				"format": "openai-chat",
				"models": [{
					"id": "agnes-2.0-flash",
					"name": "Agnes 2.0 Flash",
					"contextWindow": null,
					"vision": null,
					"reasoning": null
				}],
				"notes": "Reasoning arrives as think tags on this route (FCC profile).",
				"website": "https://agnes-ai.com/",
				"local": false,
				"source": "fcc"
			},
			{
				"id": "alibaba_cloud",
				"name": "Alibaba Cloud",
				"category": "apikey",
				"auth": {
					"kind": "apiKey",
					"env": "ALIBABA_CLOUD_API_KEY",
					"url": "https://www.alibabacloud.com/help/en/model-studio/get-api-key"
				},
				"baseUrl": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
				"format": "openai-chat",
				"models": [
					{
						"id": "qwen3.5-plus",
						"name": "Qwen3.5 Plus",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "kimi-k2.5",
						"name": "Kimi K2.5",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "glm-5",
						"name": "GLM 5",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "MiniMax-M2.5",
						"name": "MiniMax M2.5",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "qwen3-coder-next",
						"name": "Qwen3 Coder Next",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "qwen3-coder-plus",
						"name": "Qwen3 Coder Plus",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "glm-4.7",
						"name": "GLM 4.7",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					}
				],
				"notes": "DashScope international compatible-mode endpoint (9router alims-intl, same base URL as FCC).",
				"website": "https://www.alibabacloud.com/en/product/modelstudio",
				"local": false,
				"source": "fcc",
				"baseUrlOverrideEnv": "ALIBABA_CLOUD_BASE_URL"
			},
			{
				"id": "anthropic",
				"name": "Anthropic",
				"category": "apikey",
				"auth": {
					"kind": "apiKey",
					"env": "ANTHROPIC_API_KEY",
					"url": "https://platform.claude.com/settings/keys"
				},
				"baseUrl": "https://api.anthropic.com/v1",
				"format": "anthropic-messages",
				"models": [
					{
						"id": "claude-sonnet-4-20250514",
						"name": "Claude Sonnet 4",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "claude-opus-4-20250514",
						"name": "Claude Opus 4",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "claude-3-5-sonnet-20241022",
						"name": "Claude 3.5 Sonnet",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					}
				],
				"notes": "Native Anthropic Messages passthrough (FCC marks it native_messages_passthrough).",
				"website": "https://www.anthropic.com/",
				"local": false,
				"source": "fcc"
			},
			{
				"id": "azure_openai",
				"name": "Azure OpenAI",
				"category": "apikey",
				"auth": {
					"kind": "apiKey",
					"env": "AZURE_OPENAI_API_KEY",
					"url": "https://ai.azure.com/"
				},
				"baseUrl": null,
				"format": "openai-chat",
				"models": [],
				"notes": "No default endpoint: AZURE_OPENAI_BASE_URL and the deployment name are required (FCC required_settings_attrs).",
				"website": "https://azure.microsoft.com/en-us/products/ai-services/openai-service/",
				"local": false,
				"source": "fcc",
				"baseUrlOverrideEnv": "AZURE_OPENAI_BASE_URL"
			},
			{
				"id": "baidu",
				"name": "Baidu Qianfan",
				"category": "apikey",
				"auth": {
					"kind": "apiKey",
					"env": "BAIDU_API_KEY",
					"url": "https://console.bce.baidu.com/qianfan/ais/console/applicationConsole/application"
				},
				"baseUrl": "https://qianfan.baidubce.com/v2",
				"format": "openai-chat",
				"models": [
					{
						"id": "deepseek-v4-pro",
						"name": "DeepSeek V4 Pro",
						"contextWindow": 1048576,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "deepseek-v4-flash",
						"name": "DeepSeek V4 Flash",
						"contextWindow": 1048576,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "glm-5.2",
						"name": "GLM 5.2",
						"contextWindow": 512e3,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "glm-5.1",
						"name": "GLM 5.1",
						"contextWindow": 198e3,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "kimi-k2.6",
						"name": "Kimi K2.6",
						"contextWindow": 262144,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "qwen3.5-397b-a17b",
						"name": "Qwen 3.5 397B A17B",
						"contextWindow": 262144,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "qwen3.5-27b",
						"name": "Qwen 3.5 27B",
						"contextWindow": 262144,
						"vision": null,
						"reasoning": null
					}
				],
				"notes": "Baidu Qianfan v2 OpenAI-compatible endpoint.",
				"website": "https://qianfan.baidubce.com",
				"local": false,
				"source": "9router",
				"modelsUrl": "https://qianfan.baidubce.com/v2/models"
			},
			{
				"id": "bedrock",
				"name": "Amazon Bedrock",
				"category": "apikey",
				"auth": {
					"kind": "apiKey",
					"env": "AWS_BEARER_TOKEN_BEDROCK",
					"url": "https://console.aws.amazon.com/bedrock/"
				},
				"baseUrl": "https://bedrock-mantle.us-east-1.api.aws/v1",
				"format": "openai-chat",
				"models": [{
					"id": "openai.gpt-oss-120b",
					"name": "GPT-OSS 120B (Bedrock)",
					"contextWindow": null,
					"vision": null,
					"reasoning": null
				}],
				"notes": "Bedrock Mantle OpenAI-compatible endpoint; the base URL stays configurable because keys and model availability are region-scoped (FCC).",
				"website": "https://aws.amazon.com/bedrock/",
				"local": false,
				"source": "fcc",
				"baseUrlOverrideEnv": "BEDROCK_BASE_URL"
			},
			{
				"id": "cerebras",
				"name": "Cerebras",
				"category": "apikey",
				"auth": {
					"kind": "apiKey",
					"env": "CEREBRAS_API_KEY",
					"url": "https://cloud.cerebras.ai"
				},
				"baseUrl": "https://api.cerebras.ai/v1",
				"format": "openai-chat",
				"models": [
					{
						"id": "gpt-oss-120b",
						"name": "GPT OSS 120B",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "zai-glm-4.7",
						"name": "ZAI GLM 4.7",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "llama-3.3-70b",
						"name": "Llama 3.3 70B",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "llama-4-scout-17b-16e-instruct",
						"name": "Llama 4 Scout",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "qwen-3-235b-a22b-instruct-2507",
						"name": "Qwen3 235B A22B",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "qwen-3-32b",
						"name": "Qwen3 32B",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					}
				],
				"notes": "max_tokens is sent as max_completion_tokens (FCC profile).",
				"website": "https://www.cerebras.ai/",
				"local": false,
				"source": "fcc",
				"modelsUrl": "https://api.cerebras.ai/v1/models"
			},
			{
				"id": "cheaperinference",
				"name": "Cheaper Inference",
				"category": "apikey",
				"auth": {
					"kind": "apiKey",
					"env": "CHEAPER_INFERENCE_API_KEY",
					"url": "https://cheaperinference.com/signup"
				},
				"baseUrl": "https://api.cheaperinference.com/v1",
				"format": "openai-chat",
				"models": [{
					"id": "gpt-5.4-mini",
					"name": "GPT-5.4 Mini",
					"contextWindow": null,
					"vision": null,
					"reasoning": null
				}],
				"notes": "Listing is filtered to streaming text models (FCC profile).",
				"website": "https://cheaperinference.com/",
				"local": false,
				"source": "fcc"
			},
			{
				"id": "chutes",
				"name": "Chutes",
				"category": "apikey",
				"auth": {
					"kind": "apiKey",
					"env": "CHUTES_API_KEY",
					"url": "https://chutes.ai/docs/getting-started/authentication"
				},
				"baseUrl": "https://llm.chutes.ai/v1",
				"format": "openai-chat",
				"models": [{
					"id": "Qwen/Qwen3-32B-TEE",
					"name": "Qwen3 32B TEE",
					"contextWindow": null,
					"vision": null,
					"reasoning": null
				}],
				"notes": "FCC lists only text-in/text-out models that advertise tool support.",
				"website": "https://chutes.ai/",
				"local": false,
				"source": "fcc",
				"modelsUrl": "https://llm.chutes.ai/v1/models"
			},
			{
				"id": "cline_pass",
				"name": "ClinePass",
				"category": "apikey",
				"auth": {
					"kind": "apiKey",
					"env": "CLINE_API_KEY",
					"url": "https://app.cline.bot"
				},
				"baseUrl": "https://api.cline.bot/api/v1",
				"format": "openai-chat",
				"models": [
					{
						"id": "cline-pass/glm-5.2",
						"name": "GLM-5.2 (ClinePass)",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "cline-pass/kimi-k2.7-code",
						"name": "Kimi K2.7 Code (ClinePass)",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "cline-pass/kimi-k2.6",
						"name": "Kimi K2.6 (ClinePass)",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "cline-pass/deepseek-v4-pro",
						"name": "DeepSeek V4 Pro (ClinePass)",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "cline-pass/deepseek-v4-flash",
						"name": "DeepSeek V4 Flash (ClinePass)",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "cline-pass/mimo-v2.5",
						"name": "MiMo-V2.5 (ClinePass)",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "cline-pass/mimo-v2.5-pro",
						"name": "MiMo-V2.5-Pro (ClinePass)",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "cline-pass/minimax-m3",
						"name": "MiniMax M3 (ClinePass)",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "cline-pass/qwen3.7-max",
						"name": "Qwen3.7 Max (ClinePass)",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "cline-pass/qwen3.7-plus",
						"name": "Qwen3.7 Plus (ClinePass)",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "cline-pass/kimi-k3",
						"name": "Kimi K3 (ClinePass)",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					}
				],
				"notes": "ClinePass subscription key; FCC lists it from /ai/cline/recommended-models.",
				"website": "https://cline.bot/",
				"local": false,
				"source": "fcc",
				"modelsUrl": "https://api.cline.bot/api/v1/ai/cline/recommended-models"
			},
			{
				"id": "cohere",
				"name": "Cohere",
				"category": "apikey",
				"auth": {
					"kind": "apiKey",
					"env": "COHERE_API_KEY",
					"url": "https://dashboard.cohere.com/api-keys"
				},
				"baseUrl": "https://api.cohere.ai/compatibility/v1",
				"format": "openai-chat",
				"models": [
					{
						"id": "command-r-plus-08-2024",
						"name": "Command R+ (Aug 2024)",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "command-r-08-2024",
						"name": "Command R (Aug 2024)",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "command-a-03-2025",
						"name": "Command A (Mar 2025)",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "command-a-plus-05-2026",
						"name": "Command A Plus",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					}
				],
				"notes": "Compatibility layer at /compatibility/v1; several body keys are stripped (FCC profile).",
				"website": "https://cohere.com/",
				"local": false,
				"source": "fcc",
				"modelsUrl": "https://api.cohere.ai/v1/models"
			},
			{
				"id": "deepinfra",
				"name": "DeepInfra",
				"category": "apikey",
				"auth": {
					"kind": "apiKey",
					"env": "DEEPINFRA_API_KEY",
					"url": "https://deepinfra.com/dash/api_keys"
				},
				"baseUrl": "https://api.deepinfra.com/v1/openai",
				"format": "openai-chat",
				"models": [{
					"id": "deepseek-ai/DeepSeek-V4-Flash",
					"name": "DeepSeek V4 Flash",
					"contextWindow": null,
					"vision": null,
					"reasoning": null
				}],
				"notes": "FCC reads DeepInfra’s own /models/list shape (model_name / reported_type).",
				"website": "https://deepinfra.com/",
				"local": false,
				"source": "fcc",
				"modelsUrl": "https://api.deepinfra.com/models/list"
			},
			{
				"id": "deepseek",
				"name": "DeepSeek",
				"category": "apikey",
				"auth": {
					"kind": "apiKey",
					"env": "DEEPSEEK_API_KEY",
					"url": "https://platform.deepseek.com/api_keys"
				},
				"baseUrl": "https://api.deepseek.com",
				"format": "openai-chat",
				"models": [
					{
						"id": "deepseek-v4-pro",
						"name": "DeepSeek V4 Pro",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "deepseek-v4-pro-max",
						"name": "DeepSeek V4 Pro Max",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "deepseek-v4-pro-none",
						"name": "DeepSeek V4 Pro No Thinking",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "deepseek-v4.1-flash",
						"name": "DeepSeek V4.1 Flash",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "deepseek-v4-flash",
						"name": "DeepSeek V4 Flash",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "deepseek-v4-flash-vision-exp",
						"name": "DeepSeek V4 Flash Vision (Exp)",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "deepseek-chat",
						"name": "DeepSeek V3.2 Chat",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "deepseek-reasoner",
						"name": "DeepSeek V3.2 Reasoner",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					}
				],
				"notes": "Cache usage is reported on this endpoint (FCC).",
				"website": "https://www.deepseek.com/",
				"local": false,
				"source": "fcc",
				"modelsUrl": "https://api.deepseek.com/models"
			},
			{
				"id": "experiential",
				"name": "Experiential Labs",
				"category": "apikey",
				"auth": {
					"kind": "apiKey",
					"env": "EXPLABS_API_KEY",
					"url": "https://platform.experientiallabs.ai/settings/api-keys"
				},
				"baseUrl": "https://api.experientiallabs.ai/v1",
				"format": "openai-chat",
				"models": [{
					"id": "union-alpha",
					"name": "Union Alpha",
					"contextWindow": null,
					"vision": null,
					"reasoning": null
				}],
				"notes": "Experiential Labs gateway.",
				"website": "https://www.experientiallabs.ai/",
				"local": false,
				"source": "fcc"
			},
			{
				"id": "featherless",
				"name": "Featherless AI",
				"category": "apikey",
				"auth": {
					"kind": "apiKey",
					"env": "FEATHERLESS_API_KEY",
					"url": "https://featherless.ai/account/api-keys"
				},
				"baseUrl": "https://api.featherless.ai/v1",
				"format": "openai-chat",
				"models": [
					{
						"id": "deepseek-ai/DeepSeek-V4-Pro",
						"name": "DeepSeek V4 Pro",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "deepseek-ai/DeepSeek-V4-Flash",
						"name": "DeepSeek V4 Flash",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "zai-org/GLM-5.2",
						"name": "GLM 5.2",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "zai-org/GLM-5.1",
						"name": "GLM 5.1",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "moonshotai/Kimi-K2.7-Code",
						"name": "Kimi K2.7 Code",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "moonshotai/Kimi-K2.6",
						"name": "Kimi K2.6",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "moonshotai/Kimi-K2.5",
						"name": "Kimi K2.5",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "Qwen/Qwen3-32B",
						"name": "Qwen3 32B",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					}
				],
				"notes": "FCC asks for tool_use + available_on_current_plan rows; pagination is numbered.",
				"website": "https://featherless.ai/",
				"local": false,
				"source": "fcc",
				"modelsUrl": "https://api.featherless.ai/v1/models"
			},
			{
				"id": "fireworks",
				"name": "Fireworks",
				"category": "apikey",
				"auth": {
					"kind": "apiKey",
					"env": "FIREWORKS_API_KEY",
					"url": "https://fireworks.ai/account/api-keys"
				},
				"baseUrl": "https://api.fireworks.ai/inference/v1",
				"format": "openai-chat",
				"models": [
					{
						"id": "accounts/fireworks/models/deepseek-v3p1",
						"name": "DeepSeek V3.1",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "accounts/fireworks/models/llama-v3p3-70b-instruct",
						"name": "Llama 3.3 70B",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "accounts/fireworks/models/qwen3-235b-a22b",
						"name": "Qwen3 235B",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					}
				],
				"notes": "Embedding id omitted; model ids are account-scoped paths.",
				"website": "https://fireworks.ai/",
				"local": false,
				"source": "fcc",
				"modelsUrl": "https://api.fireworks.ai/inference/v1/models"
			},
			{
				"id": "glm",
				"name": "Z.ai (Anthropic wire)",
				"category": "apikey",
				"auth": {
					"kind": "apiKey",
					"env": "ZAI_API_KEY",
					"url": "https://open.bigmodel.cn/usercenter/apikeys"
				},
				"baseUrl": "https://api.z.ai/api/anthropic/v1",
				"format": "anthropic-messages",
				"models": [
					{
						"id": "glm-5.3",
						"name": "GLM 5.3",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "glm-5.3-flash",
						"name": "GLM 5.3 Flash (Vision)",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "glm-5.2",
						"name": "GLM 5.2",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "glm-5.1",
						"name": "GLM 5.1",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "glm-5-turbo",
						"name": "GLM 5 Turbo",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "glm-5",
						"name": "GLM 5",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "glm-4.7",
						"name": "GLM 4.7",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "glm-4.6v",
						"name": "GLM 4.6V (Vision)",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					}
				],
				"notes": "Z.ai Anthropic-compatible route (Claude Code style); the same ZAI_API_KEY as the zai/zai_api records. Key URL as declared in the 9router glm registry.",
				"website": "https://z.ai",
				"local": false,
				"source": "9router"
			},
			{
				"id": "glm-cn",
				"name": "Zhipu GLM (CN)",
				"category": "apikey",
				"auth": {
					"kind": "apiKey",
					"env": "ZHIPU_API_KEY",
					"url": "https://open.bigmodel.cn/usercenter/apikeys"
				},
				"baseUrl": "https://open.bigmodel.cn/api/coding/paas/v4",
				"format": "openai-chat",
				"models": [
					{
						"id": "glm-5.3",
						"name": "GLM 5.3",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "glm-5.3-flash",
						"name": "GLM 5.3 Flash (Vision)",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "glm-5.2",
						"name": "GLM 5.2",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "glm-5.1",
						"name": "GLM 5.1",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "glm-5-turbo",
						"name": "GLM 5 Turbo",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "glm-5",
						"name": "GLM 5",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "glm-4.7",
						"name": "GLM-4.7",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "glm-4.6v",
						"name": "GLM 4.6V (Vision)",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "glm-4.6",
						"name": "GLM-4.6",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "glm-4.5-air",
						"name": "GLM-4.5-Air",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					}
				],
				"notes": "Zhipu open-platform coding endpoint (mainland China), distinct from the z.ai international records.",
				"website": "https://open.bigmodel.cn",
				"local": false,
				"source": "9router"
			},
			{
				"id": "groq",
				"name": "Groq",
				"category": "apikey",
				"auth": {
					"kind": "apiKey",
					"env": "GROQ_API_KEY",
					"url": "https://console.groq.com/keys"
				},
				"baseUrl": "https://api.groq.com/openai/v1",
				"format": "openai-chat",
				"models": [
					{
						"id": "llama-3.3-70b-versatile",
						"name": "Llama 3.3 70B",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "meta-llama/llama-4-maverick-17b-128e-instruct",
						"name": "Llama 4 Maverick",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "qwen/qwen3-32b",
						"name": "Qwen3 32B",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "openai/gpt-oss-120b",
						"name": "GPT-OSS 120B",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					}
				],
				"notes": "OpenAI-compatible endpoint; audio ids from the same registry listing are omitted (chat catalog).",
				"website": "https://groq.com/",
				"local": false,
				"source": "fcc",
				"modelsUrl": "https://api.groq.com/openai/v1/models"
			},
			{
				"id": "huggingface",
				"name": "Hugging Face",
				"category": "apikey",
				"auth": {
					"kind": "apiKey",
					"env": "HUGGINGFACE_API_KEY",
					"url": "https://huggingface.co/settings/tokens"
				},
				"baseUrl": "https://router.huggingface.co/v1",
				"format": "openai-chat",
				"models": [{
					"id": "Qwen/Qwen3-Coder-480B-A35B-Instruct:fastest",
					"name": "Qwen3 Coder 480B A35B",
					"contextWindow": null,
					"vision": null,
					"reasoning": null
				}],
				"notes": "Inference Providers router; FCC resolves the context window from the live provider consensus.",
				"website": "https://huggingface.co/",
				"local": false,
				"source": "fcc"
			},
			{
				"id": "hyperbolic",
				"name": "Hyperbolic AI",
				"category": "apikey",
				"auth": {
					"kind": "apiKey",
					"env": "HYPERBOLIC_API_KEY",
					"url": "https://app.hyperbolic.xyz/settings"
				},
				"baseUrl": "https://api.hyperbolic.xyz/v1",
				"format": "openai-chat",
				"models": [
					{
						"id": "Qwen/QwQ-32B",
						"name": "QwQ 32B",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "deepseek-ai/DeepSeek-R1",
						"name": "DeepSeek R1",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "deepseek-ai/DeepSeek-V3",
						"name": "DeepSeek V3",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "meta-llama/Llama-3.3-70B-Instruct",
						"name": "Llama 3.3 70B",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "meta-llama/Llama-3.2-3B-Instruct",
						"name": "Llama 3.2 3B",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "Qwen/Qwen2.5-72B-Instruct",
						"name": "Qwen 2.5 72B",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "Qwen/Qwen2.5-Coder-32B-Instruct",
						"name": "Qwen 2.5 Coder 32B",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "NousResearch/Hermes-3-Llama-3.1-70B",
						"name": "Hermes 3 70B",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					}
				],
				"notes": "OpenAI-compatible chat completions; 9router registry declares the key URL.",
				"website": "https://hyperbolic.xyz",
				"local": false,
				"source": "9router",
				"modelsUrl": "https://api.hyperbolic.xyz/v1/models"
			},
			{
				"id": "kimi",
				"name": "Kimi",
				"category": "apikey",
				"auth": {
					"kind": "apiKey",
					"env": "KIMI_API_KEY",
					"url": "https://platform.moonshot.cn/console/api-keys"
				},
				"baseUrl": "https://api.moonshot.ai/v1",
				"format": "openai-chat",
				"models": [{
					"id": "kimi-k2.5",
					"name": "Kimi K2.5",
					"contextWindow": null,
					"vision": null,
					"reasoning": null
				}],
				"notes": "Moonshot platform key; caller extra_body is rejected on this route (FCC profile).",
				"website": "https://www.kimi.com/",
				"local": false,
				"source": "fcc"
			},
			{
				"id": "kimi_code",
				"name": "Kimi Code",
				"category": "apikey",
				"auth": {
					"kind": "apiKey",
					"env": "KIMI_CODE_API_KEY",
					"url": "https://www.kimi.com/code/console"
				},
				"baseUrl": "https://api.kimi.com/coding/v1",
				"format": "openai-chat",
				"models": [
					{
						"id": "kimi-k3",
						"name": "Kimi K3",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "k3",
						"name": "Kimi K3 (Code)",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "kimi-for-coding",
						"name": "Kimi for Coding",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "kimi-for-coding-highspeed",
						"name": "Kimi for Coding Highspeed",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "kimi-k2.7-code",
						"name": "Kimi K2.7 Code",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "kimi-k2.7-code-highspeed",
						"name": "Kimi K2.7 Code Highspeed",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "kimi-k2.6",
						"name": "Kimi K2.6",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "kimi-k2.5",
						"name": "Kimi K2.5",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "kimi-k2.5-thinking",
						"name": "Kimi K2.5 Thinking",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "kimi-latest",
						"name": "Kimi Latest",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					}
				],
				"notes": "Kimi Code subscription; ids from the 9router kimi registry (same host, api.kimi.com/coding/v1).",
				"website": "https://www.kimi.com/code",
				"local": false,
				"source": "fcc"
			},
			{
				"id": "lightning",
				"name": "Lightning AI",
				"category": "apikey",
				"auth": {
					"kind": "apiKey",
					"env": "LIGHTNING_API_KEY",
					"url": "https://lightning.ai/lightning-ai/model-apis/models"
				},
				"baseUrl": "https://lightning.ai/api/v1",
				"format": "openai-chat",
				"models": [{
					"id": "lightning-ai/Qwen3.8-27B",
					"name": "Qwen3.8 27B",
					"contextWindow": null,
					"vision": null,
					"reasoning": null
				}],
				"notes": "Lightning AI Model APIs gateway.",
				"website": "https://lightning.ai/",
				"local": false,
				"source": "fcc"
			},
			{
				"id": "llm7",
				"name": "LLM7.io",
				"category": "apikey",
				"auth": {
					"kind": "apiKey",
					"env": "LLM7_API_KEY",
					"url": "https://dash.llm7.io/"
				},
				"baseUrl": "https://api.llm7.io/v1",
				"format": "openai-chat",
				"models": [
					{
						"id": "gpt-5.5",
						"name": "GPT-5.5 (LLM7)",
						"contextWindow": 105e4,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "claude-opus-5",
						"name": "Claude Opus 5 (LLM7)",
						"contextWindow": 1e6,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "deepseek-v4-flash",
						"name": "DeepSeek V4 Flash (LLM7)",
						"contextWindow": 1e6,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "grok-4.5",
						"name": "Grok 4.5 (LLM7)",
						"contextWindow": 5e5,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "kimi-k3",
						"name": "Kimi K3 (LLM7)",
						"contextWindow": 1e6,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "default",
						"name": "LLM7 Default",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "fast",
						"name": "LLM7 Fast",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "pro",
						"name": "LLM7 Pro",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					}
				],
				"notes": "FCC also pins the default/fast/pro aliases; the listing is filtered to streaming tool models.",
				"website": "https://llm7.io/",
				"local": false,
				"source": "fcc",
				"modelsUrl": "https://api.llm7.io/v1/models"
			},
			{
				"id": "minimax",
				"name": "MiniMax",
				"category": "apikey",
				"auth": {
					"kind": "apiKey",
					"env": "MINIMAX_API_KEY",
					"url": "https://platform.minimax.io/user-center/basic-information/interface-key"
				},
				"baseUrl": "https://api.minimax.io/v1",
				"format": "openai-chat",
				"models": [
					{
						"id": "MiniMax-M3",
						"name": "MiniMax M3",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "MiniMax-M2.7",
						"name": "MiniMax M2.7",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "MiniMax-M2.5",
						"name": "MiniMax M2.5",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "MiniMax-M2.1",
						"name": "MiniMax M2.1",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					}
				],
				"notes": "Reasoning is split out of the text stream (FCC profile); speech/image ids omitted.",
				"website": "https://www.minimax.io/",
				"local": false,
				"source": "fcc"
			},
			{
				"id": "minimax-cn",
				"name": "MiniMax (CN)",
				"category": "apikey",
				"auth": {
					"kind": "apiKey",
					"env": "MINIMAX_CN_API_KEY",
					"url": "https://platform.minimaxi.com/user-center/basic-information/interface-key"
				},
				"baseUrl": "https://api.minimaxi.com/anthropic/v1",
				"format": "anthropic-messages",
				"models": [
					{
						"id": "MiniMax-M3",
						"name": "MiniMax M3",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "MiniMax-M2.7",
						"name": "MiniMax M2.7",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "MiniMax-M2.5",
						"name": "MiniMax M2.5",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "MiniMax-M2.1",
						"name": "MiniMax M2.1",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					}
				],
				"notes": "MiniMax mainland endpoint speaking the Anthropic Messages wire; speech ids omitted. The anthropic-beta header is declared by the 9router registry.",
				"website": "https://www.minimaxi.com",
				"local": false,
				"source": "9router",
				"headers": { "anthropic-beta": "claude-code-20250219,interleaved-thinking-2025-05-14" }
			},
			{
				"id": "mistral",
				"name": "Mistral",
				"category": "apikey",
				"auth": {
					"kind": "apiKey",
					"env": "MISTRAL_API_KEY",
					"url": "https://console.mistral.ai/"
				},
				"baseUrl": "https://api.mistral.ai/v1",
				"format": "openai-chat",
				"models": [
					{
						"id": "mistral-large-latest",
						"name": "Mistral Large 3",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "codestral-latest",
						"name": "Codestral",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "mistral-medium-latest",
						"name": "Mistral Medium 3",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "devstral-small-latest",
						"name": "Devstral Small",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					}
				],
				"notes": "La Plateforme keys; embedding id omitted.",
				"website": "https://mistral.ai/",
				"local": false,
				"source": "fcc",
				"modelsUrl": "https://api.mistral.ai/v1/models"
			},
			{
				"id": "mistral_codestral",
				"name": "Mistral Codestral",
				"category": "apikey",
				"auth": {
					"kind": "apiKey",
					"env": "CODESTRAL_API_KEY",
					"url": "https://console.mistral.ai/"
				},
				"baseUrl": "https://codestral.mistral.ai/v1",
				"format": "openai-chat",
				"models": [{
					"id": "codestral-latest",
					"name": "Codestral",
					"contextWindow": null,
					"vision": null,
					"reasoning": null
				}],
				"notes": "Codestral IDE endpoint, distinct from La Plateforme keys (FCC).",
				"website": "https://mistral.ai/",
				"local": false,
				"source": "fcc"
			},
			{
				"id": "morph",
				"name": "Morph LLM",
				"category": "apikey",
				"auth": {
					"kind": "apiKey",
					"env": "MORPH_API_KEY",
					"url": "https://morphllm.com"
				},
				"baseUrl": "https://api.morphllm.com/v1",
				"format": "openai-chat",
				"models": [
					{
						"id": "morph-v3-large",
						"name": "Morph v3 Large",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "morph-v3-fast",
						"name": "Morph v3 Fast",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "morph-qwen35-397b",
						"name": "Qwen 3.5 397B (Morph)",
						"contextWindow": 262144,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "morph-minimax27-230b",
						"name": "MiniMax M2.7 (Morph)",
						"contextWindow": 200704,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "morph-qwen36-27b",
						"name": "Qwen 3.6 27B (Morph)",
						"contextWindow": 262144,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "morph-dsv4flash",
						"name": "DeepSeek V4 Flash (Morph)",
						"contextWindow": 1048576,
						"vision": null,
						"reasoning": null
					}
				],
				"notes": "Fast apply/edit models for coding agents.",
				"website": "https://morphllm.com",
				"local": false,
				"source": "9router",
				"modelsUrl": "https://api.morphllm.com/v1/models"
			},
			{
				"id": "nararoute",
				"name": "NaraRoute",
				"category": "apikey",
				"auth": {
					"kind": "apiKey",
					"env": "NARAROUTE_API_KEY",
					"url": "https://router.bynara.id/keys"
				},
				"baseUrl": "https://router.bynara.id/v1",
				"format": "openai-chat",
				"models": [{
					"id": "kimi-k3-free",
					"name": "Kimi K3 (free)",
					"contextWindow": null,
					"vision": null,
					"reasoning": null
				}],
				"notes": "Multi-vendor gateway; reasoning is surfaced as a boolean in the listing (FCC profile).",
				"website": "https://router.bynara.id/",
				"local": false,
				"source": "fcc",
				"freeModelsHint": ["kimi-k3-free"]
			},
			{
				"id": "nebius",
				"name": "Nebius Token Factory",
				"category": "apikey",
				"auth": {
					"kind": "apiKey",
					"env": "NEBIUS_API_KEY",
					"url": "https://tokenfactory.nebius.com/project/api-keys"
				},
				"baseUrl": "https://api.tokenfactory.nebius.com/v1",
				"format": "openai-chat",
				"models": [{
					"id": "meta-llama/Llama-3.3-70B-Instruct",
					"name": "Llama 3.3 70B Instruct",
					"contextWindow": null,
					"vision": null,
					"reasoning": null
				}, {
					"id": "Qwen/Qwen3-30B-A3B",
					"name": "Qwen3 30B A3B",
					"contextWindow": null,
					"vision": null,
					"reasoning": null
				}],
				"notes": "Embedding id omitted; FCC requires architecture.modality=text->text in the listing.",
				"website": "https://tokenfactory.nebius.com/",
				"local": false,
				"source": "fcc",
				"modelsUrl": "https://api.tokenfactory.nebius.com/v1/models?verbose=true"
			},
			{
				"id": "novita",
				"name": "Novita AI",
				"category": "apikey",
				"auth": {
					"kind": "apiKey",
					"env": "NOVITA_API_KEY",
					"url": "https://novita.ai/settings/key-management"
				},
				"baseUrl": "https://api.novita.ai/openai/v1",
				"format": "openai-chat",
				"models": [{
					"id": "deepseek/deepseek-v4-flash-0731",
					"name": "DeepSeek V4 Flash 0731",
					"contextWindow": null,
					"vision": null,
					"reasoning": null
				}],
				"notes": "FCC README example id.",
				"website": "https://novita.ai/",
				"local": false,
				"source": "fcc"
			},
			{
				"id": "openai_api",
				"name": "OpenAI API",
				"category": "apikey",
				"auth": {
					"kind": "apiKey",
					"env": "OPENAI_API_KEY",
					"url": "https://platform.openai.com/api-keys"
				},
				"baseUrl": "https://api.openai.com/v1",
				"format": "openai-responses",
				"models": [
					{
						"id": "gpt-5.5",
						"name": "GPT-5.5",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gpt-5.4",
						"name": "GPT-5.4",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gpt-5.4-mini",
						"name": "GPT-5.4 Mini",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gpt-5.4-nano",
						"name": "GPT-5.4 Nano",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gpt-5.2",
						"name": "GPT-5.2",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gpt-5.1",
						"name": "GPT-5.1",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gpt-5",
						"name": "GPT-5",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gpt-5-mini",
						"name": "GPT-5 Mini",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gpt-5-nano",
						"name": "GPT-5 Nano",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gpt-4o",
						"name": "GPT-4o",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gpt-4o-mini",
						"name": "GPT-4o Mini",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gpt-4-turbo",
						"name": "GPT-4 Turbo",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gpt-4.1",
						"name": "GPT-4.1",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gpt-4.1-mini",
						"name": "GPT-4.1 Mini",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gpt-4.1-nano",
						"name": "GPT-4.1 Nano",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "o3",
						"name": "O3",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "o3-mini",
						"name": "O3 Mini",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "o3-pro",
						"name": "O3 Pro",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "o4-mini",
						"name": "O4 Mini",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "o1",
						"name": "O1",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "o1-mini",
						"name": "O1 Mini",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gpt-5.6-sol",
						"name": "GPT-5.6 Sol",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					}
				],
				"notes": "Platform API key; FCC drives this route over the Responses API. Non-chat ids (embeddings, speech, images) are omitted.",
				"website": "https://platform.openai.com/",
				"local": false,
				"source": "fcc"
			},
			{
				"id": "opencode_go",
				"name": "OpenCode Go",
				"category": "apikey",
				"auth": {
					"kind": "apiKey",
					"env": "OPENCODE_API_KEY",
					"url": "https://opencode.ai/auth"
				},
				"baseUrl": "https://opencode.ai/zen/go/v1",
				"format": "openai-chat",
				"models": [
					{
						"id": "deepseek-flash",
						"name": "DeepSeek V4.1 Flash",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "glm-5.3-flash",
						"name": "GLM 5.3 Flash (Vision)",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "glm-5.3",
						"name": "GLM 5.3",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "glm-5.2",
						"name": "GLM 5.2",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "glm-5.1",
						"name": "GLM 5.1",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "kimi-k2.7-code",
						"name": "Kimi K2.7 Code",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "kimi-k2.6",
						"name": "Kimi K2.6",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "kimi-k3",
						"name": "Kimi K3",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "deepseek-v4-pro",
						"name": "DeepSeek V4 Pro",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "deepseek-v4-flash",
						"name": "DeepSeek V4 Flash",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "deepseek-v4-flash-vision-exp",
						"name": "DeepSeek V4 Flash Vision (Exp)",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "longcat-2.0",
						"name": "LongCat 2.0",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "mimo-v2.5",
						"name": "MiMo V2.5",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "mimo-v2.5-pro",
						"name": "MiMo V2.5 Pro",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "minimax-m3",
						"name": "MiniMax M3",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "minimax-m2.7",
						"name": "MiniMax M2.7",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "minimax-m2.5",
						"name": "MiniMax M2.5",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "qwen3.8-max",
						"name": "Qwen 3.8 Max",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "qwen3.8-flash",
						"name": "Qwen 3.8 Flash",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "qwen3.7-max",
						"name": "Qwen 3.7 Max",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "qwen3.7-plus",
						"name": "Qwen 3.7 Plus",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "qwen3.6-plus",
						"name": "Qwen 3.6 Plus",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "hy4-preview",
						"name": "Hy4 Preview",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "hy3",
						"name": "Hy3",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "grok-4.6",
						"name": "Grok 4.6",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gpt-5.6-luna",
						"name": "GPT 5.6 Luna",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "muse-spark-1.2-contributor",
						"name": "Muse Spark 1.2 Contributor",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "muse-spark-1.3-contributor",
						"name": "Muse Spark 1.3 Contributor",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					}
				],
				"notes": "OpenCode Go subscription ($5/mo per the 9router notice).",
				"website": "https://opencode.ai/go",
				"local": false,
				"source": "fcc"
			},
			{
				"id": "opper",
				"name": "Opper",
				"category": "apikey",
				"auth": {
					"kind": "apiKey",
					"env": "OPPER_API_KEY",
					"url": "https://platform.opper.ai/"
				},
				"baseUrl": "https://api.opper.ai/v3/compat",
				"format": "openai-chat",
				"models": [{
					"id": "claude-sonnet-4-6",
					"name": "Claude Sonnet 4.6",
					"contextWindow": null,
					"vision": null,
					"reasoning": null
				}],
				"notes": "Opper gateway (v3/compat base).",
				"website": "https://opper.ai/",
				"local": false,
				"source": "fcc"
			},
			{
				"id": "orcarouter",
				"name": "OrcaRouter",
				"category": "apikey",
				"auth": {
					"kind": "apiKey",
					"env": "ORCAROUTER_API_KEY",
					"url": "https://www.orcarouter.ai/console"
				},
				"baseUrl": "https://api.orcarouter.ai/v1",
				"format": "openai-chat",
				"models": [{
					"id": "deepseek/deepseek-v4-flash-free",
					"name": "DeepSeek V4 Flash (free)",
					"contextWindow": null,
					"vision": null,
					"reasoning": null
				}],
				"notes": "Multi-provider gateway with a free slug.",
				"website": "https://www.orcarouter.ai/",
				"local": false,
				"source": "fcc",
				"freeModelsHint": ["deepseek/deepseek-v4-flash-free"]
			},
			{
				"id": "perplexity",
				"name": "Perplexity",
				"category": "apikey",
				"auth": {
					"kind": "apiKey",
					"env": "PERPLEXITY_API_KEY",
					"url": "https://www.perplexity.ai/settings/api"
				},
				"baseUrl": "https://api.perplexity.ai",
				"format": "openai-chat",
				"models": [{
					"id": "sonar-pro",
					"name": "Sonar Pro",
					"contextWindow": null,
					"vision": null,
					"reasoning": null
				}, {
					"id": "sonar",
					"name": "Sonar",
					"contextWindow": null,
					"vision": null,
					"reasoning": null
				}],
				"notes": "Search-augmented Sonar chat models.",
				"website": "https://www.perplexity.ai",
				"local": false,
				"source": "9router",
				"modelsUrl": "https://api.perplexity.ai/models"
			},
			{
				"id": "poolside",
				"name": "Poolside AI",
				"category": "apikey",
				"auth": {
					"kind": "apiKey",
					"env": "POOLSIDE_API_KEY",
					"url": "https://platform.poolside.ai/"
				},
				"baseUrl": "https://inference.poolside.ai/v1",
				"format": "openai-chat",
				"models": [{
					"id": "poolside/laguna-s-2.1",
					"name": "Laguna S 2.1",
					"contextWindow": null,
					"vision": null,
					"reasoning": null
				}, {
					"id": "poolside/laguna-xs-2.1",
					"name": "Laguna XS 2.1",
					"contextWindow": null,
					"vision": null,
					"reasoning": null
				}],
				"notes": "Poolside platform key.",
				"website": "https://poolside.ai/",
				"local": false,
				"source": "fcc",
				"modelsUrl": "https://inference.poolside.ai/v1/models"
			},
			{
				"id": "qwencloud",
				"name": "QwenCloud Token Plan",
				"category": "apikey",
				"auth": {
					"kind": "apiKey",
					"env": "QWENCLOUD_API_KEY",
					"url": "https://home.qwencloud.com/api-keys"
				},
				"baseUrl": "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
				"format": "openai-chat",
				"models": [
					{
						"id": "qwen3.8-max-preview",
						"name": "Qwen3.8 Max Preview",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "qwen3.7-max",
						"name": "Qwen3.7 Max",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "qwen3.7-plus",
						"name": "Qwen3.7 Plus",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "qwen3.6-flash",
						"name": "Qwen3.6 Flash",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "glm-5.2",
						"name": "GLM 5.2",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "deepseek-v4-pro",
						"name": "DeepSeek V4 Pro",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					}
				],
				"notes": "QwenCloud Token Plan endpoint (9router alitp-intl, same base URL as FCC).",
				"website": "https://qwencloud.com/",
				"local": false,
				"source": "fcc"
			},
			{
				"id": "qwencloud_coding",
				"name": "QwenCloud Coding Plan",
				"category": "apikey",
				"auth": {
					"kind": "apiKey",
					"env": "QWENCLOUD_CODING_API_KEY",
					"url": "https://home.qwencloud.com/api-keys"
				},
				"baseUrl": "https://coding-intl.dashscope.aliyuncs.com/v1",
				"format": "openai-chat",
				"models": [
					{
						"id": "qwen3.5-plus",
						"name": "Qwen3.5 Plus",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "kimi-k2.5",
						"name": "Kimi K2.5",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "glm-5",
						"name": "GLM 5",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "MiniMax-M2.5",
						"name": "MiniMax M2.5",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "qwen3-coder-next",
						"name": "Qwen3 Coder Next",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "qwen3-coder-plus",
						"name": "Qwen3 Coder Plus",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "glm-4.7",
						"name": "GLM 4.7",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					}
				],
				"notes": "QwenCloud Coding Plan endpoint (9router alicode-intl, same base URL as FCC).",
				"website": "https://qwencloud.com/",
				"local": false,
				"source": "fcc"
			},
			{
				"id": "sambanova",
				"name": "SambaNova",
				"category": "apikey",
				"auth": {
					"kind": "apiKey",
					"env": "SAMBANOVA_API_KEY",
					"url": "https://cloud.sambanova.ai/apis"
				},
				"baseUrl": "https://api.sambanova.ai/v1",
				"format": "openai-chat",
				"models": [{
					"id": "Meta-Llama-3.3-70B-Instruct",
					"name": "Llama 3.3 70B Instruct",
					"contextWindow": null,
					"vision": null,
					"reasoning": null
				}],
				"notes": "FCC README example id; the 9router registry keeps this provider hidden.",
				"website": "https://sambanova.ai/",
				"local": false,
				"source": "fcc",
				"modelsUrl": "https://api.sambanova.ai/v1/models"
			},
			{
				"id": "scaleway",
				"name": "Scaleway",
				"category": "apikey",
				"auth": {
					"kind": "apiKey",
					"env": "SCW_SECRET_KEY",
					"url": "https://console.scaleway.com/iam/api-keys"
				},
				"baseUrl": "https://api.scaleway.ai/v1",
				"format": "openai-chat",
				"models": [{
					"id": "deepseek/deepseek-v4-flash",
					"name": "DeepSeek V4 Flash",
					"contextWindow": null,
					"vision": null,
					"reasoning": null
				}],
				"notes": "Scaleway Generative APIs; SCW secret key.",
				"website": "https://www.scaleway.com/",
				"local": false,
				"source": "fcc"
			},
			{
				"id": "siliconflow",
				"name": "SiliconFlow",
				"category": "apikey",
				"auth": {
					"kind": "apiKey",
					"env": "SILICONFLOW_API_KEY",
					"url": "https://cloud.siliconflow.com/account/ak"
				},
				"baseUrl": "https://api.siliconflow.com/v1",
				"format": "openai-chat",
				"models": [
					{
						"id": "deepseek-ai/DeepSeek-V4-Pro",
						"name": "DeepSeek V4 Pro",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "deepseek-ai/DeepSeek-V4-Flash",
						"name": "DeepSeek V4 Flash",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "deepseek-ai/DeepSeek-V3.2",
						"name": "DeepSeek V3.2",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "deepseek-ai/DeepSeek-V3.2-Exp",
						"name": "DeepSeek V3.2 Exp",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "deepseek-ai/DeepSeek-V3.1",
						"name": "DeepSeek V3.1",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "deepseek-ai/DeepSeek-V3.1-Terminus",
						"name": "DeepSeek V3.1 Terminus",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "deepseek-ai/DeepSeek-R1",
						"name": "DeepSeek R1",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "Qwen/Qwen3.5-397B-A17B",
						"name": "Qwen 3.5 397B A17B",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "Qwen/Qwen3.5-122B-A10B",
						"name": "Qwen 3.5 122B A10B",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "zai-org/GLM-5.1",
						"name": "GLM 5.1",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "zai-org/GLM-5",
						"name": "GLM 5",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "moonshotai/Kimi-K2.6",
						"name": "Kimi K2.6",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "moonshotai/Kimi-K2.5",
						"name": "Kimi K2.5",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "openai/gpt-oss-120b",
						"name": "GPT OSS 120B",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "MiniMaxAI/MiniMax-M2.5",
						"name": "MiniMax M2.5",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "inclusionAI/Ling-flash-2.0",
						"name": "Ling Flash 2.0",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "Qwen/Qwen3-32B",
						"name": "Qwen3 32B",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					}
				],
				"notes": "Chat ids from the 9router registry; listing is filtered with sub_type=chat.",
				"website": "https://siliconflow.com/",
				"local": false,
				"source": "fcc",
				"modelsUrl": "https://api.siliconflow.com/v1/models"
			},
			{
				"id": "tencent",
				"name": "Tencent Hunyuan",
				"category": "apikey",
				"auth": {
					"kind": "apiKey",
					"env": "HUNYUAN_API_KEY",
					"url": "https://console.cloud.tencent.com/hunyuan/api-key"
				},
				"baseUrl": "https://api.hunyuan.cloud.tencent.com/v1",
				"format": "openai-chat",
				"models": [{
					"id": "hunyuan-turbos-latest",
					"name": "Hunyuan TurboS Latest",
					"contextWindow": 2e5,
					"vision": null,
					"reasoning": null
				}, {
					"id": "hunyuan-t1-latest",
					"name": "Hunyuan T1 Latest",
					"contextWindow": 256e3,
					"vision": null,
					"reasoning": null
				}],
				"notes": "Tencent Hunyuan OpenAI-compatible endpoint.",
				"website": "https://cloud.tencent.com/product/hunyuan",
				"local": false,
				"source": "9router",
				"modelsUrl": "https://api.hunyuan.cloud.tencent.com/v1/models"
			},
			{
				"id": "together",
				"name": "Together AI",
				"category": "apikey",
				"auth": {
					"kind": "apiKey",
					"env": "TOGETHER_API_KEY",
					"url": "https://api.together.ai/settings/api-keys"
				},
				"baseUrl": "https://api.together.ai/v1",
				"format": "openai-chat",
				"models": [
					{
						"id": "meta-llama/Llama-3.3-70B-Instruct-Turbo",
						"name": "Llama 3.3 70B Turbo",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "deepseek-ai/DeepSeek-R1",
						"name": "DeepSeek R1",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "Qwen/Qwen3-235B-A22B",
						"name": "Qwen3 235B",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
						"name": "Llama 4 Maverick",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "zai-org/GLM-5.2",
						"name": "GLM-5.2",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					}
				],
				"notes": "Embedding ids omitted; the FCC profile lists models at /models with context_length.",
				"website": "https://www.together.ai/",
				"local": false,
				"source": "fcc",
				"modelsUrl": "https://api.together.ai/v1/models"
			},
			{
				"id": "tokenrouter",
				"name": "TokenRouter",
				"category": "apikey",
				"auth": {
					"kind": "apiKey",
					"env": "TOKENROUTER_API_KEY",
					"url": "https://www.tokenrouter.com/"
				},
				"baseUrl": "https://api.tokenrouter.com/v1",
				"format": "openai-chat",
				"models": [
					{
						"id": "anthropic/claude-haiku-4.5",
						"name": "Claude Haiku 4.5",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "anthropic/claude-sonnet-4.6",
						"name": "Claude Sonnet 4.6",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "anthropic/claude-opus-4.8",
						"name": "Claude Opus 4.8",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "anthropic/claude-opus-4.8-fast",
						"name": "Claude Opus 4.8 Fast",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "openai/gpt-5.4",
						"name": "Gpt 5.4",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "openai/gpt-5.4-mini",
						"name": "Gpt 5.4 Mini",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "openai/gpt-5.4-pro",
						"name": "Gpt 5.4 Pro",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "openai/gpt-5.5",
						"name": "Gpt 5.5",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "openai/gpt-5.6-sol",
						"name": "Gpt 5.6 Sol",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "google/gemini-3.5-flash",
						"name": "Gemini 3.5 Flash",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "google/gemini-3.6-flash",
						"name": "Gemini 3.6 Flash",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "deepseek/deepseek-v4-flash",
						"name": "Deepseek V4 Flash",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "deepseek/deepseek-v4-pro",
						"name": "Deepseek V4 Pro",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "qwen/qwen3-coder-next",
						"name": "Qwen3 Coder Next",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "qwen/qwen3.7-max",
						"name": "Qwen3.7 Max",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "qwen/qwen3.8-max",
						"name": "Qwen3.8 Max",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "moonshotai/kimi-k2.7-code",
						"name": "Kimi K2.7 Code",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "moonshotai/kimi-k3-free",
						"name": "Kimi K3 Free",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "z-ai/glm-5.3-free",
						"name": "Glm 5.3 Free",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "z-ai/glm-5.2",
						"name": "Glm 5.2",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "z-ai/glm-5-turbo",
						"name": "Glm 5 Turbo",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "x-ai/grok-4.5",
						"name": "Grok 4.5",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					}
				],
				"notes": "Multi-vendor gateway with free slugs.",
				"website": "https://www.tokenrouter.com/",
				"local": false,
				"source": "fcc",
				"freeModelsHint": ["moonshotai/kimi-k3-free", "z-ai/glm-5.3-free"],
				"modelsUrl": "https://api.tokenrouter.com/v1/models"
			},
			{
				"id": "venice",
				"name": "Venice AI",
				"category": "apikey",
				"auth": {
					"kind": "apiKey",
					"env": "VENICE_API_KEY",
					"url": "https://venice.ai/settings/api"
				},
				"baseUrl": "https://api.venice.ai/api/v1",
				"format": "openai-chat",
				"models": [
					{
						"id": "venice-uncensored-1-2",
						"name": "Venice Uncensored 1.2",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "zai-org-glm-5",
						"name": "GLM-5",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "qwen3-235b-a22b-instruct-2507",
						"name": "Qwen3 235B A22B Instruct",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "qwen3-coder-480b-a35b-instruct-turbo",
						"name": "Qwen3 Coder 480B A35B Turbo",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "qwen3-vl-235b-a22b",
						"name": "Qwen3 VL 235B A22B",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "deepseek-v4-pro",
						"name": "DeepSeek V4 Pro",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "llama-3.3-70b",
						"name": "Llama 3.3 70B",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "hermes-3-llama-3.1-405b",
						"name": "Hermes 3 Llama 3.1 405B",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "mistral-small-3-2-24b-instruct",
						"name": "Mistral Small 3.2 24B",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					}
				],
				"notes": "Private inference plus uncensored models (9router notice). Embedding and image ids omitted.",
				"website": "https://venice.ai",
				"local": false,
				"source": "9router",
				"modelsUrl": "https://api.venice.ai/api/v1/models"
			},
			{
				"id": "vercel",
				"name": "Vercel AI Gateway",
				"category": "apikey",
				"auth": {
					"kind": "apiKey",
					"env": "AI_GATEWAY_API_KEY",
					"url": "https://vercel.com/docs/ai-gateway"
				},
				"baseUrl": "https://ai-gateway.vercel.sh/v1",
				"format": "openai-chat",
				"models": [{
					"id": "openai/gpt-5.5",
					"name": "GPT-5.5 (Vercel)",
					"contextWindow": null,
					"vision": null,
					"reasoning": null
				}],
				"notes": "Vercel AI Gateway; models are vendor-namespaced.",
				"website": "https://vercel.com/ai-gateway",
				"local": false,
				"source": "fcc"
			},
			{
				"id": "vertex",
				"name": "Google Vertex AI",
				"category": "apikey",
				"auth": {
					"kind": "adc",
					"env": null,
					"url": "https://cloud.google.com/docs/authentication/set-up-adc-local-dev-environment"
				},
				"baseUrl": "https://aiplatform.googleapis.com/v1/projects/{project_id}/locations/{location}/endpoints/openapi",
				"format": "openai-chat",
				"models": [
					{
						"id": "gemini-3.1-pro-preview",
						"name": "Gemini 3.1 Pro Preview",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gemini-3.1-flash-lite-preview",
						"name": "Gemini 3.1 Flash Lite Preview",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gemini-3-flash-preview",
						"name": "Gemini 3 Flash Preview",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gemini-2.5-flash",
						"name": "Gemini 2.5 Flash",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "google/gemini-3.5-flash",
						"name": "Gemini 3.5 Flash (Vertex)",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					}
				],
				"notes": "ADC (no key): VERTEX_PROJECT_ID and VERTEX_LOCATION compose the endpoint (FCC providers/vertex/endpoint.py).",
				"website": "https://cloud.google.com/vertex-ai",
				"local": false,
				"source": "fcc"
			},
			{
				"id": "vertex-partner",
				"name": "Vertex Partner Models",
				"category": "apikey",
				"auth": {
					"kind": "adc",
					"env": null,
					"url": "https://console.cloud.google.com/iam-admin/serviceaccounts"
				},
				"baseUrl": "https://aiplatform.googleapis.com/v1/projects/{project_id}/locations/{location}/endpoints/openapi",
				"format": "openai-chat",
				"models": [
					{
						"id": "deepseek-ai/deepseek-v3.2-maas",
						"name": "DeepSeek V3.2 (Vertex)",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "qwen/qwen3-next-80b-a3b-thinking-maas",
						"name": "Qwen3 Next 80B Thinking (Vertex)",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "qwen/qwen3-next-80b-a3b-instruct-maas",
						"name": "Qwen3 Next 80B Instruct (Vertex)",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "zai-org/glm-5-maas",
						"name": "GLM-5 (Vertex)",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					}
				],
				"notes": "Vertex MaaS partner models (9router model list); the OpenAI-compatible base is composed per project/location (FCC providers/vertex/endpoint.py).",
				"website": "https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/use-partner-models",
				"local": false,
				"source": "9router"
			},
			{
				"id": "volcengine-ark",
				"name": "Volcengine Ark",
				"category": "apikey",
				"auth": {
					"kind": "apiKey",
					"env": "ARK_API_KEY",
					"url": "https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey"
				},
				"baseUrl": "https://ark.cn-beijing.volces.com/api/coding/v3",
				"format": "openai-chat",
				"models": [
					{
						"id": "Doubao-Seed-2.0-Code",
						"name": "Doubao-Seed-2.0-Code",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "Doubao-Seed-2.0-pro",
						"name": "Doubao-Seed-2.0-pro",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "Doubao-Seed-2.0-lite",
						"name": "Doubao-Seed-2.0-lite",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "Doubao-Seed-Code",
						"name": "Doubao-Seed-Code",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "DeepSeek-V4-Flash",
						"name": "DeepSeek-V4-Flash",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "DeepSeek-V4-Pro",
						"name": "DeepSeek-V4-Pro",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "GLM-5.1",
						"name": "GLM-5.1",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "MiniMax-M2.7",
						"name": "MiniMax-M2.7",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "Kimi-K2.6",
						"name": "Kimi-K2.6",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					}
				],
				"notes": "ByteDance Volcengine coding endpoint (CN); 9router registry declares the key URL.",
				"website": "https://console.volcengine.com/ark",
				"local": false,
				"source": "9router"
			},
			{
				"id": "wafer",
				"name": "Wafer",
				"category": "apikey",
				"auth": {
					"kind": "apiKey",
					"env": "WAFER_API_KEY",
					"url": "https://www.wafer.ai/pass"
				},
				"baseUrl": "https://pass.wafer.ai/v1",
				"format": "openai-chat",
				"models": [{
					"id": "DeepSeek-V4-Pro",
					"name": "DeepSeek V4 Pro (Wafer)",
					"contextWindow": null,
					"vision": null,
					"reasoning": null
				}],
				"notes": "Wafer pass endpoint.",
				"website": "https://www.wafer.ai/",
				"local": false,
				"source": "fcc"
			},
			{
				"id": "wandb",
				"name": "W&B Inference",
				"category": "apikey",
				"auth": {
					"kind": "apiKey",
					"env": "WANDB_API_KEY",
					"url": "https://wandb.ai/settings"
				},
				"baseUrl": "https://api.inference.wandb.ai/v1",
				"format": "openai-chat",
				"models": [{
					"id": "openai/gpt-oss-20b",
					"name": "GPT-OSS 20B",
					"contextWindow": null,
					"vision": null,
					"reasoning": null
				}],
				"notes": "W&B Serverless Inference; reasoning arrives as think tags (FCC profile).",
				"website": "https://wandb.ai/site/inference/",
				"local": false,
				"source": "fcc"
			},
			{
				"id": "xai",
				"name": "xAI (Grok)",
				"category": "apikey",
				"auth": {
					"kind": "apiKey",
					"env": "XAI_API_KEY",
					"url": "https://console.x.ai/team/default/api-keys"
				},
				"baseUrl": "https://api.x.ai/v1",
				"format": "openai-chat",
				"models": [
					{
						"id": "grok-4.6",
						"name": "Grok 4.6",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "grok-4.5",
						"name": "Grok 4.5",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "grok-4",
						"name": "Grok 4",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "grok-4-fast-reasoning",
						"name": "Grok 4 Fast Reasoning",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "grok-code-fast-1",
						"name": "Grok Code Fast",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "grok-3",
						"name": "Grok 3",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					}
				],
				"notes": "Image and video ids from the same registry listing are omitted (chat catalog).",
				"website": "https://x.ai/",
				"local": false,
				"source": "fcc",
				"modelsUrl": "https://api.x.ai/v1/models"
			},
			{
				"id": "xiaomi-tokenplan",
				"name": "Xiaomi MiMo Token Plan",
				"category": "apikey",
				"auth": {
					"kind": "apiKey",
					"env": "XIAOMI_MIMO_API_KEY",
					"url": "https://mimo.xiaomi.com"
				},
				"baseUrl": "https://token-plan-sgp.xiaomimimo.com/v1",
				"format": "openai-chat",
				"models": [
					{
						"id": "mimo-v2.5-pro",
						"name": "MiMo V2.5 Pro",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "mimo-v2.5-pro-claude",
						"name": "MiMo V2.5 Pro (Claude Native)",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "mimo-v2.5",
						"name": "MiMo V2.5",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "mimo-v2-pro",
						"name": "MiMo V2 Pro",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "mimo-v2-omni",
						"name": "MiMo V2 Omni",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					}
				],
				"notes": "Token Plan subscription (keys start with tp-) and are cluster-specific; TTS ids omitted (9router notice).",
				"website": "https://mimo.xiaomi.com",
				"local": false,
				"source": "9router"
			},
			{
				"id": "xkiro",
				"name": "xKiro",
				"category": "apikey",
				"auth": {
					"kind": "apiKey",
					"env": "XKIRO_API_KEY",
					"url": "https://xkiro.com/dashboard/api/keys"
				},
				"baseUrl": "https://api.xkiro.com/v1",
				"format": "openai-chat",
				"models": [{
					"id": "qwen/qwen3.7-flash:free",
					"name": "Qwen3.7 Flash (free)",
					"contextWindow": null,
					"vision": null,
					"reasoning": null
				}],
				"notes": "Multi-provider gateway; thinking is a capabilities.reasoning boolean in the listing (FCC profile).",
				"website": "https://xkiro.com/",
				"local": false,
				"source": "fcc",
				"freeModelsHint": ["qwen/qwen3.7-flash:free"]
			},
			{
				"id": "zai",
				"name": "Z.ai Coding Plan",
				"category": "apikey",
				"auth": {
					"kind": "apiKey",
					"env": "ZAI_API_KEY",
					"url": "https://z.ai/manage-apikey/apikey-list"
				},
				"baseUrl": "https://api.z.ai/api/coding/paas/v4",
				"format": "openai-chat",
				"models": [
					{
						"id": "glm-5.3",
						"name": "GLM 5.3",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "glm-5.3-flash",
						"name": "GLM 5.3 Flash (Vision)",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "glm-5.2",
						"name": "GLM 5.2",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "glm-5.1",
						"name": "GLM 5.1",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "glm-5-turbo",
						"name": "GLM 5 Turbo",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "glm-5",
						"name": "GLM 5",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "glm-4.7",
						"name": "GLM 4.7",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "glm-4.6v",
						"name": "GLM 4.6V (Vision)",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					}
				],
				"notes": "Z.ai coding-plan endpoint; caller extra_body is rejected (FCC profile). Ids are shared across Z.ai routes per the 9router glm registry.",
				"website": "https://z.ai/",
				"local": false,
				"source": "fcc"
			},
			{
				"id": "zai_api",
				"name": "Z.ai API",
				"category": "apikey",
				"auth": {
					"kind": "apiKey",
					"env": "ZAI_API_KEY",
					"url": "https://z.ai/manage-apikey/apikey-list"
				},
				"baseUrl": "https://api.z.ai/api/paas/v4",
				"format": "openai-chat",
				"models": [
					{
						"id": "glm-5.3",
						"name": "GLM 5.3",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "glm-5.3-flash",
						"name": "GLM 5.3 Flash (Vision)",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "glm-5.2",
						"name": "GLM 5.2",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "glm-5.1",
						"name": "GLM 5.1",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "glm-5-turbo",
						"name": "GLM 5 Turbo",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "glm-5",
						"name": "GLM 5",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "glm-4.7",
						"name": "GLM 4.7",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "glm-4.6v",
						"name": "GLM 4.6V (Vision)",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "glm-4.7-flash",
						"name": "GLM 4.7 Flash",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					}
				],
				"notes": "Z.ai pay-as-you-go endpoint; ids are shared across Z.ai routes per the 9router glm registry.",
				"website": "https://z.ai/",
				"local": false,
				"source": "fcc"
			},
			{
				"id": "zenmux",
				"name": "ZenMux",
				"category": "apikey",
				"auth": {
					"kind": "apiKey",
					"env": "ZENMUX_API_KEY",
					"url": "https://zenmux.ai/platform/pay-as-you-go"
				},
				"baseUrl": "https://zenmux.ai/api/v1",
				"format": "openai-chat",
				"models": [{
					"id": "deepseek/deepseek-v4-flash-free",
					"name": "DeepSeek V4 Flash (free)",
					"contextWindow": null,
					"vision": null,
					"reasoning": null
				}],
				"notes": "max_tokens is sent as max_completion_tokens (FCC profile).",
				"website": "https://zenmux.ai/",
				"local": false,
				"source": "fcc",
				"freeModelsHint": ["deepseek/deepseek-v4-flash-free"]
			},
			{
				"id": "opencode",
				"name": "OpenCode Free",
				"category": "free",
				"auth": {
					"kind": "none",
					"env": null,
					"url": null
				},
				"baseUrl": "https://opencode.ai/zen/v1",
				"format": "openai-chat",
				"models": [
					{
						"id": "muse-spark-1.2-contributor-free",
						"name": "Muse Spark 1.2 Contributor Free",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "muse-spark-1.3-contributor-free",
						"name": "Muse Spark 1.3 Contributor Free",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "union-alpha",
						"name": "Union Alpha Free",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "jev-1.13-free",
						"name": "Jev 1.13 Free",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					}
				],
				"notes": "Keyless free pool (noAuth) — the plugin’s own free lane speaks to the same /zen/v1 host and sends the same x-opencode-client header. Per-model wires differ: two models answer over /responses and union-alpha over the Anthropic wire (9router registry comments).",
				"website": "https://opencode.ai",
				"local": false,
				"source": "9router",
				"modelsUrl": "https://opencode.ai/zen/v1/models",
				"headers": { "x-opencode-client": "desktop" }
			},
			{
				"id": "bazaarlink",
				"name": "BazaarLink",
				"category": "free-tier",
				"auth": {
					"kind": "apiKey",
					"env": "BAZAARLINK_API_KEY",
					"url": "https://bazaarlink.ai"
				},
				"baseUrl": "https://bazaarlink.ai/api/v1",
				"format": "openai-chat",
				"models": [
					{
						"id": "auto:free",
						"name": "Auto Free (Zero Cost)",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "claude-opus-4.7",
						"name": "Claude Opus 4.7",
						"contextWindow": 1e6,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "claude-sonnet-4.6",
						"name": "Claude Sonnet 4.6",
						"contextWindow": 1e6,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "claude-haiku-4.5",
						"name": "Claude Haiku 4.5",
						"contextWindow": 2e5,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gpt-5.5",
						"name": "GPT-5.5",
						"contextWindow": 105e4,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gpt-5.4",
						"name": "GPT-5.4",
						"contextWindow": 105e4,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gpt-5.4-mini",
						"name": "GPT-5.4 Mini",
						"contextWindow": 4e5,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gpt-5.4-nano",
						"name": "GPT-5.4 Nano",
						"contextWindow": 4e5,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "grok-4.3",
						"name": "Grok 4.3",
						"contextWindow": 1e6,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "grok-4.20",
						"name": "Grok 4.20",
						"contextWindow": 2e6,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gemini-3.1-pro-preview",
						"name": "Gemini 3.1 Pro",
						"contextWindow": 1048576,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gemini-3-flash-preview",
						"name": "Gemini 3 Flash",
						"contextWindow": 1048576,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gemini-3.1-flash-lite-preview",
						"name": "Gemini 3.1 Flash Lite",
						"contextWindow": 1048576,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "kimi-k2.6",
						"name": "Kimi K2.6",
						"contextWindow": 262144,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "kimi-k2.5",
						"name": "Kimi K2.5",
						"contextWindow": 262144,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "glm-5.1",
						"name": "GLM 5.1",
						"contextWindow": 204800,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "glm-5",
						"name": "GLM 5",
						"contextWindow": 204800,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "mimo-v2.5-pro",
						"name": "MiMo-V2.5-Pro",
						"contextWindow": 105e4,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "mimo-v2.5",
						"name": "MiMo-V2.5",
						"contextWindow": 105e4,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "minimax-m3",
						"name": "MiniMax M3",
						"contextWindow": 1048576,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "minimax-m2.7",
						"name": "MiniMax M2.7",
						"contextWindow": 204800,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "minimax-m2.5",
						"name": "MiniMax M2.5",
						"contextWindow": 204800,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "qwen3.6-plus",
						"name": "Qwen 3.6 Plus",
						"contextWindow": 1e6,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "nemotron-3-super-120b-a12b",
						"name": "Nemotron 3 Super",
						"contextWindow": 1e6,
						"vision": null,
						"reasoning": null
					}
				],
				"notes": "Multi-vendor gateway with an auto:free slug; 9router lists it as free-tier.",
				"website": "https://bazaarlink.ai",
				"local": false,
				"source": "9router",
				"freeModelsHint": ["auto:free"],
				"modelsUrl": "https://bazaarlink.ai/api/v1/models"
			},
			{
				"id": "byteplus",
				"name": "BytePlus Ark",
				"category": "free-tier",
				"auth": {
					"kind": "apiKey",
					"env": "BYTEPLUS_API_KEY",
					"url": "https://console.byteplus.com/ark/region:ark+ap-southeast-1/apiKey"
				},
				"baseUrl": "https://ark.ap-southeast.bytepluses.com/api/coding/v3",
				"format": "openai-chat",
				"models": [
					{
						"id": "seed-2-0-pro-260328",
						"name": "Seed 2.0 Pro",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "seed-2-0-code-preview-260328",
						"name": "Seed 2.0 Code Preview",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "seed-2-0-mini-260215",
						"name": "Seed 2.0 Mini",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "seed-2-0-lite-260228",
						"name": "Seed 2.0 Lite",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "kimi-k2-thinking-251104",
						"name": "Kimi K2 Thinking",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "glm-4-7-251222",
						"name": "GLM 4.7",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gpt-oss-120b-250805",
						"name": "GPT-OSS-120B",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					}
				],
				"notes": "Free credits for new accounts (9router notice); Seed 2.0, Kimi K2 Thinking, GLM 4.7 and GPT-OSS-120B.",
				"website": "https://console.byteplus.com/ark",
				"local": false,
				"source": "9router"
			},
			{
				"id": "cloudflare",
				"name": "Cloudflare",
				"category": "free-tier",
				"auth": {
					"kind": "apiKey",
					"env": "CLOUDFLARE_API_TOKEN",
					"url": "https://dash.cloudflare.com/profile/api-tokens"
				},
				"baseUrl": "https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1",
				"format": "openai-chat",
				"models": [
					{
						"id": "@cf/meta/llama-3.2-1b-instruct",
						"name": "Llama 3.2 1B Instruct",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "@cf/meta/llama-3.2-3b-instruct",
						"name": "Llama 3.2 3B Instruct",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "@cf/meta/llama-3.1-8b-instruct-fp8-fast",
						"name": "Llama 3.1 8B Instruct FP8 Fast",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "@cf/meta/llama-3.1-8b-instruct-awq",
						"name": "Llama 3.1 8B Instruct AWQ",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "@cf/mistralai/mistral-small-3.1-24b-instruct",
						"name": "Mistral Small 3.1 24B Instruct",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "@cf/meta/llama-3.1-70b-instruct-fp8-fast",
						"name": "Llama 3.1 70B Instruct FP8 Fast",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
						"name": "Llama 3.3 70B Instruct FP8 Fast",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
						"name": "DeepSeek R1 Distill Qwen 32B",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "@cf/moonshotai/kimi-k2.5",
						"name": "Kimi K2.5",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "@cf/moonshotai/kimi-k2.6",
						"name": "Kimi K2.6",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "@cf/zai-org/glm-4.7-flash",
						"name": "GLM 4.7 Flash",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "@cf/qwen/qwq-32b",
						"name": "QwQ 32B",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "@cf/qwen/qwen2.5-coder-32b-instruct",
						"name": "Qwen 2.5 Coder 32B Instruct",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					}
				],
				"notes": "Account-scoped URL — replace {account_id}; Workers AI has a free allocation and 9router lists it as free-tier. Image ids omitted.",
				"website": "https://www.cloudflare.com/developer-platform/products/workers-ai/",
				"local": false,
				"source": "fcc"
			},
			{
				"id": "gemini",
				"name": "Gemini",
				"category": "free-tier",
				"auth": {
					"kind": "apiKey",
					"env": "GEMINI_API_KEY",
					"url": "https://aistudio.google.com/apikey"
				},
				"baseUrl": "https://generativelanguage.googleapis.com/v1beta/openai",
				"format": "openai-chat",
				"models": [
					{
						"id": "gemini-3.8-flash",
						"name": "Gemini 3.8 Flash",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gemini-3.7-flash",
						"name": "Gemini 3.7 Flash",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gemini-3.6-flash",
						"name": "Gemini 3.6 Flash",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gemini-3.5-flash-lite",
						"name": "Gemini 3.5 Flash Lite",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gemini-3.1-pro-preview",
						"name": "Gemini 3.1 Pro Preview",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gemini-3.1-flash-lite-preview",
						"name": "Gemini 3.1 Flash Lite Preview",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gemini-3-flash-preview",
						"name": "Gemini 3 Flash Preview",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gemini-2.5-pro",
						"name": "Gemini 2.5 Pro",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gemini-2.5-flash",
						"name": "Gemini 2.5 Flash",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gemini-2.5-flash-lite",
						"name": "Gemini 2.5 Flash Lite",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gemma-4-31b-it",
						"name": "Gemma 4 31B IT",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					}
				],
				"notes": "Google AI Studio key; 9router lists it as free-tier. FCC speaks the OpenAI-compatible layer at /v1beta/openai/.",
				"website": "https://ai.google.dev/",
				"local": false,
				"source": "fcc"
			},
			{
				"id": "kilo",
				"name": "Kilo.ai",
				"category": "free-tier",
				"auth": {
					"kind": "apiKey",
					"env": "KILO_API_KEY",
					"url": "https://app.kilo.ai"
				},
				"baseUrl": "https://api.kilo.ai/api/gateway",
				"format": "openai-chat",
				"models": [
					{
						"id": "kilo-auto/free",
						"name": "Kilo Auto Free",
						"contextWindow": 256e3,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "nvidia/nemotron-3-super-120b-a12b:free",
						"name": "Nemotron 3 Super 120B (Free)",
						"contextWindow": 262144,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "nvidia/nemotron-3-ultra-550b-a55b:free",
						"name": "Nemotron 3 Ultra 550B (Free)",
						"contextWindow": 1e6,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "kwaipilot/kat-coder-pro-v2.5:free",
						"name": "Kat Coder Pro v2.5 (Free)",
						"contextWindow": 256e3,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "kilo-auto/frontier",
						"name": "Kilo Auto Frontier",
						"contextWindow": 1e6,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "kilo-auto/balanced",
						"name": "Kilo Auto Balanced",
						"contextWindow": 1e6,
						"vision": null,
						"reasoning": null
					}
				],
				"notes": "Kilo gateway free pool; the plugin’s own Kilo channel reads the same host.",
				"website": "https://kilo.ai/",
				"local": false,
				"source": "fcc",
				"freeModelsHint": [
					"kilo-auto/free",
					"nvidia/nemotron-3-super-120b-a12b:free",
					"nvidia/nemotron-3-ultra-550b-a55b:free",
					"kwaipilot/kat-coder-pro-v2.5:free"
				],
				"modelsUrl": "https://api.kilo.ai/api/gateway/models"
			},
			{
				"id": "kimchi",
				"name": "Kimchi",
				"category": "free-tier",
				"auth": {
					"kind": "apiKey",
					"env": "KIMCHI_API_KEY",
					"url": "https://app.kimchi.dev"
				},
				"baseUrl": "https://llm.kimchi.dev/openai/v1",
				"format": "openai-chat",
				"models": [
					{
						"id": "minimax-m3",
						"name": "MiniMax-M3",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "kimi-k2.7",
						"name": "Kimi-K2.7",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "kimi-k2.6",
						"name": "Kimi-K2.6",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "kimi-k2.5",
						"name": "Kimi-K2.5",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "nemotron-3-ultra-fp4",
						"name": "Nemotron 3 Ultra FP4",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "minimax-m2.7",
						"name": "MiniMax-M2.7",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "claude-opus-4-6",
						"name": "Claude Opus 4.6",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "claude-sonnet-4-6",
						"name": "Claude Sonnet 4.6",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					}
				],
				"notes": "9router lists it as free-tier with oauth and apikey modes; the signup URL issues the credential. The user-agent is declared by the 9router registry.",
				"website": "https://kimchi.dev",
				"local": false,
				"source": "9router",
				"headers": { "user-agent": "kimchi/0.1.50" }
			},
			{
				"id": "nvidia_nim",
				"name": "NVIDIA NIM",
				"category": "free-tier",
				"auth": {
					"kind": "apiKey",
					"env": "NVIDIA_NIM_API_KEY",
					"url": "https://build.nvidia.com/settings/api-keys"
				},
				"baseUrl": "https://integrate.api.nvidia.com/v1",
				"format": "openai-chat",
				"models": [
					{
						"id": "minimaxai/minimax-m2.7",
						"name": "MiniMax M2.7",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "minimaxai/minimax-m3",
						"name": "MiniMax M3",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "z-ai/glm-5.2",
						"name": "GLM 5.2",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "deepseek-ai/deepseek-v4-pro",
						"name": "DeepSeek V4 Pro",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "deepseek-ai/deepseek-v4-flash",
						"name": "DeepSeek V4 Flash",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "moonshotai/kimi-k2.6",
						"name": "Kimi K2.6",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "nvidia/nemotron-3-ultra-550b-a55b",
						"name": "Nemotron 3 Ultra",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "nvidia/nemotron-3-super-120b-a12b",
						"name": "Nemotron 3 Super 120B",
						"contextWindow": 131072,
						"vision": null,
						"reasoning": null
					}
				],
				"notes": "Free access for NVIDIA Developer Program members (prototyping and testing) per the 9router registry; FCC ships it as the default provider.",
				"website": "https://build.nvidia.com/",
				"local": false,
				"source": "fcc",
				"modelsUrl": "https://integrate.api.nvidia.com/v1/models"
			},
			{
				"id": "ollama_cloud",
				"name": "Ollama Cloud",
				"category": "free-tier",
				"auth": {
					"kind": "apiKey",
					"env": "OLLAMA_API_KEY",
					"url": "https://ollama.com/settings/keys"
				},
				"baseUrl": "https://ollama.com/v1",
				"format": "openai-chat",
				"models": [
					{
						"id": "gpt-oss:120b",
						"name": "GPT OSS 120B",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "kimi-k2.5",
						"name": "Kimi K2.5",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "glm-5",
						"name": "GLM 5",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "minimax-m2.5",
						"name": "MiniMax M2.5",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "glm-4.7-flash",
						"name": "GLM 4.7 Flash",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "qwen3.5",
						"name": "Qwen3.5",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "minimax-m3",
						"name": "MiniMax M3",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "deepseek-v4.1-flash:cloud",
						"name": "DeepSeek V4.1 Flash",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "qwen3-coder:480b",
						"name": "Qwen3 Coder 480B",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					}
				],
				"notes": "Free tier: light usage, one cloud model at a time (9router notice). Tags are not OpenAI ids but Ollama model names.",
				"website": "https://ollama.com/",
				"local": false,
				"source": "fcc",
				"modelsUrl": "https://ollama.com/api/tags"
			},
			{
				"id": "open_router",
				"name": "OpenRouter",
				"category": "free-tier",
				"auth": {
					"kind": "apiKey",
					"env": "OPENROUTER_API_KEY",
					"url": "https://openrouter.ai/keys"
				},
				"baseUrl": "https://openrouter.ai/api/v1",
				"format": "openai-chat",
				"models": [{
					"id": "openrouter/free",
					"name": "OpenRouter Free Router",
					"contextWindow": null,
					"vision": null,
					"reasoning": null
				}],
				"notes": "Free tier: 27+ free models, no credit card, ~200 requests/day (9router registry).",
				"website": "https://openrouter.ai/",
				"local": false,
				"source": "fcc",
				"freeModelsHint": ["openrouter/free"]
			},
			{
				"id": "opencode_zen",
				"name": "OpenCode Zen",
				"category": "free-tier",
				"auth": {
					"kind": "apiKey",
					"env": "OPENCODE_API_KEY",
					"url": "https://opencode.ai/auth"
				},
				"baseUrl": "https://opencode.ai/zen/v1",
				"format": "openai-chat",
				"models": [
					{
						"id": "claude-fable-5",
						"name": "Claude Fable 5",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "claude-fable-5-1",
						"name": "Claude Fable 5.1",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "claude-opus-5",
						"name": "Claude Opus 5",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "claude-opus-4-8",
						"name": "Claude Opus 4.8",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "claude-opus-4-7",
						"name": "Claude Opus 4.7",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "claude-opus-4-6",
						"name": "Claude Opus 4.6",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "claude-opus-4-5",
						"name": "Claude Opus 4.5",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "claude-sonnet-5",
						"name": "Claude Sonnet 5",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "claude-sonnet-4-6",
						"name": "Claude Sonnet 4.6",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "claude-sonnet-4-5",
						"name": "Claude Sonnet 4.5",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "claude-sonnet-4",
						"name": "Claude Sonnet 4",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "claude-haiku-4-5",
						"name": "Claude Haiku 4.5",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gemini-3.6-flash",
						"name": "Gemini 3.6 Flash",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gemini-3.8-flash",
						"name": "Gemini 3.8 Flash",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gemini-3.7-flash",
						"name": "Gemini 3.7 Flash",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gemini-3.5-flash-lite",
						"name": "Gemini 3.5 Flash Lite",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gemini-3.5-flash",
						"name": "Gemini 3.5 Flash",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gemini-3.1-pro",
						"name": "Gemini 3.1 Pro",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gemini-3-flash",
						"name": "Gemini 3 Flash",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gpt-6-astra",
						"name": "GPT 6 Astra",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gpt-5.6-sol",
						"name": "GPT 5.6 Sol",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gpt-5.6-terra",
						"name": "GPT 5.6 Terra",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gpt-5.6-luna",
						"name": "GPT 5.6 Luna",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gpt-5.5",
						"name": "GPT 5.5",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gpt-5.5-pro",
						"name": "GPT 5.5 Pro",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gpt-5.4",
						"name": "GPT 5.4",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gpt-5.4-pro",
						"name": "GPT 5.4 Pro",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gpt-5.4-mini",
						"name": "GPT 5.4 Mini",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gpt-5.4-nano",
						"name": "GPT 5.4 Nano",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gpt-5.3-codex-spark",
						"name": "GPT 5.3 Codex Spark",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gpt-5.3-codex",
						"name": "GPT 5.3 Codex",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gpt-5.2",
						"name": "GPT 5.2",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gpt-5.2-codex",
						"name": "GPT 5.2 Codex",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gpt-5.1",
						"name": "GPT 5.1",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gpt-5.1-codex-max",
						"name": "GPT 5.1 Codex Max",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gpt-5.1-codex",
						"name": "GPT 5.1 Codex",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gpt-5.1-codex-mini",
						"name": "GPT 5.1 Codex Mini",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gpt-5",
						"name": "GPT 5",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gpt-5-codex",
						"name": "GPT 5 Codex",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gpt-5-nano",
						"name": "GPT 5 Nano",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "grok-build-0.1",
						"name": "Grok Build 0.1",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "grok-4.6",
						"name": "Grok 4.6",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "grok-4.5",
						"name": "Grok 4.5",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "muse-spark-1.3",
						"name": "Muse Spark 1.3",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "muse-spark-1.2",
						"name": "Muse Spark 1.2",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "qwen3.6-plus",
						"name": "Qwen 3.6 Plus",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "qwen3.5-plus",
						"name": "Qwen 3.5 Plus",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "deepseek-v4-pro",
						"name": "DeepSeek V4 Pro",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "deepseek-v4-flash",
						"name": "DeepSeek V4 Flash",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "deepseek-v4-flash-vision-exp",
						"name": "DeepSeek V4 Flash Vision Exp",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "glm-5.3-flash",
						"name": "GLM 5.3 Flash (Vision)",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "glm-5.3",
						"name": "GLM 5.3",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "glm-5.2",
						"name": "GLM 5.2",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "glm-5.1",
						"name": "GLM 5.1",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "glm-5",
						"name": "GLM 5",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "minimax-m3",
						"name": "MiniMax M3",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "minimax-m2.7",
						"name": "MiniMax M2.7",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "minimax-m2.5",
						"name": "MiniMax M2.5",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "kimi-k3",
						"name": "Kimi K3",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "kimi-k2.7-code",
						"name": "Kimi K2.7 Code",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "kimi-k2.6",
						"name": "Kimi K2.6",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "kimi-k2.5",
						"name": "Kimi K2.5",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "big-pickle",
						"name": "Big Pickle",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "union-alpha",
						"name": "Union Alpha",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "deepseek-v4-flash-free",
						"name": "DeepSeek V4 Flash Free",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "mimo-v2.6-flash-free",
						"name": "MiMo V2.6 Flash Free",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "mimo-v2.5-free",
						"name": "MiMo V2.5 Free",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "ling-3.0-flash-fin-free",
						"name": "Ling 3.0 Flash Fin Free",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "nemotron-3-ultra-free",
						"name": "Nemotron 3 Ultra Free",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "nemotron-3.5-lightning-free",
						"name": "Nemotron 3.5 Lightning Free",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "muse-spark-1.3-contributor-free",
						"name": "Muse Spark 1.3 Contributor Free",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "muse-spark-1.2-contributor-free",
						"name": "Muse Spark 1.2 Contributor Free",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "jev-1.13",
						"name": "Jev 1.13",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "jev-1.13-free",
						"name": "Jev 1.13 Free",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					}
				],
				"notes": "PAYG key with free models on the fast lane (9router notice); FCC dispatches each catalog route over chat or responses.",
				"website": "https://opencode.ai/zen",
				"local": false,
				"source": "fcc",
				"freeModelsHint": [
					"deepseek-v4-flash-free",
					"mimo-v2.6-flash-free",
					"mimo-v2.5-free",
					"ling-3.0-flash-fin-free",
					"nemotron-3-ultra-free",
					"nemotron-3.5-lightning-free",
					"muse-spark-1.3-contributor-free",
					"muse-spark-1.2-contributor-free",
					"jev-1.13-free"
				]
			},
			{
				"id": "llamacpp",
				"name": "LLaMA.cpp",
				"category": "local",
				"auth": {
					"kind": "none",
					"env": null,
					"url": null
				},
				"baseUrl": "http://localhost:8080/v1",
				"format": "openai-chat",
				"models": [],
				"notes": "Local server; the model list is whatever the user has loaded, so the registry carries no ids.",
				"website": "https://github.com/ggml-org/llama.cpp",
				"local": true,
				"source": "fcc",
				"baseUrlOverrideEnv": "LLAMACPP_BASE_URL"
			},
			{
				"id": "lmstudio",
				"name": "LM Studio",
				"category": "local",
				"auth": {
					"kind": "none",
					"env": null,
					"url": null
				},
				"baseUrl": "http://localhost:1234/v1",
				"format": "openai-chat",
				"models": [],
				"notes": "Local server; the model list is whatever the user has loaded, so the registry carries no ids.",
				"website": "https://lmstudio.ai/",
				"local": true,
				"source": "fcc",
				"baseUrlOverrideEnv": "LM_STUDIO_BASE_URL"
			},
			{
				"id": "ollama",
				"name": "Ollama",
				"category": "local",
				"auth": {
					"kind": "none",
					"env": null,
					"url": null
				},
				"baseUrl": "http://localhost:11434/v1",
				"format": "openai-chat",
				"models": [],
				"notes": "Local server; FCC normalizes the configured root to /v1, and the model list is whatever the user has pulled.",
				"website": "https://ollama.com/",
				"local": true,
				"source": "fcc",
				"baseUrlOverrideEnv": "OLLAMA_BASE_URL"
			},
			{
				"id": "github_copilot",
				"name": "GitHub Copilot",
				"category": "oauth",
				"auth": {
					"kind": "oauth",
					"env": null,
					"url": "https://docs.github.com/en/copilot/how-tos/copilot-sdk/auth/authenticate"
				},
				"baseUrl": "https://api.githubcopilot.com",
				"format": "openai-chat",
				"models": [
					{
						"id": "gpt-5.2",
						"name": "GPT-5.2",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gpt-5.2-codex",
						"name": "GPT-5.2 Codex",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gpt-5.3-codex",
						"name": "GPT-5.3 Codex",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gpt-5.4",
						"name": "GPT-5.4",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gpt-5.4-mini",
						"name": "GPT-5.4 Mini",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "claude-haiku-4.5",
						"name": "Claude Haiku 4.5",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "claude-opus-4.5",
						"name": "Claude Opus 4.5",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "claude-sonnet-4.5",
						"name": "Claude Sonnet 4.5",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "claude-sonnet-4.6",
						"name": "Claude Sonnet 4.6",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "claude-opus-4.6",
						"name": "Claude Opus 4.6",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "claude-opus-4.7",
						"name": "Claude Opus 4.7",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gemini-2.5-pro",
						"name": "Gemini 2.5 Pro",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gemini-3-flash-preview",
						"name": "Gemini 3 Flash",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gemini-3.1-pro-preview",
						"name": "Gemini 3.1 Pro",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "grok-code-fast-1",
						"name": "Grok Code Fast 1",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "oswe-vscode-prime",
						"name": "Raptor Mini",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "goldeneye-free-auto",
						"name": "GoldenEye",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					}
				],
				"notes": "GitHub account sign-in; the usable model set depends on the subscription (embedding ids omitted).",
				"website": "https://github.com/features/copilot",
				"local": false,
				"source": "fcc"
			},
			{
				"id": "openai",
				"name": "OpenAI / ChatGPT",
				"category": "oauth",
				"auth": {
					"kind": "oauth",
					"env": null,
					"url": "https://learn.chatgpt.com/docs/auth"
				},
				"baseUrl": "https://chatgpt.com/backend-api/codex",
				"format": "openai-responses",
				"models": [
					{
						"id": "gpt-6-astra",
						"name": "GPT 6.0 Astra",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gpt-5.6-sol",
						"name": "GPT 5.6 Sol",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gpt-5.6-terra",
						"name": "GPT 5.6 Terra",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gpt-5.6-luna",
						"name": "GPT 5.6 Luna",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gpt-5.5",
						"name": "GPT 5.5",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gpt-5.4",
						"name": "GPT 5.4",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gpt-5.4-mini",
						"name": "GPT 5.4 Mini",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					},
					{
						"id": "gpt-5.3-codex-spark",
						"name": "GPT 5.3 Codex Spark",
						"contextWindow": null,
						"vision": null,
						"reasoning": null
					}
				],
				"notes": "ChatGPT subscription via browser sign-in (connected account); responses wire on chatgpt.com/backend-api/codex.",
				"website": "https://openai.com/",
				"local": false,
				"source": "fcc"
			},
			{
				"id": "custom_openai",
				"name": "Custom OpenAI-compatible",
				"category": "apikey",
				"auth": {
					"kind": "apiKey",
					"env": "CUSTOM_OPENAI_API_KEY",
					"url": null
				},
				"baseUrl": "",
				"format": "openai-chat",
				"models": [],
				"notes": "Any OpenAI-compatible endpoint — vLLM, LiteLLM, one-api, LM Studio, a self-hosted gateway. Paste the base URL (ending in /v1) and the key on this card, then press Fetch models.",
				"website": null,
				"local": false,
				"baseUrlOverrideEnv": "CUSTOM_OPENAI_BASE_URL",
				"custom": true
			}
		].map((entry) => Object.freeze({
			...entry,
			models: Object.freeze([...entry.models ?? []])
		})));
		new Map(PROVIDERS.map((provider) => [provider.id, provider]));
		Object.freeze({
			"openai-chat": "/chat/completions",
			"openai-responses": "/responses",
			"anthropic-messages": "/messages"
		});
		typeof process === "undefined" || process.platform;
		Object.freeze({
			"openai-chat": "chat",
			"openai-responses": "responses",
			"anthropic-messages": "messages"
		});
		Object.freeze({
			"openai-chat": "/chat/completions",
			"openai-responses": "/responses",
			"anthropic-messages": "/messages"
		});
		typeof process === "undefined" || process.env.XDPOOL_FREE_BASE;
		/** Strip a trailing "(level)" thinking suffix so lookups hit the base id. */
		function baseModelId(model) {
			return model.replace(/\([^()]+\)\s*$/u, "").trim();
		}
		//#endregion
		//#region src/free-catalog.ts
		/**
		* Catalog for the免密 free lane.
		*
		* The gateway's listing is authoritative about WHICH models exist and nothing
		* about what they can do — it is a flat id list, and it includes paid ids this
		* lane cannot answer. So the roster is filtered to the免密 ids and every
		* capability is a LOCAL table, read off direct probes rather than a model card.
		* That distinction is why the two halves are separate functions here.
		*
		* Regional availability is egress-dependent and the gateway does not disclose
		* it: the same id exists or does not depending on where the request leaves from.
		* A row that carries the flag is labelled as such rather than silently failing
		* for a user whose VPN is off.
		*
		* @module src/free-catalog
		*/
		/** Ids that are free-tier without carrying the `-free` suffix. */
		const ALWAYS_FREE = /* @__PURE__ */ new Set(["union-alpha", "space-bunny-free"]);
		/**
		* Local capability baseline.
		*
		* `contextWindow`/`maxOutput` are the published capacities; `vision` is what this
		* lane actually accepted under a direct image-input probe, not what a model card
		* claims.
		*/
		const CAPABILITIES = [
			{
				match: /^mimo.*v2\.6/u,
				vision: true,
				reasoning: true,
				contextWindow: 1048576,
				maxOutput: 131072,
				canDisableThinking: false
			},
			{
				match: /^mimo.*v2\.5/u,
				vision: true,
				reasoning: true,
				contextWindow: 1048576,
				maxOutput: 131072,
				canDisableThinking: false
			},
			{
				match: /^mimo/u,
				vision: true,
				reasoning: true,
				contextWindow: 262144,
				maxOutput: 131072
			},
			{
				match: /^muse.?spark/u,
				vision: true,
				reasoning: true,
				contextWindow: 1048576,
				maxOutput: 131072
			},
			{
				match: /^nemotron/u,
				vision: false,
				reasoning: true,
				contextWindow: 128e3,
				maxOutput: 32768
			},
			{
				match: /^ling/u,
				vision: false,
				reasoning: true,
				contextWindow: 128e3,
				maxOutput: 32768
			},
			{
				match: /^space.?bunny/u,
				vision: true,
				reasoning: true,
				contextWindow: 262144,
				maxOutput: 65536
			},
			{
				match: /^union/u,
				vision: true,
				reasoning: false,
				contextWindow: 262144,
				maxOutput: 131072
			},
			{
				match: /^deepseek/u,
				vision: false,
				reasoning: true,
				contextWindow: 128e3,
				maxOutput: 64e3
			},
			{
				match: /^jev/u,
				vision: false,
				reasoning: false,
				contextWindow: 32768,
				maxOutput: 4096
			}
		];
		/** Is this id on the免密 lane? The listing mixes paid and free; only these answer. */
		function isFreeLane(modelId) {
			const base = baseModelId(modelId);
			if (ALWAYS_FREE.has(base)) return true;
			return /(?:^|[-_])free(?:$|[-_.])/u.test(base);
		}
		/**
		* The measured figures for an id the table covers, or `undefined` when it covers
		* none.
		*
		* Split out from {@link capabilitiesFor} because that one must ALWAYS answer: the
		* lane needs a serving contract for every id it lists, and a guessed window beats
		* no window there. A caller that would be *printing* the number to a user must
		* use this one instead — "the table has never heard of this model" and "this
		* model has a 128K window" are different claims, and only this function keeps
		* them apart.
		*/
		function knownCapabilities(modelId) {
			const base = baseModelId(modelId);
			for (const entry of CAPABILITIES) if (entry.match.test(base)) return {
				vision: entry.vision,
				reasoning: entry.reasoning,
				contextWindow: entry.contextWindow,
				maxOutput: entry.maxOutput,
				canDisableThinking: entry.canDisableThinking !== false
			};
		}
		Object.freeze([
			"muse-spark-1.3-contributor-free",
			"muse-spark-1.2-contributor-free",
			"union-alpha",
			"space-bunny-free",
			"nemotron-3-ultra-free",
			"deepseek-v4-flash-free",
			"mimo-v2.6-flash-free",
			"mimo-v2.5-free",
			"jev-1.13-free"
		]);
		//#endregion
		//#region src/client/recommend-use.ts
		/**
		* Recommended-use line for one model, derived purely from proved capabilities.
		*
		* The plugin refuses to invent a capability number, and the same discipline
		* applies here: this function only ever reads what {@link ModelFacts} already
		* proved — context window, image input, named thinking levels. Where the
		* upstream published nothing it says nothing, so a row with no facts yields no
		* recommended-use line rather than a guessed one.
		*
		* The three axes the user asked for — context size, thinking level, vision —
		* map directly onto the three fields a facts object can carry. Each becomes one
		* clause; the clauses are joined with a middle dot so the line reads as a single
		* recommendation rather than three unrelated tags.
		*
		* @module src/client/recommend-use
		*/
		/**
		* Compose a short Chinese "推荐用途" line from proved facts, or `undefined`
		* when there is nothing proved to base one on.
		*
		* `contextWindow` decides the size clause, `vision` the modality clause, and
		* `supportedEfforts` (the thinking levels the upstream named) the reasoning
		* clause. A model that published none of the three gets no line at all.
		*/
		function recommendUse(facts) {
			if (facts === void 0) return void 0;
			const bits = [];
			const ctx = typeof facts.contextWindow === "number" && facts.contextWindow > 0 ? facts.contextWindow : void 0;
			if (ctx !== void 0) {
				const cap = formatModelCapacity(ctx);
				const tier = ctx >= 1e6 ? `百万级长上下文(${cap})` : ctx >= 262144 ? `超长上下文(${cap})` : ctx >= 131072 ? `长上下文(${cap})` : ctx >= 65536 ? `中等上下文(${cap})` : `短上下文(${cap})`;
				const use = ctx >= 1e6 ? "长篇文档 / 论文 / 代码库分析" : ctx >= 262144 ? "长文与多轮深度对话" : ctx >= 131072 ? "长文写作与资料整理" : ctx >= 65536 ? "常规写作与问答" : "轻量对话与短文本";
				bits.push(`${tier}：${use}`);
			}
			if (facts.vision === true) bits.push("支持图片/截图输入：图表理解与多模态问答");
			const efforts = facts.supportedEfforts;
			if (Array.isArray(efforts) && efforts.length > 0) bits.push("强推理：复杂逻辑 / 数学推导 / 代码生成");
			if (bits.length === 0) return void 0;
			return bits.join(" · ");
		}
		//#endregion
		//#region src/client/AggregatePage.tsx
		/**
		* The aggregate provider page: every vendor in the roster as a compact row the
		* user opens before configuring.
		*
		* WHY THE ROWS ARE COLLAPSED
		*
		* The roster is seventy-six vendors and, on a fresh install, none of them is
		* configured. The first version drew every row with its key field, endpoint
		* field and seven buttons already on screen and its switch already flipped, so
		* the page opened on a wall of empty inputs that read as "everything is
		* already in the pool, and also everything is broken". Nothing here is in the
		* pool until the user says so: the row shows what the vendor IS, and the fields
		* appear when the row is opened.
		*
		* Split out of {@link ../client/PoolCard} because the pool card is already a
		* long file and this page has its own fetch/state lifecycle — it reads a
		* different document (`POOL_AGGREGATE_PATH`) and must not be mounted on the
		* pool card's 30-second poll.
		*
		* @module dsh-xdpool/client/AggregatePage
		*/
		/** Category order in the filter row, matching the registry's own vocabulary. */
		const CATEGORIES = [
			"apikey",
			"free",
			"free-tier",
			"local",
			"oauth"
		];
		const CATEGORY_LABEL = Object.freeze({
			apikey: "agg.catApikey",
			free: "agg.catFree",
			"free-tier": "agg.catFreeTier",
			local: "agg.catLocal",
			oauth: "agg.catOauth"
		});
		/**
		* Tile accents for the roster.
		*
		* The registry carries no colour of its own — it has no accent, icon or hex
		* field at all — so a vendor's tint is derived from its id. That is a weaker
		* claim than the login channels' hand-picked accents, and deliberately so: it
		* exists to keep seventy-six tiles from looking like one grey column, not to
		* assert a brand colour nobody published. A derived tint is stable across
		* reloads, which is the property that actually matters for recognition.
		*/
		const VENDOR_ACCENTS = [
			"#5686fe",
			"#7a5cf0",
			"#10a5a0",
			"#e8843d",
			"#d9578a",
			"#4aa3e8",
			"#6aa84f",
			"#c05ce0"
		];
		/** A stable tint for one vendor id. */
		function accentFor(id) {
			let hash = 0;
			for (let at = 0; at < id.length; at += 1) hash = hash * 31 + id.charCodeAt(at) >>> 0;
			return VENDOR_ACCENTS[hash % VENDOR_ACCENTS.length];
		}
		/** How many model ids a row may print before it collapses into "and N more". */
		const MODEL_PREVIEW = 4;
		/**
		* How many models a vendor must offer before the per-vendor chooser is drawn.
		*
		* The whole point of this page's model picker is a roster too long to read at a
		* glance, so a threshold is what keeps the short ones looking like the short
		* ones. Eight is where scrolling starts to beat scanning.
		*/
		const MODEL_CHOOSER_THRESHOLD = 8;
		function AggregatePage({ t }) {
			const [status, setStatus] = (0, react.useState)(void 0);
			const [error, setError] = (0, react.useState)(void 0);
			/** Provider ids with an in-flight action, so only that row shows a spinner. */
			const [busyIds, setBusyIds] = (0, react.useState)(/* @__PURE__ */ new Set());
			/** providerId -> the flash line shown under that row. */
			const [flash, setFlash] = (0, react.useState)({});
			const [drafts, setDrafts] = (0, react.useState)({});
			/**
			* Which rows are open.
			*
			* Kept here rather than in the row so it survives the `load()` that follows
			* every save: a row that collapsed itself the moment the user pressed Save
			* would hide the confirmation line it just produced.
			*/
			const [opened, setOpened] = (0, react.useState)({});
			/**
			* providerId -> the model's ticked state while the chooser is being edited.
			*
			* Separate from the server document on purpose, exactly as the key draft is:
			* this is a BUFFER, and it is only ever sent when the user presses Save. A
			* chooser that wrote on every click would need a write per tick, would fight
			* the `load()` that follows each save, and would leave the roster disagreeing
			* with the boxes whenever the request failed.
			*
			* Absent means "no unsaved edit here", which is what makes the Save button
			* able to say whether there is anything to save.
			*/
			const [modelDrafts, setModelDrafts] = (0, react.useState)({});
			/** providerId -> the filter typed into that vendor's model list. */
			const [modelQueries, setModelQueries] = (0, react.useState)({});
			const [query, setQuery] = (0, react.useState)("");
			const [category, setCategory] = (0, react.useState)("all");
			/**
			* providerId/modelId -> the last connectivity reading for that pair.
			*
			* Keyed by both because a model id is only unique within its provider: two
			* vendors may well both publish something called `flash`, and a reading taken
			* against one of them must never be shown on the other's row.
			*/
			const [probes, setProbes] = (0, react.useState)({});
			/** The pair currently being measured, so only one button shows a spinner. */
			const [probing, setProbing] = (0, react.useState)(void 0);
			const mounted = (0, react.useRef)(true);
			(0, react.useEffect)(() => () => {
				mounted.current = false;
			}, []);
			/**
			* Ask the host to run one real request against a model, and keep the reading.
			*
			* The pair goes to the route exactly as the row spells it, because the host's
			* adapter registry is the only thing that knows which credential and endpoint
			* a given provider id resolves to. A transport failure is turned into a
			* reading rather than thrown, because "the test did not run" and "the test
			* failed" are both things this row should be able to print.
			*/
			const testModel = (0, react.useCallback)(async (provider, model) => {
				const key = `${provider}/${model}`;
				if (probing !== void 0) return;
				setProbing(key);
				try {
					const response = await fetch(POOL_MODEL_PROBE_PATH, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						credentials: "same-origin",
						body: JSON.stringify({
							provider,
							model
						})
					});
					const reading = await response.json().catch(() => void 0);
					if (mounted.current) setProbes((prev) => ({
						...prev,
						[key]: response.ok && reading !== void 0 && reading.ok === true ? reading : {
							ok: false,
							outputChars: 0,
							error: reading?.error ?? `HTTP ${response.status}`
						}
					}));
				} catch (cause) {
					if (mounted.current) setProbes((prev) => ({
						...prev,
						[key]: {
							ok: false,
							outputChars: 0,
							error: cause instanceof Error ? cause.message : String(cause)
						}
					}));
				} finally {
					if (mounted.current) setProbing(void 0);
				}
			}, [probing]);
			const load = (0, react.useCallback)(async (signal) => {
				try {
					const response = await fetch(POOL_AGGREGATE_PATH, {
						headers: { accept: "application/json" },
						credentials: "same-origin",
						...signal === void 0 ? {} : { signal }
					});
					const value = await response.json().catch(() => void 0);
					if (!response.ok) {
						const detail = value;
						if (mounted.current) setError(detail?.error ?? `HTTP ${response.status}`);
						return;
					}
					if (mounted.current && signal?.aborted !== true) {
						setStatus(value);
						setError(void 0);
					}
				} catch (cause) {
					if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
				}
			}, []);
			(0, react.useEffect)(() => {
				const controller = new AbortController();
				load(controller.signal);
				return () => {
					controller.abort();
				};
			}, [load]);
			/** Post one patch, then re-read the document so the row shows what stuck. */
			const patch = (0, react.useCallback)(async (body) => {
				const key = body.kind === "provider" ? body.providerId : body.kind;
				setBusyIds((prev) => new Set(prev).add(key));
				try {
					const response = await fetch(POOL_AGGREGATE_SAVE_PATH, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						credentials: "same-origin",
						body: JSON.stringify(body)
					});
					if (!response.ok) {
						const detail = await response.json().catch(() => ({}));
						throw new Error(detail.error ?? `HTTP ${response.status}`);
					}
					await load();
					return true;
				} catch (cause) {
					if (mounted.current) {
						const message = cause instanceof Error ? cause.message : String(cause);
						setFlash((prev) => ({
							...prev,
							[key]: `${t?.("agg.actionFailed") ?? "Action failed"}: ${message}`
						}));
					}
					return false;
				} finally {
					if (mounted.current) setBusyIds((prev) => {
						const next = new Set(prev);
						next.delete(key);
						return next;
					});
				}
			}, [load, t]);
			const test = (0, react.useCallback)(async (providerId) => {
				setBusyIds((prev) => new Set(prev).add(providerId));
				try {
					const response = await fetch(POOL_AGGREGATE_TEST_PATH, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						credentials: "same-origin",
						body: JSON.stringify({ providerId })
					});
					const probe = await response.json().catch(() => void 0);
					if (mounted.current && probe !== void 0) {
						const head = response.ok && probe.ok ? t?.("agg.probeOk") ?? "Connected" : t?.("agg.probeFail") ?? "Connection failed";
						setFlash((prev) => ({
							...prev,
							[providerId]: `${head} (HTTP ${probe.status}) ${probe.message}`
						}));
					}
				} finally {
					if (mounted.current) setBusyIds((prev) => {
						const next = new Set(prev);
						next.delete(providerId);
						return next;
					});
				}
			}, [t]);
			const discover = (0, react.useCallback)(async (providerId) => {
				setBusyIds((prev) => new Set(prev).add(providerId));
				try {
					const response = await fetch(POOL_AGGREGATE_DISCOVER_PATH, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						credentials: "same-origin",
						body: JSON.stringify({ providerId })
					});
					const probe = await response.json().catch(() => void 0);
					if (mounted.current && probe !== void 0) {
						const committed = probe.committed ?? 0;
						const line = response.ok && probe.ok ? committed > 0 ? t?.("agg.discovered", { count: committed }) ?? `Wrote ${committed} models` : t?.("agg.discoverEmpty") ?? "That vendor listed no models." : `${t?.("agg.probeFail") ?? "Connection failed"}: ${probe.message}`;
						setFlash((prev) => ({
							...prev,
							[providerId]: line
						}));
						if (response.ok && probe.ok) await load();
					}
				} finally {
					if (mounted.current) setBusyIds((prev) => {
						const next = new Set(prev);
						next.delete(providerId);
						return next;
					});
				}
			}, [load, t]);
			/**
			* The ticked ids for one vendor: the unsaved buffer if there is one, else the
			* server's own `models`.
			*
			* The fallback is `models` and not `availableModels` on purpose. A vendor with
			* no stored choice is exposing its whole roster, so the boxes must start full;
			* reading the roster here and then saving "everything" would be right too, but
			* it would mark every untouched vendor dirty the moment the page opened.
			*/
			const chosenFor = (0, react.useCallback)((provider) => new Set(modelDrafts[provider.id] ?? provider.models), [modelDrafts]);
			const laneBusy = busyIds.has("lane");
			const providers = status?.providers ?? [];
			const laneEnabled = status?.enabled !== false;
			/**
			* How many vendors each filter would show.
			*
			* Counted from the whole roster rather than from the current search, because
			* the buttons ARE the filter: a count that shrank as the user typed would
			* answer a question they did not ask ("how many match what I typed?") instead
			* of the one they did ("how much is in this category?").
			*/
			const categoryCounts = (0, react.useMemo)(() => {
				const counts = /* @__PURE__ */ new Map();
				for (const provider of providers) counts.set(provider.category, (counts.get(provider.category) ?? 0) + 1);
				return counts;
			}, [providers]);
			const visible = (0, react.useMemo)(() => {
				const needle = query.trim().toLowerCase();
				return providers.filter((provider) => {
					if (category !== "all" && provider.category !== category) return false;
					if (needle === "") return true;
					if (provider.name.toLowerCase().includes(needle)) return true;
					if (provider.id.includes(needle)) return true;
					if (provider.notes?.toLowerCase().includes(needle) === true) return true;
					return provider.models.some((model) => model.toLowerCase().includes(needle));
				});
			}, [
				providers,
				query,
				category
			]);
			/** Model ids contributed right now, so a row can say what it is worth. */
			const contributionByProvider = (0, react.useMemo)(() => {
				const counts = /* @__PURE__ */ new Map();
				for (const row of status?.models ?? []) counts.set(row.providerId, (counts.get(row.providerId) ?? 0) + 1);
				return counts;
			}, [status?.models]);
			/**
			* The full model rows each provider contributes, grouped by provider id.
			*
			* The row's model list is a flat id array, so the per-model facts the status
			* document already carries (window, output ceiling, image support) have to be
			* joined back on here. Providers with no rows get an empty list rather than
			* being skipped, so "this vendor is configured but contributes nothing" stays
			* distinguishable from "this vendor is not in the document at all".
			*/
			const modelRowsByProvider = (0, react.useMemo)(() => {
				const grouped = /* @__PURE__ */ new Map();
				for (const row of status?.models ?? []) {
					const bucket = grouped.get(row.providerId);
					if (bucket === void 0) grouped.set(row.providerId, [row]);
					else bucket.push(row);
				}
				return grouped;
			}, [status?.models]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsm-xdpool-agg",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("style", { children: AGGREGATE_CARD_CSS }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(PageHero, {
						title: t?.("agg.title") ?? "Providers",
						sub: t?.("agg.sub") ?? "",
						pills: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsm-xdpool-agg-pill",
							"data-tone": laneEnabled ? "ok" : "off",
							children: t?.("agg.laneOn") ?? "Aggregate lane"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsm-xdpool-agg-pill",
							"data-tone": "info",
							children: t?.("agg.count", {
								providers: status?.configured ?? 0,
								models: status?.modelCount ?? 0
							}) ?? `${status?.configured ?? 0} configured · ${status?.modelCount ?? 0} models`
						})] })
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-xdpool-agg-lanebar",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: "dsm-xdpool-switch",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "checkbox",
								checked: laneEnabled,
								disabled: laneBusy || status === void 0,
								onChange: (event) => {
									patch({
										kind: "lane",
										enabled: event.target.checked
									});
								}
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t?.("agg.laneOn") ?? "Aggregate lane" })]
						}), !laneEnabled ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsm-xdpool-agg-hint",
							children: t?.("agg.laneOffHint") ?? ""
						}) : null]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-xdpool-agg-filter",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							className: "dsm-xdpool-agg-search",
							type: "search",
							value: query,
							placeholder: t?.("agg.search") ?? "Search…",
							onChange: (event) => {
								setQuery(event.target.value);
							}
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsm-xdpool-agg-cats",
							role: "group",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dsm-xdpool-agg-cat",
								"data-on": category === "all" ? "true" : "false",
								onClick: () => {
									setCategory("all");
								},
								children: t?.("agg.catAll", { count: providers.length }) ?? `All categories (${providers.length})`
							}), CATEGORIES.map((value) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dsm-xdpool-agg-cat",
								"data-on": category === value ? "true" : "false",
								onClick: () => {
									setCategory(value);
								},
								children: t?.(CATEGORY_LABEL[value], { count: categoryCounts.get(value) ?? 0 }) ?? `${value} (${categoryCounts.get(value) ?? 0})`
							}, value))]
						})]
					}),
					error !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsm-xdpool-panel-error",
						children: error
					}) : null,
					status === void 0 && error === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsm-xdpool-panel-empty",
						children: "…"
					}) : visible.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsm-xdpool-panel-empty",
						children: t?.("agg.empty") ?? "No vendor matches."
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsm-xdpool-agg-list",
						children: visible.map((provider) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProviderRow, {
							provider,
							contributed: contributionByProvider.get(provider.id) ?? 0,
							modelRows: modelRowsByProvider.get(provider.id) ?? [],
							probes,
							probing,
							busy: busyIds.has(provider.id),
							flash: flash[provider.id],
							draft: drafts[provider.id],
							open: opened[provider.id] === true,
							laneEnabled,
							t,
							onOpen: () => {
								setOpened((prev) => ({
									...prev,
									[provider.id]: prev[provider.id] !== true
								}));
							},
							onDraft: (next) => {
								setDrafts((prev) => ({
									...prev,
									[provider.id]: next
								}));
							},
							onStrategy: (strategy) => {
								patch({
									kind: "provider",
									providerId: provider.id,
									distribution: strategy
								});
							},
							onSave: async () => {
								const draft = drafts[provider.id];
								if (draft === void 0) return;
								const appending = draft.extraKey.trim() === "" ? {} : { appendApiKey: draft.extraKey.trim() };
								if (await patch({
									kind: "provider",
									providerId: provider.id,
									...draft.apiKey === "" ? {} : { apiKey: draft.apiKey },
									...draft.baseUrl === "" ? {} : { baseUrl: draft.baseUrl },
									...appending
								})) {
									setDrafts((prev) => {
										const next = { ...prev };
										delete next[provider.id];
										return next;
									});
									setFlash((prev) => ({
										...prev,
										[provider.id]: t?.("agg.saved") ?? "Saved"
									}));
								}
							},
							onClear: async () => {
								if (await patch({
									kind: "clear",
									providerId: provider.id
								})) {
									setDrafts((prev) => {
										const next = { ...prev };
										delete next[provider.id];
										return next;
									});
									setFlash((prev) => ({
										...prev,
										[provider.id]: t?.("agg.cleared") ?? "Cleared"
									}));
								}
							},
							onToggle: (enabled) => {
								patch({
									kind: "provider",
									providerId: provider.id,
									enabled
								});
							},
							onTest: () => {
								test(provider.id);
							},
							onDiscover: () => {
								discover(provider.id);
							},
							onTestModel: (model) => {
								testModel(provider.id, model);
							},
							chosen: chosenFor(provider),
							onToggleModel: (modelId, on) => {
								setModelDrafts((prev) => {
									const base = prev[provider.id] ?? [...chosenFor(provider)];
									const next = new Set(base);
									if (on) next.add(modelId);
									else next.delete(modelId);
									return {
										...prev,
										[provider.id]: [...next]
									};
								});
							},
							modelQuery: modelQueries[provider.id] ?? "",
							onModelQuery: (value) => {
								setModelQueries((prev) => ({
									...prev,
									[provider.id]: value
								}));
							},
							onEditModels: () => {
								setModelDrafts((prev) => ({
									...prev,
									[provider.id]: [...chosenFor(provider)]
								}));
							},
							onDiscardModels: () => {
								setModelDrafts((prev) => {
									const next = { ...prev };
									delete next[provider.id];
									return next;
								});
							},
							onSelectAllModels: (on) => {
								const roster = isFreeLane(provider.id) || provider.id === "opencode" ? provider.availableModels.filter((id) => isFreeLane(id)) : provider.availableModels;
								setModelDrafts((prev) => ({
									...prev,
									[provider.id]: on ? [...roster] : []
								}));
							},
							onSaveModels: async () => {
								const draft = modelDrafts[provider.id];
								if (draft === void 0) return;
								if (await patch({
									kind: "provider",
									providerId: provider.id,
									models: draft
								})) {
									setModelDrafts((prev) => {
										const next = { ...prev };
										delete next[provider.id];
										return next;
									});
									setFlash((prev) => ({
										...prev,
										[provider.id]: t?.("agg.modelsSaved") ?? "Model selection saved"
									}));
								}
							}
						}, provider.id))
					})
				]
			});
		}
		function ProviderRow({ provider, contributed, modelRows, probes, probing, busy, flash, draft, open, laneEnabled, t, onOpen, onDraft, onSave, onStrategy, onClear, onToggle, onTest, onDiscover, onTestModel, chosen, onToggleModel, modelQuery, onModelQuery, onEditModels, onSelectAllModels, onSaveModels, onDiscardModels }) {
			const enabled = provider.enabled;
			const effective = enabled && laneEnabled;
			const keyState = provider.authKind === "none" ? t?.("agg.noKeyNeeded") ?? "No key needed" : provider.configured ? t?.("agg.keySet") ?? "Key set" : t?.("agg.noKey") ?? "No key";
			const preview = provider.models.slice(0, MODEL_PREVIEW);
			const rest = provider.models.length - preview.length;
			const category = CATEGORY_LABEL[provider.category];
			const icon = channelIcon(provider.id) ?? providerIcon(provider.id);
			const tileMark = icon === void 0 ? { initials: channelInitials(provider.name) } : { icon };
			const paneId = `dsm-xdpool-agg-${provider.id}`;
			/**
			* How many model ids a chooser is worth showing.
			*
			* Below this the list is short enough to read without a filter, and a search
			* box over six entries is noise. Eighty-five is the case this exists for: a
			* free vendor that advertises everything it has, paid rows included.
			*/
			/**
			* Capabilities for one model id, or undefined when it is not being served.
			*
			* `modelRows` carries the registry's declared figures, which is the right
			* answer wherever the registry declares one. Where it declares none — 456 of
			* 504 rows, and every id a "Fetch models" discovered — the row gets nothing
			* invented for it: the local capability table is consulted only for ids it
			* actually covers, and `knownCapabilities` answers `undefined` for the rest
			* rather than falling back to a generic row. A blank beside a real model name
			* is a gap; "128K" that we guessed would be a lie the user cannot see.
			*
			* It is consulted for ids on the keyless free lane and for OpenCode Free,
			* where the same table is the authority the lane itself builds its catalogue
			* from — those ids carry no registry row at all, so this is their best
			* published answer rather than a guess about it.
			*/
			const factsOf = (modelId) => {
				const row = modelRows.find((candidate) => candidate.modelId === modelId);
				if (row === void 0) return void 0;
				const declared = modelFactsFor(row);
				if (declared.contextWindow !== void 0) return declared;
				if (!usesLocalCapabilities(provider)) return declared;
				const local = knownCapabilities(modelId);
				if (local === void 0) return declared;
				return {
					...declared,
					contextWindow: local.contextWindow,
					maxOutputTokens: declared.maxOutputTokens ?? local.maxOutput,
					vision: local.vision,
					...local.reasoning ? { supportedEfforts: [...declared.supportedEfforts ?? ["thinking"]] } : {}
				};
			};
			/**
			* Whether this vendor's rows may fall back to the local capability table.
			*
			* Only the two keyless lanes qualify. Every other vendor has a registry, and a
			* locally-guessed window for a paid id would contradict whatever that vendor
			* actually serves.
			*/
			const usesLocalCapabilities = (vendor) => isFreeLane(vendor.id) || vendor.id === "opencode";
			/**
			* OpenCode's keyless free pool advertises every model it has, paid rows
			* included, and the plugin's own免密 lane is free by construction. For both,
			* the chooser shows only the free rows — the user asked that the free fetch
			* surface free models and nothing else — and the "select all" button is capped
			* to that free roster so it cannot quietly tick a paid id.
			*/
			const freeOnly = usesLocalCapabilities(provider);
			const roster = freeOnly ? provider.availableModels.filter((id) => isFreeLane(id)) : provider.availableModels;
			const rosterSize = roster.length;
			const chooserWorthIt = rosterSize >= MODEL_CHOOSER_THRESHOLD;
			const needle = modelQuery.trim().toLowerCase();
			const listedModels = (chooserWorthIt && needle === "" ? roster : roster.filter((id) => id.toLowerCase().includes(needle))).slice().sort((a, b) => {
				const freeA = isFreeLane(a);
				if (freeA !== isFreeLane(b)) return freeA ? -1 : 1;
				const windowA = factsOf(a)?.contextWindow ?? 0;
				const windowB = factsOf(b)?.contextWindow ?? 0;
				if (windowA !== windowB) return windowB - windowA;
				const visionA = factsOf(a)?.vision === true;
				if (visionA !== (factsOf(b)?.vision === true)) return visionA ? -1 : 1;
				return a.localeCompare(b);
			});
			/**
			* The same roster ranked, joined back onto its registry rows.
			*
			* The fact list below used to walk `modelRows` in whatever order the registry
			* happened to hold, which meant the rows a user reads to judge a vendor were
			* ordered by nothing at all while the picker above them was ordered by
			* capability. Ranking once and deriving both from it keeps the two in step.
			*/
			const sortedModelRows = modelRows.filter((row) => !freeOnly || isFreeLane(row.modelId)).slice().sort((a, b) => {
				const freeA = isFreeLane(a.modelId);
				if (freeA !== isFreeLane(b.modelId)) return freeA ? -1 : 1;
				const windowA = factsOf(a.modelId)?.contextWindow ?? 0;
				const windowB = factsOf(b.modelId)?.contextWindow ?? 0;
				if (windowA !== windowB) return windowB - windowA;
				const visionA = factsOf(a.modelId)?.vision === true;
				if (visionA !== (factsOf(b.modelId)?.vision === true)) return visionA ? -1 : 1;
				return a.modelId.localeCompare(b.modelId);
			});
			/**
			* Whether the boxes differ from what the server is serving right now.
			*
			* Compared as a set, not as a list: the order the buffer holds is whatever
			* order the user clicked in, and a save that only reordered the list must not
			* present itself as a change worth writing.
			*/
			const modelSelectionDirty = chosen.size !== provider.models.length || provider.models.some((id) => !chosen.has(id));
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", {
				className: "dsm-xdpool-agg-row",
				"data-off": effective ? "false" : "true",
				"data-open": open ? "true" : "false",
				style: { "--dsm-xdpool-agg-accent": accentFor(provider.id) },
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-xdpool-agg-rowhead",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(BrandTile, {
								accent: accentFor(provider.id),
								glyph: "globe",
								...tileMark
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsm-xdpool-agg-titles",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsm-xdpool-agg-name",
									children: provider.name
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "dsm-xdpool-agg-org",
									children: [category === void 0 ? provider.category : t?.(category) ?? provider.category, ` · ${provider.format}`]
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-xdpool-agg-state",
								"data-tone": enabled ? "ok" : "off",
								children: enabled ? t?.("agg.stateOn") ?? "In the pool" : t?.("agg.stateOff") ?? "Not in the pool"
							})
						]
					}),
					provider.notes === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsm-xdpool-agg-note",
						children: provider.notes
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-xdpool-agg-foot",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsm-xdpool-agg-tags",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsm-xdpool-agg-tag",
									"data-tone": provider.configured ? "ok" : "off",
									children: keyState
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsm-xdpool-agg-tag",
									"data-tone": "info",
									children: t?.("agg.models", { count: provider.models.length }) ?? `${provider.models.length} models`
								}),
								rosterSize > provider.models.length ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsm-xdpool-agg-tag",
									"data-tone": "busy",
									children: t?.("agg.chosenOf", {
										chosen: provider.models.length,
										total: rosterSize
									}) ?? `${provider.models.length} of ${rosterSize} chosen`
								}) : null,
								contributed > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsm-xdpool-agg-tag",
									"data-tone": "busy",
									children: t?.("agg.contributed", { count: contributed }) ?? `contributes ${contributed} models`
								}) : null,
								provider.discovered ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsm-xdpool-agg-tag",
									"data-tone": "live",
									children: t?.("agg.discoveredTag") ?? "live"
								}) : null,
								provider.hasListing ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsm-xdpool-agg-tag",
									"data-tone": "info",
									children: t?.("agg.listingYes") ?? "Model list available"
								}) : null
							]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: "dsm-xdpool-agg-open",
							"aria-expanded": open,
							"aria-controls": paneId,
							onClick: onOpen,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-xdpool-agg-open-caret",
								"aria-hidden": "true"
							}), open ? t?.("row.collapse") ?? "Collapse" : t?.("agg.setup") ?? "Set up"]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-xdpool-agg-pane",
						id: paneId,
						role: "group",
						hidden: !open,
						children: [
							!provider.supported ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dsm-xdpool-agg-warn",
								children: t?.("agg.unsupported") ?? "This vendor signs in via OAuth/ADC."
							}) : null,
							provider.authKind !== "none" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsm-xdpool-agg-fields",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: "dsm-xdpool-agg-field",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t?.("agg.key") ?? "API key" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										type: "password",
										autoComplete: "off",
										value: draft?.apiKey ?? "",
										placeholder: t?.("agg.keyPlaceholder") ?? "Paste the key",
										onChange: (event) => {
											onDraft({
												apiKey: event.target.value,
												baseUrl: draft?.baseUrl ?? "",
												extraKey: draft?.extraKey ?? ""
											});
										}
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: "dsm-xdpool-agg-field",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t?.("agg.baseUrl") ?? "Endpoint" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										type: "text",
										value: draft?.baseUrl ?? provider.baseUrl ?? "",
										placeholder: t?.("agg.baseUrlPlaceholder") ?? "Blank uses the default",
										onChange: (event) => {
											onDraft({
												apiKey: draft?.apiKey ?? "",
												baseUrl: event.target.value,
												extraKey: draft?.extraKey ?? ""
											});
										}
									})]
								})]
							}) : null,
							provider.authKind === "apiKey" && provider.keyCount >= 1 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsm-xdpool-agg-fields",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: "dsm-xdpool-agg-field",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t?.("agg.extraKey", { count: provider.keyCount }) ?? `Add another key (${String(provider.keyCount)} stored)` }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										type: "password",
										autoComplete: "off",
										value: draft?.extraKey ?? "",
										placeholder: t?.("agg.extraKeyPlaceholder") ?? "Appended after the existing ones",
										onChange: (event) => {
											onDraft({
												apiKey: draft?.apiKey ?? "",
												baseUrl: draft?.baseUrl ?? "",
												extraKey: event.target.value
											});
										}
									})]
								}), provider.keyCount > 1 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: "dsm-xdpool-agg-field",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t?.("row.distTitle") ?? "Account usage" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
										value: provider.distribution ?? "priority",
										disabled: busy,
										onChange: (event) => {
											onStrategy(event.target.value);
										},
										children: DIST_OPTIONS.map((option) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: option,
											children: distLabel(option, t)
										}, option))
									})]
								}) : null]
							}) : null,
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: "dsm-xdpool-switch dsm-xdpool-agg-switch",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "checkbox",
									checked: enabled,
									disabled: busy,
									onChange: (event) => {
										onToggle(event.target.checked);
									}
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t?.("agg.enable") ?? "Add to the pool" })]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-xdpool-agg-hint",
								children: t?.("agg.enableHint") ?? ""
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsm-xdpool-agg-actions",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dsm-btn dsm-btn-primary",
										disabled: busy || !provider.supported,
										onClick: () => {
											onSave();
										},
										children: busy ? t?.("agg.saving") ?? "Saving…" : t?.("agg.save") ?? "Save"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dsm-btn dsm-btn-outline",
										disabled: busy || !provider.supported,
										onClick: () => {
											onTest();
										},
										children: t?.("agg.test") ?? "Test"
									}),
									provider.hasListing ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dsm-btn dsm-btn-outline",
										disabled: busy || !provider.supported || !provider.configured,
										onClick: () => {
											onDiscover();
										},
										children: t?.("agg.discover") ?? "Fetch models"
									}) : null,
									provider.authUrl !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
										className: "dsm-btn dsm-btn-ghost",
										href: provider.authUrl,
										target: "_blank",
										rel: "noreferrer noopener",
										children: t?.("agg.getKey") ?? "Get a key"
									}) : null,
									provider.website !== void 0 && provider.website !== provider.authUrl ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
										className: "dsm-btn dsm-btn-ghost",
										href: provider.website,
										target: "_blank",
										rel: "noreferrer noopener",
										children: t?.("agg.website") ?? "Website"
									}) : null,
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dsm-btn dsm-btn-ghost",
										disabled: busy,
										onClick: () => {
											onClear();
										},
										children: t?.("agg.clear") ?? "Clear"
									})
								]
							}),
							preview.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
								className: "dsm-xdpool-agg-models",
								children: [preview.join(" · "), rest > 0 ? ` +${rest}` : ""]
							}) : null,
							modelRows.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
								className: "dsm-xdpool-agg-facts",
								children: sortedModelRows.map((row) => {
									const key = `${provider.id}/${row.modelId}`;
									const recuse = isFreeLane(row.modelId) ? recommendUse(factsOf(row.modelId)) : void 0;
									return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
										className: "dsm-xdpool-agg-fact",
										"data-live": row.source === "discovered" ? "true" : void 0,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
												className: "dsm-xdpool-agg-fact-name",
												children: [row.name, isFreeLane(row.modelId) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "dsm-xdpool-cpool-tag",
													"data-tone": "free",
													children: t?.("agg.modelFreeTag") ?? "free"
												})]
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModelFactsRow, {
												t,
												facts: modelFactsFor(row),
												...probes[key] === void 0 ? { onTest: () => {
													onTestModel(row.modelId);
												} } : {
													probe: probes[key],
													probing: probing === key
												}
											}),
											recuse === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
												className: "dsm-xdpool-recuse",
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "dsm-xdpool-recuse-label",
													children: t?.("recuse.label") ?? "推荐用途"
												}), recuse]
											})
										]
									}, row.id);
								})
							}) : null,
							rosterSize > MODEL_PREVIEW ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsm-xdpool-agg-picker",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "dsm-xdpool-agg-pickerhead",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "dsm-xdpool-agg-pickerlabel",
											children: t?.("agg.modelPick") ?? "Choose which models this vendor contributes"
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: "dsm-xdpool-btn",
											"data-tone": "quiet",
											onClick: onEditModels,
											children: t?.("agg.editModels") ?? "Choose…"
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: "dsm-xdpool-agg-hint",
										children: t?.("agg.modelPickHint") ?? ""
									}),
									chooserWorthIt || modelQuery !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: "dsm-xdpool-cpool-searchbox",
										type: "search",
										value: modelQuery,
										placeholder: t?.("agg.modelSearch") ?? "Filter models…",
										onChange: (event) => {
											onModelQuery(event.target.value);
										}
									}) : null,
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
										className: "dsm-xdpool-agg-modellist",
										children: listedModels.map((id) => {
											const on = chosen.has(id);
											const recuse = isFreeLane(id) ? recommendUse(factsOf(id)) : void 0;
											return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
												className: "dsm-xdpool-agg-modelrow",
												children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
															type: "checkbox",
															checked: on,
															onChange: (event) => {
																onToggleModel(id, event.target.checked);
															}
														}),
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: "dsm-xdpool-agg-modelid",
															children: id
														}),
														isFreeLane(id) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: "dsm-xdpool-cpool-tag",
															"data-tone": "free",
															children: t?.("agg.modelFreeTag") ?? "free"
														})
													] }),
													factsOf(id) === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModelFactsRow, {
														t,
														facts: factsOf(id) ?? {}
													}),
													recuse === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
														className: "dsm-xdpool-recuse",
														children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: "dsm-xdpool-recuse-label",
															children: t?.("recuse.label") ?? "推荐用途"
														}), recuse]
													})
												]
											}, id);
										})
									}),
									listedModels.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: "dsm-xdpool-agg-hint",
										children: rosterSize === 0 ? t?.("agg.modelNoneAtAll") ?? "This vendor lists no models." : t?.("agg.modelNone") ?? "No model matches that filter."
									}) : null,
									modelSelectionDirty ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "dsm-xdpool-agg-pickeracts",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: "dsm-xdpool-btn",
												"data-tone": "quiet",
												disabled: busy,
												onClick: () => {
													onSelectAllModels(false);
												},
												children: t?.("agg.selectNone") ?? "Clear all"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: "dsm-xdpool-btn",
												"data-tone": "quiet",
												disabled: busy,
												onClick: () => {
													onSelectAllModels(true);
												},
												children: t?.("agg.selectAll") ?? "Select all"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: "dsm-xdpool-btn",
												"data-tone": "quiet",
												disabled: busy,
												onClick: onDiscardModels,
												children: t?.("agg.discardModels") ?? "Discard"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: "dsm-xdpool-btn",
												"data-tone": "primary",
												disabled: busy,
												onClick: () => {
													onSaveModels();
												},
												children: busy ? t?.("agg.savingModels") ?? "Saving…" : t?.("agg.saveModels") ?? "Save models"
											})
										]
									}) : null
								]
							}) : null,
							flash !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dsm-xdpool-agg-flash",
								children: flash
							}) : null
						]
					})
				]
			});
		}
		//#endregion
		//#region src/client/channel-rpc.ts
		/**
		* The pack's management RPC, spoken once for the login page's cards.
		*
		* This used to live inside {@link ./ChannelsPage} as a private function. It
		* stopped being private when the account pool asked the same question the login
		* page already asks — "how many accounts and models does each channel have
		* right now" — because two copies of an envelope parser is one copy too many:
		* they drift, and the drift shows up as a card that reads zero.
		*
		* Everything here is presentation-safe. No method in {@link CHANNEL_PACK_METHODS}
		* returns a credential, and none of these parsers invent a field the pack did not
		* send: an answer we cannot read becomes "not connected", never a guessed zero.
		*
		* @module dsh-xdpool/client/channel-rpc
		*/
		let packRpcBridge;
		/** Capture the client ctx's connection service for {@link callPack}. */
		function installPackRpc(ctx) {
			packRpcContext = ctx;
			packRpcBridge = resolvePackRpcBridge();
		}
		/** The client ctx captured by {@link installPackRpc}, for late resolution. */
		let packRpcContext;
		/**
		* Read `connection.rpc.call` off the captured ctx, or `undefined` if the
		* service is still absent.
		*
		* Each step gets its own try. The host hands the client ctx a Proxy that
		* THROWS on direct property access to an undeclared service
		* (cordis-client-runner's dynamic ctx), and that throw also reports the run as
		* failed — so one shared try/catch would let a rejected `ctx.connection` skip
		* the exempt `ctx.get()` below and silently leave the bridge unset. `?.` does
		* not help: it guards null/undefined, not a throwing getter.
		*/
		function resolvePackRpcBridge() {
			const ctx = packRpcContext;
			if (ctx === void 0 || ctx === null) return void 0;
			let connection;
			try {
				connection = ctx.connection;
			} catch {
				connection = void 0;
			}
			if (connection === void 0 && typeof ctx.get === "function") try {
				connection = ctx.get("connection");
			} catch {
				connection = void 0;
			}
			try {
				const call = connection?.rpc?.call;
				if (typeof call !== "function") return void 0;
				return { call: async (method, payload) => {
					const bound = call.bind(connection);
					const controller = new AbortController();
					const timer = setTimeout(() => controller.abort(), 9e4);
					try {
						return await bound("/api", "channel-pack", {
							method,
							payload
						}, controller.signal);
					} finally {
						clearTimeout(timer);
					}
				} };
			} catch {
				return;
			}
		}
		/**
		* Call the pack's own management route.
		*
		* The bundle registers `/api/channel-pack` itself and speaks a two-field RPC
		* envelope, so this speaks that envelope rather than inventing a shape and
		* unwrapping it on the way back. Every return is an `ok`/`error` decision the
		* caller must make explicitly: a failed login is a normal outcome here, not an
		* exception, and turning it into a thrown error would lose the pack's own
		* message.
		*/
		async function callPack(method, payload) {
			if (packRpcBridge === void 0) packRpcBridge = resolvePackRpcBridge();
			if (packRpcBridge !== void 0) try {
				const result = await packRpcBridge.call(method, payload);
				if (result !== null && typeof result === "object") {
					if (result.ok === true) return {
						ok: true,
						value: result.value
					};
					if (result.ok === false) return {
						ok: false,
						error: { message: result.error?.message ?? result.error?.code ?? "rpc-failed" }
					};
					return result;
				}
				return {
					ok: false,
					error: { message: "rpc-empty" }
				};
			} catch (cause) {
				return {
					ok: false,
					error: { message: cause instanceof Error ? cause.message : String(cause) }
				};
			}
			const response = await fetch(CHANNEL_PACK_RPC_PATH, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "same-origin",
				body: JSON.stringify({
					type: "client-request",
					rpcId: `xdpool-${Date.now().toString(36)}`,
					method: "channel-pack",
					payload: {
						method,
						payload
					}
				})
			});
			const body = await response.json().catch(() => void 0);
			if (body === null || typeof body !== "object") return {
				ok: false,
				error: { message: `HTTP ${response.status}` }
			};
			const message = body.result;
			if (message === null || typeof message !== "object") return {
				ok: false,
				error: { message: `HTTP ${response.status}` }
			};
			return message;
		}
		/** The pack's account id, read defensively — an unidentifiable entry is skipped. */
		function channelIdOf(value) {
			if (value === null || typeof value !== "object") return void 0;
			const id = value.id;
			return typeof id === "string" && id.length > 0 ? id : void 0;
		}
		function createdFrom(envelope) {
			const value = envelope.value;
			if (value === null || typeof value !== "object") return void 0;
			const accountId = value.accountId;
			const loginUrl = value.loginUrl;
			if (typeof accountId !== "string" || typeof loginUrl !== "string" || loginUrl.length === 0) return;
			return {
				accountId,
				loginUrl
			};
		}
		function pollFrom(envelope) {
			const value = envelope.value;
			if (value === null || typeof value !== "object") return { done: false };
			const done = value.done === true;
			const success = value.success;
			const error = value.error;
			return {
				done,
				...typeof success === "boolean" ? { success } : {},
				...typeof error === "string" && error.length > 0 ? { error } : {}
			};
		}
		function accountsFrom(envelope) {
			const value = envelope.value;
			if (value === null || typeof value !== "object") return [];
			const accounts = value.accounts;
			if (!Array.isArray(accounts)) return [];
			const rows = [];
			for (const entry of accounts) {
				const id = channelIdOf(entry);
				if (id === void 0) continue;
				const provider = entry.provider;
				const expiresAt = entry.expiresAt;
				const refreshable = entry.refreshable;
				rows.push({
					id,
					provider: typeof provider === "string" ? provider : "",
					...entry.nickname !== void 0 ? { nickname: String(entry.nickname) } : {},
					...entry.enabled !== void 0 ? { enabled: entry.enabled === true } : {},
					...typeof expiresAt === "number" && Number.isFinite(expiresAt) && expiresAt > 0 ? { expiresAt } : {},
					...refreshable === true ? { refreshable: true } : {}
				});
			}
			return rows;
		}
		function modelFrom(value) {
			if (value === null || typeof value !== "object") return void 0;
			const id = value.id;
			if (typeof id !== "string" || id === "") return void 0;
			const name = value.name;
			const contextWindow = value.contextWindow;
			const nativeContextWindow = value.nativeContextWindow;
			const contextBudget = value.contextBudget;
			const maxTokens = value.maxTokens;
			const modalities = value.inputModalities;
			const description = value.description;
			const disabled = value.disabled;
			const isFree = value.isFree;
			const dead = value.dead;
			const reasoning = value.reasoning;
			return {
				id,
				name: typeof name === "string" && name !== "" ? name : id,
				...disabled === true ? { disabled: true } : {},
				...isFree === true ? { isFree: true } : {},
				...dead === true ? { dead: true } : {},
				...reasoning === true ? { reasoning: true } : {},
				...typeof contextWindow === "number" && Number.isFinite(contextWindow) && contextWindow > 0 ? { contextWindow } : {},
				...typeof nativeContextWindow === "number" && Number.isFinite(nativeContextWindow) && nativeContextWindow > 0 ? { nativeContextWindow } : {},
				...typeof contextBudget === "number" && Number.isFinite(contextBudget) && contextBudget > 0 ? { contextBudget } : {},
				...typeof maxTokens === "number" && Number.isFinite(maxTokens) && maxTokens > 0 ? { maxTokens } : {},
				...Array.isArray(modalities) ? { inputModalities: modalities.filter((item) => typeof item === "string") } : {},
				...typeof description === "string" && description !== "" ? { description } : {}
			};
		}
		/**
		* Read the models off one `model.list` answer.
		*
		* The pack answers a **flat array** for a single provider — `value: { models:
		* [{id, name, disabled, dead}] }` — not a provider-keyed map. Reading it as a
		* map finds no `models.<provider>` key and yields an empty list, which the page
		* renders as "this channel has published no models". That is indistinguishable
		* from the truth, which is why it survived: the symptom was a plausible
		* sentence, not an error.
		*
		* A provider-keyed map is still accepted, because a single-provider query does
		* not need one and an older shape costs nothing to keep reading. Anything else
		* yields nothing — an empty list here means "nothing was readable", never
		* "this channel is empty".
		*/
		function modelsFrom(value) {
			if (value === null || typeof value !== "object") return [];
			const listed = value.models;
			const rows = Array.isArray(listed) ? listed : listed !== null && typeof listed === "object" ? Object.keys(listed).length === 1 ? Object.values(listed)[0] : void 0 : void 0;
			if (!Array.isArray(rows)) return [];
			return rows.map(modelFrom).filter((model) => model !== void 0);
		}
		/**
		* Order model rows the way a picker should read: free first, then the widest
		* window, then vision, then name.
		*
		* ## Why sort at all
		*
		* A vendor's catalogue is ordered by whatever the vendor cared about, which for
		* most of them is marketing chronology. The user reading a channel card is
		* answering "which one do I pick?", and the answers rank as: is it free, how much
		* can I put in it, can I show it a picture.
		*
		* ## Why it is a copy
		*
		* `modelsFrom` hands out the array the page keeps in `useState`, and React keys
		* rows by index — reordering the same array in place would make the checkbox the
		* user just clicked appear to belong to a different model on the next render.
		*/
		function sortChannelModels(models) {
			return [...models].sort((a, b) => {
				if (a.isFree === true !== (b.isFree === true)) return a.isFree === true ? -1 : 1;
				const windowA = a.contextWindow ?? 0;
				const windowB = b.contextWindow ?? 0;
				if (windowA !== windowB) return windowB - windowA;
				const visionA = a.inputModalities?.some((modality) => modality !== "text") === true;
				if (visionA !== (b.inputModalities?.some((modality) => modality !== "text") === true)) return visionA ? -1 : 1;
				return a.name.localeCompare(b.name);
			});
		}
		/**
		* The number worth printing for one account, or `undefined` when there is none.
		*
		* Four answers exist in the field and only two of them are totals:
		* - a bare number (codearts) is already the total;
		* - `{total}` is the total (everyone else);
		* - `{balance}` is Cline's dollars — same shape, different key;
		* - `{packages}` with no total is Gemini's percentage windows, where summing
		*   percentages would be meaningless, so this refuses rather than guessing.
		*/
		function balanceAmount(balance) {
			if (typeof balance === "number") return Number.isFinite(balance) ? balance : void 0;
			if (balance === null || typeof balance !== "object") return void 0;
			const row = balance;
			if (typeof row.total === "number" && Number.isFinite(row.total)) return row.total;
			if (typeof row.balance === "number" && Number.isFinite(row.balance)) return row.balance;
		}
		function balancePackages(balance) {
			if (balance === null || typeof balance !== "object") return [];
			const listed = balance.packages;
			if (!Array.isArray(listed)) return [];
			const rows = [];
			for (const entry of listed) {
				if (entry === null || typeof entry !== "object") continue;
				const name = entry.name;
				if (typeof name !== "string" || name === "") continue;
				const remaining = entry.remaining;
				const total = entry.total;
				const unit = entry.unit;
				rows.push({
					name,
					...typeof remaining === "number" && Number.isFinite(remaining) ? { remaining } : {},
					...typeof total === "number" && Number.isFinite(total) ? { total } : {},
					...typeof unit === "string" && unit !== "" ? { unit } : {}
				});
			}
			return rows;
		}
		function balancesFrom(envelope) {
			const value = envelope.value;
			if (value === null || typeof value !== "object") return [];
			const accounts = value.accounts;
			if (!Array.isArray(accounts)) return [];
			const rows = [];
			for (const entry of accounts) {
				if (entry === null || typeof entry !== "object") continue;
				const accountId = entry.accountId;
				if (typeof accountId !== "string" || accountId === "") continue;
				const nickname = entry.nickname;
				const error = entry.error;
				const extra = entry.extra;
				rows.push({
					accountId,
					...typeof nickname === "string" && nickname !== "" ? { nickname } : {},
					...entry.balance === void 0 ? {} : { balance: entry.balance },
					...typeof error === "string" && error !== "" ? { error } : {},
					...extra !== null && typeof extra === "object" ? { extra } : {},
					...balancePackages(entry.balance).length > 0 ? { packages: balancePackages(entry.balance) } : {}
				});
			}
			return rows;
		}
		function autoCheckinFrom(envelope) {
			const value = envelope.value;
			if (value === null || typeof value !== "object") return void 0;
			const raw = value.autoCheckin;
			if (raw === null || typeof raw !== "object") return void 0;
			const state = raw;
			const channels = state["channels"];
			return {
				enabled: state["enabled"] !== false,
				ranToday: state["ranToday"] === true,
				running: state["running"] === true,
				...typeof state["lastResult"] === "string" && state["lastResult"] !== "" ? { lastResult: state["lastResult"] } : {},
				channels: Array.isArray(channels) ? channels.filter((entry) => entry !== null && typeof entry === "object" && typeof entry.provider === "string" && typeof entry.text === "string").map((entry) => ({
					provider: entry.provider,
					text: entry.text
				})) : []
			};
		}
		/**
		* The host's channel roster — the thirteen scan-login channels, with their
		* display names, accents and login kinds.
		*
		* Both pages that need to reason per channel ask this first: the login page to
		* know what to render, the pool page to know which provider ids are worth
		* asking the pack about. `provider.status` names its answers by provider id, so
		* without this roster there is nothing to hand it.
		*/
		async function fetchChannels() {
			const response = await fetch(POOL_CHANNELS_PATH, {
				headers: { accept: "application/json" },
				credentials: "same-origin"
			});
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const channels = (await response.json().catch(() => void 0))?.channels;
			return Array.isArray(channels) ? channels : [];
		}
		function countOf(value) {
			return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
		}
		function statusFrom(value) {
			if (value === null || typeof value !== "object") return void 0;
			const models = value.models;
			const accounts = value.accounts;
			if (models === null || typeof models !== "object" || accounts === null || typeof accounts !== "object") return;
			const modelsTotal = countOf(models.total);
			return {
				modelsTotal,
				modelsDisabled: Math.min(countOf(models.disabled), modelsTotal),
				accountsTotal: countOf(accounts.total),
				accountsEnabled: countOf(accounts.enabled),
				closed: value.closed === true
			};
		}
		/**
		* Read every channel's counts in one round trip.
		*
		* `provider.status` takes a list and answers a map, so the account pool asks
		* about all thirteen at once rather than thirteen times. A channel the pack
		* omits from the answer is simply absent from the map — the caller then has to
		* decide what "absent" means, and for counts it must not mean zero.
		*/
		function providerStatusesFrom(envelope) {
			const statuses = /* @__PURE__ */ new Map();
			if (!envelope.ok) return statuses;
			const value = envelope.value;
			if (value === null || typeof value !== "object") return statuses;
			const table = value.statuses;
			if (table === null || typeof table !== "object") return statuses;
			for (const [provider, raw] of Object.entries(table)) {
				const status = statusFrom(raw);
				if (status !== void 0) statuses.set(provider, status);
			}
			return statuses;
		}
		/**
		* The host's own model catalogue for the named providers, keyed by provider id.
		*
		* This is the one place a model *description* can come from. The pack's
		* `model.list` keeps only `id`, `name` and two flags — its adapter catalogues
		* carry descriptions and windows internally and `listAllModels()` drops them on
		* the way out — so a card that wants to explain a model has to ask the host,
		* whose catalogue is the same one the model picker reads.
		*
		* A provider missing from the answer was not answered for at all (no adapter
		* under that id, or the host refused). That is deliberately distinct from a
		* provider that answered with an empty list, and the card shows them
		* differently rather than printing "no models" for a provider it never asked
		* about successfully.
		*/
		async function fetchChannelModels(providers, ids) {
			const models = /* @__PURE__ */ new Map();
			if (providers.length === 0) return models;
			const response = await fetch(POOL_CHANNEL_MODELS_PATH, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					accept: "application/json"
				},
				credentials: "same-origin",
				body: JSON.stringify(ids === void 0 ? { providers } : {
					providers,
					ids
				})
			});
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const table = (await response.json().catch(() => void 0))?.models;
			if (table === null || typeof table !== "object") return models;
			for (const [provider, rows] of Object.entries(table)) {
				if (!Array.isArray(rows)) continue;
				models.set(provider, rows);
			}
			return models;
		}
		/**
		* Read a `credits.claimAll` answer, or `undefined` when the pack refused.
		*
		* A refusal is kept as a refusal rather than as zeroes: "claimed 0 of 3" and
		* "this vendor has no check-in" are different sentences and the user acts on
		* them differently. The pack computes this summary itself (`computeClaimSummary`)
		* and also returns per-account `results`; only the summary is read here, so the
		* card cannot disagree with the pack about what a run did.
		*/
		function claimResultFrom(envelope) {
			if (!envelope.ok) return void 0;
			const value = envelope.value;
			if (value === null || typeof value !== "object") return void 0;
			const summary = value.summary;
			if (summary === null || typeof summary !== "object") return void 0;
			const row = summary;
			const count = (key) => {
				const raw = row[key];
				return typeof raw === "number" && Number.isFinite(raw) ? Math.trunc(raw) : 0;
			};
			const token = (row["totalByUnit"] ?? {})["token"];
			return {
				claimed: count("claimed"),
				totalCredit: count("totalCredit"),
				alreadyClaimed: count("alreadyClaimed"),
				inactive: count("inactive"),
				failed: count("failed"),
				unit: typeof token === "number" && Number.isFinite(token) && token > 0 ? "token" : "credit"
			};
		}
		/** Sum the balances the pack could actually read for one channel. */
		function balancesTotal(balances) {
			let total = 0;
			let any = false;
			for (const row of balances) {
				const amount = balanceAmount(row.balance);
				if (amount === void 0) continue;
				total += amount;
				any = true;
			}
			return any ? total : void 0;
		}
		/**
		* Narrow or restore one model's advertised window.
		*
		* `budget === undefined` clears the cap: the pack deletes the key rather than
		* writing 0, so "no cap" keeps exactly one representation in the state file.
		*
		* Rejects a budget at or above the native window instead of sending it. That is
		* not a preference — it would be a silent no-op, and the picker would then show
		* a cap that does nothing. The caller can only offer the two options the pack
		* reports (`nativeContextWindow` and a real cap), so this is a guard, not a
		* policy.
		*/
		async function setChannelModelContextBudget(provider, modelId, budget) {
			const envelope = await callPack("model.setContextBudget", {
				provider,
				modelId,
				...budget === void 0 ? { budget: null } : { budget }
			});
			if (!envelope.ok) return envelope;
			const budgets = envelope.value?.contextBudgets;
			const applied = budgets !== null && typeof budgets === "object" ? budgets[modelId] : void 0;
			return {
				ok: true,
				value: {
					...envelope.value,
					contextBudget: typeof applied === "number" && Number.isFinite(applied) && applied > 0 ? applied : void 0
				}
			};
		}
		//#endregion
		//#region src/client/ChannelsPage.tsx
		/**
		* The login-channel page: the thirteen vendors that sign you in with a browser
		* or a QR code, plus the four plumbing actions the vendored pack exposes for it.
		*
		* Split out of {@link ../client/PoolCard} for the same reason as
		* {@link ./AggregatePage}: it reads a different document and must not ride the
		* pool card's 30-second poll. There is a second reason too — its whole lifecycle
		* is push-driven. A login can take a minute of browser work, so this page owns
		* its own polling and stops it the moment the user leaves.
		*
		* @module dsh-xdpool/client/ChannelsPage
		*/
		/** How often a login in flight is checked, in milliseconds. */
		const POLL_INTERVAL_MS$1 = 2e3;
		/**
		* How long to keep checking before giving up.
		*
		* A scan-and-confirm login is normally seconds; ten minutes covers a phone
		* delay, a wrong first account and a re-read of the terms. Beyond that the user
		* has almost certainly walked away, and polling forever would hold a pending
		* account open for a session nobody is watching.
		*/
		const POLL_TIMEOUT_MS = 6e5;
		const IDLE = { phase: "idle" };
		/**
		* How many distinct people a channel holds.
		*
		* `account.create` in the pack appends unconditionally — it never checks whether
		* an account with the same nickname is already there — so a user who clicks
		* "add account" twice on a channel that reuses one identity ends up with two
		* rows that are the same account. The pack prunes the duplicate on disk at its
		* next mount, but this badge is a live read, so it has to do the collapsing
		* itself or the number is simply wrong.
		*
		* The newest entry wins, because the pack rewrites a placeholder's nickname
		* from its generated id to the real display name only when a login lands: the
		* row that carries the real name is the row whose credential was written last.
		*/
		function distinctAccounts(accounts) {
			const byKey = /* @__PURE__ */ new Map();
			const order = [];
			for (const account of accounts) {
				const nickname = (account.nickname ?? "").trim();
				const key = nickname === "" ? `id:${account.id}` : `n:${nickname}`;
				if (!byKey.has(key)) order.push(key);
				byKey.set(key, account);
			}
			return order.map((key) => byKey.get(key)).filter((account) => account !== void 0);
		}
		function ChannelsPage({ t }) {
			const [status, setStatus] = (0, react.useState)(void 0);
			const [error, setError] = (0, react.useState)(void 0);
			const [ui, setUi] = (0, react.useState)({});
			const [connected, setConnected] = (0, react.useState)([]);
			const mounted = (0, react.useRef)(true);
			/** Timers for in-flight logins, keyed by channel id. */
			const timers = (0, react.useRef)(/* @__PURE__ */ new Map());
			(0, react.useEffect)(() => () => {
				mounted.current = false;
				for (const handle of timers.current.values()) window.clearInterval(handle);
				timers.current.clear();
			}, []);
			const load = (0, react.useCallback)(async (signal) => {
				try {
					const response = await fetch(POOL_CHANNELS_PATH, {
						headers: { accept: "application/json" },
						credentials: "same-origin",
						...signal === void 0 ? {} : { signal }
					});
					const value = await response.json().catch(() => void 0);
					if (!response.ok) {
						const detail = value;
						if (mounted.current) setError(detail?.error ?? `HTTP ${response.status}`);
						return;
					}
					if (mounted.current && signal?.aborted !== true) {
						setStatus(value);
						setError(void 0);
					}
				} catch (cause) {
					if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
				}
			}, []);
			/**
			* Re-read which channels are connected.
			*
			* A failure is swallowed on purpose: this is a decoration on top of the login
			* list, and turning its failure into a panel-wide error would blank the page
			* for something the user did not ask about. The connected badges are the
			* first thing to go and the last to be missed.
			*/
			const loadConnected = (0, react.useCallback)(async () => {
				const roster = await fetchChannels();
				const statuses = providerStatusesFrom(await callPack("provider.status", { providers: roster.map((channel) => channel.id) }));
				const connectedIds = roster.map((channel) => channel.id).filter((id) => (statuses.get(id)?.accountsTotal ?? 0) > 0);
				const perChannel = await Promise.all(connectedIds.map((id) => callPack("account.list", { provider: id })));
				if (!mounted.current) return;
				setConnected(perChannel.flatMap(accountsFrom));
			}, []);
			(0, react.useEffect)(() => {
				const controller = new AbortController();
				load(controller.signal);
				loadConnected().catch(() => {});
				return () => {
					controller.abort();
				};
			}, [load, loadConnected]);
			const connectedFor = (0, react.useCallback)((channel) => distinctAccounts(connected.filter((account) => account.provider === channel.id && account.enabled !== false)), [connected]);
			const stopPolling = (0, react.useCallback)((channelId) => {
				const handle = timers.current.get(channelId);
				if (handle !== void 0) window.clearInterval(handle);
				timers.current.delete(channelId);
			}, []);
			/**
			* Watch one login until it lands, gives up, or times out.
			*
			* The interval is scheduled inside a single function and re-arms itself, so
			* one slow response can never produce two collectors for the same account —
			* which would show the same channel twice and could claim its completion
			* twice.
			*/
			const watch = (0, react.useCallback)((channel, accountId, startedAt) => {
				stopPolling(channel.id);
				const tick = async () => {
					if (!mounted.current) return stopPolling(channel.id);
					if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
						stopPolling(channel.id);
						setUi((prev) => ({
							...prev,
							[channel.id]: {
								phase: "failed",
								accountId,
								message: t?.("chan.failed") ?? "Sign-in failed"
							}
						}));
						return;
					}
					let envelope;
					try {
						envelope = await callPack("login.poll", {
							provider: channel.id,
							accountId
						});
					} catch (cause) {
						return;
					}
					if (!mounted.current) return;
					if (!envelope.ok) return;
					const answer = pollFrom(envelope);
					if (!answer.done) return;
					stopPolling(channel.id);
					if (answer.success === false) {
						setUi((prev) => ({
							...prev,
							[channel.id]: {
								phase: "failed",
								accountId,
								message: answer.error ?? t?.("chan.failed") ?? "Sign-in failed"
							}
						}));
						return;
					}
					setUi((prev) => ({
						...prev,
						[channel.id]: {
							phase: "done",
							accountId
						}
					}));
					loadConnected().catch(() => {});
				};
				timers.current.set(channel.id, window.setInterval(() => {
					tick();
				}, POLL_INTERVAL_MS$1));
			}, [
				loadConnected,
				stopPolling,
				t
			]);
			const signIn = (0, react.useCallback)(async (channel) => {
				setUi((prev) => ({
					...prev,
					[channel.id]: { phase: "signing-in" }
				}));
				let envelope;
				try {
					envelope = await callPack("account.create", { provider: channel.id });
				} catch (cause) {
					if (!mounted.current) return;
					const message = cause instanceof Error ? cause.message : String(cause);
					setUi((prev) => ({
						...prev,
						[channel.id]: {
							phase: "failed",
							message
						}
					}));
					return;
				}
				if (!mounted.current) return;
				if (!envelope.ok) {
					setUi((prev) => ({
						...prev,
						[channel.id]: {
							phase: "failed",
							message: envelope.error?.message ?? t?.("chan.failed") ?? "Sign-in failed"
						}
					}));
					return;
				}
				const created = createdFrom(envelope);
				if (created === void 0) {
					setUi((prev) => ({
						...prev,
						[channel.id]: {
							phase: "failed",
							message: t?.("chan.failed") ?? "Sign-in failed"
						}
					}));
					return;
				}
				window.open(created.loginUrl, "_blank", "noopener");
				setUi((prev) => ({
					...prev,
					[channel.id]: {
						phase: "signing-in",
						accountId: created.accountId,
						loginUrl: created.loginUrl,
						message: t?.("chan.waiting")
					}
				}));
				watch(channel, created.accountId, Date.now());
			}, [t, watch]);
			const cancel = (0, react.useCallback)((channelId) => {
				stopPolling(channelId);
				setUi((prev) => ({
					...prev,
					[channelId]: IDLE
				}));
			}, [stopPolling]);
			/**
			* Channels with at least one account, not accounts in total.
			*
			* The hero pill counts connections — "six channels are hooked up" is the
			* question that pill has always answered, and a second pill counting accounts
			* would compete with the per-channel badges that already do it.
			*/
			const connectedCount = (0, react.useMemo)(() => new Set(connected.map((account) => account.provider)).size, [connected]);
			/**
			* One switch for every channel, because that is the only granularity the pack
			* offers: its auto check-in run targets each provider that holds an account
			* and claims through one path, with no per-provider switch to set. Drawing
			* thirteen toggles that all drove the same boolean would be thirteen ways to
			* be wrong; the state is read back from the pack rather than assumed, so the
			* switch shows what the last run will actually do.
			*/
			const [autoCheckin, setAutoCheckin] = (0, react.useState)(void 0);
			const [autoBusy, setAutoBusy] = (0, react.useState)(false);
			const loadAutoCheckin = (0, react.useCallback)(async () => {
				try {
					const envelope = await callPack("usage.autoCheckin", {});
					if (!mounted.current) return;
					setAutoCheckin(autoCheckinFrom(envelope));
				} catch {}
			}, []);
			(0, react.useEffect)(() => {
				loadAutoCheckin();
			}, [loadAutoCheckin]);
			const toggleAutoCheckin = (0, react.useCallback)(async () => {
				const next = autoCheckin?.enabled === true ? false : true;
				setAutoBusy(true);
				try {
					const envelope = await callPack("usage.autoCheckin", { enabled: next });
					if (!mounted.current) return;
					setAutoCheckin(autoCheckinFrom(envelope));
				} catch (cause) {
					if (!mounted.current) return;
					setError(cause instanceof Error ? cause.message : String(cause));
				} finally {
					if (mounted.current) setAutoBusy(false);
				}
			}, [autoCheckin]);
			const state = status?.state ?? "pending";
			const channels = status?.channels ?? [];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsm-xdpool-channels",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("style", { children: CHANNEL_CARD_CSS }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(PageHero, {
						title: t?.("chan.title") ?? "Login channels",
						sub: t?.("chan.sub") ?? "",
						pills: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsm-xdpool-pill",
							"data-tone": connectedCount > 0 ? "ok" : "off",
							children: t?.("chan.connectedCount", { count: connectedCount }) ?? `${connectedCount} connected`
						})
					}),
					autoCheckin !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-xdpool-autocheckin",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: "dsm-xdpool-switch",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "checkbox",
								checked: autoCheckin.enabled,
								disabled: autoBusy || autoCheckin.running,
								onChange: () => {
									toggleAutoCheckin();
								}
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t?.("chan.autoCheckin") ?? "Claim daily credits automatically" })]
						}), autoCheckin.lastResult !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsm-xdpool-autocheckin-note",
							children: autoCheckin.lastResult
						})]
					}),
					error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsm-xdpool-panel-error",
						children: error
					}),
					state === "pending" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsm-xdpool-panel-empty",
						children: t?.("chan.pending")
					}),
					state === "unavailable" && status?.reason === "already-mounted-elsewhere" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsm-xdpool-panel-empty",
						children: t?.("chan.ownedElsewhere") ?? "Another plugin already serves these login channels."
					}),
					state === "unavailable" && status?.reason !== "already-mounted-elsewhere" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						className: "dsm-xdpool-panel-error",
						children: [t?.("chan.unavailable"), status?.reason !== void 0 ? ` (${status.reason})` : ""]
					}),
					state === "ready" && channels.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsm-xdpool-panel-empty",
						children: t?.("chan.empty")
					}),
					channels.map((channel) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ChannelRow, {
						channel,
						t,
						ui: ui[channel.id] ?? IDLE,
						connectedCount: connectedFor(channel).length,
						onSignIn: () => {
							signIn(channel);
						},
						onCancel: () => cancel(channel.id)
					}, channel.id))
				]
			});
		}
		function ChannelRow({ channel, t, ui, connectedCount, onSignIn, onCancel }) {
			const busy = ui.phase === "signing-in";
			const icon = channelIcon(channel.id);
			const tileMark = icon === void 0 ? { initials: channelInitials(channel.name) } : { icon };
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsm-xdpool-channel",
				style: { "--dsm-xdpool-channel-accent": channel.accent },
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-xdpool-channel-head",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(BrandTile, {
								accent: channel.accent,
								glyph: "login",
								...tileMark
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-xdpool-channel-name",
								children: channel.name
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-xdpool-channel-org",
								children: channel.org
							}),
							connectedCount > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-xdpool-channel-tag",
								children: t?.("chan.connected", { count: connectedCount }) ?? "Connected"
							})
						]
					}),
					channel.note !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsm-xdpool-channel-note",
						children: channel.note
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsm-xdpool-channel-actions",
						children: busy ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-xdpool-channel-waiting",
								children: ui.message ?? t?.("chan.signingIn") ?? "Waiting for sign-in…"
							}),
							ui.loginUrl !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
								className: "dsm-xdpool-btn",
								href: ui.loginUrl,
								target: "_blank",
								rel: "noopener noreferrer",
								children: t?.("chan.openLogin") ?? "Open the sign-in page"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dsm-xdpool-btn",
								onClick: onCancel,
								children: t?.("agg.clear") ?? "Cancel"
							})
						] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dsm-xdpool-btn",
								onClick: onSignIn,
								children: t?.("chan.login") ?? "Add account"
							}),
							channel.smsHint === true && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-xdpool-channel-hint",
								children: t?.("chan.loginSmsHint") ?? ""
							}),
							ui.phase === "done" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-xdpool-channel-ok",
								children: t?.("chan.done") ?? "Account added"
							}),
							ui.phase === "failed" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-xdpool-channel-error",
								children: ui.message ?? t?.("chan.failed") ?? "Sign-in failed"
							})
						] })
					})
				]
			});
		}
		//#endregion
		//#region src/client/RoutingPage.tsx
		/**
		* The routing page: chains that are themselves models.
		*
		* A chain reads as one model id to the picker (`combo:<slug>`), and at call time
		* it is tried member by member until one answers. The point of the page is to
		* make ORDER visible and editable — order is the whole semantics, so members
		* render as a numbered list and never as an unordered set of tags.
		*
		* Split out of {@link ./PoolCard} for the same reason as the aggregate page: it
		* reads its own document (`POOL_COMBOS_PATH`) and must not ride the pool card's
		* 30-second poll, because a routing document only changes when this page writes
		* it.
		*
		* Two deliberate honesty choices, both about not lying to the user:
		*
		* 1. A member the roster lost is shown, not silently dropped. The server keeps
		*    the chain verbatim and reports the unresolved ids; the panel prints them.
		*    Dropping them would make the panel look correct while a different model
		*    quietly answered.
		* 2. `missing` is only a WARNING, never a block on saving. The user may be
		*    configuring a chain for a key they intend to paste in next. Refusing the
		*    save would be a worse lie than the warning.
		*
		* @module dsh-xdpool/client/RoutingPage
		*/
		/**
		* Flatten a draft into the member ids the server stores.
		*
		* Platform order first, then model order within each platform. Duplicates are
		* dropped: the same pair twice would spend two attempts on one endpoint and report
		* a fallback that never happened. A pool model is its bare id; anything else is
		* `owner/model`, the same composite id the aggregate catalog publishes.
		*/
		function flattenDraft(platforms) {
			const out = [];
			const seen = /* @__PURE__ */ new Set();
			for (const platform of platforms) for (const model of platform.models) {
				const id = platform.owner === "workbuddy" ? model : `${platform.owner}/${model}`;
				if (seen.has(id)) continue;
				seen.add(id);
				out.push(id);
			}
			return out;
		}
		function draftOf(combo) {
			/**
			* `missing` members are kept, grouped under their own owner, so the editor shows
			* the chain the user actually configured rather than the shorter one the roster
			* can serve right now. Dropping them would make a save silently delete members
			* the user never asked to remove — the "保存了没法用" class of data loss.
			*/
			const platforms = combo.platforms.map((group) => ({
				owner: group.owner,
				models: [...group.models]
			}));
			const known = new Set(combo.models);
			for (const modelId of combo.missing) {
				if (known.has(modelId)) continue;
				const slash = modelId.indexOf("/");
				const owner = slash === -1 ? "workbuddy" : modelId.slice(0, slash);
				const model = slash === -1 ? modelId : modelId.slice(slash + 1);
				const group = platforms.find((entry) => entry.owner === owner);
				if (group === void 0) platforms.push({
					owner,
					models: [model]
				});
				else if (!group.models.includes(model)) group.models.push(model);
			}
			return {
				key: combo.id,
				id: combo.id,
				name: combo.name,
				platforms,
				flat: [...combo.models, ...combo.missing.filter((id) => !combo.models.includes(id))],
				strategy: combo.strategy,
				stickyLimit: combo.stickyLimit,
				enabled: combo.enabled
			};
		}
		function blankDraft() {
			return {
				key: `new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
				name: "",
				platforms: [],
				flat: [],
				strategy: "fallback",
				stickyLimit: 1,
				enabled: true
			};
		}
		/** Compact counts: 1_260_000 -> "1.3M". Chains quote context windows, so this is load-bearing. */
		function compact(value) {
			if (value >= 1e6) return `${Math.round(value / 1e5) / 10}M`;
			if (value >= 1e3) return `${Math.round(value / 100) / 10}K`;
			return String(value);
		}
		function RoutingPage({ t }) {
			const [status, setStatus] = (0, react.useState)(void 0);
			const [error, setError] = (0, react.useState)(void 0);
			const [flash, setFlash] = (0, react.useState)(void 0);
			const [drafts, setDrafts] = (0, react.useState)([]);
			const [saving, setSaving] = (0, react.useState)(false);
			/** Key of the chain being edited, or `undefined` when nothing is open. */
			const [editing, setEditing] = (0, react.useState)(void 0);
			/** Model id chosen in the add-member row. */
			const [picked, setPicked] = (0, react.useState)("");
			/** True once the drafts were seeded from the server, so later polls don't stomp edits. */
			const seeded = (0, react.useRef)(false);
			const mounted = (0, react.useRef)(true);
			(0, react.useEffect)(() => () => {
				mounted.current = false;
			}, []);
			const load = (0, react.useCallback)(async (signal) => {
				try {
					const response = await fetch(POOL_COMBOS_PATH, {
						headers: { accept: "application/json" },
						credentials: "same-origin",
						...signal === void 0 ? {} : { signal }
					});
					const value = await response.json().catch(() => void 0);
					if (!response.ok) {
						const detail = value;
						if (mounted.current) setError(detail?.error ?? `HTTP ${response.status}`);
						return;
					}
					if (mounted.current && signal?.aborted !== true) {
						const next = value;
						setStatus(next);
						setError(void 0);
						if (!seeded.current) {
							seeded.current = true;
							setDrafts((next.combos ?? []).map(draftOf));
						}
					}
				} catch (cause) {
					if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
				}
			}, []);
			(0, react.useEffect)(() => {
				const controller = new AbortController();
				load(controller.signal);
				return () => {
					controller.abort();
				};
			}, [load]);
			const combos = status?.combos ?? [];
			const candidates = status?.candidates ?? [];
			const candidateById = (0, react.useMemo)(() => {
				const map = /* @__PURE__ */ new Map();
				for (const candidate of candidates) map.set(candidate.id, candidate);
				return map;
			}, [candidates]);
			const roster = (0, react.useMemo)(() => candidates.filter((candidate) => candidate.id !== "workbuddy"), [candidates]);
			const current = drafts.find((draft) => draft.key === editing);
			const patchDraft = (0, react.useCallback)((changes) => {
				setDrafts((prev) => prev.map((draft) => draft.key === editing ? {
					...draft,
					...changes
				} : draft));
			}, [editing]);
			const save = (0, react.useCallback)(async () => {
				setSaving(true);
				try {
					const response = await fetch(POOL_COMBOS_SAVE_PATH, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						credentials: "same-origin",
						body: JSON.stringify({ combos: drafts.map((draft) => ({
							...draft.id === void 0 ? {} : { id: draft.id },
							name: draft.name,
							platforms: draft.platforms.map((group) => ({
								owner: group.owner,
								models: group.models
							})),
							models: draft.flat,
							strategy: draft.strategy,
							stickyLimit: draft.stickyLimit,
							enabled: draft.enabled
						})) })
					});
					if (!response.ok) {
						const detail = await response.json().catch(() => ({}));
						if (mounted.current) setFlash(`${t?.("route.saveFailed") ?? "Could not save"}: ${detail.error ?? `HTTP ${response.status}`}`);
						return;
					}
					if (!mounted.current) return;
					const next = await response.json().catch(() => void 0);
					setStatus(next);
					setDrafts((next.combos ?? []).map(draftOf));
					setFlash(t?.("route.saved") ?? "Saved");
					setEditing(void 0);
				} catch (cause) {
					if (mounted.current) setFlash(`${t?.("route.saveFailed") ?? "Could not save"}: ${cause instanceof Error ? cause.message : String(cause)}`);
				} finally {
					if (mounted.current) setSaving(false);
				}
			}, [drafts, t]);
			const addChain = (0, react.useCallback)(() => {
				const draft = blankDraft();
				setDrafts((prev) => [...prev, draft]);
				setEditing(draft.key);
			}, []);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsm-xdpool-rt",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("style", { children: ROUTING_CARD_CSS }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(PageHero, {
						title: t?.("route.title") ?? "Routing",
						sub: t?.("route.sub") ?? "",
						pills: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsm-xdpool-pill",
							"data-tone": "ok",
							children: t?.("route.memberCount", { count: combos.length }) ?? `${combos.length} chain(s)`
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsm-xdpool-pill",
							"data-tone": "off",
							children: t?.("route.rosterCount", { count: candidates.length }) ?? `${candidates.length} model(s)`
						})] })
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-xdpool-rt-new",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsm-xdpool-rt-hint",
							children: t?.("route.idHint") ?? ""
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dsm-btn dsm-btn-primary",
							onClick: addChain,
							children: t?.("route.newChain") ?? "New chain"
						})]
					}),
					error !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsm-xdpool-panel-error",
						children: error
					}) : null,
					flash !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsm-xdpool-rt-flash",
						children: flash
					}) : null,
					status === void 0 && error === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsm-xdpool-panel-empty",
						children: t?.("route.loading") ?? "Reading…"
					}) : null,
					current !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ChainEditor, {
						draft: current,
						roster,
						busy: saving,
						candidateById,
						t,
						onChange: patchDraft
					}) : null,
					status === void 0 ? null : drafts.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsm-xdpool-panel-empty",
						children: t?.("route.empty") ?? "No chain yet."
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-xdpool-rt-list",
						children: [drafts.map((draft) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ChainRow, {
							draft,
							editable: draft.key === editing,
							candidateById,
							t,
							onEdit: () => {
								setEditing(draft.key);
							},
							onDelete: () => {
								setDrafts((prev) => prev.filter((entry) => entry !== draft));
								if (editing === draft.key) setEditing(void 0);
							}
						}, draft.key)), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dsm-xdpool-rt-actions",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dsm-btn dsm-btn-primary",
								disabled: saving,
								onClick: () => {
									save();
								},
								children: saving ? t?.("route.saving") ?? "Saving…" : t?.("route.save") ?? "Save chains"
							})
						})]
					})
				]
			});
		}
		/**
		* One chain row.
		*
		* Members are rendered from the DRAFT, not from the server's `models` list, and
		* the draft carries `missing` ids too. That is what lets the panel show a member
		* the roster lost instead of quietly presenting a shorter chain than the user
		* typed.
		*/
		function ChainRow({ draft, editable, candidateById, t, onEdit, onDelete }) {
			/**
			* Members the roster cannot serve right now, computed from the FLATTENED draft.
			*
			* Flattened rather than read off the groups, so the check matches what would be
			* saved: a group holds bare ids and the roster holds composite ones, and
			* comparing the two shapes directly would mark every aggregate member missing.
			*/
			const flat = draft.flat;
			const missing = flat.filter((model) => candidateById.has(model) === false);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsm-xdpool-rt-row",
				"data-off": draft.enabled ? "false" : "true",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-xdpool-rt-rowhead",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-xdpool-rt-name",
								children: draft.name === "" ? t?.("route.newChain") ?? "New chain" : draft.name
							}),
							draft.id !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-xdpool-rt-cid",
								children: draft.id
							}) : null,
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-xdpool-pill",
								"data-tone": draft.enabled ? "ok" : "off",
								children: draft.enabled ? t?.("route.enabled") ?? "Enabled" : t?.("route.chainDisabled") ?? "Disabled"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "dsm-xdpool-pills",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsm-xdpool-pill",
									"data-tone": "off",
									children: t?.("route.platformCount", { count: draft.platforms.length }) ?? `${draft.platforms.length} platform(s)`
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsm-xdpool-pill",
									"data-tone": "off",
									children: t?.("route.memberCount", { count: flat.length }) ?? `${flat.length} model(s)`
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "dsm-xdpool-pageactions",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dsm-btn dsm-btn-outline",
									onClick: onEdit,
									children: editable ? t?.("route.editOpen") ?? "Editing" : t?.("route.edit") ?? "Edit"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dsm-xdpool-rt-drop",
									onClick: onDelete,
									children: t?.("route.removeMember") ?? "Remove"
								})]
							})
						]
					}),
					draft.platforms.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsm-xdpool-rt-warn",
						children: t?.("route.noMembers") ?? "Add at least one member."
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ol", {
						className: "dsm-xdpool-rt-lanes",
						children: draft.platforms.map((platform, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
							className: "dsm-xdpool-rt-lane",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsm-xdpool-rt-ord",
									children: index + 1
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsm-xdpool-rt-lanename",
									title: platform.owner,
									children: ownerName(platform.owner, t)
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "dsm-xdpool-rt-lanecount",
									children: ["· ", platform.models.length]
								})
							]
						}, `${platform.owner}-${index}`))
					}),
					missing.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsm-xdpool-rt-warn",
						children: t?.("route.missing", { models: missing.join(", ") }) ?? missing.join(", ")
					}) : null
				]
			});
		}
		/**
		* A readable name for one platform.
		*
		* `workbuddy` is this plugin's own pool lane, so it gets the product name the cards
		* use. Every other owner IS a provider id, and it is printed as-is: the aggregate
		* page, the model picker and this page then show one spelling for one channel, and
		* inventing a second one here would make the same vendor look like two.
		*/
		function ownerName(owner, t) {
			if (owner === "workbuddy") return t?.("route.ownerPool") ?? "XD Pool（WorkBuddy）";
			return owner;
		}
		/**
		* The model id WITHOUT its provider prefix.
		*
		* A candidate's id is the composite the picker and the aggregate catalog use
		* (`provider/model`), while a platform group stores bare ids — the owner sits in the
		* field beside them, so carrying the prefix in both would let the two disagree. A
		* pool candidate's id is already bare (`hy3`), which is why this checks the prefix
		* instead of always slicing.
		*/
		function bareModelOf(candidate) {
			const prefix = `${candidate.owner}/`;
			return candidate.id.startsWith(prefix) ? candidate.id.slice(prefix.length) : candidate.id;
		}
		/**
		* The editor for exactly one chain — TWO LEVELS, like the router walks it.
		*
		* Platform order first, then model order inside each platform. That is the
		* documented fallback semantics ("same platform: try the next model; platform
		* exhausted: the next platform"), and it is the shape a reader thinks in. The
		* previous editor was a single flat list of model ids, which could express the same
		* sequence but could not SHOW the grouping — so moving "all of WorkBuddy's models
		* together" meant clicking one at a time and hoping none was missed, and the
		* platform boundaries had to be re-derived by eye from the ids.
		*
		* Each platform card carries its own controls (up / down / remove, and the same for
		* every model inside it), which is why the pickers are local state: a chain can have
		* a dozen platforms open at once and one shared "picked" slot would make selecting a
		* model in one card silently change what another card was about to add.
		*/
		function ChainEditor({ draft, roster, busy, candidateById, t, onChange }) {
			/**
			* One pending selection per platform, keyed by owner, plus one for the
			* "add platform" row. Local because it is transient editor state: it must not
			* travel into the draft, or an unsaved picker value would be saved as part of the
			* chain and reappear on the next open.
			*/
			const [pickByLane, setPickByLane] = (0, react.useState)({});
			const [pickLane, setPickLane] = (0, react.useState)("");
			/** Owners already in the chain — a platform appears at most once. */
			const used = draft.platforms.map((platform) => platform.owner);
			/**
			* Platforms still available to add, with how many models each could offer.
			*
			* Counted from the roster so the dropdown says what it is worth adding: an empty
			* platform would produce a card with nothing to put in it.
			*/
			const addable = (0, react.useMemo)(() => {
				const counts = /* @__PURE__ */ new Map();
				for (const candidate of roster) {
					if (used.includes(candidate.owner)) continue;
					counts.set(candidate.owner, (counts.get(candidate.owner) ?? 0) + 1);
				}
				return [...counts.entries()].map(([owner, count]) => ({
					owner,
					count
				}));
			}, [roster, used.join("\0")]);
			/**
			* Apply one platform edit and RECOMPUTE `flat` from the new structure.
			*
			* Every path that changes the platform shape goes through here, so `flat` is only
			* ever re-derived as the direct result of a user action — never on render. That is
			* the difference between "the editor reorders what I asked it to" and "saving an
			* untouched chain silently rewrote my fallback order".
			*/
			const commit = (platforms) => {
				onChange({
					platforms,
					flat: flattenDraft(platforms)
				});
			};
			const patchLane = (index, update) => {
				commit(draft.platforms.map((platform, at) => at === index ? {
					...platform,
					...update
				} : platform));
			};
			const moveLane = (index, delta) => {
				const next = [...draft.platforms];
				const target = index + delta;
				if (target < 0 || target >= next.length) return;
				const [moved] = next.splice(index, 1);
				if (moved === void 0) return;
				next.splice(target, 0, moved);
				commit(next);
			};
			const dropLane = (index) => {
				commit(draft.platforms.filter((_, at) => at !== index));
			};
			/** Models of one owner that are not in this platform's group yet. */
			const candidatesFor = (owner, group) => roster.filter((candidate) => candidate.owner === owner && !group.models.includes(bareModelOf(candidate)));
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsm-xdpool-rt-editor",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-xdpool-rt-editorhead",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsm-xdpool-rt-edname",
							children: draft.name === "" ? t?.("route.newChain") ?? "New chain" : draft.name
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: "dsm-xdpool-switch",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "checkbox",
								checked: draft.enabled,
								onChange: (event) => {
									onChange({ enabled: event.target.checked });
								}
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t?.("route.enabled") ?? "Enabled" })]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-xdpool-rt-fields",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: "dsm-xdpool-rt-field",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t?.("route.chainName") ?? "Chain name" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "text",
									value: draft.name,
									placeholder: t?.("route.chainNamePlaceholder") ?? "",
									onChange: (event) => {
										onChange({ name: event.target.value });
									}
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: "dsm-xdpool-rt-field",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t?.("route.strategy") ?? "Strategy" }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
									value: draft.strategy,
									onChange: (event) => {
										onChange({ strategy: event.target.value === "round-robin" ? "round-robin" : "fallback" });
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "fallback",
										children: t?.("route.strategyFallback") ?? "Fallback"
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "round-robin",
										children: t?.("route.strategyRoundRobin") ?? "Round robin"
									})]
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: "dsm-xdpool-rt-field",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t?.("route.stickyLimit") ?? "Turns per member" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "number",
									min: 1,
									value: draft.stickyLimit,
									onChange: (event) => {
										const parsed = Number.parseInt(event.target.value, 10);
										onChange({ stickyLimit: Number.isFinite(parsed) && parsed > 0 ? parsed : 1 });
									}
								})]
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsm-xdpool-rt-hint",
						children: t?.("route.stickyHint") ?? ""
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsm-xdpool-rt-hint",
						children: t?.("route.platformOrder") ?? "Platform order (higher is tried first)"
					}),
					draft.platforms.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsm-xdpool-rt-warn",
						children: t?.("route.noMembers") ?? "Add at least one member."
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsm-xdpool-rt-laneboxes",
						children: draft.platforms.map((platform, index) => {
							const group = { models: platform.models };
							const choices = candidatesFor(platform.owner, group);
							const picked = pickByLane[platform.owner] ?? "";
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsm-xdpool-rt-lanebox",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "dsm-xdpool-rt-lanebox-head",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "dsm-xdpool-rt-ord",
												children: index + 1
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "dsm-xdpool-rt-lanebox-name",
												children: ownerName(platform.owner, t)
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "dsm-xdpool-rt-cid",
												children: platform.owner
											})
										]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "dsm-xdpool-rt-laneacts",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: "dsm-xdpool-rt-drop",
												disabled: index === 0,
												onClick: () => {
													moveLane(index, -1);
												},
												children: t?.("route.moveUp") ?? "Up"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: "dsm-xdpool-rt-drop",
												disabled: index === draft.platforms.length - 1,
												onClick: () => {
													moveLane(index, 1);
												},
												children: t?.("route.moveDown") ?? "Down"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: "dsm-xdpool-rt-drop",
												onClick: () => {
													dropLane(index);
												},
												children: t?.("route.removePlatform") ?? "Remove"
											})
										]
									}),
									platform.models.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: "dsm-xdpool-rt-hint",
										children: t?.("route.platformNoModels") ?? "No model added to this platform yet."
									}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ol", {
										className: "dsm-xdpool-rt-members",
										children: platform.models.map((model, modelIndex) => {
											const fullId = platform.owner === "workbuddy" ? model : `${platform.owner}/${model}`;
											const candidate = candidateById.get(fullId);
											return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
												className: "dsm-xdpool-rt-member",
												children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: "dsm-xdpool-rt-ord",
														children: modelIndex + 1
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: "dsm-xdpool-rt-mid",
														title: fullId,
														children: model
													}),
													candidate === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: "dsm-xdpool-agg-tag dsm-xdpool-rt-mtag",
														"data-tone": "busy",
														children: t?.("route.unusable") ?? "needs a key"
													}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: "dsm-xdpool-agg-tag dsm-xdpool-rt-mtag",
														"data-tone": "ok",
														children: compact(candidate.contextWindow)
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
														type: "button",
														className: "dsm-xdpool-rt-drop",
														disabled: modelIndex === 0,
														onClick: () => {
															const next = [...platform.models];
															const [moved] = next.splice(modelIndex, 1);
															if (moved === void 0) return;
															next.splice(modelIndex - 1, 0, moved);
															patchLane(index, { models: next });
														},
														children: t?.("route.moveUp") ?? "Up"
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
														type: "button",
														className: "dsm-xdpool-rt-drop",
														disabled: modelIndex === platform.models.length - 1,
														onClick: () => {
															const next = [...platform.models];
															const [moved] = next.splice(modelIndex, 1);
															if (moved === void 0) return;
															next.splice(modelIndex + 1, 0, moved);
															patchLane(index, { models: next });
														},
														children: t?.("route.moveDown") ?? "Down"
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
														type: "button",
														className: "dsm-xdpool-rt-drop",
														onClick: () => {
															patchLane(index, { models: platform.models.filter((entry) => entry !== model) });
														},
														children: t?.("route.removeMember") ?? "Remove"
													})
												]
											}, `${model}-${modelIndex}`);
										})
									}),
									choices.length === 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "dsm-xdpool-rt-addrow",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
											className: "dsm-xdpool-rt-pick",
											value: picked,
											disabled: busy,
											onChange: (event) => {
												setPickByLane((prev) => ({
													...prev,
													[platform.owner]: event.target.value
												}));
											},
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
												value: "",
												children: t?.("route.pickModel") ?? "Pick a model…"
											}), choices.map((choice) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
												value: bareModelOf(choice),
												children: [
													choice.name,
													" — ",
													bareModelOf(choice)
												]
											}, choice.id))]
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: "dsm-btn dsm-btn-outline",
											disabled: busy || picked === "",
											onClick: () => {
												if (picked === "" || platform.models.includes(picked)) return;
												patchLane(index, { models: [...platform.models, picked] });
												setPickByLane((prev) => ({
													...prev,
													[platform.owner]: ""
												}));
											},
											children: t?.("route.addModel") ?? "Add model"
										})]
									})
								]
							}, `${platform.owner}-${index}`);
						})
					}),
					addable.length === 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-xdpool-rt-addrow",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
							className: "dsm-xdpool-rt-pick",
							value: pickLane,
							disabled: busy,
							onChange: (event) => {
								setPickLane(event.target.value);
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: "",
								children: t?.("route.pickPlatform") ?? "Pick a platform…"
							}), addable.map((entry) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
								value: entry.owner,
								children: [
									ownerName(entry.owner, t),
									"（",
									entry.count,
									"）"
								]
							}, entry.owner))]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dsm-btn dsm-btn-outline",
							disabled: busy || pickLane === "",
							onClick: () => {
								if (pickLane === "" || used.includes(pickLane)) return;
								commit([...draft.platforms, {
									owner: pickLane,
									models: []
								}]);
								setPickLane("");
							},
							children: t?.("route.addPlatform") ?? "Add platform"
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsm-xdpool-rt-hint",
						children: t?.("route.platformHint") ?? "Higher is tried first; the same applies to models inside one platform."
					})
				]
			});
		}
		//#endregion
		//#region src/client/GatewayPage.tsx
		/**
		* The gateway page: the relay that re-exposes the pool to the rest of the LAN.
		*
		* The page is written around one fact that is easy to get wrong and expensive to
		* get wrong twice: the key shown here is the RELAY key, not the shim's secret.
		* The shim's secret is minted per process, so if it were the thing a phone held,
		* every DSH restart would break every configured client. This page therefore
		* never hands out a credential that outlives a restart.
		*
		* Three deliberate honesty choices:
		*
		* 1. Defaulting to loopback. The bind address is a choice with a network-visible
		*    consequence, so it starts at `127.0.0.1` and says plainly what that means
		*    ("only this computer"). Turning it to `0.0.0.0` is a separate, explicit act.
		* 2. A key is minted the moment the relay is enabled, not on first use. An
		*    enabled relay with no key would have to either refuse everyone (so the
		*    switch silently does nothing) or accept everyone.
		* 3. A failed bind is reported as a failure, not as "off". The difference matters
		*    because "off" tells the user to turn on something that is already on.
		*
		* Class names: this page reuses the shell's generic `.dsm-xdpool-sec`
		* and `-sectitle` instead of redefining a section frame per panel. The few
		* classes it does own are prefixed `-gw-` and all live in `GATEWAY_CARD_CSS`.
		*
		* @module dsh-xdpool/client/GatewayPage
		*/
		/**
		* The only two bind addresses offered.
		*
		* Mirrors `RELAY_HOSTS` in `src/relay.ts`. Duplicated rather than imported
		* because the server module imports `node:http` and this bundle is built for the
		* browser — importing it would drag a Node listener into the card.
		* `tests/relay-page.test.ts` asserts the two lists cannot drift apart.
		*/
		const HOSTS = [{
			value: "127.0.0.1",
			fallback: "localhost only"
		}, {
			value: "0.0.0.0",
			fallback: "every device on this network"
		}];
		/** Poll interval. Slower than the pool card: a relay does not change on its own. */
		const POLL_MS = 15e3;
		/**
		* A masked key for display, never the full value.
		*
		* The card renders a reveal button instead of printing the key, because a
		* screenshot of the settings panel is a normal thing to share and a settings
		* screenshot should not hand out a credential. The value is still in the
		* document — the user asked for it and has to paste it into another device — it
		* is just not pre-rendered.
		*/
		function maskOf(key) {
			if (key.length <= 8) return "•".repeat(Math.max(4, key.length));
			return `${key.slice(0, 4)}${"•".repeat(8)}${key.slice(-4)}`;
		}
		function GatewayPage({ t }) {
			const [status, setStatus] = (0, react.useState)(void 0);
			const [error, setError] = (0, react.useState)(void 0);
			const [flash, setFlash] = (0, react.useState)(void 0);
			const [busy, setBusy] = (0, react.useState)(false);
			const [revealed, setRevealed] = (0, react.useState)(false);
			const [host, setHost] = (0, react.useState)("127.0.0.1");
			const [port, setPort] = (0, react.useState)("8326");
			/**
			* The in-progress share list, or undefined while it still mirrors the server.
			*
			* Held as a draft for the same reason the model card holds one: saving is a
			* deliberate act here, because every unchecked row stops working on whatever
			* device is already pointed at the gateway.
			*/
			const [draftShared, setDraftShared] = (0, react.useState)(void 0);
			/**
			* Which ids are shared right now.
			*
			* `status.shared === undefined` means the user has never chosen, and the
			* gateway is serving everything — so the picker must show every row ticked
			* rather than an empty list, which would read as "nothing is shared" and invite
			* a save that closes a gateway that was open.
			*/
			const candidates = status?.candidates ?? [];
			const serverShared = status?.shared ?? candidates.map((row) => row.id);
			const shared = draftShared ?? new Set(serverShared);
			const sharedDirty = draftShared !== void 0 && (draftShared.size !== serverShared.length || [...draftShared].some((id) => !serverShared.includes(id)));
			const toggleShared = (id) => {
				const next = new Set(shared);
				if (next.has(id)) next.delete(id);
				else next.add(id);
				setDraftShared(next);
			};
			const setAllShared = (on) => {
				setDraftShared(on ? new Set(candidates.map((row) => row.id)) : /* @__PURE__ */ new Set());
			};
			/** True once the server's values were adopted, so polls do not stomp edits. */
			const seeded = (0, react.useRef)(false);
			const mounted = (0, react.useRef)(true);
			(0, react.useEffect)(() => () => {
				mounted.current = false;
			}, []);
			const load = (0, react.useCallback)(async (signal) => {
				try {
					const response = await fetch(POOL_RELAY_PATH, {
						method: "GET",
						headers: { accept: "application/json" },
						credentials: "same-origin",
						...signal === void 0 ? {} : { signal }
					});
					const value = await response.json().catch(() => void 0);
					if (!response.ok) {
						const detail = value;
						if (mounted.current) setError(detail?.error ?? `HTTP ${response.status}`);
						return;
					}
					if (mounted.current && signal?.aborted !== true) {
						const next = value;
						setStatus(next);
						setError(void 0);
						if (!seeded.current) {
							seeded.current = true;
							if (next.host !== "") setHost(next.host);
							if (next.port > 0) setPort(String(next.port));
						}
					}
				} catch (cause) {
					if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
				}
			}, []);
			(0, react.useEffect)(() => {
				const controller = new AbortController();
				load(controller.signal);
				const timer = setInterval(() => {
					load(controller.signal);
				}, POLL_MS);
				return () => {
					controller.abort();
					clearInterval(timer);
				};
			}, [load]);
			/**
			* Send one patch.
			*
			* The response IS the new state, so the panel never has to guess what the
			* server decided: a port it refused, a key it minted, a bind it failed all
			* come back as facts rather than as the optimistic local edit.
			*/
			const write = (0, react.useCallback)(async (patch) => {
				setBusy(true);
				try {
					const response = await fetch(POOL_RELAY_PATH, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						credentials: "same-origin",
						body: JSON.stringify(patch)
					});
					const value = await response.json().catch(() => void 0);
					if (!response.ok) {
						const detail = value;
						if (mounted.current) setFlash(`${t?.("gw.saveFailed") ?? "Could not save"}: ${detail?.error ?? `HTTP ${response.status}`}`);
						return;
					}
					if (!mounted.current) return;
					setStatus(value);
					setFlash(void 0);
					setError(void 0);
					setRevealed(false);
				} catch (cause) {
					if (mounted.current) setFlash(cause instanceof Error ? cause.message : String(cause));
				} finally {
					if (mounted.current) setBusy(false);
				}
			}, [t]);
			const enabled = status?.enabled === true;
			const listening = status?.listening === true;
			const key = status?.key ?? "";
			const parsedPort = Number(port);
			const portUsable = Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65535;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsm-xdpool-gw",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("style", { children: GATEWAY_CARD_CSS }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(PageHero, {
						title: t?.("gw.title") ?? "Gateway",
						sub: t?.("gw.sub") ?? "",
						pills: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsm-xdpool-pill",
							"data-tone": enabled ? "ok" : "off",
							children: enabled ? t?.("gw.on") ?? "On" : t?.("gw.off") ?? "Off"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsm-xdpool-pill",
							"data-tone": listening ? "ok" : enabled ? "warn" : "off",
							children: listening ? t?.("gw.listening") ?? "Listening" : enabled ? t?.("gw.notListening") ?? "On, not listening" : t?.("gw.idle") ?? "Idle"
						})] })
					}),
					error !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsm-xdpool-panel-error",
						children: error
					}) : null,
					flash !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsm-xdpool-gw-flash",
						children: flash
					}) : null,
					status?.error !== void 0 && status.error !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsm-xdpool-panel-error",
						children: status.error
					}) : null,
					status === void 0 && error === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsm-xdpool-panel-empty",
						children: t?.("gw.loading") ?? "Reading…"
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-xdpool-sec",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dsm-xdpool-sectitle",
								children: t?.("gw.switch") ?? "Relay"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dsm-xdpool-gw-btn",
								"data-on": enabled ? "true" : "false",
								disabled: busy,
								onClick: () => {
									write({ enabled: !enabled });
								},
								children: enabled ? t?.("gw.turnOff") ?? "Turn off" : t?.("gw.turnOn") ?? "Turn on"
							}) }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dsm-xdpool-gw-note",
								children: t?.("gw.switchHint") ?? ""
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-xdpool-sec",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dsm-xdpool-sectitle",
								children: t?.("gw.address") ?? "Address"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: "dsm-xdpool-gw-field",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t?.("gw.host") ?? "Bind address" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
									value: host,
									disabled: busy,
									onChange: (event) => {
										setHost(event.target.value);
									},
									children: HOSTS.map((option) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
										value: option.value,
										children: [
											option.value,
											" — ",
											t?.("gw.hostFallback", { fallback: option.fallback }) ?? option.fallback
										]
									}, option.value))
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: "dsm-xdpool-gw-field",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t?.("gw.port") ?? "Port" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "number",
									min: 1,
									max: 65535,
									value: port,
									disabled: busy,
									onChange: (event) => {
										setPort(event.target.value);
									}
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dsm-xdpool-gw-btn",
								"data-on": "false",
								disabled: busy || !portUsable,
								onClick: () => {
									write({
										host,
										port: parsedPort
									});
								},
								children: t?.("gw.saveAddress") ?? "Save address"
							}) }),
							portUsable ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dsm-xdpool-gw-warn",
								children: t?.("gw.portInvalid") ?? ""
							}),
							listening && status?.endpoint !== void 0 && status.endpoint !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dsm-xdpool-gw-note",
								children: t?.("gw.endpoint", { endpoint: status.endpoint }) ?? status.endpoint
							}) : null
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-xdpool-sec",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dsm-xdpool-sectitle",
								children: t?.("gw.key") ?? "Key"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dsm-xdpool-gw-key",
								children: key === "" ? t?.("gw.noKey") ?? "No key yet" : revealed ? key : maskOf(key)
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsm-xdpool-gw-actions",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dsm-xdpool-gw-btn",
									"data-on": "false",
									disabled: busy || key === "",
									onClick: () => {
										setRevealed((current) => !current);
									},
									children: revealed ? t?.("gw.hideKey") ?? "Hide" : t?.("gw.showKey") ?? "Show"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dsm-xdpool-gw-btn",
									"data-on": "false",
									disabled: busy,
									onClick: () => {
										write({ key: "" });
									},
									children: t?.("gw.rotate") ?? "Rotate"
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dsm-xdpool-gw-note",
								children: t?.("gw.keyHint") ?? ""
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-xdpool-sec",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dsm-xdpool-sectitle",
								children: t?.("gw.share") ?? "Shared models"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dsm-xdpool-gw-note",
								children: t?.("gw.shareHint") ?? ""
							}),
							candidates.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dsm-xdpool-gw-note",
								children: t?.("gw.shareNone") ?? ""
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dsm-xdpool-gw-actions",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: "dsm-xdpool-gw-btn",
											"data-on": "false",
											disabled: busy,
											onClick: () => {
												setAllShared(true);
											},
											children: t?.("gw.shareAll") ?? "Select all"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: "dsm-xdpool-gw-btn",
											"data-on": "false",
											disabled: busy,
											onClick: () => {
												setAllShared(false);
											},
											children: t?.("gw.shareNoneBtn") ?? "Select none"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: "dsm-xdpool-gw-btn",
											"data-on": "true",
											disabled: busy || !sharedDirty,
											onClick: () => {
												write({ models: [...shared] }).then(() => {
													setDraftShared(void 0);
												});
											},
											children: t?.("gw.shareSave") ?? "Save"
										})
									]
								}),
								sharedDirty ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "dsm-xdpool-gw-warn",
									children: t?.("gw.shareDirty") ?? ""
								}) : null,
								[...new Set(candidates.map((row) => row.source))].map((source) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dsm-xdpool-gw-group",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: "dsm-xdpool-gw-group-title",
										children: source
									}), candidates.filter((row) => row.source === source).map((row) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
										className: "dsm-xdpool-gw-model",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
												type: "checkbox",
												checked: shared.has(row.id),
												disabled: busy,
												onChange: () => {
													toggleShared(row.id);
												}
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "dsm-xdpool-gw-model-name",
												children: row.name
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "dsm-xdpool-gw-model-id",
												children: row.id
											})
										]
									}, row.id))]
								}, source))
							] })
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-xdpool-sec",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dsm-xdpool-sectitle",
							children: t?.("gw.usage") ?? "Using it"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dsm-xdpool-gw-note",
							children: t?.("gw.usageHint") ?? ""
						})]
					})
				]
			});
		}
		//#endregion
		//#region src/client/region-card.tsx
		/**
		* Which login channel each lane IS.
		*
		* The pool serves the same two vendors the login page offers, so the lane's
		* mark is that vendor's own logo rather than a shape we drew. These are the two
		* ids in `POOL_OWNED_CHANNELS`; naming them here is what lets the card wear the
		* real artwork the user recognises from the WorkBuddy app.
		*/
		const REGION_CHANNEL_BY_REGION = Object.freeze({
			cn: "buddy",
			global: "workbuddy"
		});
		/**
		* Which glyph each lane wears when its logo is not in this build.
		*
		* The tile itself is shared with the login-channels page (`brand-tile.tsx`) so
		* the two pages cannot drift apart; only the shape differs per lane, because a
		* bubble says "this is a lane that answers" where a key would say "sign in
		* here", and the two cards are showing different things.
		*/
		const REGION_GLYPH_BY_REGION = Object.freeze({
			cn: "chat",
			global: "globe"
		});
		/** The two palettes, frozen so a caller cannot mutate a shared object. */
		const REGION_PALETTES = Object.freeze({
			cn: Object.freeze({
				accent: "#6f5cf0",
				from: "#4f6ef7",
				to: "#8b5cf6"
			}),
			global: Object.freeze({
				accent: "#10a5a0",
				from: "#0fb5a4",
				to: "#3fd6a8"
			})
		});
		/**
		* The card's three colour variables, ready to spread into a `style` prop.
		*
		* React's CSSProperties type has no index signature for custom properties, so
		* the caller has to cast; doing the cast once here keeps it out of the markup.
		*
		* `from` / `to` are kept as separate stops rather than folded into one
		* `color-mix`: these two lanes ARE the pool's own suppliers, so their gradient
		* is a named brand decision, unlike the thirteen third-party channels, which
		* each supply exactly one colour and get their second stop derived.
		*/
		function regionCardStyle(region) {
			const palette = REGION_PALETTES[region];
			return {
				"--dsm-xdpool-region-accent": palette.accent,
				"--dsm-xdpool-region-icon-from": palette.from,
				"--dsm-xdpool-region-icon-to": palette.to
			};
		}
		/** The lane's tile: the vendor's own logo when this build carries it. */
		function RegionCardTile({ region }) {
			const icon = channelIcon(REGION_CHANNEL_BY_REGION[region]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(BrandTile, {
				accent: REGION_PALETTES[region].accent,
				glyph: REGION_GLYPH_BY_REGION[region],
				...icon === void 0 ? {} : { icon }
			});
		}
		/**
		* One labelled disclosure.
		*
		* Rendered as a plain `div` with `role="group"` rather than a fieldset,
		* because the body is not a form control and a fieldset would imply a legend
		* the user is supposed to fill in.
		*/
		function RegionCardPane({ id, open, children }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dsm-xdpool-region-pane",
				id,
				role: "group",
				hidden: !open,
				children
			});
		}
		/**
		* The `Accounts / Models` half of the segmented control.
		*
		* A button, not a `<summary>`: the card has no card-level `open` state left
		* to summarise, and `<summary>` inside a non-details element is invalid.
		*/
		function RegionCardTrigger({ controls, open, label, glyph, text, count, onToggle }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				className: "dsm-xdpool-region-seg-btn",
				"aria-expanded": open,
				"aria-controls": controls,
				"aria-label": label,
				onClick: onToggle,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsm-xdpool-region-seg-glyph",
						"aria-hidden": "true",
						children: glyph
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsm-xdpool-region-seg-text",
						children: text
					}),
					count === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsm-xdpool-region-seg-count",
						children: count
					})
				]
			});
		}
		/**
		* The one badge label that means "free right now".
		*
		* A name check rather than a position check, so a gateway that reorders or adds
		* other badges keeps working.
		*/
		const BADGE_FREE_LABEL = "限时免费";
		/** A `#`-prefixed hex colour of 3–8 digits, which is what CSS accepts. */
		const COLOR_TAIL = /^[0-9A-Fa-f]{3,8}$/;
		/**
		* Split the `badge:<label>:#RRGGBB` entries the CN gateway puts in `tags`.
		*
		* `#` may legitimately occur inside a label, so the split happens on the LAST
		* one and the tail is only accepted as a colour when it actually looks like
		* one — otherwise a label such as `C#` would silently lose its last character.
		*
		* Returns an empty array for `undefined` so callers can iterate unconditionally.
		*/
		function parseBadgeTags(tags) {
			const out = [];
			for (const tag of tags ?? []) {
				if (!tag.startsWith("badge:")) continue;
				const rest = tag.slice(6);
				const hash = rest.lastIndexOf("#");
				const tail = hash === -1 ? "" : rest.slice(hash + 1);
				const isColor = hash !== -1 && COLOR_TAIL.test(tail);
				const cut = (hash === -1 ? rest : rest.slice(0, hash)).trim();
				const label = isColor ? cut.replace(/:$/, "").trim() : cut;
				if (label === "") continue;
				out.push(isColor ? {
					label,
					color: tail
				} : { label });
			}
			return out;
		}
		/**
		* Whether any badge declares the model free right now.
		*
		* Distinct from the multiplier check in `isFreeModel`: this is the upstream
		* volunteering the fact, which is what lets the card show "限时免费" for a model
		* whose `credits` string never said zero.
		*/
		function hasFreeBadge(tags) {
			return parseBadgeTags(tags).some((badge) => badge.label === BADGE_FREE_LABEL);
		}
		/** The badge labels alone, in upstream order, without the colour segments. */
		function badgeLabels(tags) {
			return parseBadgeTags(tags).map((badge) => badge.label);
		}
		/**
		* Which free presentation wins for one row: the gateway's own badge, or the
		* generic `免费`.
		*
		* The badge branch is gated on the FREE badge, not on "has any badge": the CN
		* roster also writes `badge:夜间折扣` on `glm-5.2`, which is priced at `x0.79`
		* and still costs credits. Reporting a discount row as free would change what
		* the user spends, which is the one thing this plugin must never get wrong.
		* Callers that want to SHOW a non-free badge ask `badgeLabels` separately.
		*
		* Ordered so the free badge wins over the generic label, because `限时免费`
		* ("free, for a limited time") names the part that expires, which the generic
		* label cannot. `undefined` means the row is not free at all and the caller
		* should fall through to its other tag rules.
		*
		* A separately-sorted "is it free right now" question is answered by
		* `isFreeNow` in `promo.ts`, which reads the same badge. Keeping the two apart
		* is why this returns a presentation rather than a boolean.
		*/
		function freeBadgeKind(model) {
			if (hasFreeBadge(model.tags)) return "badge";
			if (model.multiplier === 0 || (model.tags ?? []).includes("free")) return "generic";
		}
		//#endregion
		//#region src/promo.ts
		/**
		* Time-boxed promotional pricing: which models are free, and when.
		*
		* Why this lives in the plugin rather than coming from the gateway: the
		* announcements describe promotions the API does NOT model. Verified against
		* the live endpoints —
		*
		*   - Hy3's free tier IS reflected (`credits: "x0.00"`), so it needs nothing
		*     from this module; the multiplier alone says "free".
		*   - Hy4-preview's night window is NOT: the catalog reports `credits: "x0.29"`
		*     around the clock, with no field for a time-of-day rule.
		*   - The 14-day newcomer allowance is NOT either, and cannot be: nothing in
		*     the model catalog or the billing packages records whether an account has
		*     ever opened that model. It is account state the plugin is never told.
		*
		* So this module encodes the PUBLIC, TIME-BASED rules only — the part that is
		* knowable without account state. The 14-day allowance is deliberately NOT
		* guessed at: a wrong "free for you!" badge is worse than no badge, because it
		* changes what the user spends.
		*
		* Rules are declared as data so a new promotion is a table entry, and an expiry
		* is automatic: once `until` passes, the rule stops applying on its own.
		*
		* @module dsh-xdpool/promo
		*/
		/**
		* Promotions in force.
		*
		* Source: the WorkBuddy announcement extending Hy3's free tier and
		* Hy4-preview's night window to **2026-10-31**. Hy3 needs no entry here (its
		* CN price is already zero upstream); only Hy4-preview's time window does,
		* because the gateway charges for it around the clock.
		*
		* When a promotion is extended or a new one starts, edit this table. When one
		* ends, either delete the row or let `until` lapse — both stop the badge.
		*/
		const PROMO_RULES = [{
			idPrefix: "hy4-preview",
			region: "cn",
			hours: [
				23,
				0,
				1,
				2,
				3,
				4,
				5,
				6,
				7
			],
			until: "2026-10-31",
			label: "night"
		}];
		/** `YYYY-MM-DD` for a Date in LOCAL time (the promotions are announced locally). */
		function localDayKey(date) {
			const p = (n) => String(n).padStart(2, "0");
			return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
		}
		/** Whether a rule is still in force on `date`. */
		function ruleActive(rule, date) {
			return localDayKey(date) <= rule.until;
		}
		/** The first hour the window reopens, searching forward from `hour`. */
		function nextWindowHour(rule, hour) {
			for (let step = 1; step <= 24; step += 1) {
				const candidate = (hour + step) % 24;
				if (rule.hours.includes(candidate)) return candidate;
			}
		}
		/** The hour the CURRENT window closes, searching forward from `hour`. */
		function windowEndHour(rule, hour) {
			for (let step = 1; step <= 24; step += 1) {
				const candidate = (hour + step) % 24;
				if (!rule.hours.includes(candidate)) return candidate;
			}
		}
		/**
		* The promotion status of one model at `now`, for one region.
		*
		* `now` is injected so the behaviour is testable without freezing the clock —
		* a time-dependent badge that can only be tested by waiting is a badge nobody
		* tests. `region` is required for the same reason the rules carry one: these
		* campaigns are regional, and applying a domestic rule to the international
		* roster would invent a discount that gateway does not offer.
		*/
		function promoStatusFor(model, now = /* @__PURE__ */ new Date(), region = "cn") {
			if (model.multiplier === 0) return { kind: "free" };
			if (hasFreeBadge(model.tags)) return { kind: "free" };
			for (const rule of PROMO_RULES) {
				if (rule.region !== region) continue;
				if (!model.id.startsWith(rule.idPrefix)) continue;
				if (!ruleActive(rule, now)) continue;
				const hour = now.getHours();
				if (rule.hours.includes(hour)) {
					const untilHour = windowEndHour(rule, hour);
					return {
						kind: "night",
						label: rule.label,
						untilHour: untilHour ?? hour,
						promoUntil: rule.until
					};
				}
				const nextHour = nextWindowHour(rule, hour);
				if (nextHour !== void 0) return {
					kind: "night-later",
					label: rule.label,
					nextHour,
					promoUntil: rule.until
				};
			}
		}
		/**
		* Whether a model is free RIGHT NOW, for sorting.
		*
		* Only the two "currently free" kinds count. `night-later` deliberately does
		* NOT sort to the top: it costs credits at this moment, and floating a
		* credit-priced model above cheaper ones would misrepresent the list.
		*/
		function isFreeNow(model, now = /* @__PURE__ */ new Date(), region = "cn") {
			const status = promoStatusFor(model, now, region);
			return status?.kind === "free" || status?.kind === "night";
		}
		//#endregion
		//#region src/siblings.ts
		/**
		* The cheapest PAID model sharing `model`'s display name, or undefined.
		*
		* Cheapest rather than first, because the point of the hint is "there is a
		* cheap way out": offering the most expensive twin would make switching look
		* like a trap. A sibling whose price is unknown is skipped — an unpriced row
		* cannot be promised as "the paid one".
		*/
		function paidSiblingOf(model, models) {
			let best;
			for (const candidate of models) {
				if (candidate.id === model.id) continue;
				if (candidate.name !== model.name) continue;
				const multiplier = candidate.multiplier;
				if (multiplier === void 0 || multiplier <= 0) continue;
				if (best === void 0 || multiplier < best.multiplier) best = {
					id: candidate.id,
					name: candidate.name,
					multiplier
				};
			}
			return best;
		}
		/**
		* The paid sibling of a model, but ONLY when the model itself is free.
		*
		* The guard is the whole point: a `x0.79` row with a `x0.06` cousin is not a
		* "free model with a paid twin", it is just a more expensive row, and labelling
		* it would be noise on most of the list. The hint answers one question — "the
		* free one is limited, what now".
		*/
		function paidAlternativeFor(model, models) {
			if (model.multiplier !== 0) return void 0;
			return paidSiblingOf(model, models);
		}
		//#endregion
		//#region src/client/ChannelPoolSection.tsx
		/**
		* Account-pool page, scan-channel section.
		*
		* The pool page's two region cards only ever showed the WorkBuddy lanes — the
		* thirteen scan-login channels lived in a parallel world on the login page.
		* This section closes that gap: every scan channel that holds at least one
		* account gets a card here, laid out like the reference build's channel card —
		* identity on top, a one-line note about what the vendor actually gives away,
		* a numbers row (accounts, models, credits), then two collapsible lists.
		*
		* Three decisions worth stating, because each of them is a way this could have
		* looked wrong:
		*
		* 1. The enable state IS the pack's model blacklist — `model.setDisabled` with
		*    `disabled: false` unhides a model, `disabled: true` hides it again — and
		*    each row saves on its own. A channel can publish thirty models; a Save
		*    button at the bottom of a list the user has to scroll back down to turns
		*    "pick the two you want" into bookkeeping.
		* 2. Credits come from the pack and are shown in the vendor's own unit, never
		*    normalised: Cline pays dollars, ZCode pays tokens, Gemini publishes
		*    percentage windows. A single "credits" column would be wrong for a third
		*    of the roster.
		* 3. Model descriptions are the ONE thing the pack cannot answer. Its
		*    `model.list` keeps only `id`, `name` and two flags, so descriptions come
		*    from the host's catalogue — the same one the model picker reads.
		*
		* @module dsh-xdpool/client/ChannelPoolSection
		*/
		let poolSnapshot;
		/**
		* `provider.status` answered recently, kept across unmounts.
		*
		* One request counts EVERY named provider's accounts, so its cost is the sum of
		* thirteen pool walks. Re-running that on the next visit, for numbers that cannot
		* have moved, is what made this section feel slow on every open while the login page
		* (static metadata, no counting) appeared instantly.
		*
		* Module-level rather than component state on purpose: switching settings tabs
		* unmounts the section, and the whole point is that coming back is cheap.
		*/
		let providerStatusCache;
		const PROVIDER_STATUS_TTL_MS = 3e4;
		/**
		* Drop the snapshot after anything that changes the data behind it.
		*
		* Logins, deletions, toggles and manual balance refreshes all make the snapshot
		* stale in a way a silent revalidation cannot hide: showing yesterday's account
		* list for a card the user just added an account to is worse than showing the
		* "reading" line for a moment.
		*
		* The provider-status cache is dropped with it, or a rescan that just found an
		* account would be invisible behind a 30-second-old count.
		*/
		function invalidatePoolSnapshot() {
			poolSnapshot = void 0;
			providerStatusCache = void 0;
		}
		/** How many automatic retries a cold-start mount gets before giving up. */
		const LOAD_RETRIES = 5;
		/** Gap between those retries, in milliseconds. */
		const RETRY_INTERVAL_MS = 2e3;
		/**
		* Channels whose accounts are shown by the two region cards instead.
		*
		* `buddy` (CodeBuddy CN) and `workbuddy` (WorkBuddy international) are the
		* two lanes the pool itself serves. A scan login for either writes into the
		* same place the desktop app's credentials land, so listing them again as
		* channel cards would show every account twice — once with credits and
		* cooldowns, once bare. They are filtered out here rather than special-cased
		* in the renderer, so an account added on the login page shows up in exactly
		* one place no matter which path created it.
		*/
		/**
		* The catalogue length at which a model search box earns its place.
		*
		* Below this the reader scrolls faster than they type, and the field would be
		* one more control to look past on every card.
		*/
		const MODEL_SEARCH_THRESHOLD = 8;
		/**
		* The window a channel model is capped to when the user does not ask for more.
		*
		* Same number as the region cards' `DEFAULT_CONTEXT_BUDGET`, and for the same
		* reason: a published window is a ceiling the vendor supports, not a size every
		* request can carry, so the picker offers a conservative default next to the
		* native figure instead of presenting the maximum as the everyday choice.
		*/
		const CONTEXT_BUDGET_DEFAULT = 2e5;
		const REGION_OWNED_CHANNELS = /* @__PURE__ */ new Set(["buddy", "workbuddy"]);
		/**
		* Collapse repeated sign-ins of the same person into one row.
		*
		* The pack's `account.create` appends unconditionally — it has no idea an
		* account with the same nickname already exists — so clicking "add account"
		* twice leaves two entries. The pack prunes them on disk, but the prune only
		* runs at mount and on the next login, so a card can still render the
		* pre-prune list. Same provider plus same nickname is the same person (the
		* pack rewrites the nickname from a random id to the real display name the
		* moment a login lands), so the newest entry wins: it is the one whose
		* credential was written last.
		*/
		function dedupeAccounts(accounts) {
			const byNickname = /* @__PURE__ */ new Map();
			const order = [];
			for (const account of accounts) {
				const nickname = (account.nickname ?? "").trim();
				const key = nickname === "" ? `id:${account.id}` : `n:${nickname}`;
				if (byNickname.get(key) === void 0) {
					byNickname.set(key, account);
					order.push(key);
					continue;
				}
				byNickname.set(key, account);
			}
			return order.map((key) => byNickname.get(key)).filter((account) => account !== void 0);
		}
		/** A refusal shaped like the pack's own envelope, so one catch covers both. */
		function refused(message) {
			return {
				ok: false,
				error: { message }
			};
		}
		/**
		* "3 days left" / "expired" / "no expiry", from a millisecond stamp.
		*
		* `never` is the honest answer for the channels whose credentials carry no
		* expiry at all (ZCode among them), and printing "expired" or a date for those
		* would be a number the user cannot check.
		*/
		function expiryText(expiresAt, t) {
			if (expiresAt === void 0 || !Number.isFinite(expiresAt) || expiresAt <= 0) return t?.("channelpool.expiryNever") ?? "no expiry";
			const remainingMs = expiresAt - Date.now();
			if (remainingMs <= 0) return t?.("channelpool.expiryExpired") ?? "expired";
			const minutes = Math.floor(remainingMs / 6e4);
			if (minutes < 60) return minutes <= 1 ? "<1m" : `${String(minutes)}m`;
			const hours = Math.floor(remainingMs / 36e5);
			if (hours < 24) return `${String(hours)}h`;
			const days = Math.floor(remainingMs / 864e5);
			return days === 1 ? "1d" : `${String(days)}d`;
		}
		/** The vendor's currency, spelled the way that vendor spells it. */
		function creditUnitLabel(channel, t) {
			const unit = channel.credits?.unit;
			if (unit === "dollars") return t?.("channelpool.creditsDollar") ?? "USD";
			if (unit === "tokens") return t?.("channelpool.creditsToken") ?? "tokens";
			if (channel.credits?.quota === true) return t?.("channelpool.creditsQuota") ?? "quota";
			return t?.("channelpool.creditsUnit") ?? "credits";
		}
		/** Trim a decimal to something a card can print without lying about it. */
		function amount(value) {
			return Number.isInteger(value) ? String(value) : value.toFixed(2);
		}
		async function cachedProviderStatus(providers) {
			const key = [...providers].sort().join("\0");
			const hit = providerStatusCache;
			if (hit !== void 0 && hit.key === key && Date.now() - hit.at < PROVIDER_STATUS_TTL_MS) return hit.answer;
			const answer = await callPack("provider.status", { providers: [...providers] });
			providerStatusCache = {
				at: Date.now(),
				key,
				answer
			};
			return answer;
		}
		function ChannelPoolSection({ t }) {
			const [entries, setEntries] = (0, react.useState)(() => poolSnapshot?.entries ?? []);
			const [error, setError] = (0, react.useState)(() => poolSnapshot?.error);
			/**
			* True until the first wave has answered once.
			*
			* The section used to render NOTHING while loading, so a cold start and a
			* broken RPC bridge looked identical: blank (#95). The bridge failing is a
			* real, common failure — `provider.status` answers `ok: false`, the map comes
			* back empty, `scanProviders` is empty and the old code returned `<></>` with
			* `error === undefined`. Silence was indistinguishable from "no accounts".
			*/
			const [loading, setLoading] = (0, react.useState)(() => poolSnapshot === void 0);
			const [notice, setNotice] = (0, react.useState)(void 0);
			/** provider → the open list, or `undefined` for a card with both folded. */
			const [folds, setFolds] = (0, react.useState)(/* @__PURE__ */ new Map());
			/** provider → the set of model ids the user has ticked. */
			const [enabled, setEnabled] = (0, react.useState)(/* @__PURE__ */ new Map());
			/** provider → true while one of its actions is in flight. */
			const [busy, setBusy] = (0, react.useState)(/* @__PURE__ */ new Set());
			/** provider → what the reader typed into that card's model search box. */
			const [queries, setQueries] = (0, react.useState)(/* @__PURE__ */ new Map());
			const entriesRef = (0, react.useRef)(entries);
			entriesRef.current = entries;
			const mountedRef = (0, react.useRef)(true);
			/**
			* Which load is current.
			*
			* Two things make a stale answer arrive late: the retry ladder re-runs the
			* whole chain, and a remount starts a new chain while the old request is
			* still in flight. Stamping each run is what keeps an older wave-2 result
			* from painting over a newer wave-1 one.
			*/
			const loadSeq = (0, react.useRef)(0);
			(0, react.useEffect)(() => () => {
				mountedRef.current = false;
			}, []);
			const markBusy = (provider, on) => {
				setBusy((previous) => {
					const next = new Set(previous);
					if (on) next.add(provider);
					else next.delete(provider);
					return next;
				});
			};
			const load = async () => {
				loadSeq.current += 1;
				try {
					const channels = (await fetchChannels()).filter((channel) => !REGION_OWNED_CHANNELS.has(channel.id));
					const statusAnswer = await cachedProviderStatus(channels.map((channel) => channel.id));
					const statuses = providerStatusesFrom(statusAnswer);
					const scanProviders = channels.map((channel) => channel.id).filter((id) => (statuses.get(id)?.accountsTotal ?? 0) > 0);
					const perProvider = await Promise.all(scanProviders.map(async (provider) => {
						const wantBalances = channels.find((channel) => channel.id === provider)?.credits !== void 0;
						const accountsPromise = callPack("account.list", { provider });
						const modelsPromise = callPack("model.list", { provider });
						const [accounts, models] = await Promise.all([accountsPromise.catch(() => refused("account.list failed")), modelsPromise.catch(() => refused("model.list failed"))]);
						const modelRows = modelsFrom(models.value);
						const modelEmptyBecauseRefused = modelRows.length === 0 && models.ok !== true;
						return [provider, {
							accounts: dedupeAccounts(accountsFrom(accounts)),
							models: sortChannelModels(modelRows),
							facts: /* @__PURE__ */ new Map(),
							balances: [],
							statuses: [],
							balancePending: wantBalances,
							balanceError: void 0,
							modelError: modelEmptyBecauseRefused ? models.error?.message ?? "model.list refused" : void 0
						}];
					}));
					const byProvider = new Map(perProvider);
					const next = channels.filter((channel) => byProvider.has(channel.id)).map((channel) => ({
						channel,
						...byProvider.get(channel.id),
						facts: /* @__PURE__ */ new Map(),
						status: statuses.get(channel.id)
					}));
					poolSnapshot = {
						entries: next,
						error: void 0
					};
					if (!mountedRef.current) return;
					const seq = loadSeq.current;
					setEntries(next);
					setError(void 0);
					setLoading(false);
					if (next.length === 0) {
						if (!statusAnswer.ok) {
							const message = statusAnswer.error?.message ?? "provider.status refused";
							poolSnapshot = {
								entries: next,
								error: message
							};
							setError(message);
						}
						return;
					}
					for (const entry of next) {
						if (entry.channel.credits === void 0) continue;
						refreshBalances(entry.channel.id, false, true, seq);
					}
					const idsByProvider = {};
					for (const [provider, entry] of perProvider) if (entry.models.length > 0) idsByProvider[provider] = entry.models.map((model) => model.id);
					const facts = await fetchChannelModels(next.map((entry) => entry.channel.id), idsByProvider).catch(() => /* @__PURE__ */ new Map());
					if (!mountedRef.current || loadSeq.current !== seq) return;
					if (facts.size === 0) return;
					setEntries((previous) => previous.map((entry) => ({
						...entry,
						facts: new Map((facts.get(entry.channel.id) ?? []).map((model) => [model.id, model]))
					})));
				} catch (cause) {
					const message = cause instanceof Error ? cause.message : String(cause);
					poolSnapshot = {
						entries: entriesRef.current,
						error: message
					};
					if (!mountedRef.current) return;
					setError(message);
					setLoading(false);
				}
			};
			/**
			* Retry-on-mount race: the pack's `/api/channel-pack` route may not be up
			* yet when this section first renders (the login-page plugin mounts the
			* pack asynchronously, and a cold start can take a few seconds). Retry a
			* bounded number of times before showing the empty state, so a slow mount
			* is not misread as "no accounts".
			*/
			const loadWithRetry = async (attempt = 0) => {
				await load();
				if (!mountedRef.current) return;
				if (entriesRef.current.length > 0) return;
				if (attempt >= LOAD_RETRIES) return;
				window.setTimeout(() => {
					if (mountedRef.current) loadWithRetry(attempt + 1);
				}, RETRY_INTERVAL_MS);
			};
			(0, react.useEffect)(() => {
				loadWithRetry();
			}, []);
			const foldFor = (provider) => folds.get(provider);
			const toggleFold = (provider, fold) => {
				setFolds((previous) => {
					const next = new Map(previous);
					next.set(provider, previous.get(provider) === fold ? void 0 : fold);
					return next;
				});
			};
			const enabledFor = (provider, models) => enabled.get(provider) ?? new Set(models.filter((model) => model.disabled !== true).map((model) => model.id));
			const queryFor = (provider) => queries.get(provider) ?? "";
			const setQuery = (provider, query) => {
				setQueries((previous) => {
					const next = new Map(previous);
					if (query === "") next.delete(provider);
					else next.set(provider, query);
					return next;
				});
			};
			/**
			* Narrow one channel's catalogue to whatever the reader typed.
			*
			* Matching on the model *name* and *id* is not enough: the descriptors live
			* in the host catalogue under the same id, and "vision" is exactly the word
			* somebody hunting for an image-capable model reaches for. So the host row
			* is joined in and its description and modalities are searched too.
			*/
			const modelsMatching = (entry, query) => {
				const needle = query.trim().toLowerCase();
				if (needle === "") return entry.models;
				return entry.models.filter((model) => {
					const fact = entry.facts.get(model.id);
					return [
						model.id,
						model.name ?? "",
						model.description ?? "",
						fact?.description ?? "",
						fact?.contextWindow === void 0 ? "" : String(fact.contextWindow),
						...fact?.inputModalities ?? []
					].join(" ").toLowerCase().includes(needle);
				});
			};
			/**
			* Flip one model and write it through immediately.
			*
			* `model.setDisabled` is the endpoint that also broadcasts
			* `llm/adapters-updated`; writing only to the blacklist would leave the picker
			* showing the old catalogue until something else happened to refresh it.
			*/
			const toggleModel = async (provider, modelId, on) => {
				const entry = entries.find((item) => item.channel.id === provider);
				if (entry === void 0) return;
				const next = new Set(enabledFor(provider, entry.models));
				if (on) next.add(modelId);
				else next.delete(modelId);
				setEnabled((previous) => new Map(previous).set(provider, next));
				markBusy(provider, true);
				try {
					const envelope = await callPack("model.setDisabled", {
						provider,
						modelId,
						disabled: !on
					});
					if (!envelope.ok) throw new Error(envelope.error?.message ?? "model.setDisabled refused");
				} catch (cause) {
					setNotice(t?.("channelpool.saveError", { message: cause instanceof Error ? cause.message : String(cause) }) ?? `Could not save: ${cause instanceof Error ? cause.message : String(cause)}`);
					setEnabled((previous) => {
						const restored = new Map(previous);
						restored.delete(provider);
						return restored;
					});
				} finally {
					markBusy(provider, false);
					await load();
				}
			};
			/**
			* Cap one model's advertised window, or take the cap off.
			*
			* The optimistic update writes the number straight onto the row so the radio
			* moves immediately; `load()` re-reads the authoritative table afterwards and
			* corrects it if the pack disagreed.
			*/
			const setContextBudget = async (provider, modelId, budget) => {
				markBusy(provider, true);
				setEntries((previous) => previous.map((entry) => entry.channel.id !== provider ? entry : {
					...entry,
					models: entry.models.map((model) => model.id !== modelId ? model : {
						...model,
						...budget === void 0 ? {
							contextBudget: void 0,
							contextWindow: model.nativeContextWindow ?? model.contextWindow
						} : {
							contextBudget: budget,
							contextWindow: budget,
							nativeContextWindow: model.nativeContextWindow ?? model.contextWindow
						}
					})
				}));
				try {
					const envelope = await setChannelModelContextBudget(provider, modelId, budget);
					if (!envelope.ok) throw new Error(envelope.error?.message ?? "model.setContextBudget refused");
				} catch (cause) {
					setNotice(t?.("channelpool.saveError", { message: cause instanceof Error ? cause.message : String(cause) }) ?? `Could not save: ${cause instanceof Error ? cause.message : String(cause)}`);
				} finally {
					markBusy(provider, false);
					await load();
				}
			};
			/** Enable every published model, or switch all of them off, in one write. */
			const setAllModels = async (provider, on) => {
				const entry = entries.find((item) => item.channel.id === provider);
				if (entry === void 0 || entry.models.length === 0) return;
				setEnabled((previous) => new Map(previous).set(provider, new Set(on ? entry.models.map((model) => model.id) : [])));
				markBusy(provider, true);
				try {
					await callPack("model.setAllDisabled", {
						provider,
						disabled: !on
					});
					setNotice(t?.("channelpool.modelsSaved") ?? "Model selection saved.");
				} catch (cause) {
					setNotice(t?.("channelpool.saveError", { message: cause instanceof Error ? cause.message : String(cause) }) ?? `Could not save: ${cause instanceof Error ? cause.message : String(cause)}`);
					setEnabled((previous) => {
						const restored = new Map(previous);
						restored.delete(provider);
						return restored;
					});
				} finally {
					markBusy(provider, false);
					await load();
				}
			};
			/**
			* Read one channel's balances and merge them into its card.
			*
			* Wave 2 of the load calls this with `quiet` true: the card is already on
			* screen, so the provider must not be marked busy (that would disable the
			* claim button for a network read the reader did not ask for) and a failure
			* must land in `balanceError` rather than in the section-wide notice.
			*
			* `seq` is the load that asked for this read. A reply from an older load
			* cannot overwrite a newer card, which is what the previous version got wrong
			* when a remount overlapped an in-flight refresh.
			*/
			const refreshBalances = async (provider, force, quiet = false, seq) => {
				if (!quiet) markBusy(provider, true);
				setEntries((previous) => previous.map((entry) => entry.channel.id === provider ? {
					...entry,
					balancePending: true
				} : entry));
				try {
					const envelope = await callPack("credits.balances", force ? {
						provider,
						force: true
					} : { provider });
					if (seq !== void 0 && loadSeq.current !== seq) return;
					if (!mountedRef.current) {
						if (envelope.ok) {
							const rows = balancesFrom(envelope);
							poolSnapshot = {
								entries: (poolSnapshot?.entries ?? []).map((entry) => entry.channel.id === provider ? {
									...entry,
									balancePending: false,
									balances: rows
								} : entry),
								error: poolSnapshot?.error
							};
						}
						return;
					}
					if (!envelope.ok) {
						setEntries((previous) => previous.map((entry) => entry.channel.id === provider ? {
							...entry,
							balancePending: false,
							balanceError: envelope.error?.message ?? "credits.balances refused"
						} : entry));
						return;
					}
					const rows = balancesFrom(envelope);
					setEntries((previous) => previous.map((entry) => entry.channel.id === provider ? {
						...entry,
						balancePending: false,
						balanceError: void 0,
						balances: rows
					} : entry));
				} finally {
					if (mountedRef.current && !quiet) markBusy(provider, false);
				}
			};
			const claim = async (provider) => {
				markBusy(provider, true);
				try {
					const envelope = await callPack("credits.claimAll", { provider });
					if (!mountedRef.current) return;
					const result = claimResultFrom(envelope);
					if (result === void 0) setNotice(envelope.error?.message ?? t?.("channelpool.loadError", { message: "credits.claimAll refused" }) ?? "Claim refused.");
					else if (result.claimed > 0) setNotice(t?.("channelpool.claimResult", {
						claimed: result.claimed,
						total: result.claimed + result.alreadyClaimed + result.inactive + result.failed,
						credit: amount(result.totalCredit),
						unit: result.unit === "token" ? t?.("channelpool.creditsToken") ?? "tokens" : t?.("channelpool.creditsUnit") ?? "credits"
					}) ?? `Claimed ${result.claimed}: +${result.totalCredit}.`);
					else setNotice(t?.("channelpool.claimNone", {
						already: result.alreadyClaimed,
						inactive: result.inactive
					}) ?? "Nothing to claim today.");
					if (result?.failed !== void 0 && result.failed > 0) setNotice(t?.("channelpool.claimFailed", { failed: result.failed }) ?? `${result.failed} failed.`);
					await refreshBalances(provider, true);
				} finally {
					if (mountedRef.current) markBusy(provider, false);
				}
			};
			const accountAction = async (provider, accountId, action) => {
				if (action === "delete" && typeof window !== "undefined") {
					const prompt = t?.("channelpool.deleteConfirm") ?? "Remove this account?";
					if (!window.confirm(prompt)) return;
				}
				markBusy(provider, true);
				try {
					const enabledNow = entries.find((item) => item.channel.id === provider)?.accounts.find((account) => account.id === accountId)?.enabled !== false;
					const envelope = await callPack(action === "refresh" ? "account.refresh" : action === "test" ? "account.test" : action === "delete" ? "account.delete" : "account.update", action === "toggle" ? {
						accountId,
						patch: { enabled: !enabledNow }
					} : { accountId });
					if (!mountedRef.current) return;
					if (!envelope.ok) {
						setNotice(envelope.error?.message ?? `${action} refused`);
						return;
					}
					if (action === "test") setNotice(t?.("channelpool.testOk") ?? "Reachable.");
					invalidatePoolSnapshot();
					await load();
				} finally {
					if (mountedRef.current) markBusy(provider, false);
				}
			};
			if (entries.length === 0 && error === void 0) {
				if (!loading) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(react_jsx_runtime.Fragment, {});
				return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("section", {
					className: "dsm-xdpool-cpool",
					"aria-label": t?.("channelpool.title") ?? "Channels",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsm-xdpool-note",
						role: "status",
						children: t?.("channelpool.loading") ?? "Reading scan channels…"
					})
				});
			}
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "dsm-xdpool-cpool",
				"aria-label": t?.("channelpool.title") ?? "Channels",
				children: [
					error === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsm-xdpool-error",
						children: t?.("channelpool.loadError", { message: error }) ?? `Could not load channels: ${error}`
					}),
					notice === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsm-xdpool-note",
						children: notice
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-xdpool-cpool-grid",
						children: [entries.map((entry) => {
							const { channel, accounts, models, facts, balances, statuses, status } = entry;
							const icon = channelIcon(channel.id);
							const tileMark = icon === void 0 ? { initials: channelInitials(channel.name) } : { icon };
							const fold = foldFor(channel.id);
							const enabledIds = enabledFor(channel.id, models);
							const isBusy = busy.has(channel.id);
							const unit = creditUnitLabel(channel, t);
							const total = channel.credits === void 0 ? void 0 : balancesTotal(balances);
							const modelsEnabled = models.filter((model) => enabledIds.has(model.id)).length;
							const statusOf = (accountId) => statuses.find((row) => row.accountId === accountId);
							const enabledAccounts = accounts.filter((account) => account.enabled !== false);
							const allClaimedToday = enabledAccounts.length > 0 && enabledAccounts.every((account) => statusOf(account.id)?.todayCheckedIn === true);
							const balanceOf = (accountId) => balances.find((row) => row.accountId === accountId);
							const query = queryFor(channel.id);
							const visibleModels = modelsMatching(entry, query);
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", {
								className: "dsm-xdpool-cpool-card",
								"data-state": accounts.length > 0 ? "on" : "idle",
								style: { "--dsm-xdpool-cpool-accent": channel.accent },
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "dsm-xdpool-cpool-head",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)(BrandTile, {
												accent: channel.accent,
												glyph: "login",
												...tileMark
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
												className: "dsm-xdpool-cpool-id",
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: channel.name }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: channel.org })]
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "dsm-xdpool-cpool-state",
												"data-on": accounts.length > 0,
												children: accounts.length > 0 ? t?.("channelpool.stateReady") ?? "connected" : t?.("channelpool.stateNone") ?? "not connected"
											})
										]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: "dsm-xdpool-cpool-note",
										children: channel.note
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "dsm-xdpool-cpool-meta",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t?.("channelpool.metaAccounts", {
												enabled: accounts.filter((account) => account.enabled !== false).length,
												total: accounts.length
											}) ?? `${accounts.filter((account) => account.enabled !== false).length}/${accounts.length}` }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: models.length === 0 ? t?.("channelpool.metaModelsUnknown") ?? "models —" : t?.("channelpool.metaModels", {
												enabled: modelsEnabled,
												total: models.length
											}) ?? `${modelsEnabled}/${models.length}` }),
											channel.credits === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "dsm-xdpool-cpool-credit",
												children: entry.balancePending && total === void 0 ? t?.("channelpool.balanceLoading") ?? "…" : total === void 0 ? t?.("channelpool.balanceNone") ?? "—" : `${amount(total)} ${unit}`
											})
										]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "dsm-xdpool-cpool-acts",
										children: [
											channel.credits?.claim === true && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: "dsm-xdpool-btn",
												"data-tone": allClaimedToday ? "claimed" : "primary",
												disabled: isBusy || allClaimedToday,
												onClick: () => {
													claim(channel.id);
												},
												children: isBusy ? t?.("channelpool.claiming") ?? "Claiming…" : allClaimedToday ? t?.("channelpool.claimClaimed") ?? "今日已领取" : t?.("channelpool.claim") ?? "Claim credits"
											}),
											channel.credits !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: "dsm-xdpool-btn",
												"data-tone": "quiet",
												disabled: isBusy,
												onClick: () => {
													refreshBalances(channel.id, true);
												},
												children: t?.("channelpool.refreshBalance") ?? "Refresh balances"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "dsm-xdpool-cpool-acts-gap" }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
												type: "button",
												className: "dsm-xdpool-cpool-fold",
												"aria-expanded": fold === "accounts",
												disabled: accounts.length === 0,
												onClick: () => toggleFold(channel.id, "accounts"),
												children: [
													t?.("channelpool.accounts") ?? "Accounts",
													" (",
													accounts.length,
													")"
												]
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
												type: "button",
												className: "dsm-xdpool-cpool-fold",
												"aria-expanded": fold === "models",
												disabled: models.length === 0,
												onClick: () => toggleFold(channel.id, "models"),
												children: [
													t?.("channelpool.models") ?? "Models",
													" (",
													modelsEnabled,
													"/",
													models.length,
													")"
												]
											})
										]
									}),
									entry.balanceError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: "dsm-xdpool-cpool-balanceerror",
										role: "status",
										children: entry.balanceError
									}),
									fold === "accounts" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
										className: "dsm-xdpool-cpool-acctlist",
										children: accounts.map((account) => {
											const balance = balanceOf(account.id);
											const amount1 = balance === void 0 ? void 0 : balanceAmount(balance.balance);
											const checkin = statusOf(account.id);
											const buckets = balance === void 0 ? [] : balancePackages(balance.balance);
											const disabled = account.enabled === false;
											return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
												className: "dsm-xdpool-cpool-acct",
												"data-off": disabled,
												children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: "dsm-xdpool-cpool-acctname",
														children: account.nickname ?? account.id
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
														className: "dsm-xdpool-cpool-acctmeta",
														children: [disabled ? t?.("channelpool.disableAccount") ?? "disabled" : t?.("channelpool.enableAccount") ?? "enabled", expiryText(account.expiresAt, t) === void 0 ? null : ` · ${expiryText(account.expiresAt, t)}`]
													}),
													checkin?.todayCheckedIn === true && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
														className: "dsm-xdpool-cpool-creditbadge",
														children: [t?.("channelpool.claim") ?? "claimed", typeof checkin.todayCredit === "number" ? ` +${amount(checkin.todayCredit)}` : ""]
													}),
													balance?.error !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: "dsm-xdpool-cpool-acctbalance",
														"data-tone": "err",
														children: balance.error
													}) : amount1 !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
														className: "dsm-xdpool-cpool-acctbalance",
														children: [
															amount(amount1),
															" ",
															unit,
															buckets.length > 0 ? ` · ${t?.("channelpool.balancePackages", { count: buckets.length }) ?? `${buckets.length} window(s)`}` : ""
														]
													}) : null,
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
														className: "dsm-xdpool-cpool-acctacts",
														children: [
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
																type: "button",
																className: "dsm-xdpool-minibtn",
																disabled: isBusy,
																onClick: () => {
																	accountAction(channel.id, account.id, "test");
																},
																children: t?.("channelpool.testAccount") ?? "Test"
															}),
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
																type: "button",
																className: "dsm-xdpool-minibtn",
																disabled: isBusy,
																onClick: () => {
																	accountAction(channel.id, account.id, "refresh");
																},
																children: t?.("channelpool.refreshAccount") ?? "Refresh"
															}),
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
																type: "button",
																className: "dsm-xdpool-minibtn",
																disabled: isBusy,
																onClick: () => {
																	accountAction(channel.id, account.id, "toggle");
																},
																children: disabled ? t?.("channelpool.enableAccount") ?? "Enable" : t?.("channelpool.disableAccount") ?? "Disable"
															}),
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
																type: "button",
																className: "dsm-xdpool-minibtn",
																"data-tone": "danger",
																disabled: isBusy,
																onClick: () => {
																	accountAction(channel.id, account.id, "delete");
																},
																children: t?.("channelpool.deleteAccount") ?? "Remove"
															})
														]
													})
												]
											}, account.id);
										})
									}),
									fold === "models" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "dsm-xdpool-cpool-models",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: "dsm-xdpool-cpool-modelhead",
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t?.("channelpool.metaModels", {
													enabled: modelsEnabled,
													total: models.length
												}) ?? `${modelsEnabled}/${models.length}` }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													className: "dsm-xdpool-cpool-modeltools",
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
														type: "button",
														className: "dsm-xdpool-minibtn",
														disabled: isBusy || models.length === 0,
														onClick: () => {
															setAllModels(channel.id, true);
														},
														children: t?.("channelpool.allModels") ?? "Enable all"
													}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
														type: "button",
														className: "dsm-xdpool-minibtn",
														disabled: isBusy || models.length === 0,
														onClick: () => {
															setAllModels(channel.id, false);
														},
														children: t?.("channelpool.noModelsAll") ?? "Disable all"
													})]
												})]
											}),
											models.length >= MODEL_SEARCH_THRESHOLD && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: "dsm-xdpool-cpool-search",
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
													type: "search",
													className: "dsm-xdpool-cpool-searchbox",
													value: query,
													placeholder: t?.("channelpool.searchModels") ?? "Search models",
													"aria-label": t?.("channelpool.searchModels") ?? "Search models",
													onChange: (event) => {
														setQuery(channel.id, event.target.value);
													}
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "dsm-xdpool-cpool-searchnote",
													role: "status",
													children: query === "" ? t?.("channelpool.searchHint") ?? "Matches name, id, description and image input" : t?.("channelpool.searchHit", { count: visibleModels.length }) ?? `${visibleModels.length} of ${models.length}`
												})]
											}),
											visibleModels.length === 0 && models.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
												className: "dsm-xdpool-cpool-empty",
												children: t?.("channelpool.searchNone", { query: query.trim() }) ?? `No model matches “${query.trim()}”.`
											}) : models.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
												className: "dsm-xdpool-cpool-empty",
												children: entry.modelError === void 0 ? t?.("channelpool.noModels") ?? "No models published yet." : t?.("channelpool.modelError", { message: entry.modelError }) ?? `Could not list models: ${entry.modelError}`
											}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
												className: "dsm-xdpool-cpool-modellist",
												children: visibleModels.map((model) => {
													const fact = facts.get(model.id);
													const on = enabledIds.has(model.id);
													const modalities = model.inputModalities ?? fact?.inputModalities;
													const merged = modelFactsFor({
														contextWindow: model.contextWindow ?? fact?.contextWindow,
														maxOutputTokens: model.maxTokens ?? fact?.maxTokens,
														vision: modalities?.includes("image") === true || modalities?.includes("images") === true,
														supportedEfforts: model.reasoning === true ? ["thinking"] : void 0,
														description: model.description ?? fact?.description
													});
													const recuse = recommendUse(merged);
													const native = model.nativeContextWindow ?? model.contextWindow;
													const capped = native !== void 0 && native > CONTEXT_BUDGET_DEFAULT;
													const budget = model.contextBudget ?? native;
													return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
														className: "dsm-xdpool-cpool-modelrow",
														"data-off": !on,
														children: [
															/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
																className: "dsm-xdpool-cpool-modelrow-toggle",
																children: [
																	/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
																		type: "checkbox",
																		checked: on,
																		disabled: isBusy,
																		onChange: () => {
																			toggleModel(channel.id, model.id, !on);
																		}
																	}),
																	/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																		className: "dsm-xdpool-cpool-modelname",
																		title: model.id,
																		children: model.name ?? model.id
																	}),
																	model.isFree === true && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																		className: "dsm-xdpool-cpool-tag",
																		"data-tone": "free",
																		children: t?.("channelpool.modelFree") ?? "free"
																	}),
																	model.dead === true && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																		className: "dsm-xdpool-cpool-tag",
																		"data-tone": "dead",
																		children: t?.("channelpool.modelDead") ?? "dead"
																	})
																]
															}),
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModelFactsRow, {
																facts: merged,
																className: "dsm-xdpool-cpool-mfacts",
																t
															}),
															recuse === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
																className: "dsm-xdpool-recuse",
																children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																	className: "dsm-xdpool-recuse-label",
																	children: t?.("recuse.label") ?? "推荐用途"
																}), recuse]
															}),
															capped && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("fieldset", {
																className: "dsm-xdpool-model-budget dsm-xdpool-cpool-budget",
																"aria-label": t?.("channelpool.modelBudget") ?? "Context window",
																children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
																	type: "radio",
																	name: `cpool-budget-${channel.id}-${model.id}`,
																	checked: budget === CONTEXT_BUDGET_DEFAULT,
																	disabled: isBusy,
																	onChange: () => {
																		setContextBudget(channel.id, model.id, CONTEXT_BUDGET_DEFAULT);
																	}
																}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: formatModelCapacity(CONTEXT_BUDGET_DEFAULT) })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
																	type: "radio",
																	name: `cpool-budget-${channel.id}-${model.id}`,
																	checked: budget === native,
																	disabled: isBusy,
																	onChange: () => {
																		setContextBudget(channel.id, model.id, void 0);
																	}
																}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: formatModelCapacity(native) })] })]
															})
														]
													}, model.id);
												})
											})
										]
									}),
									status?.closed === true && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: "dsm-xdpool-cpool-note",
										children: t?.("channelpool.everyModelOff", { total: status.modelsTotal }) ?? `All ${status.modelsTotal} models are switched off.`
									})
								]
							}, channel.id);
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dsm-xdpool-cpool-acts",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dsm-xdpool-btn",
								onClick: () => {
									setEnabled(/* @__PURE__ */ new Map());
									load();
								},
								children: t?.("channelpool.retry") ?? "Reload"
							})
						})]
					})
				]
			});
		}
		//#endregion
		//#region src/version.ts
		/**
		* The plugin's own version, hand-maintained for the browser bundle.
		*
		* The card ships as `lib/client.js`, served to the host dialog as a browser
		* script: `package.json` is neither reachable nor guaranteed to be the file
		* the running build came from. A manifest lying next to the code is worse than
		* a number a test keeps honest.
		*
		* `tests/version-sync.test.ts` fails when this drifts from `package.json`, so
		* the release checklist cannot ship a card that calls itself the wrong version.
		*
		* @module dsh-xdpool/version
		*/
		const POOL_VERSION = "2.6.1";
		//#endregion
		//#region src/client/PoolCard.tsx
		/**
		* XD Pool card contributed to DSH Plugin configuration.
		*
		* The card body mirrors the LaoDing plugin family used by dingminhua's
		* `dsh-connect-workbuddy`: a small status row (dot + count + Rescan / Clear
		* cooldowns buttons), then a per-account panel showing label / status tag /
		* token expiry / cooldown info / credit packages, then the model directory
		* with per-model free/limited/night/image badges and context size.
		*
		* Rendered as a full settings page (see `client/index.tsx`): the shell gives it
		* a left-nav row and a scrollable content column, so everything is visible at
		* once — a fold inside the page only hid the pool behind a click.
		*
		* @module dsh-xdpool/client/PoolCard
		*/
		/**
		* Default context window the card offers as the "capped" choice, in tokens.
		* Mirrors the host-side DEFAULT_CONTEXT_BUDGET; declared here rather than
		* imported, because the browser bundle must not pull in the host entry.
		*/
		const DEFAULT_CONTEXT_BUDGET = 2e5;
		const POLL_INTERVAL_MS = 3e4;
		/** Inject or refresh the shared card CSS for the current client bundle. */
		if (typeof document !== "undefined") {
			const cssId = "dsh-xdpool/client.css";
			const existing = document.querySelector(`style[data-plugin-css="${cssId}"]`);
			if (existing !== null) existing.textContent = POOL_CARD_CSS;
			else {
				const styleTag = document.createElement("style");
				styleTag.dataset.plugin = "dsh-xdpool";
				styleTag.dataset.pluginCss = cssId;
				styleTag.textContent = POOL_CARD_CSS;
				document.head.appendChild(styleTag);
			}
		}
		function formatNumber(value) {
			if (value === void 0) return "–";
			return new Intl.NumberFormat(void 0, { maximumFractionDigits: 0 }).format(value);
		}
		function formatTime(value) {
			return new Intl.DateTimeFormat(void 0, {
				month: "2-digit",
				day: "2-digit",
				hour: "2-digit",
				minute: "2-digit"
			}).format(new Date(value));
		}
		function formatDateTime(value) {
			if (value === void 0) return "";
			const ms = Date.parse(value);
			if (Number.isNaN(ms)) return value;
			return new Intl.DateTimeFormat(void 0, {
				month: "2-digit",
				day: "2-digit",
				hour: "2-digit",
				minute: "2-digit"
			}).format(new Date(ms));
		}
		/**
		* The automation jobs, in the order they run.
		*
		* The order is the contract: the report has to land before the task pass, or
		* the task pass reads progress the report would have lit. `hoursOf` reads the
		* matching hour list off the status document so the panel stays in step with
		* whatever schedule the scheduler is actually running on.
		*/
		/**
		* How long to watch a manual run before giving up on it.
		*
		* A pass runs one upstream call per account per job, so ~30s for a handful of
		* accounts. The bound exists so a wedged run cannot spin the button forever;
		* the run itself keeps going in the background either way.
		*/
		const AUTOMATION_POLL_MS = 2e3;
		const AUTOMATION_POLL_ATTEMPTS = 90;
		const AUTOMATION_JOBS = [
			"checkin",
			"report",
			"tasks",
			"streak",
			"travel",
			"compensation"
		];
		/**
		* The hour list to save for one job: what the card holds, or the default.
		*
		* Mirrors the host's own fallback (`hoursOrDefault` in `scheduler.ts`). An
		* empty list must resolve to the default on BOTH sides, or the card would save
		* a schedule the scheduler then refuses to run — the exact silent standstill
		* this pair of fixes exists to remove.
		*/
		function hoursOrDefault(configured, fallback) {
			return configured !== void 0 && configured.length > 0 ? [...configured] : [...fallback];
		}
		/** Read one job's configured hours off the status document. */
		function automationHours(status, kind) {
			const automation = status.automation;
			if (automation === void 0) return [];
			switch (kind) {
				case "report": return automation.reportHours;
				case "tasks": return automation.taskHours;
				case "checkin": return automation.checkinHours;
				case "streak": return automation.streakHours;
				case "travel": return automation.travelHours;
				case "compensation": return automation.compensationHours;
			}
		}
		/** Read one job's last-run record off the status document. */
		function automationJob(status, kind) {
			return status.automation?.jobs[kind];
		}
		function formatCapacity(value) {
			if (value === void 0) return "";
			if (value >= 1e6 && value % 1e6 === 0) return `${value / 1e6}M`;
			if (value >= 1e3 && value % 1e3 === 0) return `${value / 1e3}K`;
			return String(value);
		}
		/**
		* The five ways the pool can hand out accounts.
		*
		* Order is the reading order of the picker: the recommended mode first, then
		* the two cache-friendly extremes, then the two spreading modes. The row is
		* laid out one chip per mode, so this list length is also the column count.
		*/
		/**
		* The two supplier cards, in the order they are shown.
		*
		* Both are always rendered, so an empty side reads as "not signed in here
		* yet" rather than the card appearing only after the user has already signed
		* in. Keeping the list here (rather than a literal pair in the JSX) is what lets
		* the poll loop fetch every card without a second source of truth.
		*/
		const REGION_CARDS = ["cn", "global"];
		/** The settings key holding each region's model selection. */
		const MODEL_SELECTION_KEY = {
			cn: "modelSelectionCn",
			global: "modelSelectionGlobal"
		};
		/**
		* Sum one region's daily automation earnings.
		*
		* Summed from the per-account counters rather than kept separately, so the
		* panel total and the per-account lines can never disagree. Takes the status
		* document as an argument rather than closing over one, because each card sums
		* its own accounts.
		*/
		function automationTotalsOf(status) {
			return Object.values(status?.automation?.earningsToday ?? {}).reduce((sum, entry) => ({
				credit: sum.credit + entry.credit,
				energy: sum.energy + entry.energy,
				claimed: sum.claimed + entry.claimed,
				checkinCredit: sum.checkinCredit + entry.checkinCredit,
				bonusCredit: sum.bonusCredit + entry.bonusCredit,
				travelCredit: sum.travelCredit + entry.travelCredit,
				compensationCredit: sum.compensationCredit + entry.compensationCredit
			}), {
				credit: 0,
				energy: 0,
				claimed: 0,
				checkinCredit: 0,
				bonusCredit: 0,
				travelCredit: 0,
				compensationCredit: 0
			});
		}
		/**
		* How much credit is left in this lane, already formatted.
		*
		* Three states, never collapsed into two:
		*  - `undefined` when nothing has reported a balance yet, rendered as an em
		*    dash. A zero here would be a claim nobody made.
		*  - `'0'` when the gateway answered and the answer was zero. That IS a fact.
		*  - a formatted number when a balance came back.
		*
		* The read is best-effort per account: one dead credential must not make the
		* whole lane read as "no credit", so accounts whose balance failed to load are
		* skipped and only the ones that actually answered are summed. When none
		* answered, the result is `undefined` rather than a confident zero.
		*/
		function creditLeftOf(status) {
			const reported = (status?.accounts ?? []).map((account) => account.credits?.total).filter((value) => typeof value === "number" && Number.isFinite(value));
			return reported.length === 0 ? void 0 : formatNumber(reported.reduce((sum, value) => sum + value, 0));
		}
		/** Build the draft from the server's selection + catalog flags. */
		function draftFromStatus(status) {
			const selection = status.selection;
			const enabled = selection.enabledModelIds;
			const images = selection.imageModelIds;
			const budgets = selection.contextBudgets;
			const out = {};
			for (const model of status.models) {
				const entry = {
					enabled: enabled === void 0 || enabled.includes(model.id),
					images: images === void 0 ? model.supportsImages : images.includes(model.id)
				};
				const budget = budgets?.[model.id];
				if (budget !== void 0) entry.budget = budget;
				out[model.id] = entry;
			}
			return out;
		}
		/** True when the draft differs from what the server last reported. */
		function draftIsDirty(status, draft) {
			const selection = status.selection;
			const enabled = new Set(selection.enabledModelIds ?? status.models.filter((m) => m.enabled).map((m) => m.id));
			const images = new Set(selection.imageModelIds ?? status.models.filter((m) => m.supportsImages).map((m) => m.id));
			const budgets = selection.contextBudgets ?? {};
			for (const model of status.models) {
				const entry = draft[model.id];
				if (entry === void 0) continue;
				if (entry.enabled !== enabled.has(model.id)) return true;
				if (entry.images !== images.has(model.id)) return true;
				if ((budgets[model.id] ?? model.nativeContextWindow) !== (entry.budget ?? model.nativeContextWindow)) return true;
			}
			return false;
		}
		/** Absolute expiry with the time of day: the upstream grants one-off packages at
		*  arbitrary clock times, so "expires 09/19 15:36" is what the user needs — a
		*  date alone would read as if it lapsed at midnight. */
		function formatExpiry(ms) {
			if (ms === void 0 || !Number.isFinite(ms)) return "";
			return new Intl.DateTimeFormat(void 0, {
				month: "2-digit",
				day: "2-digit",
				hour: "2-digit",
				minute: "2-digit",
				hour12: false
			}).format(new Date(ms));
		}
		/** Whole days until `ms`, floored at 0; undefined when there is no deadline. */
		function daysUntil(ms) {
			if (ms === void 0 || !Number.isFinite(ms)) return void 0;
			return Math.max(0, Math.floor((ms - Date.now()) / 864e5));
		}
		/** True when a one-off package lapses inside the "expiring soon" window. */
		function isExpiringSoon(pack) {
			if (pack.monthly === true) return false;
			const days = daysUntil(pack.expiresAtMs);
			return days !== void 0 && days <= 3;
		}
		/**
		* The promo badge for one model, or undefined when it has none.
		*
		* Two sources, because the gateway models one of them and not the other:
		*
		*  - `free` comes from the CREDIT MULTIPLIER. Neither gateway ever sends a
		*    literal `free` tag, but it does price its free models at `credits: "x0.00"`
		*    (CN `hy3`), so the multiplier is the honest signal.
		*  - the NIGHT window comes from {@link promoStatusFor}, because the gateway
		*    charges `x0.29` for `hy4-preview` around the clock and has no field for a
		*    time-of-day rule. See that module for why the 14-day newcomer allowance is
		*    deliberately not modelled.
		*
		* `region` is threaded through because the campaigns are REGIONAL: the
		* Hy3 / Hy4-preview extension is a domestic promotion, so a global roster must
		* not pick up a discount that gateway does not offer.
		*/
		function tagFor(model, now, region) {
			const tags = model.tags ?? [];
			if (promoStatusFor(model, now, region)?.kind === "night") return "night";
			const freeKind = freeBadgeKind(model);
			if (freeKind === "badge") return "badge";
			if (freeKind === "generic") return "free";
			if (tags.includes("limited-free")) return "limited";
			if (tags.includes("night-discount")) return "night";
			if (badgeLabels(tags).length > 0) return "badge";
		}
		/** Render pool health, per-account credits/cooldown, and the model directory. */
		function PoolCard({ t, settingsScope }) {
			const settingsWritable = settingsScope?.getSnapshot().writable === true;
			/**
			* Whether the plugin owns a row in the left sidebar (issue #70).
			*
			* Seeded from, and kept in step with, the settings mirror rather than from the
			* pool status: the row is registered by `apply()`, before any card exists, and
			* both sides must answer the same question the same way.
			*/
			const [sidebarRow, setSidebarRowState] = (0, react.useState)(() => readSidebarRow(settingsScope));
			const [sidebarRowBusy, setSidebarRowBusy] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				const unsubscribe = settingsScope?.subscribe?.(() => {
					setSidebarRowState(readSidebarRow(settingsScope));
				});
				return () => {
					unsubscribe?.();
				};
			}, [settingsScope]);
			/** Which region tab is showing. A CN-only install never leaves this. */
			const [activeRegion, setActiveRegion] = (0, react.useState)("cn");
			/**
			* Last-known status per region. Kept per region (not a single slot) so
			* switching tabs shows the other side's last answer immediately instead of
			* a blank frame, and the tab dots stay meaningful while a tab is hidden.
			*/
			const [statusByRegion, setStatusByRegion] = (0, react.useState)({});
			/**
			* Which disclosure panes are open, keyed by pane id.
			*
			* A map rather than one boolean per pane because there are four per lane and
			* they are independent: opening the domestic account list must not close the
			* international model list, and the ids are already unique per lane.
			*
			* All panes start closed. A card that arrives with a 200-row account list
			* already expanded is a wall of text where the user asked for a summary, and
			* the disclosure is one click away.
			*/
			/**
			* Which disclosure pane is open, keyed by pane id.
			*
			* ACCORDION WITHIN A CARD: opening one pane closes the others of the SAME
			* card. The panes are tall — the account list is one row per account and the
			* model list is one card per model — so two open at once means the second one
			* is off-screen below the first, and the user who just clicked "Models"
			* sees nothing happen (reported as "点了咋没起作用，实际都续在后面").
			*
			* Cross-CARD independence is kept: the pane ids carry the region, so opening
			* the domestic model list must not close the international one. Collapsing is
			* scoped to the prefix before the last separator.
			*
			* All panes start closed: a card that arrives with a 200-row account list
			* already expanded is a wall of text where the user asked for a summary.
			*/
			const [openedPanes, setOpenedPanes] = (0, react.useState)({});
			const setPane = (paneId, open) => {
				setOpenedPanes((prev) => {
					if (open === false) return prev[paneId] === false ? prev : {
						...prev,
						[paneId]: false
					};
					const cardPrefix = paneId.slice(0, paneId.lastIndexOf("-"));
					const next = {};
					for (const [id, value] of Object.entries(prev)) {
						if (id !== paneId && value === true && id.startsWith(`${cardPrefix}-`)) continue;
						next[id] = value;
					}
					next[paneId] = true;
					return next;
				});
			};
			const [error, setError] = (0, react.useState)(void 0);
			/**
			* The scan-login roster, read only for the two lanes' own branding.
			*
			* Both pool lanes ARE two of the thirteen scan-login channels, so the pool
			* page asks the login page's roster who its vendors are instead of keeping a
			* second copy of their names. Nothing else is read from it: the user removed
			* the mirrored channel list ("在扫码登录页登录过什么，这里就同步显示什么，这个不需要"),
			* and a roster with no per-account state behind it could only ever have shown
			* thirteen rows of zero. What a channel actually has stays where it is
			* earned — on the login page, and in the counts the pack reports there.
			*/
			const [channels, setChannels] = (0, react.useState)([]);
			/**
			* Which page is showing.
			*
			* `pool` is the WorkBuddy account pool this page has always shown.
			* `aggregate` and `channels` are sibling views, not sections inside the pool
			* body: they read different documents and have their own fetch lifecycles, so
			* switching pages must not leave the pool's poll feeding a hidden view, and
			* neither may be re-mounted by a pool refresh.
			*
			* The initial value comes from `localStorage`. Reading it during the initial
			* render (rather than in an effect) means the card never paints the pool
			* page and then swaps to another one, which on a slow paint is a visible
			* flash of the wrong page's content.
			*/
			const shellTabs = [
				{
					id: "pool",
					label: t?.("shell.tabPool") ?? "Account pool"
				},
				{
					id: "channels",
					label: t?.("shell.tabChannels") ?? "Login channels"
				},
				{
					id: "aggregate",
					label: t?.("shell.tabAggregate") ?? "Providers"
				},
				{
					id: "ledger",
					label: t?.("shell.tabLedger") ?? "Dashboard"
				},
				{
					id: "routing",
					label: t?.("shell.tabRouting") ?? "Routing"
				},
				{
					id: "gateway",
					label: t?.("shell.tabGateway") ?? "Gateway"
				}
			];
			const [page, setPage] = (0, react.useState)(() => initialShellTab(rememberedShellTab(), shellTabs));
			/**
			* Which side an in-flight action belongs to.
			*
			* Both region cards are on screen at once now, so a single boolean would let
			* a click on the CN card paint "Detecting…" on the international card too.
			* The flag carries the region it belongs to: the pane that owns it shows the
			* progress wording, and BOTH panes stay disabled while it runs so a second
			* click cannot fire the same request twice.
			*/
			const [busyRegion, setBusyRegion] = (0, react.useState)(void 0);
			const [cooldownBusyRegion, setCooldownBusyRegion] = (0, react.useState)(void 0);
			/** Model-catalog refresh in flight (separate from the account rescan). */
			const [catalogBusyRegion, setCatalogBusyRegion] = (0, react.useState)(void 0);
			const [automationBusyRegion, setAutomationBusyRegion] = (0, react.useState)(void 0);
			/** The automation job currently running from the card, if any. */
			const [automationRun, setAutomationRun] = (0, react.useState)(void 0);
			/** The region whose automation run was started, so only that card spins. */
			const [automationRunRegion, setAutomationRunRegion] = (0, react.useState)(void 0);
			/** Region whose model draft is being written, for the same reason. */
			const [savingModelsRegion, setSavingModelsRegion] = (0, react.useState)(void 0);
			/** Account id whose reserved-credit floor is being saved, if any. */
			const [reserveBusy, setReserveBusy] = (0, react.useState)(void 0);
			const [flash, setFlash] = (0, react.useState)(void 0);
			/** Account id whose daily claim is currently in flight. */
			const [checkinBusyId, setCheckinBusyId] = (0, react.useState)(void 0);
			/** Account id whose enable/disable switch is in flight, if any. */
			const [accountBusyId, setAccountBusyId] = (0, react.useState)(void 0);
			/**
			* The usage aggregate, or undefined until its first answer.
			*
			* Deliberately NOT filed per region, unlike `statusByRegion`: one recorder
			* backs both gateways and every row carries its own region, so filtering
			* here would hide half the calls and leave the panel total disagreeing with
			* the number the recorder actually reports.
			*/
			const [usage, setUsage] = (0, react.useState)(void 0);
			/**
			* Draft model selection. `undefined` means "no local edits"; once a checkbox
			* is touched the draft takes over and is what the Save button posts. Discard
			* drops it back to the copy the server last reported.
			*/
			const [draftByRegion, setDraftByRegion] = (0, react.useState)({});
			/**
			* Whether a region's model pane is showing the WHOLE roster.
			*
			* Per region, and default off, because the pane opens on a card the user
			* scrolled to reach: fourteen full rows of mostly-disabled models pushed
			* everything else a screen and a half further down (the reported "无限往下
			* 续"). The enabled rows are what "my models" means; the rest are one click
			* away and the button says how many there are.
			*/
			const [showAllModels, setShowAllModels] = (0, react.useState)({});
			/**
			* The draft one region card is holding, if it holds any.
			*
			* Keyed by region rather than "whatever tab is in front": the two gateways
			* have different rosters, so edits made on the CN card must not leak into
			* the international list when the user works on both at once.
			*/
			const setDraftFor = (region, next) => {
				setDraftByRegion((prev) => ({
					...prev,
					[region]: next
				}));
			};
			const mounted = (0, react.useRef)(true);
			(0, react.useEffect)(() => {
				mounted.current = true;
				return () => {
					mounted.current = false;
				};
			}, []);
			/**
			* Connectivity readings, keyed by the row's model id.
			*
			* Kept as a map rather than one slot because the user will click a second row
			* while the first answer is still arriving, and a single slot would make the
			* first row's result vanish behind the second row's.
			*
			* A reading is NEVER recomputed by the 5-second poll. That poll exists to keep
			* account state fresh; if it also refreshed probe results, a model that had
			* stopped answering would keep showing its last good answer forever, and the
			* button would read as broken. Measurements therefore live until the user
			* clicks again — which is also the only honest lifetime for a number that
			* describes a moment in time.
			*/
			const [probes, setProbes] = (0, react.useState)({});
			/** The model whose probe is in flight, if any. */
			const [probingModel, setProbingModel] = (0, react.useState)(void 0);
			/**
			* Send one real request to one model and record what came back.
			*
			* One probe at a time on purpose. Every call spends the user's credits, so a
			* user holding down a row must not be able to queue ten of them by accident;
			* and a single in-flight marker keeps the button disabled exactly where the
			* user is looking instead of greying out the whole list.
			*/
			const testModel = (0, react.useCallback)(async (provider, model) => {
				if (probingModel !== void 0) return;
				setProbingModel(model);
				try {
					const response = await fetch(POOL_MODEL_PROBE_PATH, {
						method: "POST",
						headers: { "content-type": "application/json" },
						credentials: "same-origin",
						body: JSON.stringify({
							provider,
							model
						})
					});
					const body = await response.json();
					const reading = "ok" in body ? {
						ok: body.ok,
						outputChars: typeof body.outputChars === "number" ? body.outputChars : 0,
						...typeof body.firstFrameMs === "number" ? { firstFrameMs: body.firstFrameMs } : {},
						...typeof body.error === "string" ? { error: body.error } : {}
					} : {
						ok: false,
						outputChars: 0,
						error: typeof body.error === "string" ? body.error : `HTTP ${response.status}`
					};
					setProbes((prev) => ({
						...prev,
						[model]: reading
					}));
				} catch (error) {
					setProbes((prev) => ({
						...prev,
						[model]: {
							ok: false,
							outputChars: 0,
							error: error instanceof Error && error.message !== "" ? error.message : "the probe could not be sent"
						}
					}));
				} finally {
					setProbingModel(void 0);
				}
			}, [probingModel]);
			/**
			* Fetch one region's status. `region` is a parameter rather than a closure
			* read so the callback identity does not change with the tab: the polling
			* effect can key off it without restarting on every switch, and each region's
			* last answer stays in its own slot (see `statusByRegion`).
			*/
			const refresh = (0, react.useCallback)(async (region, signal) => {
				try {
					const response = await fetch(`${POOL_STATUS_PATH}?region=${region}`, {
						headers: { accept: "application/json" },
						credentials: "same-origin",
						...signal === void 0 ? {} : { signal }
					});
					const value = await response.json().catch(() => void 0);
					if (!response.ok) throw new Error(`HTTP ${response.status}`);
					if (mounted.current && signal?.aborted !== true) {
						setStatusByRegion((prev) => ({
							...prev,
							[region]: value
						}));
						setError(void 0);
					}
					return value;
				} catch (cause) {
					if (mounted.current && signal?.aborted !== true) setError(cause instanceof Error ? cause.message : String(cause));
					return;
				}
			}, []);
			/**
			* Read the scan-login roster, for the two lanes' vendor names and nothing else.
			*
			* Called once on mount rather than on the poll timer: the roster this plugin
			* publishes is static for the life of the process, so a timer would only
			* re-read a document that cannot have changed. A failure is swallowed for the
			* same reason the usage panel's is — `brandOf` falls back to the tab label,
			* which is thin but true, and a lane that refuses to draw because a second
			* document did not arrive would be a worse answer than the one it has.
			*/
			const refreshChannels = (0, react.useCallback)(async (signal) => {
				try {
					const response = await fetch(POOL_CHANNELS_PATH, {
						headers: { accept: "application/json" },
						credentials: "same-origin",
						...signal === void 0 ? {} : { signal }
					});
					if (!response.ok) throw new Error(`HTTP ${response.status}`);
					const roster = (await response.json().catch(() => void 0))?.channels;
					if (mounted.current && signal?.aborted !== true && Array.isArray(roster)) setChannels(roster);
				} catch {}
			}, []);
			/**
			* Poll every region card that is on screen.
			*
			* Both cards render at once now, so the old single-region tick would have
			* left the other card's numbers frozen while the user read them. The card
			* the user is looking at is fetched first so a slow second answer cannot
			* delay it.
			*
			* `activeRegion` stays in the dependency list on purpose: it is what orders
			* the fetch, so switching which card is in front re-issues immediately
			* instead of waiting for the next tick.
			*/
			(0, react.useEffect)(() => {
				const controller = new AbortController();
				const poll = () => {
					for (const region of [activeRegion, ...REGION_CARDS.filter((other) => other !== activeRegion)]) refresh(region, controller.signal);
				};
				poll();
				const timer = window.setInterval(poll, POLL_INTERVAL_MS);
				return () => {
					window.clearInterval(timer);
					controller.abort();
				};
			}, [refresh, activeRegion]);
			/**
			* Read the scan-login roster once, and again whenever the user comes back to
			* this page.
			*
			* Re-reading on return is cheap and keeps the lane's vendor name honest. The
			* roster is a local document that cannot change while the process lives, so
			* this is about the user coming BACK to a card they had left on another page —
			* not about polling something that moves.
			*/
			(0, react.useEffect)(() => {
				if (page !== "pool") return;
				const controller = new AbortController();
				refreshChannels(controller.signal);
				return () => {
					controller.abort();
				};
			}, [page, refreshChannels]);
			/**
			* Fetch the usage aggregate.
			*
			* A failure is swallowed on purpose. The panel failing to read its numbers
			* must not blank the card or raise the shared error banner: the pool still
			* serves conversations perfectly well, and the next poll tries again. Keeping
			* the previous answer is also the honest rendering of "I could not refresh
			* this", where clearing would claim "there has been no usage at all".
			*/
			const refreshUsage = (0, react.useCallback)(async (signal) => {
				try {
					const response = await fetch(POOL_USAGE_PATH, {
						headers: { accept: "application/json" },
						credentials: "same-origin",
						...signal === void 0 ? {} : { signal }
					});
					const value = await response.json().catch(() => void 0);
					if (!response.ok) return;
					if (mounted.current && signal?.aborted !== true) setUsage(value);
				} catch {}
			}, []);
			(0, react.useEffect)(() => {
				const controller = new AbortController();
				refreshUsage(controller.signal);
				const timer = window.setInterval(() => {
					refreshUsage(controller.signal);
				}, POLL_INTERVAL_MS);
				return () => {
					window.clearInterval(timer);
					controller.abort();
				};
			}, [refreshUsage]);
			/**
			* Re-scan the credential folders for one region.
			*
			* Takes the region explicitly now that both cards are on screen: a click on
			* the CN card must re-read the CN folders, and the flash it reports belongs to
			* that card. The button beside it ("clear all cooldowns") stays available on
			* both sides, so the argument is what tells them apart.
			*/
			const rescan = async (region) => {
				setBusyRegion(region);
				setFlash(void 0);
				try {
					const response = await fetch(POOL_RESCAN_PATH, {
						method: "POST",
						headers: { accept: "application/json" },
						credentials: "same-origin"
					});
					const body = await response.json();
					if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
					await refresh(region);
					if (mounted.current) setFlash(t?.("row.accountsRescanned", { count: body.accounts ?? 0 }) ?? "");
				} catch (cause) {
					if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
				} finally {
					if (mounted.current) setBusyRegion(void 0);
				}
			};
			/**
			* Re-fetch the upstream model catalog for both regions.
			*
			* Its own action, and its own BUTTON, because the account rescan beside it
			* could not do this job: when the startup fetch failed, the picker held the
			* shorter built-in list and "detect accounts again" left it untouched, so the
			* only recovery was restarting DSH. Users reasonably assumed the button
			* covered both.
			*
			* The route itself still refreshes BOTH regions (that is the recovery being
			* offered), but the report and the flash are filed under the region whose
			* button was pressed, so the number quoted is the one that card is showing.
			*/
			const refreshCatalog = async (region) => {
				setCatalogBusyRegion(region);
				setFlash(void 0);
				try {
					const response = await fetch(POOL_CATALOG_REFRESH_PATH, {
						method: "POST",
						headers: { accept: "application/json" },
						credentials: "same-origin"
					});
					const body = await response.json();
					if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
					for (const other of REGION_CARDS) await refresh(other);
					const here = body.regions?.[region];
					if (mounted.current) setFlash(here?.source === "live" ? t?.("row.catalogRefreshed", { count: here.models ?? 0 }) ?? "" : t?.("row.catalogRefreshOffline") ?? "");
				} catch (cause) {
					if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
				} finally {
					if (mounted.current) setCatalogBusyRegion(void 0);
				}
			};
			const resetCooldowns = async (region) => {
				setCooldownBusyRegion(region);
				setFlash(void 0);
				try {
					const response = await fetch(POOL_RESET_COOLDOWN_PATH, {
						method: "POST",
						headers: { accept: "application/json" },
						credentials: "same-origin"
					});
					if (!response.ok) throw new Error(`HTTP ${response.status}`);
					await refresh(region);
					if (mounted.current) setFlash(t?.("row.resetCooldownsDone") ?? "");
				} catch (cause) {
					if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
				} finally {
					if (mounted.current) setCooldownBusyRegion(void 0);
				}
			};
			/**
			* Claim one account's daily check-in. The account id travels in the body so
			* the Host can never guess: a click on account B's button can only ever
			* collect account B's reward. The status is re-read afterwards so the card
			* reflects the new streak / total without waiting for the next poll.
			*/
			const claimCheckin = async (region, accountId) => {
				setCheckinBusyId(accountId);
				setFlash(void 0);
				try {
					const response = await fetch(POOL_CHECKIN_PATH, {
						method: "POST",
						headers: {
							accept: "application/json",
							"content-type": "application/json"
						},
						credentials: "same-origin",
						body: JSON.stringify({ accountId })
					});
					const body = await response.json().catch(() => void 0);
					if (!response.ok) throw new Error(body?.error ?? `HTTP ${response.status}`);
					await refresh(region);
					const credit = body?.claim?.credit ?? 0;
					if (mounted.current) setFlash(t?.("row.checkinClaimedReward", { credit: formatNumber(credit) }) ?? `Claimed +${formatNumber(credit)} credits`);
				} catch (cause) {
					if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
				} finally {
					if (mounted.current) setCheckinBusyId(void 0);
				}
			};
			/**
			* Switch one account in or out of the pool.
			*
			* The id travels in the body and the host validates it against the accounts it
			* really knows, so a stale tab cannot write an orphan id. Disabling only stops
			* the account from being picked — it stays listed so it can be turned back on —
			* and the change is saved through the settings section, so it survives a
			* restart and is re-applied after every re-scan.
			*/
			/**
			* The status of one region, or undefined until its first answer.
			*
			* Per region because both cards render at once: a click on the CN card must
			* read CN accounts, and a write derived from "the accounts this card shows"
			* has to come from the same slice or it would file a CN account id into the
			* international list.
			*/
			const statusOf = (region) => statusByRegion[region];
			const toggleAccountDisabled = async (region, accountId, disabled) => {
				const write = settingsScope?.set;
				if (write === void 0) {
					setError(t?.("row.modelsSaveError", { message: "settings scope is read-only" }) ?? "settings scope is read-only");
					return;
				}
				setAccountBusyId(accountId);
				setFlash(void 0);
				try {
					const current = (statusOf(region)?.accounts ?? []).filter((account) => account.disabled === true).map((account) => account.id);
					const next = disabled ? current.includes(accountId) ? current : [...current, accountId] : current.filter((id) => id !== accountId);
					await write.call(settingsScope, "disabledAccountIds", next);
					await refresh(region);
				} catch (cause) {
					const message = cause instanceof Error ? cause.message : String(cause);
					if (mounted.current) setError(t?.("row.accountToggleError", { message }) ?? "Could not switch the account: " + message);
				} finally {
					if (mounted.current) setAccountBusyId(void 0);
				}
			};
			/**
			* Throw one account out of the pool for good, or take it back.
			*
			* The host owns the ignore file, so this is a plain route call: no settings
			* scope is involved, which is also why it keeps working on a profile whose
			* settings section is read-only.
			*/
			const setAccountIgnored = async (region, accountId, ignored) => {
				setAccountBusyId(accountId);
				setFlash(void 0);
				try {
					const response = await fetch(POOL_ACCOUNT_IGNORE_PATH, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							accountId,
							ignored
						})
					});
					if (!response.ok) {
						const detail = await response.json().catch(() => ({}));
						throw new Error(detail.error ?? `HTTP ${response.status}`);
					}
					await refresh(region);
				} catch (cause) {
					const message = cause instanceof Error ? cause.message : String(cause);
					if (mounted.current) setError(t?.("row.accountIgnoreError", { message }) ?? "Could not change the ignore list: " + message);
				} finally {
					if (mounted.current) setAccountBusyId(void 0);
				}
			};
			/**
			* Pin one account to be tried first, or clear the pin.
			*
			* A plain route call, for the same reason as {@link setAccountIgnored}: the pin
			* lives in a plugin-owned file the CLI also writes, so there is no settings
			* section to write and the button keeps working on a read-only profile.
			*
			* `null` clears rather than naming a sentinel: "no preference" is a real state
			* the user has to be able to return to, and the host owns the decision about
			* whether a given id is still usable — the card cannot see accounts that a
			* scan has not returned yet.
			*/
			const setPreferredAccount = async (region, accountId) => {
				setAccountBusyId(accountId ?? "none");
				setFlash(void 0);
				try {
					const response = await fetch(POOL_ACCOUNT_PREFER_PATH, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ accountId })
					});
					if (!response.ok) {
						const detail = await response.json().catch(() => ({}));
						throw new Error(detail.error ?? `HTTP ${response.status}`);
					}
					await Promise.all(REGION_CARDS.map((other) => refresh(other)));
				} catch (cause) {
					const message = cause instanceof Error ? cause.message : String(cause);
					if (mounted.current) setError(t?.("row.accountPreferError", { message }) ?? "Could not set the preferred account: " + message);
				} finally {
					if (mounted.current) setAccountBusyId(void 0);
				}
			};
			/**
			* The model rows one region card shows, plus whether they can be edited.
			*
			* Derived per region instead of once for the focused tab: both cards list
			* models at the same time now, and their rosters differ, so a single
			* `modelDraft` would have made the CN card render the international model
			* list the moment the user clicked a checkbox on the other side.
			*/
			const modelStateOf = (region) => {
				const here = statusOf(region);
				const local = draftByRegion[region];
				const rows = local ?? (here === void 0 ? {} : draftFromStatus(here));
				const listed = new Set(Object.keys(rows));
				const missing = (here?.selection.enabledModelIds ?? []).filter((id) => !listed.has(id));
				return {
					draft: rows,
					editable: settingsWritable,
					dirty: local !== void 0 && here !== void 0 && draftIsDirty(here, local),
					enabled: Object.values(rows).filter((entry) => entry.enabled).length,
					missing
				};
			};
			/**
			* One clock reading per render, shared by every card's sort and rows.
			*
			* Taken once so a list cannot disagree with itself: calling `new Date()`
			* per row would let a model be "free" for the badge and "not free" for the
			* sort if the window boundary happened to fall between two rows.
			*
			* A promotion boundary is not a re-render trigger — the card refreshes on its
			* own poll, which is frequent enough for a badge that changes twice a day.
			*/
			const now = /* @__PURE__ */ new Date();
			const toggleModel = (region, id) => {
				const here = statusOf(region);
				if (here === void 0) return;
				const base = draftByRegion[region] ?? draftFromStatus(here);
				const entry = base[id];
				if (entry === void 0) return;
				setDraftFor(region, {
					...base,
					[id]: {
						...entry,
						enabled: !entry.enabled
					}
				});
			};
			const toggleModelImage = (region, id) => {
				const here = statusOf(region);
				if (here === void 0) return;
				const base = draftByRegion[region] ?? draftFromStatus(here);
				const entry = base[id];
				if (entry === void 0) return;
				setDraftFor(region, {
					...base,
					[id]: {
						...entry,
						images: !entry.images
					}
				});
			};
			const setModelBudget = (region, id, budget) => {
				const here = statusOf(region);
				if (here === void 0) return;
				const base = draftByRegion[region] ?? draftFromStatus(here);
				const entry = base[id];
				if (entry === void 0) return;
				setDraftFor(region, {
					...base,
					[id]: {
						...entry,
						budget
					}
				});
			};
			/**
			* Throw one region's model edits away.
			*
			* Scoped to that card: discarding the international draft while looking at the
			* CN card would silently undo work the user did on the other side.
			*/
			const discardModels = (region) => {
				setDraftFor(region, void 0);
				setFlash(void 0);
			};
			/**
			* Persist one region's model draft.
			*
			* The write goes through `settingsScope` rather than a bespoke route: that is
			* the same document the model picker reads, so one save covers every account
			* and survives account rotation — the selection is a property of the pool,
			* not of whichever account happens to be serving right now.
			*
			* One settings key per region (`MODEL_SELECTION_KEY`) because the two
			* gateways publish different rosters: saving the CN list must never rewrite
			* the international one. The card refuses an empty enable-list, because
			* saving one would leave the picker with nothing to offer and no obvious way
			* back.
			*/
			const saveModels = async (region) => {
				const local = draftByRegion[region];
				if (local === void 0 || statusOf(region) === void 0) return;
				if (Object.values(local).every((entry) => !entry.enabled)) {
					setError(t?.("row.modelsEmpty") ?? "No model enabled");
					return;
				}
				const write = settingsScope?.set;
				if (write === void 0) {
					setError(t?.("row.modelsSaveError", { message: "settings scope is read-only" }) ?? "settings scope is read-only");
					return;
				}
				setSavingModelsRegion(region);
				setFlash(void 0);
				try {
					const enabledModelIds = Object.entries(local).filter(([, e]) => e.enabled).map(([id]) => id);
					const imageModelIds = Object.entries(local).filter(([, e]) => e.images).map(([id]) => id);
					const contextBudgets = {};
					for (const [id, entry] of Object.entries(local)) if (entry.budget !== void 0) contextBudgets[id] = entry.budget;
					if (await write.call(settingsScope, MODEL_SELECTION_KEY[region], {
						enabledModelIds,
						imageModelIds,
						contextBudgets
					}) === false) {
						if (mounted.current) setError(t?.("row.modelsConflict") ?? "The settings changed elsewhere; review and save again");
						return;
					}
					if (await refresh(region) === void 0) {
						if (mounted.current) setFlash(t?.("row.modelsSaved") ?? "Saved");
						return;
					}
					setDraftFor(region, void 0);
					if (mounted.current) setFlash(t?.("row.modelsSaved") ?? "Saved");
				} catch (cause) {
					if (mounted.current) setError(t?.("row.modelsSaveError", { message: cause instanceof Error ? cause.message : String(cause) }) ?? String(cause));
				} finally {
					if (mounted.current) setSavingModelsRegion(void 0);
				}
			};
			/**
			* Choose how the pool spends its accounts.
			*
			* Not per region, and that is a host fact rather than a shortcut: the
			* settings schema holds ONE `distribution` key, `applyConfigFromSource` reads
			* it into the single pool instance, and both region providers draw accounts
			* from that one pool. A `distributionCn` / `distributionGlobal` pair would
			* have looked tidier and been silently dropped by the schema, so the mode
			* stays shared and the choice is written from the card that shows it.
			*
			* Both regions are refreshed afterwards so the mode is echoed in both cards
			* at once rather than one updating and the other going quietly stale.
			*/
			const setDistribution = async (region, next) => {
				const write = settingsScope?.set;
				if (write === void 0) {
					setError(t?.("row.modelsSaveError", { message: "settings scope is read-only" }) ?? "settings scope is read-only");
					return;
				}
				setFlash(void 0);
				try {
					await write.call(settingsScope, "distribution", next);
					for (const other of REGION_CARDS) await refresh(other);
				} catch (cause) {
					if (mounted.current) setError(String(cause));
				}
			};
			/**
			* Turn the sidebar row on or off (issue #70).
			*
			* Written through the same settings field `apply()` reads, so the two agree
			* without a new endpoint. The row itself is owned by the bundle registration,
			* so the mirror's change notification is what makes this take effect without a
			* restart on hosts that publish one; everywhere else it lands on next launch,
			* which the hint text says rather than implies.
			*/
			const setSidebarRow = async (next) => {
				const write = settingsScope?.set;
				if (write === void 0) {
					setError(t?.("row.modelsSaveError", { message: "settings scope is read-only" }) ?? "settings scope is read-only");
					return;
				}
				setSidebarRowBusy(true);
				setFlash(void 0);
				try {
					if (await write.call(settingsScope, "sidebarRow", next) === false) {
						if (mounted.current) setError(t?.("row.modelsConflict") ?? "The settings changed elsewhere; review and save again");
						return;
					}
					if (mounted.current) setSidebarRowState(next);
				} catch (cause) {
					if (mounted.current) setError(String(cause));
				} finally {
					if (mounted.current) setSidebarRowBusy(false);
				}
			};
			/**
			* Switch the daily-points automation on or off.
			*
			* The whole `automation` object is written as one key, because that is how the
			* settings document stores it: the schedule fields must be carried along, or a
			* save would drop the hour lists the scheduler is running on.
			*
			* The schedule is CN-only (the international gateway has no growth system at
			* all), so this is written from the CN card and both keys are refreshed: the
			* scheduler is one shared process, and a stale CN number showing under the
			* international card would be a lie.
			*/
			const setAutomationEnabled = async (region, enabled) => {
				const write = settingsScope?.set;
				if (write === void 0) {
					setError(t?.("row.modelsSaveError", { message: "settings scope is read-only" }) ?? "settings scope is read-only");
					return;
				}
				const existing = statusOf(region)?.automation;
				setAutomationBusyRegion(region);
				setFlash(void 0);
				try {
					await write.call(settingsScope, "automation", {
						checkinHours: hoursOrDefault(existing?.checkinHours, DEFAULT_AUTOMATION_HOURS.checkin),
						reportHours: hoursOrDefault(existing?.reportHours, DEFAULT_AUTOMATION_HOURS.report),
						taskHours: hoursOrDefault(existing?.taskHours, DEFAULT_AUTOMATION_HOURS.tasks),
						streakHours: hoursOrDefault(existing?.streakHours, DEFAULT_AUTOMATION_HOURS.streak),
						travelHours: hoursOrDefault(existing?.travelHours, DEFAULT_AUTOMATION_HOURS.travel),
						compensationHours: hoursOrDefault(existing?.compensationHours, DEFAULT_AUTOMATION_HOURS.compensation),
						enabled
					});
					for (const other of REGION_CARDS) await refresh(other);
				} catch (cause) {
					if (mounted.current) setError(String(cause));
				} finally {
					if (mounted.current) setAutomationBusyRegion(void 0);
				}
			};
			/**
			* Run the whole automation pass now.
			*
			* The route only STARTS the pass: a full run takes tens of seconds, which is
			* far too long to hold a request open. This watches the scheduler status until
			* the run settles, so the panel can show "running" honestly and report the
			* result when it lands.
			*/
			const runAutomationJob = async (region) => {
				setAutomationRun("all");
				setAutomationRunRegion(region);
				setFlash(void 0);
				try {
					const response = await fetch(POOL_AUTOMATION_RUN_PATH, {
						method: "POST",
						headers: {
							"accept": "application/json",
							"content-type": "application/json"
						},
						credentials: "same-origin",
						body: JSON.stringify({ job: "all" })
					});
					const body = await response.json();
					if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
					if (body.started === false) {
						if (mounted.current) setFlash(t?.("row.autoAlreadyRunning") ?? "A run is already in progress");
					}
					let settled = false;
					for (let attempt = 0; attempt < AUTOMATION_POLL_ATTEMPTS; attempt += 1) {
						await new Promise((resolve) => setTimeout(resolve, AUTOMATION_POLL_MS));
						if (!mounted.current) return;
						if ((await refresh(region))?.automation?.runInProgress === false) {
							settled = true;
							break;
						}
					}
					await refresh(region);
					if (mounted.current) setFlash(settled ? t?.("row.autoRunDone") ?? "Automation pass finished" : t?.("row.autoRunTimeout") ?? "Still running; check back in a moment");
				} catch (cause) {
					if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
				} finally {
					if (mounted.current) {
						setAutomationRun(void 0);
						setAutomationRunRegion(void 0);
					}
				}
			};
			/**
			* Save one account reserved-credit floor.
			*
			* A reserve only protects credits if the pool knows the balance, so this
			* also refreshes the account list afterwards: the reserve badge appears
			* as soon as the reading crosses the floor.
			*
			* The key is NOT per region, and does not need to be: `creditReserves` is a
			* flat document keyed by account id, and account ids are unique across both
			* gateways, so the write cannot land in the wrong place. The region argument
			* only decides which card re-reads itself.
			*
			* Returns whether the host CONFIRMED the write. The card keys its inline
			* "saved / not saved" note off this, so a failure is shown where the user is
			* looking instead of only in the card-level notice line.
			*/
			const saveCreditReserve = async (region, accountId, reserve) => {
				setReserveBusy(accountId);
				setFlash(void 0);
				try {
					const response = await fetch(POOL_CREDIT_RESERVE_PATH, {
						method: "POST",
						headers: {
							"accept": "application/json",
							"content-type": "application/json"
						},
						credentials: "same-origin",
						body: JSON.stringify({
							accountId,
							reserve
						})
					});
					const body = await response.json();
					if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
					await refresh(region);
					if (mounted.current) setFlash(reserve > 0 ? t?.("row.reserveSaved", { credits: reserve }) ?? `Keeping ${reserve} credits` : t?.("row.reserveCleared") ?? "Reserve cleared");
					return true;
				} catch (cause) {
					if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
					return false;
				} finally {
					if (mounted.current) setReserveBusy(void 0);
				}
			};
			const title = t?.("row.title") ?? "XD Pool";
			const description = t?.("row.desc") ?? "";
			/**
			* The vendor behind one lane, as the login page describes it.
			*
			* Both pool lanes ARE two of the thirteen scan-login channels — the pack
			* registers adapters for `buddy` and `workbuddy` too, and this plugin wins
			* that registration. So the pool page does not need its own copy of the
			* vendor's name: it reads the same roster the login page reads and looks the
			* lane up by its channel id.
			*
			* Falling back to the tab label is honest rather than decorative. Before the
			* roster has loaded — or if the channels document could not be read — the lane
			* still has to be nameable, and "国内版" is true while it is thin.
			*/
			const brandOf = (region) => {
				const fallbackName = region === "cn" ? t?.("row.tabCn") ?? "CN" : t?.("row.tabGlobal") ?? "Global";
				const found = channels.find((channel) => channel.id === REGION_CHANNEL_BY_REGION[region]);
				if (found === void 0) return {
					name: fallbackName,
					sub: "",
					note: t?.("row.regionWaiting") ?? ""
				};
				return {
					name: found.name,
					sub: found.domain === void 0 ? found.org : `${found.org} · ${found.domain}`,
					note: found.note
				};
			};
			/**
			* Per-card derived state, computed once per card from its own slice of the
			* status document.
			*
			* Every one of these used to be a single value read from the focused tab,
			* which was fine when only one card existed. With both cards on screen a
			* shared `accountCount` would have let the international card render the
			* domestic account total, so each of them is now computed from the card's own
			* region and the card reads only its own.
			*/
			const cardOf = (region) => {
				const here = statusOf(region);
				const accountCount = here?.accounts.length ?? 0;
				const cooling = here?.cooling ?? 0;
				const idle = here === void 0 && error === void 0;
				const hasHealthy = accountCount > 0 && cooling < accountCount;
				const state = error !== void 0 ? "error" : idle ? "idle" : hasHealthy ? "ok" : "idle";
				const models = here?.models ?? [];
				const modelState = modelStateOf(region);
				const brand = brandOf(region);
				const activeAccount = here?.activeAccountId === void 0 ? void 0 : here.accounts.find((account) => account.id === here.activeAccountId);
				return {
					region,
					status: here,
					accountCount,
					cooling,
					idle,
					hasHealthy,
					state,
					regionLabel: region === "cn" ? t?.("row.tabCn") ?? "CN" : t?.("row.tabGlobal") ?? "Global",
					brandName: brand.name,
					brandSub: brand.sub,
					brandNote: brand.note,
					stateLabel: error !== void 0 ? t?.("row.requestFailed") ?? "Request failed" : accountCount === 0 ? t?.("row.regionEmpty") ?? t?.("row.poolEmpty") ?? "No account yet" : state === "ok" ? t?.("row.ok") ?? "Healthy" : t?.("row.allCooling") ?? "All cooling",
					models,
					modelState,
					activeAccount,
					automation: region === "cn" ? here?.automation : void 0,
					automationTotals: automationTotalsOf(here),
					/** 'ok' also covers "no accounts yet": a lane with nothing to serve is
					healthy as a lane, it simply has no roster. Only an unreadable
					document is an error, so the pill never claims a fault that is really
					just an empty sign-in list. */
					cardState: error !== void 0 ? "error" : accountCount > 0 && cooling < accountCount ? "ok" : "cooling"
				};
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PoolShell, {
				t,
				version: POOL_VERSION,
				avatar: POOL_CARD_AVATAR,
				tabs: shellTabs,
				active: page,
				onSelect: setPage,
				hero: page === "pool" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PageHero, {
					title,
					sub: description
				}) : void 0,
				children: page === "aggregate" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AggregatePage, { t }) : page === "channels" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ChannelsPage, { t }) : page === "ledger" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(LedgerPage, {
					t,
					usage
				}) : page === "routing" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RoutingPage, { t }) : page === "gateway" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(GatewayPage, { t }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("style", { children: POOL_CARD_CSS }),
					usage === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: "dsm-xdpool-card dsm-xdpool-usage",
						"aria-label": t?.("row.usageTitle") ?? "Usage",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsm-xdpool-usage-head",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
									className: "dsm-xdpool-usage-title",
									children: t?.("row.usageTitle") ?? "Usage"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "dsm-xdpool-usage-summary",
									children: t?.("row.usageTurns", {
										turns: usage.turns,
										calls: usage.calls,
										failed: usage.failedTurns,
										recovered: usage.recoveredTurns
									}) ?? `${usage.turns} turn(s) / ${usage.calls} call(s)`
								})]
							}),
							usage.calls === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dsm-xdpool-usage-note",
								children: t?.("row.usageEmpty") ?? "No calls recorded yet."
							}) : null,
							usage.usageReported ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dsm-xdpool-usage-note",
								children: t?.("row.usageNotReported") ?? "The gateway reported no token counts."
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dsm-xdpool-usage-rows",
								children: usage.rows.map((row) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dsm-xdpool-usage-row",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dsm-xdpool-usage-model",
										children: row.model
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: "dsm-xdpool-usage-numbers",
										children: [
											t?.("row.usageTokens", {
												input: formatNumber(row.inputTokens),
												output: formatNumber(row.outputTokens)
											}) ?? `${formatNumber(row.inputTokens)} in / ${formatNumber(row.outputTokens)} out`,
											row.cachedTokens > 0 ? ` · ${t?.("row.usageCached", { count: formatNumber(row.cachedTokens) }) ?? `${formatNumber(row.cachedTokens)} cached`}` : "",
											row.tps === null ? "" : ` · ${t?.("row.usageSpeed", { tps: formatNumber(row.tps) }) ?? `${formatNumber(row.tps)} tok/s`}`,
											row.avgTtftMs === null ? "" : ` · ${t?.("row.usageTtft", { ms: formatNumber(row.avgTtftMs) }) ?? `ttft ${formatNumber(row.avgTtftMs)}ms`}`,
											row.failed > 0 ? ` · ${t?.("row.usageRowFailed", { count: row.failed }) ?? `${row.failed} failed`}` : ""
										]
									})]
								}, `${row.region}:${row.model}`))
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dsm-xdpool-usage-note",
								children: t?.("row.usageWindow", { samples: usage.samples }) ?? "Last {samples} call(s) held in memory; restarting clears them."
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: "dsm-xdpool-card dsm-xdpool-sidebar-row",
						"aria-label": t?.("row.sidebarRowTitle") ?? "Sidebar entry",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsm-xdpool-sidebar-row-head",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
								className: "dsm-xdpool-usage-title",
								children: t?.("row.sidebarRowTitle") ?? "Sidebar entry"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								role: "switch",
								"aria-checked": sidebarRow,
								disabled: !settingsWritable || sidebarRowBusy,
								className: `dsm-xdpool-auto-switch${sidebarRow ? " dsm-xdpool-auto-switch-on" : ""}`,
								onClick: () => {
									setSidebarRow(!sidebarRow);
								},
								children: sidebarRowBusy ? t?.("row.autoBusy") ?? "Saving…" : sidebarRow ? t?.("row.autoOn") ?? "On" : t?.("row.autoOff") ?? "Off"
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dsm-xdpool-usage-note",
							children: sidebarRow ? t?.("row.sidebarRowOn") ?? "XD Pool has its own row in the left sidebar. Turn it off to open the pool from Settings instead." : t?.("row.sidebarRowOff") ?? "The sidebar row is hidden; the pool still opens from Settings → XD Pool, and models are unaffected."
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("section", {
						className: "dsm-xdpool-regions",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dsm-xdpool-region-grid",
							children: REGION_CARDS.map((region) => {
								const card = cardOf(region);
								const accountsPaneId = `dsm-xdpool-${region}-accounts`;
								const modelsPaneId = `dsm-xdpool-${region}-models`;
								const distPaneId = `dsm-xdpool-${region}-dist`;
								const autoPaneId = `dsm-xdpool-${region}-auto`;
								const accountsOpen = openedPanes[accountsPaneId] === true;
								const modelsOpen = openedPanes[modelsPaneId] === true;
								const distOpen = openedPanes[distPaneId] === true;
								const autoOpen = openedPanes[autoPaneId] === true;
								const models = card.models;
								const creditLeft = creditLeftOf(card.status);
								const automation = card.automation;
								const here = card.status;
								return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", {
									className: "dsm-xdpool-region dsm-xdpool-region-in",
									"data-region": region,
									"data-state": card.cardState,
									style: regionCardStyle(region),
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "dsm-xdpool-region-head",
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)(RegionCardTile, { region }),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													className: "dsm-xdpool-region-titles",
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
														className: "dsm-xdpool-region-title",
														children: card.brandName
													}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
														className: "dsm-xdpool-region-sub",
														children: card.brandSub
													})]
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "dsm-xdpool-region-state",
													children: card.stateLabel
												})
											]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: "dsm-xdpool-region-note",
											children: card.brandNote
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "dsm-xdpool-region-stats",
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
													className: "dsm-xdpool-region-stat",
													children: [
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: "dsm-xdpool-region-label",
															children: t?.("row.regionStatAccounts") ?? "accounts"
														}),
														" ",
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", {
															className: "dsm-xdpool-region-num",
															children: card.accountCount === 0 ? "–" : String(card.accountCount)
														})
													]
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
													className: "dsm-xdpool-region-stat",
													children: [
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: "dsm-xdpool-region-label",
															children: t?.("row.regionStatModels") ?? "models"
														}),
														" ",
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", {
															className: "dsm-xdpool-region-num",
															children: models.length === 0 ? "–" : `${card.modelState.enabled}/${models.length}`
														})
													]
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
													className: "dsm-xdpool-region-stat",
													children: [
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: "dsm-xdpool-region-label",
															children: t?.("row.regionStatCredit") ?? "credit left"
														}),
														" ",
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", {
															className: "dsm-xdpool-region-num",
															"data-tone": "quiet",
															children: creditLeft ?? "–"
														})
													]
												})
											]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "dsm-xdpool-region-actions",
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: "dsm-xdpool-region-btns",
												children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
														type: "button",
														className: "dsm-btn dsm-btn-outline dsm-xdpool-region-btn",
														disabled: busyRegion !== void 0,
														"aria-busy": busyRegion === region,
														onClick: () => {
															rescan(region);
														},
														children: busyRegion === region ? t?.("row.accountsScanning") ?? "Detecting…" : t?.("row.accountsRescan") ?? "Detect accounts again"
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
														type: "button",
														className: "dsm-btn dsm-btn-outline dsm-xdpool-region-btn",
														disabled: cooldownBusyRegion !== void 0 || card.cooling === 0,
														"aria-busy": cooldownBusyRegion === region,
														onClick: () => {
															resetCooldowns(region);
														},
														children: cooldownBusyRegion === region ? t?.("row.resetCooldownsBusy") ?? "Clearing…" : t?.("row.resetCooldowns") ?? "Clear all cooldowns"
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
														type: "button",
														className: "dsm-btn dsm-btn-outline dsm-xdpool-region-btn",
														disabled: catalogBusyRegion !== void 0,
														"aria-busy": catalogBusyRegion === region,
														onClick: () => {
															refreshCatalog(region);
														},
														title: t?.("row.catalogRefreshHint") ?? "Fetch the model list again from WorkBuddy",
														children: catalogBusyRegion === region ? t?.("row.catalogRefreshing") ?? "Fetching…" : t?.("row.catalogRefresh") ?? "Refresh models"
													})
												]
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: "dsm-xdpool-region-seg",
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(RegionCardTrigger, {
													controls: accountsPaneId,
													open: accountsOpen,
													label: t?.("row.regionOpenAccounts") ?? `Open the ${card.regionLabel} account list`,
													glyph: "▶",
													text: t?.("row.accountsTitle") ?? "Accounts",
													count: card.accountCount === 0 ? void 0 : String(card.accountCount),
													onToggle: () => {
														setPane(accountsPaneId, !accountsOpen);
													}
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RegionCardTrigger, {
													controls: modelsPaneId,
													open: modelsOpen,
													label: t?.("row.regionOpenModels") ?? `Open the ${card.regionLabel} model list`,
													glyph: "▸",
													text: t?.("row.modelsTitle") ?? "Models",
													count: models.length === 0 ? void 0 : String(models.length),
													onToggle: () => {
														setPane(modelsPaneId, !modelsOpen);
													}
												})]
											})]
										}),
										region === "cn" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "dsm-xdpool-region-cntools",
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
												type: "button",
												className: "dsm-xdpool-region-tool",
												"aria-expanded": distOpen,
												"aria-controls": distPaneId,
												onClick: () => {
													setPane(distPaneId, !distOpen);
												},
												children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: "dsm-xdpool-region-tool-caret",
														"aria-hidden": "true",
														children: "▸"
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t?.("row.distTitle") ?? "Account usage" }),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: "dsm-xdpool-region-tool-value",
														children: distLabel(card.status?.distribution ?? "priority", t)
													})
												]
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
												type: "button",
												className: "dsm-xdpool-region-tool",
												"aria-expanded": autoOpen,
												"aria-controls": autoPaneId,
												onClick: () => {
													setPane(autoPaneId, !autoOpen);
												},
												children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: "dsm-xdpool-region-tool-caret",
														"aria-hidden": "true",
														children: "▸"
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t?.("row.autoTitle") ?? "Automation" }),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: "dsm-xdpool-region-tool-value",
														children: card.automation === void 0 ? "–" : card.automation.enabled ? t?.("row.autoOn") ?? "On" : t?.("row.autoOff") ?? "Off"
													})
												]
											})]
										}) : null,
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(RegionCardPane, {
											id: accountsPaneId,
											open: accountsOpen,
											children: [
												card.accountCount === 0 && card.status !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													className: "dsm-xdpool-region-empty",
													children: [
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
															className: "dsm-xdpool-empty-title",
															children: t?.("row.regionEmptyTitle", { region: card.regionLabel }) ?? t?.("row.regionEmpty") ?? "No account yet"
														}),
														/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
															className: "dsm-xdpool-empty-steps",
															children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
																className: "dsm-xdpool-empty-steps-title",
																children: t?.("row.regionHowToTitle", { region: card.regionLabel }) ?? `How to sign in to the ${card.regionLabel} version`
															}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("ol", {
																className: "dsm-xdpool-empty-list",
																children: [
																	/* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: t?.("row.regionHowTo1") ?? "" }),
																	/* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: t?.("row.regionHowTo2") ?? "" }),
																	/* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: t?.("row.regionHowTo3") ?? "" }),
																	/* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: t?.("row.regionHowTo4") ?? "" })
																]
															})]
														}),
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
															className: "dsm-xdpool-empty-note",
															children: t?.("row.regionHowToNote") ?? ""
														})
													]
												}) : card.accountCount === 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(react_jsx_runtime.Fragment, { children: card.status?.accounts.map((account) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AccountBlock, {
													account,
													serving: card.activeAccount?.id === account.id,
													models: card.models,
													...checkinBusyId === void 0 ? {} : { checkinBusyId },
													onClaimCheckin: (accountId) => {
														claimCheckin(region, accountId);
													},
													onSaveCreditReserve: (accountId, reserve) => saveCreditReserve(region, accountId, reserve),
													onToggleDisabled: (accountId, disabled) => {
														toggleAccountDisabled(region, accountId, disabled);
													},
													onIgnoreAccount: (accountId) => {
														setAccountIgnored(region, accountId, true);
													},
													onPreferAccount: (accountId) => {
														setPreferredAccount(region, accountId);
													},
													...accountBusyId === void 0 ? {} : { accountBusyId },
													t
												}, account.id)) }),
												card.status?.skippedFiles === void 0 || card.status.skippedFiles.length === 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													className: "dsm-xdpool-skipped",
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
														className: "dsm-xdpool-skipped-summary",
														children: t?.("row.skippedFiles", { count: card.status.skippedFiles.length }) ?? `${card.status.skippedFiles.length} credential file(s) could not be read`
													}), card.status.skippedFiles.slice(0, 4).map((entry) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
														className: "dsm-xdpool-skipped-row",
														children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: "dsm-xdpool-skipped-file",
															children: entry.file
														}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: "dsm-xdpool-skipped-reason",
															children: entry.reason === "encrypted" ? t?.("row.skippedEncrypted") ?? "encrypted — start WorkBuddy once" : entry.reason === "unreadable" ? t?.("row.skippedUnreadable") ?? "file could not be read" : t?.("row.skippedMalformed") ?? "not a credential file"
														})]
													}, entry.file))]
												}),
												(card.status?.ignored.length ?? 0) > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													className: "dsm-xdpool-ignored",
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
														className: "dsm-xdpool-ignored-summary",
														children: t?.("row.ignoredSummary", { count: card.status?.ignored.length ?? 0 }) ?? `${card.status?.ignored.length ?? 0} account(s) no longer in the pool`
													}), card.status?.ignored.map((entry) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
														className: "dsm-xdpool-ignored-row",
														children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: "dsm-xdpool-ignored-label",
															children: entry.label
														}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
															type: "button",
															className: "dsm-xdpool-ignored-restore",
															title: t?.("row.ignoredRestoreHint") ?? "Put this account back into the pool",
															disabled: accountBusyId === entry.id,
															onClick: () => {
																setAccountIgnored(region, entry.id, false);
															},
															children: t?.("row.ignoredRestore") ?? "Restore"
														})]
													}, entry.id))]
												}) : null
											]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(RegionCardPane, {
											id: modelsPaneId,
											open: modelsOpen,
											children: models.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
												className: "dsm-xdpool-region-empty",
												children: t?.("row.regionNoModels") ?? "No model published by this gateway yet."
											}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													className: "dsm-xdpool-region-pane-head",
													children: [
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: "dsm-xdpool-region-pane-title",
															children: t?.("row.modelsEnabledCount", {
																enabled: card.modelState.enabled,
																total: models.length
															}) ?? `${card.modelState.enabled} / ${models.length} enabled`
														}),
														card.modelState.missing.length === 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: "dsm-xdpool-region-pane-warn",
															title: card.modelState.missing.join(", "),
															children: t?.("row.modelsMissingSaved", { count: card.modelState.missing.length }) ?? `${card.modelState.missing.length} saved model(s) not offered right now`
														}),
														/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
															className: "dsm-xdpool-models-actions",
															children: [
																card.status?.catalogSource !== "fallback" ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																	className: "dsm-xdpool-catalog-offline",
																	title: card.status.catalogError ?? void 0,
																	children: t?.("row.catalogOffline") ?? "built-in list (offline)"
																}),
																/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
																	type: "button",
																	className: "dsm-btn dsm-btn-outline",
																	disabled: !card.modelState.dirty,
																	onClick: () => {
																		discardModels(region);
																	},
																	children: t?.("row.modelsDiscard") ?? "Discard"
																}),
																/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
																	type: "button",
																	className: "dsm-btn dsm-btn-primary",
																	disabled: !card.modelState.dirty || card.modelState.enabled === 0,
																	onClick: () => {
																		saveModels(region);
																	},
																	children: savingModelsRegion === region ? t?.("row.modelsSaving") ?? "Saving…" : t?.("row.modelsSave") ?? "Save"
																})
															]
														})
													]
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
													className: "dsm-xdpool-model-list",
													children: (showAllModels[region] === true ? [...models] : models.filter((model) => card.modelState.draft[model.id]?.enabled ?? model.enabled)).sort((a, b) => Number(isFreeNow(b, now, region)) - Number(isFreeNow(a, now, region))).map((model) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModelRow, {
														model,
														region,
														paidTwin: paidAlternativeFor(model, models),
														t,
														draft: card.modelState.draft[model.id] ?? {
															enabled: model.enabled,
															images: model.supportsImages
														},
														editable: card.modelState.editable,
														onToggle: (id) => {
															toggleModel(region, id);
														},
														onToggleImage: (id) => {
															toggleModelImage(region, id);
														},
														onBudget: (id, budget) => {
															setModelBudget(region, id, budget);
														},
														onTest: () => {
															testModel(XDPOOL_REGION_PROVIDER[region], model.id);
														},
														probe: probes[model.id],
														probing: probingModel === model.id
													}, model.id))
												}),
												models.length > models.filter((model) => card.modelState.draft[model.id]?.enabled ?? model.enabled).length ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													className: "dsm-xdpool-model-more",
													onClick: () => {
														setShowAllModels((prev) => ({
															...prev,
															[region]: !(prev[region] === true)
														}));
													},
													children: showAllModels[region] === true ? t?.("row.modelsShowLess") ?? "只显示已启用" : t?.("row.modelsShowAll", { count: models.length - models.filter((model) => card.modelState.draft[model.id]?.enabled ?? model.enabled).length }) ?? `显示其余 ${models.length} 个`
												}) : null
											] })
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(RegionCardPane, {
											id: distPaneId,
											open: distOpen,
											children: card.status === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: "dsm-xdpool-dist",
												role: "radiogroup",
												"aria-label": t?.("row.distTitle") ?? "Account usage",
												children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
														className: "dsm-xdpool-dist-head",
														children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: "dsm-xdpool-dist-title",
															children: t?.("row.distTitle") ?? "Account usage"
														}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: "dsm-xdpool-dist-now",
															children: distLabel(card.status.distribution ?? "priority", t)
														})]
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
														className: "dsm-xdpool-dist-options",
														children: DIST_OPTIONS.map((option) => {
															const active = (card.status?.distribution ?? "priority") === option;
															const cls = "dsm-xdpool-dist-option" + (active ? " dsm-xdpool-dist-option-active" : "");
															return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
																type: "button",
																role: "radio",
																"aria-checked": active,
																title: distHint(option, t),
																disabled: !card.modelState.editable,
																className: cls,
																onClick: () => {
																	setDistribution(region, option);
																},
																children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
																	className: "dsm-xdpool-dist-option-top",
																	children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																		className: "dsm-xdpool-dist-option-name",
																		children: distLabel(option, t)
																	}), option === "sticky" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																		className: "dsm-xdpool-dist-option-badge",
																		children: t?.("row.distRecommended") ?? "Recommended"
																	}) : null]
																})
															}, option);
														})
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
														className: "dsm-xdpool-dist-hint",
														children: distHint(card.status?.distribution ?? "priority", t)
													})
												]
											})
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(RegionCardPane, {
											id: autoPaneId,
											open: autoOpen,
											children: automation === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
												className: "dsm-xdpool-region-empty",
												children: t?.("row.autoUnavailable") ?? "This lane has no daily-points system."
											}) : here === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: "dsm-xdpool-auto",
												children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
														className: "dsm-xdpool-auto-head",
														children: [
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																className: "dsm-xdpool-auto-title",
																children: t?.("row.autoTitle") ?? "Automation"
															}),
															automation.enabled ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
																type: "button",
																className: "dsm-btn dsm-btn-outline dsm-xdpool-auto-run",
																disabled: automationRun !== void 0,
																onClick: () => {
																	runAutomationJob(region);
																},
																children: automationRun !== void 0 ? t?.("row.autoRunning") ?? "Running…" : t?.("row.autoRunAll") ?? "Run all now"
															}) : null,
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
																type: "button",
																role: "switch",
																"aria-checked": automation.enabled,
																disabled: !settingsWritable || automationBusyRegion !== void 0,
																className: `dsm-xdpool-auto-switch${automation.enabled ? " dsm-xdpool-auto-switch-on" : ""}`,
																onClick: () => {
																	setAutomationEnabled(region, !automation.enabled);
																},
																children: automationBusyRegion === region ? t?.("row.autoBusy") ?? "Saving…" : automation.enabled ? t?.("row.autoOn") ?? "On" : t?.("row.autoOff") ?? "Off"
															})
														]
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
														className: "dsm-xdpool-auto-hint",
														children: automation.enabled ? t?.("row.autoHintOn") ?? "Reports activity, claims task rewards and checks in once a day." : t?.("row.autoHintOff") ?? "Off: no background requests are made for you."
													}),
													card.automationTotals.credit === 0 && card.automationTotals.checkinCredit === 0 && card.automationTotals.bonusCredit === 0 && card.automationTotals.travelCredit === 0 && card.automationTotals.compensationCredit === 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
														className: "dsm-xdpool-auto-total",
														children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: "dsm-xdpool-auto-total-label",
															children: t?.("row.autoToday") ?? "Today"
														}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
															className: "dsm-xdpool-auto-total-list",
															children: [
																card.automationTotals.credit > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																	className: "dsm-xdpool-auto-total-row",
																	children: t?.("row.autoFromTasks", {
																		credit: card.automationTotals.credit,
																		energy: card.automationTotals.energy,
																		count: card.automationTotals.claimed
																	}) ?? `Tasks +${card.automationTotals.credit}`
																}) : null,
																card.automationTotals.checkinCredit > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																	className: "dsm-xdpool-auto-total-row",
																	children: t?.("row.autoFromCheckin", { credit: card.automationTotals.checkinCredit }) ?? `Check-in +${card.automationTotals.checkinCredit}`
																}) : null,
																card.automationTotals.bonusCredit > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																	className: "dsm-xdpool-auto-total-row",
																	children: t?.("row.autoFromBonus", { credit: card.automationTotals.bonusCredit }) ?? `Streak +${card.automationTotals.bonusCredit}`
																}) : null,
																card.automationTotals.travelCredit > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																	className: "dsm-xdpool-auto-total-row",
																	children: t?.("row.autoFromTravel", { credit: card.automationTotals.travelCredit }) ?? `Buddy +${card.automationTotals.travelCredit}`
																}) : null,
																card.automationTotals.compensationCredit > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																	className: "dsm-xdpool-auto-total-row",
																	children: t?.("row.autoFromCompensation", { credit: card.automationTotals.compensationCredit }) ?? `Compensation +${card.automationTotals.compensationCredit}`
																}) : null
															]
														})]
													}),
													automation.enabled ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
														className: "dsm-xdpool-auto-jobs",
														children: AUTOMATION_JOBS.map((kind) => {
															const job = automationJob(here, kind);
															const hours = automationHours(here, kind);
															const label = t?.(`row.autoJob_${kind}`) ?? kind;
															return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
																className: "dsm-xdpool-auto-job",
																children: [
																	/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																		className: "dsm-xdpool-auto-job-name",
																		children: label
																	}),
																	/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																		className: "dsm-xdpool-auto-job-when",
																		children: hours.length === 0 ? t?.("row.autoHourNone") ?? "not scheduled" : hours.map((hour) => `${String(hour).padStart(2, "0")}:00`).join(" · ")
																	}),
																	/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																		className: "dsm-xdpool-auto-job-last",
																		children: job?.lastRunAtMs === void 0 ? t?.("row.autoNever") ?? "not run yet" : `${formatTime(job.lastRunAtMs)} · ${job.ok}${job.failed > 0 ? `/${job.failed}` : ""}`
																	}),
																	job?.progress === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																		className: "dsm-xdpool-auto-job-note",
																		children: job.progress
																	}),
																	job?.detail === void 0 || job.detail.length === 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																		className: "dsm-xdpool-auto-job-detail",
																		children: job.detail.join(" · ")
																	}),
																	job?.items === void 0 || job.items.length === 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																		className: "dsm-xdpool-auto-job-items",
																		children: [
																			"claimed",
																			"already",
																			"skipped",
																			"failed"
																		].map((status) => {
																			const group = job.items?.filter((item) => item.status === status) ?? [];
																			if (group.length === 0) return null;
																			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
																				className: `dsm-xdpool-auto-job-item dsm-xdpool-auto-job-item-${status}`,
																				title: group.map((item) => item.title + (item.note === void 0 ? "" : ` (${item.note})`)).join("\n"),
																				children: [
																					t?.(`row.autoItem.${status}`) ?? status,
																					" ",
																					group.length
																				]
																			}, status);
																		})
																	})
																]
															}, kind);
														})
													}) : null
												]
											})
										})
									]
								}, region);
							})
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ChannelPoolSection, { t }),
					flash === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsm-xdpool-note",
						children: flash
					}),
					error === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsm-xdpool-error",
						children: t?.("row.error", { message: error }) ?? `Pool status unavailable: ${error}`
					})
				] })
			});
		}
		/** One account block: label + status tag + meta + optional credit panels. */
		function AccountBlock({ account, models, t, checkinBusyId, onClaimCheckin, accountBusyId, onToggleDisabled, onIgnoreAccount, onPreferAccount, onSaveCreditReserve, reserveBusyId, serving }) {
			const isDisabled = account.disabled === true;
			const isPreferred = account.preferred === true;
			const isCooling = account.cooling === true;
			const isDead = account.credentialDead === true;
			const cooldownUntil = account.cooldownUntil !== void 0 ? Date.parse(account.cooldownUntil) : void 0;
			const modelCooldowns = account.modelCooldowns ?? [];
			const tag = isDead ? {
				text: t?.("row.credentialDeadTag") ?? "Sign-in rejected",
				cls: "dsm-xdpool-account-tag dsm-xdpool-account-tag-dead"
			} : isCooling ? {
				text: t?.("row.cooling") ?? "Cooling",
				cls: "dsm-xdpool-account-tag dsm-xdpool-account-tag-cooling"
			} : null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: isDisabled ? "dsm-xdpool-account dsm-xdpool-account-off" : "dsm-xdpool-account",
				"data-serving": serving === true ? "true" : void 0,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsm-xdpool-account-head",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsm-xdpool-account-label",
							children: account.label
						}),
						serving === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "dsm-xdpool-current",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "dsm-xdpool-current-dot" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-xdpool-current-label",
								children: t?.("row.currentAccount") ?? "In use now"
							})]
						}) : null,
						tag === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: tag.cls,
							children: tag.text
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: isPreferred ? "dsm-xdpool-account-prefer dsm-xdpool-account-prefer-on" : "dsm-xdpool-account-prefer",
							"aria-pressed": isPreferred,
							title: isPreferred ? t?.("row.accountPreferClearHint") ?? "Stop preferring this account; the distribution strategy decides again" : t?.("row.accountPreferHint") ?? "Try this account first while it stays healthy",
							disabled: accountBusyId === account.id || accountBusyId === "none",
							onClick: () => {
								onPreferAccount(isPreferred ? null : account.id);
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-xdpool-account-prefer-star",
								"aria-hidden": "true",
								children: "★"
							}), isPreferred ? t?.("row.accountPreferOn") ?? "Preferred" : t?.("row.accountPrefer") ?? "Prefer"]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							role: "switch",
							"aria-checked": !isDisabled,
							className: isDisabled ? "dsm-xdpool-account-toggle" : "dsm-xdpool-account-toggle dsm-xdpool-account-toggle-on",
							title: t?.("row.accountToggleHint") ?? "Enable this account (uncheck to keep it out of the pool)",
							disabled: accountBusyId === account.id,
							onClick: () => {
								onToggleDisabled(account.id, !isDisabled);
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "dsm-xdpool-account-toggle-dot" }), isDisabled ? t?.("row.accountOff") ?? "Disabled" : t?.("row.accountInRotation") ?? "Enabled"]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dsm-xdpool-account-ignore",
							title: t?.("row.accountIgnoreHint") ?? "Remove this account from the pool for good",
							disabled: accountBusyId === account.id,
							onClick: () => {
								onIgnoreAccount(account.id);
							},
							children: t?.("row.accountIgnore") ?? "Remove"
						})
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsm-xdpool-account-body",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsm-xdpool-account-copy",
							children: [
								account.expiresAt !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsm-xdpool-account-meta",
									children: t?.("row.tokenExpiry", { time: formatDateTime(account.expiresAt) }) ?? `token ${formatDateTime(account.expiresAt)}`
								}) : null,
								isCooling && cooldownUntil !== void 0 && !Number.isNaN(cooldownUntil) ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "dsm-xdpool-account-meta",
									children: [
										t?.("row.cooldownUntil", { time: formatTime(cooldownUntil) }) ?? `until ${formatTime(cooldownUntil)}`,
										" · ",
										t?.("row.cooldownHits", { hits: account.rateLimitHits ?? 0 }) ?? `${account.rateLimitHits ?? 0} hit(s)`
									]
								}) : null,
								isDead ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsm-xdpool-account-meta dsm-xdpool-account-meta-dead",
									children: t?.("row.credentialDeadHint") ?? "Sign in again in the WorkBuddy desktop app to restore it"
								}) : null,
								modelCooldowns.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "dsm-xdpool-account-modelcool",
									children: modelCooldowns.map((mc) => {
										const coolingModel = models.find((model) => model.id === mc.modelId);
										const twin = coolingModel === void 0 ? void 0 : paidAlternativeFor(coolingModel, models);
										return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: "dsm-xdpool-account-modelcool-chip",
											children: [t?.("row.modelCooling", {
												model: mc.modelId,
												time: formatDateTime(mc.until)
											}) ?? `${mc.modelId} cooling to ${formatDateTime(mc.until)}`, twin === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "dsm-xdpool-account-modelcool-twin",
												title: t?.("row.paidTwinHint") ?? "Same model, paid row",
												children: t?.("row.rateLimitedPaidTwin", {
													id: twin.id,
													rate: twin.multiplier.toFixed(2)
												}) ?? `→ ${twin.id} (${twin.multiplier.toFixed(2)}x) still works`
											})]
										}, mc.modelId);
									})
								}) : null
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AccountStats, {
							account,
							t,
							checkinBusy: checkinBusyId === account.id,
							onClaim: onClaimCheckin
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(CreditReserveRow, {
							account,
							t,
							busy: reserveBusyId === account.id,
							onSave: onSaveCreditReserve
						}),
						account.automationToday === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsm-xdpool-earned",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-xdpool-earned-label",
								children: t?.("row.autoEarned") ?? "Automation today"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "dsm-xdpool-earned-list",
								children: [
									account.automationToday.credit > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dsm-xdpool-earned-row",
										children: t?.("row.autoFromTasks", {
											credit: account.automationToday.credit,
											energy: account.automationToday.energy,
											count: account.automationToday.claimed
										}) ?? `Tasks +${account.automationToday.credit}`
									}) : null,
									account.automationToday.checkinCredit > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dsm-xdpool-earned-row",
										children: t?.("row.autoFromCheckin", { credit: account.automationToday.checkinCredit }) ?? `Check-in +${account.automationToday.checkinCredit}`
									}) : null,
									account.automationToday.bonusCredit > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dsm-xdpool-earned-row",
										children: t?.("row.autoFromBonus", { credit: account.automationToday.bonusCredit }) ?? `Streak +${account.automationToday.bonusCredit}`
									}) : null,
									account.automationToday.travelCredit > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dsm-xdpool-earned-row",
										children: t?.("row.autoFromTravel", { credit: account.automationToday.travelCredit }) ?? `Buddy +${account.automationToday.travelCredit}`
									}) : null,
									account.automationToday.compensationCredit > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dsm-xdpool-earned-row",
										children: t?.("row.autoFromCompensation", { credit: account.automationToday.compensationCredit }) ?? `Compensation +${account.automationToday.compensationCredit}`
									}) : null
								]
							})]
						})
					]
				})]
			});
		}
		/**
		* Daily check-in block: streak summary plus one claim button for this account.
		* Every account in the pool gets its own button, so a multi-account user can
		* collect each reward without switching the pool's preferred account first.
		*/
		/**
		* Credit panels: package breakdown on the left, the big total on the right with
		* the daily check-in action docked beneath it. Mirrors the two-column credit
		* layout the LaoDing plugin family uses, so the numbers stay scannable and the
		* claim button sits where the eye already is.
		*/
		/**
		* Reserved-credit control for one account.
		*
		* The value is committed on blur or Enter rather than on every keystroke:
		* each save is a settings write plus a status refresh, and a per-character
		* save would hammer both.
		*/
		/**
		* The reserved-credit floor for one account.
		*
		* Saving is an EXPLICIT action, not a blur side effect. The old version
		* committed `onBlur`, which meant a value could be written without the user
		* asking for it — and when the write silently failed, the only trace was a
		* notice line at the top of the card that is easy to miss. That is how
		* "I typed a number, reopened, and it says 0 again" happened with no visible
		* error to explain it.
		*
		* Now: the field is a draft, Save is enabled only when the draft differs from
		* what the host last reported, and the outcome (saving / saved / failed) is
		* shown inline next to the button. Enter also saves, so keyboard flow is not
		* lost.
		*/
		function CreditReserveRow({ account, t, busy, onSave }) {
			const saved = account.creditReserve ?? 0;
			const [draft, setDraft] = (0, react.useState)(String(saved));
			const [settled, setSettled] = (0, react.useState)(saved);
			const [note, setNote] = (0, react.useState)(void 0);
			(0, react.useEffect)(() => {
				setSettled(saved);
				setDraft((current) => current === String(saved) ? current : String(saved));
			}, [saved]);
			const parsed = Number.parseInt(draft, 10);
			const next = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
			const dirty = next !== settled;
			const commit = async () => {
				if (busy || !dirty) return;
				setNote(void 0);
				if (await onSave(account.id, next)) {
					setSettled(next);
					setDraft(String(next));
					setNote("saved");
				} else setNote("failed");
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsm-xdpool-reserve",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsm-xdpool-reserve-label",
						children: t?.("row.reserveTitle") ?? "Keep at least"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						type: "number",
						min: 0,
						step: 1,
						value: draft,
						disabled: busy,
						className: "dsm-xdpool-reserve-input",
						"aria-label": t?.("row.reserveTitle") ?? "Keep at least",
						onChange: (event) => {
							setDraft(event.target.value);
							setNote(void 0);
						},
						onKeyDown: (event) => {
							if (event.key === "Enter") commit();
						}
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsm-xdpool-reserve-unit",
						children: t?.("row.reserveUnit") ?? "credits"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "dsm-xdpool-reserve-save",
						disabled: busy || !dirty,
						onClick: () => {
							commit();
						},
						children: busy ? t?.("row.reserveSaving") ?? "Saving…" : t?.("row.reserveSave") ?? "Save"
					}),
					note === "saved" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsm-xdpool-reserve-note dsm-xdpool-reserve-note-ok",
						children: next > 0 ? t?.("row.reserveSaved", { credits: next }) ?? `Keeping ${next} credits` : t?.("row.reserveCleared") ?? "Reserve cleared"
					}) : null,
					note === "failed" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsm-xdpool-reserve-note dsm-xdpool-reserve-note-bad",
						children: t?.("row.reserveFailed") ?? "Not saved — try again"
					}) : null,
					account.reserved === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsm-xdpool-reserve-badge",
						children: t?.("row.reserveHolding") ?? "Reserved: skipped"
					}) : null
				]
			});
		}
		function AccountStats({ account, t, checkinBusy, onClaim }) {
			const credits = account.credits;
			const checkin = account.checkin;
			const hasCredits = credits !== void 0 || account.creditsError !== void 0;
			const hasCheckin = checkin !== void 0 || account.checkinError !== void 0;
			if (!hasCredits && !hasCheckin) return null;
			const packages = (credits?.packages ?? []).filter((p) => (p.size ?? 0) > 0).slice(0, 6);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsm-xdpool-stats",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "dsm-xdpool-panel dsm-xdpool-panel-total",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsm-xdpool-panel-title",
							children: t?.("row.creditsTotal") ?? "Total"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsm-xdpool-total-value",
							children: formatNumber(credits?.total)
						})]
					}),
					hasCheckin ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsm-xdpool-checkin",
						children: account.checkinError !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsm-xdpool-checkin-error",
							title: account.checkinError,
							children: t?.("row.checkinUnavailable") ?? "check-in unavailable"
						}) : checkin === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsm-xdpool-checkin-meta",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsm-xdpool-checkin-streak",
									children: t?.("row.checkinStreak", { days: checkin.streakDays }) ?? `${checkin.streakDays}-day streak`
								}), checkin.dailyCredit > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsm-xdpool-checkin-daily",
									children: t?.("row.checkinDaily", { credit: formatNumber(checkin.dailyCredit) }) ?? `+${formatNumber(checkin.dailyCredit)}/day`
								}) : null]
							}),
							checkin.isStreakDay && checkin.streakBonusCredit > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-xdpool-checkin-bonus",
								children: t?.("row.checkinStreakBonus", {
									days: formatNumber(checkin.nextStreakDay),
									credit: formatNumber(checkin.streakBonusCredit)
								}) ?? `bonus +${formatNumber(checkin.streakBonusCredit)}`
							}) : null,
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dsm-xdpool-checkin-btn",
								disabled: !checkin.active || checkin.todayCheckedIn || checkinBusy,
								onClick: () => {
									onClaim(account.id);
								},
								children: !checkin.active ? t?.("row.checkinInactive") ?? "Unavailable" : checkin.todayCheckedIn ? t?.("row.checkinClaimed") ?? "Checked in" : checkinBusy ? t?.("row.checkinClaiming") ?? "Checking in…" : t?.("row.checkinClaim") ?? "Check in"
							})
						] })
					}) : null,
					hasCredits ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("ul", {
						className: "dsm-xdpool-panel-packages dsm-xdpool-packages",
						children: [account.creditsError !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: `dsm-xdpool-panel-error${account.credentialDead === true ? " dsm-xdpool-panel-error-dead" : ""}`,
							title: account.creditsError,
							children: account.credentialDead === true ? t?.("row.credentialDead") ?? "Sign-in rejected" : t?.("row.creditsError") ?? "credits unavailable"
						}) }) : packages.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", {
							className: "dsm-xdpool-panel-empty",
							children: "–"
						}) : packages.map((pack, index) => {
							const expiry = formatExpiry(pack.expiresAtMs);
							const refresh = formatExpiry(pack.cycleRefreshMs);
							const soon = isExpiringSoon(pack);
							const when = pack.monthly === true ? refresh === "" ? null : t?.("row.creditsRefreshAt", { time: refresh }) ?? `Refreshes ${refresh}` : expiry === "" ? null : t?.("row.creditsExpiresAt", { time: expiry }) ?? `Expires ${expiry}`;
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsm-xdpool-packages-name",
									children: pack.packageName
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsm-xdpool-packages-value",
									children: t?.("row.creditsPackage", {
										remain: formatNumber(pack.remain),
										size: formatNumber(pack.size)
									}) ?? `${formatNumber(pack.remain)} / ${formatNumber(pack.size)}`
								}),
								when === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: `dsm-xdpool-packages-when${soon ? " dsm-xdpool-packages-when-soon" : ""}`,
									title: t?.("row.creditsExpiresSoonTitle") ?? "Expiring within 3 days",
									children: when
								})
							] }, `${pack.packageName}-${String(index)}`);
						}), credits?.expiringSoon !== void 0 && credits.expiringSoon > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
							className: "dsm-xdpool-packages-when",
							children: [
								t?.("row.creditsSoon") ?? "Expiring in 3 days",
								" ",
								formatNumber(credits.expiringSoon)
							]
						}) : null]
					}) : null
				]
			});
		}
		/**
		* One model row.
		*
		* Read-only when the card has no writable settings scope: the checkbox and the
		* context radios stay disabled rather than pretending an edit took hold. The
		* draft lives in the parent, so this component only ever reports intent.
		*/
		/**
		* The provider id a probe must name for each region's pool lane.
		*
		* These strings are duplicated from `src/adapter.ts` rather than imported,
		* because that module pulls in the Node-only catalog and shim code the browser
		* bundle must never touch. The values are what the host resolves
		* `ctx.llm.stream` against, so a drift here would make the button probe a
		* provider that does not exist — which the host answers as an unknown-model
		* error rather than as a connectivity failure.
		*/
		const XDPOOL_REGION_PROVIDER = {
			cn: "xdpool",
			global: "xdpool-global"
		};
		function ModelRow({ model, region, paidTwin, t, draft, editable, onToggle, onToggleImage, onBudget, onTest, probe, probing }) {
			/**
			* A per-MOUNTED-ROW scope for the two budget radios.
			*
			* HTML groups radios by `name`, and React renders both region cards at once —
			* the collapsible panes stay in the DOM with `hidden`, they are not unmounted.
			* A `name` built from the model id alone is therefore the SAME name in the
			* cn card and the global card, so the two rows joined one radio group: the
			* browser keeps only the last checked member, and whichever card renders
			* later (global) silently un-checks the cn row's "1M". Adding the region
			* would not be enough either — the settings page and the sidebar pane can
			* both mount the same region — so the scope has to name the row instance,
			* which is what `useId` is for.
			*/
			const radioScope = (0, react.useId)();
			const now = /* @__PURE__ */ new Date();
			const tag = tagFor(model, now, region);
			const promo = promoStatusFor(model, now, region);
			const tagText = tag === "free" ? t?.("row.free") ?? "free" : tag === "limited" ? t?.("row.limitedFree") ?? "limited free" : tag === "night" ? t?.("row.nightFreeNow", { time: `${String(promo?.kind === "night" ? promo.untilHour : 0).padStart(2, "0")}:00` }) ?? "free until 08:00" : tag === "badge" ? badgeLabels(model.tags).join(" · ") || null : null;
			/**
			* The "cheaper later" hint: the model is on a promotion but the window is
			* closed. Deliberately NOT a "free" badge — it costs credits at this moment,
			* and telling the user otherwise would change what they spend.
			*/
			const laterHint = promo?.kind === "night-later" ? t?.("row.nightFreeLater", { time: `${String(promo.nextHour).padStart(2, "0")}:00` }) ?? `free from ${String(promo.nextHour).padStart(2, "0")}:00` : null;
			/**
			* How long the campaign itself runs, e.g. "活动至 10-31".
			*
			* Shown on both the free and the not-yet-free row, because the useful question
			* is not only "is it free now" but "until when is this offer good at all" —
			* an extension changes that date, and a user planning around the promotion
			* needs it visible rather than buried in a changelog.
			*/
			const promoUntil = promo === void 0 || promo.kind === "free" ? null : t?.("row.promoUntil", { date: promo.promoUntil.slice(5).replace("-", "-") }) ?? `promo until ${promo.promoUntil}`;
			const native = model.nativeContextWindow;
			const capped = native > DEFAULT_CONTEXT_BUDGET;
			const currentBudget = draft.budget ?? native;
			XDPOOL_REGION_PROVIDER[region];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: `dsm-xdpool-model${draft.enabled ? "" : " dsm-xdpool-model-off"}`,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-xdpool-model-head",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: "dsm-xdpool-model-check",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "checkbox",
								checked: draft.enabled,
								disabled: !editable,
								onChange: () => {
									onToggle(model.id);
								}
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "dsm-xdpool-model-copy",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "dsm-xdpool-model-name",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: model.name }), model.multiplier === void 0 || model.multiplier === 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dsm-xdpool-model-name-rate",
										children: t?.("row.rate", { rate: model.multiplier.toFixed(2) }) ?? `${model.multiplier.toFixed(2)}x`
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsm-xdpool-model-id",
									children: model.id
								})]
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsm-xdpool-model-controls",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: "dsm-xdpool-model-image",
								title: t?.("row.modelImage") ?? "Image input",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "checkbox",
									checked: draft.images,
									disabled: !editable,
									onChange: () => {
										onToggleImage(model.id);
									}
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t?.("row.modelImage") ?? "Image" })]
							}), capped ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("fieldset", {
								className: "dsm-xdpool-model-budget",
								"aria-label": t?.("row.modelContextBudget") ?? "Context",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "radio",
									name: `budget-${radioScope}`,
									checked: currentBudget === DEFAULT_CONTEXT_BUDGET,
									disabled: !editable,
									onChange: () => {
										onBudget(model.id, DEFAULT_CONTEXT_BUDGET);
									}
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: formatCapacity(DEFAULT_CONTEXT_BUDGET) })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "radio",
									name: `budget-${radioScope}`,
									checked: currentBudget === native,
									disabled: !editable,
									onChange: () => {
										onBudget(model.id, native);
									}
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: formatCapacity(native) })] })]
							}) : null]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-xdpool-model-meta",
						children: [
							tagText === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-xdpool-model-meta-tag",
								children: tagText
							}),
							laterHint === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-xdpool-model-meta-later",
								children: laterHint
							}),
							promoUntil === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-xdpool-model-meta-promo",
								children: promoUntil
							}),
							paidTwin === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-xdpool-model-meta-twin",
								title: t?.("row.paidTwinHint") ?? "Same model, paid row",
								children: t?.("row.paidTwin", {
									id: paidTwin.id,
									rate: paidTwin.multiplier.toFixed(2)
								}) ?? `paid twin ${paidTwin.id} (${paidTwin.multiplier.toFixed(2)}x)`
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-xdpool-model-cap",
								children: t?.("row.modelOutput", { size: formatCapacity(model.maxOutputTokens) }) ?? `out ${formatCapacity(model.maxOutputTokens)}`
							}),
							model.supportedEfforts === void 0 || model.supportedEfforts.length === 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-xdpool-model-cap",
								children: t?.("row.modelReasoning", { efforts: model.supportedEfforts.join(" / ") }) ?? model.supportedEfforts.join(" / ")
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModelFactsRow, {
						t,
						...onTest === void 0 ? {} : { onTest },
						...probe === void 0 ? {} : { probe },
						...probing === void 0 ? {} : { probing },
						row: {
							contextWindow: model.contextWindow,
							maxOutputTokens: model.maxOutputTokens,
							supportsImages: model.supportsImages,
							supportedEfforts: model.supportedEfforts
						}
					})
				]
			});
		}
		//#endregion
		//#region src/client/nav-icon.ts
		/**
		* Nav glyph for the WorkBuddy XD Pool settings page.
		*
		* The host's settings shell draws its own 16px `svg` in every nav row and the
		* `settings.section` registration contract projects only `id` / `order` /
		* `label` — there is no `icon` field to pass. A third-party page therefore has
		* to mark its row in the DOM and mask this artwork over the shell's glyph, the
		* same technique `dshmarket` uses (`installSettingsNavIcon`).
		*
		* Kept as a single monochrome path so `mask-image` + `currentColor` can tint it
		* with whatever the active theme uses for nav text: a filled mask cannot carry
		* its own palette, and a two-tone icon would render as a flat silhouette.
		*
		* @module dsh-xdpool/client/nav-icon
		*/
		/**
		* The nav mark: a stack of three rounded "accounts" under a rotation arc.
		*
		* Reads as "a pool of accounts being cycled" at 16px, and — unlike a literal
		* droplet or cloud — stays legible when reduced to a single-color silhouette.
		* `fill-rule="evenodd"` cuts the interior notches out of the silhouette so the
		* three layers stay distinguishable at that size.
		*/
		/**
		* The mark's geometry, independent of any wrapper element.
		*
		* Kept separate from {@link POOL_NAV_ICON_SVG} because the two consumers need
		* different frames: the settings nav row masks a standalone document, while the
		* sidebar panel row renders paths into an `svg` the shell sizes for it (16px
		* wide, 18px in the collapsed rail). Sharing the paths — rather than the whole
		* document, parsed back out with a regex — is what keeps the two placements from
		* drifting apart when the artwork changes.
		*/
		const POOL_NAV_ICON_PATHS = [{
			fill: "currentColor",
			fillRule: "evenodd",
			d: "M12 2.6a3.1 3.1 0 1 1 0 6.2 3.1 3.1 0 0 1 0-6.2Zm0 1.7a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8ZM6.6 8.9a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2Zm0 1.6a1 1 0 1 0 0 2 1 1 0 0 0 0-2ZM17.4 8.9a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2Zm0 1.6a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z"
		}, {
			fill: "none",
			stroke: "currentColor",
			strokeWidth: 1.7,
			strokeLinecap: "round",
			strokeDasharray: "2.6 2.2",
			d: "M4.4 17.2a8.6 8.6 0 0 0 15.2 0"
		}];
		/** The same mark as a standalone SVG document, for `mask-image`. */
		const POOL_NAV_ICON_SVG = [
			"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" width=\"16\" height=\"16\">",
			`<path fill="currentColor" fill-rule="evenodd" d="${POOL_NAV_ICON_PATHS[0].d}"/>`,
			`<path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" d="${POOL_NAV_ICON_PATHS[1].d}" stroke-dasharray="2.6 2.2"/>`,
			"</svg>"
		].join("");
		/**
		* The same artwork as a `mask-image` URL.
		*
		* `encodeURIComponent` keeps the `#`-free markup safe inside a `url("…")` in a
		* stylesheet, and `currentColor` is resolved by the mask's own element rather
		* than by the SVG, so the glyph follows the theme.
		*/
		const POOL_NAV_ICON_MASK_URL = `data:image/svg+xml;utf8,${encodeURIComponent(POOL_NAV_ICON_SVG)}`;
		//#endregion
		//#region src/client/panel-icon.tsx
		/**
		* Render the pool's mark.
		*
		* Inlined rather than masked from a data URI because the shell gives the glyph an
		* 18px box in the collapsed rail: a `mask-size: 16px` silhouette would read as
		* smaller than the first-party icons beside it, and scaling the mask would blur
		* its 1.7px arc. Both placements share {@link POOL_NAV_ICON_PATHS}, so the artwork
		* cannot drift between the settings nav row and this one.
		*/
		function PanelIcon({ size }) {
			const edge = typeof size === "number" && size > 0 ? size : 16;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				xmlns: "http://www.w3.org/2000/svg",
				viewBox: "0 0 24 24",
				width: edge,
				height: edge,
				"aria-hidden": "true",
				focusable: "false",
				children: POOL_NAV_ICON_PATHS.map((shape, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { ...shape }, index))
			});
		}
		//#endregion
		//#region src/client/page.tsx
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
		/**
		* `PoolCard`, sized and scrolled for the main column.
		*
		* Kept as a separate component instead of an option on `PoolCard` so the
		* settings registration stays exactly what it was: the dialog already provides
		* both the scrollport and the insets, and adding either again would double
		* them.
		*/
		function PoolPage(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsm-xdpool-page",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("style", { children: PAGE_CSS }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PoolCard, { ...props })]
			});
		}
		//#endregion
		//#region src/client/locales.ts
		/**
		* Plugin-card copy registered under the `settings.xdpool` locale
		* namespace. Key lists in `en` and `zh` are kept 1:1 by typing `zh` against
		* the key set of `en`.
		*
		* @module dsh-xdpool/client/locales
		*/
		const en = {
			"row.navLabel": "XD Pool",
			"row.title": "Account pool",
			"row.desc": "",
			"row.expand": "Expand",
			"row.collapse": "Collapse",
			"row.requestFailed": "Request failed",
			"row.poolEmpty": "No WorkBuddy account discovered yet.",
			"row.poolEmptyHint": "Sign in to one or more WorkBuddy accounts in the WorkBuddy desktop app, then click “Detect accounts again”. Each sign-in is picked up automatically as a pool member.",
			"row.regionEmpty": "No account signed in for this region yet.",
			"row.regionEmptyHint": "Sign in to a WorkBuddy account for this region in the desktop app, then choose “Detect accounts again”. Domestic and international accounts can be signed in side by side.",
			"row.regionEmptyTitle": "No {region} account is signed in yet.",
			"row.regionHowToTitle": "How to sign in to the {region} version",
			"row.regionHowTo1": "Download and install the {region} client: the international build is named WorkBuddy AI while the domestic one is WorkBuddy, and they are different apps. The web version at https://www.workbuddy.ai/ also works.",
			"row.regionHowTo2": "Pick a sign-in method: email sign-up / sign-in (most common), OAuth with Google, GitHub or X, or WeChat QR scan on some builds.",
			"row.regionHowTo3": "Make sure this machine can reach overseas sites when signing in: the international version targets users outside mainland China and may fail to load behind a restricted network.",
			"row.regionHowTo4": "Back here, press the re-detect button. Every sign-in the client has left on this machine is absorbed into its own region - the two sides stay separate and can run at the same time.",
			"row.regionHowToNote": "The two versions keep separate accounts, credits and data: a domestic account cannot sign in to the international one, and vice versa, so each needs its own registration. This plugin only reads the sign-ins the client has already performed.",
			"row.regionWaiting": "Waiting for the first status answer from this lane.",
			"row.regionStatAccounts": "accounts",
			"row.regionStatModels": "models",
			"row.regionStatCredit": "credit left",
			"row.regionOpenAccounts": "Open the account list for this lane",
			"row.regionOpenModels": "Open the model list for this lane",
			"row.regionNoModels": "This gateway has not published any model yet.",
			"row.autoUnavailable": "This lane has no daily-points system.",
			"row.accountsTitle": "Accounts in the pool",
			"row.tabCn": "国内版",
			"row.tabGlobal": "国际版",
			"row.tabHint": "每个 tab 是一个独立供应商，各有自己的账号、积分与模型；两边同时生效，一侧的改动不影响另一侧。",
			"row.accountsSummary": "{count} account(s) · {cooling} cooling",
			"row.ok": "Running",
			"row.allCooling": "Rate-limited",
			"row.accountInRotation": "Enabled",
			"row.accountOff": "Disabled",
			"row.accountToggleHint": "Enable this account (uncheck to keep it out of the pool)",
			"row.accountToggleError": "Could not switch the account: {message}",
			"row.accountIgnore": "Remove",
			"row.accountIgnoreHint": "Remove this account from the pool for good — its credential stops being read and it will not come back",
			"row.accountPrefer": "Prefer",
			"row.accountPreferOn": "Preferred",
			"row.accountPreferHint": "Try this account first while it stays healthy — the pool falls back to your distribution setting when it cannot",
			"row.accountPreferClearHint": "Stop preferring this account; your distribution setting decides again",
			"row.accountPreferError": "Could not set the preferred account: {message}",
			"row.accountIgnoreError": "Could not change the ignore list: {message}",
			"row.ignoredTitle": "Removed accounts",
			"row.ignoredSummary": "{count} account(s) no longer in the pool",
			"row.ignoredRestore": "Restore",
			"row.ignoredRestoreHint": "Put this account back into the pool",
			"row.currentAccount": "In use now",
			"row.cooling": "Cooling (rate-limited)",
			"row.cooldownHits": "{hits} hit(s)",
			"row.cooldownUntil": "until {time}",
			"row.modelCooling": "{model} cooling until {time}",
			"row.tokenExpiry": "token {time}",
			"row.creditsTotal": "Total",
			"row.creditsPackage": "{remain} / {size}",
			"row.creditsError": "credits unavailable",
			"row.credentialDead": "Sign-in rejected",
			"row.credentialDeadTag": "Sign-in rejected",
			"row.credentialDeadHint": "The upstream no longer accepts this sign-in. Sign in again in the WorkBuddy desktop app to restore it.",
			"row.creditsSoon": "Expiring in 3 days",
			"row.creditsExpiresAt": "Expires {time}",
			"row.creditsExpiresSoonTitle": "Expiring within 3 days",
			"row.creditsRefreshAt": "Refreshes {time}",
			"row.checkinTitle": "Daily check-in",
			"row.checkinClaim": "Check in",
			"row.checkinClaiming": "Checking in…",
			"row.checkinClaimed": "Checked in today",
			"row.checkinInactive": "Check-in not available for this account",
			"row.checkinStreak": "{days}-day streak",
			"row.checkinDaily": "+{credit} credits/day",
			"row.checkinStreakBonus": "day {days} bonus +{credit}",
			"row.checkinClaimedReward": "Claimed +{credit} credits",
			"row.checkinError": "Check-in failed: {message}",
			"row.checkinUnavailable": "check-in unavailable",
			"row.checkinAllHint": "Collect every account’s daily reward here — no need to switch accounts first.",
			"row.modelsTitle": "Models",
			"row.modelsSummary": "{count} model(s) in the live catalog",
			"row.modelsHint": "Read from the live WorkBuddy catalog. Free tiers are marked.",
			"row.modelEnabled": "Enabled",
			"row.modelImage": "Image input",
			"row.modelContextBudget": "Context window",
			"row.modelContextNative": "{size} (max)",
			"row.modelContextCapped": "{size}",
			"row.modelOutput": "Output {size}",
			"row.modelReasoning": "Thinking: {efforts}",
			"facts.context": "context",
			"facts.output": "out",
			"facts.input": "input",
			"facts.thinking": "thinking",
			"facts.textAndImage": "text+image",
			"facts.textOnly": "text only",
			"facts.thinkingHint": "thinking levels the model publishes",
			"facts.capped": "this pool serves {served}; the model publishes {published}",
			"facts.test": "Test connection",
			"facts.testHint": "Sends one short real request and reports what came back",
			"facts.testing": "Testing…",
			"facts.firstFrame": "first token",
			"facts.outputChars": "output",
			"facts.probeOk": "answered",
			"facts.probeFailed": "no answer",
			"row.modelsEnabledCount": "{enabled} / {total} enabled",
			"row.modelsMissingSaved": "{count} saved model(s) not offered right now",
			"row.modelsShowAll": "Show the other {count}",
			"row.modelsShowLess": "Show only enabled",
			"row.modelsSave": "Save",
			"row.modelsSaving": "Saving…",
			"row.modelsDiscard": "Discard",
			"row.modelsSaved": "Model selection saved",
			"row.sidebarRowTitle": "Sidebar entry",
			"row.sidebarRowOn": "XD Pool has its own row in the left sidebar. Turn it off to open the pool from Settings instead.",
			"row.sidebarRowOff": "The sidebar row is hidden; the pool still opens from Settings → XD Pool, and models are unaffected.",
			"row.modelsConflict": "The settings changed elsewhere; review and save again",
			"row.modelsSaveError": "Could not save: {message}",
			"row.modelsEmpty": "No model enabled — enable at least one before saving.",
			"row.catalogOffline": "built-in list (offline)",
			"row.catalogRefresh": "Refresh models",
			"row.catalogRefreshing": "Fetching…",
			"row.catalogRefreshHint": "Fetch the model list again from WorkBuddy",
			"row.catalogRefreshed": "Model list updated ({count} models)",
			"row.catalogRefreshOffline": "Still offline — kept the built-in list",
			"row.usageTitle": "Usage",
			"row.usageTurns": "{turns} turn(s) / {calls} call(s) · {failed} failed, {recovered} rescued by rotation",
			"row.usageEmpty": "No calls recorded yet.",
			"row.usageNotReported": "The gateway has not reported token counts, so the token figures below stay empty.",
			"row.usageTokens": "{input} in / {output} out",
			"row.usageCached": "{count} cached",
			"row.usageSpeed": "{tps} tok/s",
			"row.usageTtft": "first token {ms}ms",
			"row.usageRowFailed": "{count} failed",
			"row.usageWindow": "Last {samples} call(s) kept in memory; restarting clears them.",
			"row.free": "free",
			"row.limitedFree": "limited free",
			"row.nightDiscount": "night",
			"row.nightFreeNow": "free until {time}",
			"row.nightFreeLater": "free from {time}",
			"row.promoUntil": "promo to {date}",
			"row.paidTwin": "paid twin {id} ({rate}x)",
			"row.paidTwinHint": "The free tier is rate-limited first; this same model has a paid row that keeps working",
			"row.rateLimitedPaidTwin": "Tip: {id} is the same model on a paid row ({rate}x credits) and is limited separately — switch to it to keep going",
			"row.skippedFiles": "{count} credential file(s) could not be read",
			"row.skippedEncrypted": "encrypted — start WorkBuddy once so its key can be read",
			"row.skippedUnreadable": "file could not be read",
			"row.skippedMalformed": "not a credential file",
			"row.imageCapable": "image input",
			"row.rate": "{rate}x credits",
			"row.accountsRescan": "Detect accounts again",
			"row.accountsScanning": "Detecting…",
			"row.distTitle": "Account usage",
			"row.distPriority": "Priority",
			"row.distPriorityHint": "Use one account until it runs out, then move to the next",
			"row.distRoundRobin": "Round-robin",
			"row.distRoundRobinHint": "Take turns in order, spreading the spend evenly",
			"row.distBalanced": "Balanced",
			"row.distBalancedHint": "Draw at random, favouring the account idle longest",
			"row.distSticky": "Per conversation",
			"row.distStickyHint": "One account per chat, new chats take the next account — keeps the prompt cache warm",
			"row.distExpiry": "Expiring first",
			"row.distExpiryHint": "Spend the account whose credit packs expire soonest — use them before they are lost",
			"row.distRecommended": "Recommended",
			"row.resetCooldowns": "Clear all cooldowns",
			"row.resetCooldownsBusy": "Clearing…",
			"row.resetCooldownsDone": "Cooldowns cleared",
			"row.accountsRescanned": "Detected {count} account(s)",
			"row.error": "Pool status unavailable: {message}",
			"row.autoTitle": "Automation",
			"row.autoOn": "On",
			"row.autoOff": "Off",
			"row.autoBusy": "Saving…",
			"row.autoHintOn": "Checks in, reports activity, claims task and streak rewards, and runs the buddy trip — every day.",
			"row.autoHintOff": "Off: no background requests are made for you.",
			"row.autoItem.claimed": "claimed",
			"row.autoItem.already": "already",
			"row.autoItem.skipped": "not yet",
			"row.autoItem.failed": "failed",
			"row.autoJob_report": "Activity report",
			"row.autoJob_tasks": "Task rewards",
			"row.autoJob_checkin": "Daily check-in",
			"row.autoJob_streak": "Streak bonus",
			"row.autoJob_travel": "Buddy trip",
			"row.autoJob_compensation": "Outage compensation",
			"row.autoHourNone": "skipped today",
			"row.autoNever": "not run yet",
			"row.autoRun": "Run now",
			"row.autoRunning": "Running…",
			"row.autoRan": "Done: {count} account(s) ok, {failed} failed",
			"row.autoRanTasks": "Done: {claimed} task(s) claimed, +{credit} credits, +{energy} energy",
			"row.reserveTitle": "Keep at least",
			"row.reserveUnit": "credits",
			"row.reserveSaving": "Saving…",
			"row.reserveSave": "Save",
			"row.reserveHolding": "Reserved: skipped",
			"row.reserveSaved": "Keeping {credits} credits",
			"row.reserveCleared": "Reserve cleared",
			"row.reserveFailed": "Not saved — try again",
			"row.autoToday": "Today",
			"row.autoEarned": "Automation today",
			"row.autoEnergy": "energy",
			"row.autoTasksClaimed": "{count} task(s)",
			"row.autoRunAll": "Run now",
			"row.autoRunDone": "Automation pass finished",
			"row.autoRunTimeout": "Still running; check back in a moment",
			"row.autoAlreadyRunning": "A run is already in progress",
			"row.autoRanAll": "Ran {jobs} job(s), {ok} ok, {failed} failed",
			"row.autoFromTasks": "Tasks +{credit} credits · +{energy} energy · {count} task(s)",
			"row.autoFromCheckin": "Check-in +{credit} credits",
			"row.autoFromBonus": "Streak bonus +{credit} credits",
			"row.autoFromTravel": "Buddy travel +{credit} credits",
			"row.autoFromCompensation": "Compensation +{credit} credits",
			"agg.tab": "Providers",
			"agg.title": "Providers",
			"agg.sub": "Fold other vendors’ free allowances into the same pool. Nothing here is in the pool until you add it: open a vendor, paste its key, and its models appear in the picker.",
			"agg.laneOn": "Aggregate lane",
			"agg.laneOffHint": "With this off, providers contribute no models. Your WorkBuddy accounts are untouched.",
			"agg.count": "{providers} configured · {models} models",
			"agg.search": "Search vendor or model…",
			"agg.catAll": "All categories ({count})",
			"agg.catApikey": "API key ({count})",
			"agg.catFree": "Free ({count})",
			"agg.catFreeTier": "Free tier ({count})",
			"agg.catLocal": "Local ({count})",
			"agg.catOauth": "Needs sign-in ({count})",
			"agg.empty": "No vendor matches.",
			"agg.stateOn": "In the pool",
			"agg.stateOff": "Not in the pool",
			"agg.setup": "Set up",
			"agg.enable": "Add to the pool",
			"agg.enableHint": "Saving a key adds this vendor by itself. Use this switch to take it back out without forgetting the key.",
			"agg.key": "API key",
			"agg.keyPlaceholder": "Paste the key",
			"agg.extraKey": "Add another key ({count} stored)",
			"agg.extraKeyPlaceholder": "Appended after the existing ones",
			"agg.baseUrl": "Endpoint",
			"agg.baseUrlPlaceholder": "Blank uses the default",
			"agg.save": "Save",
			"agg.saving": "Saving…",
			"agg.clear": "Clear",
			"agg.test": "Test",
			"agg.discover": "Fetch models",
			"agg.getKey": "Get a key",
			"agg.website": "Website",
			"agg.noKey": "No key",
			"agg.keySet": "Key set",
			"agg.noKeyNeeded": "No key needed",
			"agg.models": "{count} models",
			"agg.unsupported": "This vendor signs in via OAuth/ADC, which this lane cannot drive.",
			"agg.listingYes": "Model list available",
			"agg.saved": "Saved",
			"agg.cleared": "Cleared",
			"agg.probeOk": "Connected",
			"agg.probeFail": "Connection failed",
			"agg.discovered": "Wrote {count} models",
			"agg.discoverEmpty": "That vendor listed no models.",
			"agg.actionFailed": "Action failed",
			"agg.off": "Off",
			"agg.contributed": "contributes {count} models",
			"agg.staticModels": "built-in",
			"agg.discoveredTag": "live",
			"agg.chosenOf": "{chosen} of {total} chosen",
			"agg.modelPick": "Choose which models this vendor contributes",
			"agg.modelPickHint": "Unticking a model takes it out of the picker without touching the key. \"Fetch models\" refreshes the list above; it never changes what you picked.",
			"agg.editModels": "Choose…",
			"agg.selectAll": "Select all",
			"agg.selectNone": "Clear all",
			"agg.discardModels": "Discard",
			"agg.modelSearch": "Filter models…",
			"agg.modelNone": "No model matches that filter.",
			"agg.modelNoneAtAll": "This vendor lists no models.",
			"agg.saveModels": "Save models",
			"agg.savingModels": "Saving…",
			"agg.modelsSaved": "Model selection saved",
			"agg.modelFreeTag": "free",
			"recuse.label": "Recommended use",
			"route.title": "Routing",
			"route.sub": "A chain is a model of its own: it tries each member in order and stops at the first answer.",
			"route.chains": "Chains",
			"route.rosterCount": "{count} model(s) you can chain",
			"route.search": "Search models…",
			"route.newChain": "New chain",
			"route.edit": "Edit",
			"route.editOpen": "Editing",
			"route.chainName": "Chain name",
			"route.chainNamePlaceholder": "e.g. write-then-fallback",
			"route.id": "Model id",
			"route.ownerPool": "XD Pool (WorkBuddy)",
			"route.platformOrder": "Platform order (higher is tried first)",
			"route.platformNoModels": "No model added to this platform yet.",
			"route.platformHint": "Higher is tried first. The same applies to the models inside one platform.",
			"route.platformCount": "{count} platform(s)",
			"route.pickModel": "Pick a model…",
			"route.pickPlatform": "Pick a platform…",
			"route.addModel": "Add model",
			"route.addPlatform": "Add platform",
			"route.moveUp": "Up",
			"route.moveDown": "Down",
			"route.removePlatform": "Remove",
			"route.idHint": "Pool models (like hy3) and provider models (like agnes/agnes-2.0-flash) can be mixed in one chain.",
			"route.members": "Members, in the order they are tried",
			"route.addMember": "Add",
			"route.addSiblings": "+{count} same-model route(s)",
			"route.addSiblingsHint": "Alternate lanes for the SAME model, appended after it: a rate-limited provider is escaped by switching route, not by switching model.",
			"route.removeMember": "Remove",
			"route.noMembers": "Add at least one member — a chain with nothing to call cannot answer.",
			"route.strategy": "Strategy",
			"route.strategyFallback": "Fallback — always start at the top",
			"route.strategyRoundRobin": "Round robin — rotate the starting point",
			"route.stickyLimit": "Turns per member",
			"route.stickyHint": "How many questions the same member keeps answering before the chain moves on.",
			"route.enabled": "Enabled",
			"route.save": "Save chains",
			"route.saving": "Saving…",
			"route.saved": "Chains saved",
			"route.saveFailed": "Could not save the chains",
			"route.empty": "No chain yet. Make one to stop a rate limit from ending a turn.",
			"route.loading": "Reading the chains…",
			"route.failed": "Could not read the chains. The pool itself is unaffected.",
			"route.usable": "ready",
			"route.unusable": "needs a key",
			"route.memberCount": "{count} member(s)",
			"route.capacity": "{tokens} tokens",
			"route.images": "images",
			"route.missing": "Not available right now: {models}",
			"route.missingHint": "These members left the roster. The chain keeps its text, but calls will not reach them — the user thinks their order was obeyed while a different model answered.",
			"route.chainDisabled": "Disabled",
			"route.strategyLabel": "{strategy} · {members}",
			"chan.tab": "Login channels",
			"chan.title": "Login channels",
			"chan.sub": "Thirteen vendors that sign you in with a browser or a QR code — scan once and their free models join the same picker.",
			"chan.login": "Add account",
			"chan.loginSms": "Sign in (SMS)",
			"chan.signingIn": "Waiting for sign-in…",
			"chan.waiting": "Finish in the page that just opened, then come back.",
			"chan.done": "Account added",
			"chan.failed": "Sign-in failed",
			"chan.openLogin": "Open the sign-in page",
			"chan.connected": "Added {count} account(s)",
			"chan.connectedCount": "{count} connected",
			"chan.modelsUnavailable": "The model list could not be read",
			"chan.loginBrowser": "Signs in through its web page.",
			"chan.loginSmsHint": "the QR on that page goes stale fast — use the phone-code option on the same screen",
			"chan.autoCheckin": "Claim daily credits automatically",
			"chan.pending": "The login channels are still loading…",
			"chan.unavailable": "The login channels could not start on this host.",
			"chan.ownedElsewhere": "These login channels are already served by another plugin — the same thirteen sign-in methods are one click away on that build’s own page.",
			"chan.empty": "No channel is connected yet.",
			"shell.brand": "XD Pool",
			"shell.star": "Star",
			"shell.starHint": "Open this plugin on GitHub",
			"shell.group": "Community",
			"shell.groupHint": "Scan a code to join the XD community group",
			"shell.groupTitle": "XD community group",
			"shell.groupClose": "Close",
			"shell.groupWechat": "WeChat (bot)",
			"shell.groupWechatAlt": "WeChat bot code: scan to add the bot, then send XD to be pulled into the group",
			"shell.groupWechatStep": "Scan to add the bot, then send \"XD\" to be pulled in",
			"shell.groupQq": "QQ group",
			"shell.groupQqAlt": "QQ group code: scan it to join the XD community group",
			"shell.groupQqStep": "Just scan — no message needed",
			"shell.groupNote": "Both groups are live; use whichever you prefer. If a code stops working, open an issue on GitHub and it will be refreshed.",
			"shell.tabPool": "Account pool",
			"shell.tabChannels": "Login channels",
			"shell.tabAggregate": "Providers",
			"shell.subPool": "Every WorkBuddy sign-in on this machine, queued as one auto-failing-over pool.",
			"shell.subChannels": "Scan-to-sign-in providers, kept separate so their logins never touch the pool above.",
			"shell.subAggregate": "Bring your own API keys: any OpenAI-compatible provider, reachable as extra models.",
			"shell.tabLedger": "Dashboard",
			"shell.subLedger": "What this machine sent and got back, since the pool last started.",
			"shell.tabRouting": "Routing",
			"shell.subRouting": "Chains that try models in order, so one busy or rate-limited model falls through to the next.",
			"shell.tabGateway": "Gateway",
			"shell.subGateway": "Open the pool to the other devices on your network.",
			"gw.title": "Gateway",
			"gw.sub": "An OpenAI-compatible endpoint other devices on your network can point at. Off until you turn it on, and bound to this computer only until you say otherwise.",
			"gw.on": "On",
			"gw.off": "Off",
			"gw.listening": "Listening",
			"gw.notListening": "On, not listening",
			"gw.idle": "Idle",
			"gw.switch": "Relay",
			"gw.switchHint": "Turning this on mints a key for your devices and binds a port. Until you do, nothing outside this computer can reach the pool.",
			"gw.turnOn": "Turn on",
			"gw.turnOff": "Turn off",
			"gw.address": "Address",
			"gw.host": "Bind address",
			"gw.hostFallback": "only this computer",
			"gw.port": "Port",
			"gw.saveAddress": "Save address",
			"gw.portInvalid": "A port has to be a whole number between 1 and 65535. The address you had saved was left alone.",
			"gw.endpoint": "Point an OpenAI-compatible client at {endpoint}.",
			"gw.key": "Key",
			"gw.noKey": "No key yet — turning the relay on mints one.",
			"gw.showKey": "Show",
			"gw.hideKey": "Hide",
			"gw.rotate": "Rotate key",
			"gw.keyHint": "This key survives a DSH restart. Rotating it drops every device that still holds the old one. This is not the per-process secret of the pool itself — a client that learned that one would stop working the next time DSH restarts.",
			"gw.usage": "Using it",
			"gw.usageHint": "Any OpenAI-compatible app works. Set its base URL to the endpoint above, pick a model out of /v1/models, and send this key as the API key. The relay passes /v1/models and /v1/chat/completions only; everything else is refused before a byte is forwarded.",
			"gw.loading": "Reading the relay status…",
			"gw.saveFailed": "Could not save",
			"gw.share": "Shared models",
			"gw.shareHint": "Only the ticked models are reachable over the gateway. Unticking one does not just hide it from /v1/models — the gateway refuses it, because the relay key is a single secret shared by every device on the network, and a listing a client can ignore is not a restriction.",
			"gw.shareNone": "Nothing to offer yet: no model is reachable until an account pool, an aggregate key or a signed-in channel provides one.",
			"gw.shareAll": "Select all",
			"gw.shareNoneBtn": "Select none",
			"gw.shareSave": "Save sharing",
			"gw.shareSaved": "Gateway sharing updated",
			"gw.shareDirty": "Not saved yet. A device already using an unticked model will start getting 403.",
			"gw.shareCount": "{shared} of {total} shared",
			"ledger.title": "Data dashboard",
			"ledger.sub": "Every number here is counted from calls this pool actually made.",
			"ledger.window": "last {count} call(s)",
			"ledger.memoryOnly": "cleared on restart",
			"ledger.loading": "Reading the recorded calls…",
			"ledger.failed": "Could not read the usage numbers. The pool itself is unaffected.",
			"ledger.tokens": "Tokens",
			"ledger.tokenSplit": "{input} in · {output} out",
			"ledger.notReported": "not reported",
			"ledger.notReportedHint": "the gateway ignored stream_options.include_usage",
			"ledger.turns": "Turns",
			"ledger.callsSub": "{calls} upstream call(s) · rotation turns one question into several",
			"ledger.speed": "Speed",
			"ledger.speedNone": "no timing reported",
			"ledger.ttft": "ttft {ms}",
			"ledger.cache": "Cache hit",
			"ledger.cacheSub": "{cached} tokens read from cache",
			"ledger.requests": "Requests",
			"ledger.allOk": "no turn failed outright",
			"ledger.failedSub": "{failed} failed · {recovered} rescued by rotation",
			"ledger.empty": "No calls recorded yet. Start a conversation and this fills in.",
			"ledger.recent": "Recent calls",
			"ledger.accounts": "By account",
			"ledger.models": "By model",
			"ledger.colTime": "Time",
			"ledger.colChannel": "Channel",
			"ledger.channelFree": "Free lane",
			"ledger.colRegion": "Region",
			"ledger.colModel": "Model",
			"ledger.colAccount": "Account",
			"ledger.colIn": "In",
			"ledger.colOut": "Out",
			"ledger.colCached": "Cached",
			"ledger.colTtft": "TTFT",
			"ledger.colTurns": "Turns",
			"ledger.colCalls": "Calls",
			"ledger.colModels": "Usually runs",
			"ledger.colTps": "tok/s",
			"ledger.colShare": "Share",
			"ledger.noAccount": "—",
			"ledger.unattributed": "(unattributed)",
			"ledger.cn": "CN",
			"ledger.global": "Global",
			"channelpool.title": "Scan channels",
			"channelpool.accountCount": "{count} account(s)",
			"channelpool.loading": "Reading scan channels…",
			"channelpool.disabled": "disabled",
			"channelpool.noModels": "No models published yet.",
			"channelpool.modelError": "Could not list models: {message}",
			"channelpool.saved": "Model selection saved.",
			"channelpool.saving": "Saving…",
			"channelpool.discard": "Discard",
			"channelpool.loadError": "Could not load channels: {message}",
			"channelpool.saveError": "Could not save the model selection: {message}",
			"channelpool.empty": "No channel accounts yet — add one on the scan-login page and the channel shows up here.",
			"channelpool.retry": "Reload",
			"channelpool.accounts": "Accounts",
			"channelpool.models": "Models",
			"channelpool.metaAccounts": "accounts {enabled}/{total}",
			"channelpool.metaModels": "models {enabled}/{total}",
			"channelpool.metaModelsUnknown": "models —",
			"channelpool.creditsUnit": "credits",
			"channelpool.creditsToken": "tokens",
			"channelpool.creditsDollar": "USD",
			"channelpool.creditsQuota": "quota",
			"channelpool.balanceLoading": "Balance is still being read…",
			"channelpool.balanceNone": "No balance reported.",
			"channelpool.balancePackages": "{count} quota window(s)",
			"channelpool.balanceTier": "{label}",
			"channelpool.claim": "Claim credits",
			"channelpool.claimClaimed": "Today claimed",
			"channelpool.claiming": "Claiming…",
			"channelpool.claimResult": "Claimed {claimed} of {total}: +{credit} {unit}.",
			"channelpool.claimNone": "Nothing to claim today ({already} already claimed, {inactive} with no daily credit).",
			"channelpool.claimFailed": "{failed} account(s) could not claim; the others are done.",
			"channelpool.refreshBalance": "Refresh balances",
			"channelpool.refreshAccount": "Refresh",
			"channelpool.everyModelOff": "All {total} models are switched off — tick the ones you want in Models.",
			"channelpool.testAccount": "Test",
			"channelpool.testing": "Testing…",
			"channelpool.enableAccount": "Enable",
			"channelpool.disableAccount": "Disable",
			"channelpool.deleteAccount": "Remove",
			"channelpool.deleteConfirm": "Remove this account? Its stored sign-in is deleted with it.",
			"channelpool.allModels": "Enable all",
			"channelpool.noModelsAll": "Disable all",
			"channelpool.searchModels": "Search models",
			"channelpool.searchHint": "Matches name, id, description and image input",
			"channelpool.searchHit": "{count} shown",
			"channelpool.searchNone": "No model matches “{query}”.",
			"channelpool.expiryNever": "no expiry",
			"channelpool.expiryExpired": "expired",
			"channelpool.modelFree": "free",
			"channelpool.modelDead": "dead",
			"channelpool.testOk": "Reachable.",
			"channelpool.testFail": "Test failed: {message}",
			"channelpool.modelsSaved": "Model selection saved.",
			"channelpool.modelBudget": "Context window",
			"channelpool.stateReady": "connected",
			"channelpool.stateNone": "not connected",
			"channelpool.note": "Note"
		};
		const zh = {
			"row.navLabel": "XD Pool",
			"row.title": "账号池",
			"row.desc": "",
			"row.expand": "展开",
			"row.collapse": "收起",
			"row.requestFailed": "请求失败",
			"row.poolEmpty": "还没有发现任何 WorkBuddy 账号。",
			"row.poolEmptyHint": "先在 WorkBuddy 桌面 App 里登录一个或多个 WorkBuddy 账号，再点“重新检测账号”。每次登录都会被自动纳入池中。",
			"row.regionEmpty": "这边还没有登录账号。",
			"row.regionEmptyHint": "在 WorkBuddy 桌面 App 里登录一个该区域的账号，再点「重新检测账号」。国内版与国际版可以同时登录，两边各自独立。",
			"row.regionEmptyTitle": "这边还没有登录{region}账号。",
			"row.regionHowToTitle": "{region}怎么登录",
			"row.regionHowTo1": "下载并安装{region}客户端：国际版安装包名称是「WorkBuddy AI」，国内版是「WorkBuddy」，两者是不同的应用。也可以直接用网页版 https://www.workbuddy.ai/ 登录。",
			"row.regionHowTo2": "登录方式（任选其一）：① 邮箱注册/登录（最常用）；② 用 Google、GitHub、X 等海外账号授权登录；③ 部分版本支持微信扫码。",
			"row.regionHowTo3": "登录时请确保能正常访问海外站点（国际版面向海外用户，网络受限时可能打不开或登录失败）。",
			"row.regionHowTo4": "回到这里点「重新检测账号」。App 在本机留下的每次登录都会被自动吸收到各自区域 —— 两边互相独立，可以同时使用。",
			"row.regionHowToNote": "国内版与国际版的账号、积分、数据体系完全隔离，互不相通：国内版账号无法登录国际版，反之亦然，需要各自单独注册。本插件只读取客户端已完成的登录，不会代替你登录。",
			"row.regionWaiting": "等待这一栏的第一次状态应答。",
			"row.regionStatAccounts": "账号",
			"row.regionStatModels": "模型",
			"row.regionStatCredit": "剩余积分",
			"row.regionOpenAccounts": "展开这一栏的账号列表",
			"row.regionOpenModels": "展开这一栏的模型列表",
			"row.regionNoModels": "这一栏的网关还没有发布任何模型。",
			"row.autoUnavailable": "这一栏没有每日积分体系。",
			"row.accountsTitle": "池中账号",
			"row.tabCn": "国内版",
			"row.tabGlobal": "国际版",
			"row.tabHint": "每个 tab 是一个独立供应商，各有自己的账号、积分与模型；两边同时生效，一侧的改动不影响另一侧。",
			"row.accountsSummary": "{count} 个账号 · {cooling} 个冷却中",
			"row.ok": "已接入",
			"row.allCooling": "限流中",
			"row.accountInRotation": "已启用",
			"row.accountOff": "已停用",
			"row.accountToggleHint": "启用该账号（取消勾选则不参与池子）",
			"row.accountToggleError": "切换账号失败：{message}",
			"row.accountIgnore": "移出池子",
			"row.accountIgnoreHint": "把这个账号永久移出池子 —— 不再读取它的凭据，即使重新登录也不会回来",
			"row.accountPrefer": "优先",
			"row.accountPreferOn": "已优先",
			"row.accountPreferHint": "优先使用这个账号 —— 它健康时先用它，不可用时自动回到你设定的分发策略",
			"row.accountPreferClearHint": "取消优先，改回按你设定的分发策略轮换",
			"row.accountPreferError": "设置优先账号失败：{message}",
			"row.accountIgnoreError": "修改忽略列表失败：{message}",
			"row.ignoredTitle": "已移出的账号",
			"row.ignoredSummary": "{count} 个账号已不在池中",
			"row.ignoredRestore": "恢复",
			"row.ignoredRestoreHint": "把这个账号放回池子",
			"row.currentAccount": "当前使用",
			"row.cooling": "冷却中（被限流）",
			"row.cooldownHits": "触发 {hits} 次",
			"row.cooldownUntil": "至 {time}",
			"row.modelCooling": "{model} 冷却至 {time}",
			"row.tokenExpiry": "令牌 {time}",
			"row.creditsTotal": "合计",
			"row.creditsPackage": "{remain} / {size}",
			"row.creditsError": "积分不可用",
			"row.credentialDead": "登录已被拒绝",
			"row.credentialDeadTag": "登录已被拒绝",
			"row.credentialDeadHint": "上游已不再接受这个登录状态。请在 WorkBuddy 桌面端重新登录该账号以恢复。",
			"row.creditsSoon": "3 天内到期",
			"row.creditsExpiresAt": "到期 {time}",
			"row.creditsExpiresSoonTitle": "3 天内到期",
			"row.creditsRefreshAt": "刷新 {time}",
			"row.checkinTitle": "每日签到",
			"row.checkinClaim": "签到",
			"row.checkinClaiming": "签到中…",
			"row.checkinClaimed": "今日已签到",
			"row.checkinInactive": "该账号当前无签到活动",
			"row.checkinStreak": "连签 {days} 天",
			"row.checkinDaily": "每日 +{credit} 积分",
			"row.checkinStreakBonus": "第 {days} 天额外 +{credit}",
			"row.checkinClaimedReward": "已领取 +{credit} 积分",
			"row.checkinError": "签到失败：{message}",
			"row.checkinUnavailable": "签到不可用",
			"row.checkinAllHint": "这里可以为每个账号分别领取每日签到奖励，无需先切换账号。",
			"row.modelsTitle": "模型",
			"row.modelsSummary": "实时目录中 {count} 个模型",
			"row.modelsHint": "读取自 WorkBuddy 实时目录；免费档位已标注。",
			"row.modelEnabled": "启用",
			"row.modelImage": "图片输入",
			"row.modelContextBudget": "上下文窗口",
			"row.modelContextNative": "{size}（最大）",
			"row.modelContextCapped": "{size}",
			"row.modelOutput": "输出 {size}",
			"row.modelReasoning": "思考档位：{efforts}",
			"facts.context": "上下文",
			"facts.output": "输出",
			"facts.input": "输入",
			"facts.thinking": "思考",
			"facts.textAndImage": "文本+图片",
			"facts.textOnly": "纯文本",
			"facts.thinkingHint": "模型公布的思考档位",
			"facts.capped": "本池按 {served} 提供，模型公布的是 {published}",
			"facts.test": "测试连接",
			"facts.testHint": "发一次真实的短请求，并如实报告它回了什么",
			"facts.testing": "测试中…",
			"facts.firstFrame": "首帧",
			"facts.outputChars": "输出",
			"facts.probeOk": "有应答",
			"facts.probeFailed": "无应答",
			"row.modelsEnabledCount": "已启用 {enabled} / {total}",
			"row.modelsMissingSaved": "另有 {count} 个已保存的模型当前未提供",
			"row.modelsShowAll": "显示其余 {count} 个",
			"row.modelsShowLess": "只显示已启用",
			"row.modelsSave": "保存",
			"row.modelsSaving": "保存中…",
			"row.modelsDiscard": "放弃修改",
			"row.modelsSaved": "模型选择已保存",
			"row.sidebarRowTitle": "侧栏入口",
			"row.sidebarRowOn": "左侧栏会给 XD Pool 留一行入口。关掉后改为从「设置 → XD Pool」进入，模型池不受影响。",
			"row.sidebarRowOff": "侧栏入口已隐藏；仍可从「设置 → XD Pool」进入，模型池不受影响。",
			"row.modelsConflict": "设置已在别处被修改，请确认后重新保存",
			"row.modelsSaveError": "保存失败：{message}",
			"row.modelsEmpty": "至少要启用一个模型才能保存。",
			"row.catalogOffline": "内置列表（离线）",
			"row.catalogRefresh": "重新获取模型",
			"row.catalogRefreshing": "获取中…",
			"row.catalogRefreshHint": "重新从 WorkBuddy 拉取模型列表",
			"row.catalogRefreshed": "模型列表已更新（{count} 个模型）",
			"row.catalogRefreshOffline": "仍然离线，继续使用内置列表",
			"row.usageTitle": "用量",
			"row.usageTurns": "{turns} 轮提问 / {calls} 次调用 · {failed} 轮失败，{recovered} 轮靠换号救回",
			"row.usageEmpty": "还没有记录到调用。",
			"row.usageNotReported": "网关尚未上报 token 数，下面的 token 数字暂时留空。",
			"row.usageTokens": "输入 {input} / 输出 {output}",
			"row.usageCached": "{count} 命中缓存",
			"row.usageSpeed": "{tps} tokens/秒",
			"row.usageTtft": "首字 {ms} 毫秒",
			"row.usageRowFailed": "{count} 次失败",
			"row.usageWindow": "内存中保留最近 {samples} 次调用；重启会清空。",
			"row.free": "免费",
			"row.limitedFree": "限量免费",
			"row.nightDiscount": "夜间",
			"row.nightFreeNow": "免费至 {time}",
			"row.nightFreeLater": "{time} 起免费",
			"row.promoUntil": "活动至 {date}",
			"row.paidTwin": "付费同款 {id}（{rate}x）",
			"row.paidTwinHint": "免费档先被限流；同一个模型的付费行不受这个限制影响",
			"row.rateLimitedPaidTwin": "提示：{id} 是同一个模型的付费行（{rate}x 积分），限流是分开算的 —— 切过去就能继续用",
			"row.skippedFiles": "有 {count} 个凭据文件读不出来",
			"row.skippedEncrypted": "已加密 —— 启动一次 WorkBuddy 才能取到密钥",
			"row.skippedUnreadable": "文件读不出来",
			"row.skippedMalformed": "不是凭据文件",
			"row.imageCapable": "图片输入",
			"row.rate": "{rate}x 积分",
			"row.accountsRescan": "重新检测账号",
			"row.accountsScanning": "正在检测…",
			"row.distTitle": "账号使用方式",
			"row.distPriority": "优先模式",
			"row.distPriorityHint": "先用完一个账号，用完再换下一个",
			"row.distRoundRobin": "轮换模式",
			"row.distRoundRobinHint": "按顺序轮流使用，积分均匀分摊",
			"row.distBalanced": "均衡模式",
			"row.distBalancedHint": "随机抽取，闲置越久的账号被选中概率越高",
			"row.distSticky": "每对话固定",
			"row.distStickyHint": "一个对话只用一个账号，新对话自动换下一个账号——保住上游缓存，命中率和速度都更好",
			"row.distExpiry": "先花快到期的",
			"row.distExpiryHint": "优先使用积分包最快过期的账号——把要过期的积分花掉，别浪费",
			"row.distRecommended": "推荐",
			"row.resetCooldowns": "清除所有冷却",
			"row.resetCooldownsBusy": "正在清除…",
			"row.resetCooldownsDone": "冷却已清除",
			"row.accountsRescanned": "检测到 {count} 个账号",
			"row.error": "池状态不可用：{message}",
			"row.autoTitle": "积分自动化",
			"row.autoOn": "已开启",
			"row.autoOff": "已关闭",
			"row.autoBusy": "保存中…",
			"row.autoHintOn": "每天自动签到、上报活跃、领取任务奖励与连登奖励，并照看猫猫旅行。",
			"row.autoHintOff": "已关闭：不会替你发起任何后台请求。",
			"row.autoItem.claimed": "已领",
			"row.autoItem.already": "早已领过",
			"row.autoItem.skipped": "暂不可领",
			"row.autoItem.failed": "失败",
			"row.autoJob_report": "活跃上报",
			"row.autoJob_tasks": "任务奖励",
			"row.autoJob_checkin": "每日签到",
			"row.autoJob_streak": "连登奖励",
			"row.autoJob_travel": "猫猫旅行",
			"row.autoJob_compensation": "停机补偿",
			"row.autoHourNone": "当天不跑",
			"row.autoNever": "还没跑过",
			"row.autoRun": "立即运行",
			"row.autoRunning": "运行中…",
			"row.autoRan": "完成：{count} 个账号正常，{failed} 个失败",
			"row.autoRanTasks": "完成：领取 {claimed} 个任务，+{credit} 积分，+{energy} 能量",
			"row.reserveTitle": "保留积分",
			"row.reserveUnit": "积分",
			"row.reserveSaving": "保存中…",
			"row.reserveSave": "保存",
			"row.reserveHolding": "已保留·暂停使用",
			"row.reserveSaved": "已保留 {credits} 积分",
			"row.reserveCleared": "已取消保留",
			"row.reserveFailed": "保存失败，请重试",
			"row.autoToday": "今日自动化",
			"row.autoEarned": "今日自动化获得",
			"row.autoEnergy": "能量",
			"row.autoTasksClaimed": "{count} 个任务",
			"row.autoRunAll": "立即运行",
			"row.autoRunDone": "自动化已执行完成",
			"row.autoRunTimeout": "仍在执行中，稍后查看结果",
			"row.autoAlreadyRunning": "已有一次执行正在进行",
			"row.autoRanAll": "已运行 {jobs} 项，{ok} 个正常，{failed} 个失败",
			"row.autoFromTasks": "任务 +{credit} 积分 · +{energy} 能量 · {count} 个",
			"row.autoFromCheckin": "签到 +{credit} 积分",
			"row.autoFromBonus": "连登奖励 +{credit} 积分",
			"row.autoFromTravel": "猫猫旅行 +{credit} 积分",
			"row.autoFromCompensation": "补偿 +{credit} 积分",
			"agg.tab": "聚合渠道",
			"agg.title": "聚合渠道",
			"agg.sub": "把各家免费额度接进同一个模型池。这里默认一家都不接：展开某一家、填上 key，它的模型才会出现在选择器里。",
			"agg.laneOn": "聚合开关",
			"agg.laneOffHint": "关闭后聚合渠道不再贡献任何模型，WorkBuddy 账号池不受影响。",
			"agg.count": "{providers} 家已配置 · {models} 个模型",
			"agg.search": "搜索厂商或模型…",
			"agg.catAll": "全部分类（{count}）",
			"agg.catApikey": "API Key（{count}）",
			"agg.catFree": "免费（{count}）",
			"agg.catFreeTier": "有免费额度（{count}）",
			"agg.catLocal": "本地（{count}）",
			"agg.catOauth": "需授权（{count}）",
			"agg.empty": "没有匹配的厂商。",
			"agg.stateOn": "已接入",
			"agg.stateOff": "未接入",
			"agg.setup": "去配置",
			"agg.enable": "接入",
			"agg.enableHint": "保存 key 会自动接入这家；用这个开关可以在保留 key 的情况下先摘出去。",
			"agg.key": "API Key",
			"agg.keyPlaceholder": "粘贴 key",
			"agg.extraKey": "再加一把 key（已存 {count} 把）",
			"agg.extraKeyPlaceholder": "追加在已有 key 之后",
			"agg.baseUrl": "接口地址",
			"agg.baseUrlPlaceholder": "留空用默认",
			"agg.save": "保存",
			"agg.saving": "保存中…",
			"agg.clear": "清除设置",
			"agg.test": "测试",
			"agg.discover": "拉取模型",
			"agg.getKey": "去获取 key",
			"agg.website": "官网",
			"agg.noKey": "未填 key",
			"agg.keySet": "已填 key",
			"agg.noKeyNeeded": "无需 key",
			"agg.models": "{count} 个模型",
			"agg.unsupported": "该厂商需要 OAuth/ADC 授权，这条通道暂时接不了。",
			"agg.listingYes": "支持拉取模型列表",
			"agg.saved": "已保存",
			"agg.cleared": "已清除",
			"agg.probeOk": "连接正常",
			"agg.probeFail": "连接失败",
			"agg.discovered": "已写入 {count} 个模型",
			"agg.discoverEmpty": "该厂商没有返回模型列表。",
			"agg.actionFailed": "操作失败",
			"agg.off": "已关闭",
			"agg.contributed": "贡献 {count} 个模型",
			"agg.staticModels": "内置",
			"agg.discoveredTag": "实时",
			"agg.chosenOf": "已选 {chosen} / 共 {total}",
			"agg.modelPick": "选择这家贡献哪些模型",
			"agg.modelPickHint": "取消勾选只是把这个模型从选择器里拿掉，不会动你的 key。「拉取模型」只刷新上面的列表，不会改你选好的东西。",
			"agg.editModels": "选择…",
			"agg.selectAll": "全选",
			"agg.selectNone": "全清",
			"agg.discardModels": "放弃修改",
			"agg.modelSearch": "筛选模型…",
			"agg.modelNone": "没有匹配该筛选的模型。",
			"agg.modelNoneAtAll": "这家没有列出任何模型。",
			"agg.saveModels": "保存模型",
			"agg.savingModels": "保存中…",
			"agg.modelsSaved": "模型选择已保存",
			"agg.modelFreeTag": "免费",
			"recuse.label": "推荐用途",
			"route.title": "路由",
			"route.sub": "一条链本身就是个模型：按顺序挨个试成员，谁先答上就用谁。",
			"route.chains": "链",
			"route.rosterCount": "{count} 个可入链模型",
			"route.search": "搜索模型…",
			"route.newChain": "新建一条链",
			"route.edit": "编辑",
			"route.editOpen": "编辑中",
			"route.chainName": "链的名字",
			"route.chainNamePlaceholder": "例如 主力-兜底",
			"route.id": "模型 id",
			"route.ownerPool": "XD Pool（WorkBuddy）",
			"route.platformOrder": "平台顺序（越靠上越优先）",
			"route.platformNoModels": "这个平台还没有添加模型",
			"route.platformHint": "平台越靠上越优先；同一个平台里模型也一样。",
			"route.platformCount": "{count} 个平台",
			"route.pickModel": "选择模型…",
			"route.pickPlatform": "选择平台…",
			"route.addModel": "加模型",
			"route.addPlatform": "加平台",
			"route.moveUp": "上移",
			"route.moveDown": "下移",
			"route.removePlatform": "移除",
			"route.idHint": "池内模型（比如 hy3）和渠道模型（比如 agnes/agnes-2.0-flash）可以混在同一条链里。",
			"route.members": "成员，按尝试顺序排列",
			"route.addMember": "加入",
			"route.addSiblings": "+{count} 条同模型线路",
			"route.addSiblingsHint": "同一个模型的其他线路，排在该模型后面：某家限流时先换线路，而不是换模型（换模型会改上下文窗口、工具调用和文风）。",
			"route.removeMember": "移除",
			"route.noMembers": "至少加一个成员——空链没有东西可调，答不了话。",
			"route.strategy": "策略",
			"route.strategyFallback": "兜底——永远从第一个开始",
			"route.strategyRoundRobin": "轮转——轮流换起点",
			"route.stickyLimit": "每个成员连着几轮",
			"route.stickyHint": "在轮到下一个成员之前，同一个成员连续回答几轮。",
			"route.enabled": "启用",
			"route.save": "保存全部链",
			"route.saving": "保存中…",
			"route.saved": "链已保存",
			"route.saveFailed": "链没能保存",
			"route.empty": "还没有链。建一条，被限流就不会再把一整轮对话掐断。",
			"route.loading": "正在读取链…",
			"route.failed": "链没能读出来。池子本身不受影响。",
			"route.usable": "可用",
			"route.unusable": "缺 key",
			"route.memberCount": "{count} 个成员",
			"route.capacity": "{tokens} tokens",
			"route.images": "看图",
			"route.missing": "这些成员暂时不在册：{models}",
			"route.missingHint": "链原样保留着这些成员，但调不通——你以为自己下的指令被照做了，其实是别的模型在答。",
			"route.chainDisabled": "已停用",
			"route.strategyLabel": "{strategy} · {members}",
			"chan.tab": "扫码登录",
			"chan.title": "扫码登录",
			"chan.sub": "十三家支持网页或扫码登录的厂商：登一次，它们的免费模型就出现在同一个选择器里。",
			"chan.login": "添加账号",
			"chan.loginSms": "登录（短信）",
			"chan.signingIn": "等待登录…",
			"chan.waiting": "在刚打开的页面里完成登录，然后回来。",
			"chan.done": "已添加 1 个账号",
			"chan.failed": "登录失败",
			"chan.openLogin": "打开登录页",
			"chan.connected": "已添加 {count} 个账号",
			"chan.connectedCount": "已连接 {count} 个",
			"chan.modelsUnavailable": "模型列表读不到",
			"chan.loginBrowser": "通过网页登录。",
			"chan.loginSmsHint": "该页二维码很快就会失效——建议用同屏的短信验证码登录",
			"chan.autoCheckin": "自动领取每日积分",
			"chan.pending": "扫码登录通道正在加载…",
			"chan.unavailable": "本机上扫码登录通道没能启动。",
			"chan.ownedElsewhere": "这些扫码登录通道已经由另一个插件接管了——同样这十三种登录方式，在它自己的页面上点一下就能用。",
			"chan.empty": "还没有任何渠道连上来。",
			"shell.brand": "XD Pool",
			"shell.star": "点Star",
			"shell.starHint": "在 GitHub 上给这个插件点个星",
			"shell.group": "交流群",
			"shell.groupHint": "扫码加入 XD 交流群",
			"shell.groupTitle": "XD 交流群",
			"shell.groupClose": "关闭",
			"shell.groupWechat": "微信（机器人）",
			"shell.groupWechatAlt": "微信机器人二维码：扫码添加后发送 XD，即可被拉进群",
			"shell.groupWechatStep": "扫码添加机器人后，发送「XD」拉你进群",
			"shell.groupQq": "QQ 群",
			"shell.groupQqAlt": "QQ 群二维码：直接扫码加入 XD 交流群",
			"shell.groupQqStep": "直接扫码即可加入",
			"shell.groupNote": "两个群都在，哪个方便用哪个。二维码失效了在 GitHub 提个 issue 说一声，会更新。",
			"shell.tabPool": "账号池",
			"shell.tabChannels": "扫码登录",
			"shell.tabAggregate": "聚合渠道",
			"shell.subPool": "把本机所有已登录的 WorkBuddy 账号排成一队，坏了自动换下一个。",
			"shell.subChannels": "各家扫码登录通道，和上面的账号池分开，免得互相把凭据搅乱。",
			"shell.subAggregate": "带上你自己的 API key：任何兼容 OpenAI 的服务都能变成额外模型。",
			"shell.tabLedger": "数据看板",
			"shell.subLedger": "这台机器发出去什么、收回来什么，从池子上次启动算起。",
			"shell.tabRouting": "路由",
			"shell.subRouting": "把几个模型串成一条链，按顺序试；一个忙了或被限流，就自动落到下一个。",
			"shell.tabGateway": "网关",
			"shell.subGateway": "把账号池开放给同网络里的其它设备。",
			"gw.title": "网关",
			"gw.sub": "开一个 OpenAI 兼容的入口，同网络的其它设备可以指过来。默认关闭，默认只绑定本机 —— 你不改，它就一直只在你这台电脑上。",
			"gw.on": "已开",
			"gw.off": "已关",
			"gw.listening": "监听中",
			"gw.notListening": "已开但没监听",
			"gw.idle": "待命",
			"gw.switch": "中继",
			"gw.switchHint": "打开后会为你的设备生成一把密钥，并绑定一个端口。在你这么做之前，本机之外没有任何东西能连到账号池。",
			"gw.turnOn": "打开",
			"gw.turnOff": "关闭",
			"gw.address": "地址",
			"gw.host": "绑定地址",
			"gw.hostFallback": "只有这台电脑",
			"gw.port": "端口",
			"gw.saveAddress": "保存地址",
			"gw.portInvalid": "端口得是 1 到 65535 之间的整数。原先保存的地址保持原样，没动。",
			"gw.endpoint": "把 OpenAI 兼容客户端的接口地址填成 {endpoint}。",
			"gw.key": "密钥",
			"gw.noKey": "还没有密钥 —— 打开中继时会顺手生成一把。",
			"gw.showKey": "显示",
			"gw.hideKey": "隐藏",
			"gw.rotate": "轮换密钥",
			"gw.keyHint": "这把密钥在 DSH 重启后仍然有效。轮换会让所有还在用旧密钥的设备立刻断线。这里给的也不是账号池自己每进程生成的秘密 —— 客户端要是拿到它，DSH 下次一重启就全废了。",
			"gw.usage": "怎么用",
			"gw.usageHint": "任何 OpenAI 兼容的客户端都行：接口地址填上面那个入口，模型从 /v1/models 里挑，密钥填到这个 API 密钥的位置。中继只放行 /v1/models 和 /v1/chat/completions，其余路径在转发任何字节之前就拒掉。",
			"gw.loading": "正在读取中继状态……",
			"gw.saveFailed": "没能保存",
			"gw.share": "共享哪些模型",
			"gw.shareHint": "只有勾选的模型能通过网关访问。取消勾选不只是把它从 /v1/models 里藏起来——网关会直接拒绝它。因为中继密钥是整台网络上所有设备共用的同一把，而一份客户端可以无视的列表算不上限制。",
			"gw.shareNone": "暂时无可提供：在账号池、聚合渠道密钥或已登录的渠道给出模型之前，这里不会有任何条目。",
			"gw.shareAll": "全选",
			"gw.shareNoneBtn": "全不选",
			"gw.shareSave": "保存共享设置",
			"gw.shareSaved": "网关共享设置已更新",
			"gw.shareDirty": "尚未保存。已在使用某个被取消勾选模型的设备，会开始收到 403。",
			"gw.shareCount": "已共享 {shared} / {total}",
			"ledger.title": "数据看板",
			"ledger.sub": "这里每个数字，都是这个池子真实发出去的调用数出来的。",
			"ledger.window": "最近 {count} 次调用",
			"ledger.memoryOnly": "重启即清空",
			"ledger.loading": "正在读取记录下来的调用…",
			"ledger.failed": "读不到用量数字了，池子本身不受影响。",
			"ledger.tokens": "Token 总量",
			"ledger.tokenSplit": "进 {input} · 出 {output}",
			"ledger.notReported": "未上报",
			"ledger.notReportedHint": "网关没有理会 stream_options.include_usage",
			"ledger.turns": "轮次",
			"ledger.callsSub": "{calls} 次上游调用 · 换号会把一次提问变成几次调用",
			"ledger.speed": "速度",
			"ledger.speedNone": "没有计时数据",
			"ledger.ttft": "首字 {ms}",
			"ledger.cache": "缓存命中",
			"ledger.cacheSub": "{cached} token 直接来自缓存",
			"ledger.requests": "请求数",
			"ledger.allOk": "没有整轮失败的情况",
			"ledger.failedSub": "{failed} 轮失败 · {recovered} 轮靠换号救回",
			"ledger.empty": "还没有记录到调用，聊两句这里就填上了。",
			"ledger.recent": "最近调用",
			"ledger.accounts": "按账号看",
			"ledger.models": "按模型看",
			"ledger.colTime": "时间",
			"ledger.colChannel": "渠道",
			"ledger.channelFree": "免密通道",
			"ledger.colRegion": "线路",
			"ledger.colModel": "模型",
			"ledger.colAccount": "账号",
			"ledger.colIn": "输入",
			"ledger.colOut": "输出",
			"ledger.colCached": "缓存",
			"ledger.colTtft": "首字",
			"ledger.colTurns": "轮次",
			"ledger.colCalls": "调用",
			"ledger.colModels": "常跑",
			"ledger.colTps": "tokens/秒",
			"ledger.colShare": "占比",
			"ledger.noAccount": "—",
			"ledger.unattributed": "(没归属到账号)",
			"ledger.cn": "国内版",
			"ledger.global": "国际版",
			"channelpool.title": "扫码渠道",
			"channelpool.accountCount": "{count} 个账号",
			"channelpool.loading": "正在读取扫码渠道…",
			"channelpool.disabled": "已停用",
			"channelpool.noModels": "该渠道还没有发布模型。",
			"channelpool.modelError": "读取模型列表失败：{message}",
			"channelpool.saved": "模型选择已保存。",
			"channelpool.saving": "保存中…",
			"channelpool.discard": "放弃修改",
			"channelpool.loadError": "读取扫码渠道失败：{message}",
			"channelpool.saveError": "保存模型选择失败：{message}",
			"channelpool.empty": "还没有渠道账号——在扫码登录页添加账号后，渠道会出现在这里。",
			"channelpool.retry": "刷新",
			"channelpool.accounts": "账号",
			"channelpool.models": "模型",
			"channelpool.metaAccounts": "账号 {enabled}/{total}",
			"channelpool.metaModels": "模型 {enabled}/{total}",
			"channelpool.metaModelsUnknown": "模型 —",
			"channelpool.creditsUnit": "积分",
			"channelpool.creditsToken": "token",
			"channelpool.creditsDollar": "美元",
			"channelpool.creditsQuota": "配额",
			"channelpool.balanceLoading": "余额正在读取…",
			"channelpool.balanceNone": "没有查询到余额。",
			"channelpool.balancePackages": "{count} 个配额窗口",
			"channelpool.balanceTier": "{label}",
			"channelpool.claim": "领取积分",
			"channelpool.claimClaimed": "今日已领取",
			"channelpool.claiming": "领取中…",
			"channelpool.claimResult": "共 {total} 个账号，领取 {claimed} 个：+{credit} {unit}。",
			"channelpool.claimNone": "今天没有可领的（{already} 个已领，{inactive} 个无每日积分）。",
			"channelpool.claimFailed": "有 {failed} 个账号领取失败，其余已完成。",
			"channelpool.refreshBalance": "刷新余额",
			"channelpool.refreshAccount": "刷新凭据",
			"channelpool.everyModelOff": "这 {total} 个模型全部被关掉了——去「模型」里勾选你要的。",
			"channelpool.testAccount": "测试",
			"channelpool.testing": "测试中…",
			"channelpool.enableAccount": "启用",
			"channelpool.disableAccount": "停用",
			"channelpool.deleteAccount": "删除",
			"channelpool.deleteConfirm": "删除这个账号？它保存的登录凭据也会一并删掉。",
			"channelpool.allModels": "全开",
			"channelpool.noModelsAll": "全关",
			"channelpool.searchModels": "搜索模型",
			"channelpool.searchHint": "按名称、ID、介绍与图片输入匹配",
			"channelpool.searchHit": "显示 {count} 个",
			"channelpool.searchNone": "没有匹配「{query}」的模型。",
			"channelpool.expiryNever": "长期有效",
			"channelpool.expiryExpired": "已过期",
			"channelpool.modelFree": "免费",
			"channelpool.modelDead": "已下线",
			"channelpool.testOk": "连接正常。",
			"channelpool.testFail": "测试失败：{message}",
			"channelpool.modelsSaved": "模型选择已保存。",
			"channelpool.modelBudget": "上下文大小",
			"channelpool.stateReady": "已连接",
			"channelpool.stateNone": "未连接",
			"channelpool.note": "说明"
		};
		//#endregion
		//#region src/client/index.tsx
		/** Stable browser-plugin name. */
		const name = "dsh-xdpool-client";
		/**
		* Client services required by the settings page.
		*
		* Deliberately only the two services present on BOTH host lines. The settings
		* surface differs by line — 0.1.5 provides `settingsScope`, 0.1.7 replaces it
		* with `configForms` — and cordis' dependency gate is hard: any inject entry the
		* running line does not provide keeps `apply` from ever running. Probing the one
		* that exists through `ctx.get()` (which returns undefined, never throws, for an
		* absent service) is what lets one build serve both lines.
		*/
		const inject = ["slots", "locale"];
		/** Settings namespace the host-side section registers (shared with the entry). */
		const XDPOOL_SETTINGS_NS = "xdpool";
		/**
		* Host plugin entry id this bundle is mounted under in `cordis.patch.yml`.
		*
		* `configForms` is addressed by this id on the 0.1.7 line.
		*/
		const XDPOOL_ENTRY_ID = "llm-xdpool";
		/** Register card copy and the pool page under Settings. */
		function apply(ctx) {
			try {
				const namespace = "settings.xdpool";
				ctx.effect(() => ctx.locale.register(namespace, {
					zh,
					en
				}), "dsh-xdpool: settings copy");
				const t = ctx.locale.bind(namespace);
				const softGet = (serviceName) => ctx.get(serviceName);
				const settingsScope = resolveSettingsScope(softGet);
				installPackRpc(ctx);
				ctx.slots.inject("settings.section", () => ctx.slots.register({
					name: "settings.section",
					id: "xdpool",
					order: 440,
					label: () => t("row.navLabel"),
					inject: () => settingsScope === void 0 ? { t } : {
						t,
						settingsScope
					}
				}, PoolCard));
				installNavIcon(ctx, () => t("row.navLabel"));
				try {
					let disposeRow;
					const syncSidebarRow = () => {
						const wanted = readSidebarRow(settingsScope);
						if (wanted && disposeRow === void 0) disposeRow = ctx.slots.register({
							name: "sidebar.panellist",
							id: "xdpool",
							order: 20,
							label: () => t("row.navLabel")
						}, PanelIcon);
						else if (!wanted && disposeRow !== void 0) {
							disposeRow();
							disposeRow = void 0;
						}
					};
					ctx.slots.inject("sidebar.panellist", () => {
						syncSidebarRow();
						const unsubscribe = settingsScope?.subscribe?.(syncSidebarRow);
						return () => {
							unsubscribe?.();
							disposeRow?.();
							disposeRow = void 0;
						};
					});
					ctx.slots.inject("main", () => ctx.slots.register({
						name: "main",
						key: "xdpool",
						inject: () => settingsScope === void 0 ? { t } : {
							t,
							settingsScope
						}
					}, PoolPage));
				} catch (error) {
					console.error("[dsh-xdpool] sidebar entry unavailable (settings page unaffected):", error);
				}
			} catch (error) {
				console.error("[dsh-xdpool] client page failed to load (host provider unaffected):", error);
			}
		}
		/** Attribute carrying the nav-row marker this module installs. */
		const NAV_ICON_MARKER = "data-dsh-xdpool-nav-icon";
		/**
		* The settings nav rows, as the shell renders them. Scoped to the settings
		* dialog on purpose: the main sidebar has its own nav, and matching rows there
		* would stamp this glyph onto an unrelated control.
		*/
		const NAV_ROW_SELECTOR = "[role=\"dialog\"] nav button";
		/**
		* How many consecutive in-dialog passes may miss the nav row before the
		* diagnostic fires.
		*
		* Above 1 because a single miss is routine — the shell can re-render between
		* our mutation callback and the query. Small enough that a genuinely broken
		* selector is reported within a frame or two of opening the settings panel.
		*/
		const NAV_ICON_MISS_THRESHOLD = 3;
		/**
		* Draw this page's own glyph in its Settings nav row.
		*
		* The `settings.section` contract carries no icon: the shell decides the glyph
		* from the section id and falls back to a gear for anything it does not know.
		* So the row is matched by its LABEL (the same thunk passed to the
		* registration, re-read on every pass so a locale switch is followed) and
		* marked; CSS then hides the shell svg and masks this artwork into the row.
		*
		* Re-scanned on DOM mutations because the shell re-renders the nav on locale
		* and theme changes, which replaces the row elements and drops the marker.
		*
		* No-op off the browser (the node-side probe imports this module for types).
		*/
		function installNavIcon(ctx, resolveLabel) {
			if (typeof document === "undefined") return;
			ctx.effect(() => {
				const tag = document.createElement("style");
				tag.dataset.plugin = "dsh-xdpool";
				tag.dataset.pluginCss = "dsh-xdpool/settings-nav-icon";
				tag.textContent = [
					`[${NAV_ICON_MARKER}] > svg { display: none; }`,
					`[${NAV_ICON_MARKER}]::before {`,
					"  content: '';",
					"  flex: none;",
					"  width: 16px;",
					"  height: 16px;",
					"  background-color: currentColor;",
					`  -webkit-mask-image: url("${POOL_NAV_ICON_MASK_URL}");`,
					`  mask-image: url("${POOL_NAV_ICON_MASK_URL}");`,
					"  -webkit-mask-repeat: no-repeat;",
					"  mask-repeat: no-repeat;",
					"  -webkit-mask-position: center;",
					"  mask-position: center;",
					"  -webkit-mask-size: 16px 16px;",
					"  mask-size: 16px 16px;",
					"}"
				].join("\n");
				document.head.appendChild(tag);
				let disposed = false;
				let scheduled = false;
				/**
				* Consecutive passes that found no matching row.
				*
				* A miss is NORMAL most of the time: the settings dialog is closed, so its
				* nav is not in the DOM at all, and the icon stays unapplied by design.
				* Warning on the first miss would fire constantly and train everyone to
				* ignore it.
				*
				* What is worth reporting is a PERSISTENT miss while the dialog IS open —
				* that means the shell's nav markup changed and the selector no longer
				* matches, which is exactly the failure that looks like "nothing happened"
				* and cost hours to find. So the threshold is a burst of misses, and the
				* warning is emitted once per burst rather than once per mutation.
				*/
				let missStreak = 0;
				let warned = false;
				const sync = () => {
					scheduled = false;
					if (disposed) return;
					const wanted = String(resolveLabel() ?? "").trim();
					if (wanted === "") return;
					let matched = 0;
					for (const row of document.querySelectorAll(NAV_ROW_SELECTOR)) if (String(row.textContent ?? "").trim() === wanted) {
						row.setAttribute(NAV_ICON_MARKER, "");
						matched += 1;
					} else row.removeAttribute(NAV_ICON_MARKER);
					if (matched > 0) {
						missStreak = 0;
						warned = false;
						return;
					}
					if (document.querySelector(NAV_ROW_SELECTOR) === null) {
						missStreak = 0;
						return;
					}
					missStreak += 1;
					if (missStreak < NAV_ICON_MISS_THRESHOLD || warned) return;
					warned = true;
					const present = [...document.querySelectorAll(NAV_ROW_SELECTOR)].map((row) => String(row.textContent ?? "").trim()).filter((text) => text !== "");
					console.warn(`[dsh-xdpool] the settings nav row could not be found, so the icon was not applied. selector=${JSON.stringify(NAV_ROW_SELECTOR)} expectedLabel=${JSON.stringify(wanted)} rowsPresent=${JSON.stringify(present)}. This is cosmetic only — the card itself still works. Please report this line so the selector can be updated.`);
				};
				const schedule = () => {
					if (scheduled || disposed) return;
					scheduled = true;
					queueMicrotask(sync);
				};
				sync();
				const observer = new MutationObserver(schedule);
				observer.observe(document.body, {
					childList: true,
					subtree: true,
					characterData: true
				});
				return () => {
					disposed = true;
					observer.disconnect();
					for (const row of document.querySelectorAll(`[${NAV_ICON_MARKER}]`)) row.removeAttribute(NAV_ICON_MARKER);
					tag.remove();
				};
			}, "dsh-xdpool: settings nav icon");
		}
		/**
		* Bind the settings form the card reads and writes, on whichever line is
		* running.
		*
		* 0.1.7 exposes `configForms.get(entryId)`, keyed by the HOST plugin entry id —
		* the id this bundle registers under in `cordis.patch.yml`, not the settings
		* namespace. 0.1.5 exposes `settingsScope.bind({ namespace })`, keyed by the
		* namespace the host-side `installSection` registered. Both controllers answer
		* the same two methods the card uses (`getSnapshot()`, `set(field, value)`), so
		* the card needs no per-line branch of its own.
		*
		* Returns undefined when neither service is present (a locked-down host): the
		* card then renders read-only, which is the documented degradation.
		*/
		function resolveSettingsScope(softGet) {
			const forms = softGet("configForms");
			if (forms !== void 0) {
				let entryId = XDPOOL_ENTRY_ID;
				try {
					const namespaces = forms.describe().getSnapshot().view?.namespaces ?? [];
					const served = namespaces.find((entry) => entry.ns === XDPOOL_ENTRY_ID) ?? namespaces.find((entry) => /xdpool/.test(entry.ns));
					if (served !== void 0) entryId = served.ns;
				} catch {}
				return forms.get(entryId);
			}
			const scope = softGet("settingsScope");
			if (scope !== void 0) return scope.bind({ namespace: XDPOOL_SETTINGS_NS });
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});

/**
 * The waiting states the pool needs, following one rule each.
 *
 * WHAT THE SKILL SAYS, AND HOW IT LANDS HERE
 *
 *   · Under 300 ms: show nothing. A spinner that appears and vanishes in that window reads as a
 *     flicker, which is why every indicator below waits for `DELAY_MS` and then stays for
 *     `MIN_MS` — one helper, used everywhere, rather than a threshold retyped per component.
 *   · A known layout gets a SKELETON, not a spinner in the middle of an empty page: the shapes are
 *     at the real sizes, so the page does not move when the data lands.
 *   · A refresh keeps the old data and adds a quiet state; it never replaces the numbers with
 *     placeholders the reader has to wait out.
 *   · A failure stays where it happened, says what failed, and offers Retry. A toast that
 *     disappears is not enough for something the person has to fix.
 *
 * @module dsh-xdpool/client/loading
 */
import { useEffect, useRef, useState, type ReactElement } from 'react'

/** Show a pending indicator only after this long. */
export const DELAY_MS = 300

/** …and keep it at least this long, so it cannot flicker even when the answer races the delay. */
export const MIN_MS = 500

/**
 * Whether to draw a pending indicator for `busy`.
 *
 * Returns `false` for the first `DELAY_MS`, then `true`, and holds `true` for `MIN_MS` after
 * `busy` drops. The two thresholds are applied together so no caller has to remember the second.
 */
export function useDelayedBusy(busy: boolean): boolean {
  const [shown, setShown] = useState(false)
  const shownAt = useRef(0)

  useEffect(() => {
    if (busy) {
      if (shown) return
      const timer = setTimeout(() => {
        shownAt.current = Date.now()
        setShown(true)
      }, DELAY_MS)
      return () => { clearTimeout(timer) }
    }
    if (!shown) return
    const elapsed = Date.now() - shownAt.current
    const remaining = Math.max(0, MIN_MS - elapsed)
    const timer = setTimeout(() => { setShown(false) }, remaining)
    return () => { clearTimeout(timer) }
  }, [busy, shown])

  return shown
}

/**
 * Skeleton shapes for a channel detail, at the real sizes.
 *
 * The row heights and the marker size match the real account rows, so the content that arrives
 * takes the same places: nothing jumps, and the reader's eye is already where the text will be.
 */
export function DetailSkeleton({ rows = 3 }: { rows?: number }): ReactElement {
  return (
    <div className="spinner" aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }, (unused, index) => (
        <div key={index} className="skel-line">
          <span className="skel-line" />
          <span className="skel-line">
            {/* Line lengths vary a little; equal bars read as a table, not as text. */}
            <span className="skel-line" style={{ width: `${String(58 + (index % 3) * 12)}%` }} />
            <span className="skel-line skel-line" style={{ width: `${String(28 + (index % 2) * 10)}%` }} />
          </span>
        </div>
      ))}
    </div>
  )
}

/** A pill spinner for a button whose label must not change width. */
export function InlineSpinner(): ReactElement {
  return <span className="dsm-xdpool-spin" aria-hidden="true" />
}

/**
 * A failure that stays put.
 *
 * Deliberately not a toast: this is something the reader has to act on, and a message that
 * disappears after three seconds makes them reopen the panel to read it again.
 */
export function InlineError({ message, retryLabel, onRetry }: {
  message: string
  retryLabel: string
  onRetry?: (() => void) | undefined
}): ReactElement {
  return (
    <p className="hint" role="alert">
      <span className="hint">{message}</span>
      {onRetry === undefined ? null : (
        <button type="button" className="tiny" onClick={onRetry}>
          {retryLabel}
        </button>
      )}
    </p>
  )
}

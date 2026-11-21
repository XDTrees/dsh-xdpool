/**
 * Serialize the read-modify-write cycles on a store file.
 *
 * WHY THIS IS NEEDED
 *
 * Every credential store does the same three steps: load the list, replace one entry, write the
 * list back. Two of those interleaved lose one entry — the second write starts from a list that
 * predates the first, so the entry the first added is simply absent from what lands on disk. It
 * is not a rare race either: signing into two channels of the same family in quick succession is
 * ordinary use, and a lost credential looks exactly like a sign-in that never worked.
 *
 * The atomic `rename` most of these stores already do makes the FILE consistent; it does not
 * make the READ-MODIFY-WRITE consistent, which is a different guarantee.
 *
 * HOW
 *
 * One promise chain per file path. Each cycle appends to the chain, so the cycles run one after
 * another in the order they were requested. A failure does not poison the chain — the next
 * caller still runs — and the chain is dropped once it drains, so a long-lived process does not
 * accumulate promises.
 *
 * @module dsh-xdpool/store-lock
 */

/** The tail of each path's chain. */
const chains = new Map<string, Promise<unknown>>()

/**
 * Run `work` once every earlier call for the same key has settled.
 *
 * The key is normally the store's absolute path: two stores in different files do not contend,
 * and two writers of the same file must not interleave.
 */
export async function withStoreLock<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = chains.get(key) ?? Promise.resolve()
  /**
   * `previous.catch` keeps a rejected earlier cycle from skipping this one: the chain exists to
   * order writes, not to propagate failures.
   */
  const next = previous.catch(() => undefined).then(work)
  // Store a settled-safe handle so the map never holds a rejected promise.
  const guarded = next.catch(() => undefined)
  chains.set(key, guarded)
  try {
    return await next
  } finally {
    /**
     * Drop the entry once nothing is queued behind it.
     *
     * Without this the map grows with every store the process ever touched — small, but it also
     * keeps every resolved promise alive for the life of the session.
     */
    if (chains.get(key) === guarded) chains.delete(key)
  }
}

/** How many chains are live, for a test or a diagnostic. */
export function liveStoreLockCount(): number {
  return chains.size
}

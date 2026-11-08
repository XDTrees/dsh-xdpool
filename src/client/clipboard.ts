/**
 * Copy a string to the clipboard, with a fallback that works where the async API does
 * not.
 *
 * `navigator.clipboard.writeText` is the only API that does not touch the DOM, but it
 * requires a SECURE CONTEXT and a user gesture. This card runs inside the host dialog,
 * which can be served over plain http:// on a LAN address — the relay's own sharing
 * scenario — and in that case `navigator.clipboard` is `undefined`, not merely
 * rejecting. So the order is deliberate:
 *
 *   1. the async API, when it exists;
 *   2. a hidden textarea + `document.execCommand('copy')`, which still works in a
 *      non-secure context as long as a gesture is in progress;
 *   3. report failure rather than claiming success.
 *
 * The third step matters more than it looks: a copy button that silently does nothing
 * leaves the user pasting a stale clipboard into their client and blaming the key. The
 * caller renders the returned boolean, so a failure is visible.
 *
 * WHY THE DOM IS REACHED THROUGH `globalThis` RATHER THAN `document`
 *
 * This file is `.ts`, not `.tsx`, so the HOST half's `tsc` program type-checks it too
 * (`include: src/**\/*.ts`, no `dom` lib in that config). The browser half compiles it
 * fine; the host build would otherwise fail on names it cannot see. Narrow local
 * interfaces plus `globalThis` keep one file valid in both programs, which is the same
 * trade `model-facts.ts` makes.
 */

/** The slice of the Clipboard API this module uses. */
interface ClipboardLike {
  writeText(text: string): Promise<void>
}

/** The slice of `document` this module uses, declared locally for the reason above. */
interface DocumentLike {
  createElement(tag: string): ElementLike
  body: { appendChild(node: ElementLike): void; removeChild(node: ElementLike): void }
  execCommand(command: string): boolean
}

interface ElementLike {
  value: string
  style: Record<string, string>
  setAttribute(name: string, value: string): void
  select(): void
  setSelectionRange(start: number, end: number): void
}

/** `navigator`, when there is one and it exposes a clipboard. */
function clipboardOf(): ClipboardLike | undefined {
  const nav = (globalThis as { navigator?: { clipboard?: ClipboardLike } }).navigator
  const clipboard = nav?.clipboard
  return clipboard !== undefined && typeof clipboard.writeText === 'function' ? clipboard : undefined
}

/** `document`, when there is one. */
function documentOf(): DocumentLike | undefined {
  return (globalThis as { document?: DocumentLike }).document
}

export async function copyText(value: string): Promise<boolean> {
  if (value === '') return false

  const clipboard = clipboardOf()
  if (clipboard !== undefined) {
    try {
      await clipboard.writeText(value)
      return true
    } catch {
      // Permission denied, or a non-activated document. Fall through: the textarea
      // path needs neither.
    }
  }

  const doc = documentOf()
  if (doc === undefined) return false
  try {
    const area = doc.createElement('textarea')
    area.value = value
    // Off-screen rather than `display:none`: a hidden element cannot be selected in
    // some engines, and `position:fixed` keeps it from scrolling the dialog.
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.top = '-1000px'
    area.style.left = '-1000px'
    area.style.opacity = '0'
    doc.body.appendChild(area)
    area.select()
    area.setSelectionRange(0, value.length)
    const ok = doc.execCommand('copy')
    doc.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}

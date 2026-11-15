/**
 * Making a tool schema safe to send upstream.
 *
 * THE FAILURE
 *
 * `codearts: Invalid request: tools.function.parameters is not a valid moonshot flavored
 * json schema, details: <At path 'properties.show': detected infinite recursion without
 * termination condition>`
 *
 * A tool whose parameter schema refers to ITSELF has no finite JSON encoding. The upstream
 * validator walks the schema to check it can be materialised, and a self-reference sends it
 * into an endless descent — so the request is refused before the model ever sees it, and the
 * refusal names a path (`properties.show`) that the caller has no way to act on.
 *
 * HOW A CYCLE IS SPOTTED
 *
 * By PATH, and the path is tracked as the walk descends. A `$ref` is a JSON pointer into the
 * schema document, so `#/properties/show` names the node it sits in — and a reference whose
 * pointer resolves to a node that is an ANCESTOR of the reference itself is the loop.
 *
 * The ancestor test compares by IDENTITY: a cycle in one document is a reference to the same
 * object reached twice, not to an equal one.
 *
 * WHAT THIS DOES
 *
 * The recursion is cut where it starts: such a `$ref` is replaced with a permissive object.
 * The tool stays callable, and an upstream that cannot see the cycle cannot refuse the
 * request.
 *
 * @module dsh-xdpool/tool-schema
 */

/** The maximum depth a schema is walked to. Deep enough for real schemas, shallow enough to be cheap. */
const MAX_DEPTH = 64

/**
 * Resolve a JSON pointer against the schema document.
 *
 * `#/properties/show` means "the `show` key of `properties`", and each segment is one level
 * down. A pointer that does not resolve is not a cycle — it is a reference to something this
 * document does not contain, which the upstream resolves against ITS OWN document.
 */
function resolvePointer(root: unknown, ref: string): unknown {
  if (!ref.startsWith('#/')) return undefined
  let current: unknown = root
  for (const segment of ref.slice(2).split('/')) {
    if (current === null || typeof current !== 'object') return undefined
    const key = segment.replace(/~1/gu, '/').replace(/~0/gu, '~')
    current = (current as Record<string, unknown>)[key]
    if (current === undefined) return undefined
  }
  return current
}

/**
 * Replace the node a JSON pointer names, in the document itself.
 *
 * In place, because a shared definition must stay shared: replacing it by identity keeps
 * every reference to it pointing at the same rewritten schema.
 */
function replaceAtPointer(root: Record<string, unknown>, ref: string, value: unknown): void {
  const segments = ref.slice(2).split('/').map(segment => segment.replace(/~1/gu, '/').replace(/~0/gu, '~'))
  if (segments.length === 0) return
  let current: unknown = root
  for (const segment of segments.slice(0, -1)) {
    if (current === null || typeof current !== 'object') return
    current = (current as Record<string, unknown>)[segment]
  }
  if (current === null || typeof current !== 'object') return
  const last = segments[segments.length - 1]
  if (last === undefined) return
  ;(current as Record<string, unknown>)[last] = value
}

/**
 * Whether a node contains another — the shape of "this is an ancestor of that".
 *
 * The comparison is by IDENTITY, because a cycle in a JSON document is a reference to the
 * same object, not to an equal one: two `$ref`s that point at the same place are one node
 * reached twice.
 */
function containsNode(node: unknown, candidate: unknown, seen: Set<unknown> = new Set()): boolean {
  if (node === candidate) return true
  if (node === null || typeof node !== 'object') return false
  if (seen.has(node)) return false
  seen.add(node)
  if (Array.isArray(node)) {
    return node.some(entry => containsNode(entry, candidate, seen))
  }
  return Object.values(node as Record<string, unknown>).some(value => containsNode(value, candidate, seen))
}

/**
 * The node a `$ref` points at, together with the path it was found under.
 *
 * The path matters as much as the target: the loop in the reported failure is
 * `properties.show` referring to itself, so the reference and the node it names have to be
 * compared by WHERE they are, not only by what they contain.
 */
function referenceTarget(root: unknown, ref: string): unknown {
  return resolvePointer(root, ref)
}

/**
 * Whether following references from one node reaches another.
 *
 * Containment is not enough: two properties that point at each other do not contain one
 * another — the connection IS the reference. So the walk follows references as well as
 * children, and stops at a node it has already visited, which is what makes a cycle
 * terminate instead of descending forever.
 */
function reachesNode(from: unknown, target: unknown, root: unknown, seen: Set<unknown>): boolean {
  if (from === target) return true
  if (from === null || typeof from !== 'object') return false
  if (seen.has(from)) return false
  seen.add(from)
  if (Array.isArray(from)) {
    return from.some(entry => reachesNode(entry, target, root, seen))
  }
  const record = from as Record<string, unknown>
  const ref = record['$ref']
  if (typeof ref === 'string') {
    const resolved = resolvePointer(root, ref)
    if (resolved !== undefined && reachesNode(resolved, target, root, seen)) return true
  }
  return Object.values(record).some(value => reachesNode(value, target, root, seen))
}

/**
 * Rewrite one schema node, cutting cycles.
 *
 * `root` is the document the pointers resolve against, and `ancestors` are the nodes on the
 * way here. A `$ref` that lands on one of them — or on the node itself — is the loop.
 */
function sanitizeNode(node: unknown, root: unknown, ancestors: readonly unknown[], depth: number): unknown {
  if (depth > MAX_DEPTH) return { type: 'object', additionalProperties: true }
  if (node === null || typeof node !== 'object') return node
  if (Array.isArray(node)) {
    return node.map(entry => sanitizeNode(entry, root, ancestors, depth + 1))
  }

  const record = node as Record<string, unknown>
  const ref = record['$ref']
  if (typeof ref === 'string') {
    const target = referenceTarget(root, ref)
    /**
     * The loop, found by asking whether the two nodes are each other's ancestor.
     *
     * A self-reference (`show` → `show`) is the node against itself. A mutual reference
     * (`a` → `b` → `a`) is two SIBLINGS that contain each other — neither is an ancestor of
     * the other on its own, but each is reachable from the other, and that is the same
     * endless descent.
     */
    /**
     * The loop, found by asking whether the walk comes back to where it started.
     *
     * The reference is a loop when the target REACHES the reference's own position: the
     * descent from the target passes through this very node, and never terminates.
     *
     * A reference to a shared definition is NOT a loop, even though the document contains
     * the definition: `#/$defs/leaf` is finite, because the leaf does not contain the
     * reference that names it. So the test is "does the target contain ME", not "is the
     * target somewhere in my ancestors".
     */
    const closesLoop = target !== undefined && (
      target === node ||
      // The target reaches this node, directly or through further references: `a` → `b`
      // → `a` is two siblings that point at each other, and neither CONTAINS the other —
      // the connection is a reference, so the walk has to follow references rather than
      // compare containment.
      reachesNode(target, node, root, new Set())
    )
    if (closesLoop) {
      /**
       * The cycle, cut.
       *
       * A permissive object is the honest description of "this is as deep as the schema
       * goes": the caller can pass anything there, and the model is told the shape is open
       * rather than being handed a lie about a finite one.
       */
      return { type: 'object', additionalProperties: true }
    }
    /**
     * Every other reference is LEFT ALONE.
     *
     * Expanding it would inline the referenced schema and change its shape — and reuse is
     * not recursion: two properties pointing at the same definition are finite, and the
     * upstream accepts them. So a `$ref` is only ever replaced when it lands back on an
     * ancestor, and it is replaced with an open object rather than with the schema it
     * pointed at.
     */
    return { ...record }
  }

  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    out[key] = sanitizeNode(value, root, [...ancestors, node], depth + 1)
  }
  return out
}

/**
 * Make one tool definition safe to send.
 *
 * A definition without a schema is returned untouched: there is nothing to break, and a
 * tool the caller wrote badly in some other way is the caller's to fix.
 */
function sanitizeTool(tool: unknown): unknown {
  if (tool === null || typeof tool !== 'object') return tool
  const record = tool as Record<string, unknown>
  // The OpenAI shape puts the schema under `function.parameters`; the flat shape puts it
  // under `parameters`. Both are handled, because both are sent in the wild.
  const fn = record['function']
  if (fn !== null && typeof fn === 'object') {
    const inner = fn as Record<string, unknown>
    const parameters = inner['parameters']
    if (parameters === null || typeof parameters !== 'object') return tool
    return {
      ...record,
      function: { ...inner, parameters: sanitizeNode(parameters, parameters, [], 0) },
    }
  }
  const parameters = record['parameters']
  if (parameters === null || typeof parameters !== 'object') return tool
  return { ...record, parameters: sanitizeNode(parameters, parameters, [], 0) }
}

/**
 * The tool list as it will be sent, with every recursive schema cut.
 *
 * The whole list is returned unchanged when nothing needed fixing, so a caller that sends
 * ordinary schemas gets exactly what it sent.
 */
export function sanitizeToolSchemas(tools: unknown): unknown {
  if (!Array.isArray(tools)) return tools
  return tools.map(tool => sanitizeTool(tool))
}

/**
 * Whether a tool list contains a schema that would be refused upstream.
 *
 * Used by the tests and by the card, which reports the problem rather than sending a
 * request that cannot succeed.
 */
export function hasRecursiveSchema(tools: unknown): boolean {
  if (!Array.isArray(tools)) return false
  for (const tool of tools) {
    if (tool === null || typeof tool !== 'object') continue
    const record = tool as Record<string, unknown>
    const fn = record['function']
    const parameters = fn !== null && typeof fn === 'object'
      ? (fn as Record<string, unknown>)['parameters']
      : record['parameters']
    if (parameters === null || typeof parameters !== 'object') continue
    if (containsRecursion(parameters, parameters)) return true
  }
  return false
}

/**
 * Whether a schema refers to itself, directly or through a chain.
 *
 * The same walk the sanitizer does, without the rewriting: a reference that lands on a node
 * already on the path is the loop.
 */
function containsRecursion(node: unknown, root: unknown, ancestors: readonly unknown[] = [], depth = 0): boolean {
  if (depth > MAX_DEPTH) return false
  if (node === null || typeof node !== 'object') return false
  if (Array.isArray(node)) {
    return node.some(entry => containsRecursion(entry, root, ancestors, depth + 1))
  }
  const record = node as Record<string, unknown>
  const ref = record['$ref']
  if (typeof ref === 'string') {
    const target = referenceTarget(root, ref)
    if (target === undefined) return false
    // The reference closes a loop when the walk from the target comes back to this node.
    if (reachesNode(target, node, root, new Set())) return true
    return containsRecursion(target, root, [...ancestors, node], depth + 1)
  }
  for (const value of Object.values(record)) {
    if (containsRecursion(value, root, [...ancestors, node], depth + 1)) return true
  }
  return false
}

import { describe, expect, it } from 'vitest'
import { hasRecursiveSchema, sanitizeToolSchemas } from '../src/tool-schema.ts'

/**
 * The recursion shapes that reach an upstream.
 *
 * The reported failure named `properties.show` — a tool whose `show` property refers back
 * to itself. That is one shape; a schema can wind a cycle through a definition block, or
 * through two properties that point at each other, and all of them are refused the same way.
 */
describe('the recursive shapes an upstream refuses', () => {
  /** A tool whose `show` property refers to itself. */
  const selfReference = {
    type: 'function',
    function: {
      name: 'show',
      description: 'Show a result',
      parameters: {
        type: 'object',
        properties: {
          show: { $ref: '#/properties/show' },
        },
      },
    },
  }

  /** Two properties pointing at each other. */
  const mutualReference = {
    type: 'function',
    function: {
      name: 'pair',
      parameters: {
        type: 'object',
        properties: {
          a: { $ref: '#/properties/b' },
          b: { $ref: '#/properties/a' },
        },
      },
    },
  }

  /** A cycle wound through a definition block. */
  const throughDefinitions = {
    type: 'function',
    function: {
      name: 'node',
      parameters: {
        type: 'object',
        $defs: {
          child: {
            type: 'object',
            properties: { parent: { $ref: '#/$defs/child' } },
          },
        },
        properties: { root: { $ref: '#/$defs/child' } },
      },
    },
  }

  /** A property whose type is the object that contains it. */
  const containerReference = {
    type: 'function',
    function: {
      name: 'wrap',
      parameters: {
        type: 'object',
        properties: {
          inner: { type: 'object', properties: { outer: { $ref: '#/properties/inner' } } },
        },
      },
    },
  }

  it('spots the self-reference the upstream named', () => {
    expect(hasRecursiveSchema([selfReference])).toBe(true)
  })

  it('spots a mutual reference', () => {
    expect(hasRecursiveSchema([mutualReference])).toBe(true)
  })

  it('spots a cycle through a definition block', () => {
    expect(hasRecursiveSchema([throughDefinitions])).toBe(true)
  })

  it('spots a container that contains itself', () => {
    expect(hasRecursiveSchema([containerReference])).toBe(true)
  })

  it('makes every one of them sendable', () => {
    for (const tool of [selfReference, mutualReference, throughDefinitions, containerReference]) {
      const cleaned = sanitizeToolSchemas([tool])
      // The point of the whole exercise: it must serialise, because a schema that cannot be
      // encoded cannot be sent, and a request that cannot be sent is refused.
      expect(() => JSON.stringify(cleaned)).not.toThrow()
      // And the cut one must not look recursive any more.
      expect(hasRecursiveSchema(cleaned)).toBe(false)
    }
  })

  it('keeps the tool callable — the name and description survive', () => {
    const cleaned = sanitizeToolSchemas([selfReference]) as { function: { name: string; description: string } }[]
    expect(cleaned[0]?.function.name).toBe('show')
    expect(cleaned[0]?.function.description).toBe('Show a result')
  })

  it('leaves a schema that merely reuses a sibling definition alone', () => {
    // Reuse is not recursion: two properties pointing at the SAME definition are finite.
    const reused = {
      type: 'function',
      function: {
        name: 'pair',
        parameters: {
          type: 'object',
          $defs: { leaf: { type: 'string' } },
          properties: {
            a: { $ref: '#/$defs/leaf' },
            b: { $ref: '#/$defs/leaf' },
          },
        },
      },
    }
    expect(hasRecursiveSchema([reused])).toBe(false)
    expect(sanitizeToolSchemas([reused])).toEqual([reused])
  })
})

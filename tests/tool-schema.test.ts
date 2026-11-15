import { describe, expect, it } from 'vitest'
import { hasRecursiveSchema, sanitizeToolSchemas } from '../src/tool-schema.ts'

/**
 * Tool schemas must be sendable.
 *
 * A schema that refers to itself has no finite JSON encoding, and the upstream validator
 * finds that out before the model does: the request is refused with
 *
 *   codearts: Invalid request: tools.function.parameters is not a valid moonshot flavored
 *   json schema, details: <At path 'properties.show': detected infinite recursion without
 *   termination condition>
 *
 * which names a path the caller cannot act on. Cutting the cycle keeps the tool callable.
 */
describe('tool schemas', () => {
  it('cuts a schema that refers to itself', () => {
    const tools = [{
      type: 'function',
      function: {
        name: 'show',
        description: 'Show something',
        parameters: {
          type: 'object',
          properties: {
            show: { $ref: '#/properties/show' },
          },
        },
      },
    }]
    expect(hasRecursiveSchema(tools)).toBe(true)
    const cleaned = sanitizeToolSchemas(tools) as { function: { parameters: { properties: Record<string, unknown> } } }[]
    const properties = cleaned[0]?.function.parameters.properties ?? {}
    // The reference is replaced rather than followed, so the schema terminates.
    expect(properties['show']).toEqual({ type: 'object', additionalProperties: true })
  })

  it('cuts a cycle through a definition block', () => {
    const tools = [{
      type: 'function',
      function: {
        name: 'node',
        parameters: {
          type: 'object',
          $defs: {
            child: { type: 'object', properties: { parent: { $ref: '#/$defs/child' } } },
          },
          properties: { root: { $ref: '#/$defs/child' } },
        },
      },
    }]
    const cleaned = sanitizeToolSchemas(tools) as Record<string, unknown>[]
    // It must serialise — a schema that cannot be encoded cannot be sent.
    expect(() => JSON.stringify(cleaned)).not.toThrow()
  })

  it('leaves an ordinary schema untouched', () => {
    const tools = [{
      type: 'function',
      function: {
        name: 'read',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File to read' },
            limit: { type: 'integer', minimum: 0 },
          },
          required: ['path'],
          additionalProperties: false,
        },
      },
    }]
    expect(sanitizeToolSchemas(tools)).toEqual(tools)
    expect(hasRecursiveSchema(tools)).toBe(false)
  })

  it('handles the flat shape, without a function wrapper', () => {
    const tools = [{
      name: 'show',
      parameters: {
        type: 'object',
        properties: { show: { $ref: '#/properties/show' } },
      },
    }]
    const cleaned = sanitizeToolSchemas(tools) as { parameters: { properties: Record<string, unknown> } }[]
    expect(cleaned[0]?.parameters.properties['show']).toEqual({ type: 'object', additionalProperties: true })
  })

  it('returns a non-list unchanged', () => {
    expect(sanitizeToolSchemas(undefined)).toBeUndefined()
    expect(sanitizeToolSchemas('nonsense')).toBe('nonsense')
  })

  it('reports no recursion in a list of ordinary tools', () => {
    const tools = [
      { type: 'function', function: { name: 'a', parameters: { type: 'object', properties: { x: { type: 'string' } } } } },
      { type: 'function', function: { name: 'b', parameters: { type: 'object', properties: { y: { type: 'number' } } } } },
    ]
    expect(hasRecursiveSchema(tools)).toBe(false)
  })
})

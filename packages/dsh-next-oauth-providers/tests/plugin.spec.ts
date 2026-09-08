import { describe, expect, it } from 'vitest'
import { createHandlers } from '../src/host/rpc.ts'
import { FAMILIES } from '../src/core/catalog.ts'

describe('oauth-providers host surface', () => {
  it('exposes the four families and the RPC method map', () => {
    expect(FAMILIES.map((row) => row.family)).toEqual(['kimi', 'grok', 'codex', 'claude'])
    expect(Object.keys(createHandlers({} as never))).toContain('startLogin')
  })
})

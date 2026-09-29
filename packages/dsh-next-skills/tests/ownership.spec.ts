import { describe, expect, it } from 'vitest'
import { ownershipSidecarText, OWNERSHIP_SIDECAR, parseOwnership } from '../src/core/ownership.ts'

describe('ownership sidecar', () => {
  it('parses a valid ownership record and round-trips through the sidecar text', () => {
    const record = { owner: 'external-provider', pluginKey: 'github:o/r/team-tools', marketplaceId: 'github:o/r', skillName: 'deploy' }
    const text = ownershipSidecarText(record)
    expect(JSON.parse(text)).toEqual(record)
    expect(parseOwnership(JSON.parse(text))).toEqual(record)
  })

  it('rejects malformed ownership documents defensively', () => {
    expect(parseOwnership(null)).toBeUndefined()
    expect(parseOwnership([])).toBeUndefined()
    expect(parseOwnership('x')).toBeUndefined()
    expect(parseOwnership({})).toBeUndefined()
    expect(parseOwnership({ owner: 'external-provider' })).toBeUndefined()
    expect(parseOwnership({ owner: 'external-provider', pluginKey: '', marketplaceId: 'm', skillName: 's' })).toBeUndefined()
    expect(parseOwnership({ owner: 7, pluginKey: 'k', marketplaceId: 'm', skillName: 's' })).toBeUndefined()
  })

  it('exposes the stable sidecar filename', () => {
    expect(OWNERSHIP_SIDECAR).toBe('.dsh-next-skill-owner.json')
  })
})

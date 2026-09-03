import { describe, expect, it } from 'vitest'
import { CC_OWNER, isCcOwned, ownershipSidecarText, OWNERSHIP_SIDECAR, parseOwnership } from '../src/core/ownership.ts'

describe('ownership sidecar', () => {
  it('parses a valid ownership record and round-trips through the sidecar text', () => {
    const record = { owner: 'cc-plugins', pluginKey: 'github:o/r/team-tools', marketplaceId: 'github:o/r', skillName: 'deploy' }
    const text = ownershipSidecarText(record)
    expect(JSON.parse(text)).toEqual(record)
    expect(parseOwnership(JSON.parse(text))).toEqual(record)
  })

  it('rejects malformed ownership documents defensively', () => {
    expect(parseOwnership(null)).toBeUndefined()
    expect(parseOwnership([])).toBeUndefined()
    expect(parseOwnership('x')).toBeUndefined()
    expect(parseOwnership({})).toBeUndefined()
    expect(parseOwnership({ owner: 'cc-plugins' })).toBeUndefined()
    expect(parseOwnership({ owner: 'cc-plugins', pluginKey: '', marketplaceId: 'm', skillName: 's' })).toBeUndefined()
    expect(parseOwnership({ owner: 7, pluginKey: 'k', marketplaceId: 'm', skillName: 's' })).toBeUndefined()
  })

  it('classifies the cc-plugins owner', () => {
    expect(isCcOwned({ owner: CC_OWNER, pluginKey: 'k', marketplaceId: 'm', skillName: 's' })).toBe(true)
    expect(isCcOwned({ owner: 'other', pluginKey: 'k', marketplaceId: 'm', skillName: 's' })).toBe(false)
    expect(isCcOwned(undefined)).toBe(false)
  })

  it('exposes the stable sidecar filename and owner constant', () => {
    expect(OWNERSHIP_SIDECAR).toBe('.dsh-next-skill-owner.json')
    expect(CC_OWNER).toBe('cc-plugins')
  })
})

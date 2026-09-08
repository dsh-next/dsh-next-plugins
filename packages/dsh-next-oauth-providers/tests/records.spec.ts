import { describe, expect, it } from 'vitest'
import { grantAccountLabel, grantExpired, isOauthGrant, jsonImage } from '../src/core/records.ts'

describe('records', () => {
  const grant = { type: 'oauth' as const, access: 'a', refresh: 'r', expires: Date.now() + 60_000 }

  it('accepts a well-formed oauth grant', () => {
    expect(isOauthGrant(grant)).toBe(true)
    expect(isOauthGrant({ type: 'api_key', key: 'k' })).toBe(false)
    expect(isOauthGrant({ type: 'oauth', access: '', refresh: 'r', expires: 1 })).toBe(false)
  })

  it('drops undefined members in jsonImage', () => {
    expect(jsonImage({ type: 'oauth', access: 'a', refresh: 'r', expires: 1, extra: undefined })).toEqual({
      type: 'oauth',
      access: 'a',
      refresh: 'r',
      expires: 1,
    })
  })

  it('reads a safe account label and expiry', () => {
    expect(grantAccountLabel({ ...grant, email: 'a@b.c' })).toBe('a@b.c')
    expect(grantExpired({ ...grant, expires: 1 }, 2_000)).toBe(true)
    expect(grantExpired(grant)).toBe(false)
  })
})

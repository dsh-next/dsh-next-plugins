// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { classifyLoginError, RpcError } from '../src/core/errors.ts'
import { pluginConfigSchema, SETTINGS_NS } from '../src/core/schema.ts'
import { EMPTY_CONFIG, normalizeConfig, normalizeModelDraft, normalizeProfile, profileOf, withModels, withProvider, withoutProvider } from '../src/core/settings.ts'
import { formatCapacity, parseCapacity, validateModels } from '../src/core/capacity.ts'
import { grantAccountLabel, grantExpiryMs, isOauthGrant, jsonImage } from '../src/core/records.ts'
import { ALL_ALIASES, ALL_NATIVES, FAMILIES, familyByNative, isNativeId } from '../src/core/catalog.ts'

describe('error classification', () => {
  it.each([
    [new DOMException('cancelled', 'AbortError'), 'cancelled'],
    [new Error('EADDRINUSE'), 'port'], [new Error('address already in use'), 'port'],
    [new Error('timeout'), 'timeout'], [new Error('timed out'), 'timeout'],
    [new Error('ENOTFOUND'), 'network'], [new Error('NETWORK unavailable'), 'network'],
    [new Error('fetch failed'), 'network'], [new Error('auth rejected'), 'auth'],
    [new Error('unauthorized'), 'auth'], [new Error('invalid_grant'), 'auth'],
    [new Error('unexpected'), 'unknown'], ['plain rejection', 'unknown'], [null, 'unknown'],
  ])('maps %s to %s', (error, code) => {
    const classified = classifyLoginError(error)
    expect(classified.code).toBe(code)
    expect(classified.message).toBe(error instanceof Error ? error.message : String(error))
  })

  it('preserves explicit codes and parameters without reclassification', () => {
    const error = new RpcError('store', 'network-looking message', { attempts: 2 })
    expect(error.name).toBe('RpcError')
    expect(classifyLoginError(error)).toBe(error)
    expect(error.params).toEqual({ attempts: 2 })
  })
})

describe('settings boundaries', () => {
  it('defaults the registered section and accepts both persisted formats', () => {
    expect(SETTINGS_NS).toBe('dsh-next-oauth-providers')
    expect(pluginConfigSchema({})).toEqual({ providers: [] })
    for (const providers of [[], [{ id: 'xai' }], { xai: {} }]) {
      expect(pluginConfigSchema({ providers }).providers).toEqual(providers)
    }
  })

  it.each([undefined, null, [], false, 'text', 1])('normalizes invalid model/profile/config roots (%j)', (root) => {
    expect(normalizeModelDraft(root)).toBeUndefined()
    expect(normalizeProfile(root)).toEqual({})
    expect(normalizeConfig(root)).toEqual(EMPTY_CONFIG)
  })

  it('trims labels, validates positive integer capacities and drops invalid model rows', () => {
    expect(normalizeModelDraft({ id: ' m ', name: ' Name ', contextWindow: 123, maxTokens: 4 })).toEqual({ id: 'm', name: 'Name', contextWindow: 123, maxTokens: 4 })
    for (const count of [0, -1, 1.5, Infinity, NaN, '100']) {
      expect(normalizeModelDraft({ id: 'm', name: ' ', contextWindow: count, maxTokens: count })).toEqual({ id: 'm' })
    }
    expect(normalizeProfile({ displayName: ' Test ', models: [{ id: ' ' }, { id: ' m ' }] })).toEqual({ displayName: 'Test', models: [{ id: 'm' }] })
    expect(normalizeProfile({ models: [{ id: '' }], displayName: 4 })).toEqual({})
  })

  it('handles invalid provider rows and uses the last recognized list row', () => {
    expect(normalizeConfig({ providers: [null, {}, { id: 5 }, { id: 'unknown' }, { id: 'xai', displayName: 'First' }, { id: 'xai-oauth', displayName: 'Last' }] })).toEqual({ providers: { xai: { displayName: 'Last' } } })
    expect(normalizeConfig({ providers: { 'xai-oauth': { displayName: 'Alias' }, 'subscription-grok': { displayName: 'Legacy' } } }).providers.xai?.displayName).toBe('Alias')
  })

  it('preserves labels and other providers without mutating its input', () => {
    const original = { providers: { xai: { displayName: 'Mine', models: [{ id: 'old' }] }, anthropic: {} } }
    expect(profileOf(original, 'kimi-coding')).toEqual({})
    expect(withProvider(original, 'xai').providers.xai).toBe(original.providers.xai)
    expect(withProvider(original, 'xai', {}).providers.xai).toEqual({})
    const changed = withModels(original, 'xai', [{ id: 'new' }])
    expect(changed.providers.xai).toEqual({ displayName: 'Mine', models: [{ id: 'new' }] })
    expect(withModels(changed, 'xai', []).providers.xai).toEqual({ displayName: 'Mine' })
    expect(withoutProvider(original, 'xai')).toEqual({ providers: { anthropic: {} } })
    expect(original.providers.xai.models).toEqual([{ id: 'old' }])
  })
})

describe('capacity validation boundaries', () => {
  it('distinguishes inherit, invalid text, raw counts and scaled decimals', () => {
    expect(parseCapacity(' ')).toBeUndefined()
    for (const text of ['-1', '1e3', '1 K', 'bad']) expect(parseCapacity(text)).toBeNaN()
    expect(parseCapacity(' 1.5m ')).toBe(1_500_000)
    expect(parseCapacity('0.001K')).toBe(1)
    expect(parseCapacity('1.2')).toBe(1.2)
    for (const value of [1, 999, 1000, 1_000_000, 256_001]) expect(parseCapacity(formatCapacity(value))).toBe(value)
    for (const value of [0, -1, NaN, Infinity, 1.5]) expect(formatCapacity(value)).toBe(String(value))
  })

  it('reports each invalid field and first invalid row', () => {
    const valid = { id: 'valid' }
    for (const [row, key] of [
      [{ id: ' ' }, 'modelIdRequired'], [{ id: ' valid ' }, 'modelIdDuplicate'],
      [{ id: 'next', name: ' ' }, 'modelNameInvalid'],
      [{ id: 'next', contextWindow: NaN }, 'modelContextInvalid'],
      [{ id: 'next', maxTokens: 0 }, 'modelMaxTokensInvalid'],
    ] as const) expect(validateModels([valid, row])).toEqual({ index: 1, key })
    for (const value of [-1, 1.5, Infinity, NaN]) {
      expect(validateModels([{ id: 'm', contextWindow: value }])?.key).toBe('modelContextInvalid')
      expect(validateModels([{ id: 'm', maxTokens: value }])?.key).toBe('modelMaxTokensInvalid')
    }
    expect(validateModels([])).toBeUndefined()
    expect(validateModels([{ id: 'm', contextWindow: 1, maxTokens: 1 }])).toBeUndefined()
  })
})

describe('grant and catalog boundaries', () => {
  const grant = { type: 'oauth' as const, access: 'a', refresh: 'r', expires: 1 }
  it('rejects malformed grant fields and normalizes optional JSON members', () => {
    for (const value of [null, 'grant', {}, { ...grant, refresh: '' }, { ...grant, expires: Infinity }, { ...grant, access: 1 }]) expect(isOauthGrant(value)).toBe(false)
    expect(jsonImage({ array: [undefined, { omit: undefined, keep: null }] })).toEqual({ array: [null, { keep: null }] })
    const date = new Date(0)
    expect(jsonImage(date)).toBe(date)
    expect(grantExpiryMs(grant)).toBe(1000)
    expect(grantExpiryMs({ ...grant, expires: 1_900_000_000_000 })).toBe(1_900_000_000_000)
  })

  it('uses label priority and never falls back to access tokens', () => {
    expect(grantAccountLabel(grant)).toBeUndefined()
    expect(grantAccountLabel({ ...grant, accountId: ' account ', email: 'email' })).toBe('account')
    expect(grantAccountLabel({ ...grant, accountId: ' ', email: 3, login: 'login', name: 'Name' })).toBe('login')
    expect(grantAccountLabel({ ...grant, name: 'Name' })).toBe('Name')
  })

  it('recognizes all native ids and rejects unrelated routes', () => {
    expect(ALL_NATIVES).toEqual(FAMILIES.map((family) => family.nativeId))
    expect(ALL_ALIASES).toEqual(FAMILIES.map((family) => family.alias))
    for (const family of FAMILIES) {
      expect(isNativeId(family.nativeId)).toBe(true)
      expect(familyByNative(family.nativeId)).toBe(family)
      expect(isNativeId(family.alias)).toBe(false)
    }
    expect(familyByNative('unknown')).toBeUndefined()
  })
})

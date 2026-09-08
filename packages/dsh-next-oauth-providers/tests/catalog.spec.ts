import { describe, expect, it } from 'vitest'
import {
  aliasForNative,
  FAMILIES,
  familyByAlias,
  familyById,
  isAliasRoute,
  nativeForAlias,
  nativeForSettingsKey,
} from '../src/core/catalog.ts'

describe('catalog', () => {
  it('maps four families to unique alias and native ids', () => {
    expect(FAMILIES).toHaveLength(4)
    const aliases = new Set(FAMILIES.map((row) => row.alias))
    const natives = new Set(FAMILIES.map((row) => row.nativeId))
    expect(aliases.size).toBe(4)
    expect(natives.size).toBe(4)
  })

  it('round-trips alias and native ids', () => {
    for (const row of FAMILIES) {
      expect(nativeForAlias(row.alias)).toBe(row.nativeId)
      expect(aliasForNative(row.nativeId)).toBe(row.alias)
      expect(familyByAlias(row.alias)?.family).toBe(row.family)
      expect(familyById(row.family)?.alias).toBe(row.alias)
    }
  })

  it('rejects unknown routes', () => {
    expect(isAliasRoute('anthropic')).toBe(false)
    expect(isAliasRoute('anthropic-oauth')).toBe(true)
    expect(() => nativeForAlias('anthropic')).toThrow(/unknown/)
    expect(() => aliasForNative('openai')).toThrow(/unknown/)
  })

  it('maps official catalog ids, -oauth routes, and leftover yaml keys', () => {
    expect(nativeForSettingsKey('xai')).toBe('xai')
    expect(nativeForSettingsKey('xai-oauth')).toBe('xai')
    expect(nativeForSettingsKey('subscription-grok')).toBe('xai')
    expect(nativeForSettingsKey('kimi-coding')).toBe('kimi-coding')
    expect(nativeForSettingsKey('kimi-coding-oauth')).toBe('kimi-coding')
    expect(nativeForSettingsKey('openai-codex')).toBe('openai-codex')
    expect(nativeForSettingsKey('anthropic')).toBe('anthropic')
    expect(nativeForSettingsKey('anthropic-oauth')).toBe('anthropic')
    expect(nativeForSettingsKey('grok-build')).toBeUndefined()
  })
})

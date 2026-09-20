import { describe, expect, it } from 'vitest'
import { PanelPreferenceStore } from '../src/client/preferences.ts'

const value = { message: 'draft', collapsed: { changes: false, worktrees: true, history: false } }

describe('checkout-scoped preferences', () => {
  it('isolates session and active checkout and persists through a new instance', () => {
    const values = new Map<string, string>()
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, text: string) => { values.set(key, text) } }
    const store = new PanelPreferenceStore(() => storage)
    store.write('s1', '/one', value)
    expect(store.read('s1', '/two')).toBeUndefined()
    expect(store.read('s2', '/one')).toBeUndefined()
    expect(new PanelPreferenceStore(() => storage).read('s1', '/one')).toEqual(value)
  })

  it('keeps drafts in memory if storage is unavailable or throws', () => {
    for (const storage of [() => undefined, () => { throw new Error('disabled') }]) {
      const store = new PanelPreferenceStore(storage)
      expect(store.read('s', '/root')).toBeUndefined()
      store.write('s', '/root', value)
      expect(store.read('s', '/root')).toEqual(value)
    }
  })

  it.each(['broken', '{}', 'null', '{"message":4}', '{"message":"x","collapsed":{}}', '{"message":"x","collapsed":{"changes":true,"worktrees":false,"history":"yes"}}'])('ignores malformed persisted data: %s', (raw) => {
    const store = new PanelPreferenceStore(() => ({ getItem: () => raw, setItem: () => {} }))
    expect(store.read('s', '/root')).toBeUndefined()
  })

  it('stores empty drafts so committed messages cannot reappear', () => {
    const store = new PanelPreferenceStore(() => undefined)
    store.write('s', '/root', value)
    store.write('s', '/root', { ...value, message: '' })
    expect(store.read('s', '/root')?.message).toBe('')
  })
})

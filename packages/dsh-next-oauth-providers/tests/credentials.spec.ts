import { describe, expect, it, vi } from 'vitest'
import { createModels, type Credential } from '@earendil-works/pi-ai'
import { credentialKey, type CredentialKey, type CredentialProvider, type CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { credentialStoreFrom, denyAmbientAuthContext, recordKeyFor } from '../src/host/credentials.ts'
import { nativeFactory } from '../src/host/providers.ts'

const grant = { type: 'oauth' as const, access: 'test-access', refresh: 'test-refresh', expires: 1_900_000_000_000 }

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

function memoryCredentials(seed: [CredentialKey, CredentialRecord][] = []) {
  const records = new Map(seed)
  let lock = Promise.resolve()
  const provider = {
    readRecord: vi.fn(async (key: CredentialKey) => records.get(key)),
    listRecords: vi.fn(async () => [...records].map(([key, record]) => ({ key, kind: record.kind }))),
    modifyRecord: vi.fn((key: CredentialKey, mutate: Parameters<CredentialProvider['modifyRecord']>[1]) => {
      const operation = lock.then(async () => {
        const next = await mutate(records.get(key))
        if (next !== undefined) records.set(key, next)
        return records.get(key)
      })
      lock = operation.then(() => {}, () => {})
      return operation
    }),
    deleteRecord: vi.fn(async (key: CredentialKey) => { await lock; records.delete(key) }),
  } satisfies Pick<CredentialProvider, 'readRecord' | 'listRecords' | 'modifyRecord' | 'deleteRecord'>
  return { records, provider, store: credentialStoreFrom(provider as unknown as CredentialProvider) }
}

describe('credential store adapter', () => {
  it('uses only plugin-scoped native provider keys', async () => {
    expect(recordKeyFor('xai')).toBe('dsh-next-oauth-providers/xai')
    expect(() => recordKeyFor('../xai')).toThrow()
    const { store, provider } = memoryCredentials()
    for (const id of ['../xai', 'unknown', 'xai-oauth', '']) {
      expect(await store.read(id)).toBeUndefined()
      await store.delete(id)
      await expect(store.modify(id, async () => grant)).rejects.toMatchObject({ code: 'store' })
    }
    expect(provider.readRecord).not.toHaveBeenCalled()
    expect(provider.deleteRecord).not.toHaveBeenCalled()
    expect(provider.modifyRecord).not.toHaveBeenCalled()
  })

  it('reads grants and legacy API-key records, but ignores malformed grants', async () => {
    const env = { TEST_KEY: 'test-value' }
    const { records, store } = memoryCredentials([[recordKeyFor('xai'), { kind: 'grant', payload: grant }]])
    expect(await store.read('xai')).toEqual(grant)
    records.set(recordKeyFor('xai'), { kind: 'api-key', key: 'legacy-key', env })
    const read = await store.read('xai')
    expect(read).toEqual({ type: 'api_key', key: 'legacy-key', env })
    expect((read as { env: unknown }).env).not.toBe(env)
    records.set(recordKeyFor('xai'), { kind: 'api-key' })
    expect(await store.read('xai')).toEqual({ type: 'api_key' })
    records.set(recordKeyFor('xai'), { kind: 'grant', payload: {} })
    expect(await store.read('xai')).toBeUndefined()
    expect(await store.read('anthropic')).toBeUndefined()
  })

  it('lists only supported records in this scope without leaking payloads', async () => {
    const { store } = memoryCredentials([
      [recordKeyFor('xai'), { kind: 'grant', payload: grant }],
      [recordKeyFor('anthropic'), { kind: 'api-key', key: 'test-key' }],
      [credentialKey('another-plugin', 'xai'), { kind: 'grant', payload: grant }],
      [recordKeyFor('unknown'), { kind: 'grant', payload: grant }],
    ])
    expect(await store.list()).toEqual([
      { providerId: 'xai', type: 'oauth' }, { providerId: 'anthropic', type: 'api_key' },
    ])
  })

  it('serializes mutations, preserves no-op writes, and deletes only one grant', async () => {
    const { store, records } = memoryCredentials([[recordKeyFor('anthropic'), { kind: 'grant', payload: grant }]])
    await store.modify('xai', async (current) => {
      expect(current).toBeUndefined()
      return { ...grant, extra: undefined, nested: { omitted: undefined, keep: 1 } }
    })
    expect(records.get(recordKeyFor('xai'))).toEqual({ kind: 'grant', payload: { ...grant, nested: { keep: 1 } } })
    expect(await store.modify('xai', async () => undefined)).toEqual({ ...grant, nested: { keep: 1 } })
    await store.delete('xai')
    expect(await store.read('xai')).toBeUndefined()
    expect(await store.read('anthropic')).toEqual(grant)
  })

  it('rejects API-key writes and propagates mutation and storage failures', async () => {
    const { store, provider } = memoryCredentials()
    await expect(store.modify('xai', async () => ({ type: 'api_key', key: 'key' }))).rejects.toMatchObject({ code: 'store' })
    const failure = new Error('storage failed')
    await expect(store.modify('xai', async () => { throw failure })).rejects.toBe(failure)
    provider.readRecord.mockRejectedValueOnce(failure)
    await expect(store.read('xai')).rejects.toBe(failure)
    provider.listRecords.mockRejectedValueOnce(failure)
    await expect(store.list()).rejects.toBe(failure)
    provider.deleteRecord.mockRejectedValueOnce(failure)
    await expect(store.delete('xai')).rejects.toBe(failure)
  })

  it('rejects operations already cancelled before accessing storage', async () => {
    const { store, provider } = memoryCredentials()
    const signal = AbortSignal.abort()
    const mutate = vi.fn(async () => grant)
    for (const operation of [
      () => store.read('xai', { signal }), () => store.list({ signal }),
      () => store.modify('xai', mutate, { signal }), () => store.delete('xai', { signal }),
    ]) await expect(operation()).rejects.toMatchObject({ name: 'AbortError' })
    expect(mutate).not.toHaveBeenCalled()
    for (const method of Object.values(provider)) expect(method).not.toHaveBeenCalled()
  })

  it('does not overwrite a grant when real SDK login is cancelled while waiting for the lock', async () => {
    const { store, provider } = memoryCredentials([[recordKeyFor('xai'), { kind: 'grant', payload: grant }]])
    const lockHeld = deferred()
    const release = deferred()
    const holder = store.modify('xai', async () => { lockHeld.resolve(); await release.promise; return undefined })
    await lockHeld.promise
    const base = nativeFactory('xai')
    const models = createModels({ credentials: store, authContext: denyAmbientAuthContext() })
    models.setProvider({ ...base, auth: { oauth: { ...base.auth.oauth!, login: async () => ({ ...grant, access: 'cancelled-grant' }) } } })
    const controller = new AbortController()
    const login = models.login('xai', 'oauth', { signal: controller.signal, notify: () => {}, prompt: async () => '' })
    const rejected = expect(login).rejects.toMatchObject({ name: 'AbortError' })
    try {
      await vi.waitFor(() => expect(provider.modifyRecord).toHaveBeenCalledTimes(2))
      controller.abort()
      await rejected
    } finally {
      release.resolve()
      await holder
    }
    await Promise.allSettled(provider.modifyRecord.mock.results.map((entry) => entry.value as Promise<unknown>))
    expect(await store.read('xai')).toEqual(grant)
  })

  it('keeps a rotated refresh token if cancellation happens after mutation started', async () => {
    const { store } = memoryCredentials([[recordKeyFor('xai'), { kind: 'grant', payload: grant }]])
    const entered = deferred()
    const release = deferred()
    const controller = new AbortController()
    const first = store.modify('xai', async () => {
      entered.resolve()
      await release.promise
      return { ...grant, refresh: 'rotated-refresh' }
    }, { signal: controller.signal })
    await entered.promise
    const observed: (Credential | undefined)[] = []
    const second = store.modify('xai', async (current) => { observed.push(current); return undefined })
    controller.abort()
    release.resolve()
    await first
    await second
    expect(observed).toEqual([{ ...grant, refresh: 'rotated-refresh' }])
  })

  it('never resolves ambient credentials', async () => {
    const context = denyAmbientAuthContext()
    expect(await context.env('PATH')).toBeUndefined()
    expect(await context.fileExists('~/.credentials')).toBe(false)
  })
})

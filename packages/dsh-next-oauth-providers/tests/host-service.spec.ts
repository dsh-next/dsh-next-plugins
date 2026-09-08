import { describe, expect, it, vi } from 'vitest'
import type { Credential, CredentialStore } from '@earendil-works/pi-ai'
import { SubscriptionsService, type ConfigScopeFace } from '../src/host/service.ts'

function memoryStore(seed: Record<string, Credential> = {}): CredentialStore {
  const map = new Map<string, Credential>(Object.entries(seed))
  return {
    read: async (id) => map.get(id),
    list: async () => [...map.entries()].map(([providerId, credential]) => ({ providerId, type: credential.type })),
    modify: async (id, fn) => {
      const next = await fn(map.get(id))
      if (next !== undefined) map.set(id, next)
      return map.get(id)
    },
    delete: async (id) => { map.delete(id) },
  }
}

function memoryConfig(initial: object = {}): ConfigScopeFace {
  let value: object = initial
  return {
    get: () => value,
    update: async (patch) => { value = { ...value, ...patch } },
    replace: async (section) => { value = section },
    watch: () => () => {},
  }
}

const grant = { type: 'oauth' as const, access: 'a', refresh: 'r', expires: Date.now() + 60_000 }

describe('SubscriptionsService', () => {
  it('rewrites legacy subscription-* settings keys to official catalog ids', async () => {
    const config = memoryConfig({
      providers: { 'subscription-grok': { models: [{ id: 'grok-4.6' }] } },
    })
    const service = new SubscriptionsService({
      store: memoryStore({ xai: grant }),
      config,
      fetch: async () => new Response('{}'),
    })
    await service.hydrate()
    expect(service.configValue().providers.xai?.models).toEqual([{ id: 'grok-4.6' }])
    expect(config.get()).toEqual({
      providers: [{ id: 'xai', displayName: 'Grok', models: [{ id: 'grok-4.6' }] }],
    })
  })

  it('rewrites an empty models list so the built-in catalog is served', async () => {
    const config = memoryConfig({ providers: { xai: { models: [] } } })
    const service = new SubscriptionsService({
      store: memoryStore({ xai: grant }),
      config,
      fetch: async () => new Response('{}'),
    })
    await service.hydrate()
    expect(service.configValue().providers.xai?.models).toBeUndefined()
    expect(config.get()).toEqual({
      providers: [{ id: 'xai', displayName: 'Grok' }],
    })
    const state = await service.state()
    expect(state.providers[0]?.usingDefaults).toBe(true)
    expect(state.providers[0]?.models.length).toBeGreaterThan(0)
    expect(state.providers[0]?.models.find((row) => row.id === 'grok-4.6')).toMatchObject({
      contextWindow: 500_000,
      maxTokens: 500_000,
    })
  })

  it('hydrates connected routes from stored grants', async () => {
    const routes: string[][] = []
    const service = new SubscriptionsService({
      store: memoryStore({ 'kimi-coding': grant }),
      config: memoryConfig(),
      fetch: async () => new Response('{}'),
      onRoutesChanged: (aliases) => routes.push([...aliases]),
    })
    await service.hydrate()
    expect(routes.at(-1)).toEqual(['kimi-coding-oauth'])
    const state = await service.state()
    expect(state.providers.find((row) => row.family === 'kimi')?.status).toBe('connected')
  })

  it('commits a grant only after a still-current login succeeds', async () => {
    const store = memoryStore()
    const service = new SubscriptionsService({
      store,
      config: memoryConfig(),
      fetch: async () => new Response('{}'),
      login: async (nativeId, _interaction) => {
        await store.modify(nativeId, async () => grant)
      },
    })
    const attempt = await service.startLogin('kimi')
    await vi.waitFor(async () => {
      const next = await service.getAttempt(attempt.id)
      expect(next.status).toBe('authorized')
    })
    expect(await store.read('kimi-coding')).toMatchObject({ type: 'oauth' })
  })

  it('preserves a previous grant when login fails', async () => {
    const store = memoryStore({ 'anthropic': grant })
    const service = new SubscriptionsService({
      store,
      config: memoryConfig(),
      fetch: async () => new Response('{}'),
      login: async () => { throw new Error('invalid_grant') },
    })
    await service.hydrate()
    const attempt = await service.startLogin('claude')
    await vi.waitFor(async () => {
      expect((await service.getAttempt(attempt.id)).status).toBe('failed')
    })
    expect(await store.read('anthropic')).toMatchObject({ type: 'oauth' })
  })

  it('disconnect deletes only that family grant and drops the route', async () => {
    const store = memoryStore({ 'kimi-coding': grant, 'xai': grant })
    const routes: string[][] = []
    const service = new SubscriptionsService({
      store,
      config: memoryConfig(),
      fetch: async () => new Response('{}'),
      onRoutesChanged: (aliases) => routes.push([...aliases]),
    })
    await service.hydrate()
    await service.disconnect('kimi')
    expect(await store.read('kimi-coding')).toBeUndefined()
    expect(await store.read('xai')).toMatchObject({ type: 'oauth' })
    expect(routes.at(-1)).toEqual(['xai-oauth'])
  })

  it('refuses a second in-flight login', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const service = new SubscriptionsService({
      store: memoryStore(),
      config: memoryConfig(),
      fetch: async () => new Response('{}'),
      login: async () => gate,
    })
    await service.startLogin('kimi')
    await expect(service.startLogin('grok')).rejects.toMatchObject({ code: 'busy' })
    release()
  })

  it('cancelLogin marks the attempt cancelled immediately', async () => {
    const gate = new Promise<void>(() => {})
    const service = new SubscriptionsService({
      store: memoryStore(),
      config: memoryConfig(),
      fetch: async () => new Response('{}'),
      login: async () => gate,
    })
    const started = await service.startLogin('grok')
    const cancelled = await service.cancelLogin(started.id)
    expect(cancelled.status).toBe('cancelled')
    expect(cancelled.error?.code).toBe('cancelled')
  })

  it('writes an explicit model catalog and can restore defaults', async () => {
    const config = memoryConfig()
    const service = new SubscriptionsService({
      store: memoryStore({ 'openai-codex': grant }),
      config,
      fetch: async () => new Response('{}'),
    })
    await service.hydrate()
    await service.addModel('openai-codex-oauth', { id: 'gpt-5' })
    expect(service.configValue().providers['openai-codex']?.models?.some((row) => row.id === 'gpt-5')).toBe(true)
    await service.restoreModels('openai-codex-oauth')
    expect(service.configValue().providers['openai-codex']?.models).toBeUndefined()
  })

  it('lists only added or connected families and can remove them', async () => {
    const service = new SubscriptionsService({
      store: memoryStore({ 'kimi-coding': grant }),
      config: memoryConfig(),
      fetch: async () => new Response('{}'),
    })
    await service.hydrate()
    const connected = await service.state()
    expect(connected.providers.map((row) => row.family)).toEqual(['kimi'])
    expect(connected.providers[0]?.defaultModels.length).toBeGreaterThan(0)
    await service.addProvider('grok')
    expect((await service.state()).providers.map((row) => row.family)).toEqual(['kimi', 'grok'])
    await service.removeProvider('kimi')
    const after = await service.state()
    expect(after.providers.map((row) => row.family)).toEqual(['grok'])
    expect(after.providers[0]?.status).toBe('disconnected')
  })

  it('listModels refuses until signed in and then returns drafts', async () => {
    const service = new SubscriptionsService({
      store: memoryStore({ 'openai-codex': grant }),
      config: memoryConfig(),
      fetch: async () => new Response('{}'),
    })
    await expect(service.listModels('codex')).rejects.toMatchObject({ code: 'auth' })
    await service.hydrate()
    const models = await service.listModels('codex')
    expect(models.some((row) => typeof row.id === 'string' && row.id.length > 0)).toBe(true)
  })
})

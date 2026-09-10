/**
 * The real `PiAiAdapter` wired exactly as `src/index.ts` wires it, over the
 * profiles this plugin builds.
 *
 * The plugin hand-builds `ResolvedPiAiProviderProfile` values because the SDK
 * does not export its own resolver, so the builder can drift from what the
 * runtime adapter reads. When it does, the failure lands inside the adapter
 * and takes the whole model catalog down with it: a missing `modelErrors` map
 * made every exact-model lookup throw "Cannot read properties of undefined
 * (reading 'get')", which emptied the picker and broke every chat request.
 * Only a spec that runs the real adapter over a real profile catches that.
 */
import { describe, expect, it } from 'vitest'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import { FAMILIES, familyByNative, type Family } from '../src/core/catalog.ts'
import { AliasLlmAdapter } from '../src/host/adapter.ts'
import { denyAmbientAuthContext } from '../src/host/credentials.ts'
import { buildProfile } from '../src/host/profiles.ts'
import { SubscriptionsService } from '../src/host/service.ts'
import { grant, memoryConfig, memoryStore } from './helpers/service-fixtures.ts'

/** The alias adapter over a real PiAiAdapter, wired like the host loader. */
async function connectedAdapter(family: Family): Promise<AliasLlmAdapter> {
  const store = memoryStore({ [family.nativeId]: grant })
  const service = new SubscriptionsService({
    store,
    config: memoryConfig({ providers: [{ id: family.nativeId, displayName: family.displayName }] }),
    fetch: () => { throw new Error('catalog contracts must not reach the network') },
  })
  await service.hydrate()
  return new AliasLlmAdapter(new PiAiAdapter({
    profiles: () => service.profiles(),
    resolveApiKey: async () => undefined,
    auth: { credentials: store, authContext: denyAmbientAuthContext() },
  }))
}

describe('resolved profile runtime shape', () => {
  it.each(FAMILIES)('carries every field the adapter reads for $family', (family) => {
    const profile = buildProfile(family, {})
    expect(profile.provider).toBe(family.nativeId)
    expect(profile.piProvider).toBeDefined()
    // The adapter calls `profile.modelErrors.get(model)` on every exact-model
    // lookup; an absent map is a TypeError, not a miss.
    expect(profile.modelErrors).toBeInstanceOf(Map)
    expect([...profile.modelErrors]).toEqual([])
    expect(profile.configuredMaxTokens).toBeInstanceOf(Map)
    expect(profile.retryPolicy).toBeDefined()
  })
})

describe('real adapter over resolved profiles', () => {
  it.each(FAMILIES)('lists and resolves every $family model through the alias route', async (family) => {
    const adapter = await connectedAdapter(family)
    const models = await adapter.listModels(family.alias)
    expect(models.length).toBeGreaterThan(0)
    for (const model of models) {
      expect(model.provider).toBe(family.alias)
      const resolved = await adapter.resolveModel(family.alias, model.id)
      expect(resolved).toMatchObject({ provider: family.alias, id: model.id })
    }
  })

  it.each(FAMILIES)('binds a chat call for $family without touching the network', async (family) => {
    const adapter = await connectedAdapter(family)
    const [model] = await adapter.listModels(family.alias)
    expect(model).toBeDefined()
    const prepared = await adapter.prepareCall(family.alias, model!.id)
    expect(prepared.model).toMatchObject({ provider: family.alias, id: model!.id })
    expect(prepared.model.context?.contextWindow).toBeGreaterThan(0)
    expect(typeof prepared.stream).toBe('function')
  })

  it('answers an unknown model with a typed miss rather than a TypeError', async () => {
    const family = familyByNative('xai')!
    const adapter = await connectedAdapter(family)
    await expect(adapter.resolveModel(family.alias, 'not-a-catalog-model'))
      .rejects.toMatchObject({ code: 'UNKNOWN_MODEL' })
  })

  it('serves a stored custom catalog instead of the built-in one', async () => {
    const family = familyByNative('xai')!
    const store = memoryStore({ [family.nativeId]: grant })
    const service = new SubscriptionsService({
      store,
      config: memoryConfig({ providers: [{ id: family.nativeId, displayName: 'Grok', models: [{ id: 'custom-grok', maxTokens: 2048 }] }] }),
      fetch: () => { throw new Error('catalog contracts must not reach the network') },
    })
    await service.hydrate()
    const adapter = new AliasLlmAdapter(new PiAiAdapter({
      profiles: () => service.profiles(),
      resolveApiKey: async () => undefined,
      auth: { credentials: store, authContext: denyAmbientAuthContext() },
    }))
    expect((await adapter.listModels(family.alias)).map((row) => row.id)).toEqual(['custom-grok'])
    expect(await adapter.resolveModel(family.alias, 'custom-grok')).toMatchObject({
      id: 'custom-grok', defaultMaxTokens: 2048,
    })
  })

  it('owns only the connected family and refuses the other alias routes', async () => {
    const family = familyByNative('openai-codex')!
    const adapter = await connectedAdapter(family)
    expect(adapter.providerInfo(family.alias).name).toBe('ChatGPT')
    await expect(adapter.listModels('xai-oauth')).rejects.toMatchObject({ code: 'NO_ADAPTER' })
    await expect(adapter.resolveModel('xai-oauth', 'grok-4')).rejects.toMatchObject({ code: 'NO_ADAPTER' })
  })
})

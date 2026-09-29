// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DecisionError, type ChoiceRequest, type DecisionProvider, type ProviderChange } from '../src/core/types.ts'
import { configStore, type ConfigEditor, type ConfigStore } from '../src/host/config.ts'
import type { DecisionKeys } from '../src/host/credentials.ts'
import { DecisionService } from '../src/host/service.ts'

function provider(id = 'primary'): DecisionProvider {
  return { id, name: `Provider ${id}`, baseUrl: `https://${id}.example/v1`, models: [{ id: 'choice-v1' }, { id: 'explicit/model:2' }] }
}
function request(providerId = 'primary'): ChoiceRequest {
  return {
    providerId, modelId: 'choice-v1', state: { observation: ['blue'] },
    questions: { color: { type: 'choice', instructions: 'Select the stated color.', criteria: { blue: 'Blue is stated.', green: null } } },
  }
}
function answer() {
  return {
    model: 'choice-v1-resolved',
    answers: { color: { type: 'choice', choice: 'blue', probabilities: { blue: 0.8, green: 0.2 }, confidence: 0.6 } },
    usage: { input_tokens: 8, output_tokens: 2 },
  }
}
function json(value: unknown = answer(), init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), { ...init, headers: { 'content-type': 'application/json', ...init.headers } })
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}
const services: DecisionService[] = []
function harness(options: { providers?: DecisionProvider[]; keys?: Record<string, string>; writable?: boolean; timeoutMs?: number } = {}) {
  let stored = structuredClone(options.providers ?? [provider()])
  const secrets = new Map(Object.entries(options.keys ?? {}))
  const config = {
    writable: options.writable ?? true,
    read: vi.fn(() => structuredClone(stored)),
    write: vi.fn<ConfigStore['write']>(async (next, expected) => {
      if (JSON.stringify(stored) !== JSON.stringify(expected)) throw new DecisionError('conflict')
      stored = structuredClone(next)
    }),
  }
  const keys = {
    read: vi.fn<DecisionKeys['read']>(async id => secrets.get(id)),
    write: vi.fn<DecisionKeys['write']>(async (id, value) => {
      if (value === undefined) secrets.delete(id)
      else secrets.set(id, value)
    }),
  }
  const fetch = vi.fn<typeof globalThis.fetch>(async () => json())
  const service = new DecisionService({ config, keys, fetch, timeoutMs: options.timeoutMs })
  services.push(service)
  return { service, config, keys, fetch, secrets, stored: () => structuredClone(stored), external: (next: DecisionProvider[]) => { stored = structuredClone(next) } }
}
afterEach(() => {
  for (const service of services.splice(0)) service.dispose()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function change(h: ReturnType<typeof harness>, patch: Partial<ProviderChange> = {}) {
  return { provider: provider(), mode: 'edit' as const, revision: (await h.service.state()).revision, ...patch }
}

describe('DecisionService state and explicit decision catalog', () => {
  it('returns a key-redacted, detached state and stable opaque revision', async () => {
    const h = harness({ keys: { primary: 'secret-not-for-the-browser' } })
    const state = await h.service.state()
    expect(Object.keys(state).sort()).toEqual(['providers', 'revision', 'writable'])
    expect(state).toEqual({ providers: [{ ...provider(), keyConfigured: true }], writable: true, revision: expect.any(String) })
    expect(state.revision).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(state)).not.toContain('secret-not-for-the-browser')
    state.providers[0].name = 'Caller mutation'
    state.providers[0].models[0].id = 'not-explicitly-configured'
    state.providers[0].models.push({ id: 'caller-only' })
    expect(await h.service.state()).toEqual({ providers: [{ ...provider(), keyConfigured: true }], writable: true, revision: state.revision })
    expect(h.fetch).not.toHaveBeenCalled()
  })

  it('lists only configured models, including same-named models on separate providers, without discovery or credential reads', async () => {
    const h = harness({ providers: [provider(), provider('secondary')] })
    const models = await h.service.listModels()
    expect(models).toEqual([
      { providerId: 'primary', providerName: 'Provider primary', modelId: 'choice-v1' },
      { providerId: 'primary', providerName: 'Provider primary', modelId: 'explicit/model:2' },
      { providerId: 'secondary', providerName: 'Provider secondary', modelId: 'choice-v1' },
      { providerId: 'secondary', providerName: 'Provider secondary', modelId: 'explicit/model:2' },
    ])
    models[0].modelId = 'caller-injected'
    expect((await h.service.listModels())[0].modelId).toBe('choice-v1')
    expect(h.keys.read).not.toHaveBeenCalled()
    expect(h.fetch).not.toHaveBeenCalled()
    expect(await harness({ providers: [] }).service.listModels()).toEqual([])
  })

  it('lists optional presentation/context fields only when advertised, without treating them as generation capabilities', async () => {
    const configured = { ...provider(), models: [
      { id: 'org/Exact-ID:2026', name: 'Friendly choice', contextWindow: 128_000 },
      { id: 'name-only', name: 'Named' }, { id: 'context-only', contextWindow: 1_000_000 }, { id: 'plain' },
    ] }
    const h = harness({ providers: [configured] })
    expect(await h.service.listModels()).toEqual([
      { providerId: 'primary', providerName: 'Provider primary', modelId: 'org/Exact-ID:2026', modelName: 'Friendly choice', contextWindow: 128_000 },
      { providerId: 'primary', providerName: 'Provider primary', modelId: 'name-only', modelName: 'Named' },
      { providerId: 'primary', providerName: 'Provider primary', modelId: 'context-only', contextWindow: 1_000_000 },
      { providerId: 'primary', providerName: 'Provider primary', modelId: 'plain' },
    ])
    const listed = await h.service.listModels()
    listed[0].modelName = 'Caller changed'
    expect((await h.service.listModels())[0].modelName).toBe('Friendly choice')
    expect(h.keys.read).not.toHaveBeenCalled()
    expect(h.fetch).not.toHaveBeenCalled()
  })

  it('persists create/edit/remove through the actual config store without storing credentials in config', async () => {
    let override: Record<string, unknown> = { unrelated: 'preserved' }
    const editor: ConfigEditor = {
      entries: () => [{ id: 'include:dsh-next-decisions' }],
      configuration: () => [{ entry: { id: 'include:dsh-next-decisions' }, inherited: { providers: [] }, override }],
      edit: vi.fn(async (_entry, update) => { override = update(override, { providers: [] }) }),
    }
    const h = harness({ providers: [] })
    const service = new DecisionService({ config: configStore(undefined, editor), keys: h.keys, fetch: h.fetch })
    services.push(service)
    const initial = await service.state()
    const created = await service.save({ provider: provider(), mode: 'create', revision: initial.revision, apiKey: 'private-key' })
    expect(created.providers).toEqual([{ ...provider(), keyConfigured: true }])
    expect(created.revision).not.toBe(initial.revision)
    expect(override).toEqual({ unrelated: 'preserved', providers: [provider()] })
    expect(JSON.stringify(override)).not.toContain('private-key')
    const editedProvider = { ...provider(), name: 'Renamed', models: [{ id: 'explicit/new', name: 'New choice', contextWindow: 128_000 }] }
    const edited = await service.save({ provider: editedProvider, mode: 'edit', revision: created.revision })
    expect((await service.state())).toEqual(edited)
    expect(override).toEqual({ unrelated: 'preserved', providers: [editedProvider] })
    expect(h.secrets.get('primary')).toBe('private-key')
    const removed = await service.remove({ id: 'primary', revision: edited.revision })
    expect(removed.providers).toEqual([])
    expect(override).toEqual({ unrelated: 'preserved', providers: [] })
    expect(h.secrets.has('primary')).toBe(false)
    expect(h.fetch).not.toHaveBeenCalled()
  })

  it('rejects a mixed state snapshot if configuration changes during credential lookup', async () => {
    const h = harness()
    const lookup = deferred<string | undefined>()
    h.keys.read.mockReturnValueOnce(lookup.promise)
    const state = h.service.state()
    await vi.waitFor(() => expect(h.keys.read).toHaveBeenCalledOnce())
    h.external([{ ...provider(), name: 'External edit' }])
    lookup.resolve('old-key')
    await expect(state).rejects.toMatchObject({ code: 'conflict' })
  })
})

describe('DecisionService mutation validation and revisions', () => {
  it.each([undefined, 'upsert', '', true])('requires an explicit create/edit mode (%s)', async mode => {
    const h = harness()
    const input = await change(h)
    await expect(h.service.save({ ...input, mode })).rejects.toMatchObject({ code: 'invalid-request' })
    expect(h.config.write).not.toHaveBeenCalled()
    expect(h.keys.write).not.toHaveBeenCalled()
  })

  it('never silently upserts a create collision or a missing edit', async () => {
    const h = harness()
    const input = await change(h)
    await expect(h.service.save({ ...input, mode: 'create' })).rejects.toMatchObject({ code: 'conflict' })
    await expect(h.service.save({ ...input, provider: provider('missing') })).rejects.toMatchObject({ code: 'not-found' })
    await expect(h.service.remove({ id: 'missing', revision: input.revision })).rejects.toMatchObject({ code: 'not-found' })
    expect(h.config.write).not.toHaveBeenCalled()
    expect(h.keys.write).not.toHaveBeenCalled()
  })

  it('rejects stale save and remove revisions, including revisions from another instance', async () => {
    const h = harness()
    const first = await change(h)
    await h.service.save({ ...first, provider: { ...provider(), name: 'New name' } })
    await expect(h.service.save(first)).rejects.toMatchObject({ code: 'conflict' })
    await expect(h.service.remove({ id: 'primary', revision: first.revision })).rejects.toMatchObject({ code: 'conflict' })
    const other = harness()
    await expect(other.service.save(first)).rejects.toMatchObject({ code: 'conflict' })
    expect(h.config.write).toHaveBeenCalledOnce()
  })

  it('changes revisions for metadata edits and rejects stale snapshots without losing provider rows', async () => {
    const h = harness({ providers: [{ ...provider(), models: [{ id: 'choice-v1', name: 'Old', contextWindow: 64_000 }] }, provider('other')] })
    const before = await h.service.state()
    const updated = { ...provider(), models: [{ id: 'choice-v1', name: 'New', contextWindow: 128_000 }] }
    const after = await h.service.save({ provider: updated, revision: before.revision, mode: 'edit' })
    expect(after.revision).not.toBe(before.revision)
    expect(after.providers).toEqual([{ ...updated, keyConfigured: false }, { ...provider('other'), keyConfigured: false }])
    expect(h.stored()).toEqual([updated, provider('other')])
    await expect(h.service.save({ provider: provider(), revision: before.revision, mode: 'edit' })).rejects.toMatchObject({ code: 'conflict' })
  })

  it('serializes concurrent changes so one revision cannot overwrite twice', async () => {
    const h = harness()
    const input = await change(h)
    const results = await Promise.allSettled([
      h.service.save({ ...input, provider: { ...provider(), name: 'First' } }),
      h.service.save({ ...input, provider: { ...provider(), name: 'Second' } }),
    ])
    expect(results[0].status).toBe('fulfilled')
    expect(results[1]).toMatchObject({ status: 'rejected', reason: { code: 'conflict' } })
    expect(h.stored()[0].name).toBe('First')
    expect(h.config.write).toHaveBeenCalledOnce()
  })

  it('reads a read-only catalog but refuses both mutations before touching keys', async () => {
    const h = harness({ writable: false })
    const input = await change(h)
    h.keys.read.mockClear()
    expect((await h.service.state()).writable).toBe(false)
    h.keys.read.mockClear()
    await expect(h.service.save(input)).rejects.toMatchObject({ code: 'read-only' })
    await expect(h.service.remove({ id: 'primary', revision: input.revision })).rejects.toMatchObject({ code: 'read-only' })
    expect(h.keys.read).not.toHaveBeenCalled()
    expect(h.keys.write).not.toHaveBeenCalled()
    expect(h.config.write).not.toHaveBeenCalled()
  })

  it('caps providers at fifty without preventing an existing provider edit', async () => {
    const providers = Array.from({ length: 50 }, (_, i) => provider(`p-${i}`))
    const h = harness({ providers })
    const revision = (await h.service.state()).revision
    await expect(h.service.save({ provider: provider('extra'), mode: 'create', revision })).rejects.toMatchObject({ code: 'invalid-provider' })
    expect((await h.service.save({ provider: { ...providers[0], name: 'Edited' }, mode: 'edit', revision })).providers).toHaveLength(50)
  })

  it.each([null, [], {}, { extra: true }])('rejects malformed mutation envelopes (%j)', async value => {
    const h = harness()
    await expect(h.service.save(value)).rejects.toMatchObject({ code: 'invalid-request' })
    await expect(h.service.remove(value)).rejects.toMatchObject({ code: 'invalid-request' })
    expect(h.config.write).not.toHaveBeenCalled()
  })

  it('rejects unknown save/remove fields and invalid IDs before performing any write', async () => {
    const h = harness()
    const input = await change(h)
    await expect(h.service.save({ ...input, discover: true })).rejects.toMatchObject({ code: 'invalid-request' })
    await expect(h.service.remove({ id: 'primary', revision: input.revision, force: true })).rejects.toMatchObject({ code: 'invalid-request' })
    await expect(h.service.remove({ id: '../primary', revision: input.revision })).rejects.toMatchObject({ code: 'invalid-provider' })
    expect(h.config.write).not.toHaveBeenCalled()
  })

  it.each(['save', 'remove'] as const)('rejects external configuration races during %s credential lookup', async operation => {
    const h = harness()
    const input = await change(h)
    const lookup = deferred<string | undefined>()
    const started = deferred<void>()
    h.keys.read.mockImplementationOnce(() => { started.resolve(); return lookup.promise })
    const pending = operation === 'save' ? h.service.save(input) : h.service.remove({ id: 'primary', revision: input.revision })
    await started.promise
    h.external([{ ...provider(), name: 'External edit' }])
    lookup.resolve(undefined)
    await expect(pending).rejects.toMatchObject({ code: 'conflict' })
    expect(h.keys.write).not.toHaveBeenCalled()
    expect(h.config.write).not.toHaveBeenCalled()
  })

  it.each(['save', 'remove'] as const)('preserves a compare-and-swap conflict from config persistence during %s', async operation => {
    const h = harness({ keys: { primary: 'old-key' } })
    const input = await change(h)
    h.config.write.mockRejectedValueOnce(new DecisionError('conflict'))
    const pending = operation === 'save'
      ? h.service.save({ ...input, apiKey: 'new-key' })
      : h.service.remove({ id: 'primary', revision: input.revision })
    await expect(pending).rejects.toMatchObject({ code: 'conflict' })
    expect(h.secrets.get('primary')).toBe('old-key')
  })
})

describe('DecisionService credential transaction safety', () => {
  it.each(['', ' ', ' key', 'key ', 'key\nvalue', 'key\tvalue', 'key\u007fvalue', 'x'.repeat(8193), 42])('rejects invalid credentials (%#)', async apiKey => {
    const h = harness()
    await expect(h.service.save({ ...await change(h), apiKey })).rejects.toMatchObject({ code: 'credentials' })
    expect(h.keys.write).not.toHaveBeenCalled()
    expect(h.config.write).not.toHaveBeenCalled()
  })

  it('rejects ambiguous key replacement/clearing and nonboolean clearKey', async () => {
    const h = harness()
    const input = await change(h)
    await expect(h.service.save({ ...input, apiKey: 'key', clearKey: true })).rejects.toMatchObject({ code: 'invalid-request' })
    await expect(h.service.save({ ...input, clearKey: 'true' })).rejects.toMatchObject({ code: 'invalid-request' })
    expect(h.keys.write).not.toHaveBeenCalled()
  })

  it('retains keys on ordinary edits and requires explicit replacement or clearing when the destination changes', async () => {
    const h = harness({ keys: { primary: 'old-key' } })
    const input = await change(h)
    const destination = { ...provider(), baseUrl: 'https://new-destination.example/v1' }
    await expect(h.service.save({ ...input, provider: destination })).rejects.toMatchObject({ code: 'credentials' })
    expect(h.config.write).not.toHaveBeenCalled()
    const replaced = await h.service.save({ ...input, provider: destination, apiKey: 'new-key' })
    expect(h.secrets.get('primary')).toBe('new-key')
    const cleared = await h.service.save({ provider: provider(), mode: 'edit', revision: replaced.revision, clearKey: true })
    expect(cleared.providers[0].keyConfigured).toBe(false)
    expect(h.secrets.has('primary')).toBe(false)
    const moved = await h.service.save({ provider: destination, mode: 'edit', revision: cleared.revision })
    expect(moved.providers[0].baseUrl).toBe(destination.baseUrl)
    expect(h.fetch).not.toHaveBeenCalled()
  })

  it.each(['create', 'edit', 'remove'] as const)('compensates credentials if %s configuration persistence fails', async operation => {
    const h = harness({ providers: operation === 'create' ? [] : [provider()], keys: operation === 'create' ? {} : { primary: 'old-key' } })
    const state = await h.service.state()
    const events: string[] = []
    h.keys.write.mockImplementation(async (id, value) => {
      events.push(`key:${value ?? 'delete'}`)
      if (value === undefined) h.secrets.delete(id)
      else h.secrets.set(id, value)
    })
    h.config.write.mockImplementationOnce(async () => { events.push('config:fail'); throw new Error('private config path') })
    const pending = operation === 'remove'
      ? h.service.remove({ id: 'primary', revision: state.revision })
      : h.service.save({ provider: provider(), mode: operation, revision: state.revision, apiKey: 'new-key' })
    await expect(pending).rejects.toMatchObject({ code: 'configuration', message: 'configuration' })
    expect(events).toEqual([`key:${operation === 'remove' ? 'delete' : 'new-key'}`, 'config:fail', `key:${operation === 'create' ? 'delete' : 'old-key'}`])
    expect(h.secrets.get('primary')).toBe(operation === 'create' ? undefined : 'old-key')
    expect(h.stored()).toEqual(operation === 'create' ? [] : [provider()])
    expect((await h.service.state()).revision).not.toBe(state.revision)
  })

  it('does not persist configuration when writing credentials fails', async () => {
    const h = harness({ keys: { primary: 'old-key' } })
    const input = await change(h)
    h.keys.write.mockRejectedValueOnce(new Error('secret storage failure'))
    await expect(h.service.save({ ...input, apiKey: 'new-key' })).rejects.toMatchObject({ code: 'configuration' })
    expect(h.config.write).not.toHaveBeenCalled()
    expect(h.keys.write.mock.calls).toEqual([['primary', 'new-key'], ['primary', 'old-key']])
    expect(h.secrets.get('primary')).toBe('old-key')
  })

  it.each(['save', 'remove'] as const)('reports compensation failure without exposing secrets after %s', async operation => {
    const h = harness({ keys: { primary: 'old-key' } })
    const input = await change(h)
    h.config.write.mockRejectedValueOnce(new Error('private configuration path'))
    h.keys.write.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('old-key new-key'))
    const pending = operation === 'save' ? h.service.save({ ...input, apiKey: 'new-key' }) : h.service.remove({ id: 'primary', revision: input.revision })
    await expect(pending).rejects.toMatchObject({ code: 'credentials', message: 'credentials' })
  })
})

describe('DecisionService request snapshots', () => {
  it('copies provider/model/key inputs before asynchronous credential access', async () => {
    const h = harness({ keys: { primary: 'old-key' } })
    const input = await change(h, { apiKey: 'submitted-key' })
    const lookup = deferred<string | undefined>()
    const started = deferred<void>()
    h.keys.read.mockImplementationOnce(() => { started.resolve(); return lookup.promise })
    const saving = h.service.save(input)
    await started.promise
    input.provider.name = 'Caller changed name'
    input.provider.models[0].id = 'caller-changed-model'
    input.provider.models.push({ id: 'caller-added-model' })
    input.apiKey = 'caller-changed-key'
    lookup.resolve('old-key')
    expect((await saving).providers[0]).toEqual({ ...provider(), keyConfigured: true })
    expect(h.secrets.get('primary')).toBe('submitted-key')
  })

  it('does not let a queued create turn into an edit through caller mutation', async () => {
    const h = harness()
    const input = await change(h, { mode: 'create', provider: { ...provider(), name: 'Must not overwrite' } })
    const lookup = deferred<string | undefined>()
    h.keys.read.mockReturnValueOnce(lookup.promise)
    const blocker = h.service.state()
    const saving = h.service.save(input)
    input.mode = 'edit'
    lookup.resolve(undefined)
    await blocker
    await expect(saving).rejects.toMatchObject({ code: 'conflict' })
    expect(h.stored()).toEqual([provider()])
  })

  it('does not let caller mutation change clearKey after validation', async () => {
    const h = harness({ keys: { primary: 'retained-key' } })
    const input = await change(h, { clearKey: false })
    const lookup = deferred<string | undefined>()
    const started = deferred<void>()
    h.keys.read.mockImplementationOnce(() => { started.resolve(); return lookup.promise })
    const saving = h.service.save(input)
    await started.promise
    input.clearKey = true
    lookup.resolve('retained-key')
    expect((await saving).providers[0].keyConfigured).toBe(true)
    expect(h.keys.write).not.toHaveBeenCalled()
  })

  it.each(['save', 'remove'] as const)('retains the submitted revision for a queued %s', async operation => {
    const h = harness()
    const input = await change(h)
    const removal = { id: 'primary', revision: input.revision }
    const lookup = deferred<string | undefined>()
    h.keys.read.mockReturnValueOnce(lookup.promise)
    const blocker = h.service.state()
    const pending = operation === 'save' ? h.service.save(input) : h.service.remove(removal)
    input.revision = 'caller-mutated'
    removal.revision = 'caller-mutated'
    lookup.resolve(undefined)
    await blocker
    expect((await pending).providers).toHaveLength(operation === 'save' ? 1 : 0)
  })

  it('copies inference state and criteria before asynchronous work', async () => {
    const h = harness()
    const input = request()
    const original = structuredClone(input)
    const lookup = deferred<string | undefined>()
    const started = deferred<void>()
    h.keys.read.mockImplementationOnce(() => { started.resolve(); return lookup.promise })
    const pending = h.service.evaluate(input)
    await started.promise
    ;(input.state as { observation: string[] }).observation[0] = 'green'
    input.questions.color.criteria = { changed: null, other: null }
    input.modelId = 'caller-changed-model'
    lookup.resolve(undefined)
    expect((await pending).answers.color.choice).toBe('blue')
    expect(JSON.parse(h.fetch.mock.calls[0][1]!.body as string)).toEqual({ model: original.modelId, state: original.state, questions: original.questions })
  })
})

describe('DecisionService bounded choice-only inference', () => {
  it('makes exactly one non-streaming POST with explicit model and a key, returning sanitized answer/usage fields', async () => {
    const h = harness({ keys: { primary: 'test-only-key' } })
    const body = { ...answer(), providerDebug: 'not-public', usage: { ...answer().usage, private: 'not-public' } }
    h.fetch.mockResolvedValueOnce(json(body))
    const input = request()
    const result = await h.service.evaluate(input)
    expect(result).toEqual({ providerId: 'primary', requestedModel: 'choice-v1', ...answer(), elapsedMs: expect.any(Number) })
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0)
    expect(JSON.stringify(result)).not.toContain('not-public')
    expect(h.fetch).toHaveBeenCalledOnce()
    const [url, init] = h.fetch.mock.calls[0]
    expect(url).toBe('https://primary.example/v1/systemone')
    expect(init).toEqual({
      method: 'POST', redirect: 'error', signal: expect.any(AbortSignal),
      headers: { 'content-type': 'application/json', authorization: 'Bearer test-only-key' },
      body: JSON.stringify({ model: input.modelId, state: input.state, questions: input.questions }),
    })
    expect(Object.keys(JSON.parse(init!.body as string)).sort()).toEqual(['model', 'questions', 'state'])
    expect(h.config.write).not.toHaveBeenCalled()
    expect(h.keys.write).not.toHaveBeenCalled()
  })

  it('dispatches the requested exact ID, never the friendly display name or advertised context', async () => {
    const h = harness({ providers: [{ ...provider(), models: [{ id: 'org/Exact-ID:2026', name: 'Friendly choice', contextWindow: 128_000 }] }] })
    const input = { ...request(), modelId: 'org/Exact-ID:2026' }
    const result = await h.service.evaluate(input)
    expect(result.requestedModel).toBe('org/Exact-ID:2026')
    expect(JSON.parse(h.fetch.mock.calls[0][1]!.body as string)).toEqual({ model: 'org/Exact-ID:2026', state: input.state, questions: input.questions })
    await expect(h.service.evaluate({ ...input, modelId: 'Friendly choice' })).rejects.toMatchObject({ code: 'not-found' })
    await expect(h.service.test({ providerId: 'primary', modelId: 'Friendly choice' })).rejects.toMatchObject({ code: 'not-found' })
    expect(h.fetch).toHaveBeenCalledOnce()
  })

  it('omits authorization for a keyless provider', async () => {
    const h = harness()
    await h.service.evaluate(request())
    expect(h.fetch.mock.calls[0][1]!.headers).toEqual({ 'content-type': 'application/json' })
  })

  it('uses the fixed harmless choice request for an explicit model test', async () => {
    const h = harness()
    await h.service.test({ providerId: 'primary', modelId: 'choice-v1' })
    const body = JSON.parse(h.fetch.mock.calls[0][1]!.body as string)
    expect(body).toEqual({
      model: 'choice-v1', state: 'The sky is blue.',
      questions: { color: { type: 'choice', instructions: 'Which color is explicitly stated in the text?', criteria: { blue: 'Blue is stated.', green: 'Green is stated.' } } },
    })
    await expect(h.service.test({ providerId: 'primary', modelId: 'choice-v1', state: 'caller content' })).rejects.toMatchObject({ code: 'invalid-request' })
    expect(h.fetch).toHaveBeenCalledOnce()
  })

  it.each(['missing-provider', 'missing-model'] as const)('refuses %s rather than discovering or falling back', async kind => {
    const h = harness()
    const input = request(kind === 'missing-provider' ? 'absent' : 'primary')
    if (kind === 'missing-model') input.modelId = 'not-configured'
    await expect(h.service.evaluate(input)).rejects.toMatchObject({ code: 'not-found' })
    expect(h.keys.read).not.toHaveBeenCalled()
    expect(h.fetch).not.toHaveBeenCalled()
  })

  it.each([
    { ...request(), messages: [{ role: 'user', content: 'chat' }] },
    { ...request(), tools: [{ name: 'execute' }] },
    { ...request(), stream: true },
    { ...request(), questions: { color: { type: 'text', instructions: 'Write prose' } } },
    { ...request(), state: 'x'.repeat(64_001) },
  ])('rejects non-choice or oversized inference without fetching (%#)', async input => {
    const h = harness()
    await expect(h.service.evaluate(input as ChoiceRequest)).rejects.toMatchObject({ code: 'invalid-request' })
    expect(h.fetch).not.toHaveBeenCalled()
    expect(h.keys.read).not.toHaveBeenCalled()
  })

  it('does not send credentials after a configuration change during connection lookup', async () => {
    const h = harness()
    const lookup = deferred<string | undefined>()
    const started = deferred<void>()
    h.keys.read.mockImplementationOnce(() => { started.resolve(); return lookup.promise })
    const pending = h.service.evaluate(request())
    await started.promise
    h.external([{ ...provider(), baseUrl: 'https://changed.example/v1' }])
    lookup.resolve('must-not-be-sent')
    await expect(pending).rejects.toMatchObject({ code: 'conflict' })
    expect(h.fetch).not.toHaveBeenCalled()
  })

  it.each([301, 302, 307, 308, 400, 401, 429, 500, 503])('does not redirect, retry, or expose a provider error body for HTTP %i', async status => {
    const h = harness()
    h.fetch.mockResolvedValueOnce(new Response('private-provider-error test-only-key', { status, headers: { location: 'https://redirect.example/v1' } }))
    await expect(h.service.evaluate(request())).rejects.toMatchObject({ code: 'http', message: 'http' })
    expect(h.fetch).toHaveBeenCalledOnce()
    expect(h.fetch.mock.calls[0][1]!.redirect).toBe('error')
  })

  it('does not retry network errors or leak their original message', async () => {
    const h = harness()
    h.fetch.mockRejectedValueOnce(new Error('test-only-key in provider stack'))
    await expect(h.service.evaluate(request())).rejects.toMatchObject({ code: 'network', message: 'network' })
    expect(h.fetch).toHaveBeenCalledOnce()
    await expect(h.service.evaluate(request())).resolves.toMatchObject({ answers: { color: { choice: 'blue' } } })
  })

  it.each([
    ['malformed JSON', () => new Response('{broken', { headers: { 'content-type': 'application/json' } })],
    ['missing content type', () => new Response(JSON.stringify(answer()))],
    ['HTML content type', () => new Response(JSON.stringify(answer()), { headers: { 'content-type': 'text/html' } })],
    ['no body', () => new Response(null, { headers: { 'content-type': 'application/json' } })],
    ['missing usage', () => json({ model: 'choice-v1', answers: answer().answers })],
    ['extra question', () => json({ ...answer(), answers: { ...answer().answers, other: answer().answers.color } })],
    ['unknown choice', () => json({ ...answer(), answers: { color: { ...answer().answers.color, choice: 'red' } } })],
    ['non-choice result', () => json({ ...answer(), answers: { color: { ...answer().answers.color, type: 'text' } } })],
    ['invalid distribution', () => json({ ...answer(), answers: { color: { ...answer().answers.color, probabilities: { blue: 0.8, green: 0.8 } } } })],
    ['nonmaximum choice', () => json({ ...answer(), answers: { color: { ...answer().answers.color, choice: 'green' } } })],
    ['invalid confidence', () => json({ ...answer(), answers: { color: { ...answer().answers.color, confidence: 1.1 } } })],
    ['invalid usage', () => json({ ...answer(), usage: { input_tokens: -1 } })],
  ] as const)('rejects %s without retrying', async (_name, response) => {
    const h = harness()
    h.fetch.mockResolvedValueOnce(response())
    await expect(h.service.evaluate(request())).rejects.toMatchObject({ code: 'invalid-response' })
    expect(h.fetch).toHaveBeenCalledOnce()
  })

  it('accepts JSON content-type parameters and a response at the exact byte limit', async () => {
    const h = harness()
    const body = JSON.stringify(answer())
    h.fetch.mockResolvedValueOnce(new Response(body + ' '.repeat(128_000 - Buffer.byteLength(body)), { headers: { 'content-type': 'Application/JSON; charset=utf-8' } }))
    await expect(h.service.evaluate(request())).resolves.toMatchObject({ model: 'choice-v1-resolved' })
  })

  it('counts aggregate response bytes, not characters, and cancels an oversized stream', async () => {
    const h = harness()
    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Buffer.from(' '.repeat(64_000)))
        controller.enqueue(Buffer.from('界'.repeat(22_000)))
      }, cancel,
    })
    h.fetch.mockResolvedValueOnce(new Response(stream, { headers: { 'content-type': 'application/json' } }))
    await expect(h.service.evaluate(request())).rejects.toMatchObject({ code: 'invalid-response' })
    expect(cancel).toHaveBeenCalledOnce()
    expect(h.fetch).toHaveBeenCalledOnce()
  })

  it('rejects a one-byte-over-limit response even when it is otherwise valid JSON', async () => {
    const h = harness()
    const body = JSON.stringify(answer())
    h.fetch.mockResolvedValueOnce(new Response(body + ' '.repeat(128_001 - Buffer.byteLength(body)), { headers: { 'content-type': 'application/json' } }))
    await expect(h.service.evaluate(request())).rejects.toMatchObject({ code: 'invalid-response' })
  })
})

describe('DecisionService limits, deadlines, and lifecycle', () => {
  it('caps each provider at two concurrent requests and releases capacity on cancellation', async () => {
    const h = harness()
    h.fetch.mockImplementation(() => new Promise(() => {}))
    const firstController = new AbortController()
    const secondController = new AbortController()
    const first = h.service.evaluate(request(), firstController.signal).catch(error => error)
    const second = h.service.evaluate(request(), secondController.signal).catch(error => error)
    await vi.waitFor(() => expect(h.fetch).toHaveBeenCalledTimes(2))
    await expect(h.service.evaluate(request())).rejects.toMatchObject({ code: 'busy' })
    firstController.abort()
    secondController.abort()
    expect(await first).toMatchObject({ code: 'cancelled' })
    expect(await second).toMatchObject({ code: 'cancelled' })
    h.fetch.mockResolvedValueOnce(json())
    await expect(h.service.evaluate(request())).resolves.toMatchObject({ providerId: 'primary' })
  })

  it('caps global concurrency at four, including requests queued on credential lookup', async () => {
    const h = harness({ providers: [provider(), provider('secondary'), provider('third')] })
    const lookup = deferred<string | undefined>()
    h.keys.read.mockReturnValueOnce(lookup.promise)
    const controllers = Array.from({ length: 4 }, () => new AbortController())
    const pending = controllers.map((controller, i) => h.service.evaluate(request(i < 2 ? 'primary' : 'secondary'), controller.signal).catch(error => error))
    await expect(h.service.evaluate(request('third'))).rejects.toMatchObject({ code: 'busy' })
    expect(h.fetch).not.toHaveBeenCalled()
    controllers.forEach(controller => controller.abort())
    expect(await Promise.all(pending)).toEqual(Array.from({ length: 4 }, () => expect.objectContaining({ code: 'cancelled' })))
    lookup.resolve(undefined)
    await expect(h.service.evaluate(request('third'))).resolves.toMatchObject({ providerId: 'third' })
  })

  it.each(['credentials', 'fetch', 'body'] as const)('enforces its deadline even if %s ignores cancellation', async stage => {
    vi.useFakeTimers()
    const h = harness({ timeoutMs: 25 })
    const bodyCancel = vi.fn()
    if (stage === 'credentials') h.keys.read.mockImplementationOnce(() => new Promise(() => {}))
    if (stage === 'fetch') h.fetch.mockImplementationOnce(() => new Promise(() => {}))
    if (stage === 'body') h.fetch.mockResolvedValueOnce(new Response(new ReadableStream({ cancel: bodyCancel }), { headers: { 'content-type': 'application/json' } }))
    const pending = h.service.evaluate(request()).catch(error => error)
    await vi.advanceTimersByTimeAsync(24)
    await vi.advanceTimersByTimeAsync(1)
    expect(await pending).toMatchObject({ code: 'timeout' })
    expect(vi.getTimerCount()).toBe(0)
    if (stage === 'body') expect(bodyCancel).toHaveBeenCalledOnce()
    if (stage !== 'credentials') expect(h.fetch.mock.calls[0][1]!.signal!.aborted).toBe(true)
    await expect(h.service.evaluate(request())).resolves.toMatchObject({ providerId: 'primary' })
  })

  it('includes queue waiting in the deadline without letting a late queue entry fetch', async () => {
    vi.useFakeTimers()
    const h = harness({ timeoutMs: 25 })
    const lookup = deferred<string | undefined>()
    h.keys.read.mockReturnValueOnce(lookup.promise)
    const state = h.service.state()
    const pending = h.service.evaluate(request()).catch(error => error)
    await vi.advanceTimersByTimeAsync(25)
    expect(await pending).toMatchObject({ code: 'timeout' })
    lookup.resolve(undefined)
    await state
    await h.service.state()
    expect(h.fetch).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('uses the default fifteen-second deadline', async () => {
    vi.useFakeTimers()
    const h = harness()
    h.fetch.mockImplementationOnce(() => new Promise(() => {}))
    let settled = false
    const pending = h.service.evaluate(request()).catch(error => { settled = true; return error })
    await vi.advanceTimersByTimeAsync(14_999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await pending).toMatchObject({ code: 'timeout' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('honors an already-aborted caller without reading credentials or fetching', async () => {
    const h = harness()
    const controller = new AbortController()
    controller.abort(new Error('caller-private-reason'))
    await expect(h.service.evaluate(request(), controller.signal)).rejects.toMatchObject({ code: 'cancelled', message: 'cancelled' })
    expect(h.fetch).not.toHaveBeenCalled()
    expect(h.keys.read).not.toHaveBeenCalled()
  })

  it('cancels an in-flight request, removes its listener, and discards a late fetch result', async () => {
    const h = harness()
    const response = deferred<Response>()
    h.fetch.mockReturnValueOnce(response.promise)
    const controller = new AbortController()
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    const pending = h.service.evaluate(request(), controller.signal).catch(error => error)
    await vi.waitFor(() => expect(h.fetch).toHaveBeenCalledOnce())
    controller.abort('caller-private-reason')
    expect(await pending).toMatchObject({ code: 'cancelled', message: 'cancelled' })
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
    response.resolve(json())
    await expect(h.service.evaluate(request())).resolves.toMatchObject({ requestedModel: 'choice-v1' })
    expect(h.fetch).toHaveBeenCalledTimes(2)
  })

  it.each(['save', 'remove'] as const)('cancels only the changed provider during %s', async operation => {
    const h = harness({ providers: [provider(), provider('secondary')] })
    const revision = (await h.service.state()).revision
    const firstResponse = deferred<Response>()
    const secondResponse = deferred<Response>()
    h.fetch.mockReturnValueOnce(firstResponse.promise).mockReturnValueOnce(secondResponse.promise)
    const first = h.service.evaluate(request()).catch(error => error)
    const second = h.service.evaluate(request('secondary'))
    await vi.waitFor(() => expect(h.fetch).toHaveBeenCalledTimes(2))
    if (operation === 'save') await h.service.save({ provider: { ...provider(), name: 'Edited' }, mode: 'edit', revision })
    else await h.service.remove({ id: 'primary', revision })
    expect(await first).toMatchObject({ code: 'cancelled' })
    expect(h.fetch.mock.calls[0][1]!.signal!.aborted).toBe(true)
    expect(h.fetch.mock.calls[1][1]!.signal!.aborted).toBe(false)
    firstResponse.resolve(json())
    secondResponse.resolve(json())
    await expect(second).resolves.toMatchObject({ providerId: 'secondary' })
  })

  it('disposes active requests and rejects every subsequent public operation', async () => {
    const h = harness()
    const input = await change(h)
    h.fetch.mockImplementationOnce(() => new Promise(() => {}))
    const pending = h.service.evaluate(request()).catch(error => error)
    await vi.waitFor(() => expect(h.fetch).toHaveBeenCalledOnce())
    h.service.dispose()
    h.service.dispose()
    expect(await pending).toMatchObject({ code: 'disposed' })
    expect(h.fetch.mock.calls[0][1]!.signal!.aborted).toBe(true)
    await expect(h.service.state()).rejects.toMatchObject({ code: 'disposed' })
    await expect(h.service.listModels()).rejects.toMatchObject({ code: 'disposed' })
    await expect(h.service.save(input)).rejects.toMatchObject({ code: 'disposed' })
    await expect(h.service.remove({ id: 'primary', revision: input.revision })).rejects.toMatchObject({ code: 'disposed' })
    await expect(h.service.evaluate(request())).rejects.toMatchObject({ code: 'disposed' })
    await expect(h.service.test({ providerId: 'primary', modelId: 'choice-v1' })).rejects.toMatchObject({ code: 'disposed' })
    expect(h.config.write).not.toHaveBeenCalled()
  })
})

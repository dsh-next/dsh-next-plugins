// @vitest-environment node
import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { credentialKey, type CredentialKey, type CredentialProvider, type CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as plugin from '../src/index.ts'
import { RPC_PATH, SERVICE_KEY, type ChoiceRequest, type Decisions, type DecisionProvider, type ProvidersState, type RpcEnvelope } from '../src/core/types.ts'
import type { ConfigEditor } from '../src/host/config.ts'
import type { WebServer } from '../src/host/rpc.ts'

function provider(): DecisionProvider {
  return { id: 'custom', name: 'Decision provider', baseUrl: 'https://decisions.example/v1', models: [{ id: 'explicit-choice-model' }] }
}
function request(): ChoiceRequest {
  return {
    providerId: 'custom', modelId: 'explicit-choice-model', state: 'The sky is blue.',
    questions: { color: { type: 'choice', instructions: 'Select the stated color.', criteria: { blue: null, green: null } } },
  }
}
function response(): Response {
  return new Response(JSON.stringify({
    model: 'explicit-choice-model', answers: { color: { type: 'choice', choice: 'blue', probabilities: { blue: 1, green: 0 }, confidence: 1 } }, usage: {},
  }), { headers: { 'content-type': 'application/json' } })
}
const cleanups: Array<() => void> = []
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>
beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>(async () => response())
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function mount(options: { credentials?: boolean; editor?: boolean; web?: boolean; providers?: DecisionProvider[] } = {}) {
  const initial = structuredClone(options.providers ?? [provider()])
  const records = new Map<CredentialKey, CredentialRecord>()
  const credentials = {
    readRecord: vi.fn<CredentialProvider['readRecord']>(async key => records.get(key)),
    modifyRecord: vi.fn<CredentialProvider['modifyRecord']>(async (key, update) => {
      const next = await update(records.get(key))
      if (next !== undefined) records.set(key, next)
      return records.get(key)
    }),
    deleteRecord: vi.fn<CredentialProvider['deleteRecord']>(async key => { records.delete(key) }),
    listRecords: vi.fn(async () => []),
    resolve: vi.fn(),
  }
  let override: Record<string, unknown> = {}
  const editor: ConfigEditor = {
    entries: () => [{ id: SERVICE_KEY }],
    configuration: () => [{ entry: { id: SERVICE_KEY }, inherited: { providers: initial }, override }],
    edit: vi.fn(async (_entry, update) => { override = update(override, { providers: initial }) }),
  }
  let route: Parameters<WebServer['register']>[0] | undefined
  const unregister = vi.fn()
  const web = { register: vi.fn<WebServer['register']>(value => { route = value; return unregister }) }
  const llm = { registerAdapter: vi.fn(), registerCatalog: vi.fn(), registerProvider: vi.fn(), registerModel: vi.fn() }
  const modelCatalog = { register: vi.fn(), add: vi.fn() }
  const provided = new Map<string, unknown>()
  const effects: Array<() => void> = []
  const ctx = {
    get: vi.fn((name: string) => {
      if (name === 'credentials') return options.credentials === false ? undefined : credentials
      if (name === 'configEditor') return options.editor === false ? undefined : editor
      if (name === 'webServer') return options.web === false ? undefined : web
      if (name === 'llm') return llm
      if (name === 'modelCatalog') return modelCatalog
      return provided.get(name)
    }),
    provide: vi.fn((name: string, value: unknown) => { provided.set(name, value) }),
    effect: vi.fn((effect: () => (() => void), _description: string) => { effects.push(effect()) }),
    logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
    llm, modelCatalog,
  }
  const dispose = () => { for (const effect of effects.splice(0)) effect() }
  cleanups.push(dispose)
  plugin.apply(ctx as unknown as Context, { providers: { get: () => initial } })
  const post = (method: string, args?: unknown): Promise<{ status: number; body: RpcEnvelope<unknown> }> => new Promise(resolve => {
    if (!route) throw new Error('Expected the host to register its RPC route')
    const req = Object.assign(new EventEmitter(), {
      method: 'POST', headers: { host: 'localhost:19387', 'content-type': 'application/json', origin: 'http://localhost:19387' }, socket: { remoteAddress: '127.0.0.1' },
    })
    let status = 0
    const res = Object.assign(new EventEmitter(), {
      writableEnded: false, destroyed: false,
      writeHead: (code: number) => { status = code },
      end: (body: string) => { res.writableEnded = true; resolve({ status, body: JSON.parse(body) }); res.emit('close') },
    })
    route.handler(req as unknown as IncomingMessage, res as unknown as ServerResponse)
    req.emit('data', JSON.stringify({ method, args }))
    req.emit('end')
  })
  return { ctx, provided, service: provided.get(SERVICE_KEY) as Decisions, records, credentials, editor, web, unregister, llm, modelCatalog, dispose, post, stored: () => override }
}
function expectNoChatRegistration(h: ReturnType<typeof mount>) {
  expect(h.ctx.get.mock.calls.flat()).not.toContain('llm')
  expect(h.ctx.get.mock.calls.flat()).not.toContain('modelCatalog')
  expect(h.provided.has('llm')).toBe(false)
  expect(h.provided.has('modelCatalog')).toBe(false)
  for (const register of Object.values(h.llm)) expect(register).not.toHaveBeenCalled()
  for (const register of Object.values(h.modelCatalog)) expect(register).not.toHaveBeenCalled()
}
function state(envelope: RpcEnvelope<unknown>): ProvidersState {
  expect(envelope.ok).toBe(true)
  if (!envelope.ok) throw new Error(`Expected state, received ${envelope.error.code}`)
  return envelope.value as ProvidersState
}

describe('Decisions host plugin contract', () => {
  it('exports the schema and thin host entry without injecting chat/LLM services', () => {
    expect(typeof plugin.apply).toBe('function')
    expect(plugin.Config).toBeDefined()
    expect(plugin.inject).toEqual(['credentials', 'webServer'])
  })

  it('publishes only the separate dsh-next-decisions inference interface and never registers an LLM adapter or chat catalog', async () => {
    const h = mount()
    expect(h.ctx.provide).toHaveBeenCalledOnce()
    expect(h.ctx.provide).toHaveBeenCalledWith(SERVICE_KEY, { listModels: expect.any(Function), evaluate: expect.any(Function) })
    expect(Object.keys(h.service).sort()).toEqual(['evaluate', 'listModels'])
    expect(await h.service.listModels()).toEqual([{ providerId: 'custom', providerName: 'Decision provider', modelId: 'explicit-choice-model' }])
    expect(h.credentials.readRecord).not.toHaveBeenCalled()
    expect(h.credentials.listRecords).not.toHaveBeenCalled()
    expect(h.credentials.resolve).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(h.web.register).toHaveBeenCalledOnce()
    expect(h.web.register).toHaveBeenCalledWith({ kind: 'exact', path: RPC_PATH, handler: expect.any(Function) })
    expect(h.ctx.effect).toHaveBeenCalledWith(expect.any(Function), expect.stringContaining('dispose'))
    expectNoChatRegistration(h)
  })

  it('publishes optional advertised model metadata without adding any chat registration or dispatching a display name', async () => {
    const configured = { ...provider(), models: [{ id: 'explicit-choice-model', name: 'Friendly choice', contextWindow: 1_000_000 }] }
    const h = mount({ providers: [configured] })
    expect(await h.service.listModels()).toEqual([{ providerId: 'custom', providerName: 'Decision provider', modelId: 'explicit-choice-model', modelName: 'Friendly choice', contextWindow: 1_000_000 }])
    expect((state((await h.post('state')).body)).providers).toEqual([{ ...configured, keyConfigured: false }])
    await h.service.evaluate(request())
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string).model).toBe('explicit-choice-model')
    await expect(h.service.evaluate({ ...request(), modelId: 'Friendly choice' })).rejects.toMatchObject({ code: 'not-found' })
    expect(fetchMock).toHaveBeenCalledOnce()
    expectNoChatRegistration(h)
  })

  it('wires the published evaluator through namespaced credentials and the provider-specific choice endpoint', async () => {
    const h = mount()
    const key = credentialKey(SERVICE_KEY, 'custom')
    h.records.set(key, { kind: 'api-key', key: 'isolated-decision-key' })
    const result = await h.service.evaluate(request())
    expect(result).toMatchObject({ providerId: 'custom', requestedModel: 'explicit-choice-model', answers: { color: { choice: 'blue' } } })
    expect(h.credentials.readRecord).toHaveBeenCalledWith(key)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith('https://decisions.example/v1/systemone', expect.objectContaining({
      method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json', authorization: 'Bearer isolated-decision-key' },
    }))
    expect(h.credentials.resolve).not.toHaveBeenCalled()
    expectNoChatRegistration(h)
  })

  it('forwards caller cancellation through the published host interface', async () => {
    const h = mount()
    const controller = new AbortController()
    fetchMock.mockImplementationOnce(() => new Promise(() => {}))
    const pending = h.service.evaluate(request(), controller.signal).catch(error => error)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    controller.abort('private caller reason')
    expect(await pending).toMatchObject({ code: 'cancelled', message: 'cancelled' })
    expect(fetchMock.mock.calls[0][1]!.signal!.aborted).toBe(true)
    expectNoChatRegistration(h)
  })

  it('wires RPC mutations to actual config/credential adapters while keeping keys out of state and configuration', async () => {
    const h = mount({ providers: [] })
    const initial = state((await h.post('state')).body)
    const savedReply = await h.post('save', { provider: provider(), mode: 'create', revision: initial.revision, apiKey: 'separate-secret' })
    expect(savedReply.status).toBe(200)
    const saved = state(savedReply.body)
    expect(saved.providers).toEqual([{ ...provider(), keyConfigured: true }])
    expect(h.credentials.modifyRecord).toHaveBeenCalledOnce()
    expect(h.credentials.modifyRecord.mock.calls[0][0]).toBe(credentialKey(SERVICE_KEY, 'custom'))
    expect(h.records.get(credentialKey(SERVICE_KEY, 'custom'))).toEqual({ kind: 'api-key', key: 'separate-secret' })
    expect(h.stored()).toEqual({ providers: [provider()] })
    expect(JSON.stringify(savedReply)).not.toContain('separate-secret')
    expect(state((await h.post('state')).body)).toEqual(saved)
    expect(await h.service.listModels()).toHaveLength(1)
    const removed = state((await h.post('remove', { id: 'custom', revision: saved.revision })).body)
    expect(removed.providers).toEqual([])
    expect(h.credentials.deleteRecord).toHaveBeenCalledWith(credentialKey(SERVICE_KEY, 'custom'))
    expect(h.records.size).toBe(0)
    expect(await h.service.listModels()).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
    expectNoChatRegistration(h)
  })

  it('offers a read-only explicit catalog when the config editor is unavailable', async () => {
    const h = mount({ editor: false })
    expect(await h.service.listModels()).toEqual([{ providerId: 'custom', providerName: 'Decision provider', modelId: 'explicit-choice-model' }])
    const initial = state((await h.post('state')).body)
    expect(initial.writable).toBe(false)
    expect((await h.post('save', { provider: provider(), mode: 'edit', revision: initial.revision })).body).toEqual({ ok: false, error: { code: 'read-only' } })
    expect(h.credentials.modifyRecord).not.toHaveBeenCalled()
    expectNoChatRegistration(h)
  })

  it('does not publish a partially functioning service when credentials are missing', () => {
    const h = mount({ credentials: false })
    expect(h.ctx.logger.warn).toHaveBeenCalledWith('dsh-next-decisions: credentials unavailable')
    expect(h.ctx.provide).not.toHaveBeenCalled()
    expect(h.web.register).not.toHaveBeenCalled()
    expect(h.ctx.effect).not.toHaveBeenCalled()
    expectNoChatRegistration(h)
  })

  it('still publishes the host interface and disposes it when no web server is available', async () => {
    const h = mount({ web: false })
    expect(await h.service.listModels()).toHaveLength(1)
    expect(h.web.register).not.toHaveBeenCalled()
    h.dispose()
    await expect(h.service.listModels()).rejects.toMatchObject({ code: 'disposed' })
    expectNoChatRegistration(h)
  })

  it('unregisters RPC, aborts in-flight inference, and disables the published service on disposal', async () => {
    const h = mount()
    fetchMock.mockImplementationOnce(() => new Promise(() => {}))
    const pending = h.service.evaluate(request()).catch(error => error)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    const signal = fetchMock.mock.calls[0][1]!.signal!
    h.dispose()
    expect(h.unregister).toHaveBeenCalledOnce()
    expect(signal.aborted).toBe(true)
    expect(await pending).toMatchObject({ code: 'disposed' })
    await expect(h.service.listModels()).rejects.toMatchObject({ code: 'disposed' })
    await expect(h.service.evaluate(request())).rejects.toMatchObject({ code: 'disposed' })
    expectNoChatRegistration(h)
  })
})

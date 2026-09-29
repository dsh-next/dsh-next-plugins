// @vitest-environment node
import { EventEmitter } from 'node:events'
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DecisionError, RPC_PATH, type DecisionProvider, type ProvidersState, type RpcEnvelope } from '../src/core/types.ts'
import { configStore, type ConfigEditor } from '../src/host/config.ts'
import { assertLocalOwner, dispatch, registerRpc, type WebServer } from '../src/host/rpc.ts'
import { DecisionService } from '../src/host/service.ts'

const provider: DecisionProvider = { id: 'local', name: 'Local decisions', baseUrl: 'http://127.0.0.1:9000/v1', models: [{ id: 'explicit-choice' }] }
function answer() {
  return {
    model: 'explicit-choice', answers: { color: { type: 'choice', choice: 'blue', probabilities: { blue: 1, green: 0 }, confidence: 1 } },
    usage: { input_tokens: 5, output_tokens: 1 },
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}
const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function serviceHarness(fetcher: typeof fetch = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(answer()), { headers: { 'content-type': 'application/json' } }))) {
  let override: Record<string, unknown> = { untouched: 'keep' }
  const editor: ConfigEditor = {
    entries: () => [{ id: 'dsh-next-decisions' }],
    configuration: () => [{ entry: { id: 'dsh-next-decisions' }, inherited: { providers: [] }, override }],
    edit: vi.fn(async (_entry, update) => { override = update(override, { providers: [] }) }),
  }
  const secrets = new Map<string, string>()
  const keys = {
    read: vi.fn(async (id: string) => secrets.get(id)),
    write: vi.fn(async (id: string, key: string | undefined) => { if (key === undefined) secrets.delete(id); else secrets.set(id, key) }),
  }
  const service = new DecisionService({ config: configStore(undefined, editor), keys, fetch: fetcher })
  cleanups.push(() => service.dispose())
  return { service, keys, secrets, editor, fetcher, stored: () => structuredClone(override) }
}
type Route = Parameters<WebServer['register']>[0]
type Reply = { status: number; headers: Record<string, string>; body: RpcEnvelope<unknown> }
type RequestOptions = { method?: string; headers?: IncomingHttpHeaders; peer?: string }
function routeHarness() {
  const h = serviceHarness()
  let route!: Route
  const off = vi.fn()
  const register = vi.fn<WebServer['register']>(value => { route = value; return off })
  const dispose = registerRpc({ register }, h.service)
  cleanups.push(dispose)
  const open = (options: RequestOptions = {}) => {
    const req = Object.assign(new EventEmitter(), {
      method: options.method ?? 'POST', socket: { remoteAddress: options.peer ?? '127.0.0.1' },
      headers: { host: 'localhost:19387', 'content-type': 'application/json', ...options.headers },
    })
    const done = deferred<Reply>()
    let status = 0
    let headers: Record<string, string> = {}
    const res = Object.assign(new EventEmitter(), {
      writableEnded: false, destroyed: false,
      writeHead: vi.fn((value: number, next: Record<string, string>) => { status = value; headers = next }),
      end: vi.fn((body: string) => {
        res.writableEnded = true
        done.resolve({ status, headers, body: JSON.parse(body) })
        res.emit('close')
      }),
    })
    route.handler(req as unknown as IncomingMessage, res as unknown as ServerResponse)
    cleanups.push(() => res.emit('close'))
    return { req, res, done: done.promise }
  }
  const raw = (body: string | Buffer, options?: RequestOptions) => {
    const connection = open(options)
    connection.req.emit('data', body)
    connection.req.emit('end')
    return connection.done
  }
  const post = (body: unknown, options?: RequestOptions) => raw(JSON.stringify(body), options)
  return { ...h, open, raw, post, register, off, dispose, route: () => route }
}
function stateValue(reply: Reply): ProvidersState {
  expect(reply.status).toBe(200)
  expect(reply.body.ok).toBe(true)
  if (!reply.body.ok) throw new Error(`Unexpected RPC failure: ${reply.body.error.code}`)
  return reply.body.value as ProvidersState
}

describe('Decisions RPC dispatch contract', () => {
  it('returns an exact success envelope, not raw state fields at the top level', async () => {
    const h = serviceHarness()
    const result = await dispatch(h.service, { method: 'state' })
    expect(result).toEqual({ ok: true, value: { providers: [], writable: true, revision: expect.any(String) } })
    expect(Object.keys(result).sort()).toEqual(['ok', 'value'])
  })

  it.each([null, [], 'state', {}, { method: 1 }, { method: 'state', extra: true }])('rejects malformed RPC envelopes (%j)', async body => {
    const h = serviceHarness()
    expect(await dispatch(h.service, body)).toEqual({ ok: false, error: { code: 'invalid-request' } })
  })

  it.each(['evaluate', 'listModels', 'discover', 'chat', 'constructor', '__proto__', 'unknown'])('does not expose the %s operation', async method => {
    const h = serviceHarness()
    expect(await dispatch(h.service, { method })).toEqual({ ok: false, error: { code: 'not-found' } })
    expect(h.fetcher).not.toHaveBeenCalled()
  })

  it('passes only the safe error code through an error envelope', async () => {
    const h = serviceHarness()
    vi.spyOn(h.service, 'state').mockRejectedValueOnce(new DecisionError('configuration')).mockRejectedValueOnce(new Error('secret-key private path'))
    expect(await dispatch(h.service, { method: 'state' })).toEqual({ ok: false, error: { code: 'configuration' } })
    expect(await dispatch(h.service, { method: 'state' })).toEqual({ ok: false, error: { code: 'failed' } })
  })
})

describe('Decisions actual RPC route', () => {
  it('registers one exact route and persists create/edit/remove through the config editor with complete envelopes', async () => {
    const h = routeHarness()
    expect(h.register).toHaveBeenCalledOnce()
    expect(h.route()).toMatchObject({ kind: 'exact', path: RPC_PATH, handler: expect.any(Function) })
    const initialReply = await h.post({ method: 'state' })
    expect(initialReply.headers).toEqual({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    const initial = stateValue(initialReply)
    const createdReply = await h.post({ method: 'save', args: { provider, mode: 'create', revision: initial.revision, apiKey: 'browser-must-not-receive' } })
    expect(Object.keys(createdReply.body).sort()).toEqual(['ok', 'value'])
    const created = stateValue(createdReply)
    expect(Object.keys(created).sort()).toEqual(['providers', 'revision', 'writable'])
    expect(created.providers).toEqual([{ ...provider, keyConfigured: true }])
    expect(JSON.stringify(createdReply)).not.toContain('browser-must-not-receive')
    expect(h.stored()).toEqual({ untouched: 'keep', providers: [provider] })
    expect(h.secrets.get('local')).toBe('browser-must-not-receive')
    expect(stateValue(await h.post({ method: 'state' }))).toEqual(created)
    const edited = stateValue(await h.post({ method: 'save', args: { provider: { ...provider, name: 'Edited' }, mode: 'edit', revision: created.revision, clearKey: true } }))
    expect(edited.providers[0]).toMatchObject({ name: 'Edited', keyConfigured: false })
    expect(h.secrets.has('local')).toBe(false)
    const removed = stateValue(await h.post({ method: 'remove', args: { id: 'local', revision: edited.revision } }))
    expect(removed.providers).toEqual([])
    expect(h.stored()).toEqual({ untouched: 'keep', providers: [] })
    expect(h.fetcher).not.toHaveBeenCalled()
  })

  it('round-trips model metadata through the RPC envelope without exposing credentials or capabilities', async () => {
    const h = routeHarness()
    const initial = stateValue(await h.post({ method: 'state' }))
    const configured = { ...provider, models: [{ id: 'org/Exact-ID:2026', name: 'Display choice', contextWindow: 128_000 }, { id: 'bare-choice' }] }
    const reply = await h.post({ method: 'save', args: { provider: configured, mode: 'create', revision: initial.revision, apiKey: 'private-secret' } })
    expect(Object.keys(reply.body).sort()).toEqual(['ok', 'value'])
    expect(stateValue(reply)).toEqual({ providers: [{ ...configured, keyConfigured: true }], writable: true, revision: expect.any(String) })
    expect(h.stored()).toEqual({ untouched: 'keep', providers: [configured] })
    expect(JSON.stringify(reply)).not.toContain('private-secret')
    expect(await h.service.listModels()).toEqual([
      { providerId: 'local', providerName: 'Local decisions', modelId: 'org/Exact-ID:2026', modelName: 'Display choice', contextWindow: 128_000 },
      { providerId: 'local', providerName: 'Local decisions', modelId: 'bare-choice' },
    ])
    const test = await h.post({ method: 'test', args: { providerId: 'local', modelId: 'org/Exact-ID:2026' } })
    expect(test).toMatchObject({ status: 200, body: { ok: true, value: { requestedModel: 'org/Exact-ID:2026' } } })
    expect(JSON.parse(vi.mocked(h.fetcher).mock.calls[0][1]!.body as string).model).toBe('org/Exact-ID:2026')
    expect((await h.post({ method: 'test', args: { providerId: 'local', modelId: 'Display choice' } })).body).toEqual({ ok: false, error: { code: 'not-found' } })
    expect(h.fetcher).toHaveBeenCalledOnce()
  })

  it('returns semantic validation/conflict failures inside HTTP 200 envelopes without bypassing service validation', async () => {
    const h = routeHarness()
    const initial = stateValue(await h.post({ method: 'state' }))
    const missingMode = await h.post({ method: 'save', args: { provider, revision: initial.revision } })
    expect(missingMode).toMatchObject({ status: 200, body: { ok: false, error: { code: 'invalid-request' } } })
    await h.post({ method: 'save', args: { provider, mode: 'create', revision: initial.revision } })
    const stale = await h.post({ method: 'remove', args: { id: 'local', revision: initial.revision } })
    expect(stale).toMatchObject({ status: 200, body: { ok: false, error: { code: 'conflict' } } })
    expect(h.stored()).toMatchObject({ providers: [provider] })
  })

  it('routes an explicit model test and returns the full choice result envelope', async () => {
    const h = routeHarness()
    const initial = stateValue(await h.post({ method: 'state' }))
    await h.post({ method: 'save', args: { provider, mode: 'create', revision: initial.revision } })
    const reply = await h.post({ method: 'test', args: { providerId: 'local', modelId: 'explicit-choice' } })
    expect(reply).toMatchObject({ status: 200, body: { ok: true, value: { providerId: 'local', requestedModel: 'explicit-choice', ...answer(), elapsedMs: expect.any(Number) } } })
    expect(h.fetcher).toHaveBeenCalledOnce()
  })

  it('preserves the per-provider concurrency limit through actual RPC dispatch', async () => {
    const h = routeHarness()
    const initial = stateValue(await h.post({ method: 'state' }))
    await h.post({ method: 'save', args: { provider, mode: 'create', revision: initial.revision } })
    vi.mocked(h.fetcher).mockImplementation(() => new Promise(() => {}))
    const body = { method: 'test', args: { providerId: 'local', modelId: 'explicit-choice' } }
    const first = h.post(body)
    const second = h.post(body)
    await vi.waitFor(() => expect(h.fetcher).toHaveBeenCalledTimes(2))
    expect(await h.post(body)).toMatchObject({ status: 200, body: { ok: false, error: { code: 'busy' } } })
    expect(h.fetcher).toHaveBeenCalledTimes(2)
    h.dispose()
    expect(await first).toMatchObject({ status: 503, body: { ok: false, error: { code: 'disposed' } } })
    expect(await second).toMatchObject({ status: 503, body: { ok: false, error: { code: 'disposed' } } })
  })

  it.each(['GET', 'PUT', 'DELETE', 'OPTIONS', 'HEAD'])('rejects %s without invoking the service', async method => {
    const h = routeHarness()
    const state = vi.spyOn(h.service, 'state')
    expect(await h.post({ method: 'state' }, { method })).toMatchObject({ status: 405, body: { ok: false, error: { code: 'invalid-request' } } })
    expect(state).not.toHaveBeenCalled()
  })

  it.each([undefined, 'text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data', 'application/json-patch+json', 'application/json, text/plain'])('requires JSON content type (%s)', async contentType => {
    const h = routeHarness()
    const state = vi.spyOn(h.service, 'state')
    expect(await h.post({ method: 'state' }, { headers: { 'content-type': contentType } })).toMatchObject({ status: 415, body: { ok: false, error: { code: 'invalid-request' } } })
    expect(state).not.toHaveBeenCalled()
  })

  it.each(['application/json', 'Application/JSON; charset=UTF-8', ' application/json ; charset=utf-8'])('accepts JSON content-type parameters (%s)', async contentType => {
    const h = routeHarness()
    expect((await h.post({ method: 'state' }, { headers: { 'content-type': contentType } })).status).toBe(200)
  })

  it.each(['', '{', '{"method":', 'not json'])('returns a transport error for malformed JSON (%j)', async body => {
    const h = routeHarness()
    expect(await h.raw(body)).toMatchObject({ status: 400, body: { ok: false, error: { code: 'invalid-request' } } })
  })

  it('counts aggregate incoming bytes and rejects an oversized multibyte body exactly once', async () => {
    const h = routeHarness()
    const state = vi.spyOn(h.service, 'state')
    const connection = h.open()
    connection.req.emit('data', ' '.repeat(64_000))
    connection.req.emit('data', Buffer.from('界'.repeat(22_000)))
    connection.req.emit('data', '{"method":"state"}')
    connection.req.emit('end')
    expect(await connection.done).toMatchObject({ status: 413, body: { ok: false, error: { code: 'invalid-request' } } })
    expect(connection.res.end).toHaveBeenCalledOnce()
    expect(state).not.toHaveBeenCalled()
  })

  it('accepts the exact incoming byte limit and rejects one more byte', async () => {
    const h = routeHarness()
    const body = JSON.stringify({ method: 'state' })
    const exact = body + ' '.repeat(128_000 - Buffer.byteLength(body))
    expect((await h.raw(exact)).status).toBe(200)
    expect(await h.raw(exact + ' ')).toMatchObject({ status: 413, body: { ok: false, error: { code: 'invalid-request' } } })
  })

  it('returns a 403 envelope for a remote peer even when forwarded headers claim loopback', async () => {
    const h = routeHarness()
    const state = vi.spyOn(h.service, 'state')
    expect(await h.post({ method: 'state' }, { peer: '192.0.2.5', headers: { 'x-forwarded-for': '127.0.0.1', 'x-real-ip': '127.0.0.1' } })).toMatchObject({ status: 403, body: { ok: false, error: { code: 'origin' } } })
    expect(state).not.toHaveBeenCalled()
  })

  it('rejects cross-origin callers before parsing their body or touching credentials', async () => {
    const h = routeHarness()
    expect(await h.raw('{broken', { headers: { origin: 'https://attacker.example' } })).toMatchObject({ status: 403, body: { ok: false, error: { code: 'origin' } } })
    expect(h.keys.read).not.toHaveBeenCalled()
    expect(h.fetcher).not.toHaveBeenCalled()
  })

  it('bounds a stalled upload by twenty seconds and never dispatches late bytes', async () => {
    vi.useFakeTimers()
    const h = routeHarness()
    const state = vi.spyOn(h.service, 'state')
    const connection = h.open()
    connection.req.emit('data', '{"method":')
    await vi.advanceTimersByTimeAsync(19_999)
    expect(connection.res.end).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(await connection.done).toMatchObject({ status: 408, body: { ok: false, error: { code: 'timeout' } } })
    connection.req.emit('data', '"state"}')
    connection.req.emit('end')
    expect(state).not.toHaveBeenCalled()
    expect(connection.res.end).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('aborts an in-flight dispatch at the HTTP deadline and does not write a late result', async () => {
    vi.useFakeTimers()
    const h = routeHarness()
    const done = deferred<Awaited<ReturnType<DecisionService['test']>>>()
    const test = vi.spyOn(h.service, 'test').mockReturnValue(done.promise)
    const connection = h.open()
    connection.req.emit('data', JSON.stringify({ method: 'test', args: { providerId: 'local', modelId: 'explicit-choice' } }))
    connection.req.emit('end')
    expect(test).toHaveBeenCalledOnce()
    const signal = test.mock.calls[0][1]!
    await vi.advanceTimersByTimeAsync(20_000)
    expect(signal.aborted).toBe(true)
    expect(await connection.done).toMatchObject({ status: 408, body: { ok: false, error: { code: 'timeout' } } })
    done.resolve({ providerId: 'local', requestedModel: 'explicit-choice', ...answer(), answers: {}, elapsedMs: 20_001 })
    await vi.advanceTimersByTimeAsync(0)
    expect(connection.res.end).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['aborted', 'error', 'close'] as const)('propagates %s to an active test and clears the HTTP timer', async event => {
    vi.useFakeTimers()
    const h = routeHarness()
    const test = vi.spyOn(h.service, 'test').mockImplementation((_args, signal) => new Promise((_resolve, reject) => {
      signal!.addEventListener('abort', () => reject(new DecisionError('cancelled')), { once: true })
    }))
    const connection = h.open()
    connection.req.emit('data', JSON.stringify({ method: 'test', args: { providerId: 'local', modelId: 'explicit-choice' } }))
    connection.req.emit('end')
    const signal = test.mock.calls[0][1]!
    connection.res.destroyed = true
    if (event === 'close') connection.res.emit('close')
    else connection.req.emit(event, event === 'error' ? new Error('socket closed') : undefined)
    await vi.advanceTimersByTimeAsync(0)
    expect(signal.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
    expect(connection.res.end).not.toHaveBeenCalled()
  })

  it('unregisters the route and cancels active tests', async () => {
    const h = routeHarness()
    const test = vi.spyOn(h.service, 'test').mockImplementation((_args, signal) => new Promise((_resolve, reject) => {
      signal!.addEventListener('abort', () => reject(new DecisionError('cancelled')), { once: true })
    }))
    const pending = h.post({ method: 'test', args: { providerId: 'local', modelId: 'explicit-choice' } })
    h.dispose()
    expect(h.off).toHaveBeenCalledOnce()
    expect(test.mock.calls[0][1]!.aborted).toBe(true)
    expect(await pending).toMatchObject({ status: 503, body: { ok: false, error: { code: 'disposed' } } })
  })

  it('releases upload deadlines and replies disposed when the RPC registration is removed', async () => {
    vi.useFakeTimers()
    const h = routeHarness()
    const connection = h.open()
    expect(vi.getTimerCount()).toBe(1)
    h.dispose()
    expect(h.off).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
    expect(await connection.done).toMatchObject({ status: 503, body: { ok: false, error: { code: 'disposed' } } })
    connection.req.emit('data', JSON.stringify({ method: 'state' }))
    connection.req.emit('end')
    await vi.advanceTimersByTimeAsync(20_000)
    expect(connection.res.end).toHaveBeenCalledOnce()
  })
})

function ownerRequest(options: RequestOptions = {}): IncomingMessage {
  return { headers: { host: 'localhost:19387', ...options.headers }, socket: { remoteAddress: options.peer ?? '127.0.0.1' } } as unknown as IncomingMessage
}
describe('Decisions local-owner origin and peer boundary', () => {
  it.each(['127.0.0.1', '::1', '::ffff:127.0.0.1'])('accepts the loopback peer %s', peer => {
    expect(() => assertLocalOwner(ownerRequest({ peer }))).not.toThrow()
  })

  it.each([
    { host: 'localhost:19387', origin: 'http://localhost:19387' },
    { host: '127.0.0.1:19387', origin: 'http://127.0.0.1:19387' },
    { host: '[::1]:19387', origin: 'http://[::1]:19387' },
  ])('accepts matching local Host/Origin pairs (%j)', headers => {
    expect(() => assertLocalOwner(ownerRequest({ headers }))).not.toThrow()
  })

  it.each(['192.0.2.5', '10.0.0.1', '127.0.0.2', '::ffff:192.0.2.5', '', 'localhost'])('rejects nonapproved peer addresses (%s)', peer => {
    expect(() => assertLocalOwner(ownerRequest({ peer }))).toThrow('origin')
  })

  it.each([
    { host: undefined }, { host: 'attacker.example' }, { host: 'localhost.attacker.example:19387' },
    { host: 'user:password@localhost:19387' }, { host: 'localhost:19387/path' },
    { host: 'localhost:19387?query' }, { host: 'localhost:19387#fragment' },
    { host: 'localhost:bad' }, { host: 'localhost:19387', origin: 'null' },
    { origin: 'https://attacker.example' }, { origin: 'http://localhost:19388' },
    { origin: 'http://127.0.0.1:19387' }, { origin: 'ftp://localhost:19387' },
    { origin: 'http://user:password@localhost:19387' }, { origin: 'http://localhost:19387/path' },
    { origin: 'http://localhost:19387?query' }, { origin: 'http://localhost:19387#fragment' },
    { origin: ['http://localhost:19387'] }, { 'sec-fetch-site': 'cross-site' },
  ])('rejects unsafe Host/Origin metadata (%j)', headers => {
    expect(() => assertLocalOwner(ownerRequest({ headers: headers as IncomingHttpHeaders }))).toThrow('origin')
  })
})

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
  })
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}
async function close(server: Server): Promise<void> {
  server.closeAllConnections()
  if (!server.listening) return
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
}

describe('Decisions keyless loopback HTTP integration', () => {
  it('round-trips actual HTTP RPC/config and choice inference without discovery, keys, or external traffic', async () => {
    const requests: Array<{ path: string | undefined; method: string | undefined; headers: IncomingHttpHeaders; body: unknown }> = []
    const providerServer = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', chunk => chunks.push(Buffer.from(chunk)))
      req.on('end', () => {
        requests.push({ path: req.url, method: req.method, headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) })
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(answer()))
      })
    })
    let route!: Route
    const nativeFetch = globalThis.fetch
    let localProviderBase = ''
    const guardedFetch = vi.fn<typeof fetch>((input, init) => {
      if (String(input) !== `${localProviderBase}/v1/systemone`) throw new Error('Test refuses any nonlocal or unexpected provider request')
      return nativeFetch(input, init)
    })
    const h = serviceHarness(guardedFetch)
    const off = registerRpc({ register: value => { route = value; return () => {} } }, h.service)
    const rpcServer = createServer((req, res) => {
      if (req.url === route.path) route.handler(req, res)
      else { res.writeHead(404); res.end() }
    })
    try {
      localProviderBase = await listen(providerServer)
      const rpcBase = await listen(rpcServer)
      const post = async <T = unknown>(body: unknown): Promise<RpcEnvelope<T>> => {
        const response = await nativeFetch(`${rpcBase}${RPC_PATH}`, {
          method: 'POST', headers: { 'content-type': 'application/json', origin: rpcBase }, body: JSON.stringify(body),
        })
        expect(response.status).toBe(200)
        expect(response.headers.get('cache-control')).toBe('no-store')
        expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8')
        return response.json() as Promise<RpcEnvelope<T>>
      }
      const initial = await post<ProvidersState>({ method: 'state' })
      expect(initial).toEqual({ ok: true, value: { providers: [], writable: true, revision: expect.any(String) } })
      if (!initial.ok) throw new Error('Initial state failed')
      const local = { ...provider, baseUrl: `${localProviderBase}/v1` }
      const saved = await post({ method: 'save', args: { provider: local, mode: 'create', revision: initial.value.revision } })
      expect(saved).toEqual({ ok: true, value: { providers: [{ ...local, keyConfigured: false }], writable: true, revision: expect.any(String) } })
      expect(await post({ method: 'state' })).toEqual(saved)
      expect(await h.service.listModels()).toEqual([{ providerId: 'local', providerName: 'Local decisions', modelId: 'explicit-choice' }])
      expect(requests).toEqual([])
      const result = await post({ method: 'test', args: { providerId: 'local', modelId: 'explicit-choice' } })
      expect(result).toEqual({ ok: true, value: { providerId: 'local', requestedModel: 'explicit-choice', ...answer(), elapsedMs: expect.any(Number) } })
      expect(requests).toHaveLength(1)
      expect(requests[0]).toMatchObject({ path: '/v1/systemone', method: 'POST', body: { model: 'explicit-choice', state: 'The sky is blue.', questions: { color: { type: 'choice' } } } })
      expect(requests[0].headers.authorization).toBeUndefined()
      expect(Object.keys(requests[0].body as object).sort()).toEqual(['model', 'questions', 'state'])
      expect(guardedFetch).toHaveBeenCalledOnce()
      expect(h.keys.write).not.toHaveBeenCalled()
      expect(h.stored()).toEqual({ untouched: 'keep', providers: [local] })
    } finally {
      off()
      h.service.dispose()
      await Promise.all([close(rpcServer), close(providerServer)])
    }
  })

  it('does not follow a real HTTP redirect or retry a redirected choice request', async () => {
    const paths: string[] = []
    const providerServer = createServer((req, res) => {
      paths.push(req.url ?? '')
      if (req.url === '/v1/systemone') {
        res.writeHead(307, { location: '/redirect-target' })
        res.end()
      } else {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(answer()))
      }
    })
    const nativeFetch = globalThis.fetch
    let base = ''
    const guardedFetch = vi.fn<typeof fetch>((input, init) => {
      if (String(input) !== `${base}/v1/systemone`) throw new Error('Test refuses unexpected provider traffic')
      return nativeFetch(input, init)
    })
    const h = serviceHarness(guardedFetch)
    try {
      base = await listen(providerServer)
      const initial = await h.service.state()
      await h.service.save({ provider: { ...provider, baseUrl: `${base}/v1` }, mode: 'create', revision: initial.revision })
      await expect(h.service.test({ providerId: 'local', modelId: 'explicit-choice' })).rejects.toMatchObject({ code: 'network' })
      expect(paths).toEqual(['/v1/systemone'])
      expect(guardedFetch).toHaveBeenCalledOnce()
    } finally { h.service.dispose(); await close(providerServer) }
  })
})

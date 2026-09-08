import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { RpcError } from '../src/core/errors.ts'
import { registerRpc, RPC_PATH } from '../src/host/rpc.ts'
import { SubscriptionsService, type ConfigScopeFace } from '../src/host/service.ts'

function fixture(overrides: Partial<SubscriptionsService> = {}) {
  let saved: object = {}
  const config: ConfigScopeFace = {
    get: () => saved,
    replace: async (next) => { saved = next },
    update: async (patch) => { saved = { ...saved, ...patch } },
    watch: () => () => {},
  }
  const service = Object.assign(new SubscriptionsService({
    store: { read: async () => undefined, list: async () => [], modify: async () => undefined, delete: async () => {} },
    config, fetch: async () => new Response('{}'),
  }), overrides)
  let handler!: (req: IncomingMessage, res: ServerResponse) => void
  const off = vi.fn()
  let dispose!: () => void
  const register = vi.fn((route: { path: string; kind: string; handler: typeof handler }) => { handler = route.handler; return off })
  registerRpc({
    get: () => ({ register }),
    effect: (effect: () => () => void) => { dispose = effect() },
  } as unknown as Context, service)

  async function request(body: string | Buffer[], options: { method?: string; headers?: Record<string, string>; address?: string } = {}) {
    const req = Object.assign(new EventEmitter(), {
      method: options.method ?? 'POST',
      headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', 'content-type': 'application/json', ...options.headers },
      socket: { remoteAddress: options.address ?? '127.0.0.1' },
      destroy: vi.fn(),
    })
    let status = 0
    let headers: Record<string, string> = {}
    let payload = ''
    let ended!: () => void
    const done = new Promise<void>((resolve) => { ended = resolve })
    const res = {
      writableEnded: false,
      writeHead: vi.fn((code: number, nextHeaders: Record<string, string>) => { status = code; headers = nextHeaders }),
      end: vi.fn((text = '') => { payload = text; res.writableEnded = true; ended() }),
    }
    handler(req as unknown as IncomingMessage, res as unknown as ServerResponse)
    for (const chunk of typeof body === 'string' ? [body] : body) req.emit('data', chunk)
    req.emit('end')
    await done
    return { status, headers, payload, json: () => JSON.parse(payload), req, res }
  }
  const post = (method: string, args: unknown = {}) => request(JSON.stringify({ method, args }))
  return { request, post, config, register, off, dispose: () => dispose() }
}

describe('OAuth HTTP RPC contract', () => {
  it.each(['null', '[]', '"text"', 'false', '1', '{invalid'])('returns a bad-request envelope for invalid request root %s', async (body) => {
    const response = await fixture().request(body)
    expect(response.status).toBe(400)
    expect(response.json()).toEqual({ ok: false, error: { code: 'bad-request' } })
  })

  it.each(['missing', 'toString', 'constructor', '__proto__'])('does not dispatch unregistered method %s', async (method) => {
    const response = await fixture().post(method)
    expect(response.status).toBe(404)
    expect(response.json()).toEqual({ ok: false, error: { code: 'not-found' } })
  })

  it('registers the exact route and disposes it', () => {
    const app = fixture()
    expect(app.register).toHaveBeenCalledWith(expect.objectContaining({ kind: 'exact', path: RPC_PATH }))
    app.dispose()
    expect(app.off).toHaveBeenCalledTimes(1)
  })

  it('returns exact state and persistence envelopes through the settings scope', async () => {
    const app = fixture()
    expect((await app.post('getState')).json()).toEqual({ ok: true, value: { writable: true, providers: [] } })
    await app.post('addProvider', { family: 'grok' })
    const response = await app.post('setModels', { alias: 'xai-oauth', models: [{ id: 'custom', contextWindow: 1000, maxTokens: 100 }] })
    expect(response.headers).toMatchObject({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    expect(Object.keys(response.json()).sort()).toEqual(['ok', 'value'])
    expect(app.config.get()).toEqual({ providers: [{ id: 'xai', displayName: 'Grok', models: [{ id: 'custom', contextWindow: 1000, maxTokens: 100 }] }] })
    expect((await app.post('getState')).json().value.providers[0]).toMatchObject({ modelsOverridden: true, models: [{ id: 'custom', name: 'custom', contextWindow: 1000, maxTokens: 100 }] })
    await app.post('restoreModels', { alias: 'xai-oauth' })
    expect(app.config.get()).toEqual({ providers: [{ id: 'xai', displayName: 'Grok' }] })
    await app.post('removeProvider', { family: 'grok' })
    expect(app.config.get()).toEqual({ providers: [] })
  })

  it.each([
    [new RpcError('port', 'sensitive diagnostic', { port: 1455 }), { code: 'port', params: { port: 1455 } }],
    [new Error('secret token in upstream message'), { code: 'unknown' }],
  ])('returns sanitized service failures', async (error, expected) => {
    const app = fixture({ state: async () => { throw error } })
    const response = await app.post('getState')
    expect(response.status).toBe(200)
    expect(response.json()).toEqual({ ok: false, error: expected })
    expect(response.payload).not.toContain(error.message)
  })

  it('rejects non-POST, remote peers and unexpected content types', async () => {
    const app = fixture()
    expect((await app.request('', { method: 'GET' })).status).toBe(405)
    expect((await app.request('{}', { address: '10.0.0.1' })).status).toBe(403)
    for (const type of ['text/plain', 'text/application/json', 'application/jsonp']) {
      expect((await app.request('{}', { headers: { 'content-type': type } })).status).toBe(415)
    }
    expect((await app.request('{"method":"getState"}', { headers: { 'content-type': 'Application/JSON; charset=utf-8' } })).status).toBe(200)
  })

  it('preserves UTF-8 characters split between incoming buffers', async () => {
    const app = fixture()
    const body = Buffer.from(JSON.stringify({ method: 'addModel', args: { alias: 'xai-oauth', model: { id: 'custom', name: '\u6a21\u578b' } } }))
    const boundary = body.indexOf(Buffer.from('\u6a21')) + 1
    expect((await app.request([body.subarray(0, boundary), body.subarray(boundary)])).status).toBe(200)
    expect((app.config.get() as { providers: { models: { id: string; name: string }[] }[] }).providers[0]!.models.find((model) => model.id === 'custom')?.name).toBe('\u6a21\u578b')
  })

  it('enforces request size in bytes and writes one response even if more data arrives', async () => {
    const app = fixture()
    const tooLarge = Buffer.from(JSON.stringify({ method: 'getState', padding: '\u6a21'.repeat(400_000) }))
    const response = await app.request([tooLarge, Buffer.from('extra')])
    expect(response.status).toBe(413)
    expect(response.req.destroy).toHaveBeenCalledTimes(1)
    expect(response.res.writeHead).toHaveBeenCalledTimes(1)
    expect(response.res.end).toHaveBeenCalledTimes(1)
  })
})

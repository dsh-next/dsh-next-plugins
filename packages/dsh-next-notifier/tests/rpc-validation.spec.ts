import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import { registerRpc } from '../src/host/rpc.ts'
import type { Notifier } from '../src/host/notifier.ts'
import type { NotifierConfig } from '../src/core/types.ts'
import type { ClientPresence } from '../src/core/notifications.ts'

const validPresence: ClientPresence = {
  clientId: 'tab-a', sequence: 0, focused: true, visible: true, open: true,
  sessionId: 'session-a', permission: 'granted',
}
const validReceipt = { clientId: 'tab-a', id: 'event-a', lease: 'lease-a' }

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function harness(options: { writable?: boolean; noScope?: boolean; noSettings?: boolean } = {}) {
  const notifier = {
    state: vi.fn(() => ({ config: { volume: 70 }, platform: null, webPermission: null, sounds: [] })),
    getPresence: vi.fn(() => ({ clientId: 'tab-a' })),
    reportPresence: vi.fn(), claimPending: vi.fn(() => []),
    acknowledge: vi.fn(() => true), release: vi.fn(),
    preview: vi.fn(async () => true), onConfigChanged: vi.fn(async () => {}),
  }
  const update = vi.fn(async (_patch: unknown) => ({}))
  const scope = { update } as unknown as SettingsScope<NotifierConfig>
  let handler!: (req: IncomingMessage, res: ServerResponse) => void
  const off = vi.fn()
  const register = vi.fn((spec: { handler: typeof handler }) => { handler = spec.handler; return off })
  const effect = vi.fn()
  registerRpc({
    get: (name: string) => name === 'webServer' ? { register }
      : name === 'settings' && !options.noSettings ? { writable: options.writable ?? true } : undefined,
    effect,
  } as never, notifier as unknown as Notifier, options.noScope ? null : scope)

  function request(method = 'POST') {
    const req = Object.assign(new EventEmitter(), { method })
    const done = deferred<{ status: number; json: unknown }>()
    let status = 0
    const res = Object.assign(new EventEmitter(), {
      writableEnded: false, destroyed: false,
      writeHead: vi.fn((code: number) => { status = code }),
      end: vi.fn((body: string) => { res.writableEnded = true; done.resolve({ status, json: JSON.parse(body) }) }),
    })
    handler(req as IncomingMessage, res as unknown as ServerResponse)
    return { req, res, done: done.promise }
  }
  function raw(body: string) {
    const r = request()
    r.req.emit('data', body)
    r.req.emit('end')
    return r.done
  }
  function post(method: string, args?: unknown) { return raw(JSON.stringify({ method, args })) }
  return { notifier, update, register, effect, off, request, raw, post }
}

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve()
}

describe('RPC route ownership and transport', () => {
  it('keeps the exact route and registers its disposer through the context effect', () => {
    const h = harness()
    expect(h.register).toHaveBeenCalledWith(expect.objectContaining({ kind: 'exact', path: '/dsh-next-notifier/rpc' }))
    expect(h.effect).toHaveBeenCalledTimes(1)
    h.effect.mock.calls[0][0]()()
    expect(h.off).toHaveBeenCalledTimes(1)
  })

  it('does nothing without a web server', () => {
    const effect = vi.fn()
    registerRpc({ get: () => undefined, effect } as never, {} as Notifier, null)
    expect(effect).not.toHaveBeenCalled()
  })

  it('rejects non-POST requests', async () => {
    const h = harness()
    expect((await h.request('GET').done).status).toBe(405)
    expect(h.notifier.state).not.toHaveBeenCalled()
  })

  it.each(['', '{', 'null', '[]', '1', 'false', '"getState"'])('rejects malformed or non-object body %s', async (body) => {
    expect((await harness().raw(body)).status).toBe(400)
  })

  it.each([{}, { method: null }, { method: 1 }, { method: [] }])('rejects a missing or non-string method: %j', async (body) => {
    expect((await harness().raw(JSON.stringify(body))).status).toBe(400)
  })

  it.each(['unknown', '', 'constructor', 'toString', '__proto__', '__defineGetter__', 'hasOwnProperty'])('does not dispatch unknown/prototype method %s', async (method) => {
    const h = harness()
    expect((await h.post(method)).status).toBe(404)
    expect(h.notifier.state).not.toHaveBeenCalled()
  })

  it('enforces the byte limit, not JavaScript character length, and replies only once', async () => {
    const h = harness()
    const r = h.request()
    const raw = JSON.stringify({ method: 'getState', padding: '\u00e9'.repeat(33000) })
    expect(raw.length).toBeLessThan(65536)
    expect(Buffer.byteLength(raw)).toBeGreaterThan(65536)
    r.req.emit('data', raw)
    r.req.emit('data', 'extra')
    r.req.emit('end')
    r.req.emit('error', new Error('late stream failure'))
    expect((await r.done).status).toBe(413)
    expect(r.res.end).toHaveBeenCalledTimes(1)
    expect(h.notifier.state).not.toHaveBeenCalled()
  })

  it('accepts exactly 65536 bytes and rejects one byte more', async () => {
    const make = (bytes: number) => {
      const prefix = '{"method":"getState","padding":"'
      return prefix + 'a'.repeat(bytes - prefix.length - 2) + '"}'
    }
    expect((await harness().raw(make(65536))).status).toBe(200)
    expect((await harness().raw(make(65537))).status).toBe(413)
  })

  it('decodes UTF-8 only after joining chunks, preserving split multibyte identifiers', async () => {
    const h = harness()
    const r = h.request()
    const clientId = 'tab-\u00e9'
    const buffer = Buffer.from(JSON.stringify({ method: 'getState', args: { clientId } }))
    const split = buffer.indexOf(0xc3) + 1
    r.req.emit('data', buffer.subarray(0, split))
    r.req.emit('data', buffer.subarray(split))
    r.req.emit('end')
    expect((await r.done).status).toBe(200)
    expect(h.notifier.state).toHaveBeenCalledWith(clientId)
  })

  it('turns request stream failures into one controlled error response', async () => {
    const h = harness()
    const r = h.request()
    r.req.emit('data', '{"method":"setConfig",')
    expect(() => r.req.emit('error', new Error('read failure'))).not.toThrow()
    r.req.emit('end')
    expect((await r.done).status).toBe(400)
    expect(r.res.end).toHaveBeenCalledTimes(1)
    expect(h.update).not.toHaveBeenCalled()
  })

  it.each([false, true])('does not dispatch an aborted request (end first: %s)', async (endFirst) => {
    const h = harness()
    const r = h.request()
    r.req.emit('data', JSON.stringify({ method: 'setConfig', args: { volume: 20 } }))
    if (endFirst) r.req.emit('end')
    r.req.emit('aborted')
    r.req.emit('error', new Error('connection reset'))
    r.req.emit('end')
    await flush()
    expect(r.res.end).not.toHaveBeenCalled()
    expect(h.update).not.toHaveBeenCalled()
  })

  it('does not respond after a request aborts during an asynchronous operation', async () => {
    const h = harness()
    const ready = deferred<boolean>()
    h.notifier.preview.mockReturnValue(ready.promise)
    const r = h.request()
    r.req.emit('data', JSON.stringify({ method: 'preview', args: { id: 'chime' } }))
    r.req.emit('end')
    await flush()
    expect(h.notifier.preview).toHaveBeenCalledTimes(1)
    r.req.emit('aborted')
    ready.resolve(true)
    await flush()
    expect(r.res.end).not.toHaveBeenCalled()
  })

  it('does not throw when response writes fail after peer disconnection', async () => {
    const h = harness()
    const r = h.request()
    r.res.writeHead.mockImplementation(() => { throw new Error('socket closed') })
    expect(() => r.req.emit('error', new Error('read failure'))).not.toThrow()
    await flush()
    expect(r.res.writeHead).toHaveBeenCalledTimes(1)
    expect(r.res.end).not.toHaveBeenCalled()
  })

  it.each(['close', 'error'])('abandons pending responses on response-stream %s', async (event) => {
    const h = harness()
    const ready = deferred<boolean>()
    h.notifier.preview.mockReturnValue(ready.promise)
    const r = h.request()
    r.req.emit('data', JSON.stringify({ method: 'preview', args: { id: 'chime' } }))
    r.req.emit('end')
    await flush()
    expect(() => r.res.emit(event, new Error('peer disconnected'))).not.toThrow()
    ready.resolve(true)
    await flush()
    expect(r.res.end).not.toHaveBeenCalled()
  })

  it('contains synchronous handler exceptions', async () => {
    const h = harness()
    h.notifier.state.mockImplementation(() => { throw new Error('unavailable') })
    expect(await h.post('getState')).toEqual({ status: 500, json: { error: 'request failed' } })
  })

  it('contains response serialization errors without a second response attempt', async () => {
    const h = harness()
    const value = { config: { volume: 70 }, platform: null, webPermission: null, sounds: [] }
    Object.defineProperty(value, 'cycle', { value, enumerable: true })
    h.notifier.state.mockReturnValue(value)
    expect(await h.post('getState')).toEqual({ status: 500, json: { error: 'response serialization failed' } })
  })

  it('does not dispatch duplicate end events', async () => {
    const h = harness()
    const r = h.request()
    r.req.emit('data', JSON.stringify({ method: 'getState' }))
    r.req.emit('end')
    r.req.emit('end')
    expect((await r.done).status).toBe(200)
    expect(h.notifier.state).toHaveBeenCalledTimes(1)
    expect(r.res.end).toHaveBeenCalledTimes(1)
  })
})

describe('RPC argument validation and dispatch', () => {
  it.each([undefined, null, {}])('allows an omitted getState clientId: %j', async (args) => {
    const h = harness()
    expect((await h.post('getState', args)).status).toBe(200)
    expect(h.notifier.state).toHaveBeenCalledWith(undefined)
  })

  it.each(['getState', 'getPresence'])('validates client-scoped arguments for %s', async (method) => {
    const h = harness()
    for (const args of [[], 'tab-a', 1, { clientId: null }, { clientId: '' }, { clientId: ' ' }, { clientId: 1 }]) {
      expect((await h.post(method, args)).status).toBe(400)
    }
    expect((await h.post(method, { clientId: 'tab-a' })).status).toBe(200)
  })

  it('requires getPresence ownership', async () => {
    const h = harness()
    for (const args of [undefined, null, {}]) expect((await h.post('getPresence', args)).status).toBe(400)
    expect(h.notifier.getPresence).not.toHaveBeenCalled()
  })

  it.each(['reportPresence', 'reportWebPermission', 'getPendingNotifications'])('validates the complete presence report for %s', async (method) => {
    const h = harness()
    const invalid = [null, [], 'tab-a', {}, { ...validPresence, clientId: '' }, { ...validPresence, sequence: -1 },
      { ...validPresence, sequence: 0.1 }, { ...validPresence, sequence: Number.MAX_SAFE_INTEGER + 1 },
      { ...validPresence, sequence: undefined }, { ...validPresence, focused: 1 }, { ...validPresence, visible: 'true' },
      { ...validPresence, open: undefined }, { ...validPresence, sessionId: 1 }, { ...validPresence, sessionId: undefined },
      { ...validPresence, permission: 'unknown' }, { ...validPresence, permission: undefined }]
    for (const args of invalid) expect((await h.post(method, args)).status).toBe(400)
    expect(h.notifier.reportPresence).not.toHaveBeenCalled()
    expect(h.notifier.claimPending).not.toHaveBeenCalled()
    expect((await h.post(method, validPresence)).status).toBe(200)
    expect(h.notifier.reportPresence).toHaveBeenCalledWith(validPresence)
  })

  it('accepts each permission and closed presence with a null session', async () => {
    const h = harness()
    for (const permission of ['granted', 'denied', 'default', 'unsupported']) {
      const args = { ...validPresence, focused: false, visible: false, open: false, sessionId: null, permission }
      expect((await h.post('reportWebPermission', args)).status).toBe(200)
      expect(h.notifier.reportPresence).toHaveBeenLastCalledWith(args)
    }
  })

  it('updates presence before claiming only that client deliveries', async () => {
    const h = harness()
    expect((await h.post('getPendingNotifications', validPresence)).json).toEqual([])
    expect(h.notifier.claimPending).toHaveBeenCalledWith('tab-a')
    expect(h.notifier.reportPresence.mock.invocationCallOrder[0]).toBeLessThan(h.notifier.claimPending.mock.invocationCallOrder[0])
  })

  it.each(['acknowledgeNotifications', 'releaseNotification'])('validates delivery receipts for %s', async (method) => {
    const h = harness()
    for (const args of [null, [], {}, { ...validReceipt, clientId: '' }, { ...validReceipt, id: 1 }, { ...validReceipt, id: '' }, { ...validReceipt, lease: null }, { ...validReceipt, lease: '' }]) {
      expect((await h.post(method, args)).status).toBe(400)
    }
    expect(h.notifier.acknowledge).not.toHaveBeenCalled()
    expect(h.notifier.release).not.toHaveBeenCalled()
    expect((await h.post(method, validReceipt)).json).toEqual({ ok: true })
    expect(method === 'acknowledgeNotifications' ? h.notifier.acknowledge : h.notifier.release).toHaveBeenCalledWith(validReceipt)
  })

  it('returns a rejected acknowledgment as ok:false, not a successful sound acknowledgment', async () => {
    const h = harness()
    h.notifier.acknowledge.mockReturnValue(false)
    expect((await h.post('acknowledgeNotifications', validReceipt)).json).toEqual({ ok: false })
  })

  it('rejects missing, malformed, or unknown preview sounds', async () => {
    const h = harness()
    for (const args of [undefined, null, [], {}, { id: 1 }, { id: '' }, { id: '../escape' }, { id: 'unknown' }]) {
      expect((await h.post('preview', args)).status).toBe(400)
    }
    expect(h.notifier.preview).not.toHaveBeenCalled()
  })

  it('awaits preview completion and returns its boolean rather than serializing a promise', async () => {
    const h = harness()
    const ready = deferred<boolean>()
    h.notifier.preview.mockReturnValue(ready.promise)
    let completed = false
    const result = h.post('preview', { id: 'chime' }).then((v) => { completed = true; return v })
    await flush()
    expect(completed).toBe(false)
    ready.resolve(false)
    expect(await result).toEqual({ status: 200, json: { ok: false } })
  })

  it('returns 500 on rejected preview without leaking internal details', async () => {
    const h = harness()
    h.notifier.preview.mockRejectedValue(new Error('private filesystem path'))
    expect(await h.post('preview', { id: 'chime' })).toEqual({ status: 500, json: { error: 'request failed' } })
  })
})

describe('RPC settings persistence failures and ordering', () => {
  it.each([{ writable: false }, { noScope: true }, { noSettings: true }])('rejects read-only or unavailable settings: %j', async (options) => {
    const h = harness(options)
    expect((await h.post('setConfig', { volume: 25 })).status).toBe(403)
    expect(h.update).not.toHaveBeenCalled()
    expect(h.notifier.onConfigChanged).not.toHaveBeenCalled()
  })

  it('reports failed persistence rather than claiming success', async () => {
    const h = harness()
    h.update.mockRejectedValue(new Error('disk full'))
    expect((await h.post('setConfig', { volume: 25 })).status).toBe(500)
    expect(h.notifier.onConfigChanged).not.toHaveBeenCalled()
    expect(h.notifier.state).not.toHaveBeenCalled()
  })

  it('reports failed sound regeneration rather than claiming the new settings are ready', async () => {
    const h = harness()
    h.notifier.onConfigChanged.mockRejectedValue(new Error('write failed'))
    expect((await h.post('setConfig', { volume: 25 })).status).toBe(500)
    expect(h.update).toHaveBeenCalledTimes(1)
    expect(h.notifier.state).not.toHaveBeenCalled()
  })

  it('awaits persistence and regenerated sounds before responding with client state', async () => {
    const h = harness()
    const persisted = deferred<object>()
    const generated = deferred<void>()
    h.update.mockReturnValue(persisted.promise)
    h.notifier.onConfigChanged.mockReturnValue(generated.promise)
    let completed = false
    const result = h.post('setConfig', { volume: 25, clientId: 'tab-a' }).then((v) => { completed = true; return v })
    await flush()
    expect(h.update).toHaveBeenCalledWith({ volume: 25 })
    expect(h.notifier.onConfigChanged).not.toHaveBeenCalled()
    expect(completed).toBe(false)
    persisted.resolve({})
    await flush()
    expect(h.notifier.onConfigChanged).toHaveBeenCalledTimes(1)
    expect(h.notifier.state).not.toHaveBeenCalled()
    expect(completed).toBe(false)
    generated.resolve()
    expect((await result).status).toBe(200)
    expect(h.notifier.state).toHaveBeenCalledWith('tab-a')
  })

  it('rejects malformed recognized config fields before persisting anything', async () => {
    const h = harness()
    for (const args of [null, [], 1, {}, { ignored: true }, { enabled: 1 }, { suppressFocused: null }, { volume: '50' },
      { finished: null }, { approval: [] }, { question: false }, { finished: { enabled: 1 } },
      { finished: { sound: null } }, { finished: { subagent: 'true' } }, { finished: { goalOnly: 0 } },
      { finished: { soundName: 'unknown' } }, { volume: 20, clientId: '' }]) {
      expect((await h.post('setConfig', args)).status).toBe(400)
    }
    expect(h.update).not.toHaveBeenCalled()
  })

  it('rejects numeric overflow parsed from JSON before writing settings', async () => {
    const h = harness()
    expect((await h.raw('{"method":"setConfig","args":{"volume":1e999}}')).status).toBe(400)
    expect(h.update).not.toHaveBeenCalled()
  })

  it('cleans partial group patches, clamps volume, and ignores transport/unknown keys', async () => {
    const h = harness()
    expect((await h.post('setConfig', { volume: 101.7, clientId: 'tab-a', extra: true, finished: { sound: false, ignored: true } })).status).toBe(200)
    expect(h.update).toHaveBeenCalledWith({ volume: 100, finished: { sound: false } })
  })
})

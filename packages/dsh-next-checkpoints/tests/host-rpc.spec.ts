import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CAPTURE_ENV, captureAllowed, createHandlers, registerRpc, RPC_PATH } from '../src/host/rpc.ts'
import { CheckpointsError, type CheckpointsService } from '../src/host/service.ts'

function serviceWith(spies: Record<string, ReturnType<typeof vi.fn>>): CheckpointsService {
  return spies as unknown as CheckpointsService
}

describe('createHandlers', () => {
  afterEach(() => {
    delete process.env[CAPTURE_ENV]
  })

  it('routes list with sessionId', async () => {
    const list = vi.fn().mockResolvedValue({ checkpoints: [] })
    const handlers = createHandlers(serviceWith({ list }))
    await handlers.list!({ sessionId: 's1' })
    expect(list).toHaveBeenCalledWith('s1')
  })

  it('routes diffs, preview, and rewind', async () => {
    const diffs = vi.fn().mockResolvedValue({ files: [] })
    const preview = vi.fn().mockResolvedValue({ blockers: [] })
    const rewind = vi.fn().mockResolvedValue({ ok: true })
    const handlers = createHandlers(serviceWith({ diffs, preview, rewind }))
    await handlers.diffs!({ sessionId: 's1', checkpointId: 'c1' })
    await handlers.preview!({ sessionId: 's1', checkpointId: 'c1' })
    await handlers.rewind!({ sessionId: 's1', checkpointId: 'c1' })
    expect(diffs).toHaveBeenCalledWith('s1', 'c1')
    expect(preview).toHaveBeenCalledWith('s1', 'c1')
    expect(rewind).toHaveBeenCalledWith('s1', 'c1')
  })

  it('refuses capture unless the e2e harness env is set', async () => {
    const capture = vi.fn()
    const handlers = createHandlers(serviceWith({ capture }))
    expect(captureAllowed({ })).toBe(false)
    await expect(handlers.capture!({ sessionId: 's1' })).rejects.toMatchObject({ code: 'disabled' })
    expect(capture).not.toHaveBeenCalled()
  })

  it('routes capture when the e2e harness env is set', async () => {
    process.env[CAPTURE_ENV] = '1'
    const capture = vi.fn().mockResolvedValue({ checkpointId: 'c1', turn: 1 })
    const handlers = createHandlers(serviceWith({ capture }))
    expect(captureAllowed()).toBe(true)
    await handlers.capture!({ sessionId: 's1' })
    expect(capture).toHaveBeenCalledWith('s1')
    await expect(handlers.capture!({})).rejects.toMatchObject({ code: 'bad-request' })
  })

  it('rejects missing sessionId with a stable code', async () => {
    const handlers = createHandlers(serviceWith({}))
    await expect(handlers.list!({})).rejects.toMatchObject({ code: 'bad-request' })
    await expect(handlers.list!({})).rejects.toBeInstanceOf(CheckpointsError)
  })

  it('rejects missing checkpointId on diffs, preview, and rewind', async () => {
    const handlers = createHandlers(serviceWith({}))
    await expect(handlers.diffs!({ sessionId: 's1' })).rejects.toMatchObject({ code: 'bad-request' })
    await expect(handlers.preview!({ sessionId: 's1' })).rejects.toMatchObject({ code: 'bad-request' })
    await expect(handlers.rewind!({ checkpointId: 'c1' })).rejects.toMatchObject({ code: 'bad-request' })
  })
})

describe('registerRpc', () => {
  function request(method: string, body?: string): EventEmitter & { method: string; destroy: ReturnType<typeof vi.fn> } {
    const req = new EventEmitter() as EventEmitter & { method: string; destroy: ReturnType<typeof vi.fn> }
    req.method = method
    req.destroy = vi.fn()
    queueMicrotask(() => {
      if (body !== undefined) req.emit('data', body)
      req.emit('end')
    })
    return req
  }

  function response(): {
    status?: number
    body?: string
    writableEnded: boolean
    writeHead: (status: number) => void
    end: (body?: string) => void
  } {
    const res = {
      status: undefined as number | undefined,
      body: undefined as string | undefined,
      writableEnded: false,
      writeHead(status: number) { this.status = status },
      end(body?: string) {
        this.body = body
        this.writableEnded = true
      },
    }
    return res
  }

  async function invoke(
    handler: (req: EventEmitter, res: ReturnType<typeof response>) => void,
    method: string,
    body?: string,
  ): Promise<ReturnType<typeof response>> {
    const req = request(method, body)
    const res = response()
    handler(req, res)
    await vi.waitFor(() => { expect(res.writableEnded).toBe(true) })
    return res
  }

  it('answers POST methods, 405 otherwise, and 200 error envelopes', async () => {
    const list = vi.fn().mockResolvedValue({ checkpoints: [] })
    const rewind = vi.fn().mockRejectedValue(new CheckpointsError('turn-open', 'busy'))
    let captured: ((req: EventEmitter, res: ReturnType<typeof response>) => void) | undefined
    const register = vi.fn((route: { path: string; handler: typeof captured }) => {
      captured = route.handler
      expect(route.path).toBe(RPC_PATH)
      return () => {}
    })
    const effect = vi.fn()
    registerRpc({
      get: (name: string) => name === 'webServer' ? { register } : undefined,
      effect,
    } as never, serviceWith({ list, rewind }))
    expect(effect).toHaveBeenCalled()
    const handler = captured!
    const get = await invoke(handler, 'GET')
    expect(get.status).toBe(405)
    const badJson = await invoke(handler, 'POST', '{')
    expect(badJson.status).toBe(400)
    const missing = await invoke(handler, 'POST', JSON.stringify({ method: 'nope' }))
    expect(missing.status).toBe(404)
    const ok = await invoke(handler, 'POST', JSON.stringify({ method: 'list', args: { sessionId: 's1' } }))
    expect(ok.status).toBe(200)
    expect(JSON.parse(ok.body ?? '')).toEqual({ checkpoints: [] })
    const fail = await invoke(handler, 'POST', JSON.stringify({ method: 'rewind', args: { sessionId: 's1', checkpointId: 'c1' } }))
    expect(fail.status).toBe(200)
    expect(JSON.parse(fail.body ?? '')).toEqual({
      error: { code: 'turn-open', message: 'busy' },
    })
  })
})

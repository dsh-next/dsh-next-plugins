import { afterEach, describe, expect, it, vi } from 'vitest'
import { CheckpointsRpcError, RPC_PATH, rpc } from '../src/client/rpc.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('rpc', () => {
  it('posts the method and args to the checkpoints path', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ checkpoints: [] }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(rpc('list', { sessionId: 's1' })).resolves.toEqual({ checkpoints: [] })
    expect(fetchMock).toHaveBeenCalledWith(RPC_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'list', args: { sessionId: 's1' } }),
    })
  })

  it('throws CheckpointsRpcError on a 200 error envelope', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      error: { code: 'turn-open', message: 'Refuse rewind while a turn is open' },
    })))
    const error = await rpc('rewind').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(CheckpointsRpcError)
    expect(error).toMatchObject({ code: 'turn-open' })
  })

  it('throws CheckpointsRpcError http on a non-OK status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('no', { status: 404 })))
    await expect(rpc('missing')).rejects.toMatchObject({ code: 'http', message: 'HTTP 404' })
  })

  it('sends null args when omitted', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(null))
    vi.stubGlobal('fetch', fetchMock)
    await rpc('list')
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body as string)).toEqual({
      method: 'list',
      args: null,
    })
  })
})

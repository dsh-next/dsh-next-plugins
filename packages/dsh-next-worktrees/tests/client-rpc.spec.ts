import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  RPC_PATH,
  WorktreesRpcError,
  rpc,
  requestTopologyRefresh,
  REFRESH_EVENT,
} from '../src/client/rpc.ts'

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
  it('posts the method and args to the worktrees path', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ slug: 'swift-01' }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(rpc('create', { cwd: '/r' })).resolves.toEqual({ slug: 'swift-01' })
    expect(fetchMock).toHaveBeenCalledWith(RPC_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'create', args: { cwd: '/r' } }),
    })
  })

  it('throws WorktreesRpcError with the host machine code on a 200 error envelope', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      error: { code: 'dirty-remove-refused', message: 'worktree has uncommitted changes', hint: 'commit them' },
    })))
    const error = await rpc('remove').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(WorktreesRpcError)
    expect(error).toMatchObject({
      code: 'dirty-remove-refused',
      message: 'worktree has uncommitted changes',
      hint: 'commit them',
    })
  })

  it('throws WorktreesRpcError http on a non-OK status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('no', { status: 404 })))
    await expect(rpc('missing')).rejects.toMatchObject({ code: 'http', message: 'HTTP 404' })
  })

  it('sends null args when omitted', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(null))
    vi.stubGlobal('fetch', fetchMock)
    await rpc('suggestName')
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body as string)).toEqual({
      method: 'suggestName',
      args: null,
    })
  })
})

describe('requestTopologyRefresh', () => {
  it('dispatches the namespaced refresh event', () => {
    const listener = vi.fn()
    window.addEventListener(REFRESH_EVENT, listener)
    requestTopologyRefresh()
    expect(listener).toHaveBeenCalledTimes(1)
    window.removeEventListener(REFRESH_EVENT, listener)
  })
})

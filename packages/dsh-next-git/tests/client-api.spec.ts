import { describe, expect, it, vi } from 'vitest'
import { asApiError, createApi, GitApiError, RPC_PATH } from '../src/client/api.ts'

/** A fetch double returning one scripted response. */
function fetchReturning(response: { ok: boolean; status: number; body: unknown } | Error): {
  fetch: Parameters<typeof createApi>[1]
  calls: { url: string; body: string }[]
} {
  const calls: { url: string; body: string }[] = []
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, body: init.body })
      if (response instanceof Error) throw response
      return {
        ok: response.ok,
        status: response.status,
        json: async () => response.body,
      }
    },
  }
}

describe('rpc client', () => {
  it('posts the method and args and unwraps a success envelope', async () => {
    const double = fetchReturning({ ok: true, status: 200, body: { ok: true, value: { hello: 'world' } } })
    const api = createApi(RPC_PATH, double.fetch)
    const value = await api.call<{ hello: string }>('getState', { sessionId: 's1' })
    expect(value).toEqual({ hello: 'world' })
    expect(double.calls[0]!.url).toBe(RPC_PATH)
    expect(JSON.parse(double.calls[0]!.body)).toEqual({
      method: 'getState',
      args: { sessionId: 's1' },
    })
  })

  it('throws a GitApiError carrying the named failure and degraded state', async () => {
    const degraded = { code: 'not-a-repository', detail: '/tmp', requiredVersion: null, installedVersion: null }
    const double = fetchReturning({
      ok: true,
      status: 200,
      body: { ok: false, failure: { code: 'not-a-repository', detail: '/tmp' }, degraded },
    })
    const api = createApi(RPC_PATH, double.fetch)
    try {
      await api.call('getState', {})
      throw new Error('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(GitApiError)
      const apiError = error as GitApiError
      expect(apiError.code).toBe('not-a-repository')
      expect(apiError.degraded).toEqual(degraded)
      expect(apiError.message).toBe('/tmp')
    }
  })

  it('names an HTTP failure when the transport refused', async () => {
    const double = fetchReturning({ ok: false, status: 500, body: {} })
    const api = createApi(RPC_PATH, double.fetch)
    await expect(api.call('getState', {})).rejects.toMatchObject({
      name: 'GitApiError',
      failure: { code: 'git-failed', detail: 'HTTP 500' },
    })
  })

  it('names a method this host build does not implement', async () => {
    // The route answers 404 only for an unknown method, which is what a page
    // running a newer client half than the loaded host half sees.
    const double = fetchReturning({ ok: false, status: 404, body: {} })
    const api = createApi(RPC_PATH, double.fetch)
    await expect(api.call('getFileChanges', {})).rejects.toMatchObject({
      failure: { code: 'host-outdated', detail: 'getFileChanges' },
    })
  })

  it('rejects a malformed or empty envelope', async () => {
    const empty = createApi(RPC_PATH, fetchReturning({ ok: true, status: 200, body: null }).fetch)
    await expect(empty.call('getState', {})).rejects.toMatchObject({
      failure: { detail: 'empty RPC response' },
    })
    const malformed = createApi(RPC_PATH, fetchReturning({ ok: true, status: 200, body: { value: 1 } }).fetch)
    await expect(malformed.call('getState', {})).rejects.toMatchObject({
      failure: { detail: 'malformed RPC envelope' },
    })
  })

  it('propagates a transport throw unchanged', async () => {
    const boom = new Error('network down')
    const api = createApi(RPC_PATH, fetchReturning(boom).fetch)
    await expect(api.call('getState', {})).rejects.toThrow('network down')
  })

  it('passes an abort signal through', async () => {
    const controller = new AbortController()
    const spy = vi.fn(async (_url: string, init: { signal?: AbortSignal }) => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, value: null }),
    }))
    const api = createApi(RPC_PATH, spy as unknown as Parameters<typeof createApi>[1])
    await api.call('getState', {}, controller.signal)
    expect(spy.mock.calls[0]![1].signal).toBe(controller.signal)
  })

  it('normalizes an unknown throw into a GitApiError', () => {
    expect(asApiError(new Error('boom'))).toMatchObject({ failure: { code: 'git-failed', detail: 'boom' } })
    expect(asApiError('weird')).toMatchObject({ failure: { code: 'git-failed', detail: 'weird' } })
    const already = new GitApiError({ code: 'dirty-tree', detail: 'x' }, null)
    expect(asApiError(already)).toBe(already)
  })
})

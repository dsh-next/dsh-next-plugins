import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRpc } from '../src/client/rpc.ts'
import { englishTranslate } from '../src/client/dictionaries.ts'

afterEach(() => vi.useRealTimers())
describe('browser RPC lifetime', () => {
  it('sends JSON and returns the response envelope', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ config: {} }) })
    const rpc = createRpc('/rpc', englishTranslate, fetcher)
    expect(await rpc.request('getState', { clientId: 'a' })).toEqual({ config: {} })
    expect(fetcher).toHaveBeenCalledWith('/rpc', expect.objectContaining({ method: 'POST', keepalive: false, body: JSON.stringify({ method: 'getState', args: { clientId: 'a' } }) }))
    rpc.dispose()
  })
  it('surfaces localized HTTP failure and permits the next request', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce({ ok: false, status: 403 }).mockResolvedValue({ ok: true, json: async () => [] })
    const rpc = createRpc('/rpc', englishTranslate, fetcher)
    await expect(rpc.request('setConfig')).rejects.toThrow('HTTP 403')
    expect(await rpc.request('getPendingNotifications')).toEqual([])
    rpc.dispose()
  })
  it('aborts hung requests after eight seconds and permits retry', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn((_path, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason))))
    const rpc = createRpc('/rpc', englishTranslate, fetcher as typeof fetch)
    const request = rpc.request('getPendingNotifications')
    const assertion = expect(request).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(8000)
    await assertion
    expect(vi.getTimerCount()).toBe(0)
    rpc.dispose()
  })
  it('aborts normal requests on dispose but lets the final closed presence finish', async () => {
    const signals: AbortSignal[] = []
    const fetcher = vi.fn((_path, options) => new Promise((_resolve, reject) => {
      signals.push(options.signal)
      options.signal.addEventListener('abort', () => reject(options.signal.reason))
    }))
    vi.useFakeTimers()
    const rpc = createRpc('/rpc', englishTranslate, fetcher as typeof fetch)
    const pending = rpc.request('acknowledgeNotifications')
    const closed = rpc.request('reportPresence', { open: false })
    const pendingAssertion = expect(pending).rejects.toThrow('no longer active')
    const closeAssertion = expect(closed).rejects.toThrow('timed out')
    rpc.dispose()
    expect(signals.map(s => s.aborted)).toEqual([true, false])
    await pendingAssertion
    await expect(rpc.request('getState')).rejects.toThrow('no longer active')
    await vi.advanceTimersByTimeAsync(8000)
    await closeAssertion
  })
})

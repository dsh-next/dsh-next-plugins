import { describe, expect, it } from 'vitest'
import { ClientRpcError, createRpc } from '../src/client/api.ts'
import { errorText } from '../src/client/error-text.ts'

describe('createRpc', () => {
  it('unwraps an ok envelope', async () => {
    const rpc = createRpc(async () => new Response(JSON.stringify({ ok: true, value: { providers: [] } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    await expect(rpc('getState')).resolves.toEqual({ providers: [] })
  })

  it('throws ClientRpcError from ok:false', async () => {
    const rpc = createRpc(async () => new Response(JSON.stringify({ ok: false, error: { code: 'busy' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    await expect(rpc('startLogin')).rejects.toMatchObject({ code: 'busy' })
    await expect(rpc('startLogin')).rejects.toBeInstanceOf(ClientRpcError)
  })
})

describe('error copy', () => {
  it('names a missing host route as a restart, not a rejected sign-in', () => {
    const t = (key: string) => ({
      'error.transport': 'restart',
      'error.unknown': 'unknown',
      'error.busy': 'busy',
    })[key] ?? key
    expect(errorText(new ClientRpcError('unknown', 'rpc.failed', { method: 'getState', status: 405 }), t)).toBe('restart')
    expect(errorText(new ClientRpcError('busy', 'busy'), t)).toBe('busy')
    expect(errorText(new Error('offline'), t)).toBe('unknown')
  })
})

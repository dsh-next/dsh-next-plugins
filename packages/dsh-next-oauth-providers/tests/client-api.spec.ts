import { describe, expect, it } from 'vitest'
import { ClientRpcError, createRpc } from '../src/client/api.ts'

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

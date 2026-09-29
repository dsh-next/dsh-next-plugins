import { describe, expect, it, vi } from 'vitest'
import { createApi } from '../src/client/api.ts'
import { RPC_PATH } from '../src/core/types.ts'

const provider = { id: 'local', name: 'Local', baseUrl: 'http://127.0.0.1:8009/v1', models: [{ id: 'kev-4b', name: 'Friendly choice', contextWindow: 128_000 }, { id: 'plain' }], keyConfigured: false }
const state = { providers: [provider], writable: true, revision: 'r1' }
function fixture(value: unknown, ok = true) {
  const fetch = vi.fn().mockResolvedValue({ ok, json: async () => value })
  return { fetch, api: createApi(fetch as unknown as typeof globalThis.fetch) }
}
describe('decision RPC client', () => {
  it('sends same-origin POSTs with explicit models and cancellation', async () => {
    const { api, fetch } = fixture({ ok: true, value: state })
    const signal = new AbortController().signal
    expect(await api.state(signal)).toEqual(state)
    const { keyConfigured: _key, ...config } = provider
    const change = { provider: config, mode: 'create' as const, revision: 'r0' }
    expect(await api.save(change, signal)).toEqual(state)
    expect(await api.remove('local', 'r1', signal)).toEqual(state)
    expect(fetch).toHaveBeenCalledTimes(3)
    for (const [url, init] of fetch.mock.calls) {
      expect(url).toBe(RPC_PATH); expect(init.method).toBe('POST'); expect(init.headers).toEqual({ 'content-type': 'application/json' }); expect(init.signal).toBe(signal)
    }
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ method: 'state' })
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ method: 'save', args: change })
    expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual({ method: 'remove', args: { id: 'local', revision: 'r1' } })
  })
  it('normalizes legacy rows on the wire and returns detached canonical provider models', async () => {
    const legacy = { id: 'local', name: 'Local', baseUrl: provider.baseUrl, modelIds: ['old-one', 'old-two'], keyConfigured: true }
    const { api } = fixture({ ok: true, value: { ...state, providers: [legacy] } })
    const parsed = await api.state()
    expect(parsed).toEqual({ ...state, providers: [{ ...provider, models: [{ id: 'old-one' }, { id: 'old-two' }], keyConfigured: true }] })
    expect(Object.hasOwn(parsed.providers[0], 'modelIds')).toBe(false)
    legacy.modelIds[0] = 'caller-edit'
    expect(parsed.providers[0].models[0].id).toBe('old-one')
  })
  it('tests a saved model ID without discovery', async () => {
    const value = { model: 'kev-4b', elapsedMs: 12 }
    const { api, fetch } = fixture({ ok: true, value })
    expect(await api.test('local', 'kev-4b')).toEqual(value)
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ method: 'test', args: { providerId: 'local', modelId: 'kev-4b' } })
  })
  it.each([
    null, {}, { ok: true }, { ok: false, error: { code: 'unknown-private-detail' } },
    { ok: false }, { ok: true, value: {} }, { ok: true, value: { ...state, providers: null } },
    { ok: true, value: { ...state, providers: [{ ...provider, keyConfigured: 'yes' }] } },
    { ok: true, value: { ...state, providers: [{ ...provider, apiKey: 'leak' }] } },
    { ok: true, value: { ...state, providers: [{ ...provider, models: [{ id: 'kev', contextWindow: 1_000_001 }] }] } },
    { ok: true, value: { ...state, providers: [{ ...provider, models: [{ id: 'kev', maxOutputTokens: 10 }] }] } },
    { ok: true, value: { ...state, providers: [{ ...provider, models: [{ id: 'kev', name: 'bad\nname' }] }] } },
  ])('rejects malformed envelopes/state without exposing raw details: %j', async value => {
    const { api } = fixture(value)
    await expect(api.state()).rejects.toBeInstanceOf(Error)
  })
  it('preserves known error codes, rejects successful-looking HTTP failures, and handles invalid JSON', async () => {
    await expect(fixture({ ok: false, error: { code: 'origin' } }, false).api.state()).rejects.toMatchObject({ code: 'origin' })
    await expect(fixture({ ok: true, value: state }, false).api.state()).rejects.toMatchObject({ code: 'failed' })
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => { throw new Error('private response') } })
    await expect(createApi(fetch as unknown as typeof globalThis.fetch).state()).rejects.toMatchObject({ code: 'failed' })
  })
  it.each([null, {}, { model: 'm', elapsedMs: -1 }, { model: 'm', elapsedMs: NaN }, { model: 'm', elapsedMs: Infinity }, { model: 1, elapsedMs: 1 }])('rejects invalid test summaries: %j', async value => {
    await expect(fixture({ ok: true, value }).api.test('local', 'kev')).rejects.toMatchObject({ code: 'failed' })
  })
})

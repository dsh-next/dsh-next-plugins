
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AGENTLESS, HEADER_NAME, OPENCODE_GO_ORIGIN, applySessionHeaderPatch, requestUrl, sessionValueFor } from '../src/host/session-header.ts'

/** Capture fetch calls through a fake globalThis.fetch. */
function captureFetch(): { calls: Array<{ input: RequestInfo | URL; init: RequestInit | undefined }>; restore: () => void } {
  const calls: Array<{ input: RequestInfo | URL; init: RequestInit | undefined }> = []
  const original = globalThis.fetch
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input, init })
    return Promise.resolve(new Response('{}'))
  }) as typeof fetch
  return { calls, restore: () => { globalThis.fetch = original } }
}

describe('constants', () => {
  it('uses the OpenCode Go header and origin', () => {
    expect(HEADER_NAME).toBe('x-opencode-session')
    expect(OPENCODE_GO_ORIGIN).toBe('https://opencode.ai/zen/go')
    expect(AGENTLESS).toBe('dsh')
  })
})

describe('requestUrl', () => {
  it('extracts the URL from every fetch input form', () => {
    expect(requestUrl('https://example.com')).toBe('https://example.com')
    expect(requestUrl(new URL('https://example.com'))).toBe('https://example.com/') // URL normalizes the href
    expect(requestUrl(new Request('https://example.com'))).toBe('https://example.com/') // Request normalizes the url
  })
})

describe('sessionValueFor', () => {
  it('uses the initiator session id', () => {
    expect(sessionValueFor(() => ({ id: 'session-123' }))).toBe('session-123')
  })

  it('falls back to the agentless id outside an initiator boundary', () => {
    expect(sessionValueFor(() => undefined)).toBe('dsh')
  })

  it('falls back when the registry refuses reads after disposal', () => {
    expect(sessionValueFor(() => { throw new Error('disposed') })).toBe('dsh')
  })

  it('stringifies non-string ids', () => {
    expect(sessionValueFor(() => ({ id: 42 as unknown as string }))).toBe('42')
  })
})

describe('applySessionHeaderPatch', () => {
  const cleanups: Array<() => void> = []
  afterEach(() => { for (const c of cleanups.splice(0)) c() })

  function setup(initiator?: { id: string }) {
    const agents = { currentInitiator: () => initiator }
    const log = vi.fn()
    const { calls, restore } = captureFetch()
    cleanups.push(restore)
    const dispose = applySessionHeaderPatch(agents, log)
    cleanups.push(dispose)
    return { log, calls }
  }

  it('stamps x-opencode-session on opencode-go requests (string URL form)', async () => {
    const { log, calls } = setup({ id: 'session-abc' })
    await globalThis.fetch('https://opencode.ai/zen/go/chat/completions', { method: 'POST', headers: { authorization: 'Bearer k' } })
    expect(calls).toHaveLength(1)
    expect(new Headers(calls[0]!.init?.headers).get('x-opencode-session')).toBe('session-abc')
    expect(new Headers(calls[0]!.init?.headers).get('authorization')).toBe('Bearer k')
    expect(log).toHaveBeenCalledWith('opencode-go: x-opencode-session: session-abc')
  })

  it('passes requests to other endpoints through untouched', async () => {
    const { calls } = setup({ id: 'session-abc' })
    await globalThis.fetch('https://api.deepseek.com/chat/completions', { method: 'POST', headers: {} })
    expect(calls).toHaveLength(1)
    expect(new Headers(calls[0]!.init?.headers).get('x-opencode-session')).toBeNull()
  })

  it('stamps the fallback id when no initiator is active', async () => {
    const { calls } = setup(undefined)
    await globalThis.fetch('https://opencode.ai/zen/go/v1/messages', { method: 'POST' })
    expect(new Headers(calls[0]!.init?.headers).get('x-opencode-session')).toBe('dsh')
  })

  it('stamps the header on Request-object form without init', async () => {
    const request = new Request('https://opencode.ai/zen/go/chat/completions', {
      method: 'POST',
      headers: { authorization: 'Bearer k' },
      body: '{"x":1}',
    })
    const { calls } = setup({ id: 'session-req' })
    await globalThis.fetch(request)
    expect(calls).toHaveLength(1)
    const sent = calls[0]!.input as Request
    expect(sent.headers.get('x-opencode-session')).toBe('session-req')
    expect(sent.headers.get('authorization')).toBe('Bearer k')
  })

  it('restores the original fetch on dispose', () => {
    const original = globalThis.fetch
    const dispose = applySessionHeaderPatch({ currentInitiator: () => undefined }, () => {})
    expect(globalThis.fetch).not.toBe(original)
    dispose()
    expect(globalThis.fetch).toBe(original)
  })
})

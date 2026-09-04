import { describe, expect, it } from 'vitest'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import { Notifier } from '../src/host/notifier.ts'
import { registerRpc } from '../src/host/rpc.ts'
import type { NotifierConfig } from '../src/core/types.ts'

/**
 * Settings-chasing round-trip: drives the real `registerRpc` HTTP wire path
 * with a fake webServer that captures the raw handler, so we prove that a
 * browser `setConfig` POST persists through the settings scope and a follow-up
 * `getState` returns the updated envelope. This is the exact "does saving a
 * setting actually stick" path — the class of bug where the card renders but
 * edits never persist or never reflect back.
 */

/** Minimal SettingsScope that stores one section and reports writes. */
function fakeScope(initial: Partial<NotifierConfig> | null): { scope: SettingsScope<NotifierConfig>; stored: () => unknown; lastPatch: () => unknown } {
  let stored: unknown = initial
  let lastPatch: unknown = null
  return {
    stored: () => stored,
    lastPatch: () => lastPatch,
    scope: {
      get: () => stored,
      update: async (patch: unknown) => { lastPatch = patch; stored = patch; return stored },
    } as unknown as SettingsScope<NotifierConfig>,
  }
}

/** An IncomingMessage-alike that emits a POST body and signals end. */
function requestWithBody(body: string): { method: string; on: (ev: string, cb: (d?: unknown) => void) => void; destroy: () => void } {
  let dataCb: ((d: unknown) => void) | null = null
  let endCb: (() => void) | null = null
  const stream = {
    method: 'POST',
    on: (ev: string, cb: (d?: unknown) => void) => {
      if (ev === 'data') dataCb = cb
      if (ev === 'end') endCb = cb
      return stream
    },
    destroy: () => {},
  }
  // Emit synchronously after registration (tests call resolve immediately).
  setTimeout(() => { dataCb?.(body); endCb?.() }, 0)
  return stream
}

function makeResponse(): { res: Record<string, unknown>; json: () => unknown; status: () => number } {
  let statusCode = 200
  let bodyText = ''
  return {
    res: {
      writeHead: (code: number) => { statusCode = code },
      end: (data: string) => { bodyText = String(data ?? '') },
      writableEnded: false,
    },
    json: () => JSON.parse(bodyText || '{}'),
    status: () => statusCode,
  }
}

function registerAndCapture(scope: ReturnType<typeof fakeScope>['scope']): {
  post: (method: string, args: unknown) => Promise<unknown>
  notifier: Notifier
} {
  const notifier = new Notifier({ ctx: { get: () => undefined } as never, scope, timer: undefined, goals: undefined })
  let captured: ((req: unknown, res: unknown) => void) | null = null
  registerRpc(
    {
      get: (name: string) => {
        if (name === 'webServer') return { register: (spec: unknown) => { captured = (spec as { handler: unknown }).handler as never; return () => {} } }
        if (name === 'settings') return { writable: true }
        return undefined
      },
      effect: () => {},
    } as never,
    notifier,
    scope,
  )
  const post = (method: string, args: unknown): Promise<unknown> => {
    const { res, json, status } = makeResponse()
    const req = requestWithBody(JSON.stringify({ method, args }))
    captured!(req, res)
    return new Promise((resolve) => setTimeout(() => resolve({ json: json(), status: status() }), 10))
  }
  return { post, notifier }
}

describe('registerRpc settings round-trip', () => {
  it('setConfig persists through the scope and getState returns the update', async () => {
    const { scope } = fakeScope(null)
    const { post } = registerAndCapture(scope)

    const setResult = await post('setConfig', { volume: 35, finished: { soundName: 'bell' } })
    const envelope = (setResult as { json: { config: NotifierConfig } }).json
    expect(envelope.config.volume).toBe(35)
    expect(envelope.config.finished.soundName).toBe('bell')

    const getResult = (await post('getState', null)) as { json: { config: NotifierConfig } }
    expect(getResult.json.config.volume).toBe(35)
    expect(getResult.json.config.finished.soundName).toBe('bell')
  })

  it('a follow-up getState reflects the stored section (persistence, not just a reply)', async () => {
    const { scope } = fakeScope(null)
    const { post } = registerAndCapture(scope)
    await post('setConfig', { enabled: false })
    // Re-read the scope directly — the write must have landed in storage.
    expect((scope.get() as { enabled: boolean }).enabled).toBe(false)
  })

  it('getState returns the full envelope on a fresh notifier', async () => {
    const { scope } = fakeScope(null)
    const { post } = registerAndCapture(scope)
    const result = (await post('getState', null)) as { json: { config: NotifierConfig; sounds: unknown[]; platform: string | null; webPermission: string | null } }
    expect(result.json).toHaveProperty('config')
    expect(result.json).toHaveProperty('sounds')
    expect(result.json.sounds.length).toBe(17)
  })

  it('getPendingNotifications accepts a channel arg and returns an empty list', async () => {
    const { scope } = fakeScope(null)
    const { post } = registerAndCapture(scope)
    for (const channel of ['toast', 'web']) {
      const result = (await post('getPendingNotifications', { channel })) as { json: unknown[] }
      expect(Array.isArray(result.json)).toBe(true)
      expect(result.json).toEqual([])
    }
    // An unscoped call stays supported (legacy: drains everything).
    const legacy = (await post('getPendingNotifications', null)) as { json: unknown[] }
    expect(legacy.json).toEqual([])
  })
})

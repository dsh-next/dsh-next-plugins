import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it } from 'vitest'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import { Notifier } from '../src/host/notifier.ts'
import { registerRpc } from '../src/host/rpc.ts'
import { defaultConfig } from '../src/core/config.ts'
import type { ClientPresence } from '../src/core/notifications.ts'
import type { NotifierConfig } from '../src/core/types.ts'

/** Model the settings service's partial/deep update, not whole-section replacement. */
function fakeScope() {
  let stored = defaultConfig()
  let lastPatch: Record<string, unknown> = {}
  const scope = {
    get: () => stored,
    update: async (patch: Record<string, unknown>) => {
      lastPatch = patch
      const next = { ...stored, ...patch }
      for (const key of ['finished', 'approval', 'question'] as const) {
        if (patch[key]) next[key] = { ...stored[key], ...patch[key] as object }
      }
      stored = next
      return stored
    },
  } as unknown as SettingsScope<NotifierConfig>
  return { scope, lastPatch: () => lastPatch }
}

function registerAndCapture(scope: SettingsScope<NotifierConfig>) {
  const notifier = new Notifier({
    ctx: { get: () => undefined } as never, scope,
    timer: { timeout: () => () => {}, interval: () => () => {} }, goals: undefined,
  })
  let handler: (req: IncomingMessage, res: ServerResponse) => void
  registerRpc({
    get: (name: string) => {
      if (name === 'webServer') return { register: (spec: { handler: typeof handler }) => { handler = spec.handler; return () => {} } }
      if (name === 'settings') return { writable: true }
      return undefined
    },
    effect: () => {},
  } as never, notifier, scope)
  const post = (method: string, args: unknown): Promise<{ status: number; json: ReturnType<Notifier['state']> }> => new Promise((resolve) => {
    const req = Object.assign(new EventEmitter(), { method: 'POST' })
    let status = 0
    const res = Object.assign(new EventEmitter(), {
      writableEnded: false,
      writeHead: (code: number) => { status = code },
      end: (body: string) => { res.writableEnded = true; resolve({ status, json: JSON.parse(body) }) },
    })
    handler(req as IncomingMessage, res as unknown as ServerResponse)
    req.emit('data', Buffer.from(JSON.stringify({ method, args })))
    req.emit('end')
  })
  return { post, notifier }
}

const report: ClientPresence = {
  clientId: 'tab-a', sequence: 0, focused: true, visible: true, open: true,
  sessionId: 'session-a', permission: 'granted',
}

describe('registerRpc settings round-trip', () => {
  it('persists config and returns the full browser envelope', async () => {
    const { scope } = fakeScope()
    const { post } = registerAndCapture(scope)
    const result = await post('setConfig', { volume: 35, finished: { soundName: 'bell' } })
    expect(result.status).toBe(200)
    expect(Object.keys(result.json).sort()).toEqual(['config', 'platform', 'sounds', 'webPermission'])
    expect(result.json.config.volume).toBe(35)
    expect(result.json.config.finished.soundName).toBe('bell')
    const reread = await post('getState', null)
    expect(reread.status).toBe(200)
    expect(reread.json.config).toEqual(result.json.config)
    expect(scope.get()).toEqual(result.json.config)
  })

  it('sends only the partial patch and preserves unrelated saved fields', async () => {
    const { scope, lastPatch } = fakeScope()
    const { post } = registerAndCapture(scope)
    await post('setConfig', { volume: 15, finished: { sound: false }, approval: { enabled: false } })
    const result = await post('setConfig', { clientId: 'tab-a', finished: { soundName: 'bell' }, ignored: 'discard' })
    expect(result.status).toBe(200)
    expect(lastPatch()).toEqual({ finished: { soundName: 'bell' } })
    expect(result.json.config.volume).toBe(15)
    expect(result.json.config.finished.sound).toBe(false)
    expect(result.json.config.finished.soundName).toBe('bell')
    expect(result.json.config.approval.enabled).toBe(false)
  })

  it('returns the sound catalog and normalized defaults on a fresh notifier', async () => {
    const { post } = registerAndCapture(fakeScope().scope)
    const result = await post('getState', null)
    expect(result.status).toBe(200)
    expect(result.json.config).toEqual(defaultConfig())
    expect(result.json.sounds).toHaveLength(17)
  })

  it('reports presence before claiming deliveries and returns client-scoped state', async () => {
    const { post, notifier } = registerAndCapture(fakeScope().scope)
    const result = await post('getPendingNotifications', report)
    expect(result.status).toBe(200)
    expect(result.json).toEqual([])
    expect(notifier.getPresence('tab-a')).toMatchObject({ sessionId: 'session-a', permission: 'granted' })
    const state = await post('getState', { clientId: 'tab-a' })
    expect(state.json.webPermission).toBe('granted')
    const saved = await post('setConfig', { clientId: 'tab-a', enabled: false })
    expect(saved.json.webPermission).toBe('granted')
    expect(saved.json.config.enabled).toBe(false)
  })

  it('rejects old unowned drains rather than consuming another client queue', async () => {
    const { post } = registerAndCapture(fakeScope().scope)
    for (const args of [null, { channel: 'toast' }, { channel: 'web' }]) {
      expect((await post('getPendingNotifications', args)).status).toBe(400)
    }
  })
})

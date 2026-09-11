import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Notifier } from '../src/host/notifier.ts'
import { SoundDriver } from '../src/host/sound-driver.ts'
import { defaultConfig } from '../src/core/config.ts'
import type { ClientPresence } from '../src/core/notifications.ts'
import type { TimerLike } from '../src/core/timer.ts'

const timer: TimerLike = {
  timeout: (fn, delay) => { const id = setTimeout(fn, delay); return () => clearTimeout(id) },
  interval: (fn, delay) => { const id = setInterval(fn, delay); return () => clearInterval(id) },
}
const report = (overrides: Partial<ClientPresence> = {}): ClientPresence => ({ clientId: 'browser', sequence: 1, focused: true, visible: true, open: true, sessionId: 'viewed', permission: 'denied', ...overrides })
function makeNotifier() {
  const handlers = new Map<string, (...args: never[]) => unknown>()
  const config = defaultConfig()
  const scope = { get: () => config } as never
  const ctx = { get: () => undefined, on: (name: string, fn: (...args: never[]) => unknown) => { handlers.set(name, fn); return () => handlers.delete(name) } } as never
  const notifier = new Notifier({ ctx, scope, timer, goals: undefined })
  notifier.wire()
  const complete = (sessionId = 'agent') => {
    handlers.get('goal/changed')!({ agent: { status: 'idle', session: { id: sessionId, header: {} } }, change: { operation: 'complete', ref: { id: 'goal-' + sessionId, revision: 1 } } } as never)
    vi.advanceTimersByTime(2000)
  }
  return { notifier, complete, config, handlers }
}
beforeEach(() => vi.useFakeTimers())
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

describe('notifier state RPC envelope', () => {
  it('returns the complete envelope rather than raw config', () => {
    const { notifier } = makeNotifier()
    const state = notifier.state()
    expect(Object.keys(state).sort()).toEqual(['config', 'platform', 'sounds', 'webPermission'])
    expect(state.config).toEqual(defaultConfig())
    expect(state).not.toHaveProperty('enabled')
    expect(state).not.toHaveProperty('volume')
    expect(state.platform).toBeNull()
    expect(state.webPermission).toBeNull()
  })
  it('returns the full sound catalog and client-specific permission', () => {
    const { notifier } = makeNotifier()
    notifier.reportPresence(report())
    notifier.reportPresence(report({ clientId: 'other', permission: 'granted' }))
    expect(notifier.state('browser').webPermission).toBe('denied')
    expect(notifier.state('other').webPermission).toBe('granted')
    expect(notifier.state().sounds).toHaveLength(17)
    expect(notifier.state().sounds.find(s => s.id === 'chime')).toEqual({ id: 'chime', name: 'Chime', group: 'Chimes' })
    for (const sound of notifier.state().sounds) expect(Object.keys(sound).sort()).toEqual(['group', 'id', 'name'])
  })
})

describe('leased notification contract', () => {
  it('queues a typed delivery but sounds only after successful acknowledgement, exactly once', () => {
    const play = vi.spyOn(SoundDriver.prototype, 'play').mockReturnValue(true)
    const { notifier, complete } = makeNotifier()
    notifier.reportPresence(report())
    complete()
    expect(play).not.toHaveBeenCalled()
    const [event] = notifier.claimPending('browser')
    expect(event).toMatchObject({ kind: 'goal-complete', sessionId: 'agent', title: 'Goal completed', id: expect.any(String), lease: expect.any(String), at: expect.any(Number) })
    expect(event).not.toHaveProperty('channel')
    const receipt = { clientId: 'browser', id: event.id, lease: event.lease }
    expect(notifier.acknowledge(receipt)).toBe(true)
    expect(notifier.acknowledge(receipt)).toBe(false)
    expect(play).toHaveBeenCalledTimes(1)
    expect(notifier.claimPending('browser')).toEqual([])
  })
  it('retains an undeliverable background notification for a foreground toast', () => {
    const { notifier, complete } = makeNotifier()
    notifier.reportPresence(report({ focused: false, visible: false }))
    complete()
    expect(notifier.claimPending('browser')).toEqual([])
    notifier.reportPresence(report({ sequence: 2 }))
    expect(notifier.claimPending('browser')).toHaveLength(1)
  })
  it('delivers in background when permission is granted', () => {
    const { notifier, complete } = makeNotifier()
    notifier.reportPresence(report({ focused: false, visible: false, permission: 'granted' }))
    complete()
    expect(notifier.claimPending('browser')).toHaveLength(1)
  })
  it('suppresses the exact viewed session and does not sound', () => {
    const play = vi.spyOn(SoundDriver.prototype, 'play')
    const { notifier, complete } = makeNotifier()
    notifier.reportPresence(report({ sessionId: 'agent' }))
    complete()
    expect(notifier.claimPending('browser')).toEqual([])
    expect(play).not.toHaveBeenCalled()
  })
  it('releases failed rendering without a sound and permits retry', () => {
    const play = vi.spyOn(SoundDriver.prototype, 'play')
    const { notifier, complete } = makeNotifier()
    notifier.reportPresence(report())
    complete()
    const [first] = notifier.claimPending('browser')
    notifier.release({ clientId: 'browser', id: first.id, lease: first.lease })
    expect(notifier.claimPending('browser')).toEqual([])
    vi.advanceTimersByTime(10000)
    notifier.reportPresence(report({ sequence: 2 }))
    expect(notifier.claimPending('browser')[0].id).toBe(first.id)
    expect(play).not.toHaveBeenCalled()
  })
  it('rechecks mute, zero volume, and disabled config before sound', () => {
    for (const mode of ['zero', 'sound', 'disabled']) {
      const play = vi.spyOn(SoundDriver.prototype, 'play').mockReturnValue(true)
      const { notifier, complete, config } = makeNotifier()
      notifier.reportPresence(report())
      complete()
      const [event] = notifier.claimPending('browser')
      if (mode === 'zero') config.volume = 0
      if (mode === 'sound') config.finished.sound = false
      if (mode === 'disabled') config.enabled = false
      notifier.acknowledge({ clientId: 'browser', id: event.id, lease: event.lease })
      expect(play).not.toHaveBeenCalled()
      play.mockRestore()
    }
  })
  it('detects sound platform, waits for preview preparation and cleans up', async () => {
    const detect = vi.spyOn(SoundDriver.prototype, 'detect').mockResolvedValue({ afplay: '/usr/bin/afplay', win: null, sh: '/bin/sh', paplay: null, aplay: null })
    const ensure = vi.spyOn(SoundDriver.prototype, 'ensureSounds').mockResolvedValue('/tmp/test')
    const play = vi.spyOn(SoundDriver.prototype, 'play').mockReturnValue(true)
    const dispose = vi.spyOn(SoundDriver.prototype, 'dispose').mockResolvedValue()
    const { notifier, handlers } = makeNotifier()
    await notifier.start()
    expect(detect).toHaveBeenCalledTimes(1)
    expect(notifier.state().platform).toBe('macos')
    expect(await notifier.preview('chime')).toBe(true)
    expect(ensure).toHaveBeenCalledTimes(2)
    expect(play).toHaveBeenCalledTimes(1)
    notifier.wire()
    await notifier.dispose()
    expect(handlers.size).toBe(0)
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(await notifier.preview('chime')).toBe(false)
  })
})

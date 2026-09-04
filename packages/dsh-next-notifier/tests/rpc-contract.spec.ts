import { describe, expect, it } from 'vitest'
import { Notifier } from '../src/host/notifier.ts'

/**
 * RPC contract test: the Host's `state()` must return the full browser-facing
 * envelope, not the raw config. This pins the regression where `getState`
 * returned the bare NotifierConfig and the client's `snap.config` read came
 * back undefined, hiding the settings-card body.
 */

function makeNotifier(): Notifier {
  return new Notifier({
    ctx: {
      get: () => undefined,
    } as never,
    scope: null,
    timer: undefined,
    goals: undefined,
  })
}

/** A Notifier with wire() active against a captured listener table. */
function wiredNotifier(): { notifier: Notifier; emit: (event: string, payload: unknown) => Promise<unknown> | void } {
  const listeners = new Map<string, (payload: unknown, next?: unknown) => unknown>()
  const ctx = {
    get: () => undefined,
    on: (event: string, handler: unknown) => {
      listeners.set(event, handler as never)
      return () => { listeners.delete(event) }
    },
  } as never
  const notifier = new Notifier({ ctx, scope: null, timer: undefined, goals: undefined })
  notifier.wire()
  return {
    notifier,
    emit: (event: string, payload: unknown) => {
      const handler = listeners.get(event)
      if (!handler) throw new Error('no listener wired for ' + event)
      return handler(payload, () => Promise.resolve()) as Promise<unknown> | void
    },
  }
}

function goalComplete(sessionId: string): unknown {
  return { agent: { session: { id: sessionId } }, change: { operation: 'complete' } }
}

describe('notifier state() RPC contract', () => {
  it('returns the envelope, not the raw config', () => {
    const n = makeNotifier()
    const state = n.state()
    // The envelope carries these keys; the earlier bug returned the config's
    // own keys (enabled/suppressFocused/volume/finished/...) instead.
    expect(state).toHaveProperty('config')
    expect(state).toHaveProperty('platform')
    expect(state).toHaveProperty('webPermission')
    expect(state).toHaveProperty('sounds')
    // The raw config keys must NOT sit at the envelope's top level.
    expect(state).not.toHaveProperty('enabled')
    expect(state).not.toHaveProperty('volume')
  })

  it('envelope.config is the normalized config with group defaults', () => {
    const n = makeNotifier()
    const config = n.state().config
    expect(config.enabled).toBe(true)
    expect(config.volume).toBe(70)
    expect(config.finished.soundName).toBe('chime')
    expect(config.approval.soundName).toBe('ping')
    expect(config.question.soundName).toBe('chirp')
  })

  it('envelope.sounds is the full catalog as {id, name, group}', () => {
    const sounds = makeNotifier().state().sounds
    expect(sounds.length).toBe(17)
    const chime = sounds.find((s) => s.id === 'chime')
    expect(chime).toEqual({ id: 'chime', name: 'Chime', group: 'Chimes' })
    // Every entry is exactly the {id, name, group} shape the card renders.
    for (const s of sounds) {
      expect(Object.keys(s).sort()).toEqual(['group', 'id', 'name'])
    }
  })

  it('platform and webPermission default to null before detection', () => {
    const state = makeNotifier().state()
    expect(state.platform).toBeNull()
    expect(state.webPermission).toBeNull()
  })

  it('reflects the reported browser notification permission', () => {
    const n = makeNotifier()
    n.reportWebPermission('granted')
    expect(n.state().webPermission).toBe('granted')
  })
})

describe('pending queue RPC contract (getPendingNotifications)', () => {
  it('routes an event to the toast channel while the page is being viewed', () => {
    const { notifier, emit } = wiredNotifier()
    notifier.reportPresence({ focused: true, visible: true, open: true, sessionId: 's1' })
    // Permission is irrelevant for the toast channel.
    notifier.reportWebPermission('denied')
    emit('goal/changed', goalComplete('s2'))
    const [item] = notifier.drainPending()
    expect(item).toBeDefined()
    expect(item.kind).toBe('goal-complete')
    expect(item.channel).toBe('toast')
    expect(item.sessionId).toBe('s2')
  })

  it('routes an event to the web channel while the page is out of sight', () => {
    const { notifier, emit } = wiredNotifier()
    notifier.reportPresence({ focused: false, visible: false, open: true, sessionId: 's1' })
    notifier.reportWebPermission('granted')
    emit('goal/changed', goalComplete('s2'))
    const [item] = notifier.drainPending()
    expect(item).toBeDefined()
    expect(item.channel).toBe('web')
  })

  it('drops a backgrounded event when the browser permission is missing', () => {
    const { notifier, emit } = wiredNotifier()
    notifier.reportPresence({ focused: false, visible: false, open: true, sessionId: 's1' })
    notifier.reportWebPermission('denied')
    emit('goal/changed', goalComplete('s2'))
    expect(notifier.drainPending()).toEqual([])
  })

  it('keeps the queue quiet for the session the user is viewing', () => {
    const { notifier, emit } = wiredNotifier()
    notifier.reportPresence({ focused: true, visible: true, open: true, sessionId: 's2' })
    notifier.reportWebPermission('granted')
    emit('goal/changed', goalComplete('s2'))
    expect(notifier.drainPending()).toEqual([])
  })

  it('drains the queue exactly once', () => {
    const { notifier, emit } = wiredNotifier()
    notifier.reportPresence({ focused: true, visible: true, open: true, sessionId: 's1' })
    notifier.reportWebPermission('granted')
    emit('goal/changed', goalComplete('s2'))
    expect(notifier.drainPending()).toHaveLength(1)
    expect(notifier.drainPending()).toEqual([])
  })

  it('channel-scoped drains leave the other channel in the queue', () => {
    const { notifier, emit } = wiredNotifier()
    notifier.reportWebPermission('granted')
    notifier.reportPresence({ focused: true, visible: true, open: true, sessionId: 's1' })
    emit('goal/changed', goalComplete('s2')) // toast
    notifier.reportPresence({ focused: false, visible: false, open: true, sessionId: 's1' })
    emit('goal/changed', goalComplete('s3')) // web
    const toasts = notifier.drainPending('toast')
    expect(toasts).toHaveLength(1)
    expect(toasts[0].channel).toBe('toast')
    expect(toasts[0].sessionId).toBe('s2')
    const web = notifier.drainPending('web')
    expect(web).toHaveLength(1)
    expect(web[0].channel).toBe('web')
    expect(web[0].sessionId).toBe('s3')
    expect(notifier.drainPending()).toEqual([])
  })
})

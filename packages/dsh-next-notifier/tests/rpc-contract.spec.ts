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

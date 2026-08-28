import { describe, expect, it } from 'vitest'
import { notifierSchema } from '../src/core/schema.ts'
import { SOUND_IDS } from '../src/core/sounds.ts'

/**
 * Schemastery schema contract: the schema is the single source of truth for
 * defaults and the sound-name union. These tests pin that a stored section
 * resolves to sane defaults and that unknown sound ids are rejected (not
 * silently accepted), which is what keeps the settings card and host config
 * in lockstep.
 */
describe('notifierSchema', () => {
  it('resolves an empty object to the documented defaults', () => {
    const resolved = notifierSchema({})
    expect(resolved.enabled).toBe(true)
    expect(resolved.suppressFocused).toBe(true)
    expect(resolved.volume).toBe(70)
    expect(resolved.notificationSeconds).toBe(12)
    expect(resolved.finished.soundName).toBe('chime')
    expect(resolved.approval.soundName).toBe('ping')
    expect(resolved.question.soundName).toBe('chirp')
    // All three groups expose the one uniform NotifyGroup shape.
    for (const key of ['finished', 'approval', 'question'] as const) {
      expect(resolved[key]).toHaveProperty('enabled')
      expect(resolved[key]).toHaveProperty('sound')
      expect(resolved[key]).toHaveProperty('soundName')
      expect(resolved[key]).toHaveProperty('subagent')
      expect(resolved[key]).toHaveProperty('goalOnly')
    }
  })

  it('accepts every catalog sound id as a valid soundName', () => {
    for (const id of SOUND_IDS) {
      const resolved = notifierSchema({ finished: { soundName: id } })
      expect(resolved.finished.soundName).toBe(id)
    }
  })

  it('rejects an unknown sound id (falls back to the group default)', () => {
    // Schemastery unions reject a value outside the enum; the settings layer
    // normalizes back to the default. Assert the enum does not silently keep
    // a bogus id.
    expect(() => notifierSchema({ finished: { soundName: 'not-a-sound' } })).toThrow()
  })

  it('clamps volume to the declared 0..100 range', () => {
    expect(() => notifierSchema({ volume: -1 })).toThrow()
    expect(() => notifierSchema({ volume: 101 })).toThrow()
    expect(notifierSchema({ volume: 50 }).volume).toBe(50)
  })

  it('enforces notification-seconds within the declared 3..60 range', () => {
    expect(() => notifierSchema({ notificationSeconds: 2 })).toThrow()
    expect(() => notifierSchema({ notificationSeconds: 61 })).toThrow()
    expect(notifierSchema({ notificationSeconds: 30 }).notificationSeconds).toBe(30)
  })
})

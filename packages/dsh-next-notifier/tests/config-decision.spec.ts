import { describe, expect, it } from 'vitest'
import { cleanPatch, defaultConfig, normalizeConfig } from '../src/core/config.ts'
import { decide, isPageAlive, isViewingSession, type Presence } from '../src/core/decision.ts'
import type { NotifierConfig } from '../src/core/types.ts'

const MAX_AGE = 25000

function cfg(overrides: Partial<NotifierConfig> = {}): NotifierConfig {
  return { ...defaultConfig(), ...overrides }
}

const livePresence: Presence = { focused: true, visible: true, open: true, sessionId: 's1' }

describe('normalizeConfig', () => {
  it('fills defaults for an empty section', () => {
    const c = normalizeConfig({})
    expect(c.enabled).toBe(true)
    expect(c.suppressFocused).toBe(true)
    expect(c.volume).toBe(70)
    expect(c.finished.enabled).toBe(true)
    expect(c.finished.goalOnly).toBe(true)
    expect(c.finished.subagent).toBe(false)
    expect(c.finished.soundName).toBe('chime')
    expect(c.approval.soundName).toBe('ping')
    expect(c.question.soundName).toBe('chirp')
  })

  it('rejects an unknown sound name back to the group default', () => {
    const c = normalizeConfig({ approval: { soundName: 'not-a-sound' } })
    expect(c.approval.soundName).toBe('ping')
  })

  it('clamps volume to 0..100', () => {
    expect(normalizeConfig({ volume: -5 }).volume).toBe(0)
    expect(normalizeConfig({ volume: 999 }).volume).toBe(100)
  })

  it('legacy boolean group shorthand maps enabled only', () => {
    const c = normalizeConfig({ finished: false })
    expect(c.finished.enabled).toBe(false)
    expect(c.finished.soundName).toBe('chime')
  })
})

describe('cleanPatch', () => {
  it('keeps only JSON-safe recognized fields', () => {
    const p = cleanPatch({ enabled: false, volume: 42, finished: { subagent: true }, bogus: 1 })
    expect(p.enabled).toBe(false)
    expect(p.volume).toBe(42)
    expect(p.finished).toEqual({ subagent: true })
    expect('bogus' in p).toBe(false)
  })
})

describe('isPageAlive / isViewingSession', () => {
  it('treats a stale report as dead', () => {
    expect(isPageAlive(livePresence, MAX_AGE + 1, MAX_AGE)).toBe(false)
  })
  it('treats an open page as alive even when unfocused', () => {
    expect(isPageAlive({ focused: false, visible: false, open: true, sessionId: 's1' }, 1, MAX_AGE)).toBe(true)
  })
  it('requires focused + visible + matching session to be "viewing"', () => {
    expect(isViewingSession(livePresence, 1, MAX_AGE, 's1')).toBe(true)
    expect(isViewingSession(livePresence, 1, MAX_AGE, 'other')).toBe(false)
    expect(isViewingSession({ ...livePresence, focused: false }, 1, MAX_AGE, 's1')).toBe(false)
  })
})

describe('decide', () => {
  const base = {
    presence: livePresence,
    presenceAgeMs: 1000,
    title: 't', body: 'b', sessionId: 's1',
    group: 'finished' as const,
    subagentEnabled: false,
  }

  it('notifies when everything is enabled and page alive', () => {
    const d = decide({ ...base, config: cfg(), eventKind: 'finished' }, MAX_AGE, 'granted')
    expect(d.notify).toBe(true)
    expect(d.soundName).toBe('chime')
  })

  it('short-circuits on master disabled', () => {
    const d = decide({ ...base, config: cfg({ enabled: false }), eventKind: 'finished' }, MAX_AGE, 'granted')
    expect(d.notify).toBe(false)
    expect(d.reason).toBe('disabled')
  })

  it('drops when permission is not granted', () => {
    const d = decide({ ...base, config: cfg(), eventKind: 'finished' }, MAX_AGE, 'denied')
    expect(d.reason).toBe('permission-missing')
  })

  it('suppresses when viewing the session and suppressFocused is on', () => {
    const d = decide({ ...base, config: cfg({ suppressFocused: true }), eventKind: 'approval' }, MAX_AGE, 'granted')
    expect(d.reason).toBe('suppressed')
  })

  it('does not suppress when suppressFocused is off', () => {
    const d = decide({ ...base, config: cfg({ suppressFocused: false }), eventKind: 'approval' }, MAX_AGE, 'granted')
    expect(d.notify).toBe(true)
  })

  it('requires subagent opt-in for subagent events', () => {
    const d = decide({ ...base, config: cfg(), eventKind: 'subagent', subagentEnabled: false }, MAX_AGE, 'granted')
    expect(d.reason).toBe('subagent-opt-out')
  })

  it('notifies a subagent event when opt-in is enabled', () => {
    const d = decide(
      { ...base, config: cfg({ suppressFocused: false }), eventKind: 'subagent', subagentEnabled: true },
      MAX_AGE, 'granted',
    )
    expect(d.notify).toBe(true)
    expect(d.soundName).toBe('chime')
  })

  it('short-circuits when the target group is disabled', () => {
    const d = decide(
      { ...base, config: cfg({ finished: { ...defaultConfig().finished, enabled: false } }), eventKind: 'finished' },
      MAX_AGE, 'granted',
    )
    expect(d.notify).toBe(false)
    expect(d.reason).toBe('group-disabled')
  })

  it('drops when the page is dead (no recent presence)', () => {
    const d = decide(
      { ...base, config: cfg({ suppressFocused: false }), presence: null, presenceAgeMs: 99999, eventKind: 'finished' },
      MAX_AGE, 'granted',
    )
    expect(d.notify).toBe(false)
    expect(d.reason).toBe('page-dead')
  })

  it('goal-complete and goal-blocked reuse the finished group', () => {
    for (const eventKind of ['goal-complete', 'goal-blocked'] as const) {
      const d = decide(
        { ...base, config: cfg({ suppressFocused: false }), eventKind, group: 'finished' },
        MAX_AGE, 'granted',
      )
      expect(d.notify).toBe(true)
      expect(d.soundName).toBe('chime')
    }
  })

  it('a goal event respects the finished group disabled state', () => {
    const d = decide(
      { ...base, config: cfg({ finished: { ...defaultConfig().finished, enabled: false } }), eventKind: 'goal-complete', group: 'finished' },
      MAX_AGE, 'granted',
    )
    expect(d.reason).toBe('group-disabled')
  })

  it('soundName is null when the group sound is off', () => {
    const c = cfg({ suppressFocused: false, finished: { ...defaultConfig().finished, sound: false } })
    const d = decide({ ...base, config: c, eventKind: 'finished' }, MAX_AGE, 'granted')
    expect(d.notify).toBe(true)
    expect(d.soundName).toBeNull()
  })

  it('finished uses viewingAtEvent so an at-idle stale viewer is not suppressed', () => {
    // viewingAtEvent=true + viewingNow=true suppresses; viewingAtEvent=false
    // (the agent finished later) must NOT suppress even if now viewing.
    const live = { focused: true, visible: true, open: true, sessionId: 's1' }
    const d = decide(
      { ...base, presence: live, presenceAgeMs: 1000, config: cfg({ suppressFocused: true }), eventKind: 'finished', viewingAtEvent: false },
      MAX_AGE, 'granted',
    )
    expect(d.notify).toBe(true)
  })
})

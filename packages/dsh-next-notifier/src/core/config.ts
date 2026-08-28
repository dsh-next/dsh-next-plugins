/**
 * Pure config normalization: flattens a raw/partial section into the full
 * {@link NotifierConfig}, filling group defaults and clamping the volume.
 */
import { DEFAULT_SOUNDS, SOUND_IDS } from './sounds.ts'
import type { NotifierConfig, NotifierConfigPatch, NotifyGroup } from './types.ts'

const asBool = (value: unknown): boolean => !(value === false || value === 0 || value === '' || value === null)

function group(raw: unknown, fallbackName: string): NotifyGroup {
  if (raw === undefined) {
    return { enabled: true, sound: true, soundName: fallbackName, subagent: false, goalOnly: true }
  }
  if (typeof raw === 'boolean') {
    return { enabled: raw, sound: true, soundName: fallbackName, subagent: false, goalOnly: true }
  }
  const obj = (raw && typeof raw === 'object') ? raw as Partial<NotifyGroup> : {}
  const name = typeof obj.soundName === 'string' && SOUND_IDS.includes(obj.soundName) ? obj.soundName : fallbackName
  return {
    enabled: asBool(obj.enabled),
    sound: asBool(obj.sound),
    soundName: name,
    subagent: obj.subagent === true,
    goalOnly: obj.goalOnly !== false,
  }
}

/** Normalize a raw section into the full config (defaults applied). */
export function normalizeConfig(src: unknown): NotifierConfig {
  const s = (src && typeof src === 'object') ? src as NotifierConfigPatch : {}
  const volume = typeof s.volume === 'number' && Number.isFinite(s.volume)
    ? Math.max(0, Math.min(100, Math.round(s.volume)))
    : 70
  const notificationSeconds = typeof s.notificationSeconds === 'number' && Number.isFinite(s.notificationSeconds)
    ? Math.max(3, Math.min(60, Math.round(s.notificationSeconds)))
    : 12
  return {
    enabled: asBool(s.enabled),
    suppressFocused: asBool(s.suppressFocused),
    volume,
    notificationSeconds,
    finished: group(s.finished, DEFAULT_SOUNDS.finished),
    approval: group(s.approval, DEFAULT_SOUNDS.approval),
    question: group(s.question, DEFAULT_SOUNDS.question),
  }
}

/** The default config, independent of any stored section. */
export function defaultConfig(): NotifierConfig {
  return normalizeConfig({})
}

/** A minimal partial patch for settings.update(): only JSON-compatible fields. */
export function cleanPatch(patch: unknown): Record<string, unknown> {
  const clean: Record<string, unknown> = {}
  if (!patch || typeof patch !== 'object') return clean
  const p = patch as Record<string, unknown>
  if (typeof p.enabled === 'boolean') clean.enabled = p.enabled
  if (typeof p.suppressFocused === 'boolean') clean.suppressFocused = p.suppressFocused
  if (typeof p.volume === 'number' && Number.isFinite(p.volume)) {
    clean.volume = Math.max(0, Math.min(100, Math.round(p.volume)))
  }
  if (typeof p.notificationSeconds === 'number' && Number.isFinite(p.notificationSeconds)) {
    clean.notificationSeconds = Math.max(3, Math.min(60, Math.round(p.notificationSeconds)))
  }
  for (const key of ['finished', 'approval', 'question'] as const) {
    const g = p[key]
    if (g && typeof g === 'object') {
      const out: Record<string, unknown> = {}
      const go = g as Record<string, unknown>
      if (typeof go.enabled === 'boolean') out.enabled = go.enabled
      if (typeof go.sound === 'boolean') out.sound = go.sound
      if (typeof go.soundName === 'string' && SOUND_IDS.includes(go.soundName)) out.soundName = go.soundName
      if (typeof go.subagent === 'boolean') out.subagent = go.subagent
      if (typeof go.goalOnly === 'boolean') out.goalOnly = go.goalOnly
      if (Object.keys(out).length > 0) clean[key] = out
    }
  }
  return clean
}

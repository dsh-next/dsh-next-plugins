/**
 * Pure shared domain types for the notifier: the config shape, the sound
 * catalog, and the notification decision model. This module has no Cordis,
 * host, browser, or Node runtime identity — both halves may import it.
 */

/** Stable ids of the three notifiable "categories" (plus the subagent alias). */
export type NotifyEventKey = 'finished' | 'approval' | 'question' | 'subagent'

/** Per-category settings: which events to surface and which sound to play. */
export interface NotifyGroup {
  enabled: boolean
  sound: boolean
  soundName: string
  /** Only on the "finished" group: also alert when a subagent settles. */
  subagent: boolean
  /** Only on the "finished" group: suppress per-turn pings while a goal runs. */
  goalOnly: boolean
}

/** The full, normalized notifier configuration. */
export interface NotifierConfig {
  enabled: boolean
  suppressFocused: boolean
  volume: number
  /** How many seconds a browser notification stays visible before auto-dismiss. */
  notificationSeconds: number
  finished: NotifyGroup
  approval: NotifyGroup
  question: NotifyGroup
}

/** A raw, partially-specified section before normalization fills defaults. */
export type NotifierConfigPatch = Partial<{
  enabled: boolean
  suppressFocused: boolean
  volume: number
  notificationSeconds: number
  finished: Partial<NotifyGroup>
  approval: Partial<NotifyGroup>
  question: Partial<NotifyGroup>
}>

/** One synthesized sound segment (Waveform primitives with simple shaping). */
export type Waveform = 'sine' | 'square' | 'saw' | 'triangle' | 'noise'

export interface SoundSegment {
  type: Waveform
  /** Start frequency in Hz (wave tones only; noise uses no pitch). */
  from?: number
  /** Slide target frequency in Hz; a fixed tone when omitted. */
  to?: number
  /** Duration in seconds. */
  dur: number
  /** Peak gain (0..1) before normalization. */
  gain: number
  /** Envelope decay exponent; higher = faster fade-out. */
  decay: number
  /** Start offset in seconds. */
  delay?: number
  /** Linear attack ramp length in seconds. */
  attack?: number
  /** Low-pass filter coefficient (0..1) for noise segments. */
  lp?: number
  /** Tremolo rate in Hz (amplitude modulation). */
  am?: number
}

export interface SoundDef {
  id: string
  name: string
  group: string
  segments: SoundSegment[]
}

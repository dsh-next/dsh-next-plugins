/**
 * The curated sound catalog. Every sound is synthesized at startup as a WAV;
 * no binary assets ship in the package. The 17-id subset keeps one
 * representative of each distinct timbre from the original 24.
 */
import type { SoundDef } from './types.ts'

export const SOUNDS: readonly SoundDef[] = [
  // Chimes
  {
    id: 'chime', name: 'Chime', group: 'Chimes', segments: [
      { type: 'sine', from: 659, dur: 0.5, gain: 0.55, decay: 4 },
      { type: 'sine', from: 880, dur: 0.5, gain: 0.55, decay: 4, delay: 0.16 },
    ],
  },
  {
    id: 'ping', name: 'Ping', group: 'Chimes', segments: [
      { type: 'sine', from: 1200, dur: 0.5, gain: 0.6, decay: 7 },
    ],
  },
  {
    id: 'bell', name: 'Bell', group: 'Chimes', segments: [
      { type: 'sine', from: 880, dur: 1.2, gain: 0.5, decay: 3 },
      { type: 'sine', from: 1764, dur: 0.9, gain: 0.22, decay: 5 },
      { type: 'sine', from: 2646, dur: 0.6, gain: 0.1, decay: 7 },
    ],
  },
  // Alerts
  {
    id: 'alert', name: 'Alert', group: 'Alerts', segments: [
      { type: 'square', from: 880, dur: 0.16, gain: 0.28, decay: 1.5 },
      { type: 'square', from: 880, dur: 0.16, gain: 0.28, decay: 1.5, delay: 0.22 },
    ],
  },
  {
    id: 'error', name: 'Error', group: 'Alerts', segments: [
      { type: 'saw', from: 440, to: 220, dur: 0.5, gain: 0.35, decay: 2.5 },
    ],
  },
  {
    id: 'success', name: 'Success', group: 'Alerts', segments: [
      { type: 'sine', from: 523, dur: 0.14, gain: 0.5, decay: 3 },
      { type: 'sine', from: 659, dur: 0.14, gain: 0.5, decay: 3, delay: 0.12 },
      { type: 'sine', from: 784, dur: 0.3, gain: 0.55, decay: 3.5, delay: 0.24 },
    ],
  },
  // Effects
  {
    id: 'chirp', name: 'Chirp', group: 'Effects', segments: [
      { type: 'sine', from: 1800, to: 2800, dur: 0.16, gain: 0.5, decay: 2 },
      { type: 'sine', from: 2800, to: 1800, dur: 0.2, gain: 0.45, decay: 2.5, delay: 0.15 },
    ],
  },
  {
    id: 'pop', name: 'Pop', group: 'Effects', segments: [
      { type: 'noise', dur: 0.06, gain: 0.7, decay: 14 },
    ],
  },
  {
    id: 'knock', name: 'Knock', group: 'Effects', segments: [
      { type: 'noise', dur: 0.05, gain: 0.6, decay: 7, lp: 0.3 },
      { type: 'noise', dur: 0.05, gain: 0.45, decay: 7, lp: 0.3, delay: 0.13 },
    ],
  },
  {
    id: 'whoosh', name: 'Whoosh', group: 'Effects', segments: [
      { type: 'noise', dur: 0.5, gain: 0.4, attack: 0.35, decay: 1, lp: 0.2 },
    ],
  },
  {
    id: 'magic', name: 'Magic', group: 'Effects', segments: [
      { type: 'sine', from: 600, to: 1800, dur: 0.4, gain: 0.45, decay: 2 },
      { type: 'sine', from: 2400, dur: 0.35, gain: 0.2, decay: 5, delay: 0.25 },
    ],
  },
  {
    id: 'blip', name: 'Blip', group: 'Effects', segments: [
      { type: 'square', from: 660, dur: 0.08, gain: 0.3, decay: 6 },
    ],
  },
  {
    id: 'ring', name: 'Ring', group: 'Effects', segments: [
      { type: 'sine', from: 440, dur: 0.9, gain: 0.4, decay: 1.8 },
      { type: 'sine', from: 480, dur: 0.9, gain: 0.4, decay: 1.8 },
    ],
  },
  {
    id: 'gong', name: 'Gong', group: 'Effects', segments: [
      { type: 'sine', from: 196, dur: 2.0, gain: 0.6, decay: 1.4 },
      { type: 'sine', from: 294, dur: 1.6, gain: 0.25, decay: 1.8 },
      { type: 'sine', from: 392, dur: 1.0, gain: 0.12, decay: 2.5 },
    ],
  },
  // Farts
  {
    id: 'fart-classic', name: 'Fart · Classic', group: 'Farts', segments: [
      { type: 'saw', from: 130, to: 60, dur: 0.7, gain: 0.8, decay: 2, am: 11 },
      { type: 'noise', dur: 0.7, gain: 0.75, decay: 2, lp: 0.22, am: 11 },
    ],
  },
  {
    id: 'fart-deep', name: 'Fart · Deep', group: 'Farts', segments: [
      { type: 'saw', from: 85, to: 42, dur: 1.2, gain: 0.9, decay: 1.6, am: 8 },
      { type: 'noise', dur: 1.2, gain: 0.6, decay: 1.8, lp: 0.15, am: 8 },
    ],
  },
  {
    id: 'fart-squeaky', name: 'Fart · Squeaky', group: 'Farts', segments: [
      { type: 'saw', from: 380, to: 520, dur: 0.14, gain: 0.5, decay: 2 },
      { type: 'saw', from: 520, to: 170, dur: 0.28, gain: 0.6, decay: 3, delay: 0.13 },
      { type: 'noise', dur: 0.42, gain: 0.4, decay: 3, lp: 0.3, delay: 0.13 },
    ],
  },
]

export const SOUND_IDS: readonly string[] = SOUNDS.map((s) => s.id)

/** Default sound per notifiable category. */
export const DEFAULT_SOUNDS = {
  finished: 'chime',
  approval: 'ping',
  question: 'chirp',
} as const

/** The sample rate every synthesized WAV uses (16-bit PCM mono). */
export const SAMPLE_RATE = 22050

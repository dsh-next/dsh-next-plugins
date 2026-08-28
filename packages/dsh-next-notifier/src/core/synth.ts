/**
 * Pure WAV synthesis: turns a {@link SoundDef} into normalized Float32 samples
 * and encodes them as a 16-bit PCM mono WAV. No runtime identity — unit-tested
 * without a DSH host.
 */
import { SAMPLE_RATE } from './sounds.ts'
import type { SoundDef, SoundSegment } from './types.ts'

/** Perceptual volume gain: (volume/100)^2; 0 is silence, 1 is full. */
export function volumeGain(volume: number): number {
  const v = Math.max(0, Math.min(100, Math.round(volume)))
  return v === 0 ? 0 : Math.pow(v / 100, 2)
}

function sampleSegment(seg: SoundSegment, out: Float32Array): void {
  const start = Math.floor((seg.delay ?? 0) * SAMPLE_RATE)
  const n = Math.floor(seg.dur * SAMPLE_RATE)
  let phase = 0
  let filtered = 0
  for (let i = 0; i < n; i++) {
    const t = i / n
    const seconds = t * seg.dur
    const freq = (seg.from ?? 0) + ((seg.to ?? seg.from ?? 0) - (seg.from ?? 0)) * t
    phase += freq / SAMPLE_RATE
    let v: number
    switch (seg.type) {
      case 'noise': {
        const raw = Math.random() * 2 - 1
        if (seg.lp !== undefined) {
          filtered += (raw - filtered) * seg.lp
          v = filtered
        } else {
          v = raw
        }
        break
      }
      case 'sine':
        v = Math.sin(2 * Math.PI * phase)
        break
      case 'square':
        v = Math.sin(2 * Math.PI * phase) >= 0 ? 1 : -1
        break
      case 'saw':
        v = 2 * (phase % 1) - 1
        break
      case 'triangle':
        v = 1 - 4 * Math.abs((phase % 1) - 0.5)
        break
    }
    if (seg.am !== undefined) v *= 0.65 + 0.35 * Math.sin(2 * Math.PI * seg.am * seconds)
    const attack = seg.attack !== undefined ? Math.min(1, seconds / seg.attack) : 1
    const decay = Math.pow(1 - t, seg.decay ?? 4)
    out[start + i] += v * (seg.gain ?? 0.5) * attack * decay
  }
}

/** Synthesize a sound definition into normalized Float32 samples. */
export function synthesize(def: SoundDef, gain = 1): Float32Array {
  const totalSeconds = def.segments.reduce((max, s) => Math.max(max, (s.delay ?? 0) + s.dur), 0)
  const out = new Float32Array(Math.max(1, Math.floor(totalSeconds * SAMPLE_RATE)))
  for (const seg of def.segments) sampleSegment(seg, out)
  let peak = 0
  for (let i = 0; i < out.length; i++) {
    const a = Math.abs(out[i])
    if (a > peak) peak = a
  }
  const scale = (peak > 0 ? 0.9 / peak : 0.9) * (typeof gain === 'number' ? Math.max(0, Math.min(1, gain)) : 1)
  return Float32Array.from(out, (v) => Math.max(-1, Math.min(1, v * scale)))
}

/** Encode normalized Float32 samples into a 16-bit PCM mono WAV. */
export function encodeWav(samples: Float32Array): Uint8Array {
  const n = samples.length
  const view = new DataView(new ArrayBuffer(44 + n * 2))
  const writeStr = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + n * 2, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, SAMPLE_RATE, true)
  view.setUint32(28, SAMPLE_RATE * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeStr(36, 'data')
  view.setUint32(40, n * 2, true)
  for (let i = 0; i < n; i++) {
    view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, samples[i])) * 32000), true)
  }
  return new Uint8Array(view.buffer)
}

/** Encode bytes as unpadded-ish base64 (with '=' where required). */
export function base64Encode(bytes: Uint8Array): string {
  const table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]
    const b1 = bytes[i + 1]
    const b2 = bytes[i + 2]
    out += table[b0 >> 2]
    out += table[((b0 & 3) << 4) | (b1 === undefined ? 0 : b1 >> 4)]
    out += b1 === undefined ? '=' : table[((b1 & 15) << 2) | (b2 === undefined ? 0 : b2 >> 6)]
    out += b2 === undefined ? '=' : table[b2 & 63]
  }
  return out
}

/** Decode base64 back into bytes (used by the host for subprocess round-trips). */
export function base64Decode(text: string): Uint8Array {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const map: Record<string, number> = {}
  for (let i = 0; i < chars.length; i++) map[chars[i]] = i
  const s = String(text).replace(/[^A-Za-z0-9+/=]/g, '')
  const bytes: number[] = []
  for (let i = 0; i < s.length; i += 4) {
    const a = map[s[i]]
    const b = map[s[i + 1]]
    const c = s[i + 2] === '=' ? -1 : map[s[i + 2]]
    const d = s[i + 3] === '=' ? -1 : map[s[i + 3]]
    bytes.push((a << 2) | (b >> 4))
    if (c >= 0) bytes.push(((b & 15) << 4) | (c >> 2))
    if (d >= 0) bytes.push(((c & 3) << 6) | d)
  }
  return new Uint8Array(bytes)
}

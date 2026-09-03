import { describe, expect, it } from 'vitest'
import { SOUNDS } from '../src/core/sounds.ts'
import { encodeWav, synthesize, volumeGain, base64Encode, base64Decode } from '../src/core/synth.ts'

describe('volumeGain', () => {
  it('maps 0 to silence', () => {
    expect(volumeGain(0)).toBe(0)
  })
  it('maps 100 to full', () => {
    expect(volumeGain(100)).toBe(1)
  })
  it('applies the perceptual square curve', () => {
    expect(volumeGain(50)).toBeCloseTo(0.25, 5)
  })
  it('clamps out-of-range values', () => {
    expect(volumeGain(-10)).toBe(0)
    expect(volumeGain(200)).toBe(1)
  })
})

describe('synthesize / encodeWav', () => {
  it('produces non-empty normalized samples for every sound', () => {
    for (const sound of SOUNDS) {
      const samples = synthesize(sound, 0.5)
      expect(samples.length).toBeGreaterThan(0)
      for (let i = 0; i < samples.length; i++) {
        expect(Math.abs(samples[i])).toBeLessThanOrEqual(1.001)
      }
    }
  }, 30000)

  it('encodes a valid 16-bit PCM WAV header', () => {
    const samples = synthesize(SOUNDS[0], 0.5)
    const wav = encodeWav(samples)
    expect(wav.length).toBe(44 + samples.length * 2)
    // "RIFF" + "WAVE" + "fmt " + "data" markers
    const ascii = String.fromCharCode(...wav.slice(0, 4)) + String.fromCharCode(...wav.slice(8, 12))
    expect(ascii).toBe('RIFFWAVE')
  })

  it('round-trips base64 without loss', () => {
    const wav = encodeWav(synthesize(SOUNDS[0], 0.5))
    const b64 = base64Encode(wav)
    const back = base64Decode(b64)
    expect(back.length).toBe(wav.length)
    for (let i = 0; i < wav.length; i++) expect(back[i]).toBe(wav[i])
  })

  it('different waveform types all produce audible non-silent samples', () => {
    for (const type of ['sine', 'square', 'saw', 'triangle', 'noise'] as const) {
      const samples = synthesize({ id: 'x', name: 'x', group: 'g', segments: [{ type, from: 440, dur: 0.04, gain: 0.9, decay: 2 }] }, 1)
      expect(samples.some((v) => Math.abs(v) > 0.001), `type ${type} produced silence`).toBe(true)
    }
  })

  it('respects a fixed tone (no frequency slide) with only `from`', () => {
    const withTo = synthesize({ id: 'a', name: 'a', group: 'g', segments: [{ type: 'sine', from: 440, to: 880, dur: 0.05, gain: 1, decay: 1 }] }, 1)
    const withoutTo = synthesize({ id: 'b', name: 'b', group: 'g', segments: [{ type: 'sine', from: 440, dur: 0.05, gain: 1, decay: 1 }] }, 1)
    expect(withTo.length).toBe(withoutTo.length)
    // A sliding chirp and a fixed tone differ in waveform.
    expect(withTo).not.toEqual(withoutTo)
  })

  it('low-pass filter and tremolo on noise segments produce bounded output', () => {
    const samples = synthesize({
      id: 'n', name: 'n', group: 'g',
      segments: [{ type: 'noise', dur: 0.05, gain: 0.9, decay: 1, lp: 0.3, am: 11 }],
    }, 1)
    for (const v of samples) expect(Math.abs(v)).toBeLessThanOrEqual(1.001)
    expect(samples.some((v) => Math.abs(v) > 0.001)).toBe(true)
  })

  it('base64Decode tolerates surrounding whitespace and padding', () => {
    const bytes = new Uint8Array([0, 1, 2, 3, 250, 255])
    const b64 = base64Encode(bytes)
    const decoded = base64Decode('\n ' + b64 + ' \n')
    expect([...decoded]).toEqual([...bytes])
  })

  it('base64Encode pads a non-multiple-of-3 payload and decodes back', () => {
    for (const len of [1, 2, 3, 4, 5]) {
      const bytes = new Uint8Array(Array.from({ length: len }, (_, i) => (i * 37) & 0xff))
      expect([...base64Decode(base64Encode(bytes))]).toEqual([...bytes])
    }
  })
})

describe('sound catalog', () => {
  it('ships 17 curated sounds with unique ids', () => {
    expect(SOUNDS).toHaveLength(17)
    const ids = SOUNDS.map((s) => s.id)
    expect(new Set(ids).size).toBe(17)
  })
})

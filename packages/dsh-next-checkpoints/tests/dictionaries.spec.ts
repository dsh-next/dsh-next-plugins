import { describe, expect, it } from 'vitest'
import { en } from '../src/client/dictionaries/en.ts'
import { zh } from '../src/client/dictionaries/zh.ts'
import { englishTranslate, interpolate } from '../src/client/dictionaries.ts'

describe('dictionaries', () => {
  it('keeps en and zh keys in lockstep', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
  })

  it('interpolates known names and leaves unknown braces', () => {
    expect(interpolate('turn {turn}', { turn: 3 })).toBe('turn 3')
    expect(interpolate('turn {turn}')).toBe('turn {turn}')
    expect(interpolate('turn {turn}', { other: 1 })).toBe('turn {turn}')
    expect(englishTranslate('row.turn', { turn: 2 })).toBe('turn 2')
  })
})

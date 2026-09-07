import { describe, expect, it } from 'vitest'
import { clampRailWidth, RAIL_DEFAULT, RAIL_MAX, RAIL_MIN } from '../src/client/rail.ts'

describe('clampRailWidth', () => {
  it('clamps to the AppFrame-like range', () => {
    expect(clampRailWidth(RAIL_MIN - 40)).toBe(RAIL_MIN)
    expect(clampRailWidth(RAIL_MAX + 80)).toBe(RAIL_MAX)
    expect(clampRailWidth(240)).toBe(240)
    expect(clampRailWidth(Number.NaN)).toBe(RAIL_DEFAULT)
  })
})

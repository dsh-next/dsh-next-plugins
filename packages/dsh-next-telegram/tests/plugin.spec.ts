import { describe, expect, it } from 'vitest'

// Minimal smoke test: import the host entry and confirm it exposes an apply
// function with the expected Cordis plugin shape. Replace with real behavior
// tests as the plugin grows.
import * as plugin from '../src/index.js'

describe('telegram host plugin', () => {
  it('exports an apply function', () => {
    expect(typeof plugin.apply).toBe('function')
  })
})

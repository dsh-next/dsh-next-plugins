/**
 * Host entry smoke: the compiled entries expose the Cordis plugin shape the
 * bundle patch declares (host `apply` + `inject`, client `apply`).
 */
import { describe, expect, it } from 'vitest'
import * as host from '../src/index.ts'
import * as client from '../src/client/index.ts'

describe('cc-plugins entries', () => {
  it('exports a host apply with the webServer injection', () => {
    expect(typeof host.apply).toBe('function')
    expect(host.inject).toContain('webServer')
  })

  it('exports a client apply', () => {
    expect(typeof client.apply).toBe('function')
  })
})

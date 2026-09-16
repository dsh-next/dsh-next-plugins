
import { describe, expect, it } from 'vitest'
import * as plugin from '../src/index.js'

describe('opencode-session-patch host plugin', () => {
  it('exposes the cordis plugin shape', () => {
    expect(plugin.name).toBe('dsh-next-opencode-session-patch')
    expect(plugin.inject).toEqual(['agents'])
    expect(typeof plugin.apply).toBe('function')
  })

  it('registers a dispose effect on the plugin context', () => {
    const disposers: Array<() => void> = []
    const ctx = {
      agents: { currentInitiator: () => undefined },
      effect: (fn: () => () => void) => { disposers.push(fn()) },
    }
    plugin.apply(ctx as never)
    expect(disposers).toHaveLength(1)
    expect(typeof disposers[0]).toBe('function')
  })
})

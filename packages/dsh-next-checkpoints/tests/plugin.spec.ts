import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import * as plugin from '../src/index.ts'
import { actorSession, toolFilePath } from '../src/index.ts'

function runEffects(): (fn: () => (() => void) | void) => () => void {
  return (fn) => {
    const off = fn()
    return typeof off === 'function' ? off : () => {}
  }
}

describe('checkpoints host plugin', () => {
  it('exports an apply function and injects webServer plus sessions', () => {
    expect(typeof plugin.apply).toBe('function')
    expect(plugin.inject).toEqual(['webServer', 'sessions'])
  })

  it('reads the session off the tool-fs execute actor', () => {
    const session = { id: 's1', header: { cwd: '/repo' } }
    expect(actorSession({ agent: { session } })).toBe(session)
    expect(actorSession({ session })).toBe(session)
    expect(actorSession({})).toBeUndefined()
    expect(toolFilePath({ name: 'write', arguments: { file_path: 'src/a.ts' } } as never)).toBe('src/a.ts')
    expect(toolFilePath({ name: 'write', arguments: {} } as never)).toBeUndefined()
  })

  it('registers fs and tools listeners as global so they see other plugins', () => {
    const on = vi.fn()
    plugin.apply({
      get: (name: string) => {
        if (name === 'webServer') return { register: vi.fn().mockReturnValue(() => {}) }
        if (name === 'sessions') return { get: () => undefined }
        if (name === 'commands') return { register: vi.fn().mockReturnValue(() => {}) }
        return undefined
      },
      on,
      effect: runEffects(),
    } as never)
    expect(on).toHaveBeenCalledWith('fs/write-intent', expect.any(Function), { global: true })
    expect(on).toHaveBeenCalledWith('fs/edit-intent', expect.any(Function), { global: true })
    expect(on).toHaveBeenCalledWith('tools/execute', expect.any(Function), { global: true })
  })

  it('awaits noteIntent before next() on fs write/edit intent', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-next-checkpoints-plugin-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    const order: string[] = []
    const listeners = new Map<string, (...args: never[]) => unknown>()
    try {
      plugin.apply({
        get: (name: string) => {
          if (name === 'webServer') return { register: vi.fn().mockReturnValue(() => {}) }
          if (name === 'sessions') return { get: () => undefined }
          if (name === 'commands') return { register: vi.fn().mockReturnValue(() => {}) }
          return undefined
        },
        on: (event: string, handler: (...args: never[]) => unknown) => {
          listeners.set(event, handler)
        },
        effect: runEffects(),
      } as never)
      const write = listeners.get('fs/write-intent')
      expect(write).toBeTypeOf('function')
      const next = vi.fn(async () => {
        order.push('next')
        return { ok: true }
      })
      await write?.(
        { targetKey: '/repo/a.ts', displayPath: 'a.ts' } as never,
        { agent: { session: { id: 's1', header: { cwd: '/repo' } } } } as never,
        next as never,
      )
      expect(order).toEqual(['next'])
      expect(next).toHaveBeenCalledTimes(1)
      const exec = listeners.get('tools/execute')
      const execNext = vi.fn(async () => ({ ok: true }))
      await exec?.(
        { name: 'bash', agent: { session: { id: 's1', header: { cwd: '/repo' } } } } as never,
        execNext as never,
      )
      expect(execNext).toHaveBeenCalledTimes(1)
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
      await rm(home, { recursive: true, force: true })
    }
  })
})

import { describe, expect, it, vi } from 'vitest'
import { configScope } from '../src/host/config-scope.ts'
import { defaultConfig } from '../src/core/config.ts'
import type { NotifierConfigShape } from '../src/core/schema.ts'

function liveConfig() {
  const value = defaultConfig()
  const config = Object.fromEntries(Object.keys(value).map(key => [key, { get: () => value[key as keyof typeof value] }])) as NotifierConfigShape
  return { config, value }
}
describe('volatile config adapter', () => {
  it('has no scope without loader config', () => {
    expect(configScope({} as never, undefined)).toBeNull()
  })
  it('reads live fields even without a writable config editor', async () => {
    const { config, value } = liveConfig()
    const scope = configScope({ get: () => undefined } as never, config)!
    expect(scope.get()).toEqual(defaultConfig())
    value.volume = 22
    expect(scope.get().volume).toBe(22)
    await expect(scope.update({ volume: 12 })).rejects.toThrow('read-only')
  })
  it('preserves unrelated raw group overrides through legacy RPC writes', async () => {
    const { config } = liveConfig()
    const raw = { volume: 43, finished: { sound: false, goalOnly: false }, enabled: true }
    const edit = vi.fn(async (_entry: unknown, change: (value: typeof raw) => unknown) => {
      expect(change(raw)).toEqual({ volume: 43, finished: { sound: false, goalOnly: false, soundName: 'bell' }, enabled: true })
    })
    const scope = configScope({ fiber: { entry: 'notifier' }, get: () => ({ edit }) } as never, config)!
    await scope.update({ finished: { soundName: 'bell' } })
    expect(edit).toHaveBeenCalledOnce()
  })
  it('propagates config persistence failures', async () => {
    const { config } = liveConfig()
    const scope = configScope({ fiber: { entry: 'notifier' }, get: () => ({ edit: vi.fn().mockRejectedValue(new Error('disk full')) }) } as never, config)!
    await expect(scope.update({ volume: 1 })).rejects.toThrow('disk full')
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { SubscriptionsServiceOptions } from '../src/host/service.ts'
import { apply } from '../src/index.ts'

const lifecycle = vi.hoisted(() => ({
  options: undefined as SubscriptionsServiceOptions | undefined,
  hydrate: vi.fn(async () => {}),
  dispose: vi.fn(),
}))

vi.mock('../src/host/service.ts', () => ({
  SubscriptionsService: class {
    constructor(options: SubscriptionsServiceOptions) { lifecycle.options = options }
    hydrate = lifecycle.hydrate
    dispose = lifecycle.dispose
    profiles = () => new Map()
  },
}))
vi.mock('../src/host/rpc.ts', () => ({ registerRpc: vi.fn() }))
vi.mock('@deepseek-ai/dsh-llm-pi-ai', () => ({ PiAiAdapter: class {} }))

beforeEach(() => {
  lifecycle.options = undefined
  lifecycle.hydrate.mockClear()
  lifecycle.dispose.mockClear()
})

function fixture() {
  const cleanups: Array<() => void> = []
  const handle = Object.assign(vi.fn(), { replace: vi.fn() })
  const registerAdapter = vi.fn(() => handle)
  const scope = { get: () => ({}), replace: async () => {}, update: async () => {}, watch: () => () => {} }
  const services: Record<string, unknown> = {
    settings: { register: () => scope },
    credentials: {},
  }
  const ctx = {
    get: (key: string) => services[key],
    logger: { warn: vi.fn() },
    llm: { registerAdapter },
    effect: (start: () => (() => void) | undefined) => {
      const cleanup = start()
      if (cleanup !== undefined) cleanups.push(cleanup)
    },
  }
  apply(ctx as unknown as Context)
  return { registerAdapter, handle, cleanup: () => [...cleanups].reverse().forEach((off) => off()) }
}

describe('host apply lifecycle', () => {
  it('disposes the service together with its registered adapter', () => {
    const { cleanup, handle, registerAdapter } = fixture()
    lifecycle.options?.onRoutesChanged?.(['kimi-coding-oauth'])
    expect(registerAdapter).toHaveBeenCalledOnce()
    cleanup()
    expect(lifecycle.dispose).toHaveBeenCalledOnce()
    expect(handle).toHaveBeenCalledOnce()
  })

  it('ignores late route callbacks after teardown, even before the first registration', () => {
    const { cleanup, registerAdapter } = fixture()
    cleanup()
    lifecycle.options?.onRoutesChanged?.(['kimi-coding-oauth'])
    expect(registerAdapter).not.toHaveBeenCalled()
  })
})

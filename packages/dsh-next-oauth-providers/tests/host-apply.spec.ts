import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { SubscriptionsServiceOptions } from '../src/host/service.ts'
import { apply } from '../src/index.ts'

const lifecycle = vi.hoisted(() => ({
  options: undefined as SubscriptionsServiceOptions | undefined,
  hydrate: vi.fn(async () => {}),
  dispose: vi.fn(),
  pruneUnlisted: vi.fn(async () => {}),
  configValue: vi.fn(() => ({ providers: {} as Record<string, unknown> })),
}))

vi.mock('../src/host/service.ts', () => ({
  SubscriptionsService: class {
    constructor(options: SubscriptionsServiceOptions) { lifecycle.options = options }
    hydrate = lifecycle.hydrate
    dispose = lifecycle.dispose
    pruneUnlisted = lifecycle.pruneUnlisted
    configValue = lifecycle.configValue
    profiles = () => new Map()
  },
}))
vi.mock('../src/host/rpc.ts', () => ({ registerRpc: vi.fn() }))
vi.mock('@deepseek-ai/dsh-llm-pi-ai', () => ({ PiAiAdapter: class {} }))

beforeEach(() => {
  lifecycle.options = undefined
  lifecycle.hydrate.mockClear()
  lifecycle.dispose.mockClear()
  lifecycle.pruneUnlisted.mockClear()
  lifecycle.configValue.mockClear()
  lifecycle.configValue.mockReturnValue({ providers: {} })
})

function fixture(
  stored: Record<string, unknown> = {},
  descriptor?: { ns: string; revision: number; value?: unknown; user?: unknown },
) {
  const cleanups: Array<() => void> = []
  const handle = Object.assign(vi.fn(), { replace: vi.fn() })
  const registerAdapter = vi.fn(() => handle)
  const directory = Object.assign(vi.fn(), { replace: vi.fn() })
  const registerConfigurableProviders = vi.fn(() => directory)
  const edit = vi.fn(async (_entry: unknown, change: (current: Record<string, unknown>, inherited: Record<string, unknown>) => Record<string, unknown>) => {
    change({ keep: true }, {})
  })
  const entry = { options: { id: 'dsh-next-oauth-providers' } }
  const providers = { value: stored as unknown, get() { return providers.value } }
  const services: Record<string, unknown> = { credentials: {}, configEditor: { edit } }
  if (descriptor !== undefined) services.settings = { describe: () => [descriptor] }
  const ctx = {
    get: (key: string) => services[key],
    logger: { warn: vi.fn() },
    llm: { registerAdapter, registerConfigurableProviders },
    fiber: { entry },
    effect: (start: () => (() => void) | undefined) => {
      const cleanup = start()
      if (cleanup !== undefined) cleanups.push(cleanup)
    },
  }
  apply(ctx as unknown as Context, { providers } as never)
  return {
    registerAdapter,
    registerConfigurableProviders,
    directory,
    edit,
    handle,
    cleanup: () => [...cleanups].reverse().forEach((off) => off()),
  }
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

  it('declares every configured family to the native provider directory after hydration', async () => {
    lifecycle.configValue.mockReturnValue({ providers: { xai: { displayName: 'Grok' } } })
    const { registerConfigurableProviders, cleanup } = fixture({ xai: {} })
    await vi.waitFor(() => expect(registerConfigurableProviders).toHaveBeenCalledOnce())
    expect(registerConfigurableProviders).toHaveBeenCalledWith([
      expect.objectContaining({
        provider: 'xai-oauth',
        displayName: 'Grok',
        settingsNs: 'dsh-next-oauth-providers',
        settingsPath: ['providers', 'xai'],
      }),
    ])
    cleanup()
  })

  it('withdraws an empty directory instead of registering one', async () => {
    const { registerConfigurableProviders, cleanup } = fixture()
    await Promise.resolve()
    expect(registerConfigurableProviders).not.toHaveBeenCalled()
    cleanup()
  })

  it('writes a new provider section through the config editor without touching other fields', async () => {
    const { edit, cleanup } = fixture({ xai: {} })
    const scope = lifecycle.options?.config
    expect(scope).toBeDefined()
    await scope!.replace({ providers: { xai: { displayName: 'Grok' } } })
    expect(edit).toHaveBeenCalledOnce()
    const change = edit.mock.calls[0]![1]
    expect(change({ keep: true }, {})).toEqual({ keep: true, providers: { xai: { displayName: 'Grok' } } })
    cleanup()
  })

  it('prunes unlisted grants only for a user edit, then resyncs the directory', async () => {
    const { registerConfigurableProviders, cleanup } = fixture()
    lifecycle.options?.onConfigChanged?.('hydrate')
    await Promise.resolve()
    expect(lifecycle.pruneUnlisted).not.toHaveBeenCalled()
    lifecycle.options?.onConfigChanged?.('user')
    await vi.waitFor(() => expect(lifecycle.pruneUnlisted).toHaveBeenCalledOnce())
    expect(registerConfigurableProviders).not.toHaveBeenCalled()
    cleanup()
  })
})

describe('host config reads', () => {
  const descriptor = (value: unknown, user: unknown) => ({ ns: 'dsh-next-oauth-providers', revision: 1, value, user })

  it('reads the raw user section while a pre-0.1.7 row array is still stored', () => {
    const rows = [{ id: 'openai-codex', displayName: 'ChatGPT' }]
    // The dict schema cannot carry the array, so the resolved section is the
    // empty default; hydrate() migrates from what this read returns.
    const { cleanup } = fixture({}, descriptor({ providers: {} }, { providers: rows }))
    expect(lifecycle.options?.config.get()).toEqual({ providers: rows })
    cleanup()
  })

  it('prefers the resolved section once the stored shape is a dict', () => {
    const stored = { providers: [{ id: 'xai', displayName: 'stale' }] }
    const { cleanup } = fixture({}, descriptor({ providers: { xai: { displayName: 'Grok' } } }, stored))
    expect(lifecycle.options?.config.get()).toEqual({ providers: { xai: { displayName: 'Grok' } } })
    cleanup()
  })

  it('does not resurrect a section the user cleared', () => {
    const { cleanup } = fixture({}, descriptor({ providers: {} }, { providers: {} }))
    expect(lifecycle.options?.config.get()).toEqual({ providers: {} })
    cleanup()
  })

  it('falls back to the fiber config when no settings surface can describe', () => {
    const { cleanup } = fixture({ xai: { displayName: 'Grok' } })
    expect(lifecycle.options?.config.get()).toEqual({ providers: { xai: { displayName: 'Grok' } } })
    cleanup()
  })
})

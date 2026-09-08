import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Credential, CredentialStore } from '@earendil-works/pi-ai'
import { LOGIN_TIMEOUT_MS } from '../src/core/ids.ts'
import { RpcError } from '../src/core/errors.ts'
import { assertLoopbackPortFree } from '../src/host/http-guard.ts'
import {
  SubscriptionsService,
  type ConfigScopeFace,
  type LoginInteraction,
  type SubscriptionsServiceOptions,
} from '../src/host/service.ts'

vi.mock('../src/host/http-guard.ts', async (original) => ({
  ...await original<typeof import('../src/host/http-guard.ts')>(),
  assertLoopbackPortFree: vi.fn(async () => {}),
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

const grant: Credential = { type: 'oauth', access: 'test-access', refresh: 'test-refresh', expires: 2_000_000_000_000 }

function fixture(options: Partial<SubscriptionsServiceOptions> = {}) {
  const records = new Map<string, Credential>()
  const store: CredentialStore = {
    read: vi.fn(async (id) => records.get(id)),
    list: async () => [],
    modify: async (id, mutate) => {
      const next = await mutate(records.get(id))
      if (next !== undefined) records.set(id, next)
      return records.get(id)
    },
    delete: vi.fn(async (id) => { records.delete(id) }),
  }
  let section: object = {}
  const config: ConfigScopeFace = {
    get: () => section,
    replace: vi.fn(async (next) => { section = next }),
    update: async () => {},
    watch: () => () => {},
  }
  const routes = vi.fn()
  const service = new SubscriptionsService({
    store,
    config,
    fetch: async () => new Response('{}'),
    login: async () => new Promise<void>(() => {}),
    onRoutesChanged: routes,
    ...options,
  })
  return { service, store, records, config, routes }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.mocked(assertLoopbackPortFree).mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('sign-in termination', () => {
  it.each(['disconnect', 'removeProvider'] as const)('%s terminates the prompt and admits the next login', async (method) => {
    let interaction!: LoginInteraction
    const { service } = fixture({ login: async (_id, next) => {
      interaction = next
      await next.prompt({ type: 'text', message: 'Enter callback' })
    } })
    const started = await service.startLogin('kimi')
    expect((await service.getAttempt(started.id)).prompt).toBeDefined()
    await service[method]('kimi')
    expect(interaction.signal.aborted).toBe(true)
    expect(await service.getAttempt(started.id)).toMatchObject({ status: 'cancelled', error: { code: 'cancelled' } })
    expect((await service.getAttempt(started.id)).prompt).toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
    await expect(service.startLogin('grok')).resolves.toMatchObject({ status: 'running' })
  })

  it('cancel clears its timer even when the provider ignores abort', async () => {
    const { service } = fixture()
    const started = await service.startLogin('kimi')
    expect(vi.getTimerCount()).toBe(1)
    await service.cancelLogin(started.id)
    expect(vi.getTimerCount()).toBe(0)
    await expect(service.startLogin('grok')).resolves.toMatchObject({ status: 'running' })
  })

  it('ignores a cancelled login finishing after a new owner starts', async () => {
    const oldLogin = deferred<void>()
    const { service, config, routes } = fixture({ login: async (id) => {
      if (id === 'kimi-coding') await oldLogin.promise
      else await new Promise<void>(() => {})
    } })
    const first = await service.startLogin('kimi')
    await service.cancelLogin(first.id)
    const second = await service.startLogin('grok')
    oldLogin.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect((await service.getAttempt(second.id)).status).toBe('running')
    expect(vi.getTimerCount()).toBe(1)
    expect(config.replace).not.toHaveBeenCalled()
    expect(routes).not.toHaveBeenCalled()
  })

  it('timeout marks an abort-ignoring provider terminal immediately', async () => {
    const { service } = fixture()
    const started = await service.startLogin('kimi')
    await vi.advanceTimersByTimeAsync(LOGIN_TIMEOUT_MS)
    expect(await service.getAttempt(started.id)).toMatchObject({ status: 'cancelled' })
    expect(vi.getTimerCount()).toBe(0)
    await expect(service.startLogin('grok')).resolves.toMatchObject({ status: 'running' })
  })

  it('rejects an already-aborted prompt instead of waiting forever', async () => {
    const promptAbort = new AbortController()
    promptAbort.abort()
    const { service } = fixture({ login: async (_id, interaction) => {
      await interaction.prompt({ type: 'secret', message: 'Code', signal: promptAbort.signal })
    } })
    const started = await service.startLogin('kimi')
    await vi.advanceTimersByTimeAsync(0)
    expect((await service.getAttempt(started.id)).status).not.toBe('running')
    expect((await service.getAttempt(started.id)).prompt).toBeUndefined()
  })
})

describe('login interaction contracts', () => {
  it('validates prompt ids/values and returns the selected option to the provider', async () => {
    const answer = vi.fn()
    const { service } = fixture({ login: async (_id, interaction) => {
      answer(await interaction.prompt({
        type: 'select', message: 'Choose workspace',
        options: [{ id: 'one', label: 'One', description: 'First' }, { id: 'two', label: 'Two' }],
      }))
    } })
    const started = await service.startLogin('kimi')
    const prompt = (await service.getAttempt(started.id)).prompt!
    expect(prompt).toMatchObject({ kind: 'select', options: [
      { id: 'one', label: 'One', description: 'First' }, { id: 'two', label: 'Two' },
    ] })
    await expect(service.getAttempt('missing')).rejects.toMatchObject({ code: 'not-found' })
    await expect(service.submitPrompt(started.id, 'old-prompt', 'one')).rejects.toMatchObject({ code: 'not-found' })
    await expect(service.submitPrompt(started.id, prompt.id, ' ')).rejects.toMatchObject({ code: 'bad-request' })
    expect((await service.submitPrompt(started.id, prompt.id, 'two')).prompt).toBeUndefined()
    await vi.advanceTimersByTimeAsync(0)
    expect(answer).toHaveBeenCalledWith('two')
    await expect(service.submitPrompt(started.id, prompt.id, 'two')).rejects.toMatchObject({ code: 'not-found' })
  })

  it.each(['text', 'secret', 'manual_code'] as const)('maps and withdraws a %s prompt without retaining abort listeners', async (type) => {
    const promptAbort = new AbortController()
    const remove = vi.spyOn(promptAbort.signal, 'removeEventListener')
    const { service } = fixture({ login: async (_id, interaction) => {
      await interaction.prompt({ type, message: 'Code', placeholder: 'Paste here', signal: promptAbort.signal })
    } })
    const started = await service.startLogin('kimi')
    expect((await service.getAttempt(started.id)).prompt).toMatchObject({
      kind: type === 'secret' ? 'secret' : 'text', message: 'Code', placeholder: 'Paste here',
    })
    await service.cancelLogin(started.id)
    expect((await service.getAttempt(started.id)).prompt).toBeUndefined()
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
  })

  it('removes a withdrawn prompt when its own signal aborts', async () => {
    const promptAbort = new AbortController()
    const { service } = fixture({ login: async (_id, interaction) => {
      await interaction.prompt({ type: 'text', message: 'Code', signal: promptAbort.signal })
    } })
    const started = await service.startLogin('kimi')
    promptAbort.abort()
    await vi.advanceTimersByTimeAsync(0)
    expect((await service.getAttempt(started.id)).prompt).toBeUndefined()
    expect((await service.getAttempt(started.id)).status).toBe('failed')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('maps provider notices and ignores late notifications after cancellation', async () => {
    let interaction!: LoginInteraction
    const { service } = fixture({ login: async (_id, next) => {
      interaction = next
      await new Promise<void>(() => {})
    } })
    const started = await service.startLogin('kimi')
    interaction.notify({ type: 'auth_url', url: 'https://provider.example/login' })
    expect((await service.getAttempt(started.id)).notice).toMatchObject({ url: 'https://provider.example/login' })
    interaction.notify({ type: 'auth_url', url: 'https://provider.example/login', instructions: 'Continue' })
    expect((await service.getAttempt(started.id)).notice?.message).toBe('Continue')
    interaction.notify({ type: 'device_code', verificationUri: 'https://provider.example/device', userCode: 'TEST' })
    expect((await service.getAttempt(started.id)).notice).toMatchObject({ url: 'https://provider.example/device', code: 'TEST' })
    interaction.notify({ type: 'info', message: 'Info', links: [{ url: 'https://provider.example/help' }] })
    expect((await service.getAttempt(started.id)).notice).toEqual({ message: 'Info', url: 'https://provider.example/help' })
    interaction.notify({ type: 'info', message: 'No link' })
    expect((await service.getAttempt(started.id)).notice).toEqual({ message: 'No link' })
    interaction.notify({ type: 'progress', message: 'Working' })
    await service.cancelLogin(started.id)
    interaction.notify({ type: 'progress', message: 'Late' })
    expect((await service.getAttempt(started.id)).notice).toEqual({ message: 'Working' })
  })
})

describe('login admission', () => {
  it('reserves ownership before an asynchronous callback-port probe', async () => {
    const probe = deferred<void>()
    vi.mocked(assertLoopbackPortFree).mockReturnValueOnce(probe.promise)
    const login = vi.fn(async (_id: string, _interaction: LoginInteraction) => new Promise<void>(() => {}))
    const { service } = fixture({ login })
    const first = service.startLogin('claude')
    const second = await service.startLogin('kimi').then(() => 'started', (error: RpcError) => error.code)
    probe.resolve()
    await first
    expect(second).toBe('busy')
    expect(login).toHaveBeenCalledTimes(1)
    expect(login.mock.calls[0]?.[0]).toBe('anthropic')
  })

  it('releases ownership and timer when the port probe fails', async () => {
    vi.mocked(assertLoopbackPortFree).mockRejectedValueOnce(new RpcError('port', 'occupied'))
    const { service } = fixture()
    await expect(service.startLogin('claude')).rejects.toMatchObject({ code: 'port' })
    expect(vi.getTimerCount()).toBe(0)
    await expect(service.startLogin('kimi')).resolves.toMatchObject({ status: 'running' })
  })

  it('does not start OAuth after disposal during the port probe', async () => {
    const probe = deferred<void>()
    vi.mocked(assertLoopbackPortFree).mockReturnValueOnce(probe.promise)
    const login = vi.fn(async () => {})
    const { service } = fixture({ login })
    const start = service.startLogin('claude')
    const result = start.catch((error: unknown) => error)
    service.dispose()
    probe.resolve()
    await expect(result).resolves.toMatchObject({ code: 'cancelled' })
    expect(login).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('service disposal', () => {
  it('is idempotent, aborts prompts, clears timers and refuses new writes', async () => {
    let interaction!: LoginInteraction
    const { service, config } = fixture({ login: async (_id, next) => {
      interaction = next
      await next.prompt({ type: 'text', message: 'Callback' })
    } })
    const started = await service.startLogin('kimi')
    service.dispose()
    service.dispose()
    expect(interaction.signal.aborted).toBe(true)
    expect(await service.getAttempt(started.id)).toMatchObject({ status: 'cancelled' })
    expect((await service.getAttempt(started.id)).prompt).toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
    await expect(service.startLogin('grok')).rejects.toMatchObject({ code: 'cancelled' })
    await expect(service.addProvider('grok')).rejects.toMatchObject({ code: 'cancelled' })
    await expect(service.disconnect('kimi')).rejects.toMatchObject({ code: 'cancelled' })
    expect(config.replace).not.toHaveBeenCalled()
    expect(service.profiles().size).toBe(0)
  })

  it('fences hydration after a pending credential read', async () => {
    const read = deferred<Credential | undefined>()
    const { service, store, config, routes } = fixture()
    vi.mocked(store.read).mockReturnValueOnce(read.promise)
    const hydration = service.hydrate()
    service.dispose()
    read.resolve(grant)
    await hydration
    expect(routes).not.toHaveBeenCalled()
    expect(config.replace).not.toHaveBeenCalled()
    expect(service.profiles().size).toBe(0)
  })

  it('fences login completion after a pending credential read', async () => {
    const read = deferred<Credential | undefined>()
    const { service, store, config, routes } = fixture({ login: async () => {} })
    vi.mocked(store.read).mockReturnValueOnce(read.promise)
    const started = await service.startLogin('kimi')
    service.dispose()
    read.resolve(grant)
    await vi.advanceTimersByTimeAsync(0)
    expect(await service.getAttempt(started.id)).toMatchObject({ status: 'cancelled' })
    expect(config.replace).not.toHaveBeenCalled()
    expect(routes).not.toHaveBeenCalled()
  })

  it('does not publish routes after an already-started settings write completes', async () => {
    const write = deferred<void>()
    const { service, records, config, routes } = fixture({ login: async () => {} })
    records.set('kimi-coding', grant)
    vi.mocked(config.replace).mockReturnValueOnce(write.promise)
    await service.startLogin('kimi')
    await vi.advanceTimersByTimeAsync(0)
    expect(config.replace).toHaveBeenCalledOnce()
    service.dispose()
    write.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(routes).not.toHaveBeenCalled()
    expect(service.profiles().size).toBe(0)
  })
})

describe('owned model discovery', () => {
  function hangingFetch() {
    return vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
    }))
  }

  it('bounds a hanging Grok fetch and returns the static fallback', async () => {
    const fetch = hangingFetch()
    const { service, records } = fixture({ fetch })
    records.set('xai', grant)
    await service.hydrate()
    let done = false
    const models = service.listModels('grok').then((rows) => { done = true; return rows })
    await vi.advanceTimersByTimeAsync(30_000)
    expect(done).toBe(true)
    expect((await models).length).toBeGreaterThan(0)
    expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears the discovery timer on dispose even while a store read cannot be interrupted', async () => {
    const read = deferred<Credential | undefined>()
    const { service, records, store } = fixture()
    records.set('xai', grant)
    await service.hydrate()
    vi.mocked(store.read).mockReturnValueOnce(read.promise)
    const result = service.listModels('grok').catch((error: unknown) => error)
    expect(vi.getTimerCount()).toBe(1)
    service.dispose()
    expect(vi.getTimerCount()).toBe(0)
    read.resolve(undefined)
    await expect(result).resolves.toMatchObject({ code: 'cancelled' })
  })

  it('aborts discovery on disposal without persisting a fallback catalog', async () => {
    const fetch = hangingFetch()
    const { service, records, config } = fixture({ fetch })
    records.set('xai', grant)
    await service.hydrate()
    const result = service.refreshModels('grok').catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(0)
    service.dispose()
    await expect(result).resolves.toMatchObject({ code: 'cancelled' })
    expect(config.replace).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})

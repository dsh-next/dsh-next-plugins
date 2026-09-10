/**
 * One unusable subscription must not take down the routes still serving.
 *
 * The adapter reads `profiles()` on every model-catalog read and every request,
 * so a family whose profile cannot be built has to drop out of the answer while
 * the healthy families keep working. The failing route stays registered in
 * `ctx.llm`, so the picker still names the provider that failed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SubscriptionsService } from '../src/host/service.ts'
import { grant, memoryConfig, memoryStore } from './helpers/service-fixtures.ts'

const broken = vi.hoisted(() => ({ family: undefined as string | undefined }))

vi.mock('../src/host/profiles.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/host/profiles.ts')>()
  return {
    ...actual,
    buildProfile: (...args: Parameters<typeof actual.buildProfile>) => {
      if (args[0].nativeId === broken.family) throw new Error('catalog exploded')
      return actual.buildProfile(...args)
    },
  }
})

beforeEach(() => { broken.family = undefined })

function connectedService(warn: (message: string) => void) {
  const service = new SubscriptionsService({
    store: memoryStore({ xai: grant, 'openai-codex': grant }),
    config: memoryConfig({
      providers: [
        { id: 'xai', displayName: 'Grok' },
        { id: 'openai-codex', displayName: 'ChatGPT' },
      ],
    }),
    fetch: async () => new Response('{}'),
    logWarn: warn,
  })
  return service
}

describe('profile build isolation', () => {
  it('keeps the healthy families when one profile cannot be built', async () => {
    broken.family = 'xai'
    const service = connectedService(() => {})
    await service.hydrate()
    const profiles = service.profiles()
    expect([...profiles.keys()]).toEqual(['openai-codex'])
    expect(profiles.get('openai-codex')).toBeDefined()
  })

  it('warns once per distinct failure across repeated per-request reads', async () => {
    broken.family = 'xai'
    const warn = vi.fn()
    const service = connectedService(warn)
    await service.hydrate()
    for (let i = 0; i < 5; i += 1) service.profiles()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith('dsh-next-oauth-providers profile grok: catalog exploded')
  })

  it('announces recovery once the profile builds again', async () => {
    broken.family = 'xai'
    const warn = vi.fn()
    const service = connectedService(warn)
    await service.hydrate()
    service.profiles()
    broken.family = undefined
    expect([...service.profiles().keys()]).toEqual(['xai', 'openai-codex'])
    expect(warn.mock.calls.map(([message]) => message)).toEqual([
      'dsh-next-oauth-providers profile grok: catalog exploded',
      'dsh-next-oauth-providers profile grok: rebuilt',
    ])
  })

  it('still builds every connected family untouched', async () => {
    const service = connectedService(() => {})
    await service.hydrate()
    const profiles = service.profiles()
    expect([...profiles.keys()]).toEqual(['xai', 'openai-codex'])
    expect(profiles.get('xai')).toMatchObject({ provider: 'xai', displayName: 'Grok' })
    expect(profiles.get('openai-codex')).toMatchObject({ provider: 'openai-codex', displayName: 'ChatGPT' })
  })
})

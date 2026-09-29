import type { Context } from '@deepseek-ai/cordis'
import type { SkillCandidate, SkillProvider, SkillProviderControl } from '@deepseek-ai/dsh-skill'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apply, Config, inject } from '../src/index.ts'
import { skillsConfigSchema } from '../src/core/schema.ts'
import { DEFAULT_PROVIDER_SPECS } from '../src/core/defaults.ts'
import { SkillsService } from '../src/host/skills-service.ts'

function harness(configAvailable = true, registryAvailable = true) {
  const section: Record<string, unknown> = { providers: [], installations: [] }
  const edit = vi.fn(async (_entry: unknown, change: (current: Record<string, unknown>) => Record<string, unknown>) => {
    Object.assign(section, change({ ...section }))
  })
  const loaderConfig = {
    providers: { get: () => section.providers },
    installations: { get: () => section.installations },
  }
  const invalidate = vi.fn()
  const controller = new AbortController()
  const offProvider = vi.fn(() => controller.abort())
  let provider: SkillProvider | undefined
  const registerProvider = vi.fn((create: (control: SkillProviderControl) => SkillProvider) => {
    provider = create({ invalidate, signal: controller.signal })
    return offProvider
  })
  const off = vi.fn()
  const registerRoute = vi.fn(() => off)
  const provided = new Map<string, unknown>()
  const disposers: Array<() => void> = []
  const warn = vi.fn()
  const get = vi.fn((key: string) => {
    if (key === 'settings') return {}
    if (key === 'configEditor') return configAvailable ? { edit } : undefined
    if (key === 'webServer') return { register: registerRoute }
    if (key === 'skills') return registryAvailable ? { registerProvider } : undefined
    throw new Error('unexpected service lookup: ' + key)
  })
  const ctx = {
    get,
    provide: (key: string, value: unknown) => provided.set(key, value),
    logger: { warn },
    effect: (fn: () => () => void) => disposers.push(fn()),
    fiber: { entry: { options: { id: 'dsh-next-skills' } } },
  }
  apply(ctx as unknown as Context, loaderConfig as never)
  return { section, edit, registerProvider, registerRoute, off, provided, disposers, warn, get, provider, invalidate, offProvider, controller }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(SkillsService.prototype, 'ensureDefaultProviders').mockResolvedValue(false)
  vi.spyOn(SkillsService.prototype, 'refreshProviders').mockResolvedValue({ ok: true, state: { installed: [], providers: [], catalog: [] } })
  vi.spyOn(SkillsService.prototype, 'reconcileInstalled').mockResolvedValue([])
})
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks() })

describe('host apply global-only wiring', () => {
  it('registers settings and RPC without overriding native skill discovery', async () => {
    const h = harness()
    expect(inject).toEqual(['webServer', 'settings'])
    expect(Config).toBe(skillsConfigSchema)
    expect(h.registerRoute).toHaveBeenCalledOnce()
    expect(h.provided.size).toBe(0)
    await vi.advanceTimersByTimeAsync(3000)
    expect(h.get).not.toHaveBeenCalledWith('workspaces')
    expect(h.registerProvider).toHaveBeenCalledOnce()
    expect(h.provider?.name).toBe('dsh-next-skills-invalidation')
    expect(await h.provider?.list({})).toEqual([])
    expect(await h.provider?.get({} as SkillCandidate, {})).toBeUndefined()
    expect(h.invalidate).not.toHaveBeenCalled()
    expect(h.edit).not.toHaveBeenCalled()
    expect(h.section).toEqual({ providers: [], installations: [] })
  })

  it('does not require the native skill registry', () => {
    const optional = harness(true, false)
    expect(optional.registerProvider).not.toHaveBeenCalled()
    expect(optional.registerRoute).toHaveBeenCalledOnce()
  })

  it('runs default seeding, provider refresh, and reconciliation in order after mount', async () => {
    const h = harness()
    await vi.advanceTimersByTimeAsync(2999)
    expect(SkillsService.prototype.ensureDefaultProviders).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(SkillsService.prototype.ensureDefaultProviders).toHaveBeenCalledWith(DEFAULT_PROVIDER_SPECS)
    expect(SkillsService.prototype.refreshProviders).toHaveBeenCalledOnce()
    expect(SkillsService.prototype.reconcileInstalled).toHaveBeenCalledOnce()
    expect(h.warn).not.toHaveBeenCalled()
  })

  it('unmount cancels the pending boot and unregisters RPC', async () => {
    const h = harness()
    h.disposers.forEach((dispose) => dispose())
    await vi.advanceTimersByTimeAsync(3000)
    expect(SkillsService.prototype.ensureDefaultProviders).not.toHaveBeenCalled()
    expect(h.off).toHaveBeenCalledOnce()
    expect(h.offProvider).toHaveBeenCalledOnce()
    expect(h.controller.signal.aborted).toBe(true)
  })

  it('warns and provides nothing when configuration is unavailable', () => {
    const h = harness(false)
    expect(h.warn).toHaveBeenCalledWith(expect.stringContaining('configuration is unavailable'))
    expect(h.provided.size).toBe(0)
    expect(h.registerRoute).not.toHaveBeenCalled()
    expect(h.disposers).toHaveLength(0)
  })

  it('continues boot after failures and reports useful diagnostics', async () => {
    vi.mocked(SkillsService.prototype.ensureDefaultProviders).mockRejectedValue(new Error('defaults failed'))
    vi.mocked(SkillsService.prototype.refreshProviders).mockResolvedValue({ ok: false, error: 'sync failed' })
    vi.mocked(SkillsService.prototype.reconcileInstalled).mockRejectedValue('reconcile failed')
    const h = harness()
    await vi.advanceTimersByTimeAsync(3000)
    expect(h.warn.mock.calls.flat()).toEqual([
      expect.stringContaining('defaults failed'), expect.stringContaining('sync failed'), expect.stringContaining('reconcile failed'),
    ])
  })

  it('tolerates thrown refresh failures and reports restored skills', async () => {
    vi.mocked(SkillsService.prototype.ensureDefaultProviders).mockRejectedValue('defaults failed')
    vi.mocked(SkillsService.prototype.refreshProviders).mockRejectedValue(new Error('offline'))
    vi.mocked(SkillsService.prototype.reconcileInstalled).mockResolvedValue(['foo reinstalled'])
    const h = harness()
    await vi.advanceTimersByTimeAsync(3000)
    expect(h.warn.mock.calls.flat()).toEqual([expect.stringContaining('defaults failed'), expect.stringContaining('foo reinstalled')])
  })
})

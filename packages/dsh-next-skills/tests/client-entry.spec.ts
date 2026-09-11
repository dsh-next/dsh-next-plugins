/** Regression: registering the global manager never reads or waits for workspaces. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type * as React from 'react'
import { apply, inject } from '../src/client/index.ts'
import type { SkillsPanelDeps } from '../src/client/SkillsPanel.tsx'
import { en, englishTranslate, NS, zh } from '../src/client/dictionaries.ts'

function registerPanel(locale?: { register: ReturnType<typeof vi.fn>; bind: ReturnType<typeof vi.fn> }) {
  let render!: () => React.ReactElement<SkillsPanelDeps>
  const slots = {
    inject: vi.fn((_name: string, callback: () => unknown) => callback()),
    register: vi.fn((_options: unknown, component: typeof render) => { render = component }),
  }
  const ctx = {
    get: vi.fn((name: string) => {
      if (name === 'slots') return slots
      if (name === 'locale') return locale
      throw new Error('Unexpected service: ' + name)
    }),
    effect: vi.fn((callback: () => unknown) => callback()),
    emit: vi.fn(),
  }
  apply(ctx as unknown as Context)
  return { ctx, slots, panel: render() }
}

afterEach(() => { vi.unstubAllGlobals() })

describe('global-only client registration', () => {
  it('waits only for slots and locale and never supplies workspace dependencies', () => {
    expect(inject).toEqual(['slots', 'locale'])
    const { ctx, slots, panel } = registerPanel()
    expect(ctx.get.mock.calls).toEqual([['slots'], ['locale']])
    expect(slots.inject).toHaveBeenCalledWith('settings.section', expect.any(Function))
    const registration = slots.register.mock.calls[0]![0] as { label: () => string }
    expect(registration).toMatchObject({ name: 'settings.section', id: 'skills', order: 16, locale: NS })
    expect(registration.label()).toBe('Skills')
    expect(Object.keys(panel.props).sort()).toEqual(['notifyInstalledChanged', 'rpc', 't'])
    expect(panel.props.t?.('card.install')).toBe('Install')
    panel.props.notifyInstalledChanged?.()
    expect(ctx.emit).toHaveBeenCalledWith('connection/reset')
    ctx.emit.mockImplementation(() => { throw new Error('bus unavailable') })
    expect(() => panel.props.notifyInstalledChanged?.()).not.toThrow()
  })

  it('registers bilingual dictionaries through the lifecycle and binds the platform locale', () => {
    const dispose = vi.fn()
    const t = (key: keyof typeof en) => zh[key]
    const locale = { register: vi.fn(() => dispose), bind: vi.fn(() => t) }
    const { ctx, panel, slots } = registerPanel(locale)
    expect(locale.register).toHaveBeenCalledWith(NS, { en, zh })
    expect(locale.bind).toHaveBeenCalledWith(NS)
    expect(ctx.effect.mock.results[0]?.value).toBe(dispose)
    expect(panel.props.t?.('card.install')).toBe('安装')
    expect(panel.props.t?.('intro')).toContain('全局安装和管理技能')
    expect((slots.register.mock.calls[0]![0] as { label: () => string }).label()).toBe('技能')
    expect(Object.keys(en).some((key) => /scope|presence|workspace/i.test(key))).toBe(false)
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
    expect(zh['sources.confirmBody']).not.toContain('可见范围')
  })

  it('tolerates duplicate locale registration', () => {
    const locale = {
      register: vi.fn(() => { throw new Error('duplicate') }),
      bind: vi.fn(() => englishTranslate),
    }
    const { ctx, panel } = registerPanel(locale)
    expect(ctx.effect.mock.results[0]?.value).toBeTypeOf('function')
    expect(panel.props.t?.('card.install')).toBe('Install')
  })

  it('posts global state and install requests without scope arguments', async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }))
    vi.stubGlobal('fetch', fetch)
    const { panel } = registerPanel()
    await panel.props.rpc('getState')
    await panel.props.rpc('installSkill', { providerId: 'o-r', skillPath: 'skills/example' })
    expect(fetch.mock.calls).toEqual([
      ['/dsh-next-skills/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method: 'getState', args: null }) }],
      ['/dsh-next-skills/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method: 'installSkill', args: { providerId: 'o-r', skillPath: 'skills/example' } }) }],
    ])
  })

  it.each([
    { body: { error: 'Denied' }, message: 'Denied' },
    { body: {}, message: 'Skills request "installSkill" failed (HTTP 409)' },
  ])('preserves HTTP failure reporting: $message', async ({ body, message }) => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 409, json: async () => body })))
    const { panel } = registerPanel()
    await expect(panel.props.rpc('installSkill')).rejects.toThrow(message)
  })
})

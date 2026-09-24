/** Regression: registering the global manager never reads or waits for workspaces. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { apply, inject } from '../src/client/index.ts'
import { SkillsPanel, type SkillsPanelDeps } from '../src/client/SkillsPanel.tsx'
import { en, englishTranslate, NS, zh } from '../src/client/dictionaries.ts'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetch)
    const { panel } = registerPanel()
    await expect(panel.props.rpc('getState')).resolves.toEqual({ ok: true })
    await panel.props.rpc('installSkill', { providerId: 'o-r', skillPath: 'skills/example' })
    expect(fetch.mock.calls).toEqual([
      ['/dsh-next-skills/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method: 'getState', args: null }) }],
      ['/dsh-next-skills/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method: 'installSkill', args: { providerId: 'o-r', skillPath: 'skills/example' } }) }],
    ])
  })

  // Regression: an unrouted path (the platform answers POST with a bare 405 and
  // no body) must never surface the Response parser's own TypeError — that is
  // the unreadable "Failed to execute 'json' on 'Response'" the panel showed.
  it.each([
    { label: 'JSON error envelope', status: 500, body: JSON.stringify({ error: 'Denied' }), message: 'Denied' },
    { label: 'JSON body without an error', status: 409, body: JSON.stringify({}), message: 'Skills request "installSkill" failed (HTTP 409)' },
    { label: 'JSON body with an empty error', status: 500, body: JSON.stringify({ error: '' }), message: 'Skills request "installSkill" failed (HTTP 500)' },
    { label: 'JSON body with a whitespace-only error', status: 500, body: JSON.stringify({ error: '   ' }), message: 'Skills request "installSkill" failed (HTTP 500)' },
    { label: 'JSON body with a non-string error', status: 500, body: JSON.stringify({ error: 7 }), message: 'Skills request "installSkill" failed (HTTP 500)' },
    { label: 'empty body', status: 405, body: '', message: 'Skills request "installSkill" failed (HTTP 405)' },
    { label: 'non-JSON body', status: 502, body: '<html>gateway</html>', message: 'Skills request "installSkill" failed (HTTP 502)' },
  ])('reports a failed request readably: $label', async ({ status, body, message }) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status })))
    const { panel } = registerPanel()
    const error = await panel.props.rpc('installSkill').catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe(message)
    expect((error as Error).message).not.toMatch(/json/i)
  })

  it('names an unreadable success response instead of leaking the parser error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })))
    const { panel } = registerPanel()
    const error = await panel.props.rpc('getState').catch((reason: unknown) => reason)
    expect((error as Error).message).toBe('Skills request "getState" returned an unreadable response (HTTP 200)')
  })

  it.each([
    { label: 'unreadable body', body: 'not json', message: 'Skills request "getState" returned an unreadable response (HTTP 200)' },
    { label: 'whitespace body', body: '  \n ', message: 'Skills request "getState" returned an unreadable response (HTTP 200)' },
  ])('rejects a successful response with a $label', async ({ body, message }) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200 })))
    const { panel } = registerPanel()
    await expect(panel.props.rpc('getState')).rejects.toThrow(message)
  })

  it('reads the body once and survives a response whose stream fails', async () => {
    // A Response double whose stream errors mid-read: the failure must still be
    // reported readably rather than escaping as an unhandled rejection.
    const response = { ok: false, status: 502, text: async () => { throw new Error('stream broke') } }
    vi.stubGlobal('fetch', vi.fn(async () => response))
    const { panel } = registerPanel()
    await expect(panel.props.rpc('getState')).rejects.toThrow('Skills request "getState" failed (HTTP 502)')
  })

  it('keeps a transport failure intact for the panel message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    const { panel } = registerPanel()
    await expect(panel.props.rpc('getState')).rejects.toThrow('Failed to fetch')
  })

  // The user-visible half of the regression above: with the host route missing
  // the panel must show its own message banner, not a parser stack string.
  it('renders the unreachable-host failure in the panel banner', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 405 })))
    const { panel } = registerPanel()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    try {
      await act(async () => {
        root.render(React.createElement(SkillsPanel, panel.props as SkillsPanelDeps))
      })
      await act(async () => {})
      const banner = container.querySelector('[data-testid="skills-message"]')
      expect(banner?.textContent).toBe('Skills request "getState" failed (HTTP 405)')
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })
})

/**
 * jsdom render test for the Claude Plugins settings panel: proves the two
 * tabs (Plugins grid with search/provider/installed filters, Marketplaces
 * sources) and the Add/Manage modal's multi-target flows dispatch the right
 * RPC calls. This complements the Host RPC contract test (shape) and the
 * real-mount e2e marker (whole shell).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { CcState, InstalledPlugin, MarketplacePluginView, MutationResult, WorkspaceRow } from '../src/core/types.ts'
import { CcPanel, formatLastSync, presenceLabel } from '../src/client/CcPanel.tsx'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** The Models-tab slice of the state envelope. */
const MODEL_STATE: Pick<CcState, 'models' | 'agentModelMap' | 'agentModelConfig' | 'agentModelOverrides' | 'agentModelAliases' | 'importSkipped'> = {
  models: [
    { provider: 'deepseek-official', id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
    { provider: 'deepseek-official', id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
  ],
  agentModelMap: { sonnet: 'deepseek-v4-pro' },
  agentModelConfig: { sonnet: 'deepseek-v4-pro' },
  agentModelOverrides: {},
  agentModelAliases: ['haiku', 'opus', 'sonnet'],
  importSkipped: [],
}

const STATE: CcState = {
  ...MODEL_STATE,
  installed: [],
  marketplaces: [
    {
      id: 'github:o/r',
      spec: 'o/r',
      name: 'acme-tools',
      description: 'Internal tools',
      owner: 'Platform',
      lastSync: '2026-01-01T00:00:00.000Z',
      plugins: [
        {
          name: 'team-tools',
          description: 'Bundled tools',
          version: '1.0.0',
          category: 'dev',
          author: '',
          homepage: '',
          tags: [],
          inventory: {
            skills: [{ name: 'deploy', description: 'Deploys', path: 'skills/deploy' }],
            commands: [{ name: 'ship', description: '', path: 'ship.md' }],
            agents: [],
            hookEvents: ['Stop'],
            mcpServers: [{ name: 'linear', def: { transport: 'stdio', command: 'npx', args: [], env: {} } }],
            notes: [],
          },
          installed: false,
        },
        {
          name: 'packed',
          description: 'npm only',
          version: '',
          category: '',
          author: '',
          homepage: '',
          tags: [],
          sourceUnsupported: 'npm plugin sources are not supported yet',
          installed: false,
        },
      ],
    },
    {
      id: 'github:o/other',
      spec: 'o/other',
      name: 'other-mkt',
      description: '',
      owner: '',
      lastSync: '2026-01-01T00:00:00.000Z',
      plugins: [
        {
          name: 'searchable-thing',
          description: 'A very specific description',
          version: '',
          category: '',
          author: '',
          homepage: '',
          tags: [],
          installed: false,
        },
      ],
    },
  ],
}

const WS: WorkspaceRow[] = [{ id: 'w1', title: 'Project One', path: '/w1' }]

function installedRecord(overrides: Partial<InstalledPlugin> = {}): InstalledPlugin {
  return {
    key: 'github:o/r/team-tools',
    marketplaceId: 'github:o/r',
    marketplaceSpec: 'o/r',
    pluginName: 'team-tools',
    version: '1.0.0',
    installedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    targets: [{ scope: 'global', skills: [{ name: 'deploy', directory: '/home/u/.agents/skills/deploy' }] }],
    mcpServers: [],
    agents: [],
    pending: { commands: ['ship'], hookEvents: ['PreToolUse'] },
    ...overrides,
  }
}

type RpcFn = (method: string, args?: unknown) => Promise<unknown>

/** STATE with team-tools installed at 1.0.0; the plugin view mirrors the
 *  Host flags for `catalogVersion` (`newer` sets updateAvailable). */
function stateWithInstall(catalogVersion: string, newer: boolean): CcState {
  const base = STATE.marketplaces[0]
  const team = base.plugins[0]
  const installedView: MarketplacePluginView = {
    ...team,
    version: catalogVersion,
    installed: true,
    installedVersion: '1.0.0',
    ...(newer ? { updateAvailable: true } : {}),
  }
  return {
    ...STATE,
    installed: [installedRecord()],
    marketplaces: [{ ...base, plugins: [installedView, ...base.plugins.slice(1)] }, STATE.marketplaces[1]],
  }
}

function rpcMock(state: CcState = STATE): RpcFn & ReturnType<typeof vi.fn> {
  return vi.fn<RpcFn>(async (method: string) => {
    if (method === 'getState') return state
    const result: MutationResult = { ok: true, message: 'done', state }
    return result
  })
}

let root: Root | undefined
const container = document.createElement('div')

function render(deps: Partial<Parameters<typeof CcPanel>[0]>): void {
  document.body.appendChild(container)
  root = createRoot(container)
  root.render(
    React.createElement(CcPanel, {
      rpc: deps.rpc ?? rpcMock(),
      getWorkspaces: deps.getWorkspaces ?? (() => WS),
      notifyInstalledChanged: deps.notifyInstalledChanged,
    }),
  )
}

afterEach(() => {
  act(() => { root?.unmount() })
  container.remove()
})

async function renderAsync(deps: Partial<Parameters<typeof CcPanel>[0]> = {}): Promise<void> {
  await act(async () => { render(deps) })
}

/** Set a controlled input's value the way React's tracker accepts under jsdom. */
function setValue(el: Element, value: string): void {
  const proto = window.HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!
  setter.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

/** Set a controlled select's value the way React's tracker accepts under jsdom. */
function setSelect(el: Element, value: string): void {
  const proto = window.HTMLSelectElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!
  setter.call(el, value)
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

/** Toggle a checkbox the way React observes under jsdom: a native click (a
 *  synthetic `change` event does not reach React's checkbox onChange). */
function check(el: Element, value: boolean): void {
  const input = el as HTMLInputElement
  if (input.checked !== value) input.click()
}

/** The first button with exactly this label. */
function button(text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].filter((b) => b.textContent === text)
  expect(found.length, `button "${text}" should exist`).toBeGreaterThan(0)
  return found[0] as HTMLButtonElement
}

function pluginCards(): Element[] {
  return [...container.querySelectorAll('[data-testid="cc-plugin"]')]
}

/** The Add/Manage button of one plugin (buttons carry the plugin key). */
function addButton(key: string): HTMLElement {
  const el = [...container.querySelectorAll('[data-testid="cc-add"]')].find((b) => b.getAttribute('title') === key)
  expect(el, `Add button for ${key}`).toBeDefined()
  return el as HTMLElement
}

describe('CcPanel', () => {
  it('renders the Plugins grid with cards, summaries, and marketplace chips', async () => {
    await renderAsync()
    expect(document.querySelector('[data-testid="cc-plugins"]')).not.toBeNull()
    expect(document.body.textContent).toContain('team-tools')
    expect(document.body.textContent).toContain('1 skill, 1 MCP server, 1 command, 1 hook event (enable runtime.hooks)')
    expect(pluginCards()).toHaveLength(3)
    expect(document.body.textContent).toContain('acme-tools')
    expect(document.body.textContent).toContain('other-mkt')
    // The unsupported source explains itself and renders a disabled Add.
    expect(document.body.textContent).toContain('npm plugin sources are not supported yet')
    const adds = [...container.querySelectorAll('[data-testid="cc-add"]')].filter((b) => b.textContent === 'Add')
    expect(adds).toHaveLength(3)
    const disabled = adds.find((b) => (b as HTMLButtonElement).disabled)
    expect(disabled).toBeDefined()
    expect(disabled?.getAttribute('title')).toBe('github:o/r/packed')
  })

  it('shows the empty state on the Plugins tab when no marketplaces exist', async () => {
    await renderAsync({ rpc: rpcMock({ ...MODEL_STATE, installed: [], marketplaces: [] }) })
    expect(document.querySelector('[data-testid="cc-empty"]')).not.toBeNull()
    expect(document.body.textContent).toContain('Marketplaces tab')
  })

  it('filters the grid by search, provider, and the installed-only toggle', async () => {
    const state: CcState = { ...STATE, installed: [installedRecord()] }
    await renderAsync({ rpc: rpcMock(state) })
    expect(pluginCards()).toHaveLength(3)

    const search = document.querySelector('[data-testid="cc-search"]')!
    await act(async () => { setValue(search, 'very specific') })
    expect(pluginCards()).toHaveLength(1)
    expect(pluginCards()[0].textContent).toContain('searchable-thing')

    await act(async () => { setValue(search, '') })
    const provider = document.querySelector('[data-testid="cc-provider"]') as HTMLSelectElement
    await act(async () => { setSelect(provider, 'github:o/other') })
    expect(pluginCards()).toHaveLength(1)

    await act(async () => { setSelect(provider, '') })
    const toggle = document.querySelector('[data-testid="cc-installed-only"]')!
    await act(async () => { check(toggle, true) })
    expect(pluginCards()).toHaveLength(1)
    expect(pluginCards()[0].textContent).toContain('team-tools')
    // The installed card carries the presence badge and a Manage button.
    expect(pluginCards()[0].textContent).toContain('in global')
    expect(pluginCards()[0].textContent).toContain('Manage')
  })

  it('surfaces imports the settings file could not satisfy on this machine', async () => {
    const state: CcState = {
      ...MODEL_STATE,
      installed: [],
      marketplaces: [],
      importSkipped: ['plugin team-tools target workspace:web: no workspace "web" registered on this machine'],
    }
    await renderAsync({ rpc: rpcMock(state) })
    const notice = document.querySelector('[data-testid="cc-import-skipped"]')
    expect(notice).not.toBeNull()
    expect(notice?.textContent).toContain('1 import(s) from the settings file skipped')
    expect(notice?.textContent).toContain('no workspace "web" registered')

    // A machine that satisfies everything shows no notice.
    await renderAsync({ rpc: rpcMock() })
    expect(document.querySelector('[data-testid="cc-import-skipped"]')).toBeNull()
  })

  it('Marketplaces tab lists sources and dispatches addMarketplace', async () => {
    const rpc = rpcMock()
    await renderAsync({ rpc })
    await act(async () => { button('Marketplaces').click() })
    expect(document.querySelector('[data-testid="cc-marketplace"]')).not.toBeNull()
    expect(document.body.textContent).toContain('2 plugins')
    expect(document.body.textContent).toContain('last synced')
    expect(document.body.textContent).toContain('refresh automatically')
    const input = document.querySelector('[data-testid="cc-add-input"]') as HTMLInputElement
    await act(async () => { setValue(input, 'anthropics/claude-code') })
    await act(async () => { button('Add marketplace').click() })
    expect(rpc).toHaveBeenCalledWith('addMarketplace', { spec: 'anthropics/claude-code' })
  })

  it('shows the installed version and a card Update button when the catalog is newer', async () => {
    const rpc = rpcMock(stateWithInstall('1.1.0', true))
    await renderAsync({ rpc })
    const card = pluginCards()[0]
    expect(card.textContent).toContain('installed 1.0.0')
    const update = card.querySelector('[data-testid="cc-update"]') as HTMLButtonElement
    expect(update).not.toBeNull()
    await act(async () => { update.click() })
    expect(rpc).toHaveBeenCalledWith('updatePlugin', { key: 'github:o/r/team-tools' })
  })

  it('hides the card Update button while the installed version is current', async () => {
    await renderAsync({ rpc: rpcMock(stateWithInstall('1.0.0', false)) })
    const card = pluginCards()[0]
    expect(card.textContent).toContain('installed 1.0.0')
    expect(card.querySelector('[data-testid="cc-update"]')).toBeNull()
  })

  it('Models tab maps aliases onto runtime models and saves the merged map', async () => {
    const rpc = rpcMock()
    await renderAsync({ rpc })
    await act(async () => { button('Models').click() })
    const rows = [...container.querySelectorAll('[data-testid="cc-model-row"]')]
    expect(rows).toHaveLength(3)
    for (const alias of ['haiku', 'opus', 'sonnet']) {
      expect(rows.some((r) => (r.textContent ?? '').startsWith(alias)), `row for ${alias}`).toBe(true)
    }
    // The sonnet row carries the config-baseline chip and its saved selection.
    const sonnet = rows.find((r) => (r.textContent ?? '').startsWith('sonnet'))!
    expect(sonnet.textContent).toContain('config')
    expect((sonnet.querySelector('[data-testid="cc-model-select"]') as HTMLSelectElement).value).toBe('deepseek-v4-pro')
    // Pick a model for haiku; save sends only the drafted change.
    const haiku = rows.find((r) => (r.textContent ?? '').startsWith('haiku'))!
    await act(async () => { setSelect(haiku.querySelector('select')!, 'deepseek-v4-flash') })
    await act(async () => { button('Save model mappings').click() })
    expect(rpc).toHaveBeenCalledWith('setAgentModelOverrides', {
      map: { haiku: 'deepseek-v4-flash' },
    })
    expect(document.querySelector('[data-testid="cc-message"]')?.textContent).toContain('done')
  })

  it('Models tab saves inherit explicitly against a config baseline (no silent revert)', async () => {
    // Regression: choosing inherit on a config-mapped alias must persist an
    // explicit marker, not silently let the baseline re-assert itself.
    const state: CcState = {
      ...MODEL_STATE,
      installed: [],
      marketplaces: [],
    }
    const rpc = rpcMock(state)
    await renderAsync({ rpc })
    await act(async () => { button('Models').click() })
    const sonnet = [...container.querySelectorAll('[data-testid="cc-model-row"]')]
      .find((r) => (r.textContent ?? '').startsWith('sonnet'))!
    await act(async () => { setSelect(sonnet.querySelector('select')!, '') })
    await act(async () => { button('Save model mappings').click() })
    expect(rpc).toHaveBeenCalledWith('setAgentModelOverrides', { map: { sonnet: null } })

    // With the saved marker round-tripped, the select renders inherit — even
    // though the config baseline still maps the alias.
    const after: CcState = {
      ...state,
      agentModelMap: {},
      agentModelOverrides: { sonnet: null },
    }
    await act(async () => { render({ rpc: rpcMock(after) }) })
    await act(async () => { button('Models').click() })
    const sonnetAfter = [...container.querySelectorAll('[data-testid="cc-model-row"]')]
      .find((r) => (r.textContent ?? '').startsWith('sonnet'))!
    expect((sonnetAfter.querySelector('[data-testid="cc-model-select"]') as HTMLSelectElement).value).toBe('')
    // The baseline chip hides while the marker suppresses it.
    expect(sonnetAfter.textContent).not.toContain('config')
  })

  it('orders installed plugins first, then alphabetical by name', async () => {
    const names = ['zzz-live', 'mmm', 'aaa', 'bbb-live']
    const isInstalled = (name: string): boolean => name === 'zzz-live' || name === 'bbb-live'
    const state: CcState = {
      ...MODEL_STATE,
      installed: names.filter(isInstalled).map((name) => installedRecord({ key: `github:o/r/${name}`, pluginName: name })),
      marketplaces: [{
        ...STATE.marketplaces[0],
        plugins: names.map((name) => ({
          name,
          description: '',
          version: '',
          category: '',
          author: '',
          homepage: '',
          tags: [],
          installed: isInstalled(name),
        })),
      }],
    }
    await renderAsync({ rpc: rpcMock(state) })
    // The Add/Manage button's title is the plugin key: read the grid order.
    const order = pluginCards().map((c) => c.querySelector('[data-testid="cc-add"]')?.getAttribute('title'))
    expect(order).toEqual([
      'github:o/r/bbb-live', // installed group sorts by name asc
      'github:o/r/zzz-live',
      'github:o/r/aaa', // then the non-installed group, name asc
      'github:o/r/mmm',
    ])
  })

  it('Add modal installs to multiple selected targets', async () => {
    const rpc = rpcMock()
    const notify = vi.fn()
    await renderAsync({ rpc, notifyInstalledChanged: notify })
    await act(async () => { addButton('github:o/r/team-tools').click() })
    const modal = document.querySelector('[data-testid="cc-modal"]')
    expect(modal).not.toBeNull()
    expect(modal?.textContent).toContain('activate globally once')
    // Both targets selectable; footer reflects the count.
    const targets = [...container.querySelectorAll('[data-testid="cc-target"] input[type="checkbox"]')]
    expect(targets).toHaveLength(2)
    const footerAdd = () => document.querySelector('[data-testid="cc-modal-add"]') as HTMLButtonElement
    await act(async () => { check(targets[0], true) })
    expect(footerAdd().disabled).toBe(false)
    await act(async () => { check(targets[1], true) })
    expect(footerAdd().textContent).toBe('Add to 2 targets')
    expect(footerAdd().disabled).toBe(false)
    await act(async () => { footerAdd().click() })
    expect(rpc).toHaveBeenCalledWith('installPlugin', {
      marketplaceId: 'github:o/r',
      plugin: 'team-tools',
      targets: [{ scope: 'global' }, { scope: 'workspace', workspacePath: '/w1' }],
    })
    expect(notify).toHaveBeenCalled()
    expect(document.querySelector('[data-testid="cc-modal"]')).toBeNull()
  })

  it('Manage modal locks installed targets, uninstalls per target, and updates everywhere', async () => {
    const state: CcState = { ...STATE, installed: [installedRecord()] }
    const rpc = rpcMock(state)
    await renderAsync({ rpc })
    await act(async () => { addButton('github:o/r/team-tools').click() })
    const modal = document.querySelector('[data-testid="cc-modal"]')!
    // The global row is locked with an added badge and its own uninstall.
    const rows = [...container.querySelectorAll('[data-testid="cc-target"]')]
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('added')
    expect((rows[0].querySelector('input[type="checkbox"]') as HTMLInputElement).disabled).toBe(true)
    expect(rows[1].textContent).not.toContain('added')
    // The workspace row stays selectable for adding.
    expect((rows[1].querySelector('input[type="checkbox"]') as HTMLInputElement).disabled).toBe(false)
    // Update everywhere dispatches with the key.
    await act(async () => { button('Update everywhere').click() })
    expect(rpc).toHaveBeenCalledWith('updatePlugin', { key: 'github:o/r/team-tools' })
    // Per-target uninstall is a two-step confirm and sends the target.
    await act(async () => { addButton('github:o/r/team-tools').click() })
    await act(async () => { button('Uninstall').click() })
    await act(async () => { button('Confirm').click() })
    expect(rpc).toHaveBeenCalledWith('uninstallPlugin', {
      key: 'github:o/r/team-tools',
      target: { scope: 'global' },
    })
  })

  it('shows the mutation message and surfaces failures', async () => {
    await renderAsync()
    await act(async () => { button('Marketplaces').click() })
    await act(async () => { button('Refresh all').click() })
    expect(document.querySelector('[data-testid="cc-message"]')?.textContent).toContain('done')

    const rpc = vi.fn<RpcFn>(async (method: string) => {
      if (method === 'getState') return STATE
      return { ok: false, error: 'boom' }
    })
    await renderAsync({ rpc })
    await act(async () => { button('Marketplaces').click() })
    await act(async () => { button('Refresh all').click() })
    expect(document.querySelector('[data-testid="cc-message"]')?.textContent).toContain('boom')
  })

  it('surfaces thrown RPC errors from load and mutations', async () => {
    const rpc = vi.fn<RpcFn>(async () => { throw new Error('network down') })
    await renderAsync({ rpc })
    expect(document.querySelector('[data-testid="cc-message"]')?.textContent).toContain('network down')

    const rpc2 = vi.fn<RpcFn>(async (method: string) => {
      if (method === 'getState') return STATE
      throw new Error('rpc exploded')
    })
    await renderAsync({ rpc: rpc2 })
    await act(async () => { button('Marketplaces').click() })
    await act(async () => { button('Refresh all').click() })
    expect(document.querySelector('[data-testid="cc-message"]')?.textContent).toContain('rpc exploded')
  })

  it('combines filters and shows the no-match empty state', async () => {
    const state: CcState = { ...STATE, installed: [installedRecord()] }
    await renderAsync({ rpc: rpcMock(state) })
    // Search matches names, descriptions, and marketplace names.
    const search = document.querySelector('[data-testid="cc-search"]')!
    await act(async () => { setValue(search, 'very specific') })
    expect(pluginCards()).toHaveLength(1) // description match
    await act(async () => { setValue(search, 'other-mkt') })
    expect(pluginCards()).toHaveLength(1) // marketplace name match
    await act(async () => { setValue(search, 'nothing matches this') })
    expect(pluginCards()).toHaveLength(0)
    expect(document.querySelector('[data-testid="cc-empty"]')?.textContent).toContain('No plugins match')

    // Filters stack: provider + installed-only leaves nothing while search
    // still excludes the installed plugin.
    await act(async () => { setValue(search, '') })
    const provider = document.querySelector('[data-testid="cc-provider"]') as HTMLSelectElement
    await act(async () => { setSelect(provider, 'github:o/other') })
    const toggle = document.querySelector('[data-testid="cc-installed-only"]')!
    await act(async () => { check(toggle, true) })
    expect(pluginCards()).toHaveLength(0)
    // Clearing the provider filter brings the installed card back.
    await act(async () => { setSelect(provider, '') })
    expect(pluginCards()).toHaveLength(1)
    expect(pluginCards()[0].textContent).toContain('team-tools')
  })

  it('modal closes via Cancel, Escape, and overlay click, resetting the draft', async () => {
    await renderAsync()
    await act(async () => { addButton('github:o/r/team-tools').click() })
    const modal = () => document.querySelector('[data-testid="cc-modal"]')
    expect(modal()).not.toBeNull()

    // Footer Add is disabled until at least one target is selected.
    const footerAdd = () => document.querySelector('[data-testid="cc-modal-add"]') as HTMLButtonElement
    expect(footerAdd().disabled).toBe(true)

    await act(async () => { button('Cancel').click() })
    expect(modal()).toBeNull()

    // Escape closes too.
    await act(async () => { addButton('github:o/r/team-tools').click() })
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(modal()).toBeNull()

    // Clicking the scrim (the overlay around the dialog) closes.
    await act(async () => { addButton('github:o/r/team-tools').click() })
    await act(async () => { (modal()!.parentElement as HTMLElement).click() })
    expect(modal()).toBeNull()

    // The selection draft did not leak into the next open.
    await act(async () => { addButton('github:o/r/team-tools').click() })
    expect(footerAdd().disabled).toBe(true)
  })

  it('footer reflects selecting then deselecting targets', async () => {
    await renderAsync()
    await act(async () => { addButton('github:o/r/team-tools').click() })
    const footerAdd = () => document.querySelector('[data-testid="cc-modal-add"]') as HTMLButtonElement
    const boxes = [...container.querySelectorAll('[data-testid="cc-target"] input[type="checkbox"]')]
    await act(async () => { check(boxes[0], true) })
    expect(footerAdd().textContent).toBe('Add')
    expect(footerAdd().disabled).toBe(false)
    await act(async () => { check(boxes[1], true) })
    expect(footerAdd().textContent).toBe('Add to 2 targets')
    await act(async () => { check(boxes[0], false) })
    expect(footerAdd().textContent).toBe('Add')
    await act(async () => { check(boxes[1], false) })
    expect(footerAdd().disabled).toBe(true)
  })

  it('modal title shows the installed and available versions on an update', async () => {
    await renderAsync({ rpc: rpcMock(stateWithInstall('1.1.0', true)) })
    await act(async () => { addButton('github:o/r/team-tools').click() })
    const title = document.querySelector('[data-testid="cc-modal"]')?.querySelector('p')?.textContent ?? ''
    expect(title).toContain('team-tools')
    expect(title).toContain('(installed 1.0.0)')
    expect(title).toContain('1.1.0 available')
  })

  it('Marketplaces tab: Enter submits, empty input disables Add, Remove dispatches, Refresh disabled without sources', async () => {
    const rpc = rpcMock()
    await renderAsync({ rpc })
    await act(async () => { button('Marketplaces').click() })
    const input = document.querySelector('[data-testid="cc-add-input"]') as HTMLInputElement
    expect(button('Add marketplace').disabled).toBe(true)
    await act(async () => { setValue(input, 'anthropics/claude-code') })
    expect(button('Add marketplace').disabled).toBe(false)
    await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    expect(rpc).toHaveBeenCalledWith('addMarketplace', { spec: 'anthropics/claude-code' })

    await act(async () => { button('Remove').click() })
    expect(rpc).toHaveBeenCalledWith('removeMarketplace', { marketplaceId: 'github:o/r' })

    // No sources configured: Refresh all is disabled and the empty state shows.
    await renderAsync({ rpc: rpcMock({ ...MODEL_STATE, installed: [], marketplaces: [] }) })
    await act(async () => { button('Marketplaces').click() })
    expect(button('Refresh all').disabled).toBe(true)
    expect(document.body.textContent).toContain('No marketplaces added yet')
  })

  it('locks every card action while a mutation is in flight', async () => {
    let resolveUpdate: (value: unknown) => void = () => {}
    const state = stateWithInstall('1.1.0', true)
    const rpc = vi.fn<RpcFn>(async (method: string) => {
      if (method === 'getState') return state
      if (method === 'updatePlugin') return new Promise((resolve) => { resolveUpdate = resolve })
      const result: MutationResult = { ok: true, message: 'done', state }
      return result
    })
    await renderAsync({ rpc })
    const card = pluginCards()[0]
    await act(async () => { (card.querySelector('[data-testid="cc-update"]') as HTMLElement).click() })
    // While the update hangs: every card button is disabled.
    await act(async () => {})
    const disabledAdds = [...container.querySelectorAll('[data-testid="cc-add"]')].every((b) => (b as HTMLButtonElement).disabled)
    const disabledUpdates = [...container.querySelectorAll('[data-testid="cc-update"]')].every((b) => (b as HTMLButtonElement).disabled)
    expect(disabledAdds).toBe(true)
    expect(disabledUpdates).toBe(true)

    await act(async () => { resolveUpdate({ ok: true, message: 'updated to 1.1.0', state }) })
    await act(async () => {})
    expect(document.querySelector('[data-testid="cc-message"]')?.textContent).toContain('updated to 1.1.0')
    expect([...container.querySelectorAll('[data-testid="cc-add"]')].every((b) => (b as HTMLButtonElement).disabled)).toBe(false)
  })

  it('notifies the browser catalog after uninstall and update mutations', async () => {
    const state = stateWithInstall('1.1.0', true)
    const rpc = rpcMock(state)
    const notify = vi.fn()
    await renderAsync({ rpc, notifyInstalledChanged: notify })
    const card = pluginCards()[0]
    await act(async () => { (card.querySelector('[data-testid="cc-update"]') as HTMLElement).click() })
    expect(notify).toHaveBeenCalledTimes(1)

    await act(async () => { addButton('github:o/r/team-tools').click() })
    await act(async () => { button('Uninstall').click() })
    await act(async () => { button('Confirm').click() })
    expect(notify).toHaveBeenCalledTimes(2)
  })

  it('Models tab renders an unknown current value as its own option', async () => {
    const state: CcState = {
      ...MODEL_STATE,
      agentModelMap: { sonnet: 'mystery-model' },
      agentModelConfig: { sonnet: 'mystery-model' },
      agentModelOverrides: { sonnet: 'mystery-model' },
      installed: [],
      marketplaces: [],
    }
    await renderAsync({ rpc: rpcMock(state) })
    await act(async () => { button('Models').click() })
    const sonnet = [...container.querySelectorAll('[data-testid="cc-model-row"]')]
      .find((r) => (r.textContent ?? '').startsWith('sonnet'))!
    const select = sonnet.querySelector('[data-testid="cc-model-select"]') as HTMLSelectElement
    expect(select.value).toBe('mystery-model')
    const option = [...select.querySelectorAll('option')].find((o) => o.value === 'mystery-model')
    expect(option).toBeDefined()
    expect(option?.textContent).toBe('mystery-model')
  })
})

describe('presenceLabel', () => {
  const WS: WorkspaceRow[] = [{ id: 'w1', title: 'Project One', path: '/w1' }]

  it('names global and registered workspaces', () => {
    expect(presenceLabel(installedRecord(), WS)).toBe('in global')
    expect(presenceLabel(installedRecord({
      targets: [{ scope: 'workspace', workspacePath: '/w1', skills: [] }],
    }), WS)).toBe('in Project One')
  })

  it('falls back to a generic label for workspaces the registry no longer has', () => {
    expect(presenceLabel(installedRecord({
      targets: [{ scope: 'workspace', workspacePath: '/gone', skills: [] }],
    }), WS)).toBe('in workspace')
  })

  it('says installed when a record somehow has no targets', () => {
    expect(presenceLabel(installedRecord({ targets: [] }), WS)).toBe('installed')
  })
})

describe('formatLastSync', () => {
  const NOW = Date.parse('2026-09-02T12:00:00.000Z')

  it('labels missing and invalid stamps', () => {
    expect(formatLastSync('', NOW)).toBe('never')
    expect(formatLastSync('not-a-date', NOW)).toBe('unknown')
  })

  it('uses relative bands and falls back to the date beyond a week', () => {
    expect(formatLastSync(new Date(NOW - 30_000).toISOString(), NOW)).toBe('just now')
    expect(formatLastSync(new Date(NOW - 5 * 60_000).toISOString(), NOW)).toBe('5m ago')
    expect(formatLastSync(new Date(NOW - 3 * 3_600_000).toISOString(), NOW)).toBe('3h ago')
    expect(formatLastSync(new Date(NOW - 2 * 86_400_000).toISOString(), NOW)).toBe('2d ago')
    expect(formatLastSync(new Date(NOW - 30 * 86_400_000).toISOString(), NOW)).toBe('2026-08-03')
  })
})

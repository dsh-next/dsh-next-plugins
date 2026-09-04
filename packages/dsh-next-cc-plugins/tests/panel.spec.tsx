/**
 * jsdom render test for the Claude Plugins settings panel: proves the three
 * tabs (Plugins grid with search/provider/installed filters, Marketplaces
 * sources, Models aliases) and the scope modal's radio flows (Global default /
 * Workspaces checklist; install, re-scope, update, two-step uninstall)
 * dispatch the right RPC calls. This complements the Host RPC contract test
 * (shape) and the real-mount e2e marker (whole shell).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { CcState, InstalledPlugin, MarketplacePluginView, MutationResult, WorkspaceRow } from '../src/core/types.ts'
import { CcPanel, formatLastSync, inventorySummary, presenceLabel, unbridgedSummary } from '../src/client/CcPanel.tsx'
import { interpolate, zh } from '../src/client/dictionaries.ts'

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
            unbridged: {},
            dependencies: [],
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
    scope: { kind: 'global' },
    skills: [{ name: 'deploy', directory: '/home/u/.agents/skills/deploy' }],
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
      t: deps.t,
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

/** The card's scope-opening button (Install when absent, Scopes when
 *  installed); buttons carry the plugin key as their title. */
function scopeButton(key: string): HTMLElement {
  const el = [...container.querySelectorAll('[data-testid="cc-install"], [data-testid="cc-scopes"]')].find((b) => b.getAttribute('title') === key)
  expect(el, `scope button for ${key}`).toBeDefined()
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
    // The unsupported source explains itself and renders a disabled Install.
    expect(document.body.textContent).toContain('npm plugin sources are not supported yet')
    const installs = [...container.querySelectorAll('[data-testid="cc-install"]')].filter((b) => b.textContent === 'Install')
    expect(installs).toHaveLength(3)
    const disabled = installs.find((b) => (b as HTMLButtonElement).disabled)
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
    // The installed card carries the presence badge and a Scopes button.
    expect(pluginCards()[0].textContent).toContain('in global')
    expect(pluginCards()[0].querySelector('[data-testid="cc-scopes"]')).not.toBeNull()
  })

  it('surfaces imports the settings file could not satisfy on this machine', async () => {
    const state: CcState = {
      ...MODEL_STATE,
      installed: [],
      marketplaces: [],
      importSkipped: ['plugin team-tools: no workspace "web" registered on this machine'],
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

  it('removing a marketplace confirms through a modal before the RPC', async () => {
    const rpc = rpcMock()
    await renderAsync({ rpc })
    await act(async () => { button('Marketplaces').click() })
    await act(async () => { button('Remove').click() })
    const confirmModal = document.querySelector('[data-testid="cc-marketplace-remove-modal"]')!
    expect(confirmModal.textContent).toContain('Remove acme-tools?')
    expect(confirmModal.textContent).toContain('Installed plugins stay installed')
    expect(confirmModal.textContent).toContain('o/r')
    // Cancel closes without dispatching.
    await act(async () => { (document.querySelector('[data-testid="cc-marketplace-remove-cancel"]') as HTMLButtonElement).click() })
    expect(document.querySelector('[data-testid="cc-marketplace-remove-modal"]')).toBeNull()
    expect(rpc).not.toHaveBeenCalledWith('removeMarketplace', { marketplaceId: 'github:o/r' })
    // Confirming dispatches with the marketplace id.
    await act(async () => { button('Remove').click() })
    await act(async () => { (document.querySelector('[data-testid="cc-marketplace-remove-confirm"]') as HTMLButtonElement).click() })
    expect(rpc).toHaveBeenCalledWith('removeMarketplace', { marketplaceId: 'github:o/r' })
    expect(document.querySelector('[data-testid="cc-marketplace-remove-modal"]')).toBeNull()
  })

  it('renders the harness scaffold: title, intro, and the labeled tablist', async () => {
    await renderAsync()
    expect(container.querySelector('h2')?.textContent).toBe('Claude Plugins')
    const intro = [...container.querySelectorAll('p')]
      .find((p) => p.textContent === 'Install plugins from Claude Code marketplaces and control where each one works.')
    expect(intro, 'the intro line should render under the title').toBeTruthy()
    expect(container.querySelector('[role="tablist"]')?.getAttribute('aria-label')).toBe('Plugin views')
  })

  it('the tab strip roves: End jumps to the last tab and ArrowLeft steps back', async () => {
    await renderAsync()
    const tablist = container.querySelector('[role="tablist"]') as HTMLElement
    const tabs = [...tablist.querySelectorAll('[role="tab"]')] as HTMLButtonElement[]
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Plugins', 'Marketplaces', 'Models'])
    expect(tabs[0]!.tabIndex).toBe(0)
    expect(tabs[1]!.tabIndex).toBe(-1)
    expect(tabs[2]!.tabIndex).toBe(-1)
    await act(async () => { tablist.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })) })
    expect(tabs[2]!.getAttribute('aria-selected')).toBe('true')
    expect(tabs[2]!.tabIndex).toBe(0)
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('false')
    expect(document.activeElement).toBe(tabs[2])
    await act(async () => { tablist.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })) })
    expect(tabs[1]!.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(tabs[1])
  })

  it('a mutation result with no error text falls back to the localized Request failed', async () => {
    const rpc = vi.fn<RpcFn>(async (method: string) => {
      if (method === 'getState') return STATE
      return { ok: false }
    }) as RpcFn & ReturnType<typeof vi.fn>
    await renderAsync({ rpc })
    await act(async () => { button('Marketplaces').click() })
    const input = document.querySelector('[data-testid="cc-add-input"]') as HTMLInputElement
    await act(async () => { setValue(input, 'anthropics/claude-code') })
    await act(async () => { button('Add marketplace').click() })
    expect(document.querySelector('[data-testid="cc-message"]')?.textContent).toBe('Request failed')
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
    // The scope-opening button's title is the plugin key: read the grid order.
    const order = pluginCards().map((c) => c.querySelector('[data-testid="cc-install"], [data-testid="cc-scopes"]')?.getAttribute('title'))
    expect(order).toEqual([
      'github:o/r/bbb-live', // installed group sorts by name asc
      'github:o/r/zzz-live',
      'github:o/r/aaa', // then the non-installed group, name asc
      'github:o/r/mmm',
    ])
  })

  it('scope modal installs globally by default and into checked workspaces when selected', async () => {
    const rpc = rpcMock()
    const notify = vi.fn()
    await renderAsync({ rpc, notifyInstalledChanged: notify })
    await act(async () => { scopeButton('github:o/r/team-tools').click() })
    const modal = document.querySelector('[data-testid="cc-modal"]')
    expect(modal).not.toBeNull()
    expect(modal?.textContent).toContain('activate once regardless of scope')
    // Global is the default: no checklist renders, confirm is enabled.
    expect((modal?.querySelector('[data-testid="cc-scope-global"] input') as HTMLInputElement).checked).toBe(true)
    expect(document.querySelector('[data-testid="cc-workspaces"]')).toBeNull()
    const confirm = () => document.querySelector('[data-testid="cc-modal-confirm"]') as HTMLButtonElement
    expect(confirm().disabled).toBe(false)
    await act(async () => { confirm().click() })
    expect(rpc).toHaveBeenCalledWith('installPlugin', {
      marketplaceId: 'github:o/r',
      plugin: 'team-tools',
      scope: { kind: 'global' },
    })
    expect(notify).toHaveBeenCalled()
    expect(document.querySelector('[data-testid="cc-modal"]')).toBeNull()

    // Workspaces mode: the checklist appears and the selection rides along.
    await act(async () => { scopeButton('github:o/r/team-tools').click() })
    await act(async () => { (document.querySelector('[data-testid="cc-scope-workspaces"] input') as HTMLInputElement).click() })
    const boxes = [...container.querySelectorAll('[data-testid="cc-workspace"] input[type="checkbox"]')]
    expect(boxes).toHaveLength(1) // Project One
    expect(confirm().disabled).toBe(true) // nothing checked yet
    await act(async () => { check(boxes[0], true) })
    expect(confirm().disabled).toBe(false)
    await act(async () => { confirm().click() })
    expect(rpc).toHaveBeenLastCalledWith('installPlugin', {
      marketplaceId: 'github:o/r',
      plugin: 'team-tools',
      scope: { kind: 'workspaces', workspacePaths: ['/w1'] },
    })
  })

  it('Scopes modal reflects the current scope; Update and Uninstall live on the card', async () => {
    const state = stateWithInstall('1.1.0', true)
    const rpc = rpcMock(state)
    await renderAsync({ rpc })
    await act(async () => { scopeButton('github:o/r/team-tools').click() })
    const modal = document.querySelector('[data-testid="cc-modal"]')!
    // Installed: the footer offers only Save scope — Update and Uninstall
    // ride the card now, not the modal.
    expect(modal.textContent).toContain('Save scope')
    expect(modal.textContent).not.toContain('Uninstall')
    expect([...container.querySelectorAll('button')].some((b) => b.textContent === 'Update' && modal.contains(b))).toBe(false)
    // A global record opens on the global radio.
    expect((modal.querySelector('[data-testid="cc-scope-global"] input') as HTMLInputElement).checked).toBe(true)
    // Switch to workspaces and save: re-scope dispatches with the key.
    await act(async () => { (modal.querySelector('[data-testid="cc-scope-workspaces"] input') as HTMLInputElement).click() })
    const boxes = [...container.querySelectorAll('[data-testid="cc-workspace"] input[type="checkbox"]')]
    await act(async () => { check(boxes[0], true) })
    await act(async () => { (document.querySelector('[data-testid="cc-modal-confirm"]') as HTMLButtonElement).click() })
    expect(rpc).toHaveBeenCalledWith('setPluginScope', {
      key: 'github:o/r/team-tools',
      scope: { kind: 'workspaces', workspacePaths: ['/w1'] },
    })
    // Update rides the card and dispatches with the key.
    await act(async () => { (pluginCards()[0].querySelector('[data-testid="cc-update"]') as HTMLElement).click() })
    expect(rpc).toHaveBeenCalledWith('updatePlugin', { key: 'github:o/r/team-tools' })
    // Uninstall is a two-step confirm modal opened from the card; cancel
    // closes it without dispatching.
    await act(async () => { (pluginCards()[0].querySelector('[data-testid="cc-uninstall"]') as HTMLElement).click() })
    const confirmModal = document.querySelector('[data-testid="cc-uninstall-modal"]')!
    expect(confirmModal.textContent).toContain('Uninstall team-tools?')
    await act(async () => { (document.querySelector('[data-testid="cc-uninstall-cancel"]') as HTMLButtonElement).click() })
    expect(document.querySelector('[data-testid="cc-uninstall-modal"]')).toBeNull()
    expect(rpc).not.toHaveBeenCalledWith('uninstallPlugin', { key: 'github:o/r/team-tools' })
    // Confirming dispatches with the key.
    await act(async () => { (pluginCards()[0].querySelector('[data-testid="cc-uninstall"]') as HTMLElement).click() })
    await act(async () => { (document.querySelector('[data-testid="cc-uninstall-confirm"]') as HTMLButtonElement).click() })
    expect(rpc).toHaveBeenCalledWith('uninstallPlugin', { key: 'github:o/r/team-tools' })
    expect(document.querySelector('[data-testid="cc-uninstall-modal"]')).toBeNull()
  })

  it('Scopes modal opens on the record\'s workspace scope, listing unregistered paths', async () => {
    const state: CcState = {
      ...STATE,
      installed: [installedRecord({
        scope: { kind: 'workspaces', workspacePaths: ['/w1', '/gone'] },
        skills: [
          { name: 'deploy', directory: '/w1/.agents/skills/deploy' },
          { name: 'deploy', directory: '/gone/.agents/skills/deploy' },
        ],
      })],
    }
    await renderAsync({ rpc: rpcMock(state) })
    await act(async () => { scopeButton('github:o/r/team-tools').click() })
    const modal = document.querySelector('[data-testid="cc-modal"]')!
    expect((modal.querySelector('[data-testid="cc-scope-workspaces"] input') as HTMLInputElement).checked).toBe(true)
    const rows = [...container.querySelectorAll('[data-testid="cc-workspace"]')]
    expect(rows).toHaveLength(2)
    const gone = rows.find((r) => (r.textContent ?? '').includes('/gone'))!
    expect(gone.textContent).toContain('not registered')
    expect((gone.querySelector('input') as HTMLInputElement).checked).toBe(true)
    const w1 = rows.find((r) => (r.textContent ?? '').includes('Project One'))!
    expect((w1.querySelector('input') as HTMLInputElement).checked).toBe(true)
  })

  it('shows the mutation message and surfaces failures', async () => {
    await renderAsync()
    await act(async () => { button('Marketplaces').click() })
    await act(async () => { button('Remove').click() })
    await act(async () => { (document.querySelector('[data-testid="cc-marketplace-remove-confirm"]') as HTMLButtonElement).click() })
    expect(document.querySelector('[data-testid="cc-message"]')?.textContent).toContain('done')

    const rpc = vi.fn<RpcFn>(async (method: string) => {
      if (method === 'getState') return STATE
      return { ok: false, error: 'boom' }
    })
    await renderAsync({ rpc })
    await act(async () => { button('Marketplaces').click() })
    await act(async () => { button('Remove').click() })
    await act(async () => { (document.querySelector('[data-testid="cc-marketplace-remove-confirm"]') as HTMLButtonElement).click() })
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
    await act(async () => { scopeButton('github:o/r/team-tools').click() })
    const modal = () => document.querySelector('[data-testid="cc-modal"]')
    expect(modal()).not.toBeNull()

    // Draft something worth resetting: workspaces mode with a checked row.
    await act(async () => { (modal()!.querySelector('[data-testid="cc-scope-workspaces"] input') as HTMLInputElement).click() })
    const boxes = [...container.querySelectorAll('[data-testid="cc-workspace"] input[type="checkbox"]')]
    await act(async () => { check(boxes[0], true) })

    await act(async () => { button('Cancel').click() })
    expect(modal()).toBeNull()

    // Escape closes too.
    await act(async () => { scopeButton('github:o/r/team-tools').click() })
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(modal()).toBeNull()

    // Clicking the scrim (the overlay around the dialog) closes.
    await act(async () => { scopeButton('github:o/r/team-tools').click() })
    await act(async () => { (modal()!.parentElement as HTMLElement).click() })
    expect(modal()).toBeNull()

    // The draft did not leak: global is the default again, nothing checked.
    await act(async () => { scopeButton('github:o/r/team-tools').click() })
    expect((modal()!.querySelector('[data-testid="cc-scope-global"] input') as HTMLInputElement).checked).toBe(true)
    expect(document.querySelector('[data-testid="cc-workspaces"]')).toBeNull()
  })

  it('confirm stays disabled until a workspaces selection exists', async () => {
    await renderAsync()
    await act(async () => { scopeButton('github:o/r/team-tools').click() })
    const confirm = () => document.querySelector('[data-testid="cc-modal-confirm"]') as HTMLButtonElement
    // Global default: enabled.
    expect(confirm().disabled).toBe(false)
    await act(async () => { (document.querySelector('[data-testid="cc-scope-workspaces"] input') as HTMLInputElement).click() })
    expect(confirm().disabled).toBe(true)
    const boxes = () => [...container.querySelectorAll('[data-testid="cc-workspace"] input[type="checkbox"]')]
    await act(async () => { check(boxes()[0], true) })
    expect(confirm().disabled).toBe(false)
    await act(async () => { check(boxes()[0], false) })
    expect(confirm().disabled).toBe(true)
  })

  it('modal title shows the installed and available versions on an update', async () => {
    await renderAsync({ rpc: rpcMock(stateWithInstall('1.1.0', true)) })
    await act(async () => { scopeButton('github:o/r/team-tools').click() })
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
    await act(async () => { (document.querySelector('[data-testid="cc-marketplace-remove-confirm"]') as HTMLButtonElement).click() })
    expect(rpc).toHaveBeenCalledWith('removeMarketplace', { marketplaceId: 'github:o/r' })

    // No sources configured: Refresh all is disabled and the empty state shows.
    await renderAsync({ rpc: rpcMock({ ...MODEL_STATE, installed: [], marketplaces: [] }) })
    await act(async () => { button('Marketplaces').click() })
    expect(button('Refresh all').disabled).toBe(true)
    expect(document.body.textContent).toContain('No marketplaces added yet')
  })

  it('Refresh all runs one marketplace at a time, swapping the active row\'s Remove for a spinner', async () => {
    const pending: Array<(value: unknown) => void> = []
    const rpc = vi.fn<RpcFn>(async (method: string) => {
      if (method === 'getState') return STATE
      if (method === 'refreshMarketplace') return new Promise((resolve) => { pending.push(resolve) })
      const result: MutationResult = { ok: true, message: 'done', state: STATE }
      return result
    })
    await renderAsync({ rpc })
    await act(async () => { button('Marketplaces').click() })
    await act(async () => { button('Refresh all').click() })

    // First marketplace in flight: its Remove is the spinner, the second
    // row keeps its Remove, and the button counts progress.
    const rows = () => [...container.querySelectorAll('[data-testid="cc-marketplace"]')]
    expect(rpc).toHaveBeenCalledWith('refreshMarketplace', { marketplaceId: 'github:o/r' })
    expect(rows()[0].querySelector('[data-testid="cc-marketplace-refreshing"]')?.textContent).toContain('Refreshing')
    expect(rows()[0].querySelector('[data-testid="cc-marketplace-remove"]')).toBeNull()
    expect(rows()[1].querySelector('[data-testid="cc-marketplace-remove"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="cc-marketplace-refresh-all"]')?.textContent).toBe('Refreshing 1/2…')

    // First resolves: it gets its Remove back and the spinner moves on.
    await act(async () => { pending[0]({ ok: true, message: 'refreshed marketplace "acme-tools"', state: STATE }) })
    expect(rpc).toHaveBeenCalledWith('refreshMarketplace', { marketplaceId: 'github:o/other' })
    expect(rows()[0].querySelector('[data-testid="cc-marketplace-remove"]')).not.toBeNull()
    expect(rows()[1].querySelector('[data-testid="cc-marketplace-refreshing"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="cc-marketplace-refresh-all"]')?.textContent).toBe('Refreshing 2/2…')

    // A failing second marketplace names it in the summary; the sequence
    // still finished, so every spinner is gone.
    await act(async () => { pending[1]({ ok: false, error: 'refreshing "o/other" failed: HTTP 500', state: STATE }) })
    expect(document.querySelector('[data-testid="cc-marketplace-refreshing"]')).toBeNull()
    const message = document.querySelector('[data-testid="cc-message"]')?.textContent ?? ''
    expect(message).toContain('Refresh failed for 1 marketplace(s)')
    expect(message).toContain('other-mkt: refreshing "o/other" failed: HTTP 500')
  })

  it('Refresh all summarizes success when every marketplace re-syncs', async () => {
    const rpc = rpcMock()
    await renderAsync({ rpc })
    await act(async () => { button('Marketplaces').click() })
    await act(async () => { button('Refresh all').click() })
    expect(rpc).toHaveBeenCalledWith('refreshMarketplace', { marketplaceId: 'github:o/r' })
    expect(rpc).toHaveBeenCalledWith('refreshMarketplace', { marketplaceId: 'github:o/other' })
    expect(document.querySelector('[data-testid="cc-message"]')?.textContent).toContain('Refreshed 2 marketplace(s)')
    expect(document.querySelector('[data-testid="cc-marketplace-refreshing"]')).toBeNull()
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
    const disabledAdds = [...container.querySelectorAll('[data-testid="cc-install"], [data-testid="cc-scopes"]')].every((b) => (b as HTMLButtonElement).disabled)
    const disabledUpdates = [...container.querySelectorAll('[data-testid="cc-update"]')].every((b) => (b as HTMLButtonElement).disabled)
    expect(disabledAdds).toBe(true)
    expect(disabledUpdates).toBe(true)

    await act(async () => { resolveUpdate({ ok: true, message: 'updated to 1.1.0', state }) })
    await act(async () => {})
    expect(document.querySelector('[data-testid="cc-message"]')?.textContent).toContain('updated to 1.1.0')
    expect([...container.querySelectorAll('[data-testid="cc-install"], [data-testid="cc-scopes"]')].every((b) => (b as HTMLButtonElement).disabled)).toBe(false)
  })

  it('notifies the browser catalog after uninstall and update mutations', async () => {
    const state = stateWithInstall('1.1.0', true)
    const rpc = rpcMock(state)
    const notify = vi.fn()
    await renderAsync({ rpc, notifyInstalledChanged: notify })
    const card = pluginCards()[0]
    await act(async () => { (card.querySelector('[data-testid="cc-update"]') as HTMLElement).click() })
    expect(notify).toHaveBeenCalledTimes(1)

    await act(async () => { scopeButton('github:o/r/team-tools').click() })
    await act(async () => { button('Uninstall').click() })
    await act(async () => { (document.querySelector('[data-testid="cc-uninstall-confirm"]') as HTMLButtonElement).click() })
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

  it('labels the global scope', () => {
    expect(presenceLabel(installedRecord(), WS)).toBe('in global')
  })

  it('names registered workspaces and falls back to the folder for unknown paths', () => {
    expect(presenceLabel(installedRecord({
      scope: { kind: 'workspaces', workspacePaths: ['/w1', '/gone'] },
    }), WS)).toBe('in Project One, gone')
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

describe('unbridged summaries', () => {
  it('inventorySummary appends the not-bridged group after bridged counts', () => {
    const summary = inventorySummary({
      skills: [{ name: 'a', description: '', path: 'skills/a' }],
      commands: [],
      agents: [],
      hookEvents: [],
      mcpServers: [],
      unbridged: { lspServers: 2, monitors: 1 },
      dependencies: [],
      notes: [],
    })
    expect(summary).toBe('1 skill, not bridged: 2 LSP servers, 1 monitor')
  })

  it('unbridgedSummary renders singular and plural labels per family', () => {
    expect(unbridgedSummary({ themes: 1 })).toBe('not bridged: 1 theme')
    expect(unbridgedSummary({ outputStyles: 2, executables: 3 })).toBe('not bridged: 2 output styles, 3 executables')
    expect(unbridgedSummary({ settings: 1 })).toBe('not bridged: 1 settings file')
  })

  it('unbridgedSummary is empty for an empty or zero-valued map', () => {
    expect(unbridgedSummary({})).toBe('')
    expect(unbridgedSummary({ monitors: 0 })).toBe('')
  })
})

describe('dependency chip in summaries', () => {
  it('inventorySummary lists required plugins last', () => {
    const summary = inventorySummary({
      skills: [{ name: 'a', description: '', path: 'skills/a' }],
      commands: [],
      agents: [],
      hookEvents: [],
      mcpServers: [],
      unbridged: {},
      dependencies: ['secrets-vault@~2.1.0', 'helper-lib'],
      notes: [],
    })
    expect(summary).toBe('1 skill, requires: secrets-vault@~2.1.0, helper-lib')
  })
})

describe('install-notes chip', () => {
  it('shows a notes chip with a hover list when the record carries notes', async () => {
    await renderAsync({ rpc: rpcMock({
      ...STATE,
      installed: [installedRecord({ notes: ['ships 1 LSP server; no DSH bridge, not installed', 'MCP server "x" renamed to "y"'] })],
    }) })
    const chip = container.querySelector('[data-testid="cc-notes-chip"]') as HTMLElement | null
    expect(chip).not.toBeNull()
    expect(chip?.textContent).toBe('2 install notes')
    expect(chip?.getAttribute('title')).toContain('ships 1 LSP server')
  })

  it('hides the chip without notes; a single note reads singular', async () => {
    await renderAsync({ rpc: rpcMock({ ...STATE, installed: [installedRecord()] }) })
    expect(container.querySelector('[data-testid="cc-notes-chip"]')).toBeNull()
    await act(async () => { root?.unmount(); document.body.appendChild(container); root = createRoot(container) })
    await renderAsync({ rpc: rpcMock({ ...STATE, installed: [installedRecord({ notes: ['only note'] })] }) })
    expect(container.querySelector('[data-testid="cc-notes-chip"]')?.textContent).toBe('1 install note')
  })
})

describe('plugin detail modal', () => {
  it('opens from the card name and lists metadata, components, and notes', async () => {
    const state: CcState = {
      ...STATE,
      installed: [installedRecord({ notes: ['ships 1 LSP server; no DSH bridge, not installed'] })],
    }
    await renderAsync({ rpc: rpcMock(state) })
    await act(async () => { button('team-tools').click() })
    const modal = container.querySelector('[data-testid="cc-plugin-detail"]')
    expect(modal).not.toBeNull()
    expect(modal?.textContent).toContain('version 1.0.0')
    expect(modal?.textContent).toContain('installed 1.0.0')
    expect(modal?.textContent).toContain('from acme')
    const components = container.querySelector('[data-testid="cc-detail-components"]')
    expect(components?.textContent).toContain('skills: deploy')
    expect(components?.textContent).toContain('commands: ship')
    expect(components?.textContent).toContain('MCP servers: linear')
    expect(components?.textContent).toContain('hook events: Stop')
    const notes = container.querySelector('[data-testid="cc-detail-notes"]')
    expect(notes?.textContent).toContain('ships 1 LSP server')
    // Close via the button.
    await act(async () => { (container.querySelector('[data-testid="cc-detail-close"]') as HTMLButtonElement).click() })
    expect(container.querySelector('[data-testid="cc-plugin-detail"]')).toBeNull()
  })

  it('closes on Escape and the overlay, and shows source/resolve fallbacks', async () => {
    await renderAsync()
    // npm-source plugin: detail explains why it is not installable.
    await act(async () => { button('packed').click() })
    let modal = container.querySelector('[data-testid="cc-plugin-detail"]')
    expect(modal?.textContent).toContain('not installable: npm plugin sources are not supported yet')
    await act(async () => { (container.querySelector('[data-testid="cc-detail-close"]') as HTMLButtonElement).click() })
    // github-source plugin without an inventory snapshot.
    await act(async () => { button('searchable-thing').click() })
    modal = container.querySelector('[data-testid="cc-plugin-detail"]')
    expect(modal?.textContent).toContain('components resolve on install')
    // Escape closes.
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(container.querySelector('[data-testid="cc-plugin-detail"]')).toBeNull()
    // Overlay click closes too.
    await act(async () => { button('searchable-thing').click() })
    await act(async () => { (container.querySelector('[data-testid="cc-plugin-detail"]')?.parentElement as HTMLElement).click() })
    expect(container.querySelector('[data-testid="cc-plugin-detail"]')).toBeNull()
  })

  it('reports unbridged families and dependencies in the component listing', async () => {
    const state: CcState = {
      ...STATE,
      marketplaces: STATE.marketplaces.map((m, i) => i === 0 ? {
        ...m,
        plugins: [{
          ...m.plugins[0],
          inventory: {
            skills: [],
            commands: [],
            agents: [],
            hookEvents: [],
            mcpServers: [],
            unbridged: { lspServers: 2, monitors: 1 },
            dependencies: ['secrets-vault@~2.1.0'],
            notes: [],
          },
        }],
      } : m),
    }
    await renderAsync({ rpc: rpcMock(state) })
    await act(async () => { button('team-tools').click() })
    const components = container.querySelector('[data-testid="cc-detail-components"]')
    expect(components?.textContent).toContain('not bridged: 2 LSP servers, 1 monitor')
    expect(components?.textContent).toContain('requires: secrets-vault@~2.1.0')
  })
})

describe('Chinese localization', () => {
  const zhT = (key: keyof typeof zh, params?: Record<string, string | number>): string => interpolate(zh[key], params)

  it('renders the panel chrome in Chinese under a zh-bound translator', async () => {
    await renderAsync({ rpc: rpcMock(STATE), t: zhT })
    const text = container.textContent ?? ''
    expect(text).toContain('插件')
    expect(text).toContain('市场')
    expect(text).toContain('模型')
    expect(container.querySelector('[data-testid="cc-search"]')?.getAttribute('placeholder')).toBe('搜索插件…')
    expect(text).toContain('仅显示已安装')
    // The first card summary line localizes through the same translator.
    expect(text).toContain('1 个技能')
    // Switch to Marketplaces: buttons and the hint localize too.
    await act(async () => { button('市场').click() })
    expect(button('添加市场')).toBeDefined()
    expect(button('全部刷新')).toBeDefined()
    expect(container.textContent).toContain('上次同步')
  })

  it('localizes the no-match empty state and modal chrome', async () => {
    await renderAsync({ rpc: rpcMock(STATE), t: zhT })
    await act(async () => { setValue(container.querySelector('[data-testid="cc-search"]')!, 'zzz-no-match') })
    expect(container.querySelector('[data-testid="cc-empty"]')?.textContent).toBe('没有符合当前筛选条件的插件。')
    await act(async () => { setValue(container.querySelector('[data-testid="cc-search"]')!, '') })
    // team-tools' Install (the first alphabetical card, packed, is disabled).
    const card = [...container.querySelectorAll('[data-testid="cc-plugin"]')]
      .find((c) => c.querySelector('[data-testid="cc-detail"]')?.textContent === 'team-tools')
    await act(async () => { (card?.querySelector('[data-testid="cc-install"], [data-testid="cc-scopes"]') as HTMLButtonElement).click() })
    const modal = container.querySelector('[data-testid="cc-modal"]')
    expect(modal?.textContent).toContain('选择此插件生效的范围')
    expect(modal?.textContent).toContain('全局（所有工作区）')
    expect(modal?.textContent).toContain('取消')
    expect(modal?.getAttribute('aria-label')).toBe('管理插件“team-tools”')
    // Switch to workspaces: the checklist chrome localizes too.
    await act(async () => { (modal?.querySelector('[data-testid="cc-scope-workspaces"] input') as HTMLInputElement).click() })
    expect(modal?.textContent).toContain('选定的工作区')
    expect(modal?.textContent).toContain('技能仅在勾选的工作区中启用')
  })
})

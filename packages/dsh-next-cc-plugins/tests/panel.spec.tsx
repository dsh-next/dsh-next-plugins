/**
 * jsdom render test for the Claude Plugins settings panel: proves the panel
 * renders its tabs and rows from the Host envelopes and that the interactive
 * controls dispatch the right RPC calls. This complements the Host RPC
 * contract test (shape) and the real-mount e2e marker (whole shell).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { CcState, MutationResult, WorkspaceRow } from '../src/core/types.ts'
import { CcPanel } from '../src/client/CcPanel.tsx'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const STATE: CcState = {
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
  ],
}

const WS: WorkspaceRow[] = [{ id: 'w1', title: 'Project One', path: '/w1' }]

type RpcFn = (method: string, args?: unknown) => Promise<unknown>

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

/** The first button with exactly this label. */
function button(text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].filter((b) => b.textContent === text)
  expect(found.length, `button "${text}" should exist`).toBeGreaterThan(0)
  return found[0] as HTMLButtonElement
}

describe('CcPanel', () => {
  it('renders the tabs and the marketplace rows from the state envelope', async () => {
    await renderAsync()
    expect(document.querySelector('[data-testid="cc-plugins"]')).not.toBeNull()
    expect(document.body.textContent).toContain('acme-tools')
    expect(document.body.textContent).toContain('team-tools')
    expect(document.body.textContent).toContain('1 skill, 1 MCP server, 1 command, 1 hook event (enable runtime.hooks)')
    // The unsupported source explains itself and renders a disabled install.
    expect(document.body.textContent).toContain('npm plugin sources are not supported yet')
    const installs = [...container.querySelectorAll('button')].filter((b) => b.textContent === 'Install')
    expect(installs).toHaveLength(2)
    const disabled = installs.find((b) => b.disabled)
    expect(disabled).toBeDefined()
    expect(disabled?.getAttribute('title')).toBe('github:o/r/packed')
  })

  it('renders the empty state with the add-marketplace control', async () => {
    await renderAsync({ rpc: rpcMock({ installed: [], marketplaces: [] }) })
    expect(document.querySelector('[data-testid="cc-empty"]')).not.toBeNull()
    const input = document.querySelector('[data-testid="cc-add-input"]') as HTMLInputElement
    expect(input).not.toBeNull()
    expect(input.placeholder).toContain('owner/repo')
  })

  it('dispatches addMarketplace with the typed spec', async () => {
    const rpc = rpcMock()
    await renderAsync({ rpc })
    const input = document.querySelector('[data-testid="cc-add-input"]') as HTMLInputElement
    await act(async () => { setValue(input, 'anthropics/claude-code') })
    await act(async () => { button('Add marketplace').click() })
    expect(rpc).toHaveBeenCalledWith('addMarketplace', { spec: 'anthropics/claude-code' })
  })

  it('dispatches installPlugin for an installable plugin', async () => {
    const rpc = rpcMock()
    const notify = vi.fn()
    await renderAsync({ rpc, notifyInstalledChanged: notify })
    const install = [...container.querySelectorAll('button')].filter((b) => b.textContent === 'Install').find((b) => !b.disabled)!
    await act(async () => { install.click() })
    expect(rpc).toHaveBeenCalledWith('installPlugin', {
      marketplaceId: 'github:o/r',
      plugin: 'team-tools',
      scope: 'global',
    })
    expect(notify).toHaveBeenCalled()
  })

  it('shows the mutation message from the envelope', async () => {
    await renderAsync()
    await act(async () => { button('Refresh all').click() })
    expect(document.querySelector('[data-testid="cc-message"]')?.textContent).toContain('done')
  })

  it('renders the Installed tab from installed records', async () => {
    const state: CcState = {
      installed: [{
        key: 'github:o/r/team-tools',
        marketplaceId: 'github:o/r',
        marketplaceSpec: 'o/r',
        pluginName: 'team-tools',
        version: '1.0.0',
        installedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        scope: 'global',
        skills: [{ name: 'deploy', directory: '/home/u/.agents/skills/deploy' }],
        mcpServers: [{ rowId: 'r', serverName: 'linear', claudeName: 'linear', def: { transport: 'stdio', command: 'npx', args: [], env: {} } }],
        agents: [{ rowId: 'a', toolName: 'cc-agent-reviewer', claudeName: 'reviewer', persona: 'Reviews' }],
        pending: { commands: ['ship'], hookEvents: ['PreToolUse'] },
      }],
      marketplaces: [],
    }
    await renderAsync({ rpc: rpcMock(state) })
    await act(async () => { button('Installed').click() })
    const row = document.querySelector('[data-testid="cc-installed"]')
    expect(row?.textContent).toContain('team-tools 1.0.0')
    expect(row?.textContent).toContain('1 skill (deploy)')
    expect(row?.textContent).toContain('1 MCP server (linear)')
    expect(row?.textContent).toContain('1 agent tool (cc-agent-reviewer)')
    expect(row?.textContent).toContain('1 command registered')
    expect(row?.textContent).toContain('1 hook event')
    // Uninstall is a two-step confirm.
    await act(async () => { button('Uninstall').click() })
    expect([...container.querySelectorAll('button')].some((b) => b.textContent === 'Confirm uninstall')).toBe(true)
  })

  it('surfaces a failed mutation as an error notice', async () => {
    const rpc = vi.fn<RpcFn>(async (method: string) => {
      if (method === 'getState') return STATE
      return { ok: false, error: 'boom' }
    })
    await renderAsync({ rpc })
    await act(async () => { button('Refresh all').click() })
    expect(document.querySelector('[data-testid="cc-message"]')?.textContent).toContain('boom')
  })
})

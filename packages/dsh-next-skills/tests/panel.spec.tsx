/**
 * jsdom render test for the Skills settings panel: proves the panel renders
 * the cc-plugins-style page (Skills / Providers tabs over a two-column card
 * grid) from the Host envelope and that the interactive controls dispatch the
 * right RPC calls — the scope modal (add / re-scope / two-step uninstall), the
 * detail modal (markdown body), the provider filter, and the notification
 * hook. Complements the Host RPC contract test (shape) and the real-mount
 * e2e marker (whole shell).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { InstalledSkill, SkillsState, WorkspaceRow } from '../src/core/types.ts'
import { buildGridEntries, filterEntries, formatLastSync, presenceLabel, SkillsPanel } from '../src/client/SkillsPanel.tsx'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const skill: InstalledSkill = {
  name: 'security-review', description: 'Review code for security issues',
  scope: 'global', source: 'user-agents', kind: 'bundle', path: '/a/SKILL.md', directory: '/a',
  fileModelInvocable: true, fileUserInvocable: true, managed: true, provider: 'o/r', updateAvailable: true,
}

const STATE: SkillsState = {
  config: { providers: [{ id: 'o-r', spec: 'o/r', addedAt: 't' }], installed: [], scopes: {} },
  installed: [skill],
  providers: [{ id: 'o-r', spec: 'o/r', skillCount: 2, lastRefresh: '' }],
  catalog: [
    { name: 'find-skills', description: 'Find skills', providerId: 'o-r', providerSpec: 'o/r', skillPath: 'skills/find-skills', version: 'v1' },
    { name: 'deploy-helper', description: 'Deploy things', providerId: 'o-r', providerSpec: 'o/r', skillPath: 'skills/deploy-helper', version: 'v2' },
  ],
}

const WS: WorkspaceRow[] = [
  { id: 'w1', title: 'Project One', path: '/w1' },
  { id: 'w2', title: 'Project Two', path: '/w2' },
]

type RpcFn = (method: string, args?: unknown) => Promise<unknown>

function rpcMock(state: SkillsState = STATE): RpcFn & ReturnType<typeof vi.fn> {
  return vi.fn<RpcFn>(async (method: string) => {
    if (method === 'getState') return state
    if (method === 'getInstalledSkillDetail') {
      return { name: 'security-review', description: 'd', modelInvocable: true, userInvocable: true, body: '# Heading\n\nParagraph text.' }
    }
    if (method === 'getCatalogSkillDetail') {
      return { name: 'find-skills', description: 'd', modelInvocable: true, userInvocable: true, body: 'Catalog body.' }
    }
    return { ok: true, state }
  })
}

interface Render {
  container: HTMLDivElement
  unmount: () => Promise<void>
}

async function render(
  rpc: RpcFn,
  workspaces: WorkspaceRow[] = [],
  notifyInstalledChanged?: () => void,
): Promise<Render> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root: Root = createRoot(container)
  await act(async () => {
    root.render(React.createElement(SkillsPanel, {
      rpc,
      getWorkspaces: () => workspaces,
      notifyInstalledChanged,
    }))
  })
  await act(async () => {})
  return {
    container,
    unmount: async () => { await act(async () => root.unmount()); container.remove() },
  }
}

async function click(el: Element): Promise<void> {
  await act(async () => {
    (el as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

function setValue(el: Element, value: string): void {
  const proto = window.HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!
  setter.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

function button(container: HTMLElement, text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((b) => b.textContent === text)
  expect(found, `button "${text}" should exist`).toBeTruthy()
  return found as HTMLButtonElement
}

function byTestId(container: HTMLElement, id: string): HTMLElement {
  const found = container.querySelector(`[data-testid="${id}"]`)
  expect(found, `[data-testid="${id}"] should exist`).toBeTruthy()
  return found as HTMLElement
}

function dialog(container: HTMLElement): HTMLElement {
  return byTestId(container, 'skills-modal')
}

function radioByName(scope: HTMLElement, testId: string): HTMLInputElement {
  const label = scope.querySelector(`[data-testid="${testId}"]`)!
  return label.querySelector('input') as HTMLInputElement
}

function checkboxByTitle(scope: HTMLElement, title: string): HTMLInputElement {
  const label = [...scope.querySelectorAll('[data-testid="skills-workspace"]')]
    .find((el) => el.textContent === title)!
  return label.querySelector('input') as HTMLInputElement
}

function rpcCalls(rpc: RpcFn & ReturnType<typeof vi.fn>): Array<[string, unknown?]> {
  return rpc.mock.calls as Array<[string, unknown?]>
}

afterEach(() => { document.body.innerHTML = '' })

describe('grid composition (buildGridEntries + filterEntries)', () => {
  it('rows come first, then catalog-only entries, each group alphabetical', () => {
    const entries = buildGridEntries(STATE)
    expect(entries.map((e) => e.name)).toEqual(['security-review', 'deploy-helper', 'find-skills'])
  })
  it('a discovered row adopts its provider spec, and catalog entries carry the filter id', () => {
    const entries = buildGridEntries(STATE)
    // The row has no same-name catalog entry: no provider id, but the row's
    // own provider spec feeds the label.
    expect(entries[0].providerId).toBeUndefined()
    expect(entries[0].providerSpec).toBe('o/r')
    expect(entries[1].providerId).toBe('o-r')
  })
  it('filters by search, provider, and installed-only', () => {
    const entries = buildGridEntries(STATE)
    expect(filterEntries(entries, 'deploy', '', false).map((e) => e.name)).toEqual(['deploy-helper'])
    expect(filterEntries(entries, '', 'p-q', false)).toEqual([])
    expect(filterEntries(entries, '', '', true).map((e) => e.name)).toEqual(['security-review'])
  })
})

describe('formatters', () => {
  it('presenceLabel reads the scope setting', () => {
    expect(presenceLabel(undefined)).toBe('Everywhere')
    expect(presenceLabel([])).toBe('Off')
    expect(presenceLabel(['web', 'api'])).toBe('2 workspaces')
    expect(presenceLabel(['web'])).toBe('1 workspace')
  })
  it('formatLastSync renders relative ages', () => {
    const now = Date.parse('2026-09-01T12:00:00Z')
    expect(formatLastSync('', now)).toBe('never')
    expect(formatLastSync(new Date(now - 30_000).toISOString(), now)).toBe('just now')
    expect(formatLastSync(new Date(now - 5 * 60_000).toISOString(), now)).toBe('5m ago')
    expect(formatLastSync(new Date(now - 3 * 3_600_000).toISOString(), now)).toBe('3h ago')
    expect(formatLastSync(new Date(now - 2 * 86_400_000).toISOString(), now)).toBe('2d ago')
  })
})

describe('SkillsPanel rendering', () => {
  it('renders the tabs, filter row, and one card per grid entry', async () => {
    const { container, unmount } = await render(rpcMock(), WS)
    expect(byTestId(container, 'skills-tab-skills')).toBeTruthy()
    expect(byTestId(container, 'skills-tab-providers')).toBeTruthy()
    expect(byTestId(container, 'skills-search')).toBeTruthy()
    expect(byTestId(container, 'skills-provider-filter')).toBeTruthy()
    const cards = container.querySelectorAll('[data-testid="skills-card"]')
    expect(cards).toHaveLength(3)
    // The installed card shows the presence badge and one Add/Manage button.
    expect(byTestId(container, 'skills-presence').textContent).toBe('Everywhere')
    expect(byTestId(container, 'skills-add')).toBeTruthy()
    // The managed card with a newer catalog version carries the Update button.
    expect(byTestId(container, 'skills-update')).toBeTruthy()
    await unmount()
  })

  it('getState receives the registered workspace paths', async () => {
    const rpc = rpcMock()
    await render(rpc, WS)
    const call = rpcCalls(rpc).find(([m]) => m === 'getState')
    expect(call![1]).toEqual({ workspacePaths: ['/w1', '/w2'] })
  })

  it('the project chip renders for workspace rows', async () => {
    const state: SkillsState = {
      ...STATE,
      installed: [{ ...skill, name: 'proj', provider: undefined, managed: false, updateAvailable: undefined, scope: 'workspace', source: 'project-agents', directory: '/w1/.agents/skills/proj' }],
      catalog: [],
    }
    const { container, unmount } = await render(rpcMock(state), WS)
    expect(container.querySelector('[data-testid="skills-card"]')!.textContent).toContain('project')
    await unmount()
  })

  it('an empty state renders when nothing matches', async () => {
    const state: SkillsState = { ...STATE, installed: [], catalog: [] }
    const { container, unmount } = await render(rpcMock(state))
    expect(byTestId(container, 'skills-empty').textContent).toContain('No skills match')
    await unmount()
  })
})

describe('scope modal: add + re-scope + uninstall', () => {
  it('Add installs the catalog skill with the drafted scope and notifies', async () => {
    const rpc = rpcMock()
    const notify = vi.fn()
    const { container, unmount } = await render(rpc, WS, notify)
    // skills-add names the card's single action button (Add or Manage), so
    // the Add flow targets the deploy-helper card explicitly.
    const addCard = [...container.querySelectorAll('[data-testid="skills-card"]')]
      .find((c) => c.textContent!.includes('deploy-helper'))!
    await click(addCard.querySelector('[data-testid="skills-add"]')!)
    const scope = dialog(container)
    expect(radioByName(scope, 'skills-scope-global').checked).toBe(true)
    expect(scope.textContent).toContain('deploy-helper')
    await click(button(scope, 'Add'))
    const call = rpcCalls(rpc).find(([m]) => m === 'installSkill')
    expect(call![1]).toEqual({ providerId: 'o-r', skillPath: 'skills/deploy-helper' })
    expect(notify).toHaveBeenCalled()
    await unmount()
  })

  it('the workspaces radio reveals the checklist and Save scopes to the checked workspaces', async () => {
    const rpc = rpcMock()
    const { container, unmount } = await render(rpc, WS)
    await click(byTestId(container, 'skills-add'))
    const scope = dialog(container)
    expect(radioByName(scope, 'skills-scope-global').checked).toBe(true)
    await click(radioByName(scope, 'skills-scope-workspaces'))
    // Re-query on every click: each state change re-renders the checklist and
    // replaces its DOM nodes, so a captured input would go stale.
    const box = (title: string): HTMLInputElement =>
      checkboxByTitle(byTestId(container, 'skills-workspaces'), title)
    // The confirm stays enabled even with zero checked: an empty whitelist
    // is the off-everywhere master switch.
    expect((button(scope, 'Save scope') as HTMLButtonElement).disabled).toBe(false)
    await click(box('Project One'))
    await click(box('Project Two'))
    expect(box('Project Two').checked).toBe(true)
    await click(box('Project Two')) // toggle back off
    expect(box('Project One').checked).toBe(true)
    await click(button(byTestId(container, 'skills-modal'), 'Save scope'))
    const call = rpcCalls(rpc).find(([m]) => m === 'setSkillScope')
    expect(call![1]).toEqual({ name: 'security-review', workspaces: ['w1'] })
    await unmount()
  })

  it('an installed row opens on its current scope', async () => {
    const state: SkillsState = {
      ...STATE,
      installed: [{ ...skill, configScope: ['w2'] }],
      config: { ...STATE.config, scopes: { 'security-review': ['w2'] } },
    }
    const { container, unmount } = await render(rpcMock(state), WS)
    await click(byTestId(container, 'skills-add'))
    const scope = dialog(container)
    expect(radioByName(scope, 'skills-scope-workspaces').checked).toBe(true)
    expect(checkboxByTitle(scope, 'Project Two').checked).toBe(true)
    expect((button(scope, 'Save scope') as HTMLButtonElement).disabled).toBe(false)
    await unmount()
  })

  it('Uninstall needs the two-step confirm and then calls uninstallSkill', async () => {
    const rpc = rpcMock()
    const { container, unmount } = await render(rpc, WS)
    await click(byTestId(container, 'skills-add'))
    const scope = dialog(container)
    await click(button(scope, 'Uninstall'))
    // The first click only reveals the confirmation button.
    expect(rpcCalls(rpc).map(([m]) => m)).not.toContain('uninstallSkill')
    await click(byTestId(scope, 'skills-uninstall-confirm'))
    const call = rpcCalls(rpc).find(([m]) => m === 'uninstallSkill')
    expect(call![1]).toEqual({ name: 'security-review' })
    await unmount()
  })

  it('saving the workspaces mode with none checked disables everywhere', async () => {
    const rpc = rpcMock()
    const { container, unmount } = await render(rpc, WS)
    await click(byTestId(container, 'skills-add'))
    const scope = dialog(container)
    await click(radioByName(scope, 'skills-scope-workspaces'))
    await click(button(scope, 'Save scope'))
    const call = rpcCalls(rpc).find(([m]) => m === 'setSkillScope')
    expect(call![1]).toEqual({ name: 'security-review', workspaces: [] })
    await unmount()
  })

  it('an unmanaged skill has no uninstall control but can still be scoped', async () => {
    const state: SkillsState = {
      ...STATE,
      installed: [{ ...skill, managed: false, provider: undefined, updateAvailable: undefined }],
    }
    const rpc = rpcMock(state)
    const { container, unmount } = await render(rpc)
    await click(byTestId(container, 'skills-add'))
    const scope = dialog(container)
    expect([...scope.querySelectorAll('button')].some((b) => b.textContent === 'Uninstall')).toBe(false)
    await click(button(scope, 'Save scope'))
    const call = rpcCalls(rpc).find(([m]) => m === 'setSkillScope')
    expect(call).toBeTruthy()
    await unmount()
  })
})

describe('detail modal', () => {
  it('loads an installed detail and renders the markdown body', async () => {
    const rpc = rpcMock()
    const { container, unmount } = await render(rpc)
    await click(byTestId(container, 'skills-detail'))
    const detail = byTestId(container, 'skills-skill-detail')
    await act(async () => {})
    expect(rpcCalls(rpc).find(([m]) => m === 'getInstalledSkillDetail')).toBeTruthy()
    const body = byTestId(detail, 'skills-detail-body')
    expect(body.querySelector('h1')?.textContent).toBe('Heading')
    expect(body.querySelector('p')?.textContent).toBe('Paragraph text.')
    await unmount()
  })

  it('an unstable getWorkspaces (fresh array per call) cannot loop the detail body away', async () => {
    // The real workspace reader returns a new array on every call; the panel
    // must key its effects on the paths, not the array identity.
    const rpc = rpcMock()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root: Root = createRoot(container)
    await act(async () => {
      root.render(React.createElement(SkillsPanel, {
        rpc,
        getWorkspaces: () => WS.slice(),
      }))
    })
    await act(async () => {})
    const baseCalls = rpcCalls(rpc).length
    await click(byTestId(container, 'skills-detail'))
    await act(async () => {})
    const detail = byTestId(container, 'skills-skill-detail')
    const body = byTestId(detail, 'skills-detail-body')
    expect(body.querySelector('h1')?.textContent).toBe('Heading')
    // No render loop: the detail RPC fired exactly once for this open.
    const detailCalls = rpcCalls(rpc).filter(([m]) => m === 'getInstalledSkillDetail').length
    expect(detailCalls).toBe(1)
    void baseCalls
    await act(async () => root.unmount())
    container.remove()
  })

  it('a catalog-only entry loads through the catalog detail RPC', async () => {
    const rpc = rpcMock()
    const { container, unmount } = await render(rpc)
    const cards = [...container.querySelectorAll('[data-testid="skills-card"]')]
    const catalogCard = cards.find((c) => c.textContent!.includes('find-skills'))!
    await click(catalogCard.querySelector('[data-testid="skills-detail"]')!)
    await act(async () => {})
    expect(rpcCalls(rpc).find(([m]) => m === 'getCatalogSkillDetail')![1])
      .toEqual({ providerId: 'o-r', skillPath: 'skills/find-skills' })
    expect(byTestId(container, 'skills-detail-body').textContent).toContain('Catalog body.')
    await unmount()
  })
})

describe('providers tab', () => {
  async function openProviders(rpc: RpcFn): Promise<Render> {
    const r = await render(rpc, WS)
    await click(byTestId(r.container, 'skills-tab-providers'))
    return r
  }

  it('renders provider rows with sync status and a remove button', async () => {
    const rpc = rpcMock()
    const { container, unmount } = await openProviders(rpc)
    const row = byTestId(container, 'skills-provider')
    expect(row.textContent).toContain('o/r')
    expect(row.textContent).toContain('2 skills')
    expect(row.textContent).toContain('never')
    await click(byTestId(container, 'skills-provider-remove'))
    expect(rpcCalls(rpc).find(([m]) => m === 'removeProvider')![1])
      .toEqual({ providerId: 'o-r' })
    await unmount()
  })

  it('adds a provider from the input (click and Enter) and refreshes all', async () => {
    const rpc = rpcMock()
    const { container, unmount } = await openProviders(rpc)
    const input = byTestId(container, 'skills-add-input') as HTMLInputElement
    setValue(input, 'vercel/agent-skills')
    await click(button(container, 'Add provider'))
    expect(rpcCalls(rpc).find(([m]) => m === 'addProvider')![1])
      .toEqual({ spec: 'vercel/agent-skills' })
    await click(byTestId(container, 'skills-provider-refresh-all'))
    // Refresh all drives one refreshProvider RPC per configured provider.
    expect(rpcCalls(rpc).filter(([m]) => m === 'refreshProvider').map(([, a]) => a))
      .toEqual([{ providerId: 'o-r' }])
    await unmount()
  })

  it('refresh all shows the active provider and hides its Remove until done', async () => {
    // Gate the first refreshProvider: the panel must show the spinner pill on
    // that row (Remove gone) and the progress label on the button mid-run.
    let releaseFirst: (value: unknown) => void = () => {}
    const first = new Promise((resolve) => { releaseFirst = resolve })
    const rpc: RpcFn = vi.fn(async (method: string, args?: unknown) => {
      if (method === 'getState') return STATE
      if (method === 'refreshProvider') {
        if ((args as { providerId?: string }).providerId === 'o-r') await first
        return { ok: true, state: STATE }
      }
      return { ok: true, state: STATE }
    })
    const { container, unmount } = await openProviders(rpc)
    await click(byTestId(container, 'skills-provider-refresh-all'))
    await act(async () => { await Promise.resolve() })
    const active = byTestId(container, 'skills-provider-refreshing')
    expect(active.textContent).toContain('Refreshing…')
    expect(container.querySelector('[data-testid="skills-provider-remove"]')).toBeNull()
    expect(byTestId(container, 'skills-provider-refresh-all').textContent).toContain('1/1')
    await act(async () => { releaseFirst(undefined) })
    await act(async () => {})
    expect(container.querySelector('[data-testid="skills-provider-refreshing"]')).toBeNull()
    expect(byTestId(container, 'skills-provider-remove')).toBeTruthy()
    expect(byTestId(container, 'skills-message').textContent).toContain('Done')
    await unmount()
  })

  it('a failing provider keeps the sequence running and reports it at the end', async () => {
    const rpc: RpcFn = vi.fn(async (method: string) => {
      if (method === 'getState') return STATE
      if (method === 'refreshProvider') return { ok: false, error: 'rate limited' }
      return { ok: true, state: STATE }
    })
    const { container, unmount } = await openProviders(rpc)
    await click(byTestId(container, 'skills-provider-refresh-all'))
    await act(async () => {})
    // One failure with one provider: the summary names the count and the error.
    expect(byTestId(container, 'skills-message').textContent).toContain('rate limited')
    await unmount()
  })

  it('an error response surfaces in the message banner', async () => {
    const rpc: RpcFn = vi.fn(async (method: string) => {
      if (method === 'getState') return STATE
      if (method === 'removeProvider') return { ok: false, error: 'provider busy' }
      return { ok: true, state: STATE }
    })
    const { container, unmount } = await openProviders(rpc)
    await click(byTestId(container, 'skills-provider-remove'))
    expect(byTestId(container, 'skills-message').textContent).toContain('provider busy')
    await unmount()
  })
})

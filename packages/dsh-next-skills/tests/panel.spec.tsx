/**
 * jsdom render test for the Skills settings panel: proves the panel renders
 * the three tabs (Installed / Search / Providers) from the Host
 * envelopes and that the interactive controls dispatch the right RPC calls.
 * This complements the Host RPC contract test (shape) and the real-mount e2e
 * marker (whole shell).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { InstalledSkill, MarketplaceView, SkillsState, WorkspaceRow } from '../src/core/types.ts'
import { SkillsPanel } from '../src/client/SkillsPanel.tsx'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const skill: InstalledSkill = {
  name: 'security-review', description: 'Review code for security issues', enabled: true, userInvocable: true,
  scope: 'global', source: 'user-agents', kind: 'bundle', path: '/a/SKILL.md', directory: '/a',
}

const MARKET: MarketplaceView = {
  skills: [
    { name: 'find-skills', description: 'Find skills', providerId: 'o-r', providerSpec: 'o/r', skillPath: 'skills/find-skills', version: 'v1' },
    { name: 'deploy-helper', description: 'Deploy things', providerId: 'o-r', providerSpec: 'o/r', skillPath: 'skills/deploy-helper', version: 'v2' },
  ],
  providers: [{ id: 'o-r', spec: 'o/r', skillCount: 2, lastRefresh: '' }],
}

/** A second provider, for the provider-filter dropdown test. */
const TWO_PROVIDERS: MarketplaceView = {
  skills: [
    ...MARKET.skills,
    { name: 'other-tool', description: 'Other things', providerId: 'p-q', providerSpec: 'p/q', skillPath: 'tools/other-tool', version: 'v3' },
  ],
  providers: [...MARKET.providers, { id: 'p-q', spec: 'p/q', skillCount: 1, lastRefresh: '' }],
}

function state(over: Partial<InstalledSkill> = {}): SkillsState {
  return { installed: [{ ...skill, ...over }] }
}

type RpcFn = (method: string, args?: unknown) => Promise<unknown>

function rpcMock(): RpcFn & ReturnType<typeof vi.fn> {
  return vi.fn<RpcFn>(async (method: string) => {
    if (method === 'getState') return state()
    if (method === 'marketplace') return MARKET
    if (method === 'getInstalledMap') return { global: state().installed, workspaces: [] }
    return { ok: true, state: state() }
  })
}

const WS: WorkspaceRow[] = [
  { id: 'w1', title: 'Project One', path: '/w1' },
  { id: 'w2', title: 'Project Two', path: '/w2' },
]

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

function tab(container: HTMLElement, text: string): HTMLButtonElement {
  return [...container.querySelectorAll('button')].find((b) => b.textContent === text && b.className.includes('tab')) as HTMLButtonElement
}

function dialog(container: HTMLElement): HTMLElement {
  const found = container.querySelector('[role="dialog"]') as HTMLElement | null
  expect(found, 'confirmation dialog should be open').toBeTruthy()
  return found as HTMLElement
}

afterEach(() => { document.body.innerHTML = '' })

describe('SkillsPanel', () => {
  it('renders immediately (a settings page, not a collapsible card)', async () => {
    const rpc = rpcMock()
    const { container, unmount } = await render(rpc)
    expect(rpc).toHaveBeenCalledWith('getState', expect.anything())
    expect(container.textContent).toContain('security-review')
    expect(container.textContent).toContain('Installed')
    expect(container.textContent).toContain('Search')
    expect(container.textContent).toContain('Providers')
    await unmount()
  })

  it('dispatches setEnabled when the Disable button is clicked', async () => {
    const rpc = rpcMock()
    const { container, unmount } = await render(rpc)
    // An enabled skill shows a red Disable action beside Remove.
    await click(button(container, 'Disable'))
    // No workspace selected: the toggle applies to the skill's own (global) scope.
    expect(rpc).toHaveBeenCalledWith('setEnabled', expect.objectContaining({ name: 'security-review', enabled: false, scope: 'global' }))
    await unmount()
  })

  it('shadows a global skill per workspace when toggled off with a workspace selected', async () => {
    const rpc = rpcMock()
    const { container, unmount } = await render(rpc, WS)
    await click(button(container, 'Disable'))
    expect(rpc).toHaveBeenCalledWith('setEnabled', expect.objectContaining({
      name: 'security-review', enabled: false, scope: 'workspace', workspacePath: '/w1',
    }))
    await unmount()
  })

  it('honors the "Global only" selector option instead of falling back to a workspace', async () => {
    const rpc = rpcMock()
    const { container, unmount } = await render(rpc, WS)
    // The selector defaults to the first workspace; switching to the empty
    // value must really detach the workspace scope (a regression here made
    // "Global only" unreachable and every toggle a workspace shadow).
    const select = container.querySelector('select') as HTMLSelectElement
    expect(select).toBeTruthy()
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!
      setter.call(select, '')
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await click(button(container, 'Disable'))
    expect(rpc).toHaveBeenCalledWith('setEnabled', expect.objectContaining({
      name: 'security-review', enabled: false, scope: 'global', workspacePath: undefined,
    }))
    await unmount()
  })

  it('shows a shadow badge for plugin-generated workspace shadows', async () => {
    const rpc = vi.fn<RpcFn>(async (method: string) => {
      if (method === 'getState') return state({ scope: 'workspace', enabled: false, shadow: true })
      if (method === 'marketplace') return MARKET
      if (method === 'getInstalledMap') return { global: [], workspaces: [] }
      return { ok: true, state: state() }
    })
    const { container, unmount } = await render(rpc)
    expect(container.textContent).toContain('shadow')
    await unmount()
  })

  it('dims only the title and description of a disabled skill, not its actions', async () => {
    const rpc = vi.fn<RpcFn>(async (method: string) => {
      if (method === 'getState') return state({ enabled: false })
      if (method === 'marketplace') return MARKET
      if (method === 'getInstalledMap') return { global: [], workspaces: [] }
      return { ok: true, state: state({ enabled: false }) }
    })
    const { container, unmount } = await render(rpc)
    const dimmed = [...container.querySelectorAll('[class*="skillDisabled"]')] as HTMLElement[]
    expect(dimmed.length).toBe(2)
    for (const el of dimmed) expect(el.querySelector('button')).toBeNull()
    // The dimming covers the title and description only; the row (with its
    // badges and buttons) stays crisp. The disabled skill offers Enable.
    const row = dimmed[0].parentElement!.parentElement!
    expect(row.className).not.toContain('skillDisabled')
    expect(row.textContent).toContain('Enable')
    expect(row.textContent).not.toContain('Disable')
    await unmount()
  })

  it('shows the scope chip with the global star and custom badge', async () => {
    const rpc = rpcMock()
    const { container, unmount } = await render(rpc)
    expect(container.textContent).toContain('⭐ Global')
    // The test skill has no provider manifest: it renders the yellow custom chip.
    expect(container.textContent).toContain('custom')
    await unmount()
  })

  it('shows an empty-state hint when no skills are installed', async () => {
    const rpc = vi.fn<RpcFn>(async (method: string) => {
      if (method === 'getState') return { installed: [] }
      return { ok: true, state: state() }
    })
    const { container, unmount } = await render(rpc)
    expect(container.textContent).toContain('No skills installed')
    await unmount()
  })

  it('renders the Search tab and adds a skill to chosen targets from the modal', async () => {
    const rpc = rpcMock()
    const { container, unmount } = await render(rpc, WS)
    await click(tab(container, 'Search'))
    await act(async () => {})
    expect(rpc).toHaveBeenCalledWith('marketplace', expect.anything())
    expect(container.textContent).toContain('find-skills')
    expect(container.textContent).toContain('o/r')
    // The old "Install into" dropdown is gone; Add opens the target picker.
    expect(container.querySelector('select[aria-label="Install into"]')).toBeNull()
    await click(button(container, 'Add'))
    const dialogEl = dialog(container)
    expect(dialogEl.textContent).toContain('Add skill "find-skills"')
    // Check global + Project One, then confirm: one installSkill per target.
    const boxes = [...dialogEl.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[]
    expect(boxes).toHaveLength(3) // global + two workspaces
    await click(boxes[0]!)
    await click(boxes[1]!)
    await click([...dialogEl.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Add'))!)
    expect(rpc).toHaveBeenCalledWith('installSkill', expect.objectContaining({
      providerId: 'o-r', skillPath: 'skills/find-skills', scope: 'global',
    }))
    expect(rpc).toHaveBeenCalledWith('installSkill', expect.objectContaining({
      providerId: 'o-r', skillPath: 'skills/find-skills', scope: 'workspace', workspacePath: '/w1',
    }))
    await unmount()
  })

  it('locks targets that already hold the skill and marks them as added', async () => {
    // find-skills exists globally but nowhere else; deploy-helper nowhere.
    const rpc = vi.fn<RpcFn>(async (method: string) => {
      if (method === 'getState') return state()
      if (method === 'marketplace') return MARKET
      if (method === 'getInstalledMap') {
        return {
          global: [{ ...skill, name: 'find-skills' }],
          workspaces: WS.map((w) => ({ workspacePath: w.path, installed: [] })),
        }
      }
      return { ok: true, state: state() }
    })
    const { container, unmount } = await render(rpc, WS)
    await click(tab(container, 'Search'))
    await act(async () => {})
    // The presence badge still shows where the skill lives.
    expect(container.textContent).toContain('in global')
    await click(button(container, 'Add'))
    const dialogEl = dialog(container)
    expect(dialogEl.textContent).toContain('added')
    const boxes = [...dialogEl.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[]
    expect(boxes[0]!.checked).toBe(true) // global: pre-checked because installed
    expect(boxes[0]!.disabled).toBe(true) // and locked
    expect(boxes[1]!.checked).toBe(false)
    expect(boxes[1]!.disabled).toBe(false)
    // Confirm adds only the unchecked workspace target.
    await click(boxes[1]!)
    await click([...dialogEl.querySelectorAll('button')].find((b) => b.textContent === 'Add')!)
    expect(rpc).toHaveBeenCalledWith('installSkill', expect.objectContaining({
      providerId: 'o-r', skillPath: 'skills/find-skills', scope: 'workspace', workspacePath: '/w1',
    }))
    expect(rpc).not.toHaveBeenCalledWith('installSkill', expect.objectContaining({ scope: 'global' }))
    await unmount()
  })

  it('filters the search list from the search bar', async () => {
    const rpc = rpcMock()
    const { container, unmount } = await render(rpc)
    await click(tab(container, 'Search'))
    await act(async () => {})
    const search = container.querySelector('input[type="search"]') as HTMLInputElement
    expect(search.placeholder).toContain('Search')
    setValue(search, 'deploy')
    await act(async () => {})
    expect(container.textContent).toContain('deploy-helper')
    expect(container.textContent).not.toContain('find-skills')
    await unmount()
  })

  it('filters the search list by provider with the provider dropdown', async () => {
    const rpc = vi.fn<RpcFn>(async (method: string) => {
      if (method === 'getState') return state()
      if (method === 'marketplace') return TWO_PROVIDERS
      if (method === 'getInstalledMap') return { global: [], workspaces: [] }
      return { ok: true, state: state() }
    })
    const { container, unmount } = await render(rpc)
    await click(tab(container, 'Search'))
    await act(async () => {})
    expect(container.textContent).toContain('find-skills')
    expect(container.textContent).toContain('other-tool')
    const providerSelect = container.querySelector('select[aria-label="Provider"]') as HTMLSelectElement
    expect([...providerSelect.options].map((o) => o.textContent)).toEqual(['All providers', 'o/r', 'p/q'])
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!
      setter.call(providerSelect, 'p-q')
      providerSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => {})
    expect(container.textContent).not.toContain('find-skills')
    expect(container.textContent).toContain('other-tool')
    await unmount()
  })

  it('opens a detail modal with the full SKILL.md from the Search tab', async () => {
    const rpc = vi.fn<RpcFn>(async (method: string, args?: unknown) => {
      if (method === 'getState') return state()
      if (method === 'marketplace') return MARKET
      if (method === 'getInstalledMap') return { global: [], workspaces: [] }
      if (method === 'getCatalogSkillDetail') {
        expect(args).toMatchObject({ providerId: 'o-r', skillPath: 'skills/find-skills' })
        return {
          name: 'find-skills', description: 'Find skills', modelInvocable: true, userInvocable: true,
          body: '# find-skills\n\nUse me when searching.',
        }
      }
      return { ok: true, state: state() }
    })
    const { container, unmount } = await render(rpc)
    await click(tab(container, 'Search'))
    await act(async () => {})
    await click(container.querySelector('[aria-label="View find-skills"]') as HTMLElement)
    const dialogEl = container.querySelector('[role="dialog"]') as HTMLElement
    expect(dialogEl.textContent).toContain('find-skills')
    expect(dialogEl.textContent).toContain('model invocable')
    // The body renders as markdown: an h1 from the "# find-skills" heading.
    const bodyEl = dialogEl.querySelector('[class*="modalBody"]') as HTMLElement
    expect(bodyEl.querySelector('h1')?.textContent).toBe('find-skills')
    expect(bodyEl.textContent).toContain('Use me when searching.')
    await click([...dialogEl.querySelectorAll('button')].find((b) => b.textContent === 'Close')!)
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    await unmount()
  })

  it('opens the detail modal from the Installed tab with invocation flags', async () => {
    const rpc = vi.fn<RpcFn>(async (method: string) => {
      if (method === 'getState') return state({ provider: 'o/r' })
      if (method === 'marketplace') return MARKET
      if (method === 'getInstalledMap') return { global: [], workspaces: [] }
      if (method === 'getInstalledSkillDetail') {
        return { name: 'security-review', description: 'Review code', modelInvocable: false, userInvocable: true, body: 'body text' }
      }
      return { ok: true, state: state({ provider: 'o/r' }) }
    })
    const { container, unmount } = await render(rpc)
    await click(container.querySelector('[aria-label="View security-review"]') as HTMLElement)
    const dialogEl = container.querySelector('[role="dialog"]') as HTMLElement
    expect(dialogEl.textContent).toContain('model blocked')
    expect(dialogEl.textContent).toContain('user invocable')
    // Plain body text renders as a markdown paragraph.
    const bodyEl = dialogEl.querySelector('[class*="modalBody"]') as HTMLElement
    expect(bodyEl.querySelector('p')?.textContent).toContain('body text')
    await unmount()
  })

  it('pages the search list with infinite scroll (30 per page, load more resets on filter)', async () => {
    const bigSkills = Array.from({ length: 45 }, (_, i) => ({
      name: `skill-${String(i).padStart(2, '0')}`,
      description: `desc ${i}`,
      providerId: 'o-r',
      providerSpec: 'o/r',
      skillPath: `skills/skill-${String(i).padStart(2, '0')}`,
      version: 'v',
    }))
    const bigMarket: MarketplaceView = {
      skills: bigSkills,
      providers: [{ id: 'o-r', spec: 'o/r', skillCount: 45, lastRefresh: '' }],
    }
    const rpc = vi.fn<RpcFn>(async (method: string) => {
      if (method === 'getState') return state()
      if (method === 'marketplace') return bigMarket
      if (method === 'getInstalledMap') return { global: [], workspaces: [] }
      return { ok: true, state: state() }
    })
    const { container, unmount } = await render(rpc)
    await click(tab(container, 'Search'))
    await act(async () => {})
    const rows = () => container.querySelectorAll('[class*="market"] > [class*="skill"]').length
    expect(rows()).toBe(30)
    expect(container.textContent).toContain('Showing 30 of 45 skills')
    await click(button(container, 'Load more skills'))
    expect(rows()).toBe(45)
    expect(container.textContent).toContain('All 45 skills shown')
    // Filtering resets paging back to the first page.
    const search = container.querySelector('input[type="search"]') as HTMLInputElement
    setValue(search, 'skill-4')
    await act(async () => {})
    expect(container.querySelectorAll('[class*="market"] > [class*="skill"]').length).toBeLessThan(30)
    expect(container.textContent).not.toContain('Load more skills')
    await unmount()
  })

  it('renders the Providers tab and dispatches addProvider / refreshProvider / removeProvider', async () => {
    const rpc = rpcMock()
    const { container, unmount } = await render(rpc)
    await click(tab(container, 'Providers'))
    await act(async () => {})
    expect(container.textContent).toContain('o/r')
    expect(container.textContent).toContain('2 skills')
    const input = [...container.querySelectorAll('input[type="text"]')].find((i) => (i as HTMLInputElement).placeholder.includes('github.com'))!
    setValue(input, 'https://github.com/x/y')
    await click(button(container, 'Add'))
    expect(rpc).toHaveBeenCalledWith('addProvider', expect.objectContaining({ spec: 'https://github.com/x/y' }))
    await click(button(container, 'Refresh'))
    expect(rpc).toHaveBeenCalledWith('refreshProvider', expect.objectContaining({ providerId: 'o-r' }))
    await click(button(container, 'Remove'))
    const dialogEl = dialog(container)
    expect(dialogEl.textContent).toContain('Remove provider "o/r"?')
    await click([...dialogEl.querySelectorAll('button')].find((b) => b.textContent === 'Remove')!)
    expect(rpc).toHaveBeenCalledWith('removeProvider', expect.objectContaining({ providerId: 'o-r' }))
    await unmount()
  })

  it('shows an Update button and dispatches updateSkill for outdated provider skills', async () => {
    const rpc = vi.fn<RpcFn>(async (method: string) => {
      if (method === 'getState') return state({ provider: 'o/r', updateAvailable: true })
      if (method === 'marketplace') return MARKET
      return { ok: true, state: state({ provider: 'o/r', updateAvailable: true }) }
    })
    const { container, unmount } = await render(rpc)
    expect(container.textContent).toContain('o/r')
    await click(button(container, 'Update'))
    expect(rpc).toHaveBeenCalledWith('updateSkill', expect.objectContaining({ name: 'security-review', scope: 'global' }))
    await unmount()
  })

  it('keeps Update visible but disabled when the skill is current', async () => {
    const rpc = rpcMock()
    const { container, unmount } = await render(rpc)
    const update = button(container, 'Update')
    expect(update.disabled).toBe(true)
    await click(update)
    expect(rpc).not.toHaveBeenCalledWith('updateSkill', expect.anything())
    await unmount()
  })

  it('offers Update all copies when several targets hold the skill and dispatches updateAllCopies', async () => {
    const rpc = vi.fn<RpcFn>(async (method: string) => {
      if (method === 'getState') return state({ provider: 'o/r', updateAvailable: true })
      if (method === 'marketplace') return MARKET
      if (method === 'getInstalledMap') {
        return {
          global: [{ ...skill, provider: 'o/r', updateAvailable: true }],
          workspaces: WS.map((w, i) => ({
            workspacePath: w.path,
            installed: i === 0 ? [{ ...skill, scope: 'workspace' as const }] : [],
          })),
        }
      }
      return { ok: true, state: state({ provider: 'o/r' }) }
    })
    const { container, unmount } = await render(rpc, WS)
    expect(button(container, 'Update')).toBeTruthy()
    await click(button(container, 'Update all copies'))
    expect(rpc).toHaveBeenCalledWith('updateAllCopies', expect.objectContaining({
      name: 'security-review',
      workspacePaths: ['/w1', '/w2'],
    }))
    await unmount()
  })

  it('hides Update all copies when only one copy exists', async () => {
    const rpc = vi.fn<RpcFn>(async (method: string) => {
      if (method === 'getState') return state({ provider: 'o/r', updateAvailable: true })
      if (method === 'marketplace') return MARKET
      if (method === 'getInstalledMap') {
        return {
          global: [{ ...skill, provider: 'o/r', updateAvailable: true }],
          workspaces: WS.map((w) => ({ workspacePath: w.path, installed: [] })),
        }
      }
      return { ok: true, state: state({ provider: 'o/r' }) }
    })
    const { container, unmount } = await render(rpc, WS)
    expect(button(container, 'Update')).toBeTruthy()
    expect([...container.querySelectorAll('button')].some((b) => b.textContent === 'Update all copies')).toBe(false)
    await unmount()
  })

  it('surfaces a partial-update warning from a mutation result', async () => {
    const rpc = vi.fn<RpcFn>(async (method: string) => {
      if (method === 'getState') return state({ provider: 'o/r', updateAvailable: true })
      if (method === 'marketplace') return MARKET
      if (method === 'getInstalledMap') return { global: [], workspaces: [] }
      if (method === 'updateSkill') {
        return { ok: true, state: state({ provider: 'o/r' }), warning: 'updated 1 copy of "security-review"; skipped workspace /w1 (shadow)' }
      }
      return { ok: true, state: state({ provider: 'o/r', updateAvailable: true }) }
    })
    const { container, unmount } = await render(rpc)
    await click(button(container, 'Update'))
    await act(async () => {})
    expect(container.textContent).toContain('skipped workspace /w1 (shadow)')
    await unmount()
  })

  it('requires a confirmation popup before removing a skill', async () => {
    const rpc = rpcMock()
    const { container, unmount } = await render(rpc)
    await click(button(container, 'Remove'))
    expect(rpc).not.toHaveBeenCalledWith('remove', expect.anything())
    const dialogEl = dialog(container)
    expect(dialogEl.textContent).toContain('Remove skill "security-review"?')
    expect(dialogEl.textContent).toContain('.trash')
    await click([...dialogEl.querySelectorAll('button')].find((b) => b.textContent === 'Remove')!)
    expect(rpc).toHaveBeenCalledWith('remove', expect.objectContaining({ name: 'security-review' }))
    await unmount()
  })

  it('cancels the removal popup without removing', async () => {
    const rpc = rpcMock()
    const { container, unmount } = await render(rpc)
    await click(button(container, 'Remove'))
    const dialogEl = dialog(container)
    await click([...dialogEl.querySelectorAll('button')].find((b) => b.textContent === 'Cancel')!)
    expect(rpc).not.toHaveBeenCalledWith('remove', expect.anything())
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(button(container, 'Remove')).toBeTruthy()
    await unmount()
  })
})

describe('SkillsPanel installed-catalog notifications', () => {
  it('notifies after a successful removal so chat sessions refetch their skill list', async () => {
    const rpc = rpcMock()
    const notify = vi.fn()
    const { container, unmount } = await render(rpc, [], notify)
    await click(button(container, 'Remove'))
    await click([...dialog(container).querySelectorAll('button')].find((b) => b.textContent === 'Remove')!)
    expect(notify).toHaveBeenCalledTimes(1)
    await unmount()
  })

  it('notifies after a successful toggle', async () => {
    const rpc = rpcMock()
    const notify = vi.fn()
    const { container, unmount } = await render(rpc, [], notify)
    await click(button(container, 'Disable'))
    expect(notify).toHaveBeenCalledTimes(1)
    await unmount()
  })

  it('does not notify when the mutation fails', async () => {
    const rpc = rpcMock()
    rpc.mockImplementation(async (method: string) => {
      if (method === 'remove') return { ok: false, error: 'skill is read-only' }
      if (method === 'getState') return state()
      if (method === 'marketplace') return MARKET
      if (method === 'getInstalledMap') return { global: state().installed, workspaces: [] }
      return { ok: true, state: state() }
    })
    const notify = vi.fn()
    const { container, unmount } = await render(rpc, [], notify)
    await click(button(container, 'Remove'))
    await click([...dialog(container).querySelectorAll('button')].find((b) => b.textContent === 'Remove')!)
    expect(notify).not.toHaveBeenCalled()
    await unmount()
  })

  it('does not notify for provider-only mutations', async () => {
    const rpc = rpcMock()
    const notify = vi.fn()
    const { container, unmount } = await render(rpc, [], notify)
    await click(tab(container, 'Providers'))
    await click(button(container, 'Remove'))
    await click([...dialog(container).querySelectorAll('button')].find((b) => b.textContent === 'Remove')!)
    expect(rpc).toHaveBeenCalledWith('removeProvider', expect.objectContaining({ providerId: 'o-r' }))
    expect(notify).not.toHaveBeenCalled()
    await unmount()
  })
})

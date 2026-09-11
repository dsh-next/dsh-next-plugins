/**
 * jsdom render test for the Skills settings panel: proves the panel renders
 * the cc-plugins-style page (Skills / Providers tabs over a card grid) from
 * the Host envelope and that the interactive controls dispatch the right RPC
 * calls — direct global installation, the source switcher (Providers button,
 * overwrite confirm, detach),
 * the recorded-provider Update and two-step Delete controls, the detail modal
 * (markdown body), the provider filter, and the notification hook.
 * Complements the Host RPC contract test (shape) and the real-mount e2e
 * marker (whole shell).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { InstalledSkill, SkillsState } from '../src/core/types.ts'
import type { GridEntry } from '../src/client/SkillsPanel.tsx'
import { buildGridEntries, filterEntries, formatLastSync, searchTier, sourceKey, SkillsPanel } from '../src/client/SkillsPanel.tsx'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const skill: InstalledSkill = {
  name: 'security-review', description: 'Review code for security issues',
  source: 'user-agents', kind: 'bundle', path: '/a/SKILL.md', directory: '/a',
  provider: 'o/r',
  sources: [
    { providerId: 'o-r', providerSpec: 'o/r', skillPath: 'skills/security-review', version: 'v2', matches: false },
  ],
}

const STATE: SkillsState = {
  installed: [skill],
  providers: [{ id: 'o-r', spec: 'o/r', skillCount: 2, lastRefresh: '' }],
  catalog: [
    { name: 'find-skills', description: 'Find skills', providerId: 'o-r', providerSpec: 'o/r', skillPath: 'skills/find-skills', version: 'v1' },
    { name: 'deploy-helper', description: 'Deploy things', providerId: 'o-r', providerSpec: 'o/r', skillPath: 'skills/deploy-helper', version: 'v2' },
  ],
}

/** An externally-owned copy (cc-plugins) — its source is the owning plugin's. */
const ownedCopy: InstalledSkill = {
  ...skill, provider: undefined, sources: undefined,
  ownership: { owner: 'cc-plugins', pluginKey: 'github:o/r/team-tools', marketplaceId: 'github:o/r', skillName: 'security-review' },
}

/** One installed copy (from o/r) whose name is offered by three providers. */
const MULTI: SkillsState = {
  installed: [{
    ...skill, provider: 'o/r',
    sources: [
      { providerId: 'o-r', providerSpec: 'o/r', skillPath: 'a', version: 'v1', matches: true },
      { providerId: 'p-q', providerSpec: 'p/q', skillPath: 'b', version: 'v2', matches: false },
      { providerId: 'z-9', providerSpec: 'z/9', skillPath: 'c', version: 'v3', matches: false },
    ],
  }],
  providers: [
    { id: 'o-r', spec: 'o/r', skillCount: 1, lastRefresh: '' },
    { id: 'p-q', spec: 'p/q', skillCount: 1, lastRefresh: '' },
    { id: 'z-9', spec: 'z/9', skillCount: 1, lastRefresh: '' },
  ],
  catalog: [
    { name: 'security-review', description: 'd', providerId: 'o-r', providerSpec: 'o/r', skillPath: 'a', version: 'v1' },
    { name: 'security-review', description: 'd', providerId: 'p-q', providerSpec: 'p/q', skillPath: 'b', version: 'v2' },
    { name: 'security-review', description: 'd', providerId: 'z-9', providerSpec: 'z/9', skillPath: 'c', version: 'v3' },
    { name: 'unrelated-skill', description: 'd', providerId: 'o-r', providerSpec: 'o/r', skillPath: 'u', version: 'v1' },
  ],
}

/** A second copy of `security-review` in the other GLOBAL root (user .dsh). */
const secondGlobalCopy: InstalledSkill = {
  ...skill, source: 'user-dsh', provider: undefined,
  sources: undefined,
  path: '/home/u/.dsh/skills/security-review/SKILL.md',
  directory: '/home/u/.dsh/skills/security-review',
}

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
  notifyInstalledChanged?: () => void,
): Promise<Render> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root: Root = createRoot(container)
  await act(async () => {
    root.render(React.createElement(SkillsPanel, {
      rpc,
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

/** setValue wrapped in act: the controlled-input change re-renders the panel. */
async function typeValue(el: Element, value: string): Promise<void> {
  await act(async () => {
    setValue(el, value)
  })
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

/** Every element carrying a testid (used to assert several copies of a card). */
function allByTestId(container: HTMLElement, id: string): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)]
}

function rpcCalls(rpc: RpcFn & ReturnType<typeof vi.fn>): Array<[string, unknown?]> {
  return rpc.mock.calls as Array<[string, unknown?]>
}

afterEach(() => { document.body.innerHTML = '' })

describe('grid composition (buildGridEntries + filterEntries)', () => {
  it('installed groups sort first, then names to add, each alphabetical', () => {
    const entries = buildGridEntries(STATE)
    expect(entries.map((e) => e.name)).toEqual(['security-review', 'deploy-helper', 'find-skills'])
  })
  it('a discovered row resolves its provider id from the spec and carries the spec label', () => {
    const entries = buildGridEntries(STATE)
    const row = entries.find((e) => e.row !== undefined)!
    // The recorded provider spec resolves through the provider rows, so the
    // provider filter also matches installed copies.
    expect(row.providerId).toBe('o-r')
    expect(row.providerSpec).toBe('o/r')
    const cat = entries.find((e) => e.name === 'find-skills')!
    expect(cat.providerId).toBe('o-r')
  })
  it('duplicate copies of one name stay split: one entry per copy with its own key', () => {
    const entries = buildGridEntries({ ...STATE, installed: [skill, secondGlobalCopy] })
    const security = entries.filter((e) => e.name === 'security-review')
    // Two copies -> two entries, not one grouped card.
    expect(security).toHaveLength(2)
    // Each entry points at its single copy via `row` and a source:path key.
    // (Sort is name then providerSpec, so the provider-less user-dsh copy
    // comes before the provider-installed user-agents copy.)
    expect(security.map((e) => e.key)).toEqual([
      'row:user-dsh:/home/u/.dsh/skills/security-review/SKILL.md',
      'row:user-agents:/a/SKILL.md',
    ])
    const agentsEntry = security.find((e) => e.row === skill)!
    const dshEntry = security.find((e) => e.row === secondGlobalCopy)!
    expect(agentsEntry.key).toBe('row:user-agents:/a/SKILL.md')
    expect(dshEntry.key).toBe('row:user-dsh:/home/u/.dsh/skills/security-review/SKILL.md')
    // The installed group sorts first; the copies precede their offerings.
    expect(entries.map((e) => e.name))
      .toEqual(['security-review', 'security-review', 'deploy-helper', 'find-skills'])
  })
  it('filters by search, provider, and installed-only', () => {
    const entries = buildGridEntries(STATE)
    expect(filterEntries(entries, 'deploy', '', false).map((e) => e.name)).toEqual(['deploy-helper'])
    expect(filterEntries(entries, '', 'p-q', false)).toEqual([])
    // Installed-only keeps the copy (row set) and drops catalog-only rows.
    expect(filterEntries(entries, '', '', true).map((e) => e.name)).toEqual(['security-review'])
    // Catalog-only entries (no row) are excluded by the installed-only toggle.
    expect(filterEntries(entries, '', '', true).every((e) => e.row !== undefined)).toBe(true)
  })
  it('search ranks name matches above description-only matches', () => {
    // An alphabetically-first entry whose description merely mentions the
    // query must not outrank a real name match.
    const descMatch: GridEntry = { key: 'c:1', name: 'aaa-offering', description: 'Mentions e2e-test in its description.', catalog: {} as never }
    const nameMatch: GridEntry = { key: 'r:1', name: 'e2e-test-skill', description: 'Throwaway skill.', row: {} as never }
    const zNameMatch: GridEntry = { key: 'c:2', name: 'zeta-create', description: 'Unrelated description.', catalog: {} as never }
    const entries = [descMatch, nameMatch, zNameMatch]
    expect(searchTier(nameMatch, 'e2e-test')).toBe(1) // name starts with the query
    expect(searchTier(descMatch, 'e2e-test')).toBe(3)
    expect(searchTier({ ...nameMatch, name: 'skill-e2e-test' }, 'e2e-test')).toBe(2) // contains
    expect(searchTier({ ...zNameMatch, name: 'create' }, 'create')).toBe(0)
    expect(searchTier({ ...zNameMatch, name: 'create-x' }, 'create')).toBe(1)
    expect(searchTier(descMatch, 'nothing-matches-this')).toBeUndefined()
    const ranked = filterEntries(entries, 'e2e-test', '', false)
    expect(ranked.map((e) => e.name)).toEqual(['e2e-test-skill', 'aaa-offering'])
  })
  it('an empty query keeps every entry in grid order (no ranking shuffle)', () => {
    const entries = buildGridEntries(STATE)
    expect(filterEntries(entries, '   ', '', false).map((e) => e.name)).toEqual(entries.map((e) => e.name))
  })
  it('an installed name renders only its copy: the offerings collapse into the switcher', () => {
    const entries = buildGridEntries(MULTI)
    const cards = entries.filter((e) => e.name === 'security-review')
    // One card for the installed copy — no sibling offering cards.
    expect(cards).toHaveLength(1)
    expect(cards[0]!.row).toBeDefined()
    // The switcher's options ride the row (the host's per-provider parity).
    expect(cards[0]!.row!.sources).toHaveLength(3)
    // A name with no installed copy keeps the plain Use shape.
    const add = entries.find((e) => e.name === 'unrelated-skill')!
    expect(add.row).toBeUndefined()
    expect(add.catalog).toBeDefined()
  })
  it('the installed group sorts first, before names to add', () => {
    const entries = buildGridEntries(MULTI)
    expect(entries.map((e) => `${e.name}:${e.row !== undefined ? 'copy' : 'offering'}`)).toEqual([
      'security-review:copy',
      'unrelated-skill:offering',
    ])
  })
  it('a provider filter narrows to that provider\'s cards; installed-only keeps copies', () => {
    const entries = buildGridEntries(MULTI)
    // Filtering by p/q: the installed copy is recorded on o/r and the
    // same-name offerings no longer render, so nothing survives.
    expect(filterEntries(entries, '', 'p-q', false)).toEqual([])
    // Filtering by o/r keeps the copy (recorded spec resolves) and the
    // catalog-only name.
    const kept = filterEntries(entries, '', 'o-r', false)
    expect(kept.map((e) => e.providerSpec ?? e.row?.provider)).toEqual(['o/r', 'o/r'])
    // Installed-only drops every offering card, keeping the copy.
    const installedOnly = filterEntries(entries, '', '', true)
    expect(installedOnly).toHaveLength(1)
    expect(installedOnly[0]!.row).toBeDefined()
  })
  it('externally-owned copies hide their name offerings', () => {
    const state: SkillsState = { ...MULTI, installed: [ownedCopy] }
    const entries = buildGridEntries(state)
    // No sibling cards for the owned name; the copy itself renders.
    expect(entries.filter((e) => e.name === 'security-review')).toHaveLength(1)
    // Unrelated names are unaffected.
    expect(entries.find((e) => e.name === 'unrelated-skill')).toBeTruthy()
  })
})

describe('formatters', () => {
  it('labels the global source roots and falls back for custom roots', () => {
    expect(sourceKey('user-dsh')).toBe('source.userDsh')
    expect(sourceKey('user-agents')).toBe('source.userAgents')
    expect(sourceKey('custom')).toBe('source.custom')
    expect(sourceKey('unknown')).toBe('source.custom')
  })
  it('formatLastSync renders relative ages', () => {
    const now = Date.parse('2026-09-01T12:00:00Z')
    expect(formatLastSync('', now)).toBe('never')
    expect(formatLastSync('invalid', now)).toBe('unknown')
    expect(formatLastSync('2026-08-01T12:00:00Z', now)).toBe('2026-08-01')
    expect(formatLastSync(new Date(now - 30_000).toISOString(), now)).toBe('just now')
    expect(formatLastSync(new Date(now - 5 * 60_000).toISOString(), now)).toBe('5m ago')
    expect(formatLastSync(new Date(now - 3 * 3_600_000).toISOString(), now)).toBe('3h ago')
    expect(formatLastSync(new Date(now - 2 * 86_400_000).toISOString(), now)).toBe('2d ago')
  })
})

describe('SkillsPanel rendering', () => {
  it('renders the tabs, filter row, and one card per grid entry', async () => {
    const { container, unmount } = await render(rpcMock())
    expect(byTestId(container, 'skills-tab-skills')).toBeTruthy()
    expect(byTestId(container, 'skills-tab-providers')).toBeTruthy()
    expect(byTestId(container, 'skills-search')).toBeTruthy()
    expect(byTestId(container, 'skills-provider-filter')).toBeTruthy()
    // One installed copy plus two catalog-only skills -> three cards.
    const cards = container.querySelectorAll('[data-testid="skills-card"]')
    expect(cards).toHaveLength(3)
    // No enablement controls or presence claims; management actions remain.
    expect(container.querySelector('[data-testid="skills-presence"]')).toBeNull()
    expect(container.querySelector('[data-testid="skills-scopes"]')).toBeNull()
    expect(byTestId(container, 'skills-delete')).toBeTruthy()
    // The installed copy with an update candidate carries the Update button.
    expect(byTestId(container, 'skills-update')).toBeTruthy()
    await unmount()
  })

  it('renders the harness scaffold: title, intro, and the labeled tablist', async () => {
    const { container, unmount } = await render(rpcMock())
    expect(container.querySelector('h2')?.textContent).toBe('Skills')
    const intro = [...container.querySelectorAll('p')]
      .find((p) => p.textContent === 'Install and manage skills globally.')
    expect(intro, 'the intro line should render under the title').toBeTruthy()
    expect(container.querySelector('[role="tablist"]')?.getAttribute('aria-label')).toBe('Skill views')
    await unmount()
  })

  it('typing in the search box re-ranks the grid: the name match renders first', async () => {
    // The wiring regression: the search input must drive filterEntries, and
    // the alphabetical layout must not bury the name match behind an
    // alphabetically-earlier description-only match.
    const state: SkillsState = {
      installed: [],
      providers: [{ id: 'o-r', spec: 'o/r', skillCount: 2, lastRefresh: '' }],
      catalog: [
        { name: 'aaa-offering', description: 'Mentions e2e-test in its description.', providerId: 'o-r', providerSpec: 'o/r', skillPath: 'a', version: 'v1' },
        { name: 'e2e-test-skill', description: 'Throwaway skill.', providerId: 'o-r', providerSpec: 'o/r', skillPath: 'b', version: 'v1' },
      ],
    }
    const { container, unmount } = await render(rpcMock(state))
    const cards = () => allByTestId(container, 'skills-card').map((c) => c.querySelector('[data-testid="skills-detail"]')!.textContent)
    expect(cards()).toEqual(['aaa-offering', 'e2e-test-skill'])
    await typeValue(byTestId(container, 'skills-search'), 'e2e-test')
    expect(cards()).toEqual(['e2e-test-skill', 'aaa-offering'])
    await typeValue(byTestId(container, 'skills-search'), 'zzz-no-match')
    expect(byTestId(container, 'skills-empty').textContent).toContain('No skills match')
    await unmount()
  })

  it('the installed-only checkbox filters copies without adding any enablement control', async () => {
    const { container, unmount } = await render(rpcMock())
    const toggle = byTestId(container, 'skills-installed-only') as HTMLInputElement
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(1)
    await click(toggle)
    expect(toggle.checked).toBe(true)
    expect(allByTestId(container, 'skills-card').map((card) => byTestId(card, 'skills-detail').textContent)).toEqual(['security-review'])
    expect(container.querySelector('[data-testid="skills-use"], [data-testid="skills-scopes"]')).toBeNull()
    await click(toggle)
    expect(allByTestId(container, 'skills-card')).toHaveLength(3)
    await unmount()
  })

  it('changing the search resets pagination to the first page', async () => {
    // Page deep into a large result set, then search: the stale page size
    // must not hide the top of the new result set.
    const many: SkillsState = {
      installed: [],
      providers: [],
      catalog: Array.from({ length: 40 }, (_, i) => ({
        name: `bulk-skill-${String(i).padStart(2, '0')}`, description: `Bulk skill ${i}`,
        providerId: 'o-r', providerSpec: 'o/r', skillPath: `skills/bulk-${i}`, version: 'v1',
      })),
    }
    const { container, unmount } = await render(rpcMock(many))
    expect(allByTestId(container, 'skills-card')).toHaveLength(30)
    await click(byTestId(container, 'skills-show-more'))
    expect(allByTestId(container, 'skills-card')).toHaveLength(40)
    await typeValue(byTestId(container, 'skills-search'), 'bulk-skill-0')
    expect(allByTestId(container, 'skills-card')).toHaveLength(10)
    await typeValue(byTestId(container, 'skills-search'), '')
    // Reset to page one: 30 cards and the pager returns.
    expect(allByTestId(container, 'skills-card')).toHaveLength(30)
    expect(byTestId(container, 'skills-show-more')).toBeTruthy()
    await unmount()
  })

  it('the tab strip roves: ArrowRight steps forward and Home jumps back', async () => {
    const { container, unmount } = await render(rpcMock())
    const tablist = container.querySelector('[role="tablist"]') as HTMLElement
    const skills = byTestId(container, 'skills-tab-skills') as HTMLButtonElement
    const providers = byTestId(container, 'skills-tab-providers') as HTMLButtonElement
    // Initial state: the selection and the roving tab stop sit on Skills.
    expect(skills.getAttribute('aria-selected')).toBe('true')
    expect(skills.getAttribute('data-active')).toBe('true')
    expect(skills.tabIndex).toBe(0)
    expect(providers.getAttribute('aria-selected')).toBe('false')
    expect(providers.getAttribute('data-active')).toBeNull()
    expect(providers.tabIndex).toBe(-1)
    await act(async () => { tablist.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })) })
    expect(providers.getAttribute('aria-selected')).toBe('true')
    expect(providers.getAttribute('data-active')).toBe('true')
    expect(providers.tabIndex).toBe(0)
    expect(skills.getAttribute('aria-selected')).toBe('false')
    expect(document.activeElement).toBe(providers)
    await act(async () => { tablist.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })) })
    expect(skills.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(skills)
    await unmount()
  })

  it('a provider refresh result without an error text falls back to the localized Refresh failed', async () => {
    const rpc = vi.fn<RpcFn>(async (method: string) => {
      if (method === 'getState') return STATE
      if (method === 'refreshProvider') return { ok: false }
      return { ok: true, state: STATE }
    }) as RpcFn & ReturnType<typeof vi.fn>
    const { container, unmount } = await render(rpc)
    await click(byTestId(container, 'skills-tab-providers'))
    await click(button(container, 'Refresh all'))
    expect(byTestId(container, 'skills-message').textContent).toContain('Refresh failed')
    await unmount()
  })

  it('removing a provider confirms through a modal before the RPC', async () => {
    const rpc = rpcMock()
    const { container, unmount } = await render(rpc)
    await click(byTestId(container, 'skills-tab-providers'))
    await click(byTestId(container, 'skills-provider-remove'))
    const confirmModal = byTestId(container, 'skills-provider-remove-modal')
    expect(confirmModal.textContent).toContain('Remove o/r?')
    expect(confirmModal.textContent).toContain('Installed skills are kept')
    expect(byTestId(container, 'skills-provider-remove-spec').textContent).toBe('o/r')
    // Cancel closes without dispatching.
    await click(byTestId(container, 'skills-provider-remove-cancel'))
    expect(container.querySelector('[data-testid="skills-provider-remove-modal"]')).toBeNull()
    expect(rpcCalls(rpc).some(([m]) => m === 'removeProvider')).toBe(false)
    // Confirming dispatches with the provider id.
    await click(byTestId(container, 'skills-provider-remove'))
    await click(byTestId(container, 'skills-provider-remove-confirm-btn'))
    expect(rpcCalls(rpc).some(([m, args]) => m === 'removeProvider' && (args as { providerId?: string }).providerId === 'o-r')).toBe(true)
    expect(container.querySelector('[data-testid="skills-provider-remove-modal"]')).toBeNull()
    await unmount()
  })

  it('getState carries no workspace scoping — the listing is global-only', async () => {
    const rpc = rpcMock()
    await render(rpc)
    const call = rpcCalls(rpc).find(([m]) => m === 'getState')
    expect(call![1]).toBeUndefined()
  })

  it('renders one card per discovered copy, each with its own source chip and controls', async () => {
    const { container, unmount } = await render(rpcMock({ ...STATE, installed: [skill, secondGlobalCopy] }))
    // Two copies of the same name -> two cards (plus two catalog-only skills).
    const cards = allByTestId(container, 'skills-card')
    expect(cards).toHaveLength(4)
    // Find each copy's card by its origin source chip, regardless of sort order.
    const agentsCard = cards.find((c) => c.textContent!.includes('user .agents'))!
    const dshCard = cards.find((c) => c.textContent!.includes('user .dsh'))!
    expect(agentsCard).toBeTruthy()
    expect(dshCard).toBeTruthy()
    expect(agentsCard).not.toBe(dshCard)
    // Only the copy whose recorded provider's content differs gets Update.
    expect(agentsCard.querySelector('[data-testid="skills-update"]')).toBeTruthy()
    expect(dshCard.querySelector('[data-testid="skills-update"]')).toBeNull()
    // Only the copy with source options gets the Providers switcher.
    expect(agentsCard.querySelector('[data-testid="skills-providers"]')).toBeTruthy()
    expect(dshCard.querySelector('[data-testid="skills-providers"]')).toBeNull()
    // Every installed copy has its own Delete action, with no scope control.
    for (const card of [agentsCard, dshCard]) {
      expect(card.querySelector('[data-testid="skills-scopes"]')).toBeNull()
      expect(card.querySelector('[data-testid="skills-delete"]')).toBeTruthy()
    }
    await unmount()
  })

  it('the provider chip renders only for a copy whose provider is set', async () => {
    const { container, unmount } = await render(rpcMock({ ...STATE, installed: [skill, secondGlobalCopy] }))
    const cards = allByTestId(container, 'skills-card')
    const agentsCard = cards.find((c) => c.textContent!.includes('user .agents'))!
    const dshCard = cards.find((c) => c.textContent!.includes('user .dsh'))!
    // The user-agents copy is provider-installed (o/r); the user-dsh copy is not.
    expect(agentsCard.textContent).toContain('o/r')
    expect(dshCard.textContent).not.toContain('o/r')
    await unmount()
  })

  it('the per-copy Update button targets that copy with the picked candidate', async () => {
    const rpc = rpcMock()
    const { container, unmount } = await render(rpc)
    await click(byTestId(container, 'skills-update'))
    await act(async () => {})
    const call = rpcCalls(rpc).find(([m]) => m === 'updateSkill')
    expect(call![1]).toEqual({
      name: 'security-review', directory: '/a', providerId: 'o-r', skillPath: 'skills/security-review',
    })
    await unmount()
  })

  it('the per-copy Delete button opens the confirm modal without deleting yet', async () => {
    const rpc = rpcMock()
    const { container, unmount } = await render(rpc)
    // The installed copy has exactly one Delete action.
    const deletes = allByTestId(container, 'skills-delete')
    expect(deletes).toHaveLength(1)
    await click(deletes[0])
    await act(async () => {})
    // The confirm modal is present and no deleteSkill RPC has fired.
    const confirm = byTestId(container, 'skills-delete-confirm')
    expect(confirm.textContent).toContain('Delete security-review?')
    expect(confirm.textContent).toContain('trash')
    expect(byTestId(confirm, 'skills-delete-path').textContent)
      .toBe('/a/SKILL.md')
    expect(rpcCalls(rpc).filter(([m]) => m === 'deleteSkill')).toHaveLength(0)
    await unmount()
  })

  it('cancelling the delete confirm leaves the card and issues no deleteSkill', async () => {
    const rpc = rpcMock({ ...STATE, installed: [skill] })
    const { container, unmount } = await render(rpc)
    await click(byTestId(container, 'skills-delete'))
    await act(async () => {})
    expect(byTestId(container, 'skills-delete-confirm')).toBeTruthy()
    await click(byTestId(container, 'skills-delete-cancel'))
    await act(async () => {})
    // The modal closes and no RPC ran; the copy's cards remain.
    expect(container.querySelector('[data-testid="skills-delete-confirm"]')).toBeNull()
    expect(rpcCalls(rpc).filter(([m]) => m === 'deleteSkill')).toHaveLength(0)
    expect(container.querySelectorAll('[data-testid="skills-card"]')).toHaveLength(3)
    await unmount()
  })

  it('confirming the delete calls deleteSkill with the copy directory/kind/path, then closes', async () => {
    const rpc = rpcMock({ ...STATE, installed: [skill] })
    const { container, unmount } = await render(rpc)
    await click(byTestId(container, 'skills-delete'))
    await act(async () => {})
    await click(byTestId(container, 'skills-delete-confirm-btn'))
    await act(async () => {})
    const call = rpcCalls(rpc).find(([m]) => m === 'deleteSkill')
    expect(call![1]).toEqual({
      name: 'security-review',
      directory: '/a',
      kind: 'bundle',
      path: '/a/SKILL.md',
    })
    expect(container.querySelector('[data-testid="skills-delete-confirm"]')).toBeNull()
    await unmount()
  })

  it('externally-owned copies render no Update button, even with stale candidates', async () => {
    // Defense in depth: the host never emits candidates for owned rows, but a
    // stale envelope must not resurrect the provider-update affordance.
    const rpc = rpcMock({ ...STATE, installed: [ownedCopy] })
    const { container, unmount } = await render(rpc)
    expect(container.querySelector('[data-testid="skills-update"]')).toBeNull()
    expect(container.querySelector('[data-testid="skills-delete"]')).toBeTruthy()
    await unmount()
  })

  it('an empty state renders when nothing matches', async () => {
    const state: SkillsState = { ...STATE, installed: [], catalog: [] }
    const { container, unmount } = await render(rpcMock(state))
    expect(byTestId(container, 'skills-empty').textContent).toContain('No skills match')
    await unmount()
  })

  it('multi-provider names: one card, a Providers button counting the offerings', async () => {
    const rpc = rpcMock(MULTI)
    const { container, unmount } = await render(rpc)
    const cards = [...container.querySelectorAll('[data-testid="skills-card"]')]

    // One card for the installed copy, carrying the Providers switcher.
    expect(cards.filter((c) => c.textContent!.includes('security-review'))).toHaveLength(1)
    const rowCard = cards.find((c) => c.querySelector('[data-testid="skills-actions"]'))!
    const providers = rowCard.querySelector('[data-testid="skills-providers"]') as HTMLButtonElement
    expect(providers.textContent).toBe('Providers (3)')

    // No offering cards: no Replace buttons and no "current source" chips.
    expect(container.querySelector('[data-testid="skills-replace"]')).toBeNull()
    expect(container.querySelector('[data-testid="skills-source-current"]')).toBeNull()

    // The recorded provider's content matches -> no Update button.
    expect(rowCard.querySelector('[data-testid="skills-update"]')).toBeNull()

    // A name with no installed copy still shows Install.
    const addCard = cards.find((c) => c.textContent!.includes('unrelated-skill'))!
    expect(addCard.querySelector('[data-testid="skills-use"]')).toBeTruthy()
    await unmount()
  })

  it('two copies of one name share one bordered group box; single-card names stay unwrapped', async () => {
    const rpc = rpcMock({ ...STATE, installed: [skill, secondGlobalCopy] })
    const { container, unmount } = await render(rpc)
    // One group box around the two security-review copies.
    const groups = allByTestId(container, 'skills-group')
    expect(groups).toHaveLength(1)
    const grouped = groups[0]!.querySelectorAll('[data-testid="skills-card"]')
    expect(grouped).toHaveLength(2)
    // The add-only name renders as a plain card outside any group.
    const addCard = [...container.querySelectorAll('[data-testid="skills-card"]')]
      .find((c) => c.textContent!.includes('find-skills'))!
    expect(addCard.closest('[data-testid="skills-group"]')).toBeNull()
    await unmount()
  })

  it('a provider filter that matches no rendered card falls back to the empty state', async () => {
    // p/q's filter: the installed copy is recorded on o/r and same-name
    // offerings no longer render, so nothing survives.
    const rpc = rpcMock(MULTI)
    const { container, unmount } = await render(rpc)
    await act(async () => {
      const select = byTestId(container, 'skills-provider-filter') as unknown as HTMLSelectElement
      select.value = 'p-q'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => {})
    expect(container.querySelectorAll('[data-testid="skills-card"]')).toHaveLength(0)
    expect(byTestId(container, 'skills-empty').textContent).toContain('No skills match')
    await unmount()
  })

  it('externally-owned names render no switcher and no offering cards', async () => {
    const rpc = rpcMock({ ...MULTI, installed: [ownedCopy] })
    const { container, unmount } = await render(rpc)
    expect(container.querySelector('[data-testid="skills-providers"]')).toBeNull()
    expect(container.querySelector('[data-testid="skills-replace"]')).toBeNull()
    // The owned copy still renders its details and safe deletion controls.
    expect(byTestId(container, 'skills-delete')).toBeTruthy()
    await unmount()
  })
})

describe('source switcher modal (Providers button)', () => {
  async function openSources(container: HTMLDivElement): Promise<void> {
    await click(byTestId(container, 'skills-providers'))
    await act(async () => {})
  }

  it('opens with Local and one radio per provider, current marked, match hints shown', async () => {
    const rpc = rpcMock(MULTI)
    const { container, unmount } = await render(rpc)
    await openSources(container)
    const modal = byTestId(container, 'skills-sources-modal')
    expect(modal.textContent).toContain('Sources for security-review')
    // Local first; the copy is recorded on o/r, so Local is not current.
    expect(byTestId(modal, 'skills-source-local').textContent).toContain('Local (hand-managed)')
    expect(byTestId(modal, 'skills-source-local-hint').textContent).toBe('Keep the files as they are; no provider updates.')
    // Providers sorted by spec, the recorded one marked Current, the rest
    // carrying their content parity.
    const options = allByTestId(modal, 'skills-source-option')
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringContaining('o/r'), expect.stringContaining('p/q'), expect.stringContaining('z/9'),
    ])
    expect(options[0]!.querySelector('[data-testid="skills-source-option-hint"]')!.textContent).toBe('Current')
    expect(options[1]!.querySelector('[data-testid="skills-source-option-hint"]')!.textContent).toBe('Differs from your copy')
    await unmount()
  })

  it('Replace is disabled while the current source is selected', async () => {
    const rpc = rpcMock(MULTI)
    const { container, unmount } = await render(rpc)
    await openSources(container)
    // Draft starts on the current source (o/r): the footer action is a no-op.
    const apply = byTestId(container, 'skills-source-apply') as HTMLButtonElement
    expect(apply.disabled).toBe(true)
    await unmount()
  })

  it('selecting a provider requires the overwrite confirm, which fires updateSkill', async () => {
    const rpc = rpcMock(MULTI)
    const { container, unmount } = await render(rpc)
    await openSources(container)
    // Pick p/q's radio (the second provider option).
    const option = allByTestId(container, 'skills-source-option')[1]!
    await click(option.querySelector('input')!)
    await act(async () => {})
    const apply = byTestId(container, 'skills-source-apply') as HTMLButtonElement
    expect(apply.textContent).toBe('Replace')
    expect(apply.disabled).toBe(false)
    // Still no RPC: the confirm phase guards the mutation.
    expect(rpcCalls(rpc).filter(([m]) => m === 'updateSkill')).toHaveLength(0)
    await click(apply)
    await act(async () => {})
    // The confirm phase replaces the radio content in the same overlay.
    expect(container.querySelector('[data-testid="skills-source-options"]')).toBeNull()
    expect(byTestId(container, 'skills-source-confirm-body').textContent).toContain('p/q version')
    expect(byTestId(container, 'skills-source-confirm-body').textContent).toContain('not moved to trash')
    expect(byTestId(container, 'skills-source-confirm-body').textContent).not.toMatch(/scope|visibility|enablement/i)
    expect(byTestId(container, 'skills-source-path').textContent).toBe('/a')
    await click(byTestId(container, 'skills-source-confirm-btn'))
    await act(async () => {})
    const call = rpcCalls(rpc).find(([m]) => m === 'updateSkill')
    expect(call![1]).toEqual({ name: 'security-review', directory: '/a', providerId: 'p-q', skillPath: 'b' })
    // The modal closes after applying.
    expect(container.querySelector('[data-testid="skills-sources-modal"]')).toBeNull()
    await unmount()
  })

  it('cancelling the confirm returns to the radio phase without any RPC', async () => {
    const rpc = rpcMock(MULTI)
    const { container, unmount } = await render(rpc)
    await openSources(container)
    const option = allByTestId(container, 'skills-source-option')[1]!
    await click(option.querySelector('input')!)
    await act(async () => {})
    await click(byTestId(container, 'skills-source-apply'))
    await act(async () => {})
    await click(byTestId(container, 'skills-source-confirm-cancel'))
    await act(async () => {})
    // Back to the radios; the draft stays on the picked provider.
    expect(byTestId(container, 'skills-source-options')).toBeTruthy()
    expect(rpcCalls(rpc).filter(([m]) => m === 'updateSkill')).toHaveLength(0)
    await unmount()
  })

  it('choosing Local on a recorded copy applies detachSkill directly (reversible, no confirm)', async () => {
    const rpc = rpcMock(MULTI)
    const { container, unmount } = await render(rpc)
    await openSources(container)
    await click(byTestId(container, 'skills-source-local').querySelector('input')!)
    await act(async () => {})
    const apply = byTestId(container, 'skills-source-apply') as HTMLButtonElement
    expect(apply.textContent).toBe('Detach')
    expect(apply.disabled).toBe(false)
    await click(apply)
    await act(async () => {})
    const call = rpcCalls(rpc).find(([m]) => m === 'detachSkill')
    expect(call![1]).toEqual({ name: 'security-review', directory: '/a' })
    expect(rpcCalls(rpc).filter(([m]) => m === 'updateSkill')).toHaveLength(0)
    expect(container.querySelector('[data-testid="skills-sources-modal"]')).toBeNull()
    await unmount()
  })

  it('a hand-managed copy with differing sources: no Update button, switch through the modal', async () => {
    // Q6a: no silent candidates[0] — an unrecorded copy routes provider
    // switches through the explicit modal even when content differs.
    const unrecorded: InstalledSkill = {
      ...skill, provider: undefined,
      sources: [
        { providerId: 'o-r', providerSpec: 'o/r', skillPath: 'skills/security-review', version: 'v2', matches: false },
      ],
    }
    const rpc = rpcMock({ ...STATE, installed: [unrecorded] })
    const { container, unmount } = await render(rpc)
    expect(container.querySelector('[data-testid="skills-update"]')).toBeNull()
    await openSources(container)
    // Local is current: its hint marks it, and the footer starts disabled.
    expect(byTestId(container, 'skills-source-local-hint').textContent).toBe('Current')
    expect((byTestId(container, 'skills-source-apply') as HTMLButtonElement).disabled).toBe(true)
    // Picking the provider arms Replace; confirming adopts it via updateSkill.
    const option = allByTestId(container, 'skills-source-option')[0]!
    expect(option.querySelector('[data-testid="skills-source-option-hint"]')!.textContent).toBe('Differs from your copy')
    await click(option.querySelector('input')!)
    await act(async () => {})
    await click(byTestId(container, 'skills-source-apply'))
    await act(async () => {})
    await click(byTestId(container, 'skills-source-confirm-btn'))
    await act(async () => {})
    const call = rpcCalls(rpc).find(([m]) => m === 'updateSkill')
    expect(call![1]).toEqual({ name: 'security-review', directory: '/a', providerId: 'o-r', skillPath: 'skills/security-review' })
    await unmount()
  })

  it('Escape closes the switcher from either phase and issues no RPC', async () => {
    const rpc = rpcMock(MULTI)
    const { container, unmount } = await render(rpc)
    await openSources(container)
    const option = allByTestId(container, 'skills-source-option')[1]!
    await click(option.querySelector('input')!)
    await act(async () => {})
    await click(byTestId(container, 'skills-source-apply'))
    await act(async () => {})
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    await act(async () => {})
    expect(container.querySelector('[data-testid="skills-sources-modal"]')).toBeNull()
    expect(rpcCalls(rpc).filter(([m]) => m === 'updateSkill' || m === 'detachSkill')).toHaveLength(0)
    await unmount()
  })

  it('flat and unoffered copies render no Providers button', async () => {
    const flat: InstalledSkill = { ...skill, name: 'flat-skill', kind: 'flat', sources: undefined, path: '/flat.md', directory: '/home/u/.agents/skills' }
    const plain: InstalledSkill = { ...skill, name: 'plain', sources: undefined }
    const rpc = rpcMock({ ...STATE, installed: [flat, plain] })
    const { container, unmount } = await render(rpc)
    expect(container.querySelector('[data-testid="skills-providers"]')).toBeNull()
    // Delete still renders for both copies.
    expect(allByTestId(container, 'skills-delete')).toHaveLength(2)
    await unmount()
  })
})

describe('global-only installation', () => {
  it('Install dispatches only providerId and skillPath immediately, refreshes cards, and notifies', async () => {
    const installed: InstalledSkill = {
      ...skill, name: 'deploy-helper', path: '/global/deploy-helper/SKILL.md', directory: '/global/deploy-helper',
    }
    const next = { ...STATE, installed: [...STATE.installed, installed] }
    const rpc = vi.fn<RpcFn>(async (method) => method === 'getState' ? STATE : { ok: true, state: next })
    const notify = vi.fn()
    const { container, unmount } = await render(rpc, notify)
    const install = byTestId(container, 'skills-use')
    expect(install.textContent).toBe('Install')
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    await click(install)
    expect(rpcCalls(rpc)).toEqual([
      ['getState'],
      ['installSkill', { providerId: 'o-r', skillPath: 'skills/deploy-helper' }],
    ])
    expect(notify).toHaveBeenCalledTimes(1)
    expect(byTestId(container, 'skills-message').textContent).toBe('Done')
    const card = allByTestId(container, 'skills-card').find((c) => c.textContent!.includes('deploy-helper'))!
    expect(card.querySelector('[data-testid="skills-use"]')).toBeNull()
    expect(card.querySelector('[data-testid="skills-delete"]')).toBeTruthy()
    expect(container.querySelector('[role="dialog"], [data-testid="skills-scopes"], [data-testid="skills-presence"], [data-testid="skills-workspaces"], input[type="radio"]')).toBeNull()
    expect(container.textContent).not.toMatch(/Scopes|Everywhere|Save scope|Selected workspaces/)
    await unmount()
  })

  it('disables install and mutation controls while a global install is pending', async () => {
    let finish!: (result: unknown) => void
    const pending = new Promise((resolve) => { finish = resolve })
    const rpc = vi.fn<RpcFn>(async (method) => method === 'getState' ? STATE : pending)
    const { container, unmount } = await render(rpc)
    await click(byTestId(container, 'skills-use'))
    for (const id of ['skills-use', 'skills-delete', 'skills-update', 'skills-providers']) {
      expect((byTestId(container, id) as HTMLButtonElement).disabled).toBe(true)
    }
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    await act(async () => { finish({ ok: true, state: STATE }) })
    expect((byTestId(container, 'skills-use') as HTMLButtonElement).disabled).toBe(false)
    expect(rpcCalls(rpc).filter(([method]) => method === 'installSkill')).toHaveLength(1)
    await unmount()
  })

  it.each([
    { result: { ok: false, error: 'install rejected' }, message: 'install rejected' },
    { result: { ok: false }, message: 'Request failed' },
    { result: new Error('offline'), message: 'offline' },
  ])('surfaces install failure: $message, without notifying or losing retry', async ({ result, message }) => {
    const rpc = vi.fn<RpcFn>(async (method) => {
      if (method === 'getState') return STATE
      if (result instanceof Error) throw result
      return result
    })
    const notify = vi.fn()
    const { container, unmount } = await render(rpc, notify)
    await click(byTestId(container, 'skills-use'))
    expect(byTestId(container, 'skills-message').textContent).toBe(message)
    expect(notify).not.toHaveBeenCalled()
    expect((byTestId(container, 'skills-use') as HTMLButtonElement).disabled).toBe(false)
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    await unmount()
  })

  it('refetches global state when install succeeds without an inline state and preserves warnings', async () => {
    const rpc = vi.fn<RpcFn>(async (method) => method === 'getState' ? STATE : { ok: true, warning: 'Installed with warning' })
    const notify = vi.fn()
    const { container, unmount } = await render(rpc, notify)
    await click(byTestId(container, 'skills-use'))
    expect(rpcCalls(rpc).filter(([method]) => method === 'getState')).toEqual([['getState'], ['getState']])
    expect(byTestId(container, 'skills-message').textContent).toBe('Installed with warning')
    expect(notify).toHaveBeenCalledTimes(1)
    await unmount()
  })

  it('keeps details and safe deletion for a hand-managed copy without provider candidates', async () => {
    const rpc = rpcMock({ ...STATE, installed: [{ ...skill, provider: undefined, sources: undefined }] })
    const { container, unmount } = await render(rpc)
    expect(container.querySelector('[data-testid="skills-update"], [data-testid="skills-providers"], [data-testid="skills-scopes"]')).toBeNull()
    const card = allByTestId(container, 'skills-card')[0]!
    await click(byTestId(card, 'skills-detail'))
    expect(byTestId(container, 'skills-detail-body').querySelector('h1')?.textContent).toBe('Heading')
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    await click(byTestId(card, 'skills-delete'))
    expect(byTestId(container, 'skills-delete-confirm').textContent).toContain('trash')
    expect(rpcCalls(rpc).some(([method]) => method === 'deleteSkill')).toBe(false)
    await unmount()
  })
})

describe('detail modal', () => {
  it('loads an installed detail and renders the markdown body', async () => {
    const rpc = rpcMock()
    const { container, unmount } = await render(rpc)
    // Target the INSTALLED copy's detail button (the grid sorts
    // alphabetically, so it is no longer the first card).
    const rowCard = [...container.querySelectorAll('[data-testid="skills-card"]')]
      .find((c) => c.textContent!.includes('user .agents'))!
    await click(rowCard.querySelector('[data-testid="skills-detail"]')!)
    const detail = byTestId(container, 'skills-skill-detail')
    await act(async () => {})
    const call = rpcCalls(rpc).find(([m]) => m === 'getInstalledSkillDetail')
    expect(call).toBeTruthy()
    // The click's copy path rides the detail RPC, so a name with several
    // copies opens the body of the copy that was clicked, not the first.
    expect(call![1]).toMatchObject({ name: 'security-review', path: '/a/SKILL.md' })
    const body = byTestId(detail, 'skills-detail-body')
    expect(body.querySelector('h1')?.textContent).toBe('Heading')
    expect(body.querySelector('p')?.textContent).toBe('Paragraph text.')
    await unmount()
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
    const r = await render(rpc)
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
    // Removal is two-step: the confirm modal names the provider, and the
    // confirm dispatches with its id.
    await click(byTestId(container, 'skills-provider-remove'))
    await click(byTestId(container, 'skills-provider-remove-confirm-btn'))
    expect(rpcCalls(rpc).find(([m]) => m === 'removeProvider')![1])
      .toEqual({ providerId: 'o-r' })
    await unmount()
  })

  it('adds a provider from the input (click and Enter) and refreshes all', async () => {
    const rpc = rpcMock()
    const { container, unmount } = await openProviders(rpc)
    const input = byTestId(container, 'skills-add-input') as HTMLInputElement
    await typeValue(input, 'vercel/agent-skills')
    await click(button(container, 'Add provider'))
    expect(rpcCalls(rpc).find(([m]) => m === 'addProvider')![1])
      .toEqual({ spec: 'vercel/agent-skills' })
    await click(byTestId(container, 'skills-provider-refresh-all'))
    await act(async () => {})
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

  it('refresh all surfaces the host reconcile warnings without an extra pass', async () => {
    // The host reconciles inside refreshProvider and reports reinstalled
    // skills as `warning`; the panel appends it to the summary message.
    const rpc = vi.fn(async (method: string) => {
      if (method === 'getState') return STATE
      if (method === 'refreshProvider') {
        return { ok: true, state: STATE, warning: '"find-skills" reinstalled from vercel-labs/skills' }
      }
      return { ok: true, state: STATE }
    })
    const { container, unmount } = await openProviders(rpc)
    await click(byTestId(container, 'skills-provider-refresh-all'))
    await act(async () => {})
    expect(rpcCalls(rpc).filter(([m]) => m === 'reconcileInstalled')).toHaveLength(0)
    expect(byTestId(container, 'skills-message').textContent).toContain('reinstalled from vercel-labs/skills')
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
    await click(byTestId(container, 'skills-provider-remove-confirm-btn'))
    expect(byTestId(container, 'skills-message').textContent).toContain('provider busy')
    await unmount()
  })
})

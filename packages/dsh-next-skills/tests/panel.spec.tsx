/**
 * jsdom render test for the Skills settings panel: proves the panel renders
 * the cc-plugins-style page (Skills / Providers tabs over a two-column card
 * grid) from the Host envelope and that the interactive controls dispatch the
 * right RPC calls — the scope modal (Add for catalog-only rows / Manage for
 * installed copies), the per-copy Update and two-step Delete controls, the
 * detail modal (markdown body), the provider filter, and the notification
 * hook. Complements the Host RPC contract test (shape) and the real-mount e2e
 * marker (whole shell).
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
  provider: 'o/r', updateAvailable: true,
  updateCandidates: [{ providerId: 'o-r', providerSpec: 'o/r', skillPath: 'skills/security-review', version: 'v2' }],
}

const STATE: SkillsState = {
  installed: [skill],
  providers: [{ id: 'o-r', spec: 'o/r', skillCount: 2, lastRefresh: '' }],
  catalog: [
    { name: 'find-skills', description: 'Find skills', providerId: 'o-r', providerSpec: 'o/r', skillPath: 'skills/find-skills', version: 'v1' },
    { name: 'deploy-helper', description: 'Deploy things', providerId: 'o-r', providerSpec: 'o/r', skillPath: 'skills/deploy-helper', version: 'v2' },
  ],
}

/** A second copy of `security-review` under a workspace root, with no update. */
const workspaceCopy: InstalledSkill = {
  ...skill, scope: 'workspace', source: 'project-agents', provider: undefined,
  updateAvailable: undefined, updateCandidates: undefined,
  path: '/w1/.agents/skills/security-review/SKILL.md',
  directory: '/w1/.agents/skills/security-review',
}

/** An externally-owned copy (cc-plugins) — provider updates are not ours. */
const ownedCopy: InstalledSkill = {
  ...skill, provider: undefined,
  ownership: { owner: 'cc-plugins', pluginKey: 'github:o/r/team-tools', marketplaceId: 'github:o/r', skillName: 'security-review' },
}

/** One installed copy (from o/r) whose name is offered by three providers. */
const MULTI: SkillsState = {
  installed: [{ ...skill, updateAvailable: undefined, updateCandidates: undefined }],
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
  ...skill, scope: 'global', source: 'user-dsh', provider: undefined,
  updateAvailable: undefined, updateCandidates: undefined,
  path: '/home/u/.dsh/skills/security-review/SKILL.md',
  directory: '/home/u/.dsh/skills/security-review',
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
  it('same-name offerings become sibling cards: one active source, the rest replaceable', () => {
    const entries = buildGridEntries(MULTI)
    const cards = entries.filter((e) => e.name === 'security-review')
    // The installed copy plus one card per provider offering.
    expect(cards).toHaveLength(4)
    const row = cards.find((e) => e.row !== undefined)!
    expect(row.sourceCount).toBe(3)
    const siblings = cards.filter((e) => e.catalog !== undefined)
    // The offering matching the copy's recorded provider is the active source.
    expect(siblings.find((e) => e.providerSpec === 'o/r')!.installed).toEqual({ directory: '/a', active: true })
    expect(siblings.find((e) => e.providerSpec === 'p/q')!.installed).toEqual({ directory: '/a', active: false })
    expect(siblings.find((e) => e.providerSpec === 'z/9')!.installed).toEqual({ directory: '/a', active: false })
    // A name with no installed copy keeps the plain Add shape.
    expect(entries.find((e) => e.name === 'unrelated-skill')!.installed).toBeUndefined()
  })
  it('the installed group sorts first and its managed copy precedes the offerings', () => {
    const entries = buildGridEntries(MULTI)
    expect(entries.map((e) => `${e.name}:${e.row !== undefined ? 'copy' : 'offering'}`)).toEqual([
      'security-review:copy',
      'security-review:offering',
      'security-review:offering',
      'security-review:offering',
      'unrelated-skill:offering',
    ])
    // Within the group: the copy, then the offerings by provider spec.
    expect(entries.slice(1, 4).map((e) => e.providerSpec)).toEqual(['o/r', 'p/q', 'z/9'])
  })
  it('a provider filter narrows the group to that provider\'s cards only', () => {
    const entries = buildGridEntries(MULTI)
    // Filtering by p/q: the installed copy (recorded on o/r) and the other
    // providers' offerings drop out — the group does not keep them visible.
    const kept = filterEntries(entries, '', 'p-q', false)
    expect(kept.map((e) => e.providerSpec ?? e.row?.provider)).toEqual(['p/q'])
    // Installed-only drops every offering card, keeping the copy.
    const installedOnly = filterEntries(entries, '', '', true)
    expect(installedOnly).toHaveLength(1)
    expect(installedOnly[0]!.row).toBeDefined()
  })
  it('externally-owned copies hide their name offerings and the sources chip', () => {
    const state: SkillsState = { ...MULTI, installed: [ownedCopy] }
    const entries = buildGridEntries(state)
    // No sibling cards for the owned name; no replace metadata anywhere.
    expect(entries.filter((e) => e.name === 'security-review')).toHaveLength(1)
    expect(entries.every((e) => e.installed === undefined)).toBe(true)
    expect(entries.find((e) => e.row !== undefined)!.sourceCount).toBeUndefined()
    // Unrelated names are unaffected.
    expect(entries.find((e) => e.name === 'unrelated-skill')).toBeTruthy()
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
    // One installed copy plus two catalog-only skills -> three cards.
    const cards = container.querySelectorAll('[data-testid="skills-card"]')
    expect(cards).toHaveLength(3)
    // The installed card shows the presence badge and Manage/Delete actions.
    expect(byTestId(container, 'skills-presence').textContent).toBe('Everywhere')
    expect(byTestId(container, 'skills-manage')).toBeTruthy()
    expect(byTestId(container, 'skills-delete')).toBeTruthy()
    // The installed copy with an update candidate carries the Update button.
    expect(byTestId(container, 'skills-update')).toBeTruthy()
    await unmount()
  })

  it('renders the harness scaffold: title, intro, and the labeled tablist', async () => {
    const { container, unmount } = await render(rpcMock(), WS)
    expect(container.querySelector('h2')?.textContent).toBe('Skills')
    const intro = [...container.querySelectorAll('p')]
      .find((p) => p.textContent === 'Install skills from providers and control where each one is enabled.')
    expect(intro, 'the intro line should render under the title').toBeTruthy()
    expect(container.querySelector('[role="tablist"]')?.getAttribute('aria-label')).toBe('Skill views')
    await unmount()
  })

  it('the tab strip roves: ArrowRight steps forward and Home jumps back', async () => {
    const { container, unmount } = await render(rpcMock(), WS)
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
    const { container, unmount } = await render(rpc, WS)
    await click(byTestId(container, 'skills-tab-providers'))
    await click(button(container, 'Refresh all'))
    expect(byTestId(container, 'skills-message').textContent).toContain('Refresh failed')
    await unmount()
  })

  it('getState carries no workspace scoping — the listing is global-only', async () => {
    const rpc = rpcMock()
    await render(rpc, WS)
    const call = rpcCalls(rpc).find(([m]) => m === 'getState')
    expect(call![1]).toBeUndefined()
  })

  it('renders one card per discovered copy, each with its own source chip and controls', async () => {
    const { container, unmount } = await render(rpcMock({ ...STATE, installed: [skill, secondGlobalCopy] }), WS)
    // Two copies of the same name -> two cards (plus two catalog-only skills).
    const cards = allByTestId(container, 'skills-card')
    expect(cards).toHaveLength(4)
    // Find each copy's card by its origin source chip, regardless of sort order.
    const agentsCard = cards.find((c) => c.textContent!.includes('user .agents'))!
    const dshCard = cards.find((c) => c.textContent!.includes('user .dsh'))!
    expect(agentsCard).toBeTruthy()
    expect(dshCard).toBeTruthy()
    expect(agentsCard).not.toBe(dshCard)
    // Only the copy with an update candidate gets the Update control.
    expect(agentsCard.querySelector('[data-testid="skills-update"]')).toBeTruthy()
    expect(dshCard.querySelector('[data-testid="skills-update"]')).toBeNull()
    // Every installed copy has its own Manage and Delete, side by side.
    for (const card of [agentsCard, dshCard]) {
      expect(card.querySelector('[data-testid="skills-manage"]')).toBeTruthy()
      expect(card.querySelector('[data-testid="skills-delete"]')).toBeTruthy()
    }
    await unmount()
  })

  it('the provider chip renders only for a copy whose provider is set', async () => {
    const { container, unmount } = await render(rpcMock({ ...STATE, installed: [skill, secondGlobalCopy] }), WS)
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
    const { container, unmount } = await render(rpc, WS)
    await click(byTestId(container, 'skills-update'))
    await act(async () => {})
    const call = rpcCalls(rpc).find(([m]) => m === 'updateSkill')
    expect(call![1]).toEqual({
      name: 'security-review', directory: '/a', providerId: 'o-r', skillPath: 'skills/security-review',
    })
    await unmount()
  })

  it('the per-copy Delete button opens the confirm modal without deleting yet', async () => {
    const rpc = rpcMock({ ...STATE, installed: [skill, workspaceCopy] })
    const { container, unmount } = await render(rpc, WS)
    // The workspace copy in the envelope is filtered out: exactly one Delete.
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
    const { container, unmount } = await render(rpc, WS)
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
    const { container, unmount } = await render(rpc, WS)
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
    const { container, unmount } = await render(rpc, WS)
    expect(container.querySelector('[data-testid="skills-update"]')).toBeNull()
    expect(container.querySelector('[data-testid="skills-delete"]')).toBeTruthy()
    await unmount()
  })

  it('workspace copies never render — even a stale envelope carrying them is filtered out', async () => {    // Simulate a version-skewed host still returning a workspace row: the
    // panel must not render it (project skills are hand-managed, not listed).
    const rpc = rpcMock({ ...STATE, installed: [skill, workspaceCopy] })
    const { container, unmount } = await render(rpc, WS)
    const cards = allByTestId(container, 'skills-card')
    expect(cards.some((c) => c.textContent!.includes('project .agents'))).toBe(false)
    // The global copy renders with its controls enabled as usual.
    const userCard = cards.find((c) => c.textContent!.includes('user .agents'))!
    expect((userCard.querySelector('[data-testid="skills-delete"]') as HTMLButtonElement).disabled).toBe(false)
    expect(userCard.querySelector('[data-testid="skills-manage"]')).toBeTruthy()
    await unmount()
  })

  it('an empty state renders when nothing matches', async () => {
    const state: SkillsState = { ...STATE, installed: [], catalog: [] }
    const { container, unmount } = await render(rpcMock(state))
    expect(byTestId(container, 'skills-empty').textContent).toContain('No skills match')
    await unmount()
  })

  it('multi-provider names: sources chip, current source, and Replace re-pins provenance', async () => {
    const rpc = rpcMock(MULTI)
    const { container, unmount } = await render(rpc, WS)
    const cards = [...container.querySelectorAll('[data-testid="skills-card"]')]

    // The installed card carries the sources chip.
    const rowCard = cards.find((c) => c.querySelector('[data-testid="skills-presence"]'))!
    expect(rowCard.querySelector('[data-testid="skills-sources"]')!.textContent).toBe('3 sources')

    // The active source's sibling shows "current", no Replace and no Add.
    const activeCard = cards.find((c) => c.querySelector('[data-testid="skills-source-current"]'))!
    expect(activeCard.textContent).toContain('o/r')
    expect(activeCard.querySelector('[data-testid="skills-replace"]')).toBeNull()
    expect(activeCard.querySelector('[data-testid="skills-add"]')).toBeNull()

    // Another provider's sibling offers Replace; clicking re-pins via updateSkill.
    const replaceCard = cards.find((c) => c.querySelector('[data-testid="skills-replace"]') && c.textContent!.includes('p/q'))!
    const replace = replaceCard.querySelector('[data-testid="skills-replace"]') as HTMLButtonElement
    expect(replace.disabled).toBe(false)
    expect(replace.title).toContain('p/q')
    await click(replace)
    await act(async () => {})
    const call = rpcCalls(rpc).find(([m]) => m === 'updateSkill')
    expect(call![1]).toEqual({ name: 'security-review', directory: '/a', providerId: 'p-q', skillPath: 'b' })

    // A name with no installed copy still shows Add (not Replace).
    const addCard = cards.find((c) => c.textContent!.includes('unrelated-skill'))!
    expect(addCard.querySelector('[data-testid="skills-add"]')).toBeTruthy()
    expect(addCard.querySelector('[data-testid="skills-replace"]')).toBeNull()
    await unmount()
  })

  it('same-name cards share one bordered group box; single-card names stay unwrapped', async () => {
    const rpc = rpcMock(MULTI)
    const { container, unmount } = await render(rpc, WS)
    // One group box around the four security-review cards, copy first.
    const groups = allByTestId(container, 'skills-group')
    expect(groups).toHaveLength(1)
    const grouped = groups[0]!.querySelectorAll('[data-testid="skills-card"]')
    expect(grouped).toHaveLength(4)
    expect(grouped[0]!.querySelector('[data-testid="skills-presence"]')).toBeTruthy() // copy first
    // The add-only name renders as a plain card outside any group.
    const addCard = [...container.querySelectorAll('[data-testid="skills-card"]')]
      .find((c) => c.textContent!.includes('unrelated-skill'))!
    expect(addCard.closest('[data-testid="skills-group"]')).toBeNull()
    await unmount()
  })

  it('a provider filter collapses the group to the matching card (no wrapper)', async () => {
    // p/q's filter drops the installed copy and the other offerings: one
    // card survives, so it renders as a plain card, not a group box.
    const rpc = rpcMock(MULTI)
    const { container, unmount } = await render(rpc, WS)
    await act(async () => {
      const select = byTestId(container, 'skills-provider-filter') as unknown as HTMLSelectElement
      select.value = 'p-q'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => {})
    expect(container.querySelectorAll('[data-testid="skills-group"]')).toHaveLength(0)
    const cards = allByTestId(container, 'skills-card')
    expect(cards).toHaveLength(1)
    expect(cards[0]!.textContent).toContain('p/q')
    await unmount()
  })

  it('externally-owned names render no offerings, no sources chip, no Replace', async () => {
    const rpc = rpcMock({ ...MULTI, installed: [ownedCopy] })
    const { container, unmount } = await render(rpc, WS)
    expect(container.querySelector('[data-testid="skills-replace"]')).toBeNull()
    expect(container.querySelector('[data-testid="skills-sources"]')).toBeNull()
    expect(container.querySelector('[data-testid="skills-source-current"]')).toBeNull()
    // The owned copy itself still renders with its presence badge.
    expect(container.querySelector('[data-testid="skills-presence"]')).toBeTruthy()
    await unmount()
  })
})

describe('scope modal: add + manage', () => {
  it('Add (catalog-only entry) installs the catalog skill with the drafted scope and notifies', async () => {
    const rpc = rpcMock()
    const notify = vi.fn()
    const { container, unmount } = await render(rpc, WS, notify)
    // skills-add renders only on catalog-only cards; target the deploy-helper card.
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

  it('Manage (installed copy) opens the scope modal instead of an Add button', async () => {
    const { container, unmount } = await render(rpcMock(), WS)
    // Installed copies expose Manage, not Add.
    expect(container.querySelector('[data-testid="skills-manage"]')).toBeTruthy()
    await click(byTestId(container, 'skills-manage'))
    const scope = dialog(container)
    expect(scope.textContent).toContain('security-review')
    expect(scope.querySelector('[data-testid="skills-add"]')).toBeNull()
    await unmount()
  })

  it('the workspaces radio reveals the checklist and Save scopes to the checked workspaces', async () => {
    const rpc = rpcMock()
    const { container, unmount } = await render(rpc, WS)
    await click(byTestId(container, 'skills-manage'))
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
    }
    const { container, unmount } = await render(rpcMock(state), WS)
    await click(byTestId(container, 'skills-manage'))
    const scope = dialog(container)
    expect(radioByName(scope, 'skills-scope-workspaces').checked).toBe(true)
    expect(checkboxByTitle(scope, 'Project Two').checked).toBe(true)
    expect((button(scope, 'Save scope') as HTMLButtonElement).disabled).toBe(false)
    await unmount()
  })

  it('saving the workspaces mode with none checked disables everywhere', async () => {
    const rpc = rpcMock()
    const { container, unmount } = await render(rpc, WS)
    await click(byTestId(container, 'skills-manage'))
    const scope = dialog(container)
    await click(radioByName(scope, 'skills-scope-workspaces'))
    await click(button(scope, 'Save scope'))
    const call = rpcCalls(rpc).find(([m]) => m === 'setSkillScope')
    expect(call![1]).toEqual({ name: 'security-review', workspaces: [] })
    await unmount()
  })

  it('the scope modal is scope-only: no per-copy Update or Delete inside', async () => {
    const { container, unmount } = await render(rpcMock(), WS)
    await click(byTestId(container, 'skills-manage'))
    const scope = dialog(container)
    expect(scope.querySelector('[data-testid="skills-update"]')).toBeNull()
    expect(scope.querySelector('[data-testid="skills-delete"]')).toBeNull()
    await unmount()
  })

  it('a copy without an update candidate has no Update control but still manages and deletes', async () => {
    const state: SkillsState = {
      ...STATE,
      installed: [{ ...skill, provider: undefined, updateAvailable: undefined, updateCandidates: undefined }],
    }
    const rpc = rpcMock(state)
    const { container, unmount } = await render(rpc)
    expect(container.querySelector('[data-testid="skills-update"]')).toBeNull()
    expect(byTestId(container, 'skills-delete')).toBeTruthy()
    await click(byTestId(container, 'skills-manage'))
    const scope = dialog(container)
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
    const rowCard = [...container.querySelectorAll('[data-testid="skills-card"]')]
      .find((c) => c.textContent!.includes('user .agents'))!
    await click(rowCard.querySelector('[data-testid="skills-detail"]')!)
    await act(async () => {})
    const detail = byTestId(container, 'skills-skill-detail')
    const body = byTestId(detail, 'skills-detail-body')
    expect(body.querySelector('h1')?.textContent).toBe('Heading')
    // No render loop: the detail RPC fired exactly once for this open.
    const detailCalls = rpcCalls(rpc).filter(([m]) => m === 'getInstalledSkillDetail').length
    expect(detailCalls).toBe(1)
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
    expect(byTestId(container, 'skills-message').textContent).toContain('provider busy')
    await unmount()
  })
})

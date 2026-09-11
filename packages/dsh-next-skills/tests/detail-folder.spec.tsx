import { afterEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { SkillsPanel } from '../src/client/SkillsPanel.tsx'
import type { InstalledSkill, SkillsState } from '../src/core/types.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let container: HTMLDivElement | undefined

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  container?.remove()
  root = undefined
  container = undefined
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  localStorage.clear()
})

const installed: InstalledSkill = {
  name: 'review', description: 'Review code', source: 'user-agents', kind: 'bundle',
  path: '/global/skills/review/SKILL.md', directory: '/global/skills/review',
}

async function renderDetail(row?: InstalledSkill, apps = ['finder', 'vscode']) {
  const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ apps }), { status: 200 }))
  vi.stubGlobal('fetch', fetcher)
  const state: SkillsState = {
    installed: row ? [row] : [], providers: [],
    catalog: row ? [] : [{ name: 'review', description: 'Review code', providerId: 'o-r', providerSpec: 'o/r', skillPath: 'skills/review', version: 'v1' }],
  }
  const rpc = vi.fn(async (method: string) => method === 'getState' ? state : {
    name: 'review', description: 'Review code', body: '# Instructions', modelInvocable: true, userInvocable: true,
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root?.render(<SkillsPanel rpc={rpc} />))
  await act(async () => container!.querySelector<HTMLButtonElement>('[data-testid="skills-detail"]')!.click())
  return fetcher
}

describe('skill detail folder opener integration', () => {
  it.each([
    ['bundle', installed],
    ['flat', { ...installed, kind: 'flat' as const, path: '/global/skills/review.md', directory: '/global/skills' }],
    ['external', { ...installed, ownership: { owner: 'cc-plugins', pluginKey: 'k', marketplaceId: 'm', skillName: 'review' } }],
  ])('opens the selected %s copy directory, not its SKILL.md or session workspace', async (_kind, row) => {
    const fetcher = await renderDetail(row)
    const button = container!.querySelector<HTMLButtonElement>('[data-testid="skills-open-folder"]')!
    expect(button).not.toBeNull()
    expect(fetcher).toHaveBeenCalledTimes(1)
    await act(async () => button.click())
    const launch = fetcher.mock.calls.find((call) => String(call[0]).endsWith('/open-in-app/open'))
    expect(launch).toBeDefined()
    expect(JSON.parse(launch![1]!.body as string)).toEqual({ app: 'finder', path: row.directory })
    expect(container!.querySelector('[data-testid="skills-skill-detail"]')).not.toBeNull()
  })

  it('Escape closes the app menu before the detail dialog, without reaching the outer Settings listener', async () => {
    const outerEscape = vi.fn()
    document.addEventListener('keydown', outerEscape)
    try {
      await renderDetail(installed)
      const chevron = container!.querySelector<HTMLButtonElement>('[data-testid="skills-open-folder-menu"]')!
      await act(async () => chevron.click())
      const app = document.querySelector<HTMLElement>('[role="menuitem"]')!
      app.focus()
      await act(async () => app.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
      expect(document.querySelector('[role="menu"]')).toBeNull()
      expect(container!.querySelector('[data-testid="skills-skill-detail"]')).not.toBeNull()
      expect(document.activeElement).toBe(chevron)
      expect(outerEscape).not.toHaveBeenCalled()
      await act(async () => chevron.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
      expect(container!.querySelector('[data-testid="skills-skill-detail"]')).toBeNull()
      expect(outerEscape).not.toHaveBeenCalled()
    } finally {
      document.removeEventListener('keydown', outerEscape)
    }
  })

  it('does not mount or fetch the opener for an uninstalled catalog skill', async () => {
    const fetcher = await renderDetail()
    expect(container!.querySelector('[data-testid="skills-detail-body"]')?.textContent).toContain('Instructions')
    expect(container!.querySelector('[data-testid="skills-folder-opener"]')).toBeNull()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('keeps installed skill details readable when no applications are available', async () => {
    await renderDetail(installed, [])
    expect(container!.querySelector('[data-testid="skills-folder-opener"]')).toBeNull()
    expect(container!.querySelector('[data-testid="skills-detail-body"]')?.textContent).toContain('Instructions')
    await act(async () => container!.querySelector<HTMLButtonElement>('[data-testid="skills-detail-close"]')!.click())
    expect(container!.querySelector('[data-testid="skills-skill-detail"]')).toBeNull()
  })
})

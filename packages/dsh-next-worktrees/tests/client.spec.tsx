import { afterEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { IsolatedToggle } from '../src/client/isolated-toggle.tsx'
import { WorktreeChip } from '../src/client/worktree-chip.tsx'
import { englishTranslate } from '../src/client/dictionaries.ts'
import type { Translate } from '../src/client/types.ts'

const t = englishTranslate as unknown as Translate
import type { PreflightRpcOutcome, StatusRpcOutcome } from '../src/client/types.ts'

let container: HTMLDivElement | null = null
let root: Root | null = null

function render(element: React.ReactElement): HTMLDivElement {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  root.render(element)
  return container
}

afterEach(() => {
  root?.unmount()
  container?.remove()
  container = null
  root = null
})

const hook = (snapshot: unknown) => <T,>(select: (snapshot: unknown) => T): T => select(snapshot)

function flush(): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, 0) })
}

async function renderAndWait(element: React.ReactElement): Promise<HTMLDivElement> {
  const host = render(element)
  await React.act(async () => { await flush() })
  return host
}

function click(node: Element | null): void {
  node?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

describe('IsolatedToggle', () => {
  const baseProps = {
    rpc: vi.fn(async (method: string) => {
      if (method === 'preflight') {
        return { ok: true, degraded: false, reasons: [], showIgnoreHint: false } satisfies PreflightRpcOutcome
      }
      return {}
    }),
    t,
    services: {
      workspaces: { create: vi.fn(async () => ({ workspaceId: 'ws-1', path: '/w' })) },
      sessions: {
        create: vi.fn(async () => 'session-new'),
        open: vi.fn(),
      },
    },
  }

  it('renders nothing for a non-blank session', async () => {
    const host = await renderAndWait(
      <IsolatedToggle {...baseProps} sessionId="s1" useSession={hook({ composerPhase: 'engaged', cwd: '/repo' })} />,
    )
    expect(host.querySelector('[data-testid="worktrees-toggle"]')).toBeNull()
    expect(baseProps.rpc).not.toHaveBeenCalled()
  })

  it('renders nothing when git preflight degrades', async () => {
    const rpc = vi.fn(async () => ({ ok: false, degraded: true, reasons: ['not-a-repository'], showIgnoreHint: false }))
    const host = await renderAndWait(
      <IsolatedToggle {...baseProps} rpc={rpc} sessionId="s1" useSession={hook({ composerPhase: 'blank', cwd: '/plain' })} />,
    )
    expect(host.querySelector('[data-testid="worktrees-toggle"]')).toBeNull()
  })

  it('offers the switch, confirms, and drives the full create flow', async () => {
    const create = vi.fn(async () => ({
      slug: 'amber-42', path: '/repo/.dsh/worktrees/amber-42',
      sessionCwd: '/repo/.dsh/worktrees/amber-42', branch: 'dsh-worktrees/amber-42',
      baseRef: 'HEAD', title: 'fix login',
    }))
    const rpc = vi.fn(async (method: string) => {
      if (method === 'preflight') {
        return { ok: true, degraded: false, reasons: [], showIgnoreHint: false } satisfies PreflightRpcOutcome
      }
      if (method === 'create') return create()
      return {}
    })
    const services = baseProps.services
    const host = await renderAndWait(
      <IsolatedToggle
        {...baseProps} rpc={rpc} services={services}
        sessionId="s1"
        useSession={hook({ composerPhase: 'blank', cwd: '/repo' })}
        useInput={hook({ draft: 'fix the login bug' })}
      />,
    )
    const button = host.querySelector('[data-testid="worktrees-toggle-button"]')
    expect(button).not.toBeNull()
    await React.act(async () => { click(button) })
    expect(host.querySelector('[data-testid="worktrees-confirm"]')?.textContent).toContain('Create and switch')
    await React.act(async () => {
      click(host.querySelector('[data-testid="worktrees-confirm"]'))
      await flush()
      await flush()
    })
    expect(rpc).toHaveBeenCalledWith('create', { cwd: '/repo', title: 'fix the login bug' })
    expect(services.workspaces?.create).toHaveBeenCalledWith({ path: '/repo/.dsh/worktrees/amber-42' })
    expect(services.sessions?.create).toHaveBeenCalledWith({ workspaceId: 'ws-1' })
    expect(rpc).toHaveBeenCalledWith('bind', { sessionId: 'session-new' })
    expect(services.sessions?.open).toHaveBeenCalledWith('session-new')
  })

  it('surfaces creation failures without navigating', async () => {
    const rpc = vi.fn(async (method: string) => {
      if (method === 'preflight') {
        return { ok: true, degraded: false, reasons: [], showIgnoreHint: false } satisfies PreflightRpcOutcome
      }
      return { error: { code: 'git-failed', message: 'boom' } }
    })
    const services = { ...baseProps.services, sessions: { ...baseProps.services.sessions, open: vi.fn() } }
    const host = await renderAndWait(
      <IsolatedToggle
        {...baseProps} rpc={rpc} services={services}
        sessionId="s1"
        useSession={hook({ composerPhase: 'blank', cwd: '/repo' })}
      />,
    )
    await React.act(async () => { click(host.querySelector('[data-testid="worktrees-toggle-button"]')) })
    await React.act(async () => {
      click(host.querySelector('[data-testid="worktrees-confirm"]'))
      await flush()
      await flush()
    })
    expect(services.sessions.open).not.toHaveBeenCalled()
    expect(host.textContent).toContain('boom')
  })

  it('shows the one-time ignore hint until dismissed', async () => {
    window.localStorage.clear()
    const rpc = vi.fn(async () => ({ ok: true, degraded: false, reasons: [], showIgnoreHint: true }))
    const host = await renderAndWait(
      <IsolatedToggle {...baseProps} rpc={rpc} sessionId="s1" useSession={hook({ composerPhase: 'blank', cwd: '/repo' })} />,
    )
    expect(host.querySelector('[data-testid="worktrees-ignore-hint"]')).not.toBeNull()
    await React.act(async () => { click(host.querySelector('[data-testid="worktrees-ignore-hint"] button')) })
    expect(host.querySelector('[data-testid="worktrees-ignore-hint"]')).toBeNull()
    expect(window.localStorage.getItem('dsh-next-worktrees:ignore-hint:v1')).toBe('1')
    window.localStorage.clear()
  })
})

describe('WorktreeChip', () => {
  const unbound: StatusRpcOutcome = {
    bound: false, binding: null, chipStatus: null, ahead: null, dirty: null, siblings: [],
  }
  const bound: StatusRpcOutcome = {
    bound: true,
    binding: {
      slug: 'amber-42', path: '/repo/.dsh/worktrees/amber-42',
      branch: 'dsh-worktrees/amber-42', baseRef: 'HEAD', title: 'fix login',
    },
    chipStatus: 'dirty', ahead: 3, dirty: true,
    siblings: [
      { slug: 'bolt-07', title: 'other task', branch: 'dsh-worktrees/bolt-07', sessionId: 's2', running: true },
      { slug: 'calm-11', title: '', branch: 'dsh-worktrees/calm-11', sessionId: null, running: null },
    ],
  }

  function chipProps(status: StatusRpcOutcome, running = false) {
    return {
      rpc: vi.fn(async () => status),
      t,
      services: {
        sessions: { create: vi.fn(async () => 's9'), open: vi.fn() },
        workspaces: { create: vi.fn(async () => ({ workspaceId: 'ws-9', path: '/w' })) },
      },
      sessionId: 's1',
      useSession: hook({ cwd: '/repo/.dsh/worktrees/amber-42', running }),
    }
  }

  it('renders nothing for an unbound session', async () => {
    const host = await renderAndWait(<WorktreeChip {...chipProps(unbound)} />)
    expect(host.querySelector('[data-testid="worktrees-chip"]')).toBeNull()
  })

  it('renders title, ahead count, and the dirty dot', async () => {
    const host = await renderAndWait(<WorktreeChip {...chipProps(bound)} />)
    const chip = host.querySelector('[data-testid="worktrees-chip"]')
    expect(chip).not.toBeNull()
    expect(chip?.getAttribute('data-status')).toBe('dirty')
    expect(chip?.textContent).toContain('fix login')
    expect(chip?.textContent).toContain('3 ahead')
  })

  it('opens the panel, navigates siblings, and gates new-session on idle', async () => {
    const props = chipProps(bound, true)
    const host = await renderAndWait(<WorktreeChip {...props} />)
    await React.act(async () => { click(host.querySelector('[data-testid="worktrees-chip"]')) })
    const panel = host.querySelector('[data-testid="worktrees-panel"]')
    expect(panel).not.toBeNull()
    expect(panel?.textContent).toContain('origin fallback'.slice(0, 0) + 'HEAD')
    expect(panel?.textContent).toContain('other task')
    const siblingButtons = Array.from(panel?.querySelectorAll('button') ?? [])
    const other = siblingButtons.find((b) => b.textContent?.includes('other task')) ?? null
    await React.act(async () => { click(other) })
    expect(props.services.sessions.open).toHaveBeenCalledWith('s2')
    const newSession = siblingButtons.find((b) => b.textContent?.includes('New session here')) ?? null
    expect(newSession?.hasAttribute('disabled')).toBe(true)
  })

  it('remove surfaces the forced path for dirty worktrees', async () => {
    const props = chipProps(bound)
    const host = await renderAndWait(<WorktreeChip {...props} />)
    await React.act(async () => { click(host.querySelector('[data-testid="worktrees-chip"]')) })
    const remove = Array.from(host.querySelectorAll('button'))
      .find((b) => b.textContent === 'Remove worktree') ?? null
    await React.act(async () => { click(remove) })
    expect(host.querySelector('[data-testid="worktrees-remove-force"]')).not.toBeNull()
    await React.act(async () => {
      click(host.querySelector('[data-testid="worktrees-remove-force"]'))
      await flush()
      await flush()
    })
    expect(props.rpc).toHaveBeenCalledWith('remove', {
      cwd: '/repo/.dsh/worktrees/amber-42', slug: 'amber-42', force: true,
    })
  })
})

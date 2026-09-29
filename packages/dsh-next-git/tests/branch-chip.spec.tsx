/**
 * jsdom tests for the composer's branch chip: it appears only where the
 * session's checkout is a repository, it opens the shared ref picker, and the
 * picks it makes reach the host as the same requests the panel sends.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { BranchChip } from '../src/client/composer/BranchChip.tsx'
import { GitApiError, type GitApi } from '../src/client/api.ts'
import { interpolate, en, type MessageKey } from '../src/client/dictionaries.ts'
import type { RefSummary } from '../src/core/types.ts'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const t = (key: MessageKey, params?: Record<string, string | number>): string => interpolate(en[key], params)
const SESSION = 'session-1' as SessionId

function summary(overrides: Partial<RefSummary> = {}): RefSummary {
  return {
    root: '/repo',
    head: { oid: 'aaaaaaa1', branch: 'main', upstream: 'origin/main', ahead: 1, behind: 2, detached: false, unborn: false },
    branches: [
      { name: 'main', current: true, oid: 'aaaaaaa1', upstream: 'origin/main', remote: false, author: 'Ada', committedAt: 1_700_000_000, ahead: 1, behind: 2, subject: 'fix: guard the read' },
      { name: 'feature', current: false, oid: 'bbbbbbb2', upstream: null, remote: false, author: 'Ada', committedAt: 1_700_000_000, ahead: 0, behind: 0, subject: 'feat: alpha' },
    ],
    tags: [],
    ...overrides,
  }
}

/** A scripted API recording every call; `refSummary` answers with the state. */
function apiDouble(state: RefSummary | Error = summary()): {
  api: GitApi
  calls: { method: string; args: Record<string, unknown> }[]
  reads: () => number
} {
  const calls: { method: string; args: Record<string, unknown> }[] = []
  return {
    calls,
    reads: () => calls.filter((call) => call.method === 'refSummary').length,
    api: {
      call: async <T,>(method: string, args: Record<string, unknown>): Promise<T> => {
        calls.push({ method, args })
        if (method === 'refSummary') {
          if (state instanceof Error) throw state
          return state as T
        }
        return {} as T
      },
    },
  }
}

let root: Root
const chip = (): HTMLElement | null => document.querySelector('[data-dsh-git="composer-branch"]')
const filter = (): HTMLInputElement | null => document.querySelector('[data-dsh-git="ref-filter"]')
const row = (id: string): HTMLElement | null => document.querySelector(`[data-dsh-git="ref-row"][data-ref="${id}"]`)
const click = async (node: HTMLElement | null): Promise<void> => { await act(async () => { node!.click() }) }
const settle = async (): Promise<void> => { await act(async () => { await Promise.resolve() }) }

async function render(api: GitApi): Promise<void> {
  await act(async () => {
    root.render(<BranchChip sessionId={SESSION} api={api} t={t} />)
  })
  await settle()
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {}; disconnect() {} })
  root = createRoot(document.body.appendChild(document.createElement('div')))
})
afterEach(async () => {
  await act(async () => root.unmount())
  document.body.replaceChildren()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('composer branch chip', () => {
  it('shows the branch the session checkout is on with a consistent tooltip', async () => {
    await render(apiDouble().api)
    expect(chip()).not.toBeNull()
    expect(chip()?.textContent).toBe('main')
    expect(chip()?.getAttribute('aria-haspopup')).toBe('dialog')
    expect(chip()?.getAttribute('title')).toBeNull()
    await act(async () => chip()?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(t('composer.branchTitle', { branch: 'main' }))
    // A narrow composer hides the label, so the name is the accessible name
    // whether or not it is on screen.
    expect(chip()?.getAttribute('aria-label')).toBe('main')
  })

  it('renders nothing when the workspace is not a repository', async () => {
    const double = apiDouble(new GitApiError({ code: 'not-a-repository', detail: '' }, null))
    await render(double.api)
    expect(chip()).toBeNull()
    expect(document.body.textContent).toBe('')
  })

  it.each(['bare-repository', 'git-unavailable', 'permission-denied'] as const)('stays hidden for %s', async code => {
    await render(apiDouble(new GitApiError({ code, detail: '' }, null)).api)
    expect(chip()).toBeNull()
  })

  it('names an unborn checkout and a detached HEAD', async () => {
    const base = summary()
    await render(apiDouble({ ...base, head: { ...base.head, branch: null, unborn: true } }).api)
    expect(chip()?.textContent).toBe(en['header.unborn'])
    await act(async () => root.unmount())
    root = createRoot(document.body)
    await render(apiDouble({ ...base, head: { ...base.head, branch: null, detached: true } }).api)
    expect(chip()?.textContent).toBe(en['header.detached'])
  })

  it('retries a session the host has not loaded yet, then shows the branch', async () => {
    vi.useFakeTimers()
    const calls: string[] = []
    let fail = true
    const api: GitApi = {
      call: async <T,>(method: string): Promise<T> => {
        calls.push(method)
        if (fail) throw new GitApiError({ code: 'session-not-ready', detail: '' }, null)
        return summary() as T
      },
    }
    await render(api)
    expect(chip()).toBeNull()
    fail = false
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    expect(chip()).not.toBeNull()
    expect(calls.filter((method) => method === 'refSummary').length).toBeGreaterThan(1)
  })

  it('opens the shared ref picker with the grouped rows', async () => {
    await render(apiDouble().api)
    await click(chip())
    expect(document.querySelector('[data-dsh-git="ref-picker"]')).not.toBeNull()
    expect(filter()?.placeholder).toBe(en['picker.placeholder'])
    expect(row('branch:main')).not.toBeNull()
    expect(row('branch:feature')).not.toBeNull()
    expect(row('branch:main')?.textContent).toContain(en['picker.branches'])
  })

  it('switches to the picked branch and re-reads the summary', async () => {
    const double = apiDouble()
    await render(double.api)
    await click(chip())
    await click(row('branch:feature'))
    await settle()
    expect(double.calls.find((call) => call.method === 'branchSwitch')?.args).toEqual({ sessionId: SESSION, name: 'feature' })
    expect(double.reads()).toBe(2)
    expect(document.querySelector('[data-dsh-git="ref-picker"]')).toBeNull()
  })

  it('checks out a remote-tracking ref as a tracking branch', async () => {
    const base = summary({
      branches: [
        ...summary().branches,
        { name: 'origin/topic', current: false, oid: 'ccccccc3', upstream: null, remote: true, author: 'Ada', committedAt: 1_700_000_000, ahead: 0, behind: 0, subject: 'remote work' },
      ],
    })
    const double = apiDouble(base)
    await render(double.api)
    await click(chip())
    await click(row('remote:origin/topic'))
    await settle()
    expect(double.calls.find((call) => call.method === 'branchSwitch')?.args).toEqual({
      sessionId: SESSION,
      name: 'topic',
      remote: 'origin/topic',
    })
  })

  it('keeps the card open and reports a refused switch', async () => {
    const calls: { method: string; args: Record<string, unknown> }[] = []
    const api: GitApi = {
      call: async <T,>(method: string, args: Record<string, unknown>): Promise<T> => {
        calls.push({ method, args })
        if (method === 'refSummary') return summary() as T
        throw new GitApiError({ code: 'operation-in-progress', detail: '' }, null)
      },
    }
    await render(api)
    await click(chip())
    await click(row('branch:feature'))
    await settle()
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(en['failure.operationInProgress'])
    expect(document.querySelector('[data-dsh-git="ref-picker"]')).not.toBeNull()
  })

  it('creates a branch from the card and checks it out', async () => {
    const double = apiDouble()
    await render(double.api)
    await click(chip())
    await click(document.querySelector('[data-dsh-git="ref-action"][data-action="create"]'))
    const name = document.querySelector('[data-dsh-git="branch-name"]') as HTMLInputElement
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(name, 'feature/beta')
      name.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(document.querySelector('[data-dsh-git="branch-create-submit"]'))
    await settle()
    expect(double.calls.find((call) => call.method === 'branchCreate')?.args).toEqual({ sessionId: SESSION, name: 'feature/beta' })
    expect(double.calls.find((call) => call.method === 'branchSwitch')?.args).toEqual({ sessionId: SESSION, name: 'feature/beta' })
    expect(double.reads()).toBe(2)
  })

  it('detaches at the tagged commit picked from the detached list', async () => {
    const base = summary({ tags: [{ name: 'v1.0.0', oid: 'ddddddd4', author: 'Ada', committedAt: 1_700_000_000, subject: 'release' }] })
    const double = apiDouble(base)
    await render(double.api)
    await click(chip())
    await click(document.querySelector('[data-dsh-git="ref-action"][data-action="detach"]'))
    await click(row('tag:v1.0.0'))
    await settle()
    expect(double.calls.find((call) => call.method === 'checkoutCommit')?.args).toEqual({ sessionId: SESSION, hash: 'ddddddd4' })
  })

  it('re-reads the summary when the window regains focus', async () => {
    const double = apiDouble()
    await render(double.api)
    expect(double.reads()).toBe(1)
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    await settle()
    expect(double.reads()).toBe(2)
  })

  it('ignores a read that lands after unmount', async () => {
    let resolve: ((value: RefSummary) => void) | undefined
    const api: GitApi = {
      call: <T,>(method: string): Promise<T> => method === 'refSummary'
        ? new Promise<T>((done) => { resolve = done as (value: RefSummary) => void })
        : Promise.resolve({} as T),
    }
    await act(async () => { root.render(<BranchChip sessionId={SESSION} api={api} t={t} />) })
    await act(async () => root.unmount())
    await act(async () => { resolve?.(summary()) })
    expect(document.body.textContent).toBe('')
    root = createRoot(document.body)
  })
})

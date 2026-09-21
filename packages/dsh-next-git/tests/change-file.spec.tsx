/**
 * The change-view tab: the whole file, highlighted, with its changed lines
 * marked. jsdom cannot highlight code, but the primitive still renders one
 * `span.line` per source line, which is exactly the surface the decorations
 * attach to — so this suite proves the marking logic against the real structure
 * the component queries.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ChangeFileTab } from '../src/client/file/ChangeFileTab.tsx'
import { changeFileAddress } from '../src/core/address.ts'
import { englishTranslate as t } from '../src/client/dictionaries.ts'
import { GitApiError, type GitApi } from '../src/client/api.ts'
import type { FileChanges } from '../src/core/types.ts'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const changes = (overrides: Partial<FileChanges> = {}): FileChanges => ({
  path: 'src/app.ts',
  absolutePath: '/repo/src/app.ts',
  side: 'unstaged',
  language: 'typescript',
  text: 'const a = 1\nconst b = 2\nconst c = 3\n',
  markers: [{ line: 2, kind: 'added' }],
  binary: false,
  truncated: false,
  deleted: false,
  ...overrides,
})

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

function api(script: Record<string, unknown | (() => unknown)>): { api: GitApi; calls: { method: string; args: Record<string, unknown> }[] } {
  const calls: { method: string; args: Record<string, unknown> }[] = []
  return {
    calls,
    api: {
      async call<T>(method: string, args: Record<string, unknown>): Promise<T> {
        calls.push({ method, args })
        const entry = script[method]
        if (entry === undefined) throw new GitApiError({ code: 'git-failed', detail: `no script: ${method}` }, null)
        const value = typeof entry === 'function' ? (entry as () => unknown)() : entry
        if (value instanceof Error) throw value
        return value as T
      },
    },
  }
}

const address = changeFileAddress('s1', 'src/app.ts', 'unstaged')

async function render(double: { api: GitApi }, target = address) {
  await act(async () => {
    root.render(<ChangeFileTab address={target} api={double.api} t={t} />)
  })
  await act(async () => { await Promise.resolve() })
}

/** The rendered code lines, in source order. */
const lines = (): HTMLElement[] => [...container.querySelectorAll<HTMLElement>('span.line')]

describe('change file tab', () => {
  it('reads the address, shows the file path and marks the changed lines', async () => {
    const double = api({ getFileChanges: changes() })
    await render(double)
    expect(double.calls[0]).toEqual({
      method: 'getFileChanges',
      args: { sessionId: 's1', path: 'src/app.ts', side: 'unstaged' },
    })
    expect(container.querySelector('[data-dsh-git="change-file"]')?.getAttribute('data-side')).toBe('unstaged')
    expect(container.querySelector('[data-dsh-git="change-file-path"]')?.textContent).toContain('app.ts')
    expect(lines()).toHaveLength(3)
    expect(lines()[1]!.dataset.change).toBe('added')
    expect(lines()[0]!.dataset.change).toBeUndefined()
  })

  it('marks removed positions with the other decoration', async () => {
    const double = api({ getFileChanges: changes({ markers: [{ line: 3, kind: 'removed' }] }) })
    await render(double)
    expect(lines()[2]!.dataset.change).toBe('removed')
  })

  it('keeps decorations after the code surface replaces its lines', async () => {
    const double = api({ getFileChanges: changes() })
    await render(double)
    const code = container.querySelector('[data-dsh-git="change-file-code"]')!
    // A re-tokenize replaces the line elements with fresh ones; the observer has
    // to mark them again, because the classes live on nodes React recreates.
    await act(async () => {
      const host = code.querySelector('pre code')!
      host.replaceChildren(...[0, 1, 2].map(() => {
        const line = document.createElement('span')
        line.className = 'line'
        return line
      }))
      await Promise.resolve()
    })
    expect(lines()).toHaveLength(3)
    expect(lines()[1]!.dataset.change).toBe('added')
    expect(lines()[0]!.dataset.change).toBeUndefined()
  })

  // The view opens on the changes themselves; the toggle shows the whole file.
  it('hides unchanged stretches by default and reveals them on the toggle', async () => {
    const text = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`).join('\n') + '\n'
    const double = api({ getFileChanges: changes({ text, markers: [{ line: 20, kind: 'added' }] }) })
    await render(double)
    expect(lines()).toHaveLength(40)
    const hidden = (): number => lines().filter((line) => line.dataset.hidden !== undefined).length
    expect(hidden()).toBe(33)
    expect(lines()[16]!.dataset.gap).toBe('')      // line 17: first line after the skip
    expect(lines()[16]!.className).not.toMatch(/collapsed/)
    expect(lines()[0]!.className).toMatch(/collapsed/)

    const toggle = container.querySelector('[data-dsh-git="change-file-changed-only"]') as HTMLButtonElement
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(toggle.getAttribute('aria-label')).toBe(t('fileChanges.changedOnly'))
    await act(async () => { toggle.click() })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    expect(hidden()).toBe(0)
    expect(lines().some((line) => line.dataset.gap !== undefined)).toBe(false)
  })

  it('publishes the file line number for every line, hidden or not', async () => {
    const text = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join('\n') + '\n'
    await render(api({ getFileChanges: changes({ text, markers: [{ line: 6, kind: 'added' }] }) }))
    expect(lines().map((line) => line.dataset.line)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'])
  })

  it('shows every line when the change view has nothing to narrow to', async () => {
    const text = Array.from({ length: 6 }, (_, index) => `line ${index + 1}`).join('\n') + '\n'
    await render(api({ getFileChanges: changes({ text, markers: [] }) }))
    expect(lines().filter((line) => line.dataset.hidden !== undefined)).toHaveLength(0)
  })

  it('stages every hunk of the file through the preview-bound pair', async () => {
    const double = api({
      getFileChanges: changes(),
      inspectHunks: { path: 'src/app.ts', side: 'unstaged', version: 'v1', hunks: [{ id: 'h1', header: '', patch: '' }, { id: 'h2', header: '', patch: '' }], unsupported: null, wholeFileFallback: false },
      applyHunks: { status: 'completed', refresh: false, detail: null },
    })
    await render(double)
    await act(async () => {
      ;(container.querySelector('[data-dsh-git="change-file-hunks"]') as HTMLButtonElement).click()
    })
    await act(async () => { await Promise.resolve() })
    expect(double.calls.find(call => call.method === 'inspectHunks')?.args).toEqual({ sessionId: 's1', path: 'src/app.ts', side: 'unstaged' })
    expect(double.calls.find(call => call.method === 'applyHunks')?.args).toMatchObject({
      sessionId: 's1', path: 'src/app.ts', side: 'unstaged', version: 'v1', hunkIds: ['h1', 'h2'], approved: true,
    })
    // The read happens again so the tab shows the checkout as it now is.
    expect(double.calls.filter(call => call.method === 'getFileChanges').length).toBeGreaterThan(1)
  })

  it('unstages instead of staging when the tab shows the index side', async () => {
    const stagedAddress = changeFileAddress('s1', 'src/app.ts', 'staged')
    const double = api({
      getFileChanges: changes({ side: 'staged' }),
      inspectHunks: { path: 'src/app.ts', side: 'staged', version: 'v1', hunks: [{ id: 'h1', header: '', patch: '' }], unsupported: null, wholeFileFallback: false },
      applyHunks: { status: 'completed', refresh: false, detail: null },
    })
    await render(double, stagedAddress)
    const action = container.querySelector('[data-dsh-git="change-file-hunks"]') as HTMLButtonElement
    expect(action.getAttribute('aria-label')).toBe(t('fileChanges.unstage'))
    expect(container.querySelector('[data-dsh-git="change-file"]')?.getAttribute('data-side')).toBe('staged')
    await act(async () => { action.click() })
    await act(async () => { await Promise.resolve() })
    expect(double.calls.find(call => call.method === 'applyHunks')?.args).toMatchObject({ side: 'staged' })
  })

  it('reads the file again from the toolbar', async () => {
    const double = api({ getFileChanges: changes() })
    await render(double)
    await act(async () => {
      ;(container.querySelector('[data-dsh-git="change-file-refresh"]') as HTMLButtonElement).click()
    })
    await act(async () => { await Promise.resolve() })
    expect(double.calls.filter(call => call.method === 'getFileChanges')).toHaveLength(2)
  })

  it('toggles wrapping and reports it to assistive technology, as the preview does', async () => {
    const double = api({ getFileChanges: changes() })
    await render(double)
    const wrap = container.querySelector('[data-dsh-git="change-file-wrap"]') as HTMLButtonElement
    const codes = container.querySelector('[data-dsh-git="change-file-code"]')!
    expect(wrap.getAttribute('aria-pressed')).toBe('false')
    expect(codes.getAttribute('data-wrap')).toBe('false')
    await act(async () => { wrap.click() })
    expect(wrap.getAttribute('aria-pressed')).toBe('true')
    expect(codes.getAttribute('data-wrap')).toBe('true')
  })

  it('names a deleted file and offers no hunk action for it', async () => {
    await render(api({ getFileChanges: changes({ deleted: true, text: 'gone\n', markers: [{ line: 1, kind: 'removed' }] }) }))
    expect(container.querySelector('[data-dsh-git="change-file-hunks"]')).toBeNull()
    expect(container.textContent).not.toContain('line(s)')
  })

  it('says a binary change has no text to read', async () => {
    await render(api({ getFileChanges: changes({ binary: true, text: '', markers: [] }) }))
    expect(container.textContent).toContain(t('diff.binary'))
    expect(lines()).toHaveLength(0)
  })

  it('says a file past the read budget was not read', async () => {
    await render(api({ getFileChanges: changes({ truncated: true, text: '', markers: [] }) }))
    expect(container.textContent).toContain(t('fileChanges.tooLarge'))
  })

  it('names an actionable failure and retries on demand', async () => {
    let fail = true
    const double = api({ getFileChanges: () => { if (fail) throw new GitApiError({ code: 'path-missing', detail: 'gone' }, null); return changes() } })
    await render(double)
    const alert = container.querySelector('[role="alert"]')!
    expect(alert.textContent).toContain(t('failure.pathMissing'))
    expect(alert.textContent).toContain(t('failure.fix.pathMissing'))
    fail = false
    await act(async () => {
      ;(container.querySelector('[role="alert"] button') as HTMLButtonElement).click()
    })
    await act(async () => { await Promise.resolve() })
    expect(lines()).toHaveLength(3)
  })

  // The read can fail because the loaded host half predates this page; that
  // state has a fix (restart the harness), so the tab must say it.
  it('says the running host is older than this page when the method is missing', async () => {
    await render(api({ getFileChanges: new GitApiError({ code: 'host-outdated', detail: 'getFileChanges' }, null) }))
    const alert = container.querySelector('[role="alert"]')!
    expect(alert.textContent).toContain(t('failure.hostOutdated'))
    expect(alert.textContent).toContain(t('failure.fix.hostOutdated'))
    expect(alert.textContent).not.toContain(t('fileChanges.readFailed'))
  })

  it('refuses an address that is not a change view', async () => {
    await render(api({}), 'dsh-resource://file/session/s1/src/app.ts')
    expect(container.textContent).toContain(t('fileChanges.invalid'))
  })
})

describe('change tab registration', () => {
  it('claims exactly its own address family', async () => {
    const { changeDefinition } = await import('../src/client/index.ts')
    const definition = changeDefinition()
    expect(definition.patterns).toEqual(['dsh-resource://git-changes/**'])
    // Nothing declares a band, so the registration takes the `extension`
    // default: an outside type outranks the viewers shipped with the product.
    expect('priority' in definition).toBe(false)
    expect(definition.title(changeFileAddress('s1', 'src/app.ts', 'staged'))).toBe('app.ts (staged)')
  })
})

/**
 * jsdom render test for the hunk controls: the lazy read, the exact hunk
 * identifiers and approval sent on apply, the unsupported whole-file fallback,
 * the empty-selection guard and the read/write failure envelopes. The Host
 * contract suite covers the request shapes; this covers the browser half.
 */
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HunkControls, type HunkControlsProps } from '../src/client/changes/HunkControls.tsx'
import { GitApiError, type GitApi } from '../src/client/api.ts'
import { en, type MessageKey } from '../src/client/dictionaries/en.ts'
import type { HunkPreview, RepositoryActionResult } from '../src/core/repository-actions.ts'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** The package dictionary with the platform's interpolation semantics. */
function interpolate(template: string, params?: Record<string, string | number>): string {
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match))
}
const t = (key: MessageKey, params?: Record<string, string | number>): string => interpolate(en[key], params)

/** A two-hunk unstaged preview; tests override one axis at a time. */
function hunkPreview(overrides: Partial<HunkPreview> = {}): HunkPreview {
  return {
    path: 'file.ts',
    side: 'unstaged',
    version: 'h1',
    hunks: [
      { id: 'hunk-a', header: '@@ -1,3 +1,4 @@', patch: '-old\n+new' },
      { id: 'hunk-b', header: '@@ -10,2 +11,2 @@', patch: '-x\n+y' },
    ],
    unsupported: null,
    wholeFileFallback: false,
    ...overrides,
  }
}

function result(overrides: Partial<RepositoryActionResult> = {}): RepositoryActionResult {
  return {
    status: 'completed',
    refresh: true,
    conflictRefresh: false,
    reason: null,
    message: 'Host result message',
    stashOid: null,
    ...overrides,
  }
}

/** A scripted API double that records calls and throws on unscripted methods. */
function apiDouble(script: Record<string, unknown>): {
  api: GitApi
  calls: { method: string; args: Record<string, unknown> }[]
} {
  const calls: { method: string; args: Record<string, unknown> }[] = []
  return {
    calls,
    api: {
      async call<T>(method: string, args: Record<string, unknown>): Promise<T> {
        calls.push({ method, args })
        if (!(method in script)) throw new GitApiError({ code: 'git-failed', detail: 'unscripted method: ' + method }, null)
        const entry = script[method]
        const value = typeof entry === 'function' ? (entry as (input: Record<string, unknown>) => unknown)(args) : entry
        if (value instanceof Error) throw value
        return value as T
      },
    },
  }
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => { resolve = yes })
  return { promise, resolve }
}

let root: Root
let container: HTMLDivElement
let mounted: boolean
let props: HunkControlsProps

async function render(overrides: Partial<HunkControlsProps> = {}): Promise<void> {
  const defaults: HunkControlsProps = {
    sessionId: 's1',
    path: 'file.ts',
    side: 'unstaged',
    api: apiDouble({ getHunks: hunkPreview() }).api,
    t,
    onChanged: vi.fn(),
    onWholeFile: vi.fn(),
  }
  props = { ...defaults, ...overrides }
  await act(async () => { root.render(<HunkControls {...props} />) })
}

const buttons = (): HTMLButtonElement[] => [...document.querySelectorAll<HTMLButtonElement>('button')]
const buttonText = (label: string): HTMLButtonElement => {
  const found = buttons().find((node) => node.textContent?.trim() === label)
  expect(found, label).toBeDefined()
  return found!
}
const click = async (node: HTMLElement): Promise<void> => { await act(async () => { node.click() }) }
const clickText = async (label: string): Promise<void> => { await click(buttonText(label)) }
const alertText = (): string | null => document.querySelector('[role="alert"]')?.textContent ?? null
const checkbox = (label: string): HTMLInputElement => {
  const found = document.querySelector<HTMLInputElement>('input[type="checkbox"][aria-label="' + label + '"]')
  expect(found, label).not.toBeNull()
  return found!
}
const hunkSelect = (number: number): string => t('hunks.select', { number })
const open = async (): Promise<void> => { await clickText(t('hunks.title')) }
const applyArgs = (calls: { method: string; args: Record<string, unknown> }[]): Record<string, unknown> => {
  const call = calls.find((item) => item.method === 'applyHunks')
  expect(call, 'applyHunks').toBeDefined()
  return call!.args
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  mounted = true
})

afterEach(async () => {
  if (mounted) await act(async () => { root.unmount() })
  document.body.replaceChildren()
})

describe('hunk controls read', () => {
  it('stays closed until opened, then reads hunks for the requested scope', async () => {
    const double = apiDouble({ getHunks: hunkPreview() })
    await render({ api: double.api })
    expect(document.querySelector('[data-dsh-git="hunk-controls"]')).not.toBeNull()
    expect(double.calls).toHaveLength(0)
    const toggle = buttonText(t('hunks.title'))
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    await click(toggle)
    expect(double.calls).toEqual([{ method: 'getHunks', args: { sessionId: 's1', path: 'file.ts', side: 'unstaged' } }])
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(document.body.textContent).toContain('@@ -1,3 +1,4 @@')
    expect(document.body.textContent).toContain('@@ -10,2 +11,2 @@')
    expect(document.body.textContent).toContain('-old')
    expect(document.body.textContent).toContain('+y')
    expect(document.querySelectorAll('details')).toHaveLength(2)
  })

  it('flushes the loading state while the read is pending', async () => {
    const gate = deferred<HunkPreview>()
    const double = apiDouble({ getHunks: () => gate.promise })
    await render({ api: double.api })
    await open()
    expect(document.querySelector('[role="status"]')?.textContent).toBe(t('hunks.loading'))
    expect(buttonText(t('header.refresh')).disabled).toBe(true)
    await act(async () => { gate.resolve(hunkPreview()) })
    expect(document.body.textContent).toContain('@@ -1,3 +1,4 @@')
    expect(document.querySelector('[role="status"]')).toBeNull()
  })

  it('reports a failed hunk read instead of crashing', async () => {
    const double = apiDouble({ getHunks: new GitApiError({ code: 'git-failed', detail: 'read' }, null) })
    await render({ api: double.api })
    await open()
    expect(alertText()).toBe(t('hunks.readFailed'))
    expect(buttonText(t('header.refresh')).disabled).toBe(false)
  })

  it('shows an empty preview when the host has no selectable hunks', async () => {
    const double = apiDouble({ getHunks: hunkPreview({ hunks: [] }) })
    await render({ api: double.api })
    await open()
    expect(document.body.textContent).toContain(t('diff.empty'))
    expect(buttonText(t('hunks.stageSelected')).disabled).toBe(true)
  })

  it('re-reads the hunks from the refresh control and clears the selection', async () => {
    const double = apiDouble({ getHunks: hunkPreview() })
    await render({ api: double.api })
    await open()
    await click(checkbox(hunkSelect(1)))
    expect(buttonText(t('hunks.stageSelected')).disabled).toBe(false)
    await clickText(t('header.refresh'))
    expect(double.calls.filter((call) => call.method === 'getHunks')).toHaveLength(2)
    expect(buttonText(t('hunks.stageSelected')).disabled).toBe(true)
  })
})

describe('hunk controls selection and apply', () => {
  it('applies the exact selected hunk identifiers with the preview version and approval', async () => {
    const double = apiDouble({ getHunks: hunkPreview(), applyHunks: result() })
    await render({ api: double.api })
    await open()
    const stage = buttonText(t('hunks.stageSelected'))
    expect(stage.disabled).toBe(true)
    await click(stage)
    expect(double.calls.some((call) => call.method === 'applyHunks')).toBe(false)
    await click(checkbox(hunkSelect(1)))
    expect(buttonText(t('hunks.stageSelected')).disabled).toBe(false)
    expect(checkbox(hunkSelect(1)).checked).toBe(true)
    expect(checkbox(hunkSelect(2)).checked).toBe(false)
    await clickText(t('hunks.stageSelected'))
    expect(applyArgs(double.calls)).toEqual({
      sessionId: 's1',
      path: 'file.ts',
      side: 'unstaged',
      version: 'h1',
      hunkIds: ['hunk-a'],
      approved: true,
    })
    expect(props.onChanged).toHaveBeenCalledTimes(1)
    expect(double.calls.filter((call) => call.method === 'getHunks')).toHaveLength(2)
    expect(buttonText(t('hunks.stageSelected')).disabled).toBe(true)
  })

  it('applies every selected hunk when select-all is used, then clears', async () => {
    const double = apiDouble({ getHunks: hunkPreview(), applyHunks: result() })
    await render({ api: double.api })
    await open()
    await clickText(t('hunks.selectAll'))
    expect(checkbox(hunkSelect(1)).checked).toBe(true)
    expect(checkbox(hunkSelect(2)).checked).toBe(true)
    await clickText(t('hunks.stageSelected'))
    expect(applyArgs(double.calls).hunkIds).toEqual(['hunk-a', 'hunk-b'])
    await clickText(t('hunks.selectAll'))
    await clickText(t('hunks.clear'))
    expect(buttonText(t('hunks.stageSelected')).disabled).toBe(true)
    expect(checkbox(hunkSelect(1)).checked).toBe(false)
  })

  it('labels the staged side for unstaging and sends the staged side', async () => {
    const double = apiDouble({ getHunks: hunkPreview({ side: 'staged' }), applyHunks: result() })
    await render({ api: double.api, side: 'staged' })
    await open()
    expect(double.calls[0]).toEqual({ method: 'getHunks', args: { sessionId: 's1', path: 'file.ts', side: 'staged' } })
    await click(checkbox(hunkSelect(1)))
    await clickText(t('hunks.unstageSelected'))
    expect(applyArgs(double.calls).side).toBe('staged')
  })

  it('reports a rejected write and never refreshes', async () => {
    const double = apiDouble({
      getHunks: hunkPreview(),
      applyHunks: new GitApiError({ code: 'git-failed', detail: 'write' }, null),
    })
    await render({ api: double.api })
    await open()
    await click(checkbox(hunkSelect(1)))
    await clickText(t('hunks.stageSelected'))
    expect(alertText()).toBe(t('hunks.writeFailed'))
    expect(props.onChanged).not.toHaveBeenCalled()
    expect(buttonText(t('hunks.stageSelected')).disabled).toBe(false)
  })

  it('reports a non-completed write status and never refreshes', async () => {
    const double = apiDouble({ getHunks: hunkPreview(), applyHunks: result({ status: 'failed' }) })
    await render({ api: double.api })
    await open()
    await click(checkbox(hunkSelect(1)))
    await clickText(t('hunks.stageSelected'))
    expect(alertText()).toBe(t('hunks.writeFailed'))
    expect(props.onChanged).not.toHaveBeenCalled()
  })
})

describe('hunk controls unsupported fallback', () => {
  it('surfaces the unsupported notice and hands off to the whole-file action', async () => {
    const double = apiDouble({ getHunks: hunkPreview({ unsupported: 'binary', hunks: [], wholeFileFallback: true }), applyHunks: result() })
    await render({ api: double.api })
    await open()
    expect(document.body.textContent).toContain(t('hunks.unsupported'))
    expect(document.body.textContent).not.toContain(t('hunks.hint'))
    expect(document.querySelectorAll('details')).toHaveLength(0)
    await clickText(t('hunks.stageFile'))
    expect(double.calls.some((call) => call.method === 'applyHunks')).toBe(false)
    expect(props.onWholeFile).toHaveBeenCalledTimes(1)
    expect(props.onChanged).toHaveBeenCalledTimes(1)
    expect(double.calls.filter((call) => call.method === 'getHunks')).toHaveLength(2)
  })

  it('names the whole-file action for the staged side', async () => {
    const double = apiDouble({ getHunks: hunkPreview({ side: 'staged', unsupported: 'rename', hunks: [] }), applyHunks: result() })
    await render({ api: double.api, side: 'staged' })
    await open()
    expect(document.body.textContent).toContain(t('hunks.unsupported'))
    await clickText(t('hunks.unstageFile'))
    expect(props.onWholeFile).toHaveBeenCalledTimes(1)
    expect(double.calls.some((call) => call.method === 'applyHunks')).toBe(false)
  })

  it('reports a failed whole-file handoff without refreshing', async () => {
    const double = apiDouble({ getHunks: hunkPreview({ unsupported: 'submodule', hunks: [] }), applyHunks: result() })
    const onWholeFile = vi.fn(async () => { throw new Error('handoff failed') })
    await render({ api: double.api, onWholeFile })
    await open()
    await clickText(t('hunks.stageFile'))
    expect(alertText()).toBe(t('hunks.writeFailed'))
    expect(props.onChanged).not.toHaveBeenCalled()
  })
})

import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PanelStore, type PanelSnapshot } from '../src/client/controller.ts'
import { DiffPane, TabActionsSink } from '../src/client/ui/DiffPane.tsx'
import { en, interpolate, type MessageKey } from '../src/client/dictionaries.ts'

const clipboard = vi.hoisted(() => ({ write: vi.fn<(patch: string) => Promise<boolean>>() }))
vi.mock('@deepseek-ai/dsh-client-ui-primitives', async (importOriginal) => ({
  ...await importOriginal<typeof import('@deepseek-ai/dsh-client-ui-primitives')>(),
  writeClipboard: clipboard.write,
}))

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const t = (key: MessageKey, params?: Record<string, string | number>): string => interpolate(en[key], params)
const deferred = () => {
  let resolve!: (accepted: boolean) => void
  let reject!: (error: Error) => void
  const promise = new Promise<boolean>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

let root: Root
let container: HTMLDivElement
let store: PanelStore
function snapshot(path: string, patch: string): PanelSnapshot {
  return {
    ...store.getSnapshot(),
    view: { kind: 'diff', path, side: 'unstaged' },
    diff: {
      path, side: 'unstaged', empty: false,
      file: { path, displayPath: path, patch, binary: false, tooLarge: false, hunks: [], added: 1, removed: 0 },
    },
  }
}
async function renderDiff(path: string, patch: string): Promise<void> {
  await act(async () => {
    root.render(<DiffPane sessionId="copy-test" store={store} snapshot={snapshot(path, patch)}
      t={t} onBack={() => {}} addressFor={() => null} />)
  })
}
const copyButton = (): HTMLButtonElement => container.querySelector('[data-dsh-git="diff-copy-patch"]')!

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  store = new PanelStore({ call: vi.fn() }, 'copy-test')
  clipboard.write.mockReset()
})
afterEach(() => {
  act(() => root.unmount())
  store.dispose()
  container.remove()
})

describe('diff clipboard feedback', () => {
  it('reports success for the current patch and resets for changed content on the same path', async () => {
    clipboard.write.mockResolvedValue(true)
    await renderDiff('a.ts', 'first patch')
    await act(async () => { copyButton().click(); await Promise.resolve() })
    expect(clipboard.write).toHaveBeenCalledWith('first patch')
    expect(copyButton().getAttribute('aria-label')).toBe(t('diff.copied'))
    await renderDiff('a.ts', 'new patch')
    expect(copyButton().getAttribute('aria-label')).toBe(t('diff.copyPatch'))
    await renderDiff('a.ts', 'first patch')
    expect(copyButton().getAttribute('aria-label')).toBe(t('diff.copyPatch'))
  })

  it('ignores a late completion after a patch switch', async () => {
    const pending = deferred()
    clipboard.write.mockReturnValue(pending.promise)
    await renderDiff('a.ts', 'first patch')
    await act(async () => { copyButton().click() })
    await renderDiff('a.ts', 'new patch')
    await act(async () => { pending.resolve(true); await pending.promise })
    expect(copyButton().getAttribute('aria-label')).toBe(t('diff.copyPatch'))
  })

  it('does not report success when the platform declines a clipboard write', async () => {
    clipboard.write.mockResolvedValue(false)
    await renderDiff('a.ts', 'first patch')
    await act(async () => { copyButton().click(); await Promise.resolve() })
    expect(clipboard.write).toHaveBeenCalledExactlyOnceWith('first patch')
    expect(copyButton().getAttribute('aria-label')).toBe(t('diff.copyPatch'))
  })

  it('ignores an older success while a newer copy of the same patch is pending', async () => {
    const old = deferred(), current = deferred()
    clipboard.write.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    await renderDiff('a.ts', 'same patch')
    await act(async () => { copyButton().click(); copyButton().click() })
    await act(async () => { old.resolve(true); await old.promise })
    expect(copyButton().getAttribute('aria-label')).toBe(t('diff.copyPatch'))
    await act(async () => { current.reject(new Error('clipboard denied')); try { await current.promise } catch {} })
    expect(copyButton().getAttribute('aria-label')).toBe(t('diff.copyPatch'))
  })

  it('reports only the latest successful copy when earlier writes settle out of order', async () => {
    const old = deferred(), current = deferred()
    clipboard.write.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    await renderDiff('a.ts', 'same patch')
    await act(async () => { copyButton().click(); copyButton().click() })
    await act(async () => { current.resolve(true); await current.promise })
    expect(copyButton().getAttribute('aria-label')).toBe(t('diff.copied'))
    await act(async () => { old.reject(new Error('old write failed')); try { await old.promise } catch {} })
    expect(copyButton().getAttribute('aria-label')).toBe(t('diff.copied'))
  })

  it('clears previous success when a subsequent copy is rejected', async () => {
    clipboard.write.mockResolvedValueOnce(true).mockRejectedValueOnce(new Error('clipboard denied'))
    await renderDiff('a.ts', 'first patch')
    await act(async () => { copyButton().click(); await Promise.resolve() })
    expect(copyButton().getAttribute('aria-label')).toBe(t('diff.copied'))
    await act(async () => { copyButton().click(); await Promise.resolve() })
    expect(copyButton().getAttribute('aria-label')).toBe(t('diff.copyPatch'))
  })

  it('does not report success or leave an unhandled rejection on clipboard failure', async () => {
    const pending = deferred()
    clipboard.write.mockReturnValue(pending.promise)
    await renderDiff('a.ts', 'first patch')
    await act(async () => { copyButton().click() })
    await act(async () => { pending.reject(new Error('clipboard denied')); try { await pending.promise } catch {} })
    expect(copyButton().getAttribute('aria-label')).toBe(t('diff.copyPatch'))
  })
})

describe('tab actions publication', () => {
  it('publishes only committed actions and clears them on unmount', () => {
    const sink = { current: null as { openResource(address: string): void } | null }
    const actions = { openResource: vi.fn() }
    const never = new Promise<void>(() => {})
    function Suspended(): null { throw never }
    act(() => root.render(<React.Suspense fallback={null}>
      <TabActionsSink useTabInfo={() => ({ tab: { title: 'x', actions } })} sink={sink} />
      <Suspended />
    </React.Suspense>))
    expect(sink.current).toBeNull()
    act(() => root.render(<TabActionsSink useTabInfo={() => ({ tab: { title: 'x', actions } })} sink={sink} />))
    expect(sink.current).toBe(actions)
    act(() => root.render(null))
    expect(sink.current).toBeNull()
  })

  it('replaces a committed action and does not clear a newer publication during cleanup', () => {
    const sink = { current: null as { openResource(address: string): void } | null }
    const oldActions = { openResource: vi.fn() }
    const newActions = { openResource: vi.fn() }
    act(() => root.render(<TabActionsSink useTabInfo={() => ({ tab: { title: 'x', actions: oldActions } })} sink={sink} />))
    act(() => root.render(<TabActionsSink useTabInfo={() => ({ tab: { title: 'x', actions: newActions } })} sink={sink} />))
    expect(sink.current).toBe(newActions)
  })
})

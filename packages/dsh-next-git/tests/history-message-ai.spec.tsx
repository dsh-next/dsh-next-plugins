import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { HistoryMessageAI, type HistoryMessageAIProps } from '../src/client/history/HistoryMessageAI.tsx'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const commit = { hash: 'a'.repeat(40), short: 'aaaaaaa', parents: ['b'.repeat(40)], author: 'Ada', timestamp: 1, subject: 'Subject', refs: [] }
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
let root: Root | undefined
let container: HTMLDivElement
let props: HistoryMessageAIProps
let call: ReturnType<typeof vi.fn<(method: string, args: Record<string, unknown>, signal?: AbortSignal) => Promise<string>>>
beforeEach(() => {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  call = vi.fn().mockResolvedValue('Generated summary\n\nGenerated body')
  props = { sessionId: 'source' as SessionId, action: 'reword', commits: [commit], message: 'Existing text',
    onMessage: vi.fn(), root: '/repo', cwd: '/repo', api: { call: async <T,>(...args: Parameters<HistoryMessageAIProps['api']['call']>) => await call(...args) as T }, t: key => key, disabled: false }
})
afterEach(() => { act(() => root?.unmount()); document.body.replaceChildren() })
const render = async (patch: Partial<HistoryMessageAIProps> = {}) => {
  props = { ...props, ...patch }
  await act(async () => root!.render(<React.StrictMode><HistoryMessageAI {...props} /></React.StrictMode>))
}
const button = () => container.querySelector<HTMLButtonElement>('button')!
const click = async () => { await act(async () => { button().click() }) }

describe('inline history drafting', () => {
  it.each(['reword', 'squash'] as const)('replaces existing %s message in one click, without an agent chooser', async action => {
    await render({ action }); await click()
    expect(call).toHaveBeenCalledExactlyOnceWith('draftInput', { sessionId: 'source', kind: action, commits: [commit.hash], message: 'Existing text' }, expect.any(AbortSignal))
    expect(props.onMessage).toHaveBeenCalledExactlyOnceWith('Generated summary\n\nGenerated body')
    expect(container.querySelector('[role="dialog"], fieldset, pre')).toBeNull()
  })
  it('overwrites text even when edited during generation', async () => {
    const pending = deferred<string>(); call.mockReturnValueOnce(pending.promise)
    await render(); await click(); await render({ message: 'New edits' })
    await act(async () => pending.resolve('Replacement'))
    expect(props.onMessage).toHaveBeenCalledExactlyOnceWith('Replacement')
  })
  it('guards duplicate clicks and allows drafting again after completion', async () => {
    const pending = deferred<string>(); call.mockReturnValueOnce(pending.promise)
    await render(); await act(async () => { button().click(); button().click() })
    expect(call).toHaveBeenCalledOnce(); expect(button().disabled).toBe(true)
    expect(container.querySelector('[role="status"]')).not.toBeNull()
    await act(async () => pending.resolve('First')); await click()
    expect(call).toHaveBeenCalledTimes(2)
  })
  it.each(['failure', 'empty'] as const)('preserves existing fields on %s and supports retry', async kind => {
    if (kind === 'failure') call.mockRejectedValueOnce(new Error('private provider detail'))
    else call.mockResolvedValueOnce('   ')
    await render(); await click()
    expect(props.onMessage).not.toHaveBeenCalled()
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('drafting.failed')
    expect(container.textContent).not.toContain('private provider detail')
    await click(); expect(props.onMessage).toHaveBeenCalledOnce()
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })
  it.each(['unmount', 'selection', 'session', 'checkout', 'action', 'disabled'] as const)('ignores late completion after %s', async change => {
    const pending = deferred<string>(); call.mockReturnValueOnce(pending.promise)
    await render(); await click()
    const signal = call.mock.calls[0]![2] as AbortSignal
    if (change === 'unmount') act(() => { root!.unmount(); root = undefined })
    else await render(change === 'selection' ? { commits: [{ ...commit, hash: 'c'.repeat(40) }] }
      : change === 'session' ? { sessionId: 'other' as SessionId }
      : change === 'checkout' ? { cwd: '/other' }
      : change === 'action' ? { action: 'squash' } : { disabled: true })
    expect(signal.aborted).toBe(true)
    await act(async () => pending.resolve('Late'))
    expect(props.onMessage).not.toHaveBeenCalled()
  })
  it('ignores late failure after unmount', async () => {
    const pending = deferred<string>(); call.mockReturnValueOnce(pending.promise)
    await render(); await click(); act(() => { root!.unmount(); root = undefined })
    await act(async () => pending.reject(new Error('late')))
    expect(props.onMessage).not.toHaveBeenCalled()
  })
  it.each([{ disabled: true }, { commits: [] }])('disables unavailable input %j', async patch => {
    await render(patch); expect(button().disabled).toBe(true); await click(); expect(call).not.toHaveBeenCalled()
  })
})

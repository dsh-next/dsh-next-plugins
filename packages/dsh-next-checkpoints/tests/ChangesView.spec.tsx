/**
 * Click selects; rewind control + modal restores. Selecting a row never restores.
 */
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChangesView } from '../src/client/ChangesView.tsx'
import { englishTranslate } from '../src/client/dictionaries.ts'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const listPayload = {
  sessionId: 's1',
  checkpoints: [
    { id: 's1:1:2', turn: 1, seq: 2, time: Date.UTC(2026, 0, 1, 13, 51), fileCount: 1, head: null, promptPreview: 'Improve the header design now!...', promptTooltip: 'x'.repeat(60) },
    { id: 's1:2:9', turn: 2, seq: 9, time: Date.UTC(2026, 0, 1, 13, 58), fileCount: 2, head: null, promptPreview: 'short prompt', promptTooltip: null },
  ],
  rewoundTo: null,
  openTurn: false,
  cwd: '/repo',
}

function json(payload: unknown): Response {
  return { ok: true, json: async () => payload } as Response
}

describe('ChangesView', () => {
  const container = document.createElement('div')
  let root: Root | undefined

  afterEach(async () => {
    if (root !== undefined) await act(async () => { root!.unmount() })
    container.remove()
    vi.unstubAllGlobals()
  })

  it('sorts by descending timestamp, breaks ties by sequence, and preserves selection on refresh', async () => {
    vi.useFakeTimers()
    try {
      const oldest = { ...listPayload.checkpoints[0]!, time: 100 }
      const middle = { ...listPayload.checkpoints[1]!, time: 200 }
      const newest = { ...middle, id: 's1:3:12', turn: 3, seq: 12 }
      const checkpoints = Object.freeze([newest, oldest, middle])
      let payload = { ...listPayload, checkpoints }
      vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? '{}')) as { method: string; args?: { checkpointId?: string } }
        if (body.method === 'list') return json(payload)
        return json({ checkpointId: body.args?.checkpointId, files: [] })
      }))
      document.body.appendChild(container)
      root = createRoot(container)
      await act(async () => {
        root!.render(React.createElement(ChangesView, { sessionId: 's1' }))
      })
      const rows = () => [...container.querySelectorAll('[data-testid="dsh-next-checkpoints-row"]')]
      const ids = () => rows().map((row) => row.getAttribute('data-checkpoint-id'))
      expect(ids()).toEqual([newest.id, middle.id, oldest.id])
      expect(rows()[0]?.getAttribute('data-selected')).toBe('true')
      await act(async () => { (rows()[1] as HTMLElement).click() })
      const next = { ...newest, id: 's1:4:15', turn: 4, seq: 15, time: 300 }
      payload = { ...payload, checkpoints: [...checkpoints, next] }
      await act(async () => { await vi.advanceTimersByTimeAsync(2500) })
      expect(ids()).toEqual([next.id, newest.id, middle.id, oldest.id])
      expect(rows()[2]?.getAttribute('data-selected')).toBe('true')
      expect(checkpoints.map((item) => item.id)).toEqual([newest.id, oldest.id, middle.id])
    } finally {
      vi.useRealTimers()
    }
  })

  it('selects a row without restoring, and rewind opens the confirm modal', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { method: string; args?: { checkpointId?: string } }
      if (body.method === 'list') return json(listPayload)
      if (body.method === 'diffs') {
        return json({
          checkpointId: body.args?.checkpointId,
          files: [{
            targetKey: '/repo/a.ts',
            displayPath: 'src/a.ts',
            kind: 'diff',
            added: 1,
            removed: 1,
            hunks: [{
              path: 'src/a.ts',
              oldText: 'old',
              newText: 'new',
              oldStart: 1,
              newStart: 1,
              lines: [
                { kind: 'del', text: 'old' },
                { kind: 'add', text: 'new' },
              ],
            }],
          }],
        })
      }
      if (body.method === 'preview') {
        return json({
          checkpointId: body.args?.checkpointId,
          filesWritten: ['src/a.ts'],
          filesDeleted: [],
          turnsShadowed: 1,
          dirtyNonAgent: [],
          headMoved: true,
          currentHead: { sha: 'b', short: 'b', branch: 'main' },
          checkpointHead: { sha: 'a', short: 'a', branch: 'main' },
          openTurn: false,
          blockers: [],
        })
      }
      if (body.method === 'rewind') {
        return json({ ok: true, rewoundTo: body.args?.checkpointId, filesWritten: 1, filesDeleted: 0 })
      }
      return json({ error: { code: 'nope', message: 'no' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(React.createElement(ChangesView, { sessionId: 's1', t: englishTranslate }))
    })
    await act(async () => { await Promise.resolve() })
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="dsh-next-checkpoints-row"]')).not.toBeNull()
    })

    const rows = container.querySelectorAll('[data-testid="dsh-next-checkpoints-row"]')
    expect(rows.length).toBe(2)
    await act(async () => { (rows[1] as HTMLElement).click() })
    expect(container.querySelector('[data-testid="dsh-next-checkpoints-modal"]')).toBeNull()
    expect(fetchMock.mock.calls.some((call) => String(call[1]?.body).includes('"rewind"'))).toBe(false)

    const rewind = container.querySelector('[data-testid="dsh-next-checkpoints-rewind"]') as HTMLButtonElement
    await act(async () => { rewind.click() })
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="dsh-next-checkpoints-modal"]')).not.toBeNull()
    })
    expect(container.textContent).toContain('Please confirm')
    expect(container.textContent).toContain('HEAD has moved')
    expect(container.textContent).toContain('any changes up to this selected checkpoint will be lost')
    expect(container.textContent).not.toContain('primary checkout')
    expect(container.textContent).not.toContain('Files that will be written')

    const confirm = container.querySelector('[data-testid="dsh-next-checkpoints-confirm"]') as HTMLButtonElement
    await act(async () => { confirm.click() })
    await act(async () => { confirm.click() })
    await vi.waitFor(() => {
      expect(fetchMock.mock.calls.some((call) => String(call[1]?.body).includes('"rewind"'))).toBe(true)
    })
  })

  it('labels create, delete, and modified rows without dropping the DiffBlock', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { method: string }
      if (body.method === 'list') return json(listPayload)
      return json({
        checkpointId: 's1:2:9',
        files: [{
          targetKey: '/repo/new.ts',
          displayPath: 'src/new.ts',
          kind: 'create',
          added: 1,
          removed: 0,
          hunks: [{
            path: 'src/new.ts',
            oldText: null,
            newText: 'hello',
            oldStart: 0,
            newStart: 1,
            lines: [{ kind: 'add', text: 'hello' }],
          }],
          changedAt: Date.UTC(2026, 0, 1, 13, 58),
        }, {
          targetKey: '/repo/old.ts',
          displayPath: 'src/old.ts',
          kind: 'delete',
          added: 0,
          removed: 1,
          hunks: [{
            path: 'src/old.ts',
            oldText: 'bye',
            newText: '',
            oldStart: 1,
            newStart: 0,
            lines: [{ kind: 'del', text: 'bye' }],
          }],
          changedAt: Date.UTC(2026, 0, 1, 13, 58),
        }, {
          targetKey: '/repo/edit.ts',
          displayPath: 'src/edit.ts',
          kind: 'diff',
          added: 2,
          removed: 1,
          hunks: [{
            path: 'src/edit.ts',
            oldText: 'a',
            newText: 'b',
            oldStart: 1,
            newStart: 1,
            lines: [
              { kind: 'del', text: 'a' },
              { kind: 'add', text: 'b' },
            ],
          }],
          changedAt: Date.UTC(2026, 0, 1, 13, 58),
        }],
      })
    }))
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(React.createElement(ChangesView, { sessionId: 's1', t: englishTranslate }))
    })
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="dsh-next-checkpoints-file-kind"]')?.textContent).toBe('Created')
    })
    const kinds = [...container.querySelectorAll('[data-testid="dsh-next-checkpoints-file-kind"]')]
    expect(kinds.map((el) => el.textContent)).toEqual(['Created', 'Deleted', 'Modified'])
    expect(kinds.map((el) => el.getAttribute('data-status'))).toEqual(['create', 'delete', 'modify'])
    const fileRows = container.querySelectorAll('[data-testid="dsh-next-checkpoints-file"]')
    expect(fileRows[0]?.querySelector('[data-deleted="true"]')).toBeNull()
    expect(fileRows[1]?.querySelector('[data-deleted="true"]')?.textContent).toBe('src/old.ts')
    expect(fileRows[2]?.querySelector('[data-deleted="true"]')).toBeNull()
    expect(container.querySelector('[data-testid="dsh-next-checkpoints-diff"]')).toBeNull()
    expect(container.textContent).not.toContain('Select a file to preview its diff.')
    expect(container.textContent).toContain('Improve the header design now!...')
    expect(container.textContent).toContain('short prompt')
    expect(container.querySelector('[data-turn="1"] [data-testid="dsh-next-checkpoints-prompt"]')?.getAttribute('title')).toBe('x'.repeat(60))
    expect(container.querySelector('[data-turn="2"] [data-testid="dsh-next-checkpoints-prompt"]')?.getAttribute('title')).toBeNull()
    const rows = container.querySelectorAll('[data-testid="dsh-next-checkpoints-file"]')
    expect(container.querySelector('[data-testid="dsh-next-checkpoints-file-added"]')?.textContent).toBe('+1')
    expect(container.querySelector('[data-testid="dsh-next-checkpoints-file-removed"]')?.textContent).toBe('-1')
    expect(fileRows[2]?.querySelector('[data-testid="dsh-next-checkpoints-file-added"]')?.textContent).toBe('+2')
    expect(fileRows[2]?.querySelector('[data-testid="dsh-next-checkpoints-file-removed"]')?.textContent).toBe('-1')
    expect(container.querySelector('[data-testid="dsh-next-checkpoints-files-total-added"]')?.textContent).toBe('+3')
    expect(container.querySelector('[data-testid="dsh-next-checkpoints-files-total-removed"]')?.textContent).toBe('-2')
    await act(async () => { (rows[0] as HTMLElement).click() })
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="dsh-next-checkpoints-preview"]')).not.toBeNull()
      expect(container.querySelector('[data-testid="dsh-next-checkpoints-diff"]')).not.toBeNull()
    })
    const previewTime = new Date(Date.UTC(2026, 0, 1, 13, 58))
    const hh = String(previewTime.getHours()).padStart(2, '0')
    const mm = String(previewTime.getMinutes()).padStart(2, '0')
    expect(container.querySelector('[data-testid="dsh-next-checkpoints-preview-time"]')?.textContent).toBe(`${hh}:${mm}`)
    expect(container.querySelector('[data-testid="dsh-next-checkpoints-preview-added"]')?.textContent).toBe('+1')
    expect(container.querySelector('[data-testid="dsh-next-checkpoints-preview-removed"]')).toBeNull()
    await act(async () => { (rows[1] as HTMLElement).click() })
    await vi.waitFor(() => {
      const labels = [...container.querySelectorAll('[data-testid="dsh-next-checkpoints-file-kind"]')].map((el) => el.textContent)
      expect(labels).toEqual(['Created', 'Deleted', 'Modified'])
    })
  })

  it('shows the empty state when there are no checkpoints', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({
      sessionId: 's1',
      checkpoints: [],
      rewoundTo: null,
      openTurn: false,
      cwd: '/repo',
    })))
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(React.createElement(ChangesView, { sessionId: 's1', t: englishTranslate }))
    })
    await vi.waitFor(() => {
      expect(container.textContent).toContain('No checkpoints yet')
    })
    expect(document.documentElement.getAttribute('data-dsh-next-checkpoints')).toBe('open')
    expect(container.querySelector('[data-testid="dsh-next-checkpoints"]')
      ?.getAttribute('data-conversation-composer-overlay')).toBe('')
  })

  it('closes the modal on Escape and does not rewind on the first confirm click', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { method: string }
      if (body.method === 'list') return json(listPayload)
      if (body.method === 'diffs') return json({ checkpointId: 's1:1:2', files: [] })
      if (body.method === 'preview') {
        return json({
          checkpointId: 's1:1:2',
          filesWritten: ['a.ts'],
          filesDeleted: ['b.ts'],
          turnsShadowed: 1,
          dirtyNonAgent: ['notes.md'],
          headMoved: false,
          currentHead: null,
          checkpointHead: null,
          openTurn: false,
          blockers: [],
        })
      }
      if (body.method === 'rewind') return json({ ok: true, rewoundTo: 's1:1:2', filesWritten: 1, filesDeleted: 1 })
      return json({ error: { code: 'nope', message: 'no' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(React.createElement(ChangesView, { sessionId: 's1', t: englishTranslate }))
    })
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="dsh-next-checkpoints-rewind"]')).not.toBeNull()
    })
    await act(async () => {
      (container.querySelector('[data-testid="dsh-next-checkpoints-rewind"]') as HTMLButtonElement).click()
    })
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="dsh-next-checkpoints-modal"]')).not.toBeNull()
    })
    expect(container.textContent).toContain('notes.md')
    const confirm = container.querySelector('[data-testid="dsh-next-checkpoints-confirm"]') as HTMLButtonElement
    await act(async () => { confirm.click() })
    expect(fetchMock.mock.calls.some((call) => String(call[1]?.body).includes('"rewind"'))).toBe(false)
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="dsh-next-checkpoints-modal"]')).toBeNull()
    })
  })

  it('disables confirm when rewind is blocked and shows a binary kind note', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { method: string }
      if (body.method === 'list') return json(listPayload)
      if (body.method === 'diffs') {
        return json({
          checkpointId: 's1:2:9',
          files: [{
            targetKey: '/repo/a.bin',
            displayPath: 'a.bin',
            kind: 'binary',
            added: 0,
            removed: 0,
            hunks: [{ path: 'a.bin' }],
          }],
        })
      }
      if (body.method === 'preview') {
        return json({
          checkpointId: 's1:2:9',
          filesWritten: [],
          filesDeleted: [],
          turnsShadowed: 0,
          dirtyNonAgent: [],
          headMoved: false,
          currentHead: null,
          checkpointHead: null,
          openTurn: true,
          blockers: ['turn-open'],
        })
      }
      return json({ error: { code: 'nope', message: 'no' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(React.createElement(ChangesView, { sessionId: 's1', t: englishTranslate }))
    })
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="dsh-next-checkpoints-file"]')).not.toBeNull()
    })
    expect(container.querySelector('[data-testid="dsh-next-checkpoints-file-kind"]')).toBeNull()
    await act(async () => {
      (container.querySelector('[data-testid="dsh-next-checkpoints-file"]') as HTMLElement).click()
    })
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="dsh-next-checkpoints-kind"]')?.textContent).toContain('Binary')
    })
    expect(container.querySelector('[data-testid="dsh-next-checkpoints-diff"]')).toBeNull()
    await act(async () => {
      (container.querySelector('[data-testid="dsh-next-checkpoints-rewind"]') as HTMLButtonElement).click()
    })
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="dsh-next-checkpoints-modal"]')).not.toBeNull()
    })
    const confirm = container.querySelector('[data-testid="dsh-next-checkpoints-confirm"]') as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    expect(container.textContent).toContain('A turn is still running')
  })

  it('replaces rewind with a spinner on the live row and shows live line counts', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { method: string; args?: { checkpointId?: string } }
      if (body.method === 'list') {
        return json({
          ...listPayload,
          openTurn: true,
          checkpoints: [
            ...listPayload.checkpoints,
            {
              id: 's1:live:3',
              turn: 3,
              seq: 12,
              time: Date.UTC(2026, 0, 1, 14, 2),
              fileCount: 1,
              head: null,
              promptPreview: null,
              promptTooltip: null,
              live: true,
              added: 4,
              removed: 1,
            },
          ],
        })
      }
      return json({
        checkpointId: body.args?.checkpointId ?? 's1:live:3',
        files: [{
          targetKey: '/repo/a.ts',
          displayPath: 'src/a.ts',
          kind: 'diff',
          added: 4,
          removed: 1,
          hunks: [],
          changedAt: Date.UTC(2026, 0, 1, 14, 2),
        }],
      })
    }))
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(React.createElement(ChangesView, { sessionId: 's1', t: englishTranslate }))
    })
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="dsh-next-checkpoints-live"]')).not.toBeNull()
    })
    const liveRow = container.querySelector('[data-live="true"]')
    expect(liveRow?.querySelector('[data-testid="dsh-next-checkpoints-rewind"]')).toBeNull()
    expect(liveRow?.textContent).toContain('In progress')
    expect(liveRow?.textContent).toContain('+4')
    expect(liveRow?.textContent).toContain('-1')
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="dsh-next-checkpoints-files-total-added"]')?.textContent).toBe('+4')
    })
    expect(container.querySelector('[data-testid="dsh-next-checkpoints-file"]')?.textContent).toContain('src/a.ts')
  })

  it('shows the rewind banner for the restored checkpoint', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { method: string }
      if (body.method === 'list') {
        return json({ ...listPayload, checkpoints: [listPayload.checkpoints[0]], rewoundTo: 's1:1:2' })
      }
      return json({ checkpointId: 's1:1:2', files: [] })
    }))
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(React.createElement(ChangesView, { sessionId: 's1', t: englishTranslate }))
    })
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="dsh-next-checkpoints-banner"]')?.textContent)
        .toContain('Later messages are not sent to the model')
    })
  })
})

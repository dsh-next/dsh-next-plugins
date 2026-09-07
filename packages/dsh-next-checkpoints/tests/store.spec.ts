import { describe, expect, it } from 'vitest'
import {
  appendCheckpoint,
  checkpointId,
  emptyState,
  findCheckpoint,
  ensureOriginCheckpoint,
  listItems,
  overlayTree,
  rewindDeletes,
  rememberBaseline,
  rehomeState,
  rememberIntent,
  setOpenTurn,
  setSessionStartHead,
  truncateAfter,
} from '../src/core/store.ts'
import type { Checkpoint, SnapshotEntry } from '../src/core/types.ts'

function entry(path: string, hash: string | null = 'h'): SnapshotEntry {
  return { targetKey: `/repo/${path}`, displayPath: path, kind: hash === null ? 'missing' : 'text', blobHash: hash }
}

function checkpoint(turn: number, tree: SnapshotEntry[]): Checkpoint {
  return {
    id: checkpointId('s', turn, turn),
    sessionId: 's',
    turn,
    seq: turn,
    time: turn * 1000,
    tree,
    head: null,
  }
}

describe('store', () => {
  it('rehomes truncated checkpoints onto a forked session id', () => {
    let state = appendCheckpoint(emptyState('s', '/repo'), checkpoint(0, []))
    state = appendCheckpoint(state, checkpoint(1, [entry('a.ts')]))
    state = truncateAfter(state, checkpointId('s', 1, 1))
    const moved = rehomeState(state, 'child')
    expect(moved.sessionId).toBe('child')
    expect(moved.checkpoints.map((item) => item.id)).toEqual([
      checkpointId('child', 0, 0),
      checkpointId('child', 1, 1),
    ])
    expect(moved.rewoundTo).toBe(checkpointId('child', 1, 1))
  })

  it('prepends a session-start checkpoint and records later baselines on it', () => {
    let state = emptyState('s', '/repo')
    state = ensureOriginCheckpoint(state, 10)
    expect(state.checkpoints[0]?.turn).toBe(0)
    expect(state.checkpoints[0]?.tree).toEqual([])
    state = rememberBaseline(state, { targetKey: '/repo/a.ts', displayPath: 'a.ts', kind: 'text', blobHash: 'one' })
    expect(state.checkpoints[0]?.tree).toEqual([
      { targetKey: '/repo/a.ts', displayPath: 'a.ts', kind: 'text', blobHash: 'one' },
    ])
    state = ensureOriginCheckpoint(state, 99)
    expect(state.checkpoints.filter((item) => item.turn === 0)).toHaveLength(1)
  })

  it('keeps first-seen baseline', () => {
    let state = emptyState('s', '/repo')
    state = rememberBaseline(state, { targetKey: '/repo/a.ts', displayPath: 'a.ts', kind: 'text', blobHash: 'one' })
    state = rememberBaseline(state, { targetKey: '/repo/a.ts', displayPath: 'a.ts', kind: 'text', blobHash: 'two' })
    expect(state.baseline['/repo/a.ts']?.blobHash).toBe('one')
  })

  it('records intent keys once', () => {
    let state = emptyState('s', '/repo')
    state = rememberIntent(state, '/repo/a.ts')
    state = rememberIntent(state, '/repo/a.ts')
    expect(state.intentKeys).toEqual(['/repo/a.ts'])
  })

  it('drops later checkpoints after rewind', () => {
    let state = emptyState('s', '/repo')
    state = appendCheckpoint(state, checkpoint(1, [entry('a.ts')]))
    state = appendCheckpoint(state, checkpoint(2, [entry('a.ts'), entry('b.ts')]))
    state = appendCheckpoint(state, checkpoint(3, [entry('a.ts'), entry('b.ts'), entry('c.ts')]))
    const id = checkpointId('s', 1, 1)
    state = truncateAfter(state, id)
    expect(state.checkpoints.map((item) => item.turn)).toEqual([1])
    expect(state.rewoundTo).toBe(id)
    expect(rewindDeletes(
      appendCheckpoint(
        appendCheckpoint(emptyState('s', '/repo'), checkpoint(1, [entry('a.ts')])),
        checkpoint(2, [entry('a.ts'), entry('b.ts')]),
      ),
      checkpointId('s', 1, 1),
    )).toEqual(['/repo/b.ts'])
  })

  it('leaves the fold unchanged when truncating an unknown id', () => {
    let state = appendCheckpoint(emptyState('s', '/repo'), checkpoint(1, [entry('a.ts')]))
    const before = state
    state = truncateAfter(state, 'missing')
    expect(state).toBe(before)
    expect(rewindDeletes(state, 'missing')).toEqual([])
  })

  it('lists every tree path in fileCount, including deletes', () => {
    const state = appendCheckpoint(
      emptyState('s', '/repo'),
      checkpoint(1, [entry('a.ts'), entry('gone.ts', null)]),
    )
    expect(listItems(state)[0]?.fileCount).toBe(2)
    expect(listItems(state)[0]?.promptTooltip).toBeNull()
    expect(findCheckpoint(state, checkpointId('s', 1, 1))?.turn).toBe(1)
    expect(findCheckpoint(state, 'nope')).toBeUndefined()
  })

  it('caps rail prompts at 30 and tooltips at 60 only when longer', () => {
    const state = appendCheckpoint(emptyState('s', '/repo'), {
      ...checkpoint(1, [entry('a.ts')]),
      promptPreview: 'a'.repeat(61),
    })
    const item = listItems(state)[0]
    expect(item?.promptPreview).toBe(`${'a'.repeat(30)}...`)
    expect(item?.promptTooltip).toBe('a'.repeat(60))
  })

  it('keeps the first session-start HEAD and records an open turn', () => {
    let state = emptyState('s', '/repo')
    state = setSessionStartHead(state, { sha: 'aaa', short: 'aaa', branch: 'main' })
    state = setSessionStartHead(state, { sha: 'bbb', short: 'bbb', branch: 'main' })
    expect(state.sessionStartHead?.sha).toBe('aaa')
    state = setOpenTurn(state, 3)
    expect(state.openTurn).toBe(3)
  })

  it('deletes intent-only paths that later snapshots missed', () => {
    let state = emptyState('s', '/repo')
    state = rememberIntent(state, '/repo/a.ts')
    state = rememberIntent(state, '/repo/extra.ts')
    state = appendCheckpoint(state, checkpoint(1, [entry('a.ts')]))
    expect(rewindDeletes(state, checkpointId('s', 1, 1))).toEqual(['/repo/extra.ts'])
  })

  it('overlays a sparse checkpoint onto the session baseline', () => {
    const overlaid = overlayTree(
      { '/repo/a.ts': { targetKey: '/repo/a.ts', displayPath: 'a.ts', kind: 'text', blobHash: 'base' } },
      [entry('b.ts', 'new')],
    )
    expect(overlaid.map((item) => item.targetKey).sort()).toEqual(['/repo/a.ts', '/repo/b.ts'])
    expect(overlaid.find((item) => item.targetKey === '/repo/a.ts')?.blobHash).toBe('base')
  })

  it('does not rewind-delete baseline files omitted from a sparse tree', () => {
    let state = emptyState('s', '/repo')
    state = rememberBaseline(state, {
      targetKey: '/repo/a.ts',
      displayPath: 'a.ts',
      kind: 'text',
      blobHash: 'base',
    })
    state = appendCheckpoint(state, checkpoint(1, []))
    state = appendCheckpoint(state, checkpoint(2, [entry('a.ts', 'later')]))
    expect(rewindDeletes(state, checkpointId('s', 1, 1))).toEqual([])
  })

  it('keeps seqCursor after rewind so the next capture cannot reuse an id', () => {
    let state = emptyState('s', '/repo')
    state = appendCheckpoint(state, checkpoint(1, [entry('a.ts')]))
    state = appendCheckpoint(state, checkpoint(2, [entry('a.ts'), entry('b.ts')]))
    expect(state.seqCursor).toBe(2)
    state = truncateAfter(state, checkpointId('s', 1, 1))
    expect(state.seqCursor).toBe(2)
    expect(state.checkpoints).toHaveLength(1)
  })
})

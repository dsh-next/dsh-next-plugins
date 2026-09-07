import { describe, expect, it } from 'vitest'
import { projectPath, projectRows } from '../src/core/project.ts'
import { lfNormalize } from '../src/core/hunks.ts'

describe('projectPath', () => {
  it('creates with oldText null', () => {
    const row = projectPath({
      displayPath: 'a.ts',
      targetKey: '/a.ts',
      beforeKind: 'missing',
      afterKind: 'text',
      beforeText: null,
      afterText: 'hello\n',
    })
    expect(row?.kind).toBe('create')
    expect(row?.hunks[0]?.oldText).toBeNull()
  })

  it('deletes with newText empty string, never undefined', () => {
    const row = projectPath({
      displayPath: 'a.ts',
      targetKey: '/a.ts',
      beforeKind: 'text',
      afterKind: 'missing',
      beforeText: 'bye\n',
      afterText: null,
    })
    expect(row?.kind).toBe('delete')
    expect(row?.hunks[0]?.newText).toBe('')
    expect(row?.hunks[0]?.oldText).toBe('bye\n')
  })

  it('skips identical LF-normalized texts', () => {
    expect(projectPath({
      displayPath: 'a.ts',
      targetKey: '/a.ts',
      beforeKind: 'text',
      afterKind: 'text',
      beforeText: 'x\r\n',
      afterText: 'x\n',
    })).toBeNull()
  })

  it('does not send binary or too-large into hunks', () => {
    expect(projectPath({
      displayPath: 'a.bin',
      targetKey: '/a.bin',
      beforeKind: 'missing',
      afterKind: 'binary',
      beforeText: null,
      afterText: null,
    })?.kind).toBe('binary')
    expect(projectPath({
      displayPath: 'a.ts',
      targetKey: '/a.ts',
      beforeKind: 'text',
      afterKind: 'too-large',
      beforeText: 'x',
      afterText: null,
    })?.kind).toBe('too-large')
  })

  it('does not present a missing text blob as a delete', () => {
    expect(projectPath({
      displayPath: 'a.ts',
      targetKey: '/a.ts',
      beforeKind: 'text',
      afterKind: 'text',
      beforeText: 'hello\n',
      afterText: null,
    })?.kind).toBe('too-large')
  })

  it('hides an unchanged binary and shows a binary delete without hunks', () => {
    expect(projectPath({
      displayPath: 'a.bin',
      targetKey: '/a.bin',
      beforeKind: 'binary',
      afterKind: 'binary',
      beforeText: null,
      afterText: null,
    })).toBeNull()
    const gone = projectPath({
      displayPath: 'a.bin',
      targetKey: '/a.bin',
      beforeKind: 'binary',
      afterKind: 'missing',
      beforeText: null,
      afterText: null,
    })
    expect(gone?.kind).toBe('delete')
    expect(gone?.hunks).toEqual([])
  })

  it('returns null when both sides are missing', () => {
    expect(projectPath({
      displayPath: 'a.ts',
      targetKey: '/a.ts',
      beforeKind: 'missing',
      afterKind: 'missing',
      beforeText: null,
      afterText: null,
    })).toBeNull()
  })
})

describe('projectRows', () => {
  it('nets baseline vs checkpoint, not a stack of edits', () => {
    const rows = projectRows({
      baseline: {
        '/a.ts': { targetKey: '/a.ts', displayPath: 'a.ts', kind: 'text', blobHash: 'b0' },
      },
      tree: [
        { targetKey: '/a.ts', displayPath: 'a.ts', kind: 'text', blobHash: 'b2', mtimeMs: 1_700_000_000_123 },
      ],
      blobs: {
        b0: { kind: 'text', text: lfNormalize('one\n') },
        b2: { kind: 'text', text: lfNormalize('three\n') },
      },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.kind).toBe('diff')
    expect(rows[0]?.changedAt).toBe(1_700_000_000_123)
    expect(rows[0]?.hunks.some((hunk) => hunk.newText.includes('three'))).toBe(true)
  })

  it('shows deleted files relative to the workspace cwd', () => {
    const rows = projectRows({
      cwd: '/Users/me/web',
      baseline: {
        '/Users/me/web/README.md': {
          targetKey: '/Users/me/web/README.md',
          displayPath: '/Users/me/web/README.md',
          kind: 'text',
          blobHash: 'b0',
        },
      },
      tree: [{
        targetKey: '/Users/me/web/README.md',
        displayPath: '/Users/me/web/README.md',
        kind: 'missing',
        blobHash: null,
      }],
      blobs: {
        b0: { kind: 'text', text: lfNormalize('hello') },
      },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.kind).toBe('delete')
    expect(rows[0]?.displayPath).toBe('README.md')
    expect(rows[0]?.removed).toBe(1)
  })

  it('does not treat a sparse tree as deleting untouched baseline files', () => {
    const rows = projectRows({
      baseline: {
        '/repo/App.jsx': { targetKey: '/repo/App.jsx', displayPath: 'src/App.jsx', kind: 'text', blobHash: 'b0' },
      },
      tree: [],
      blobs: {
        b0: { kind: 'text', text: lfNormalize('hello\n') },
      },
    })
    expect(rows).toEqual([])
  })
})

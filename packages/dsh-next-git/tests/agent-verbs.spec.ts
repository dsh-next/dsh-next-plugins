import { describe, expect, it } from 'vitest'
import {
  encodePath,
  encodeSegment,
  FILE_ADDRESS_PREFIX,
  isFileAddress,
  normalizePosix,
  sessionFileAddress,
  targetFileAddress,
  workspacePathFor,
} from '../src/core/address.ts'
import {
  basename,
  commonDirectory,
  draftCommitMessage,
  draftPaths,
  draftShape,
  DRAFT_MAX_LENGTH,
} from '../src/core/commit-message.ts'
import {
  buildAgentPayload,
  fileListLine,
  MAX_AGENT_DIFF_CHARS,
  MAX_AGENT_FILES,
  MAX_AGENT_TOTAL_CHARS,
  truncatePatch,
  verbInstruction,
} from '../src/core/agent-verbs.ts'
import { summarizeChanges } from '../src/core/porcelain.ts'
import type { ChangeSummary, PanelState, StatusEntry } from '../src/core/types.ts'

describe('file addresses', () => {
  it('encodes segments, keeping a drive letter literal', () => {
    expect(encodeSegment('a b')).toBe('a%20b')
    expect(encodeSegment('C:')).toBe('C:')
    expect(encodePath('src/a b.ts')).toBe('src/a%20b.ts')
    expect(encodePath('C:/x y/z.ts')).toBe('C:/x%20y/z.ts')
  })

  it('builds a session file address and drops a leading ./', () => {
    expect(sessionFileAddress('s1', 'src/app.ts')).toBe(`${FILE_ADDRESS_PREFIX}session/s1/src/app.ts`)
    expect(sessionFileAddress('s1', './src/app.ts')).toBe(`${FILE_ADDRESS_PREFIX}session/s1/src/app.ts`)
    expect(sessionFileAddress('s1', 'src\\app.ts')).toBe(`${FILE_ADDRESS_PREFIX}session/s1/src/app.ts`)
    expect(isFileAddress(sessionFileAddress('s1', 'x'))).toBe(true)
    expect(isFileAddress('dsh-resource://chat/x')).toBe(false)
  })

  it('rebases a repository path onto the session workspace', () => {
    expect(workspacePathFor('/repo', '/repo', 'src/app.ts')).toEqual({ kind: 'relative', path: 'src/app.ts' })
    expect(workspacePathFor('/repo', '/repo/sub', 'src/app.ts')).toEqual({
      kind: 'relative',
      path: 'sub/src/app.ts',
    })
    // A repository outside the session workspace falls back to the absolute form.
    expect(workspacePathFor('/elsewhere', '/repo', 'src/app.ts')).toEqual({
      kind: 'absolute',
      path: '/repo/src/app.ts',
    })
    const target = workspacePathFor('/repo', '/repo', 'src/app.ts')
    expect(targetFileAddress('s1', target)).toBe(`${FILE_ADDRESS_PREFIX}session/s1/src/app.ts`)
    expect(targetFileAddress('s1', { kind: 'absolute', path: '/repo/src/app.ts' })).toBe(
      `${FILE_ADDRESS_PREFIX}absolute/repo/src/app.ts`,
    )
  })

  it('normalizes posix paths', () => {
    expect(normalizePosix('/a/./b/../c')).toBe('/a/c')
    expect(normalizePosix('a/b')).toBe('a/b')
    expect(normalizePosix('C:\\repo\\x')).toBe('C:/repo/x')
  })
})

describe('commit message draft', () => {
  function summary(entries: readonly StatusEntry[]): ChangeSummary {
    return summarizeChanges(entries)
  }

  const stagedModified: StatusEntry = {
    path: 'src/app.ts',
    xy: 'M.',
    untracked: false,
    ignored: false,
    index: 'modified',
  }
  const stagedAdded: StatusEntry = {
    path: 'src/new.ts',
    xy: 'A.',
    untracked: false,
    ignored: false,
    index: 'added',
  }
  const stagedDeleted: StatusEntry = {
    path: 'src/old.ts',
    xy: 'D.',
    untracked: false,
    ignored: false,
    index: 'deleted',
  }
  const untracked: StatusEntry = {
    path: 'docs/notes.md',
    xy: '??',
    untracked: true,
    ignored: false,
    worktree: 'untracked',
  }

  it('classifies the change shape', () => {
    expect(draftShape(summary([stagedAdded]))).toBe('add')
    expect(draftShape(summary([untracked]))).toBe('add')
    expect(draftShape(summary([stagedDeleted]))).toBe('remove')
    expect(draftShape(summary([stagedModified]))).toBe('update')
    expect(draftShape(summary([stagedModified, stagedAdded]))).toBe('mixed')
    expect(draftShape(summary([]))).toBe('update')
  })

  it('lists staged paths first, then untracked', () => {
    expect(draftPaths(summary([stagedModified, untracked, stagedAdded]))).toEqual([
      'src/app.ts',
      'src/new.ts',
      'docs/notes.md',
    ])
  })

  it('finds the shared directory or reports none', () => {
    expect(commonDirectory(['src/a.ts', 'src/b.ts'])).toBe('src')
    expect(commonDirectory(['src/a.ts', 'docs/b.ts'])).toBeNull()
    expect(commonDirectory(['a.ts'])).toBe('')
    expect(commonDirectory([])).toBeNull()
  })

  it('drafts a scoped, length-bounded subject', () => {
    expect(draftCommitMessage(summary([stagedModified, stagedAdded]))).toBe('Update src: app.ts, new.ts')
    expect(draftCommitMessage(summary([stagedAdded]))).toBe('Add src: new.ts')
    expect(draftCommitMessage(summary([stagedDeleted]))).toBe('Remove src: old.ts')
    expect(draftCommitMessage(summary([]))).toBe('')
    const many = Array.from({ length: 6 }, (_, index): StatusEntry => ({
      path: `src/f${index}.ts`,
      xy: 'M.',
      untracked: false,
      ignored: false,
      index: 'modified',
    }))
    expect(draftCommitMessage(summary(many))).toBe('Update src: 6 files')
  })

  it('truncates a path list that would overflow the subject', () => {
    const long = Array.from({ length: 3 }, (_, index): StatusEntry => ({
      path: `directory-with-a-long-name/x${index}-also-quite-long.ts`,
      xy: 'M.',
      untracked: false,
      ignored: false,
      index: 'modified',
    }))
    const message = draftCommitMessage(summary(long))
    expect(message.length).toBeLessThanOrEqual(DRAFT_MAX_LENGTH)
    expect(message.endsWith('...')).toBe(true)
  })

  it('derives a basename', () => {
    expect(basename('a/b/c.ts')).toBe('c.ts')
    expect(basename('c.ts')).toBe('c.ts')
  })
})

describe('agent verb payloads', () => {
  const state: PanelState = {
    root: '/repo',
    gitDir: '/repo/.git',
    bare: false,
    head: {
      oid: 'a',
      branch: 'main',
      upstream: 'origin/main',
      ahead: 0,
      behind: 0,
      detached: false,
      unborn: false,
    },
    operation: { kind: null, step: null, message: null, conflicts: [] },
    changes: {
      staged: [],
      unstaged: [],
      untracked: [],
      ignored: [],
      conflicts: [],
      ignoredCount: 0,
      ignoredTruncated: false,
    },
    worktrees: [],
    branches: [],
    identity: { name: 'a', email: 'b' },
    cwd: '/repo',
  }

  const patch = (name: string, size = 20): string =>
    [`diff --git a/${name} b/${name}`, '@@ -1,1 +1,1 @@', `-${'x'.repeat(size)}`, `+${'y'.repeat(size)}`].join('\n')

  it('states each verb\'s instruction', () => {
    for (const verb of ['review', 'explain', 'draft', 'resolve'] as const) {
      expect(verbInstruction(verb).length).toBeGreaterThan(20)
    }
  })

  it('includes the repository, branch and file list', () => {
    const payload = buildAgentPayload({
      verb: 'review',
      state,
      files: [
        { path: 'a.ts', patch: patch('a.ts'), added: 1, removed: 1, binary: false, staged: true },
        { path: 'b.bin', patch: '', added: 0, removed: 0, binary: true, staged: false },
      ],
    })
    expect(payload.prompt).toContain('Repository: /repo')
    expect(payload.prompt).toContain('Branch: main')
    expect(payload.prompt).toContain('Operation: none')
    expect(payload.prompt).toContain('- a.ts (staged, +1/-1)')
    expect(payload.prompt).toContain('- b.bin (unstaged, binary)')
    expect(payload.prompt).toContain('--- binary file: b.bin ---')
    expect(payload.includedFiles).toEqual(['a.ts', 'b.bin'])
    expect(payload.truncated).toBe(false)
  })

  it('reports a detached HEAD and an in-progress operation', () => {
    const payload = buildAgentPayload({
      verb: 'explain',
      state: {
        ...state,
        head: { ...state.head, branch: null, detached: true },
        operation: { kind: 'rebase', step: '1/2', message: null, conflicts: ['c.ts'] },
      },
      files: [],
    })
    expect(payload.prompt).toContain('Branch: (detached HEAD)')
    expect(payload.prompt).toContain('Operation: rebase in progress')
    expect(payload.prompt).toContain('- c.ts')
  })

  it('caps the file list and names what was dropped', () => {
    const files = Array.from({ length: MAX_AGENT_FILES + 5 }, (_, index) => ({
      path: `f${index}.ts`,
      patch: patch(`f${index}.ts`),
      added: 1,
      removed: 1,
      binary: false,
      staged: false,
    }))
    const payload = buildAgentPayload({ verb: 'review', state, files })
    expect(payload.includedFiles).toHaveLength(MAX_AGENT_FILES)
    expect(payload.droppedFiles).toHaveLength(5)
    expect(payload.truncated).toBe(true)
    expect(payload.prompt).toContain('5 more changed file(s) not included')
  })

  it('truncates the diff text inside the budget', () => {
    const huge = Array.from({ length: 400 }, (_, index) => `+line ${index} ${'z'.repeat(200)}`).join('\n')
    const payload = buildAgentPayload({
      verb: 'review',
      state,
      files: [{ path: 'big.ts', patch: huge, added: 400, removed: 0, binary: false, staged: false }],
    })
    expect(payload.truncated).toBe(true)
    expect(payload.prompt.length).toBeLessThan(MAX_AGENT_TOTAL_CHARS + 4000)
    expect(payload.prompt).toContain('[diff truncated]')
  })

  it('filters to the conflict list for resolve', () => {
    const payload = buildAgentPayload({
      verb: 'resolve',
      state: { ...state, operation: { ...state.operation, kind: 'merge', conflicts: ['c.ts'] } },
      files: [
        { path: 'c.ts', patch: patch('c.ts'), added: 1, removed: 1, binary: false, staged: false },
        { path: 'other.ts', patch: patch('other.ts'), added: 1, removed: 1, binary: false, staged: false },
      ],
    })
    expect(payload.includedFiles).toEqual(['c.ts'])
  })

  it('notes a file with no rendered diff', () => {
    const payload = buildAgentPayload({
      verb: 'review',
      state,
      files: [{ path: 'x.ts', patch: '', added: 0, removed: 0, binary: false, staged: false }],
    })
    expect(payload.prompt).toContain('--- no rendered diff: x.ts ---')
  })

  it('renders an empty file list as (none)', () => {
    const payload = buildAgentPayload({ verb: 'draft', state, files: [] })
    expect(payload.prompt).toContain('(none)')
    expect(fileListLine([])).toBe('')
  })

  it('truncates a patch on a line boundary', () => {
    const patchText = ['a'.repeat(50), 'b'.repeat(50), 'c'.repeat(50)].join('\n')
    const result = truncatePatch(patchText, 60)
    expect(result.truncated).toBe(true)
    expect(result.text).not.toContain('\n\n')
    expect(result.text.length).toBeLessThanOrEqual(60)
    expect(truncatePatch('short', 60)).toEqual({ text: 'short', truncated: false })
    expect(MAX_AGENT_DIFF_CHARS).toBeGreaterThan(1000)
  })
})

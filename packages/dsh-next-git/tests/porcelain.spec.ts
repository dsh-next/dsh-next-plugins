import { describe, expect, it } from 'vitest'
import {
  changeKindOf,
  changedPaths,
  dirtyPaths,
  isClean,
  parsePorcelainV2,
  parseRenamePaths,
  splitStatusRecords,
  stagedPaths,
  statusLetterOf,
  summarizeChanges,
  syntheticXy,
  unstagedPaths,
} from '../src/core/porcelain.ts'
import type { StatusEntry } from '../src/core/types.ts'

/** Build a `-z` framed status stream from records. */
function frame(records: readonly string[]): string {
  return records.map((record) => `${record}\0`).join('')
}

const HEADERS = [
  '# branch.oid 1111111111111111111111111111111111111111',
  '# branch.head main',
  '# branch.upstream origin/main',
  '# branch.ab +2 -3',
]

describe('porcelain v2 parsing', () => {
  it('reads the branch headers', () => {
    const report = parsePorcelainV2(frame(HEADERS))
    expect(report.head).toEqual({
      oid: '1111111111111111111111111111111111111111',
      branch: 'main',
      upstream: 'origin/main',
      ahead: 2,
      behind: 3,
      detached: false,
      unborn: false,
    })
    expect(report.malformed).toBe(false)
  })

  it('marks an initial repository and a detached HEAD', () => {
    const initial = parsePorcelainV2(frame(['# branch.oid (initial)', '# branch.head main']))
    expect(initial.head.oid).toBeNull()
    expect(initial.head.unborn).toBe(true)
    const detached = parsePorcelainV2(frame(['# branch.oid abc', '# branch.head (detached)']))
    expect(detached.head.branch).toBeNull()
    expect(detached.head.detached).toBe(true)
  })

  it('ignores a malformed branch.ab header', () => {
    const report = parsePorcelainV2(frame(['# branch.ab nonsense', '# branch.head main']))
    expect(report.head.ahead).toBe(0)
    expect(report.head.behind).toBe(0)
  })

  it('parses an ordinary modified entry', () => {
    const report = parsePorcelainV2(frame([...HEADERS, '1 .M N... 100644 100644 100644 aaa bbb src/app.ts']))
    expect(report.entries).toHaveLength(1)
    expect(report.entries[0]).toMatchObject({ path: 'src/app.ts', xy: '.M', worktree: 'modified', untracked: false })
    expect(report.entries[0]?.index).toBeUndefined()
  })

  it('parses a fully staged entry and a both-sides entry', () => {
    const report = parsePorcelainV2(frame([
      ...HEADERS,
      '1 M. N... 100644 100644 100644 aaa bbb staged.ts',
      '1 MM N... 100644 100644 100644 aaa bbb both.ts',
      '1 A. N... 000000 100644 100644 0000 bbb added.ts',
      '1 .D N... 100644 100644 000000 aaa 0000 deleted.ts',
      '1 .T N... 100644 100644 100644 aaa bbb link.ts',
    ]))
    expect(report.entries.map((entry) => [entry.path, entry.index, entry.worktree])).toEqual([
      ['staged.ts', 'modified', undefined],
      ['both.ts', 'modified', 'modified'],
      ['added.ts', 'added', undefined],
      ['deleted.ts', undefined, 'deleted'],
      ['link.ts', undefined, 'typechange'],
    ])
  })

  it('parses a rename in the NUL-framed two-record form', () => {
    const report = parsePorcelainV2(frame([
      ...HEADERS,
      '2 R. N... 100644 100644 100644 aaa bbb R100 src/renamed.ts',
      'src/original.ts',
    ]))
    expect(report.entries).toHaveLength(1)
    expect(report.entries[0]).toMatchObject({
      path: 'src/renamed.ts',
      oldPath: 'src/original.ts',
      index: 'renamed',
    })
  })

  it('parses a renamed path that contains spaces', () => {
    const report = parsePorcelainV2(frame([
      ...HEADERS,
      '2 R. N... 100644 100644 100644 aaa bbb R100 my file.ts',
      'old file.ts',
    ]))
    expect(report.entries[0]?.path).toBe('my file.ts')
    expect(report.entries[0]?.oldPath).toBe('old file.ts')
  })

  it('parses a rename in the tab-joined newline form', () => {
    const report = parsePorcelainV2([
      ...HEADERS,
      '2 R. N... 100644 100644 100644 aaa bbb R100 new.ts\told.ts',
    ].join('\n'))
    expect(report.entries[0]).toMatchObject({ path: 'new.ts', oldPath: 'old.ts' })
  })

  it('parses every unmerged code', () => {
    const codes = ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']
    const report = parsePorcelainV2(frame(codes.map((code, index) =>
      `u ${code} N... 100644 100644 100644 100644 aaa bbb ccc conflict-${index}.ts`)))
    expect(report.entries.map((entry) => entry.unmerged)).toEqual([
      'both-deleted',
      'added-by-us',
      'deleted-by-them',
      'added-by-them',
      'deleted-by-us',
      'both-added',
      'both-modified',
    ])
    for (const entry of report.entries) {
      expect(entry.index).toBe('unmerged')
      expect(entry.worktree).toBe('unmerged')
    }
  })

  it('records an unmerged code it does not know as malformed', () => {
    const report = parsePorcelainV2(frame(['u ZZ N... 100644 100644 100644 100644 aaa bbb ccc x.ts']))
    expect(report.entries).toHaveLength(0)
    expect(report.malformed).toBe(true)
  })

  it('parses untracked and ignored records', () => {
    const report = parsePorcelainV2(frame(['? new.txt', '! ignored.log']))
    expect(report.entries[0]).toMatchObject({ path: 'new.txt', untracked: true, worktree: 'untracked' })
    expect(report.entries[1]).toMatchObject({ path: 'ignored.log', ignored: true, worktree: 'ignored' })
  })

  it('reports malformed records without dropping the good ones', () => {
    const report = parsePorcelainV2(frame(['1 .M', 'nonsense', '? ok.txt', '? ']))
    expect(report.malformed).toBe(true)
    expect(report.entries.map((entry) => entry.path)).toEqual(['ok.txt'])
  })

  it('splits records in both framings', () => {
    expect(splitStatusRecords('a\0b\0')).toEqual(['a', 'b'])
    expect(splitStatusRecords('a\nb\n')).toEqual(['a', 'b'])
    expect(splitStatusRecords('')).toEqual([])
  })

  it('maps letters both ways', () => {
    for (const letter of ['M', 'T', 'A', 'D', 'R', 'C', 'U']) {
      const kind = changeKindOf(letter)!
      expect(statusLetterOf(kind)).toBe(letter)
    }
    expect(changeKindOf('.')).toBeUndefined()
    expect(changeKindOf('X')).toBeUndefined()
    expect(statusLetterOf('untracked')).toBe('?')
    expect(statusLetterOf('ignored')).toBe('?')
    expect(syntheticXy('modified', undefined)).toBe('M.')
    expect(syntheticXy(undefined, undefined)).toBe('..')
    expect(syntheticXy('added', 'untracked')).toBe('A?')
  })

  it('reads a rename pair from either framing', () => {
    expect(parseRenamePaths('new.ts', () => 'old.ts')).toEqual({
      path: 'new.ts',
      oldPath: 'old.ts',
      consumedNext: true,
    })
    expect(parseRenamePaths('new.ts\told.ts', () => undefined)).toEqual({
      path: 'new.ts',
      oldPath: 'old.ts',
      consumedNext: false,
    })
    // A rename record with no following field degrades to path-only.
    expect(parseRenamePaths('new.ts', () => undefined)).toEqual({
      path: 'new.ts',
      oldPath: undefined,
      consumedNext: false,
    })
    expect(parseRenamePaths('new.ts', () => '')).toMatchObject({ oldPath: undefined })
  })
})

describe('change grouping', () => {
  const entries: StatusEntry[] = [
    { path: 'both.ts', xy: 'MM', untracked: false, ignored: false, index: 'modified', worktree: 'modified' },
    { path: 'staged.ts', xy: 'M.', untracked: false, ignored: false, index: 'modified' },
    { path: 'unstaged.ts', xy: '.M', untracked: false, ignored: false, worktree: 'modified' },
    { path: 'new.ts', xy: '??', untracked: true, ignored: false, worktree: 'untracked' },
    { path: 'ignored.log', xy: '!!', untracked: false, ignored: true, worktree: 'ignored' },
    {
      path: 'conflict.ts',
      xy: 'UU',
      untracked: false,
      ignored: false,
      index: 'unmerged',
      worktree: 'unmerged',
      unmerged: 'both-modified',
    },
  ]

  it('puts each path on the sides it changed', () => {
    const summary = summarizeChanges(entries)
    expect(summary.staged.map((entry) => entry.path)).toEqual(['both.ts', 'staged.ts', 'conflict.ts'])
    expect(summary.unstaged.map((entry) => entry.path)).toEqual(['both.ts', 'unstaged.ts', 'conflict.ts'])
    expect(summary.untracked.map((entry) => entry.path)).toEqual(['new.ts'])
    expect(summary.conflicts.map((entry) => entry.path)).toEqual(['conflict.ts'])
    expect(summary.ignoredCount).toBe(1)
    expect(summary.ignored).toEqual([])
  })

  it('keeps the ignored list only when asked, and bounds it', () => {
    const summary = summarizeChanges(entries, { includeIgnored: true })
    expect(summary.ignored.map((entry) => entry.path)).toEqual(['ignored.log'])
    const bounded = summarizeChanges(entries, { includeIgnored: true, ignoredLimit: 0, ignoredCount: 7, ignoredTruncated: true })
    expect(bounded.ignored).toEqual([])
    expect(bounded.ignoredCount).toBe(7)
    expect(bounded.ignoredTruncated).toBe(true)
  })

  it('derives dirty, clean, staged and unstaged path lists', () => {
    const summary = summarizeChanges(entries)
    expect(dirtyPaths(entries)).toEqual(['both.ts', 'unstaged.ts', 'new.ts', 'conflict.ts'])
    expect(isClean(entries)).toBe(false)
    expect(isClean([entries[4]!])).toBe(true)
    expect(stagedPaths(summary)).toEqual(['both.ts', 'staged.ts', 'conflict.ts'])
    expect(unstagedPaths(summary)).toEqual(['both.ts', 'unstaged.ts', 'conflict.ts'])
    expect(changedPaths(summary)).toEqual(['both.ts', 'staged.ts', 'conflict.ts', 'unstaged.ts', 'new.ts'])
  })

  it('treats an empty stream as clean', () => {
    expect(isClean([])).toBe(true)
    expect(summarizeChanges([]).staged).toEqual([])
    expect(parsePorcelainV2('').head).toEqual({
      oid: null,
      branch: null,
      upstream: null,
      ahead: 0,
      behind: 0,
      detached: false,
      unborn: false,
    })
  })
})

import { describe, expect, it } from 'vitest'
import { addedFileDiff, parseUnifiedDiff } from '../src/core/diff.ts'
import { CHANGE_CONTEXT_LINES, changeMarkers, hiddenLineNumbers, languageFor } from '../src/core/file-view.ts'
import { changeFileAddress, changeFileTitle, parseChangeFileAddress } from '../src/core/address.ts'

const patch = (...lines: string[]): string =>
  ['diff --git a/src/app.ts b/src/app.ts', '--- a/src/app.ts', '+++ b/src/app.ts', ...lines].join('\n')

describe('change markers', () => {
  it('numbers added lines on the new side, including a hunk that does not start at line 1', () => {
    const files = parseUnifiedDiff(patch(
      '@@ -8,4 +8,6 @@ context',
      ' unchanged',
      ' also unchanged',
      '+added one',
      '+added two',
      ' trailing context',
      ' tail',
    ))
    expect(changeMarkers(files[0]!)).toEqual([
      { line: 10, kind: 'added' },
      { line: 11, kind: 'added' },
    ])
  })

  it('records a deletion as a marker before the next surviving line', () => {
    const files = parseUnifiedDiff(patch(
      '@@ -1,4 +1,2 @@',
      ' keep',
      '-gone one',
      '-gone two',
      ' after',
    ))
    expect(changeMarkers(files[0]!)).toEqual([{ line: 2, kind: 'removed' }])
  })

  it('records a deletion at the head of the file as line 1', () => {
    const files = parseUnifiedDiff(patch('@@ -1,3 +1,1 @@', '-first', '-second', ' kept'))
    expect(changeMarkers(files[0]!)).toEqual([{ line: 1, kind: 'removed' }])
  })

  it('prefers the added fact when a replacement sits on one line', () => {
    const files = parseUnifiedDiff(patch('@@ -1,1 +1,1 @@', '-old line', '+new line'))
    expect(changeMarkers(files[0]!)).toEqual([{ line: 1, kind: 'added' }])
  })

  it('merges several hunks in ascending order', () => {
    const files = parseUnifiedDiff(patch(
      '@@ -1,1 +1,2 @@',
      ' keep',
      '+second',
      '@@ -10,1 +11,1 @@',
      '-gone',
      '+replaced',
    ))
    expect(changeMarkers(files[0]!)).toEqual([
      { line: 2, kind: 'added' },
      { line: 11, kind: 'added' },
    ])
  })

  it('marks every line of a synthesized new file, and nothing without hunks', () => {
    expect(changeMarkers({ hunks: [] })).toEqual([])
    expect(changeMarkers(addedFileDiff('src/new.ts', 'one\ntwo\n'))).toEqual([
      { line: 1, kind: 'added' },
      { line: 2, kind: 'added' },
    ])
  })
})

describe('changed-lines visibility', () => {
  it('keeps context around each change and hides the rest', () => {
    const hidden = hiddenLineNumbers([{ line: 20, kind: 'added' }], 40)
    // Lines 17..23 are the change and its three lines of context on each side.
    expect([...hidden].sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
      24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40,
    ])
    expect(hidden.has(16)).toBe(true)
    expect(hidden.has(17)).toBe(false)
    expect(hidden.has(23)).toBe(false)
    expect(hidden.has(24)).toBe(true)
    expect(CHANGE_CONTEXT_LINES).toBe(3)
  })

  it('never hides anything at the file edges, and merges nearby changes', () => {
    expect([...hiddenLineNumbers([{ line: 1, kind: 'added' }], 4)].sort((a, b) => a - b)).toEqual([])
    // Two changes three lines apart share one window: 2..11 stays visible.
    const merged = hiddenLineNumbers([{ line: 5, kind: 'added' }, { line: 8, kind: 'added' }], 12)
    expect([...merged].sort((a, b) => a - b)).toEqual([1, 12])
  })

  it('honours a custom window and hides nothing without changes', () => {
    const tight = hiddenLineNumbers([{ line: 5, kind: 'removed' }], 10, 0)
    expect([...tight].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 6, 7, 8, 9, 10])
    expect([...hiddenLineNumbers([], 10)]).toEqual([])
    expect([...hiddenLineNumbers([{ line: 1, kind: 'added' }], 0)]).toEqual([])
  })
})

describe('language hints', () => {
  it('maps known extensions to the grammar the platform resolves', () => {
    expect(languageFor('src/app.ts')).toBe('typescript')
    expect(languageFor('packages/x/src/view.tsx')).toBe('tsx')
    expect(languageFor('README.md')).toBe('markdown')
    expect(languageFor('a/b/Config.YAML')).toBe('yaml')
  })

  it('returns nothing for an extension the platform would not highlight', () => {
    expect(languageFor('docs/notes.rst')).toBeUndefined()
    expect(languageFor('Makefile')).toBeUndefined()
    expect(languageFor('.gitignore')).toBeUndefined()
    expect(languageFor('LICENSE')).toBeUndefined()
  })
})

describe('change view addresses', () => {
  it('round-trips a session, side and path', () => {
    const address = changeFileAddress('session-1', 'src/app.ts', 'unstaged')
    expect(address).toBe('dsh-resource://git-changes/session/session-1/unstaged/src/app.ts')
    expect(parseChangeFileAddress(address)).toEqual({ sessionId: 'session-1', side: 'unstaged', path: 'src/app.ts' })
  })

  it('encodes segments that would otherwise change the grammar', () => {
    const address = changeFileAddress('session 1/2', 'a b/c#d.ts', 'staged')
    expect(parseChangeFileAddress(address)).toEqual({ sessionId: 'session 1/2', side: 'staged', path: 'a b/c#d.ts' })
  })

  it('refuses anything that is not one of ours', () => {
    for (const address of [
      'dsh-resource://file/session/s1/src/app.ts',
      'dsh-resource://git-changes/session/s1/sideways/src/app.ts',
      'dsh-resource://git-changes/session/s1/staged',
      'sidebar://guide',
      '',
    ]) {
      expect(parseChangeFileAddress(address)).toBeNull()
    }
  })

  it('names the chip after the file, and says which side when staged', () => {
    expect(changeFileTitle(changeFileAddress('s1', 'src/app.ts', 'unstaged'))).toBe('app.ts')
    expect(changeFileTitle(changeFileAddress('s1', 'src/app.ts', 'staged'))).toBe('app.ts (staged)')
    expect(changeFileTitle('sidebar://guide')).toBe('sidebar://guide')
  })
})

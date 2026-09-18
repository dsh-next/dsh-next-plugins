import { describe, expect, it } from 'vitest'
import {
  addedFileDiff,
  applyNumstat,
  canRenderNative,
  DIFF_SIZE_CAP_LINES,
  lineCount,
  parseNumstat,
  parseUnifiedDiff,
  pathsFromGitHeader,
  toDiffHunks,
} from '../src/core/diff.ts'

const MODIFIED_PATCH = [
  'diff --git a/src/app.ts b/src/app.ts',
  'index 1111111..2222222 100644',
  '--- a/src/app.ts',
  '+++ b/src/app.ts',
  '@@ -1,4 +1,5 @@',
  ' const a = 1',
  '-const b = 2',
  '+const b = 3',
  '+const c = 4',
  ' const d = 5',
].join('\n')

describe('unified diff parsing', () => {
  it('parses one modified file with exact counts and a renderable hunk', () => {
    const files = parseUnifiedDiff(MODIFIED_PATCH)
    expect(files).toHaveLength(1)
    const file = files[0]!
    expect(file.path).toBe('src/app.ts')
    expect(file.displayPath).toBe('src/app.ts')
    expect(file.added).toBe(2)
    expect(file.removed).toBe(1)
    expect(file.binary).toBe(false)
    expect(file.tooLarge).toBe(false)
    expect(file.hunks).toHaveLength(1)
    expect(file.hunks[0]!.header).toBe('-1,4 +1,5')
    // The hunk's old/new sides carry context on both sides: DiffBlock compares
    // exactly these two fragments.
    expect(file.hunks[0]!.oldText.split('\n')).toEqual(['const a = 1', 'const b = 2', 'const d = 5'])
    expect(file.hunks[0]!.newText.split('\n')).toEqual(['const a = 1', 'const b = 3', 'const c = 4', 'const d = 5'])
    expect(file.patch).toBe(MODIFIED_PATCH)
  })

  it('splits a multi-hunk patch and keeps each fragment small', () => {
    const patch = [
      MODIFIED_PATCH,
      '@@ -20,3 +21,4 @@',
      ' keep',
      '+added',
      ' keep2',
    ].join('\n')
    const file = parseUnifiedDiff(patch)[0]!
    expect(file.hunks).toHaveLength(2)
    expect(file.hunks[1]!.header).toBe('-20,3 +21,4')
    expect(toDiffHunks(file)).toEqual([
      { path: 'src/app.ts', oldText: expect.any(String), newText: expect.any(String) },
      { path: 'src/app.ts', oldText: 'keep\nkeep2', newText: 'keep\nadded\nkeep2' },
    ])
    expect(file.added).toBe(3)
    expect(file.removed).toBe(1)
  })

  it('parses several files in one patch', () => {
    const files = parseUnifiedDiff(`${MODIFIED_PATCH}\ndiff --git a/b.ts b/b.ts\n--- /dev/null\n+++ b/b.ts\n@@ -0,0 +1,1 @@\n+hello`)
    expect(files.map((file) => file.path)).toEqual(['src/app.ts', 'b.ts'])
    expect(files[1]!.added).toBe(1)
    expect(files[1]!.removed).toBe(0)
  })

  it('resolves a rename to a display path', () => {
    const patch = [
      'diff --git a/old.ts b/new.ts',
      'similarity index 90%',
      'rename from old.ts',
      'rename to new.ts',
      '--- a/old.ts',
      '+++ b/new.ts',
      '@@ -1,1 +1,1 @@',
      '-old',
      '+new',
    ].join('\n')
    const file = parseUnifiedDiff(patch)[0]!
    expect(file.path).toBe('new.ts')
    expect(file.displayPath).toBe('old.ts -> new.ts')
  })

  it('marks binary diffs', () => {
    const patch = 'diff --git a/logo.bin b/logo.bin\nindex 111..222 100644\nBinary files a/logo.bin and b/logo.bin differ\n'
    const file = parseUnifiedDiff(patch)[0]!
    expect(file.binary).toBe(true)
    expect(file.hunks).toEqual([])
    expect(canRenderNative(file)).toBe(false)
  })

  it('marks a git binary patch as binary', () => {
    const patch = 'diff --git a/x.bin b/x.bin\nGIT binary patch\nliteral 12\nzcmZ?\n'
    expect(parseUnifiedDiff(patch)[0]!.binary).toBe(true)
  })

  it('keeps a mode-only change with no hunks', () => {
    const patch = 'diff --git a/script.sh b/script.sh\nold mode 100644\nnew mode 100755\n'
    const file = parseUnifiedDiff(patch)[0]!
    expect(file.hunks).toEqual([])
    expect(file.added).toBe(0)
    expect(canRenderNative(file)).toBe(false)
    expect(file.patch).toBe(patch)
  })

  it('falls back to counts plus patch past the size cap', () => {
    const body = Array.from({ length: 50 }, (_, index) => `+line ${index}`)
    const patch = ['diff --git a/big.ts b/big.ts', '@@ -1,1 +1,50 @@', ...body].join('\n')
    const file = parseUnifiedDiff(patch, { sizeCap: 10 })[0]!
    expect(file.tooLarge).toBe(true)
    expect(file.hunks).toEqual([])
    expect(file.added).toBe(50)
    expect(file.patch).toContain('+line 49')
    expect(canRenderNative(file)).toBe(false)
  })

  it('ignores the no-newline marker and trailing blank lines', () => {
    const patch = [
      'diff --git a/x.ts b/x.ts',
      '@@ -1,1 +1,1 @@',
      '-a',
      '\\ No newline at end of file',
      '+b',
      '',
    ].join('\n')
    const file = parseUnifiedDiff(patch)[0]!
    expect(file.added).toBe(1)
    expect(file.removed).toBe(1)
    expect(file.hunks[0]!.newText).toBe('b')
  })

  it('reads paths from a git header', () => {
    expect(pathsFromGitHeader('diff --git a/x.ts b/x.ts')).toEqual({ path: 'x.ts', oldPath: null })
    expect(pathsFromGitHeader('diff --git a/x.ts b/y.ts')).toEqual({ path: 'y.ts', oldPath: 'x.ts' })
    expect(pathsFromGitHeader('diff --git weird')).toEqual({ path: 'weird', oldPath: null })
  })

  it('returns nothing for an empty patch', () => {
    expect(parseUnifiedDiff('')).toEqual([])
  })

  it('counts content lines', () => {
    expect(lineCount('')).toBe(0)
    expect(lineCount('a')).toBe(1)
    expect(lineCount('a\nb')).toBe(2)
  })
})

describe('numstat', () => {
  it('parses NUL-framed counts', () => {
    const counts = parseNumstat('3\t2\tsrc/app.ts\0-\t-\tlogo.bin\0')
    expect(counts.get('src/app.ts')).toEqual({ added: 3, removed: 2, binary: false })
    expect(counts.get('logo.bin')).toEqual({ added: 0, removed: 0, binary: true })
  })

  it('reads the second path field of a rename record', () => {
    const counts = parseNumstat('0\t0\t\0new.ts\0')
    expect(counts.get('new.ts')).toEqual({ added: 0, removed: 0, binary: false })
  })

  it('skips malformed records and empty input', () => {
    expect(parseNumstat('')).toEqual(new Map())
    expect(parseNumstat('garbage\0').size).toBe(0)
    expect(parseNumstat('1\t2\t\0').size).toBe(0)
  })

  it('merges counts into parsed files', () => {
    const files = parseUnifiedDiff(MODIFIED_PATCH)
    const merged = applyNumstat(files, new Map([['src/app.ts', { added: 9, removed: 8, binary: false }]]))
    expect(merged[0]!.added).toBe(9)
    expect(merged[0]!.removed).toBe(8)
    // A path with no count entry keeps the patch-derived numbers.
    expect(applyNumstat(files, new Map())[0]!.added).toBe(2)
  })
})

describe('synthesized added file', () => {
  it('builds a single added hunk', () => {
    const file = addedFileDiff('docs/notes.md', 'one\ntwo\n')
    expect(file.added).toBe(2)
    expect(file.removed).toBe(0)
    expect(file.hunks).toHaveLength(1)
    expect(file.hunks[0]!.oldText).toBe('')
    expect(file.hunks[0]!.newText).toBe('one\ntwo')
    expect(file.patch).toContain('new file mode 100644')
    expect(canRenderNative(file)).toBe(true)
  })

  it('handles an empty file', () => {
    const file = addedFileDiff('empty.txt', '')
    expect(file.added).toBe(0)
    expect(file.hunks[0]!.newText).toBe('')
  })

  it('marks a binary file and honors the size cap', () => {
    expect(addedFileDiff('a.bin', '', { binary: true }).binary).toBe(true)
    const large = addedFileDiff('big.txt', Array.from({ length: 20 }, () => 'x').join('\n'), { sizeCap: 5 })
    expect(large.tooLarge).toBe(true)
    expect(large.hunks).toEqual([])
    expect(large.added).toBe(20)
  })

  it('defaults its size cap to the module constant', () => {
    expect(DIFF_SIZE_CAP_LINES).toBeGreaterThan(100)
  })
})

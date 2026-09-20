import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  parseConflictText, renderConflictResult, resolveConflictHunk, resolveNonTextConflict, validateConflictResult,
} from '../src/core/conflicts.ts'
import type {
  ConflictHunk, ConflictResolution, NonTextConflictDecision, NonTextConflictModel, TextConflictModel,
} from '../src/core/conflicts.ts'

const standard = '<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> topic\n'
const diff3 = '<<<<<<< HEAD\nours\n||||||| abc123 (ancestor)\nbase\n=======\ntheirs\n>>>>>>> topic\n'
const hunks = (model: TextConflictModel): ConflictHunk[] => model.segments.filter((s): s is ConflictHunk => s.kind === 'conflict')

describe('lossless conflict parsing', () => {
  it.each(['', 'plain', 'plain\n', '\n\r\n\r', 'one\r\ntwo\nthree\rfour'])('round-trips ordinary text %j', (text) => {
    const model = parseConflictText(text)
    expect(hunks(model)).toEqual([])
    expect(model.issues).toEqual([])
    expect(renderConflictResult(model)).toBe(text)
    expect(validateConflictResult(text)).toEqual({ valid: true, markers: [] })
  })

  it.each([1, 3, 5, 7, 32, 1024])('parses configured width %i losslessly with mixed newlines', (markerSize) => {
    const text = '<'.repeat(markerSize) + ' HEAD\r\nours\r' + '|'.repeat(markerSize) + ' base\nbase\r\n' + '='.repeat(markerSize) + '\rincoming\n' + '>'.repeat(markerSize) + ' topic'
    const model = parseConflictText(text, markerSize)
    expect(model.markerSize).toBe(markerSize)
    expect(model.issues).toEqual([])
    expect(hunks(model)).toHaveLength(1)
    expect(hunks(model)[0]).toMatchObject({ markerSize, current: 'ours\r', base: 'base\r\n', incoming: 'incoming\n' })
    expect(renderConflictResult(model)).toBe(text)
    expect(validateConflictResult(text, markerSize).valid).toBe(false)
    const resolved = resolveConflictHunk(model, hunks(model)[0]!.id, { kind: 'incoming' })
    expect(resolved.markerSize).toBe(markerSize)
    expect(validateConflictResult(renderConflictResult(resolved), resolved.markerSize).valid).toBe(true)
  })

  it.each([
    ['<<< HEAD\nours\n', 'unclosed-conflict'],
    ['<<< HEAD\n====\n>>> topic', 'marker-size-mismatch'],
    ['===\r', 'unexpected-marker'],
    ['<<< outer\n<<< nested\n===\n>>> nested\n===\n>>> outer', 'nested-marker'],
  ])('preserves malformed small markers: %s', (text, code) => {
    const model = parseConflictText(text, 3)
    expect(hunks(model)).toEqual([])
    expect(model.issues.map(issue => issue.code)).toContain(code)
    expect(renderConflictResult(model)).toBe(text)
    expect(validateConflictResult(text, 3).valid).toBe(false)
  })

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('fails closed for invalid width %s', (markerSize) => {
    expect(() => parseConflictText('', markerSize)).toThrow(RangeError)
    expect(validateConflictResult('', markerSize).valid).toBe(false)
  })

  it('does not allocate from a huge width or overlook standard markers', () => {
    expect(parseConflictText('ordinary', Number.MAX_SAFE_INTEGER).markerSize).toBe(Number.MAX_SAFE_INTEGER)
    expect(validateConflictResult(standard, Number.MAX_SAFE_INTEGER).valid).toBe(false)
    expect(validateConflictResult('<<<<<<< remaining', 3).valid).toBe(false)
  })

  it('extracts standard sides, labels, source offsets and an unresolved result', () => {
    const text = 'before\n' + standard + 'after'
    const model = parseConflictText(text)
    expect(model.issues).toEqual([])
    expect(model.segments).toHaveLength(3)
    expect(hunks(model)).toEqual([{
      kind: 'conflict', id: 'conflict:7', start: 7, end: 7 + standard.length, markerSize: 7,
      labels: { current: 'HEAD', base: null, incoming: 'topic' },
      current: 'ours\n', base: null, incoming: 'theirs\n', original: standard, result: standard, resolution: null,
    }])
    expect(renderConflictResult(model)).toBe(text)
  })

  it('extracts diff3 base without confusing an absent base with an empty base', () => {
    expect(hunks(parseConflictText(diff3))[0]).toMatchObject({ base: 'base\n', labels: { base: 'abc123 (ancestor)' } })
    expect(hunks(parseConflictText(diff3.replace('base\n', '')))[0]?.base).toBe('')
    expect(hunks(parseConflictText(standard))[0]?.base).toBeNull()
  })

  it('keeps zdiff3 shared context outside the base/current/incoming sections', () => {
    const text = 'common prefix\n' + diff3 + 'common suffix\n'
    const model = parseConflictText(text)
    expect(model.segments[0]).toEqual({ kind: 'text', text: 'common prefix\n' })
    expect(model.segments[2]).toEqual({ kind: 'text', text: 'common suffix\n' })
    expect(renderConflictResult(resolveConflictHunk(model, hunks(model)[0]!.id, { kind: 'incoming' })))
      .toBe('common prefix\ntheirs\ncommon suffix\n')
  })

  it('preserves mixed newlines and no final newline, including labels verbatim', () => {
    const text = '<<<<<<< feature/a b  \r\nleft\r|||||||\nbase\r\n=======\rincoming\n>>>>>>>\tcommit  subject'
    const model = parseConflictText(text)
    expect(model.issues).toEqual([])
    expect(hunks(model)[0]).toMatchObject({
      current: 'left\r', base: 'base\r\n', incoming: 'incoming\n',
      labels: { current: 'feature/a b  ', base: null, incoming: 'commit  subject' },
    })
    expect(renderConflictResult(model)).toBe(text)
  })

  it('supports absent/empty labels, empty sides, and custom marker widths', () => {
    const text = '<<<<<<<<<<\n|||||||||| \n==========\n>>>>>>>>>>\n'
    const hunk = hunks(parseConflictText(text))[0]!
    expect(hunk).toMatchObject({ markerSize: 10, current: '', base: '', incoming: '', labels: { current: null, base: '', incoming: null } })
    expect(renderConflictResult(resolveConflictHunk(parseConflictText(text), hunk.id, { kind: 'both', order: 'current-incoming' }))).toBe('')
  })

  it.each([
    'a < b\n<< text\n<<<<<< label\n',
    '  <<<<<<< example\nprefix >>>>>>> label\n',
    '<<<<<<<not-a-marker\n======= heading\n>>>>>>>not-a-marker\n|||||||not-a-marker',
  ])('does not interpret literal marker-like text %j', (text) => {
    expect(parseConflictText(text).issues).toEqual([])
    expect(hunks(parseConflictText(text))).toEqual([])
    expect(validateConflictResult(text).valid).toBe(true)
    expect(renderConflictResult(parseConflictText(text))).toBe(text)
  })

  it.each([
    ['<<<<<<< HEAD\nleft\n', 'unclosed-conflict'],
    ['<<<<<<< HEAD\nleft\n=======\nright', 'unclosed-conflict'],
    ['<<<<<<< HEAD\nleft\n>>>>>>> topic\n', 'unexpected-marker'],
    ['<<<<<<< HEAD\n||||||| base\n||||||| duplicate\n=======\n>>>>>>> topic\n', 'unexpected-marker'],
    ['<<<<<<< HEAD\n=======\n||||||| late-base\n>>>>>>> topic\n', 'unexpected-marker'],
    ['<<<<<<< HEAD\n=======\n=======\n>>>>>>> topic\n', 'unexpected-marker'],
    ['<<<<<<< HEAD\n========\n>>>>>>> topic\n', 'marker-size-mismatch'],
    ['<<<<<<< HEAD\n=======\n>>>>>>>> topic\n', 'marker-size-mismatch'],
    ['=======\n', 'unexpected-marker'],
    ['||||||| base\n', 'unexpected-marker'],
    ['>>>>>>> topic\n', 'unexpected-marker'],
  ])('preserves malformed blocks and reports %s', (text, code) => {
    const model = parseConflictText(text)
    expect(hunks(model)).toEqual([])
    expect(model.issues.map((issue) => issue.code)).toContain(code)
    expect(renderConflictResult(model)).toBe(text)
    expect(validateConflictResult(text).valid).toBe(false)
  })

  it('never exposes nested malformed hunks as individually resolvable', () => {
    const nested = '<<<<<<< outer\n' + diff3 + '=======\nouter incoming\n>>>>>>> outer\n'
    const text = nested + standard
    const model = parseConflictText(text)
    expect(model.issues).toContainEqual({ code: 'nested-marker', line: 2, offset: '<<<<<<< outer\n'.length })
    expect(hunks(model)).toHaveLength(1)
    expect(hunks(model)[0]?.start).toBe(nested.length)
    expect(renderConflictResult(model)).toBe(text)
    expect(renderConflictResult(resolveConflictHunk(model, hunks(model)[0]!.id, { kind: 'current' }))).toBe(nested + 'ours\n')
  })

  it('keeps nested blocks with missing outer closure intact', () => {
    const text = '<<<<<<< outer\n' + standard
    const model = parseConflictText(text)
    expect(hunks(model)).toEqual([])
    expect(model.issues.map((issue) => issue.code)).toEqual(['nested-marker', 'unclosed-conflict'])
    expect(renderConflictResult(model)).toBe(text)
  })
})

describe('explicit per-hunk resolution', () => {
  it.each<[ConflictResolution, string]>([
    [{ kind: 'current' }, 'ours\n'],
    [{ kind: 'incoming' }, 'theirs\n'],
    [{ kind: 'both', order: 'current-incoming' }, 'ours\ntheirs\n'],
    [{ kind: 'both', order: 'incoming-current' }, 'theirs\nours\n'],
    [{ kind: 'edit', text: 'manual without final newline' }, 'manual without final newline'],
    [{ kind: 'edit', text: '' }, ''],
  ])('applies %j without mutating source or other hunk identities', (resolution, expected) => {
    const text = 'prefix\n' + diff3 + 'between\n' + standard + 'suffix'
    const model = parseConflictText(text)
    const [first, second] = hunks(model)
    const updated = resolveConflictHunk(model, first!.id, resolution)
    expect(renderConflictResult(updated)).toBe('prefix\n' + expected + 'between\n' + standard + 'suffix')
    expect(hunks(updated)[0]).toMatchObject({ id: first!.id, result: expected, resolution })
    expect(hunks(updated)[1]).toBe(second)
    expect(renderConflictResult(model)).toBe(text)
    expect(hunks(parseConflictText(text)).map((hunk) => hunk.id)).toEqual([first!.id, second!.id])
    const done = resolveConflictHunk(updated, second!.id, { kind: 'current' })
    expect(validateConflictResult(renderConflictResult(done)).valid).toBe(true)
    expect(hunks(done).map((hunk) => hunk.id)).toEqual([first!.id, second!.id])
  })

  it('replaces a previous choice while keeping original inputs', () => {
    const model = parseConflictText(standard)
    const edited = resolveConflictHunk(model, 'conflict:0', { kind: 'edit', text: 'manual' })
    const current = resolveConflictHunk(edited, 'conflict:0', { kind: 'current' })
    expect(renderConflictResult(current)).toBe('ours\n')
    expect(hunks(current)[0]?.original).toBe(standard)
  })

  it('rejects unknown hunk IDs instead of silently losing edits', () => {
    expect(() => resolveConflictHunk(parseConflictText(standard), 'stale', { kind: 'current' })).toThrow('Unknown conflict hunk')
  })

  it('detects markers in manually edited results rather than trusting the choice state', () => {
    const model = resolveConflictHunk(parseConflictText(standard), 'conflict:0', { kind: 'edit', text: '<<<<<<< remaining' })
    expect(validateConflictResult(renderConflictResult(model)).valid).toBe(false)
  })

  it('reports full marker positions and unpaired markers conservatively', () => {
    expect(validateConflictResult('ok\r\n<<<<<<< HEAD\r||||||| base\n=======\n>>>>>>> topic')).toEqual({
      valid: false,
      markers: [
        { kind: 'current', size: 7, label: 'HEAD', line: 2, offset: 4 },
        { kind: 'base', size: 7, label: 'base', line: 3, offset: 17 },
        { kind: 'separator', size: 7, label: null, line: 4, offset: 30 },
        { kind: 'incoming', size: 7, label: 'topic', line: 5, offset: 38 },
      ],
    })
    expect(validateConflictResult('=======\t \n').valid).toBe(false)
  })

  it('also rejects missing or invalid both-side order at runtime', () => {
    for (const resolution of [{ kind: 'both' }, { kind: 'both', order: 'ambiguous' }]) {
      expect(() => resolveConflictHunk(parseConflictText(standard), 'conflict:0', resolution as ConflictResolution))
        .toThrow('explicit side order')
    }
  })

  it('requires explicit order at the type boundary', () => {
    expectTypeOf<{ kind: 'both' }>().not.toExtend<ConflictResolution>()
    expectTypeOf<{ kind: 'both'; order: 'incoming-current' }>().toExtend<ConflictResolution>()
  })
})

describe('nontext conflicts', () => {
  const side = { path: 'image.bin', oid: 'abc123', mode: '100644' }
  const model: NonTextConflictModel = { kind: 'nontext', reason: 'binary', base: null, current: side, incoming: side, decision: null }

  it.each<NonTextConflictDecision>([{ kind: 'current' }, { kind: 'incoming' }, { kind: 'delete' }, { kind: 'external' }])('records %j without manufacturing text', (decision) => {
    expect(resolveNonTextConflict(model, decision)).toEqual({ ...model, decision })
    expect(model.decision).toBeNull()
    expect(resolveNonTextConflict(model, decision)).not.toHaveProperty('result')
  })

  it.each(['current', 'incoming'] as const)('refuses absent %s stages; deletion must be explicit', (kind) => {
    const missing = { ...model, [kind]: null }
    expect(() => resolveNonTextConflict(missing, { kind })).toThrow('choose deletion explicitly')
    expect(resolveNonTextConflict(missing, { kind: 'delete' }).decision).toEqual({ kind: 'delete' })
  })

  it.each<NonTextConflictModel['reason']>(['binary', 'symlink', 'submodule', 'rename', 'delete-modify', 'nontext'])('retains typed %s cases', (reason) => {
    expect(resolveNonTextConflict({ ...model, reason }, { kind: 'external' }).reason).toBe(reason)
  })

  it('excludes text edits and both-side concatenation from nontext decisions', () => {
    expectTypeOf<{ kind: 'edit'; text: string }>().not.toExtend<NonTextConflictDecision>()
    expectTypeOf<{ kind: 'both'; order: 'current-incoming' }>().not.toExtend<NonTextConflictDecision>()
  })
})

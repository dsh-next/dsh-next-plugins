import { describe, expect, it } from 'vitest'
import {
  abortCommand,
  atRestMarkers,
  blocksCheckout,
  continueCommand,
  detectOperation,
  operationKindOf,
  type OperationMarkers,
} from '../src/core/operation.ts'
import {
  classifyGitFailure,
  clipOutput,
  compareVersions,
  degradedFrom,
  isDegradedCode,
  meetsVersion,
  MIN_GIT_VERSION,
  parseGitVersion,
  supportsMergeTree,
  tooOldFailure,
} from '../src/core/degraded.ts'
import type { StatusEntry } from '../src/core/types.ts'

/** Markers with no operation in flight. */
function markers(overrides: Partial<OperationMarkers> = {}): OperationMarkers {
  return { ...atRestMarkers(), ...overrides }
}

const CONFLICT: StatusEntry = {
  path: 'a.ts',
  xy: 'UU',
  untracked: false,
  ignored: false,
  index: 'unmerged',
  worktree: 'unmerged',
  unmerged: 'both-modified',
}

describe('operation detection', () => {
  it('reports at-rest when no marker exists', () => {
    const state = detectOperation(markers(), [])
    expect(state).toEqual({ kind: null, step: null, message: null, conflicts: [] })
    expect(operationKindOf(markers())).toBeNull()
  })

  it('detects a merge and its conflict list', () => {
    const state = detectOperation(markers({ mergeHead: 'abc', message: 'Merge branch feature\n' }), [CONFLICT])
    expect(state.kind).toBe('merge')
    expect(state.conflicts).toEqual(['a.ts'])
    expect(state.message).toBe('Merge branch feature')
  })

  it('lets a rebase outrank a leftover cherry-pick marker', () => {
    expect(operationKindOf(markers({ rebaseMerge: true, cherryPickHead: 'abc' }))).toBe('rebase')
    expect(operationKindOf(markers({ rebaseApply: true }))).toBe('rebase')
    expect(operationKindOf(markers({ mergeHead: 'abc' }))).toBe('merge')
    expect(operationKindOf(markers({ cherryPickHead: 'abc' }))).toBe('cherry-pick')
    expect(operationKindOf(markers({ revertHead: 'abc' }))).toBe('revert')
  })

  it('reports the rebase step only while rebasing', () => {
    const rebasing = detectOperation(markers({ rebaseMerge: true, rebaseStep: { current: 2, total: 5 } }))
    expect(rebasing.step).toBe('2/5')
    const merging = detectOperation(markers({ mergeHead: 'abc', rebaseStep: { current: 2, total: 5 } }))
    expect(merging.step).toBeNull()
  })

  it('ignores an empty or unusable step', () => {
    expect(detectOperation(markers({ rebaseMerge: true, rebaseStep: { current: 0, total: 0 } })).step).toBeNull()
    expect(detectOperation(markers({ rebaseMerge: true })).step).toBeNull()
  })

  it('normalizes an empty message to null', () => {
    expect(detectOperation(markers({ mergeHead: 'a', message: '   ' })).message).toBeNull()
    expect(detectOperation(markers({ mergeHead: 'a', message: null })).message).toBeNull()
  })

  it('names the continue and abort commands', () => {
    expect(continueCommand('merge')).toBe('commit')
    expect(continueCommand('rebase')).toBe('rebase --continue')
    expect(continueCommand('cherry-pick')).toBe('cherry-pick --continue')
    expect(continueCommand('revert')).toBe('revert --continue')
    expect(continueCommand('am')).toBe('am --continue')
    expect(continueCommand(null)).toBeNull()
    expect(abortCommand('merge')).toBe('merge --abort')
    expect(abortCommand('rebase')).toBe('rebase --abort')
    expect(abortCommand('cherry-pick')).toBe('cherry-pick --abort')
    expect(abortCommand('revert')).toBe('revert --abort')
    expect(abortCommand('am')).toBe('am --abort')
    expect(abortCommand(null)).toBeNull()
    expect(blocksCheckout('merge')).toBe(true)
    expect(blocksCheckout(null)).toBe(false)
  })
})

describe('git version gating', () => {
  it('parses the shapes git actually prints', () => {
    expect(parseGitVersion('git version 2.39.3')).toEqual({ major: 2, minor: 39, patch: 3, rest: '' })
    expect(parseGitVersion('git version 2.39.3 (Apple Git-142)')?.rest).toBe('(Apple Git-142)')
    expect(parseGitVersion('git version 2.39.3.windows.1')?.major).toBe(2)
    expect(parseGitVersion('git version 2.39')).toEqual({ major: 2, minor: 39, patch: 0, rest: '' })
    expect(parseGitVersion('nonsense')).toBeNull()
  })

  it('compares versions numerically', () => {
    const a = parseGitVersion('2.31.0')!
    const b = parseGitVersion('2.9.0')!
    expect(compareVersions(a, b)).toBeGreaterThan(0)
    expect(compareVersions(b, a)).toBeLessThan(0)
    expect(compareVersions(a, parseGitVersion('2.31.0')!)).toBe(0)
  })

  it('enforces the minimum version and the merge-tree feature floor', () => {
    expect(meetsVersion(parseGitVersion('2.31.0'), MIN_GIT_VERSION)).toBe(true)
    expect(meetsVersion(parseGitVersion('2.30.9'), MIN_GIT_VERSION)).toBe(false)
    expect(meetsVersion(null, MIN_GIT_VERSION)).toBe(false)
    expect(supportsMergeTree(parseGitVersion('2.38.0'))).toBe(true)
    expect(supportsMergeTree(parseGitVersion('2.37.0'))).toBe(false)
    expect(supportsMergeTree(null)).toBe(false)
  })

  it('builds the too-old failure', () => {
    const failure = tooOldFailure(parseGitVersion('2.20.1')!)
    expect(failure.code).toBe('git-too-old')
    expect(failure.detail).toBe('git 2.20.1')
  })
})

describe('failure classification', () => {
  it('names an unavailable git', () => {
    expect(classifyGitFailure({ code: 127, stdout: '', stderr: '', spawnFailed: true })).toMatchObject({
      code: 'git-unavailable',
    })
    expect(classifyGitFailure({ code: 127, stdout: '', stderr: '' }).code).toBe('git-unavailable')
  })

  it('names a timeout from a killed process', () => {
    expect(classifyGitFailure({ code: 1, stdout: '', stderr: '', killed: true }).code).toBe('timeout')
  })

  it.each([
    ['not a git repository', 'fatal: not a git repository (or any of the parent directories): .git', 'not-a-repository'],
    ['bare', 'fatal: this operation must be run in a work tree', 'bare-repository'],
    ['permission', 'error: unable to create file: Permission denied', 'permission-denied'],
    ['lock', "fatal: Unable to create '/repo/.git/index.lock': File exists.", 'index-locked'],
    ['another process', 'Another git process seems to be running in this repository', 'index-locked'],
    ['identity', 'Author identity unknown\n*** Please tell me who you are.', 'identity-missing'],
    ['nothing', 'nothing to commit, working tree clean', 'nothing-to-commit'],
    ['unmerged', 'error: The branch feature is not fully merged.', 'not-merged'],
    ['dirty', 'error: Your local changes to the following files would be overwritten by checkout', 'dirty-tree'],
    ['path', "error: pathspec 'nope' did not match any file(s) known to git", 'path-missing'],
    ['hook', 'husky - pre-commit hook exited with code 1', 'hook-failed'],
    ['operation', 'error: Merging is not possible because you have unmerged files.', 'operation-in-progress'],
  ])('classifies %s', (_name, stderr, expected) => {
    expect(classifyGitFailure({ code: 1, stdout: '', stderr }).code).toBe(expected)
  })

  it('falls back to git-failed and keeps the exit code', () => {
    expect(classifyGitFailure({ code: 3, stdout: '', stderr: 'weird failure' })).toEqual({
      code: 'git-failed',
      detail: 'weird failure',
      exitCode: 3,
    })
    expect(classifyGitFailure({ code: 1, stdout: 'out only', stderr: '' }).detail).toBe('out only')
  })

  it('clips long output and treats blank output as empty', () => {
    expect(clipOutput('   ')).toBe('')
    const long = 'x'.repeat(5000)
    expect(clipOutput(long).length).toBe(4000)
    expect(clipOutput('a'.repeat(10), 5)).toBe('aaaaa')
  })

  it('builds degraded states only for terminal failures', () => {
    const installed = parseGitVersion('2.1.0')
    expect(installed).not.toBeNull()
    const tooOld = degradedFrom(tooOldFailure(installed!), {
      installed: '2.1.0',
      required: MIN_GIT_VERSION,
    })
    expect(tooOld).toMatchObject({
      code: 'git-too-old',
      requiredVersion: MIN_GIT_VERSION,
      installedVersion: '2.1.0',
    })
    expect(degradedFrom({ code: 'not-a-repository', detail: '/tmp' })?.code).toBe('not-a-repository')
    expect(degradedFrom({ code: 'dirty-tree', detail: '' })).toBeNull()
    expect(isDegradedCode('permission-denied')).toBe(true)
    expect(isDegradedCode('dirty-tree')).toBe(false)
  })
})

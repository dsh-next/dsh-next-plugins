import { describe, expect, it } from 'vitest'
import type { GitFailureCode, PreflightDecision } from '../src/core/types.ts'
import { en, englishTranslate, type MessageKey } from '../src/client/dictionaries.ts'
import {
  confirmationFromPreflight,
  degradedFix,
  degradedTitle,
  failureFix,
  failureTitleKey,
} from '../src/client/panel/failure-copy.ts'
import { baseName } from '../src/client/ui/path-label.ts'

const titleKeys = {
  'git-unavailable': 'failure.gitUnavailable',
  'git-too-old': 'failure.gitTooOld',
  'not-a-repository': 'failure.notARepository',
  'session-not-ready': 'failure.sessionNotReady',
  'host-outdated': 'failure.hostOutdated',
  'bare-repository': 'failure.bareRepository',
  'permission-denied': 'failure.permissionDenied',
  'identity-missing': 'failure.identityMissing',
  'index-locked': 'failure.indexLocked',
  'operation-in-progress': 'failure.operationInProgress',
  'dirty-tree': 'failure.dirtyTree',
  'not-merged': 'failure.notMerged',
  'detached-head': 'failure.detachedHead',
  'current-branch': 'failure.currentBranch',
  'worktree-primary': 'failure.worktreePrimary',
  'worktree-current': 'failure.worktreeCurrent',
  'branch-exists': 'failure.branchExists',
  'worktree-exists': 'failure.worktreeExists',
  'invalid-name': 'failure.invalidName',
  'setup-stale': 'failure.setupStale',
  'no-upstream': 'failure.noUpstream',
  'nothing-to-commit': 'failure.nothingToCommit',
  'path-missing': 'failure.pathMissing',
  'hook-failed': 'failure.hookFailed',
  'hook-cancelled': 'failure.hookCancelled',
  cancelled: 'failure.cancelled',
  timeout: 'failure.timeout',
  'git-failed': 'failure.gitFailed',
} satisfies Record<GitFailureCode, MessageKey>

const specificFixes = {
  'index-locked': 'failure.fix.indexLocked',
  'operation-in-progress': 'failure.fix.operationInProgress',
  'dirty-tree': 'failure.fix.dirtyTree',
  'session-not-ready': 'failure.fix.sessionNotReady',
  'host-outdated': 'failure.fix.hostOutdated',
  'not-merged': 'failure.fix.notMerged',
  'detached-head': 'failure.fix.detachedHead',
  'identity-missing': 'failure.fix.identityMissing',
  'no-upstream': 'failure.fix.noUpstream',
  'path-missing': 'failure.fix.pathMissing',
  'worktree-primary': 'failure.fix.worktreePrimary',
  'worktree-current': 'failure.fix.worktreeCurrent',
  'setup-stale': 'failure.fix.setupStale',
  'git-failed': 'failure.fix.gitFailed',
} satisfies Partial<Record<GitFailureCode, MessageKey>>

describe('panel message helpers', () => {
  it('maps every host failure code to its dictionary title and fix', () => {
    for (const [code, title] of Object.entries(titleKeys) as [GitFailureCode, MessageKey][]) {
      expect(failureTitleKey(code)).toBe(title)
      expect(failureFix(code, englishTranslate)).toBe(en[specificFixes[code as keyof typeof specificFixes] ?? 'failure.fix.gitFailed'])
    }
  })

  it('names degraded states, version details, and the unknown-code fallback', () => {
    const labels = {
      'git-unavailable': ['state.noGit', 'state.noGitFix'],
      'not-a-repository': ['state.noRepository', 'state.noRepositoryFix'],
      'bare-repository': ['state.bare', 'state.bareFix'],
      'permission-denied': ['state.permission', 'state.permissionFix'],
    } as const
    for (const [code, [title, fix]] of Object.entries(labels)) {
      expect(degradedTitle(code, { installedVersion: null }, englishTranslate)).toBe(en[title])
      expect(degradedFix(code, { requiredVersion: null }, englishTranslate)).toBe(en[fix])
    }
    expect(degradedTitle('git-too-old', { installedVersion: '2.1' }, englishTranslate)).toBe(
      englishTranslate('state.tooOld', { installed: '2.1' }),
    )
    expect(degradedTitle('git-too-old', { installedVersion: null }, englishTranslate)).toBe(
      englishTranslate('state.tooOld', { installed: '?' }),
    )
    expect(degradedFix('git-too-old', { requiredVersion: '2.3' }, englishTranslate)).toBe(
      englishTranslate('state.tooOldFix', { required: '2.3' }),
    )
    expect(degradedFix('git-too-old', { requiredVersion: null }, englishTranslate)).toBe(
      englishTranslate('state.tooOldFix', { required: '' }),
    )
    expect(degradedTitle('unknown', { installedVersion: null }, englishTranslate)).toBe(en['state.noRepository'])
    expect(degradedFix('unknown', { requiredVersion: null }, englishTranslate)).toBe(en['state.noRepositoryFix'])
  })

  it('creates confirmations for both refusal verdicts and none for allow', () => {
    expect(confirmationFromPreflight({ verdict: 'allow' }, englishTranslate)).toBeNull()
    for (const verdict of ['confirm', 'block'] as const) {
      const decision: PreflightDecision = { verdict, code: 'dirty-tree', paths: ['one.ts'], detail: 'keep changes' }
      expect(confirmationFromPreflight(decision, englishTranslate)).toEqual({
        title: en['failure.dirtyTree'],
        body: 'keep changes',
      })
    }
  })
})

describe('file labels', () => {
  it.each([
    ['a/b.ts', 'b.ts'],
    ['b.ts', 'b.ts'],
    ['/repo/file.ts', 'file.ts'],
    ['a/', ''],
    ['', ''],
  ])('shows the last segment of %j', (path, label) => {
    expect(baseName(path)).toBe(label)
  })
})

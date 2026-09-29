import type { GitFailureCode, PreflightDecision } from '../../core/types.ts'
import type { MessageKey, Translate } from '../dictionaries.ts'

/** The dictionary key naming a failure code. */
export function failureTitleKey(code: GitFailureCode): MessageKey {
  const map: Record<GitFailureCode, MessageKey> = {
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
  }
  return map[code]
}

/** The fix key for a failure code, when one exists. */
export function failureFix(code: GitFailureCode, t: Translate): string {
  const fixes: Partial<Record<GitFailureCode, MessageKey>> = {
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
  }
  const key = fixes[code]
  return key === undefined ? t('failure.fix.gitFailed') : t(key)
}

export function degradedTitle(
  code: string,
  degraded: { installedVersion: string | null },
  t: Translate,
): string {
  if (code === 'git-too-old') {
    return t('state.tooOld', { installed: degraded.installedVersion ?? '?' })
  }
  const map: Record<string, MessageKey> = {
    'git-unavailable': 'state.noGit',
    'not-a-repository': 'state.noRepository',
    'bare-repository': 'state.bare',
    'permission-denied': 'state.permission',
  }
  return t(map[code] ?? 'state.noRepository')
}

export function degradedFix(
  code: string,
  degraded: { requiredVersion: string | null },
  t: Translate,
): string {
  const map: Record<string, MessageKey> = {
    'git-unavailable': 'state.noGitFix',
    'git-too-old': 'state.tooOldFix',
    'not-a-repository': 'state.noRepositoryFix',
    'bare-repository': 'state.bareFix',
    'permission-denied': 'state.permissionFix',
  }
  const key = map[code] ?? 'state.noRepositoryFix'
  return t(key, { required: degraded.requiredVersion ?? '' })
}

/** Build a confirmation for a preflight verdict the host refused. */
export function confirmationFromPreflight(
  decision: PreflightDecision,
  t: Translate,
): { readonly title: string; readonly body: string } | null {
  if (decision.verdict === 'allow') return null
  return { title: t(failureTitleKey(decision.code)), body: decision.detail }
}

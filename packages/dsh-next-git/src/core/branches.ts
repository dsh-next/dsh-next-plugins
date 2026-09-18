/**
 * Branch listing and name validation.
 *
 * The panel's branch picker needs the local branches, which one is checked
 * out, and whether a remote-tracking branch can be checked out locally. Name
 * validation mirrors `git check-ref-format`'s core rules so the UI can refuse
 * a bad name before a process is spawned.
 */

import type { BranchInfo } from './types.ts'

/** Field separator in the `for-each-ref` format. */
export const BRANCH_FIELD = '\u001f'

/** The `--format` the host passes to `git for-each-ref`. */
export const BRANCH_FORMAT = `%(HEAD)${BRANCH_FIELD}%(refname:short)${BRANCH_FIELD}%(objectname)${BRANCH_FIELD}%(upstream:short)${BRANCH_FIELD}%(refname)`

/**
 * Parse `git for-each-ref refs/heads refs/remotes`.
 *
 * Local branches and remote-tracking branches are returned in one list, each
 * flagged; the caller decides how to present them.
 *
 * @param raw - process stdout.
 * @returns branch rows, local branches first in git's order.
 */
export function parseBranches(raw: string): BranchInfo[] {
  const locals: BranchInfo[] = []
  const remotes: BranchInfo[] = []
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue
    const fields = line.split(BRANCH_FIELD)
    if (fields.length < 5) continue
    const marker = (fields[0] ?? '').trim()
    const name = fields[1] ?? ''
    const oid = fields[2] ?? ''
    const upstream = (fields[3] ?? '').trim()
    const full = fields[4] ?? ''
    if (name === '' || oid === '') continue
    const isRemote = full.startsWith('refs/remotes/')
    const row: BranchInfo = {
      name,
      current: !isRemote && marker === '*',
      oid,
      upstream: upstream === '' ? null : upstream,
      remote: isRemote,
    }
    if (isRemote) remotes.push(row)
    else locals.push(row)
  }
  return [...locals, ...remotes]
}

/** Why a branch name was refused. */
export type BranchNameIssue =
  | 'empty'
  | 'separator'
  | 'reserved'
  | 'invalid-character'
  | 'trailing-dot'
  | 'leading-dash'
  | 'consecutive-dots'
  | 'existing'

/**
 * Validate a local branch name.
 *
 * @param input - the raw name.
 * @returns null when valid, else the issue to show.
 */
export function validateBranchName(input: string): BranchNameIssue | null {
  const name = input.trim()
  if (name === '') return 'empty'
  if (name === 'HEAD' || name === '@' || name.startsWith('refs/')) return 'reserved'
  if (name.startsWith('-')) return 'leading-dash'
  if (name.endsWith('.') || name.endsWith('/')) return 'trailing-dot'
  if (name.includes('..')) return 'consecutive-dots'
  if (name.includes('@{')) return 'invalid-character'
  // git's forbidden set: space, ~ ^ : ? * [ \ and control characters.
  if (/[\s~^:?*[\\\u0000-\u001f\u007f]/.test(name)) return 'invalid-character'
  if (name.split('/').some((part) => part === '' || part === '.' || part.startsWith('.'))) return 'separator'
  return null
}

/** Whether a branch name is usable as a local branch. */
export function isValidBranchName(input: string): boolean {
  return validateBranchName(input) === null
}

/**
 * The local branch name a remote-tracking branch would be checked out as.
 *
 * `origin/feature/x` -> `feature/x`; a name that is already local passes
 * through unchanged.
 *
 * @param remoteName - the remote-tracking short name.
 * @param remotes - the configured remote names, longest match first.
 * @returns the local name to create.
 */
export function localNameForRemote(remoteName: string, remotes: readonly string[] = ['origin']): string {
  const ordered = [...remotes].sort((a, b) => b.length - a.length)
  for (const remote of ordered) {
    if (remoteName.startsWith(`${remote}/`)) return remoteName.slice(remote.length + 1)
  }
  return remoteName
}

/** Find one branch by exact name. */
export function findBranch(branches: readonly BranchInfo[], name: string): BranchInfo | undefined {
  return branches.find((branch) => branch.name === name)
}

/** Local branch names only, the switch/delete candidates. */
export function localBranches(branches: readonly BranchInfo[]): BranchInfo[] {
  return branches.filter((branch) => !branch.remote)
}

/** Remote-tracking branches that have no same-named local branch yet. */
export function checkoutCandidates(branches: readonly BranchInfo[]): BranchInfo[] {
  const locals = new Set(branches.filter((branch) => !branch.remote).map((branch) => branch.name))
  const seen = new Set<string>()
  const candidates: BranchInfo[] = []
  for (const branch of branches) {
    if (!branch.remote) continue
    const local = localNameForRemote(branch.name)
    if (local === branch.name || locals.has(local) || seen.has(local)) continue
    seen.add(local)
    candidates.push({ ...branch, name: local })
  }
  return candidates
}

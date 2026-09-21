/**
 * Branch and tag listing, and branch name validation.
 *
 * The panel's ref picker needs more than a name per row: which branch is
 * checked out, how far it has drifted from its upstream, and the tip commit's
 * author, hash, subject and age — the detail line VS Code's branch quick pick
 * shows. All of it comes from one `for-each-ref` call, so the read stays a
 * single process. Name validation mirrors `git check-ref-format`'s core rules
 * so the UI can refuse a bad name before a process is spawned.
 */

import type { BranchInfo, TagInfo } from './types.ts'

/** Field separator in the `for-each-ref` format. */
export const BRANCH_FIELD = '\u001f'

/**
 * The `--format` the host passes to `git for-each-ref` for branches.
 *
 * `%(subject)` sits last: a subject that happens to contain the separator
 * still parses, because everything after the tracking field is the subject.
 */
export const BRANCH_FORMAT = [
  '%(HEAD)',
  '%(refname:short)',
  '%(objectname)',
  '%(upstream:short)',
  '%(refname)',
  '%(authorname)',
  '%(committerdate:unix)',
  '%(upstream:track)',
  '%(subject)',
].join(BRANCH_FIELD)

/**
 * The `--format` the host passes to `git for-each-ref refs/tags`.
 *
 * `%(*objectname)` is an annotated tag's peeled commit, which is what a
 * detached checkout has to name; `%(objectname)` is that tag object itself.
 */
export const TAG_FORMAT = [
  '%(refname:short)',
  '%(objectname)',
  '%(*objectname)',
  '%(authorname)',
  '%(committerdate:unix)',
  '%(subject)',
].join(BRANCH_FIELD)

/** Longest subject kept per row: the picker ellipsizes, the envelope stays bounded. */
export const REF_SUBJECT_LIMIT = 200

/** How far a branch has drifted from its upstream. */
export interface RefTrack {
  readonly ahead: number
  readonly behind: number
}

/**
 * Parse `%(upstream:track)` (`[ahead 1, behind 2]`, `[gone]`, or empty).
 *
 * @param raw - the atom's output.
 * @returns the counts; both zero when there is no upstream or it is gone.
 */
export function parseTrack(raw: string): RefTrack {
  const ahead = /ahead (\d+)/.exec(raw)
  const behind = /behind (\d+)/.exec(raw)
  return { ahead: ahead === null ? 0 : Number(ahead[1]), behind: behind === null ? 0 : Number(behind[1]) }
}

/** Bound one subject so a hostile commit message cannot inflate the envelope. */
function boundSubject(raw: string): string {
  const text = raw.trim()
  return text.length > REF_SUBJECT_LIMIT ? text.slice(0, REF_SUBJECT_LIMIT) : text
}

/** Epoch seconds from a `committerdate:unix` atom, 0 when absent or unusable. */
function epochSeconds(raw: string): number {
  const value = Number(raw.trim())
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

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
    const track = parseTrack(fields[7] ?? '')
    const row: BranchInfo = {
      name,
      current: !isRemote && marker === '*',
      oid,
      upstream: upstream === '' ? null : upstream,
      remote: isRemote,
      author: fields[5] ?? '',
      committedAt: epochSeconds(fields[6] ?? ''),
      ahead: track.ahead,
      behind: track.behind,
      subject: boundSubject(fields.slice(8).join(BRANCH_FIELD)),
    }
    if (isRemote) remotes.push(row)
    else locals.push(row)
  }
  return [...locals, ...remotes]
}

/**
 * Parse `git for-each-ref refs/tags`.
 *
 * @param raw - process stdout.
 * @returns tag rows in git's order, annotated tags peeled to their commit.
 */
export function parseTags(raw: string): TagInfo[] {
  const tags: TagInfo[] = []
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue
    const fields = line.split(BRANCH_FIELD)
    if (fields.length < 5) continue
    const name = fields[0] ?? ''
    const peeled = (fields[2] ?? '').trim()
    const oid = peeled === '' ? fields[1] ?? '' : peeled
    if (name === '' || oid === '') continue
    tags.push({
      name,
      oid,
      author: fields[3] ?? '',
      committedAt: epochSeconds(fields[4] ?? ''),
      subject: boundSubject(fields.slice(5).join(BRANCH_FIELD)),
    })
  }
  return tags
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

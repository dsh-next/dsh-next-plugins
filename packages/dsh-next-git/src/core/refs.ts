/**
 * The ref picker's data model.
 *
 * One vocabulary for "a branch, a remote-tracking branch or a tag you can
 * pick": the checkout picker, the worktree start-point picker and the
 * create-branch-from picker all render these rows, so a row's detail (tip
 * author, hash, subject, age, drift) is built once. Grouping and the filter
 * arm are pure, which is what makes the picker's ordering testable without a
 * repository or a DOM.
 */

import { localNameForRemote } from './branches.ts'
import type { BranchInfo, TagInfo } from './types.ts'

/** Which namespace a pickable ref lives in. */
export type RefKind = 'branch' | 'remote' | 'tag'

/** One pickable ref, ready for the picker's two-line row. */
export interface RefOption {
  /** Stable row id, unique across kinds: `<kind>:<name>`. */
  readonly id: string
  readonly kind: RefKind
  /** Name the row shows (`main`, `origin/main`, `v1.2.0`). */
  readonly name: string
  /**
   * The local branch this ref resolves to: itself for a local branch or tag,
   * and the name a remote-tracking checkout would create (`origin/x` -> `x`).
   */
  readonly localName: string
  /** Tip commit id, used for a detached checkout. */
  readonly oid: string
  readonly author: string
  /** Epoch seconds; 0 when git reported none. */
  readonly committedAt: number
  /** Commits ahead of the upstream; 0 for tags and branches without one. */
  readonly ahead: number
  /** Commits behind the upstream; 0 for tags and branches without one. */
  readonly behind: number
  readonly current: boolean
  readonly upstream: string | null
  readonly subject: string
}

/** One labeled section of the picker. */
export interface RefGroup {
  readonly kind: RefKind
  readonly refs: readonly RefOption[]
}

/** Section order: local branches, then remote-tracking branches, then tags. */
export const REF_KINDS: readonly RefKind[] = ['branch', 'remote', 'tag']

/**
 * The pickable rows for the branch list, in git's order.
 *
 * A remote-tracking row is marked current when the local branch it would
 * check out is the checked-out one: picking `origin/main` while `main` is
 * active means "you are already there", not "create `main` again".
 */
export function branchOptions(branches: readonly BranchInfo[], remotes: readonly string[] = ['origin']): RefOption[] {
  const active = branches.find((branch) => branch.current && !branch.remote)?.name
  return branches.map((branch) => {
    const localName = branch.remote ? localNameForRemote(branch.name, remotes) : branch.name
    return {
      id: `${branch.remote ? 'remote' : 'branch'}:${branch.name}`,
      kind: branch.remote ? 'remote' : 'branch',
      name: branch.name,
      localName,
      oid: branch.oid,
      author: branch.author,
      committedAt: branch.committedAt,
      ahead: branch.ahead,
      behind: branch.behind,
      current: branch.remote ? localName === active : branch.current,
      upstream: branch.upstream,
      subject: branch.subject,
    }
  })
}

/** The pickable rows for the tag list, in git's order. */
export function tagOptions(tags: readonly TagInfo[]): RefOption[] {
  return tags.map((tag) => ({
    id: `tag:${tag.name}`,
    kind: 'tag',
    name: tag.name,
    localName: tag.name,
    oid: tag.oid,
    author: tag.author,
    committedAt: tag.committedAt,
    ahead: 0,
    behind: 0,
    current: false,
    upstream: null,
    subject: tag.subject,
  }))
}

/** Every pickable ref, in section order. */
export function refOptions(branches: readonly BranchInfo[], tags: readonly TagInfo[], remotes: readonly string[] = ['origin']): RefOption[] {
  return [...branchOptions(branches, remotes), ...tagOptions(tags)]
}

/**
 * Split rows into the picker's sections, dropping empty ones.
 *
 * @param options - rows already in source order.
 * @returns sections in {@link REF_KINDS} order.
 */
export function partitionRefs(options: readonly RefOption[]): RefGroup[] {
  const groups: RefGroup[] = []
  for (const kind of REF_KINDS) {
    const refs = options.filter((option) => option.kind === kind)
    if (refs.length > 0) groups.push({ kind, refs })
  }
  return groups
}

/** Whether `query`'s characters appear in `text` in order, case-insensitively. */
function subsequence(text: string, query: string): boolean {
  let at = 0
  for (const character of text) {
    if (character === query[at]) at += 1
    if (at === query.length) return true
  }
  return at === query.length
}

/**
 * Rank one row against the filter text.
 *
 * Name hits always outrank subject hits, so typing a branch name never buries
 * it under branches whose commit message happens to contain the same text.
 *
 * @returns the score (lower is better), or null when the row does not match.
 */
function matchScore(option: RefOption, query: string): number | null {
  const name = option.name.toLowerCase()
  if (name.startsWith(query)) return 0
  if (name.includes(query)) return 1
  if (subsequence(name, query)) return 2
  if (option.subject.toLowerCase().includes(query)) return 3
  if (option.author.toLowerCase().includes(query)) return 4
  if (option.oid.toLowerCase().startsWith(query)) return 5
  return null
}

/**
 * The rows a filter query keeps, best match first.
 *
 * @param options - rows in source order.
 * @param rawQuery - what the user typed; blank keeps the source order.
 * @returns matching rows; the input array itself for a blank query.
 */
export function filterRefs(options: readonly RefOption[], rawQuery: string): readonly RefOption[] {
  const query = rawQuery.trim().toLowerCase()
  if (query === '') return options
  const scored: { option: RefOption; score: number; index: number }[] = []
  options.forEach((option, index) => {
    const score = matchScore(option, query)
    if (score !== null) scored.push({ option, score, index })
  })
  scored.sort((a, b) => a.score - b.score || a.index - b.index)
  return scored.map((entry) => entry.option)
}

/** Whether a local branch of this exact name is already in the rows. */
export function hasLocalBranch(options: readonly RefOption[], name: string): boolean {
  return options.some((option) => option.kind === 'branch' && option.name === name)
}

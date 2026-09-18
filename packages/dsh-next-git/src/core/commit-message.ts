/**
 * The deterministic commit-message draft.
 *
 * "Draft commit message" exists twice in this plugin, on purpose:
 *
 * - here, synchronously, from the change list alone — the Draft button always
 *   works with no model, no network and no session;
 * - the agent verb (`agent-verbs.ts`), which hands the same payload to the
 *   session so the agent can do better.
 *
 * The draft is intentionally plain: it names what changed, grouped by
 * directory when every path shares one, and stays inside Conventional Commit
 * subject length. It never invents a scope the user did not type.
 */

import type { ChangeSummary } from './types.ts'

/** Longest subject the draft produces. */
export const DRAFT_MAX_LENGTH = 72

/** How many paths a subject lists before it switches to a count. */
const DRAFT_PATH_LIMIT = 3

/** The shape of the change, used to pick the verb. */
export type DraftShape = 'add' | 'remove' | 'update' | 'mixed'

/**
 * Classify the change list.
 *
 * @param summary - the grouped working tree.
 * @returns which verb the draft should use.
 */
export function draftShape(summary: ChangeSummary): DraftShape {
  const kinds = new Set<string>()
  for (const entry of summary.staged) {
    if (entry.index !== undefined) kinds.add(entry.index)
  }
  for (const entry of summary.untracked) kinds.add('untracked')
  if (kinds.size === 0) return 'update'
  if (kinds.size > 1) return 'mixed'
  const only = [...kinds][0]!
  if (only === 'added' || only === 'untracked') return 'add'
  if (only === 'deleted') return 'remove'
  return 'update'
}

/** All paths the commit would include: staged first, then untracked. */
export function draftPaths(summary: ChangeSummary): string[] {
  const paths: string[] = []
  for (const entry of summary.staged) if (!paths.includes(entry.path)) paths.push(entry.path)
  for (const entry of summary.untracked) if (!paths.includes(entry.path)) paths.push(entry.path)
  return paths
}

/**
 * The shared directory of every path, or null when they do not share one.
 *
 * @param paths - repository-relative paths.
 * @returns the single common parent directory, or null.
 */
export function commonDirectory(paths: readonly string[]): string | null {
  if (paths.length === 0) return null
  const dirs = paths.map((path) => {
    const at = path.lastIndexOf('/')
    return at < 0 ? '' : path.slice(0, at)
  })
  const first = dirs[0]!
  return dirs.every((dir) => dir === first) ? first : null
}

/**
 * Draft a commit subject.
 *
 * @param summary - the grouped working tree.
 * @returns a one-line subject; empty when there is nothing to commit.
 */
export function draftCommitMessage(summary: ChangeSummary): string {
  const paths = draftPaths(summary)
  if (paths.length === 0) return ''
  const shape = draftShape(summary)
  const verb = shape === 'add' ? 'Add' : shape === 'remove' ? 'Remove' : shape === 'mixed' ? 'Update' : 'Update'
  const directory = commonDirectory(paths)
  const scope = directory === null || directory === '' ? null : directory

  const listed = paths.length <= DRAFT_PATH_LIMIT
    ? paths.map((path) => basename(path)).join(', ')
    : `${paths.length} files`

  const head = scope === null ? `${verb} ${listed}` : `${verb} ${scope}: ${listed}`
  return head.length <= DRAFT_MAX_LENGTH ? head : `${head.slice(0, DRAFT_MAX_LENGTH - 3)}...`
}

/** The final path segment. */
export function basename(path: string): string {
  const posix = path.replace(/\\/g, '/')
  const at = posix.lastIndexOf('/')
  return at < 0 ? posix : posix.slice(at + 1)
}

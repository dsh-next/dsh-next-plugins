/**
 * Pure placement derivation — repo geometry from git's own answers.
 *
 * Locked rules (docs/ideas/dsh-next-worktrees.md):
 * - The primary root is the working tree that owns `git-common-dir`;
 *   worktrees never nest inside another worktree.
 * - Worktree path is `<primary>/.dsh/worktrees/<slug>`.
 * - The session cwd preserves the workspace's relative path from the repo
 *   root (`repo/packages/foo` -> `<worktree>/packages/foo`).
 */
export interface RepoPlacement {
  /** Absolute main-working-tree root (owner of git-common-dir). */
  readonly primary: string
  /** The invoking cwd rebased onto the primary root ('' at the root). */
  readonly relPath: string
  /** Absolute directory that holds every plugin worktree for this repo. */
  readonly worktreesRoot: string
  /**
   * The invoking cwd sits inside the plugin worktrees root. Fine for bind
   * and status (sessions live there); create refuses it (never nest).
   */
  readonly insideWorktreesRoot: boolean
}

/** Placement failure codes surfaced through preflight. */
export type PlacementIssue =
  | 'not-a-repository'
  | 'bare-or-unknown-layout'

export interface PlacementInput {
  /** Absolute invoking directory. */
  readonly cwd: string
  /**
   * Absolute `git rev-parse --git-common-dir` for cwd, when git answered
   * one. Undefined means the invocation was not inside a work tree.
   */
  readonly gitCommonDir: string | undefined
}

/** Normalize separators so tests can pass POSIX-style fake paths anywhere. */
function toPosix(path: string): string {
  return path.split('\\').join('/')
}

/**
 * Derive the placement, or the reason it is impossible.
 *
 * @param input - cwd plus git's common-dir answer.
 * @returns placement on success, or a machine code the UI can act on.
 */
export function computePlacement(
  input: PlacementInput,
): RepoPlacement | PlacementIssue {
  const cwd = toPosix(input.cwd)
  if (input.gitCommonDir === undefined) return 'not-a-repository'
  const commonDir = toPosix(input.gitCommonDir)
  // A linked worktree's common dir is `<primary>/.git`; the primary itself
  // answers the same. Anything else (bare repo, gitfile oddities) is a layout
  // this plugin refuses to guess at.
  if (!commonDir.endsWith('/.git')) return 'bare-or-unknown-layout'
  const primary = commonDir.slice(0, -'/.git'.length)
  if (primary === '') return 'bare-or-unknown-layout'
  const worktreesRoot = `${primary}/.dsh/worktrees`
  const relPath = cwd.startsWith(`${primary}/`) ? cwd.slice(primary.length + 1) : ''
  const insideWorktreesRoot = relPath.startsWith('.dsh/worktrees/') || cwd === worktreesRoot
  return { primary, relPath, worktreesRoot, insideWorktreesRoot }
}

/**
 * Worktree placement math — pure logic over git path facts.
 *
 * Rules (docs/ideas/dsh-next-worktrees.md):
 * - Worktrees live under `<primary>/.dsh/worktrees/<slug>`, where primary is
 *   the working tree that owns the git common dir — never nested inside
 *   another worktree.
 * - A session's relative path below the repo is preserved into the worktree
 *   (`repo/packages/foo` -> `<worktree>/packages/foo`).
 */

/** Default directory (below the primary) that holds plugin worktrees. */
export const DEFAULT_WORKTREE_DIR = '.dsh/worktrees'

/**
 * Placement facts derived from two git outputs:
 * @param toplevel - `git rev-parse --show-toplevel` (absolute, resolved)
 * @param gitCommonDir - `git rev-parse --path-format=absolute --git-common-dir`
 */
export interface RepoPlacement {
  /** The main working tree that owns the common `.git` directory. */
  readonly primaryRoot: string
  /** True when `toplevel` is itself a linked worktree, not the primary. */
  readonly isLinkedWorktree: boolean
}

/**
 * Compute placement facts. The common dir of a repository is always the
 * primary's `.git` (linked worktrees report the same common dir), so the
 * primary is its parent directory. A common dir that does not end in `/.git`
 * (bare repo, unexpected layout) yields null — the caller degrades.
 */
export function computePlacement(
  toplevel: string,
  gitCommonDir: string,
): RepoPlacement | null {
  const normalized = gitCommonDir.replace(/\/+$/, '')
  if (!normalized.endsWith('/.git')) return null
  const primaryRoot = normalized.slice(0, -'/.git'.length)
  if (primaryRoot.length === 0) return null
  return {
    primaryRoot,
    isLinkedWorktree: toplevel !== primaryRoot,
  }
}

/** Absolute worktree directory for a slug under a primary. */
export function worktreePath(
  primaryRoot: string,
  slug: string,
  dir: string = DEFAULT_WORKTREE_DIR,
): string {
  return `${primaryRoot}/${dir}/${slug}`
}

/**
 * Registry file path for a primary (plugin-owned sidecar; git state is the
 * truth this file only decorates).
 */
export function registryPath(
  primaryRoot: string,
  dir: string = DEFAULT_WORKTREE_DIR,
): string {
  return `${primaryRoot}/${dir}/registry.json`
}

/**
 * The session cwd for a new isolated session: the worktree plus the
 * original cwd's relative path below the repo toplevel. When the original
 * cwd IS the toplevel, the session lands at the worktree root.
 */
export function sessionCwdFor(
  worktreeDir: string,
  toplevel: string,
  originalCwd: string,
): string | null {
  if (originalCwd === toplevel) return worktreeDir
  if (!originalCwd.startsWith(`${toplevel}/`)) return null
  const relative = originalCwd.slice(toplevel.length + 1)
  if (relative.length === 0) return worktreeDir
  return `${worktreeDir}/${relative}`
}

/** True when `.dsh` (or the whole worktree dir) is covered by a gitignore line. */
export function ignoresWorktreeDir(
  gitignoreLines: readonly string[],
  dir: string = DEFAULT_WORKTREE_DIR,
): boolean {
  const head = dir.split('/')[0]
  return gitignoreLines.some((line) => {
    const trimmed = line.trim().replace(/\/+$/, '')
    if (trimmed === '' || line.trim().startsWith('#')) return false
    return trimmed === head || trimmed === `/${head}` || trimmed === dir || trimmed === `/${dir}`
  })
}

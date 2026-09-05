/**
 * Path helpers shared by placement, the registry, and the client
 * projection/sweeper. Plugin worktrees live at
 * `<primary>/.dsh/worktrees/<slug>` (and the session cwd may sit in a
 * subdirectory of that root when the user created from a nested
 * workspace).
 */

/** Marker every plugin-created worktree workspace carries in its path. */
export const WORKTREES_MARKER = '/.dsh/worktrees/'

/** Normalize separators so Windows and POSIX paths compare equal. */
export function toPosix(path: string): string {
  return path.split('\\').join('/')
}

/** The primary + slug (+ worktree root) encoded in a workspace path. */
export interface WorktreeWorkspacePath {
  readonly primary: string
  readonly slug: string
  /** `<primary>/.dsh/worktrees/<slug>` — the git worktree root. */
  readonly root: string
}

/**
 * Parse a workspace path that sits at or under a plugin worktree.
 *
 * The session cwd for a subdirectory workspace is
 * `<primary>/.dsh/worktrees/<slug>/<relPath>`; callers that look up the
 * topology row or drive `remove` must use the slug / root, not the
 * nested cwd.
 *
 * @param path - absolute workspace path (any separator).
 * @returns the parsed identity, or undefined when the path is not ours.
 */
export function parseWorktreeWorkspacePath(path: string): WorktreeWorkspacePath | undefined {
  const posix = toPosix(path)
  const markerAt = posix.lastIndexOf(WORKTREES_MARKER)
  if (markerAt < 0) return undefined
  const primary = posix.slice(0, markerAt)
  if (primary === '') return undefined
  const rest = posix.slice(markerAt + WORKTREES_MARKER.length)
  const slug = rest.split('/').find((part) => part !== '')
  if (slug === undefined) return undefined
  return { primary, slug, root: `${primary}${WORKTREES_MARKER}${slug}` }
}

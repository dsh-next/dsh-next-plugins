/**
 * The abandoned-worktree sweeper.
 *
 * The platform replaces a never-started (blank) session when a new
 * session begins — expected sidebar behavior. But the worktree behind
 * the replaced session survives as an invisible orphan: a real checkout
 * on disk, a registry row, and an empty host workspace that the nesting
 * projection hides. This sweeper runs after every topology pull and, for
 * every worktree workspace whose sessions are ALL gone, removes the
 * worktree and deletes the workspace — the same host-truth cleanup the
 * delete modal drives.
 *
 * Safety gates:
 * - never sweeps while a create flow is in flight (the brand-new
 *   workspace legitimately has no session for a few round trips);
 * - never sweeps when the live-session set is empty (the session store
 *   has not loaded — empty knowledge must not read as "all dead");
 * - a dirty worktree refuses removal (uncommitted work is never
 *   destroyed); its workspace is kept too so it stays addressable.
 */

/** Marker every plugin-created worktree workspace carries in its path. */
const WORKTREES_MARKER = '/.dsh/worktrees/'

/** Workspace facts the sweep needs. */
export interface SweepWorkspaceLike {
  readonly workspaceId: string
  readonly path: string
  readonly sessionIds: readonly string[]
}

/** The snapshot one sweep run decides on. */
export interface SweepSnapshot {
  readonly workspaces: readonly SweepWorkspaceLike[]
  readonly liveSessionIds: ReadonlySet<string>
  /** True while the auto-named create flow is between its steps. */
  readonly creating: boolean
}

/** Host faces the sweep drives (the delete modal's own calls). */
export interface SweepDeps {
  /** rpc('remove') with force false; dirty trees reject. */
  removeWorktree(input: { cwd: string; slug: string }): Promise<void>
  /** The stock workspace delete. */
  deleteWorkspace(workspaceId: string): Promise<void>
}

let deps: SweepDeps | undefined

/** Install (or clear) the sweep faces; called by the entry. */
export function configureWorktreeSweeper(next: SweepDeps | undefined): void {
  deps = next
}

/** Whether an error is the dirty-refusal from the remove RPC. */
function isDirtyRefusal(error: unknown): boolean {
  return error instanceof Error && /dirty-remove-refused/.test(error.message)
}

/**
 * Sweep every worktree workspace with no live sessions.
 *
 * @param snapshot - raw workspace items, the live session ids, and the
 * create-flow guard.
 * @returns the slugs whose worktrees were removed (empty when nothing
 * qualified or the gates held the sweep back).
 */
export async function sweepAbandonedWorktrees(snapshot: SweepSnapshot): Promise<readonly string[]> {
  if (deps === undefined) return []
  if (snapshot.creating) return []
  if (snapshot.liveSessionIds.size === 0) return []
  const swept: string[] = []
  for (const workspace of snapshot.workspaces) {
    const markerAt = workspace.path.lastIndexOf(WORKTREES_MARKER)
    if (markerAt < 0) continue
    const live = workspace.sessionIds.filter((id) => snapshot.liveSessionIds.has(id))
    if (live.length > 0) continue
    const primary = workspace.path.slice(0, markerAt)
    const slug = workspace.path.slice(markerAt + WORKTREES_MARKER.length)
    if (slug === '' || slug.includes('/')) continue
    try {
      await deps.removeWorktree({ cwd: primary, slug })
    } catch (error) {
      if (isDirtyRefusal(error)) continue // uncommitted work: keep it all
      // unknown-slug and friends: the git side is already gone; still
      // drop the leftover workspace below.
    }
    await deps.deleteWorkspace(workspace.workspaceId).catch(() => {})
    swept.push(slug)
  }
  return swept
}

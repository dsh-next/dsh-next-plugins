/**
 * The abandoned-worktree sweeper.
 *
 * The harness drops a never-started (blank) session from the sidebar as
 * soon as the user switches away or a new session begins - expected
 * platform behavior, the session was never utilized. But the worktree
 * behind it survives as an invisible orphan: a real checkout on disk, a
 * registry row, and a hidden host workspace. The blank session record
 * itself lingers in the workspace's list (the platform may reuse it),
 * so liveness-by-store-ids is the WRONG signal; blankness is the right
 * one. This sweeper runs after every topology pull and, for every
 * worktree workspace whose sessions are ALL blank and none of them is
 * the open session, removes the worktree and deletes the workspace -
 * the same host-truth cleanup the delete modal drives.
 *
 * Safety gates:
 * - never sweeps while a create flow is in flight (the brand-new
 *   workspace legitimately holds the just-opened blank session);
 * - never touches a workspace holding the current session, however
 *   blank (the user may be about to type);
 * - never sweeps on an unloaded session store (empty knowledge must
 *   not read as "all blank");
 * - a dirty worktree refuses removal (uncommitted work is never
 *   destroyed); its workspace is kept too so it stays addressable.
 */

/** Marker every plugin-created worktree workspace carries in its path. */
const WORKTREES_MARKER = '/.dsh/worktrees/'

/** Session facts the sweep needs. */
export interface SweepSessionLike {
  readonly id: string
  /** True when the session never recorded a turn. */
  readonly blank?: boolean
}

/** Workspace facts the sweep needs. */
export interface SweepWorkspaceLike {
  readonly workspaceId: string
  readonly path: string
  readonly sessionIds: readonly string[]
}

/** The snapshot one sweep run decides on. */
export interface SweepSnapshot {
  readonly workspaces: readonly SweepWorkspaceLike[]
  readonly sessionsById: Readonly<Record<string, SweepSessionLike | undefined>>
  /** The currently open session id (never swept). */
  readonly currentSessionId: string | undefined
  /** True while the auto-named create flow is between its steps. */
  readonly creating: boolean
}

/** Host faces the sweep drives (the delete modal's own calls). */
export interface SweepDeps {
  /** rpc('remove') with force false; dirty trees reject. */
  removeWorktree(input: { cwd: string; slug: string }): Promise<void>
  /** The stock session archive. */
  archiveSession(sessionId: string): Promise<void>
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
 * Sweep every worktree workspace that holds nothing but abandoned blank
 * sessions.
 *
 * @param snapshot - raw workspace items, the session summary map, the
 * open session id, and the create-flow guard.
 * @returns the slugs whose worktrees were removed (empty when nothing
 * qualified or the gates held the sweep back).
 */
export async function sweepAbandonedWorktrees(snapshot: SweepSnapshot): Promise<readonly string[]> {
  if (deps === undefined) return []
  if (snapshot.creating) return []
  if (Object.keys(snapshot.sessionsById).length === 0) return []
  const swept: string[] = []
  for (const workspace of snapshot.workspaces) {
    const markerAt = workspace.path.lastIndexOf(WORKTREES_MARKER)
    if (markerAt < 0) continue
    const sessions = workspace.sessionIds.map((id) => snapshot.sessionsById[id])
    if (sessions.some((session) => session !== undefined && !session.blank)) continue
    if (workspace.sessionIds.includes(snapshot.currentSessionId ?? '\u0000')) continue
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
    for (const sessionId of workspace.sessionIds) {
      await deps.archiveSession(sessionId).catch(() => {})
    }
    await deps.deleteWorkspace(workspace.workspaceId).catch(() => {})
    swept.push(slug)
  }
  return swept
}

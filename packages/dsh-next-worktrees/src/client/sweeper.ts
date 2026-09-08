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
 *   destroyed); its workspace is kept too so it stays addressable;
 * - overlapping sweeps are skipped (a later topology pull retries).
 */
import { parseWorktreeWorkspacePath } from '../core/paths.ts'
import { WorktreesRpcError } from './rpc.ts'

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
let running = false

/** Install (or clear) the sweep faces; called by the entry. */
export function configureWorktreeSweeper(next: SweepDeps | undefined): void {
  deps = next
  if (next === undefined) running = false
}

/**
 * Whether an error is the dirty-refusal from the remove RPC.
 *
 * Production throws WorktreesRpcError with code `dirty-remove-refused`
 * and a human message that does NOT contain that token. Matching the
 * message alone (the previous implementation) archived the session and
 * deleted the workspace while leaving the dirty checkout on disk.
 */
export function isDirtyRefusal(error: unknown): boolean {
  return errorHasCode(error, 'dirty-remove-refused')
}

/** Host is still running `.worktrees.json`; keep the checkout. */
export function isSetupRunning(error: unknown): boolean {
  return errorHasCode(error, 'setup-running')
}

function errorHasCode(error: unknown, code: string): boolean {
  if (error instanceof WorktreesRpcError) return error.code === code
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return (error as { code: unknown }).code === code
  }
  return error instanceof Error && error.message.includes(code)
}

/** Create/setup in flight: module store or the DOM flag the modal writes. */
export function createFlowInFlight(creating: boolean): boolean {
  if (creating) return true
  if (typeof document === 'undefined') return false
  const data = document.documentElement.dataset
  return data.dshxCreating === 'true'
    || (data.dshxSettingUp !== undefined && data.dshxSettingUp !== '')
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
  if (running) return []
  if (createFlowInFlight(snapshot.creating)) return []
  if (Object.keys(snapshot.sessionsById).length === 0) return []
  running = true
  try {
    const groups = new Map<string, {
      parsed: NonNullable<ReturnType<typeof parseWorktreeWorkspacePath>>
      workspaces: SweepWorkspaceLike[]
      sessionIds: Set<string>
    }>()
    for (const workspace of snapshot.workspaces) {
      const parsed = parseWorktreeWorkspacePath(workspace.path)
      if (parsed === undefined) continue
      const group = groups.get(parsed.root) ?? { parsed, workspaces: [], sessionIds: new Set<string>() }
      group.workspaces.push(workspace)
      for (const sessionId of workspace.sessionIds) group.sessionIds.add(sessionId)
      groups.set(parsed.root, group)
    }
    const swept: string[] = []
    for (const { parsed, workspaces, sessionIds } of groups.values()) {
      // Named empty folders stay available for the cluster `+` action. A
      // checkout is eligible only when every workspace that points into it is
      // abandoned, because removal deletes the entire checkout.
      if (sessionIds.size === 0) continue
      const ids = [...sessionIds]
      const sessions = ids.map((id) => snapshot.sessionsById[id])
      if (sessions.some((session) => session !== undefined && !session.blank)) continue
      if (sessionIds.has(snapshot.currentSessionId ?? '\u0000')) continue
      try {
        await deps.removeWorktree({ cwd: parsed.primary, slug: parsed.slug })
      } catch (error) {
        if (isDirtyRefusal(error) || isSetupRunning(error)) continue
        // unknown-slug and friends: the git side is already gone; still
        // drop the leftover workspace below.
      }
      for (const sessionId of ids) {
        await deps.archiveSession(sessionId).catch(() => {})
      }
      for (const workspace of workspaces) {
        await deps.deleteWorkspace(workspace.workspaceId).catch(() => {})
      }
      swept.push(parsed.slug)
    }
    return swept
  } finally {
    running = false
  }
}

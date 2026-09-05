/**
 * Pure sidebar projection: the strategy-B nesting math.
 *
 * The Host truth stays untouched — worktree workspaces exist, own their
 * sessions, and keep their cwds. This function derives what the official
 * Browser should SEE: worktree workspace groups vanish, their sessions
 * re-parent under the repo's group, and every re-parented session carries
 * the decoration metadata the derived renderer seams turn into a branch
 * badge, an indent, and suppressed unsafe mutations (fork, drag-reorder).
 *
 * Structural, dependency-free shapes so the math tests need no SDK.
 */
import { parseWorktreeWorkspacePath, toPosix } from '../core/paths.ts'
import type { WorktreeTopology } from './rpc.ts'

/** Workspace facts the projection needs (subset of the Host snapshot). */
export interface WorkspaceItemLike {
  readonly workspaceId: string
  readonly path: string
  readonly sessionIds: readonly string[]
}

/** Session summary facts the projection needs. */
export interface SessionSummaryLike {
  readonly id: string
}

/** Decoration riding a re-parented session summary (consumed by seams). */
export interface WorktreeRowDecoration {
  readonly kind: 'dsh-next-worktrees'
  readonly slug: string
  readonly title: string
  readonly branch: string
  readonly baseRef: string
  readonly path: string
  /** The host workspace registered for this worktree (delete cleanup). */
  readonly workspaceId: string
  /** Sessions living in the worktree workspace (delete cleanup). */
  readonly sessionIds: readonly string[]
  readonly dirty: boolean
  readonly ahead: number
  readonly merged: boolean
}

export interface ProjectionInput {
  readonly workspaces: readonly WorkspaceItemLike[]
  readonly sessionsById: Readonly<Record<string, SessionSummaryLike | undefined>>
  readonly topology: WorktreeTopology
}

export interface ProjectionResult {
  /** Workspaces the Browser should list (worktree groups removed). */
  readonly workspaces: readonly WorkspaceItemLike[]
  /** Decorations by session id (empty for un-reparented sessions). */
  readonly decorations: ReadonlyMap<string, WorktreeRowDecoration>
  /** Workspace ids dropped because they are worktree workspaces. */
  readonly hiddenWorkspaceIds: ReadonlySet<string>
}

function isInside(parent: string, child: string): boolean {
  const p = toPosix(parent)
  const c = toPosix(child)
  return c === p || c.startsWith(`${p}/`)
}

function isWorktreePath(path: string): boolean {
  return parseWorktreeWorkspacePath(path) !== undefined
}

/**
 * Derive the projected sidebar state.
 *
 * Structural hiding: any workspace whose path sits under a
 * `/.dsh/worktrees/` root is a worktree workspace by construction and is
 * hidden + re-parented as soon as a repo workspace for its primary
 * exists — this must not wait for a topology answer, or freshly created
 * worktrees flash as separate workspace folders (and stay there on a
 * topology miss). The topology pull only enriches the rows: when it has
 * the matching worktree, sessions carry the full identity decoration;
 * until then they render as ordinary nested rows.
 *
 * When no repo workspace exists for the primary, the worktree group is
 * kept as an ordinary group — sessions must never vanish from the
 * sidebar.
 *
 * @param input - host workspace/session snapshots plus the topology RPC's
 * answer.
 * @returns the projected state for the wrapped Browser.
 */
export function projectWorkspaceSidebar(input: ProjectionInput): ProjectionResult {
  const { workspaces, topology } = input
  const worktreeByPath = new Map<string, WorktreeTopology['repos'][number]['worktrees'][number]>()
  for (const repo of topology.repos) {
    for (const worktree of repo.worktrees) {
      worktreeByPath.set(toPosix(worktree.path), worktree)
    }
  }

  const hidden = new Set<string>()
  const decorations = new Map<string, WorktreeRowDecoration>()
  const projected: WorkspaceItemLike[] = workspaces.map((w) => ({ ...w, sessionIds: [...w.sessionIds] }))

  projected.forEach((workspace, index) => {
    const parsed = parseWorktreeWorkspacePath(workspace.path)
    if (parsed === undefined) return
    // Merge into the first non-worktree workspace at or under the primary.
    const target = projected.findIndex((candidate, candidateIndex) =>
      candidateIndex !== index
      && !isWorktreePath(candidate.path)
      && isInside(parsed.primary, candidate.path))
    if (target < 0) return // No repo workspace: keep the group (fallback).
    // Topology keys the worktree at its git root; a subdirectory workspace
    // (created from packages/foo) lives at `<root>/<relPath>`.
    const worktree = worktreeByPath.get(parsed.root)
    for (const sessionId of workspace.sessionIds) {
      if (worktree !== undefined) {
        decorations.set(sessionId, {
          kind: 'dsh-next-worktrees',
          slug: worktree.slug,
          title: worktree.title,
          branch: worktree.branch,
          baseRef: worktree.baseRef,
          path: worktree.path,
          workspaceId: workspace.workspaceId,
          sessionIds: [...workspace.sessionIds],
          dirty: worktree.status.dirty,
          ahead: worktree.status.ahead,
          merged: worktree.status.merged,
        })
      }
      if (!projected[target]!.sessionIds.includes(sessionId)) {
        projected[target] = {
          ...projected[target]!,
          sessionIds: [...projected[target]!.sessionIds, sessionId],
        }
      }
    }
    hidden.add(workspace.workspaceId)
  })

  return {
    workspaces: projected.filter((w) => !hidden.has(w.workspaceId)),
    decorations,
    hiddenWorkspaceIds: hidden,
  }
}

/**
 * Apply decorations to session summaries: returns a new byId map where
 * re-parented sessions carry `__dshNextWorktrees` for the renderer seams.
 *
 * @param sessionsById - the store's summary map (untouched).
 * @param decorations - the projection's decorations.
 * @returns a decorated shallow copy.
 */
export function decorateSessions<S extends SessionSummaryLike>(
  sessionsById: Readonly<Record<string, S | undefined>>,
  decorations: ReadonlyMap<string, WorktreeRowDecoration>,
): Readonly<Record<string, (S & { __dshNextWorktrees?: WorktreeRowDecoration }) | undefined>> {
  if (decorations.size === 0) return sessionsById
  const byId: Record<string, (S & { __dshNextWorktrees?: WorktreeRowDecoration }) | undefined> = { ...sessionsById }
  for (const [sessionId, decoration] of decorations) {
    const summary = byId[sessionId]
    if (summary !== undefined) byId[sessionId] = { ...summary, __dshNextWorktrees: decoration }
  }
  return byId
}

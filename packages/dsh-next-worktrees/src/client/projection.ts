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

function toPosix(path: string): string {
  return path.split('\\').join('/')
}

function isInside(parent: string, child: string): boolean {
  const p = toPosix(parent)
  const c = toPosix(child)
  return c === p || c.startsWith(`${p}/`)
}

/**
 * Derive the projected sidebar state.
 *
 * Merge rule: a worktree workspace's sessions join the first workspace
 * whose path is the repo primary or inside it (deterministic in list
 * order). When no repo workspace is registered, the worktree workspace is
 * kept as an ordinary group — sessions must never vanish from the sidebar.
 *
 * @param input - host workspace/session snapshots plus the topology RPC's
 * answer.
 * @returns the projected state for the wrapped Browser.
 */
export function projectWorkspaceSidebar(input: ProjectionInput): ProjectionResult {
  const { workspaces, topology } = input
  const worktreeByPath = new Map<string, WorktreeTopology['repos'][number]['worktrees'][number]>()
  const repoByPath = new Map<string, WorktreeTopology['repos'][number]>()
  for (const repo of topology.repos) {
    repoByPath.set(toPosix(repo.primary), repo)
    for (const worktree of repo.worktrees) {
      worktreeByPath.set(toPosix(worktree.path), worktree)
    }
  }

  const hidden = new Set<string>()
  const decorations = new Map<string, WorktreeRowDecoration>()
  const projected: WorkspaceItemLike[] = workspaces.map((w) => ({ ...w, sessionIds: [...w.sessionIds] }))

  projected.forEach((workspace, index) => {
    const worktree = worktreeByPath.get(toPosix(workspace.path))
    if (worktree === undefined) return
    // The primary this worktree was created from, by construction of the
    // locked path rule (<primary>/.dsh/worktrees/<slug>).
    const marker = '/.dsh/worktrees/'
    const markerAt = worktree.path.lastIndexOf(marker)
    if (markerAt < 0) return
    const primary = toPosix(worktree.path.slice(0, markerAt))
    if (!repoByPath.has(primary)) return
    // Merge into the first non-worktree workspace at or under the primary.
    const target = projected.findIndex((candidate, candidateIndex) =>
      candidateIndex !== index
      && !worktreeByPath.has(toPosix(candidate.path))
      && isInside(primary, candidate.path))
    if (target < 0) return // No repo workspace: keep the group (fallback).
    for (const sessionId of workspace.sessionIds) {
      decorations.set(sessionId, {
        kind: 'dsh-next-worktrees',
        slug: worktree.slug,
        title: worktree.title,
        branch: worktree.branch,
        baseRef: worktree.baseRef,
        path: worktree.path,
        dirty: worktree.status.dirty,
        ahead: worktree.status.ahead,
        merged: worktree.status.merged,
      })
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

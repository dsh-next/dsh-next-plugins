/**
 * Pure sidebar projection: the strategy-B cluster math.
 *
 * The Host truth stays untouched — worktree workspaces exist, own their
 * sessions, and keep their cwds. This function derives what the official
 * Browser should SEE after `deriveGroups`: worktree groups vanish from the
 * top-level list and reappear as nested cluster rows under the harbor,
 * carrying decoration metadata the derived renderer turns into a branch
 * icon, git folder menu, and extra-session `+`.
 *
 * Sessions stay in their worktree workspace. That is what makes folder `+`
 * (`startSession`) and stock session menus free.
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
  /** Host display title after `workspaces.rename`; optional in tests. */
  readonly title?: string
}

/** Session summary facts the projection needs. */
export interface SessionSummaryLike {
  readonly id: string
}

/** Decoration riding a nested cluster group (consumed by seams). */
export interface WorktreeRowDecoration {
  readonly kind: 'dsh-next-worktrees'
  readonly slug: string
  readonly title: string
  readonly branch: string
  readonly baseRef: string
  readonly primaryBranch: string
  readonly path: string
  /** The host workspace registered for this worktree (delete cleanup). */
  readonly workspaceId: string
  /** Harbor workspace this cluster nests under. */
  readonly harborWorkspaceId: string
  /** Sessions living in the worktree workspace (delete cleanup). */
  readonly sessionIds: readonly string[]
  readonly dirty: boolean
  readonly ahead: number
  readonly merged: boolean
  readonly conflict: boolean
  /** True while `.worktrees.json` setup is running after the row exists. */
  readonly settingUp?: boolean
}

/** Client facts for the in-flight setup overlay (create flow). */
export interface SettingUpOverlay {
  readonly slug: string
  readonly sessionId: string
  readonly workspaceId: string
  readonly path: string
}

export interface ProjectionInput {
  readonly workspaces: readonly WorkspaceItemLike[]
  readonly sessionsById: Readonly<Record<string, SessionSummaryLike | undefined>>
  readonly topology: WorktreeTopology
}

export interface ProjectionResult {
  /** Workspaces the Browser should list (worktree groups stay; nesting is later). */
  readonly workspaces: readonly WorkspaceItemLike[]
  /** Cluster decorations by worktree workspace id. */
  readonly clusters: ReadonlyMap<string, WorktreeRowDecoration>
  /** Workspace ids that nest under a harbor (not hidden from the store). */
  readonly nestedWorkspaceIds: ReadonlySet<string>
}

/** Group shape `deriveGroups` yields; the nest step only needs these fields. */
export interface GroupNodeLike {
  readonly key: string
  readonly workspaceId?: string
  readonly containsCurrent: boolean
  readonly expanded: boolean
  readonly sessions: readonly unknown[]
  readonly children?: readonly GroupNodeLike[]
  readonly __dshNextWorktrees?: WorktreeRowDecoration
}

function isInside(parent: string, child: string): boolean {
  const p = toPosix(parent)
  const c = toPosix(child)
  return c === p || c.startsWith(`${p}/`)
}

function isWorktreePath(path: string): boolean {
  return parseWorktreeWorkspacePath(path) !== undefined
}

function decorationFrom(
  workspace: WorkspaceItemLike,
  harborWorkspaceId: string,
  worktree: WorktreeTopology['repos'][number]['worktrees'][number] | undefined,
  parsed: { slug: string; root: string },
): WorktreeRowDecoration {
  return {
    kind: 'dsh-next-worktrees',
    slug: worktree?.slug ?? parsed.slug,
    title: (workspace.title !== undefined && workspace.title !== ''
      ? workspace.title
      : worktree?.title) || parsed.slug,
    branch: worktree?.branch ?? `dsh-worktrees/${parsed.slug}`,
    baseRef: worktree?.baseRef ?? '',
    primaryBranch: worktree?.primaryBranch ?? '',
    path: worktree?.path ?? parsed.root,
    workspaceId: workspace.workspaceId,
    harborWorkspaceId,
    sessionIds: [...workspace.sessionIds],
    dirty: worktree?.status.dirty ?? false,
    ahead: worktree?.status.ahead ?? 0,
    merged: worktree?.status.merged ?? false,
    conflict: worktree?.status.conflict ?? false,
  }
}

/**
 * Derive cluster decorations for worktree workspaces that have a harbor.
 *
 * Worktree workspaces stay in the list so `deriveGroups` builds real groups
 * (sessions, `+`, Rename, expansion). The nest step pulls those groups under
 * the harbor. When no harbor exists, the worktree group stays top-level —
 * sessions must never vanish from the sidebar.
 *
 * Topology only enriches identity: a path-marker workspace is a cluster as
 * soon as a harbor exists, even before git status arrives.
 *
 * @param input - host workspace/session snapshots plus the topology RPC's
 * answer.
 * @returns decorations keyed by worktree workspace id.
 */
export function projectWorkspaceSidebar(input: ProjectionInput): ProjectionResult {
  const { workspaces, topology } = input
  const worktreeByPath = new Map<string, WorktreeTopology['repos'][number]['worktrees'][number]>()
  for (const repo of topology.repos) {
    for (const worktree of repo.worktrees) {
      worktreeByPath.set(toPosix(worktree.path), worktree)
    }
  }

  const clusters = new Map<string, WorktreeRowDecoration>()
  const nested = new Set<string>()

  workspaces.forEach((workspace, index) => {
    const parsed = parseWorktreeWorkspacePath(workspace.path)
    if (parsed === undefined) return
    const harbor = workspaces.find((candidate, candidateIndex) =>
      candidateIndex !== index
      && !isWorktreePath(candidate.path)
      && isInside(parsed.primary, candidate.path))
    if (harbor === undefined) return
    const worktree = worktreeByPath.get(parsed.root)
    clusters.set(
      workspace.workspaceId,
      decorationFrom(workspace, harbor.workspaceId, worktree, parsed),
    )
    nested.add(workspace.workspaceId)
  })

  return {
    workspaces,
    clusters,
    nestedWorkspaceIds: nested,
  }
}

/**
 * Copy cluster decorations onto workspace items so `deriveGroups` can pass
 * them through to group nodes.
 */
export function decorateWorkspaces<W extends WorkspaceItemLike>(
  workspaces: readonly W[],
  clusters: ReadonlyMap<string, WorktreeRowDecoration>,
): ReadonlyArray<W & { __dshNextWorktrees?: WorktreeRowDecoration }> {
  if (clusters.size === 0) return workspaces
  return workspaces.map((workspace) => {
    const decoration = clusters.get(workspace.workspaceId)
    return decoration === undefined
      ? workspace
      : { ...workspace, __dshNextWorktrees: decoration }
  })
}

/**
 * Mark (or synthesize) the in-flight setup cluster so the identity icon can
 * spin before topology has the new worktree, and after it does.
 */
export function overlaySettingUp(
  clusters: ReadonlyMap<string, WorktreeRowDecoration>,
  settingUp: SettingUpOverlay | undefined,
): ReadonlyMap<string, WorktreeRowDecoration> {
  if (settingUp === undefined) return clusters
  const next = new Map(clusters)
  for (const [workspaceId, decoration] of next) {
    if (decoration.slug === settingUp.slug) next.set(workspaceId, { ...decoration, settingUp: true })
  }
  const existing = next.get(settingUp.workspaceId)
  if (existing !== undefined) {
    next.set(settingUp.workspaceId, { ...existing, settingUp: true })
    return next
  }
  next.set(settingUp.workspaceId, {
    kind: 'dsh-next-worktrees',
    slug: settingUp.slug,
    title: settingUp.slug,
    branch: `dsh-worktrees/${settingUp.slug}`,
    baseRef: '',
    primaryBranch: '',
    path: settingUp.path,
    workspaceId: settingUp.workspaceId,
    harborWorkspaceId: '',
    sessionIds: [settingUp.sessionId],
    dirty: false,
    ahead: 0,
    merged: false,
    conflict: false,
    settingUp: true,
  })
  return next
}

/**
 * Pull decorated worktree groups out of the top-level list and attach them
 * as `children` of their harbor. Harbor `containsCurrent` becomes true when
 * any nested cluster holds the current session, so the repo row stays
 * tinted and the auto-expand effect has a reason to open it.
 *
 * Groups without a harbor decoration stay top-level (the no-repo fallback).
 *
 * @param groups - `deriveGroups` output (one group per workspace).
 * @returns the same groups, nested.
 */
export function nestWorktreeGroups<G extends GroupNodeLike>(groups: readonly G[]): G[] {
  const childrenByHarbor = new Map<string, G[]>()
  const nested = new Set<string>()
  for (const group of groups) {
    const decoration = group.__dshNextWorktrees
    if (decoration === undefined || decoration.kind !== 'dsh-next-worktrees') continue
    if (decoration.harborWorkspaceId === '') continue
    const parent = groups.find((candidate) => candidate.workspaceId === decoration.harborWorkspaceId)
    if (parent === undefined) continue
    nested.add(group.key)
    const list = childrenByHarbor.get(parent.key) ?? []
    list.push(group)
    childrenByHarbor.set(parent.key, list)
  }
  if (nested.size === 0) return [...groups]
  return groups
    .filter((group) => !nested.has(group.key))
    .map((group) => {
      const children = childrenByHarbor.get(group.key)
      if (children === undefined || children.length === 0) return group
      return {
        ...group,
        containsCurrent: group.containsCurrent || children.some((child) => child.containsCurrent),
        children,
      }
    })
}

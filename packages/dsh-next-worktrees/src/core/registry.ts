/**
 * The plugin-owned sidecar registry — pure shapes and reconciliation.
 *
 * Git is the source of truth: `git worktree list` decides which worktrees
 * exist. This registry only decorates them with plugin facts (slug, title,
 * session binding, role) and is reconciled against git state at read time.
 */

/** Forward-compat binding role; MVP always binds the owner session. */
export type BindingRole = 'owner'

/** One registry entry: a plugin-created worktree and its bound session. */
export interface WorktreeBinding {
  readonly slug: string
  /** Absolute worktree directory. */
  readonly path: string
  /** Full branch name (`dsh-worktrees/<slug>`). */
  readonly branch: string
  /** Base ref the branch was created from. */
  readonly baseRef: string
  /** Display title (prompt-derived or empty). */
  readonly title: string
  /** Owner session id once a session was bound, else null. */
  readonly sessionId: string | null
  /** Always 'owner' in MVP (fast-forward insurance for the inspector). */
  readonly role: BindingRole
  /** ISO timestamp of creation. */
  readonly createdAt: string
}

/** The serialized registry file body. */
export interface RegistryFile {
  readonly version: 1
  readonly bindings: readonly WorktreeBinding[]
}

/** Parse and validate a registry file body; null when unusable. */
export function parseRegistry(raw: string): RegistryFile | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (parsed === null || typeof parsed !== 'object') return null
  const { version, bindings } = parsed as Record<string, unknown>
  if (version !== 1 || !Array.isArray(bindings)) return null
  const valid: WorktreeBinding[] = []
  for (const entry of bindings) {
    if (entry === null || typeof entry !== 'object') continue
    const b = entry as Record<string, unknown>
    if (
      typeof b.slug !== 'string' || b.slug.length === 0
      || typeof b.path !== 'string' || b.path.length === 0
      || typeof b.branch !== 'string' || b.branch.length === 0
      || typeof b.baseRef !== 'string'
      || typeof b.title !== 'string'
      || (b.sessionId !== null && typeof b.sessionId !== 'string')
      || b.role !== 'owner'
      || typeof b.createdAt !== 'string'
    ) continue
    valid.push({
      slug: b.slug,
      path: b.path,
      branch: b.branch,
      baseRef: b.baseRef,
      title: b.title,
      sessionId: b.sessionId,
      role: 'owner',
      createdAt: b.createdAt,
    })
  }
  return { version: 1, bindings: valid }
}

/** Serialize a registry body. */
export function serializeRegistry(file: RegistryFile): string {
  return `${JSON.stringify({ version: 1, bindings: file.bindings }, null, 2)}\n`
}

/** One line of `git worktree list --porcelain` output parsed to a path. */
export function parseWorktreeList(
  porcelain: string,
): readonly string[] {
  const paths: string[] = []
  for (const line of porcelain.split('\n')) {
    if (line.startsWith('worktree ')) {
      const path = line.slice('worktree '.length).trim()
      if (path.length > 0) paths.push(path)
    }
  }
  return paths
}

/** Reconciliation outcome: bindings whose worktree still exists in git. */
export interface ReconcileResult {
  readonly kept: readonly WorktreeBinding[]
  readonly dropped: readonly WorktreeBinding[]
}

/**
 * Drop bindings whose path no longer appears in `git worktree list`. Git is
 * the truth; a binding without a worktree is stale by definition (removed
 * out of band, or the primary moved).
 */
export function reconcile(
  bindings: readonly WorktreeBinding[],
  gitWorktreePaths: readonly string[],
): ReconcileResult {
  const live = new Set(gitWorktreePaths)
  const kept: WorktreeBinding[] = []
  const dropped: WorktreeBinding[] = []
  for (const binding of bindings) {
    if (live.has(binding.path)) kept.push(binding)
    else dropped.push(binding)
  }
  return { kept, dropped }
}

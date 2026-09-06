/**
 * Pure registry model and reconciliation.
 *
 * The sidecar (`<primary>/.dsh/worktrees/registry.json`) carries display
 * data and session bindings git cannot; git remains the truth. Every read
 * reconciles rows against `git worktree list --porcelain`: a row whose
 * worktree path vanished is stale and drops.
 */
import { toPosix } from './paths.ts'
import { displayTitle } from './slug.ts'

/** Forward-compat role field: always `owner` in this line (insurance). */
export type WorktreeRole = 'owner'

export interface WorktreeBinding {
  /** Claiming session id; '' until a session opens inside the worktree. */
  readonly sessionId: string
  readonly slug: string
  /** Sanitized display Name ('' when the user kept the suggestion off). */
  readonly name: string
  readonly path: string
  readonly branch: string
  readonly baseRef: string
  /** Workspace cwd relative to the repo root ('' at the root). */
  readonly relPath: string
  /**
   * Commit id of `baseRef` at create time. Symbolic bases (HEAD,
   * origin/HEAD) move; the pin is what lets "merged" survive a
   * fast-forward into the same ref. '' on legacy rows.
   */
  readonly baseSha: string
  readonly role: WorktreeRole
  readonly createdAt: number
}

export interface RegistryFile {
  readonly version: 1
  readonly bindings: readonly WorktreeBinding[]
}

export const EMPTY_REGISTRY: RegistryFile = { version: 1, bindings: [] }

/** One `git worktree list --porcelain` entry (subset this plugin needs). */
export interface WorktreeListEntry {
  readonly path: string
  readonly branch?: string
  readonly head?: string
}

export interface ReconcileResult {
  readonly kept: readonly WorktreeBinding[]
  readonly dropped: readonly WorktreeBinding[]
}

/**
 * Parse `git worktree list --porcelain` output into entries.
 *
 * @param stdout - raw porcelain text.
 * @returns entries in listed order.
 */
export function parseWorktreeList(stdout: string): WorktreeListEntry[] {
  const entries: WorktreeListEntry[] = []
  let path = ''
  let branch: string | undefined
  let head: string | undefined
  const flush = (): void => {
    if (path !== '') entries.push({ path, branch, head })
    path = ''
    branch = undefined
    head = undefined
  }
  for (const line of stdout.split('\n')) {
    if (line.startsWith('worktree ')) {
      flush()
      path = line.slice('worktree '.length)
    } else if (line.startsWith('branch ')) {
      branch = line.slice('branch '.length).replace(/^refs\/heads\//, '')
    } else if (line.startsWith('HEAD ')) {
      head = line.slice('HEAD '.length)
    }
  }
  flush()
  return entries
}

/**
 * Drop bindings whose worktree path is absent from the live list.
 *
 * @param bindings - registry rows as loaded.
 * @param worktrees - live `git worktree list` entries.
 * @returns kept and dropped sets; callers persist only when dropped is
 * non-empty.
 */
export function reconcile(
  bindings: readonly WorktreeBinding[],
  worktrees: readonly WorktreeListEntry[],
): ReconcileResult {
  const live = new Set(worktrees.map((w) => toPosix(w.path)))
  const kept: WorktreeBinding[] = []
  const dropped: WorktreeBinding[] = []
  for (const binding of bindings) {
    if (live.has(toPosix(binding.path))) kept.push(binding)
    else dropped.push(binding)
  }
  return { kept, dropped }
}

/** Registry rows for one slug, in creation order. */
export function rowsForSlug(
  bindings: readonly WorktreeBinding[],
  slug: string,
): WorktreeBinding[] {
  return bindings.filter((b) => b.slug === slug)
}

/** The row claiming a session, if any. */
export function rowForSession(
  bindings: readonly WorktreeBinding[],
  sessionId: string,
): WorktreeBinding | undefined {
  return bindings.find((b) => b.sessionId === sessionId)
}

/**
 * The registry row whose worktree contains `cwd`, ignoring claim ownership.
 *
 * {@link rowForCwd} layers the one-writer gate on top of this lookup.
 *
 * @param bindings - registry rows.
 * @param cwd - the session's absolute cwd.
 * @returns the containing row, or undefined when the cwd is no worktree.
 */
export function rowContainingCwd(
  bindings: readonly WorktreeBinding[],
  cwd: string,
): WorktreeBinding | undefined {
  const cwdPosix = toPosix(cwd)
  return bindings.find((b) => {
    const path = toPosix(b.path)
    return cwdPosix === path || cwdPosix.startsWith(`${path}/`)
  })
}

/**
 * The row a new session in `cwd` should claim: the unclaimed or matching
 * row whose worktree contains the cwd, else undefined.
 *
 * @param bindings - registry rows.
 * @param sessionId - the session asking.
 * @param cwd - the session's absolute cwd.
 * @returns the row to bind, or undefined when the cwd is no worktree.
 */
export function rowForCwd(
  bindings: readonly WorktreeBinding[],
  sessionId: string,
  cwd: string,
): WorktreeBinding | undefined {
  const inside = rowContainingCwd(bindings, cwd)
  if (inside === undefined) return undefined
  // A session already bound to this worktree keeps its row; a different
  // session takes over only an unclaimed one (one writer per tree, the
  // takeover the row `+` drives).
  if (inside.sessionId === sessionId || inside.sessionId === '') return inside
  return undefined
}

/** Whether every row for a slug is unclaimed (no session ever bound). */
export function slugIsUnclaimed(
  bindings: readonly WorktreeBinding[],
  slug: string,
): boolean {
  return rowsForSlug(bindings, slug).every((b) => b.sessionId === '')
}

/** The sidebar title for a binding. */
export function bindingTitle(binding: WorktreeBinding): string {
  return displayTitle(binding.name, binding.slug)
}

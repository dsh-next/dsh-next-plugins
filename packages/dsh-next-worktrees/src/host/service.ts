/**
 * Worktrees orchestration service — every RPC's implementation.
 *
 * Invariants enforced here (docs/ideas/dsh-next-worktrees.md):
 * - git is the truth: every read reconciles the sidecar against
 *   `git worktree list`; every write is serialized per repo.
 * - user text never reaches a branch (slug-only refs; Name is display).
 * - the only writes to the user's checkout are the guarded worktree-add /
 *   worktree-remove pair, the preflighted merge into the primary, and
 *   update-from-main (a merge into the worktree that may stay mid-merge).
 * - one writer per worktree: a session takes over only an unclaimed row
 *   (`bind`); `reclaim(from, to)` is the one self-steal for reincarnation.
 */
import { mergeVerdict, parseGitVersion, gitSupportsMergeTree, type MergeBlocker, type MergeWarning } from '../core/merge.ts'
import { updateVerdict, type UpdateBlocker } from '../core/update.ts'
import {
  reconcile,
  rowContainingCwd,
  rowForCwd,
  rowForSession,
  rowsForSlug,
  type WorktreeBinding,
} from '../core/registry.ts'
import { nextSlug, normalizeName, suggestName, displayTitle, slugFromPluginRef, validateFolderName } from '../core/slug.ts'
import {
  parseWorktreesJson,
  resolveSetupSteps,
  setupPlatform,
  worktreesJsonCandidates,
  SETUP_ENV_ROOT,
  type SetupStep,
} from '../core/setup.ts'
import { worktreeStatus, type WorktreeStatus } from '../core/status.ts'
import { GitError } from './git.ts'
import type { GitPorts } from './git.ts'
import type { RegistryStorePorts } from './registry-store.ts'

/** Structured flow error crossing the RPC boundary as { error: { code } }. */
export class WorktreeFlowError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly hint?: string,
  ) {
    super(message)
    this.name = 'WorktreeFlowError'
  }
}

export type GetSessionCwd = (sessionId: string) => string | null
export type ApplySandboxMode = (sessionId: string, mode: 'danger-full-access') => boolean
export type IsSessionRunning = (sessionId: string) => boolean

export interface ServicePorts {
  readonly git: GitPorts
  readonly store: RegistryStorePorts
  readonly getSessionCwd: GetSessionCwd
  readonly applySandboxMode: ApplySandboxMode
  /** One-writer gate for update-from-main (false when the session is unknown). */
  readonly isSessionRunning: IsSessionRunning
  /**
   * Copy one file for `.worktreeinclude` replication; a no-op when the
   * source is missing (best-effort convention).
   */
  readonly copyFile: (from: string, to: string) => Promise<void>
  /**
   * Read a setup file from disk. Missing file → null. Absent in tests
   * that do not exercise `.worktrees.json`.
   */
  readonly readText?: (path: string) => Promise<string | null>
  /** True when a worktree checkout is on disk. Absent in tests. */
  readonly exists?: (path: string) => Promise<boolean>
  /**
   * Best-effort: make `.dsh/` locally ignored so a nested worktree is
   * not untracked files in the harbor (git clean would delete it).
   */
  readonly ensureDotDshIgnored?: (primary: string) => Promise<void>
  /** Run one setup command or script in the new worktree. */
  readonly runCommand?: (input: {
    readonly command?: string
    readonly script?: string
    readonly cwd: string
    readonly env: Readonly<Record<string, string>>
  }) => Promise<{ code: number; stdout: string; stderr: string }>
  /** `process.platform`; tests inject `win32` / `darwin`. */
  readonly platform?: string
  /** Seed for deterministic slug/name generation in tests. */
  readonly seed?: number
  /** Clock for the UTC slug stamp; tests pin this, production uses Date.now(). */
  readonly now?: number
}

/** Preflight answer for a workspace cwd. */
export interface PreflightResult {
  readonly ok: boolean
  readonly issue?: 'not-a-repository' | 'bare-or-unknown-layout' | 'already-in-worktree' | 'git-unavailable' | 'no-commits'
  readonly primary?: string
  readonly relPath?: string
  readonly baseRef?: string
  readonly dotDshIgnored: boolean
}

/** Create answer: everything the client needs to open the session. */
export interface CreateResult {
  readonly slug: string
  readonly name: string
  readonly title: string
  readonly path: string
  readonly branch: string
  readonly baseRef: string
  readonly relPath: string
  /**
   * True when `.worktrees.json` has steps the client should run as a
   * follow-up `setup` RPC (so the session row can appear first).
   */
  readonly setupPending: boolean
}

/** Status answer for a bound session. */
export interface StatusResult {
  readonly slug: string
  readonly title: string
  readonly path: string
  readonly branch: string
  readonly baseRef: string
  readonly status: WorktreeStatus
}

/** One worktree in the topology answer. */
export interface TopologyWorktree {
  readonly slug: string
  readonly title: string
  readonly path: string
  readonly branch: string
  readonly baseRef: string
  /** Primary checkout's current branch (the update-from source). */
  readonly primaryBranch: string
  readonly status: WorktreeStatus
  readonly sessionIds: readonly string[]
}

/** One repo in the topology answer. */
export interface TopologyRepo {
  readonly primary: string
  readonly ok: boolean
  readonly worktrees: readonly TopologyWorktree[]
}

/** Per-workspace creation facts for the repo-row button gating. */
export interface WorkspaceFacts {
  readonly cwd: string
  /** The repo primary this cwd belongs to ('' when not a repository). */
  readonly primary: string
  /** Whether the worktree button renders on this repo row. */
  readonly canCreate: boolean
  /** Machine reason when canCreate is false. */
  readonly reason?: 'not-a-repository' | 'bare-or-unknown-layout' | 'already-in-worktree' | 'git-unavailable' | 'no-commits'
}

export interface TopologyResult {
  readonly repos: readonly TopologyRepo[]
  readonly workspaces: readonly WorkspaceFacts[]
}

/** Merge preflight answer for the modal. */
export interface MergePreflightResult {
  readonly blockers: readonly MergeBlocker[]
  readonly warnings: readonly MergeWarning[]
  readonly green: boolean
  readonly target?: string
  readonly source?: string
  readonly fastForward: boolean
  readonly aheadCount: number
  readonly manualCommand?: string
  /** Uncommitted paths in the primary checkout (empty when clean). */
  readonly dirtyPrimary: readonly string[]
  /** Uncommitted paths in the worktree (empty when clean). */
  readonly dirtyWorktree: readonly string[]
}

export interface MergeExecuteResult {
  readonly target: string
  readonly source: string
  readonly fastForward: boolean
}

/** Update-from-main preflight answer for the confirmation modal. */
export interface UpdatePreflightResult {
  readonly blockers: readonly UpdateBlocker[]
  readonly green: boolean
  /** Primary branch being merged into the worktree. */
  readonly source?: string
  /** Worktree branch receiving the update. */
  readonly target?: string
  readonly fastForward: boolean
  readonly wouldConflict: boolean
  readonly inProgress: boolean
  readonly sessionId?: string
  readonly manualCommand?: string
  /** Uncommitted paths in the worktree (empty when clean). */
  readonly dirtyWorktree: readonly string[]
}

export interface UpdateExecuteResult {
  readonly source: string
  readonly target: string
  readonly fastForward: boolean
  readonly conflict: boolean
  readonly sessionId: string
}

/** Why `reclaim` left the registry row untouched. */
export type ReclaimSkipReason = 'no-worktree-here' | 'not-owner'

/**
 * Steal-from-self result: either the row now points at `to`, or the cwd is
 * not a plugin worktree / is owned by someone else (callers skip).
 */
export type ReclaimResult =
  | { readonly claimed: true; readonly slug: string; readonly title: string; readonly path: string }
  | { readonly claimed: false; readonly reason: ReclaimSkipReason }

const fromGit = (error: unknown): never => {
  if (error instanceof GitError) {
    throw new WorktreeFlowError(error.code, error.message, error.hint)
  }
  throw error
}

/** The orchestration service. Constructed once by the host entry. */
export class WorktreesService {
  /** In-flight `.worktrees.json` jobs, keyed by primary checkout and slug. */
  private readonly setupJobs = new Map<string, Promise<void>>()
  /** Setup job keys whose commands have not settled (remove must wait). */
  private readonly setupInFlight = new Set<string>()

  constructor(private readonly ports: ServicePorts) {}

  /** Preflight a workspace cwd for worktree creation. */
  async preflight(cwd: string): Promise<PreflightResult> {
    try {
      const placement = await this.ports.git.placement(cwd)
      if (placement.insideWorktreesRoot) {
        return { ok: false, issue: 'already-in-worktree', dotDshIgnored: false }
      }
      const baseRef = await this.ports.git.defaultBaseRef(cwd)
      const hasCommits = await this.ports.git.refExists(cwd, 'HEAD')
      if (!hasCommits) {
        return { ok: false, issue: 'no-commits', dotDshIgnored: false }
      }
      return {
        ok: true,
        primary: placement.primary,
        relPath: placement.relPath,
        baseRef,
        dotDshIgnored: await this.dotDshIgnored(placement.primary),
      }
    } catch (error) {
      if (error instanceof GitError) {
        return { ok: false, issue: error.code as PreflightResult['issue'], dotDshIgnored: false }
      }
      throw error
    }
  }

  private async dotDshIgnored(primary: string): Promise<boolean> {
    const result = await this.ports.git.raw(
      ['check-ignore', '-q', '.dsh'],
      primary,
    )
    return result.code === 0
  }

  /** Suggest an available name; creation still checks for concurrent claims. */
  async suggestName(cwd: string): Promise<string> {
    const placement = await this.ports.git.placement(cwd).catch(fromGit)
    const taken = await this.takenSlugs(placement.primary)
    const seed = this.ports.seed ?? this.ports.now ?? Date.now()
    let name = suggestName(seed, taken)
    while (await this.ports.exists?.(`${placement.worktreesRoot}/${name}`)) {
      taken.push(name)
      name = suggestName(seed, taken)
    }
    return name
  }

  /** Names reserved by live registry rows or retained plugin branches. */
  private async takenSlugs(primary: string): Promise<string[]> {
    const [bindings, pluginBranches] = await Promise.all([
      this.reconciled(primary),
      this.ports.git.listPluginBranches(primary),
    ])
    return [
      ...bindings.map((b) => b.slug),
      ...bindings.map((b) => b.path.split(/[/\\]/).filter(Boolean).pop() ?? b.slug),
      ...pluginBranches
        .map(slugFromPluginRef)
        .filter((slug): slug is string => slug !== undefined),
    ]
  }

  /**
   * Create a worktree. The row starts unclaimed; the client creates the
   * workspace + session at `path` and then binds.
   */
  async create(input: { cwd: string; name?: string; baseRef?: string }): Promise<CreateResult> {
    const placement = await this.ports.git.placement(input.cwd).catch(fromGit)
    if (placement.insideWorktreesRoot) {
      throw new WorktreeFlowError('already-in-worktree',
        'worktrees never nest inside another worktree')
    }
    const [baseRef, hasCommits, taken] = await Promise.all([
      input.baseRef === undefined
        ? this.ports.git.defaultBaseRef(input.cwd)
        : Promise.resolve(input.baseRef),
      this.ports.git.refExists(input.cwd, 'HEAD'),
      this.takenSlugs(placement.primary),
    ])
    if (!hasCommits) {
      throw new WorktreeFlowError('no-commits', 'the repository has no commits to branch from')
    }
    // Pin the resolved commit so "merged" still holds after a fast-forward
    // into a moving symbolic base (HEAD / origin/HEAD).
    const baseSha = await this.ports.git.revParse(placement.primary, baseRef)
    if (baseSha === undefined) {
      throw new WorktreeFlowError('no-commits', 'the repository has no commits to branch from')
    }
    const registryPath = `${placement.primary}/.dsh/worktrees/registry.json`
    const now = this.ports.now ?? Date.now()
    const parsedName = validateFolderName(input.name ?? '')
    if (input.name !== undefined && input.name.trim() !== '' && !parsedName.ok) {
      throw new WorktreeFlowError(
        'bad-name',
        'folder name must be lowercase letters, numbers, and hyphens',
        'example: update-plugin',
      )
    }
    const slug = parsedName.ok
      ? parsedName.folder
      : nextSlug({ takenSlugs: taken, seed: this.ports.seed ?? now, now })
    if (parsedName.ok && taken.includes(slug)) {
      throw new WorktreeFlowError(
        'name-taken',
        `a worktree named ${slug} already exists`,
        'pick a different folder name',
      )
    }
    const name = parsedName.ok ? parsedName.folder : normalizeName(input.name ?? '')
    const path = `${placement.worktreesRoot}/${slug}`
    const branch = `dsh-worktrees/${slug}`
    await this.ports.git.addWorktree({
      primary: placement.primary,
      path,
      branch,
      baseRef,
    }).catch(fromGit)
    await this.ports.ensureDotDshIgnored?.(placement.primary).catch(() => {})
    try {
      await this.ports.store.mutate(placement.primary, registryPath, (rows) => [
        ...rows,
        {
          sessionId: '',
          slug,
          name,
          path,
          branch,
          baseRef,
          relPath: placement.relPath,
          baseSha,
          role: 'owner' as const,
          createdAt: Date.now(),
        },
      ])
    } catch (error) {
      // Registry write failed after git created the worktree: drop the
      // checkout so we never leave an untracked tree on disk.
      await this.ports.git.removeWorktree({
        primary: placement.primary,
        path,
        force: true,
      }).catch(() => {})
      throw error
    }
    await this.copyWorktreeInclude(placement.primary, placement.relPath, path)
    const planned = await this.planSetup(placement.primary)
    if ('error' in planned) {
      await this.dropCreatedWorktree(placement.primary, registryPath, path, slug)
      throw new WorktreeFlowError('setup-invalid', planned.error)
    }
    if (planned.pending) this.beginSetup(placement.primary, path, slug)
    return {
      slug,
      name,
      title: displayTitle(name, slug),
      path,
      branch,
      baseRef,
      relPath: placement.relPath,
      setupPending: planned.pending,
    }
  }

  /**
   * Run `.worktrees.json` in an already-created worktree. A failed command
   * throws and leaves the worktree (the session is already open; the user
   * can finish setup by hand or delete the row).
   */
  async setup(input: { cwd: string; slug: string }): Promise<void> {
    const placement = await this.ports.git.placement(input.cwd).catch(fromGit)
    const bindings = await this.reconciled(placement.primary)
    const row = rowsForSlug(bindings, input.slug)[0]
    if (row === undefined) {
      throw new WorktreeFlowError('unknown-slug', `no worktree bound to slug ${input.slug}`)
    }
    const key = setupJobKey(placement.primary, input.slug)
    let job = this.setupJobs.get(key)
    if (job === undefined) {
      job = this.runWorktreesSetup(placement.primary, row.path)
      this.setupJobs.set(key, job)
    }
    await job
  }

  /**
   * Start `.worktrees.json` as soon as git has created the folder, so
   * `pnpm install` is not racing the client's workspace/session round
   * trip (or the abandoned-worktree sweeper).
   */
  private beginSetup(primary: string, worktreePath: string, slug: string): void {
    const key = setupJobKey(primary, slug)
    this.setupInFlight.add(key)
    const job = this.runWorktreesSetup(primary, worktreePath)
    this.setupJobs.set(key, job)
    void job.finally(() => { this.setupInFlight.delete(key) }).catch(() => {})
  }

  /**
   * Copy `.worktreeinclude` entries (one path per line, relative to the
   * include file's directory) from the primary working tree into the fresh
   * worktree. The Claude Code convention: untracked local files (`.env`,
   * caches) the new tree needs. Missing include file or missing sources
   * copy nothing.
   */
  private async copyWorktreeInclude(
    primary: string,
    relPath: string,
    worktreePath: string,
  ): Promise<void> {
    const read = await this.ports.git.raw(
      ['show', `HEAD:${relPath === '' ? '.worktreeinclude' : `${relPath}/.worktreeinclude`}`],
      primary,
    )
    if (read.code !== 0) return
    const entries = read.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#'))
    const join = (...parts: readonly string[]): string =>
      parts.filter((p) => p !== '').join('/')
    for (const entry of entries) {
      if (isUnsafeInclude(entry)) continue
      const from = join(primary, relPath, entry)
      const to = join(worktreePath, relPath, entry)
      await this.ports.copyFile(from, to)
    }
  }

  private async dropCreatedWorktree(
    primary: string,
    registryPath: string,
    path: string,
    slug: string,
  ): Promise<void> {
    await this.ports.git.removeWorktree({
      primary,
      path,
      force: true,
    }).catch(() => {})
    await this.ports.store.mutate(primary, registryPath, (rows) =>
      rows.filter((row) => row.slug !== slug),
    ).catch(() => {})
  }

  /**
   * Whether create should ask the client to follow up with `setup`.
   * Invalid JSON fails create (no session row) so the error hint holds.
   */
  private async planSetup(primary: string): Promise<{ pending: boolean } | { error: string }> {
    const setup = await this.readSetup(primary)
    if (setup === undefined) return { pending: false }
    if ('error' in setup) return setup
    return { pending: setup.steps.length > 0 }
  }

  /** Read the first setup file, preserving local-override precedence even when invalid. */
  private async readSetup(primary: string): Promise<
    { path: string; steps: readonly SetupStep[] } | { error: string } | undefined
  > {
    const readText = this.ports.readText
    if (readText === undefined) return undefined
    for (const path of worktreesJsonCandidates(primary)) {
      const raw = await readText(path)
      if (raw === null) continue
      const parsed = parseWorktreesJson(raw)
      if ('error' in parsed) return { error: parsed.error }
      const steps = resolveSetupSteps(parsed, setupPlatform(this.ports.platform ?? 'linux'))
      if ('error' in steps) return { error: steps.error }
      return { path, steps }
    }
    return undefined
  }

  /**
   * Run `.dsh/worktrees.json` (local override) or `.worktrees.json` at the
   * repo root. Missing file → no-op. Invalid file or a failed command
   * throws; the worktree stays so the user can retry or delete.
   */
  private async runWorktreesSetup(primary: string, worktreePath: string): Promise<void> {
    const runCommand = this.ports.runCommand
    if (this.ports.readText === undefined || runCommand === undefined) return
    const setup = await this.readSetup(primary)
    if (setup === undefined) return
    if ('error' in setup) {
      throw new WorktreeFlowError('setup-invalid', setup.error)
    }
    const { path, steps } = setup
    const jsonDir = parentDir(path)
    const env = { [SETUP_ENV_ROOT]: primary }
    if (!await this.waitForWorktreeDir(primary, worktreePath)) {
      throw new WorktreeFlowError(
        'setup-failed',
        'setup command failed: worktree folder is missing',
        worktreePath,
      )
    }
    for (const step of steps) {
      const result = step.kind === 'command'
        ? await runCommand({ command: step.command, cwd: worktreePath, env })
        : await runCommand({ script: `${jsonDir}/${step.path}`, cwd: worktreePath, env })
      if (result.code !== 0) {
        const label = step.kind === 'command' ? step.command : step.path
        throw new WorktreeFlowError(
          'setup-failed',
          `setup command failed: ${label}`,
          clipSetupOutput(result.stderr || result.stdout),
        )
      }
    }
  }

  /**
   * True when the worktree checkout is on disk. Prefer `package.json` when
   * the harbor has one, so we do not start `pnpm` on an empty directory
   * whose `.git` file landed before the tree was checked out.
   */
  private async waitForWorktreeDir(primary: string, worktreePath: string): Promise<boolean> {
    const exists = this.ports.exists
    if (exists === undefined) return true
    const harborPackage = this.ports.readText === undefined
      ? null
      : await this.ports.readText(`${primary}/package.json`)
    const marker = harborPackage !== null ? `${worktreePath}/package.json` : worktreePath
    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (await exists(marker)) return true
      await new Promise((resolve) => { setTimeout(resolve, 50) })
    }
    return false
  }

  /**
   * Bind a session to the worktree its cwd sits in (or already owns), then
   * switch the sandbox knob so git works inside the linked worktree.
   */
  async bind(sessionId: string): Promise<{ slug: string; title: string; path: string }> {
    const cwd = this.ports.getSessionCwd(sessionId)
    if (cwd === null) {
      throw new WorktreeFlowError('unknown-session', 'the session has no cwd yet')
    }
    const placement = await this.ports.git.placement(cwd).catch(fromGit)
    const registryPath = `${placement.primary}/.dsh/worktrees/registry.json`
    const bindings = await this.reconciled(placement.primary)
    const row =
      rowForSession(bindings, sessionId)
      ?? rowContainingCwd(bindings, cwd)
    if (row === undefined) {
      throw new WorktreeFlowError('no-worktree-here',
        'the session cwd is not inside a plugin worktree')
    }
    // Extra chats in the same folder get the sandbox knob but do not steal
    // the one-writer claim. Only an unclaimed row takes a new claim; the
    // owner re-binding keeps it without a registry rewrite.
    if (row.sessionId === '' && sessionId !== '') {
      await this.ports.store.mutate(placement.primary, registryPath, (rows) =>
        rows.map((b) => b.path === row.path ? { ...b, sessionId } : b))
    }
    if (!this.ports.applySandboxMode(sessionId, 'danger-full-access')) {
      throw new WorktreeFlowError(
        'sandbox-refused',
        'could not grant the session danger-full-access',
        'retry bind after the session is ready',
      )
    }
    return { slug: row.slug, title: displayTitle(row.name, row.slug), path: row.path }
  }

  /**
   * Retarget a plugin worktree row from `from` onto `to` in one mutate, then
   * grant `to` danger-full-access. Never unclaims to `''` in between. A cwd
   * that is not a plugin worktree, or a row owned by some other session,
   * skips rather than stealing.
   *
   * Sandbox-write runs before the mutate so a refused knob leaves the row
   * on `from` (a caller that then archives `to` does not orphan the claim).
   */
  async reclaim(from: string, to: string): Promise<ReclaimResult> {
    if (from === to) {
      throw new WorktreeFlowError('bad-request', 'reclaim requires distinct from and to session ids')
    }
    const cwd = this.ports.getSessionCwd(to) ?? this.ports.getSessionCwd(from)
    if (cwd === null) {
      throw new WorktreeFlowError('unknown-session', 'the session has no cwd yet')
    }
    let placement
    try {
      placement = await this.ports.git.placement(cwd)
    } catch (error) {
      if (error instanceof GitError) return { claimed: false, reason: 'no-worktree-here' }
      throw error
    }
    if (!placement.insideWorktreesRoot) {
      return { claimed: false, reason: 'no-worktree-here' }
    }
    const registryPath = `${placement.primary}/.dsh/worktrees/registry.json`
    const bindings = await this.reconciled(placement.primary)
    const row = rowContainingCwd(bindings, cwd)
    if (row === undefined) {
      return { claimed: false, reason: 'no-worktree-here' }
    }
    if (row.sessionId !== from && row.sessionId !== to) {
      return { claimed: false, reason: 'not-owner' }
    }
    if (!this.ports.applySandboxMode(to, 'danger-full-access')) {
      throw new WorktreeFlowError(
        'sandbox-refused',
        'could not grant the session danger-full-access',
        'retry reclaim after the session is ready',
      )
    }
    if (row.sessionId !== to) {
      await this.ports.store.mutate(placement.primary, registryPath, (rows) =>
        rows.map((b) => b.path === row.path ? { ...b, sessionId: to } : b))
    }
    return { claimed: true, slug: row.slug, title: displayTitle(row.name, row.slug), path: row.path }
  }

  /** Status facts for a bound session's worktree. */
  async status(sessionId: string): Promise<StatusResult> {
    const cwd = this.ports.getSessionCwd(sessionId)
    if (cwd === null) {
      throw new WorktreeFlowError('unknown-session', 'the session has no cwd yet')
    }
    const placement = await this.ports.git.placement(cwd).catch(fromGit)
    const bindings = await this.reconciled(placement.primary)
    const row = rowForSession(bindings, sessionId)
      ?? rowForCwd(bindings, sessionId, cwd)
    if (row === undefined) {
      throw new WorktreeFlowError('no-worktree-here', 'the session is not bound to a worktree')
    }
    return {
      slug: row.slug,
      title: displayTitle(row.name, row.slug),
      path: row.path,
      branch: row.branch,
      baseRef: row.baseRef,
      status: await this.statusOf(placement.primary, row),
    }
  }

  /** Remove a worktree; dirty refusal surfaces as a structured error. */
  async remove(input: { cwd: string; slug: string; force: boolean }): Promise<void> {
    const placement = await this.ports.git.placement(input.cwd).catch(fromGit)
    const key = setupJobKey(placement.primary, input.slug)
    if (this.setupInFlight.has(key)) {
      throw new WorktreeFlowError(
        'setup-running',
        'setup is still running for this worktree',
        'wait for setup to finish, then delete',
      )
    }
    this.setupJobs.delete(key)
    const registryPath = `${placement.primary}/.dsh/worktrees/registry.json`
    const bindings = await this.reconciled(placement.primary)
    const rows = rowsForSlug(bindings, input.slug)
    if (rows.length === 0) {
      throw new WorktreeFlowError('unknown-slug', `no worktree bound to slug ${input.slug}`)
    }
    await this.ports.git.removeWorktree({
      primary: placement.primary,
      path: rows[0]!.path,
      force: input.force,
    }).catch(fromGit)
    await this.ports.store.mutate(
      placement.primary,
      registryPath,
      (current) => current.filter((row) => row.slug !== input.slug),
    )
  }

  /** Repo-wide topology for the sidebar projection and menus. */
  async topology(cwds: readonly string[]): Promise<TopologyResult> {
    // Every fact below is an independent git spawn; with a dozen
    // worktrees the sequential fan-out cost ~100ms per worktree and the
    // sidebar waited over a second on refresh. Parallelize both levels.
    const primaries = new Map<string, string>()
    const workspaces = await Promise.all(cwds.map((cwd) => this.workspaceFacts(cwd)))
    for (const facts of workspaces) {
      if (facts.canCreate || facts.primary !== '') {
        primaries.set(facts.primary, facts.cwd)
      }
    }
    const repos = await Promise.all([...primaries].map(async ([primary]): Promise<TopologyRepo> => {
      try {
        const bindings = await this.reconciled(primary)
        const [statuses, primaryBranch] = await Promise.all([
          Promise.all(bindings.map((row) => this.statusOf(primary, row))),
          this.ports.git.currentBranch(primary).catch(() => undefined),
        ])
        const worktrees: TopologyWorktree[] = bindings.map((row, index) => ({
          slug: row.slug,
          title: displayTitle(row.name, row.slug),
          path: row.path,
          branch: row.branch,
          baseRef: row.baseRef,
          primaryBranch: primaryBranch ?? '',
          status: statuses[index]!,
          sessionIds: rowsForSlug(bindings, row.slug)
            .map((b) => b.sessionId)
            .filter((id) => id !== ''),
        }))
        return { primary, ok: true, worktrees }
      } catch {
        return { primary, ok: false, worktrees: [] }
      }
    }))
    return { repos, workspaces }
  }

  /** Per-workspace creation facts (the repo-row button gating). */
  private async workspaceFacts(cwd: string): Promise<WorkspaceFacts> {
    try {
      const placement = await this.ports.git.placement(cwd)
      if (placement.insideWorktreesRoot) {
        return { cwd, primary: placement.primary, canCreate: false, reason: 'already-in-worktree' }
      }
      const hasCommits = await this.ports.git.refExists(cwd, 'HEAD')
      if (!hasCommits) {
        return { cwd, primary: placement.primary, canCreate: false, reason: 'no-commits' }
      }
      return { cwd, primary: placement.primary, canCreate: true }
    } catch (error) {
      if (error instanceof GitError) {
        return { cwd, primary: '', canCreate: false, reason: error.code as WorkspaceFacts['reason'] }
      }
      return { cwd, primary: '', canCreate: false, reason: 'git-unavailable' }
    }
  }

  /** True when any listed session (or the bound owner) is running. */
  private anySessionRunning(sessionIds: readonly string[] | undefined, bound: string | undefined): boolean {
    const ids = sessionIds !== undefined && sessionIds.length > 0
      ? sessionIds
      : bound !== undefined && bound !== '' ? [bound] : []
    return ids.some((id) => this.ports.isSessionRunning(id))
  }

  /** Merge preflight: facts and blockers for the confirmation modal. */
  async mergePreflight(input: {
    cwd: string
    slug: string
    sessionIds?: readonly string[]
  }): Promise<MergePreflightResult> {
    const placement = await this.ports.git.placement(input.cwd).catch(fromGit)
    const bindings = await this.reconciled(placement.primary)
    const row = rowsForSlug(bindings, input.slug)[0]
    const slugKnown = row !== undefined
    const sourceBranch = row?.branch === '' ? undefined : row?.branch
    const none: readonly string[] = []
    const [target, versionStdout, dirtyPrimary, dirtyWorktree, branchTip, baseTip] = await Promise.all([
      this.ports.git.currentBranch(placement.primary),
      this.ports.git.versionStdout(),
      slugKnown ? this.ports.git.dirtyPaths(placement.primary) : Promise.resolve(none),
      slugKnown ? this.ports.git.dirtyPaths(row!.path) : Promise.resolve(none),
      slugKnown && sourceBranch !== undefined
        ? this.ports.git.revParse(row!.path, sourceBranch).catch(() => undefined)
        : Promise.resolve(undefined),
      slugKnown ? this.resolveBaseTip(placement.primary, row!) : Promise.resolve(undefined),
    ])
    const gitModern = gitSupportsMergeTree(parseGitVersion(versionStdout))
    // Unknown slug: the remaining facts are noise, not blockers — the
    // modal says "refresh" and nothing else.
    const primaryClean = !slugKnown || dirtyPrimary.length === 0
    const worktreeClean = !slugKnown || dirtyWorktree.length === 0
    // A fresh branch (tip == base) is trivially an ancestor; that is
    // "no unique work yet", not "already merged".
    const alreadyMerged = slugKnown && sourceBranch !== undefined && target !== undefined
      && branchTip !== baseTip
      && await this.ports.git.isAncestor(placement.primary, sourceBranch, target)
    const dryRunRan = gitModern && slugKnown && sourceBranch !== undefined && target !== undefined && !alreadyMerged
    const [dryRunClean, fastForward, aheadCount] = await Promise.all([
      dryRunRan
        ? this.ports.git.mergeTreeClean(placement.primary, target!, sourceBranch!)
        : Promise.resolve(false),
      slugKnown && sourceBranch !== undefined && target !== undefined
        ? this.ports.git.isAncestor(placement.primary, target, sourceBranch)
        : Promise.resolve(false),
      slugKnown && sourceBranch !== undefined
        ? this.ports.git.aheadCount(placement.primary, row!.baseRef, sourceBranch)
        : Promise.resolve(0),
    ])
    const bound = row !== undefined && row.sessionId !== '' ? row.sessionId : undefined
    const verdict = mergeVerdict({
      slugKnown, gitModern, primaryClean, worktreeClean, targetBranch: target, sourceBranch,
      dryRunClean, dryRunRan, alreadyMerged,
      sessionRunning: this.anySessionRunning(input.sessionIds, bound),
    })
    return {
      blockers: verdict.blockers,
      warnings: verdict.warnings,
      green: verdict.green,
      target,
      source: sourceBranch,
      fastForward,
      aheadCount,
      manualCommand: sourceBranch === undefined ? undefined : `git merge ${sourceBranch}`,
      dirtyPrimary,
      dirtyWorktree,
    }
  }

  /** Execute the guarded merge; re-runs the full preflight first. */
  async mergeExecute(input: {
    cwd: string
    slug: string
    sessionIds?: readonly string[]
  }): Promise<MergeExecuteResult> {
    const pre = await this.mergePreflight(input)
    if (!pre.green || pre.target === undefined || pre.source === undefined) {
      throw new WorktreeFlowError(
        'merge-blocked',
        'merge preflight is not green',
        pre.manualCommand ?? 'resolve the blockers and retry',
      )
    }
    const placement = await this.ports.git.placement(input.cwd).catch(fromGit)
    await this.ports.git.merge(placement.primary, pre.source).catch(fromGit)
    return { target: pre.target, source: pre.source, fastForward: pre.fastForward }
  }

  /** Update-from-main preflight: merge the primary branch into the worktree. */
  async updatePreflight(input: {
    cwd: string
    slug: string
    sessionIds?: readonly string[]
  }): Promise<UpdatePreflightResult> {
    const placement = await this.ports.git.placement(input.cwd).catch(fromGit)
    const bindings = await this.reconciled(placement.primary)
    const row = rowsForSlug(bindings, input.slug)[0]
    const slugKnown = row !== undefined
    const targetBranch = row?.branch === '' ? undefined : row?.branch
    const sessionId = row !== undefined && row.sessionId !== '' ? row.sessionId : undefined
    const none: readonly string[] = []
    const [source, dirtyWorktree, inProgress] = await Promise.all([
      this.ports.git.currentBranch(placement.primary),
      slugKnown ? this.ports.git.dirtyPaths(row!.path) : Promise.resolve(none),
      slugKnown ? this.ports.git.merging(row!.path) : Promise.resolve(false),
    ])
    const boundSession = sessionId !== undefined
    const sessionRunning = this.anySessionRunning(input.sessionIds, sessionId)
    const alreadyUpdated = slugKnown && source !== undefined && targetBranch !== undefined && !inProgress
      && await this.ports.git.isAncestor(placement.primary, source, targetBranch)
    const worktreeClean = !slugKnown || dirtyWorktree.length === 0
    const verdict = updateVerdict({
      slugKnown,
      sourceBranch: source,
      targetBranch,
      boundSession,
      sessionRunning,
      inProgress,
      worktreeClean,
      alreadyUpdated,
    })
    const gitModern = gitSupportsMergeTree(parseGitVersion(await this.ports.git.versionStdout()))
    const dryRunRan = gitModern && slugKnown && source !== undefined && targetBranch !== undefined && !alreadyUpdated && !inProgress
    const [wouldConflict, fastForward] = await Promise.all([
      dryRunRan
        ? this.ports.git.mergeTreeClean(placement.primary, targetBranch!, source!).then((clean) => !clean)
        : Promise.resolve(false),
      slugKnown && source !== undefined && targetBranch !== undefined
        ? this.ports.git.isAncestor(placement.primary, targetBranch, source)
        : Promise.resolve(false),
    ])
    return {
      blockers: verdict.blockers,
      green: verdict.green,
      source,
      target: targetBranch,
      fastForward,
      wouldConflict,
      inProgress,
      sessionId,
      manualCommand: source === undefined ? undefined : `git merge ${source}`,
      dirtyWorktree,
    }
  }

  /**
   * Start (or complete) the update merge inside the worktree. A conflict
   * outcome is success: the tree is left MERGING for the bound session.
   */
  async updateExecute(input: {
    cwd: string
    slug: string
    sessionIds?: readonly string[]
  }): Promise<UpdateExecuteResult> {
    const pre = await this.updatePreflight(input)
    if (!pre.green || pre.source === undefined || pre.target === undefined || pre.sessionId === undefined) {
      throw new WorktreeFlowError(
        'update-blocked',
        'update preflight is not green',
        pre.manualCommand ?? 'resolve the blockers and retry',
      )
    }
    const placement = await this.ports.git.placement(input.cwd).catch(fromGit)
    const bindings = await this.reconciled(placement.primary)
    const row = rowsForSlug(bindings, input.slug)[0]
    if (row === undefined) {
      throw new WorktreeFlowError('unknown-slug', `no worktree bound to slug ${input.slug}`)
    }
    const outcome = await this.ports.git.mergeAllowConflicts(row.path, pre.source).catch(fromGit)
    return {
      source: pre.source,
      target: pre.target,
      fastForward: pre.fastForward,
      conflict: outcome === 'conflict',
      sessionId: pre.sessionId,
    }
  }

  /** Abort an in-flight update merge inside the worktree. */
  async updateAbort(input: { cwd: string; slug: string }): Promise<void> {
    const placement = await this.ports.git.placement(input.cwd).catch(fromGit)
    const bindings = await this.reconciled(placement.primary)
    const row = rowsForSlug(bindings, input.slug)[0]
    if (row === undefined) {
      throw new WorktreeFlowError('unknown-slug', `no worktree bound to slug ${input.slug}`)
    }
    const inProgress = await this.ports.git.merging(row.path)
    if (!inProgress) {
      throw new WorktreeFlowError('not-in-progress', 'this worktree is not in the middle of a merge')
    }
    await this.ports.git.mergeAbort(row.path).catch(fromGit)
  }

  /** The commit this worktree was branched from (pinned SHA, else live at primary). */
  private resolveBaseTip(primary: string, row: WorktreeBinding): Promise<string | undefined> {
    if (row.baseSha !== '') return Promise.resolve(row.baseSha)
    // Legacy rows: resolve at the primary so a stored HEAD is the repo's
    // HEAD, not the worktree branch.
    return this.ports.git.revParse(primary, row.baseRef).catch(() => undefined)
  }

  private async statusOf(primary: string, row: WorktreeBinding): Promise<WorktreeStatus> {
    const branch = row.branch === '' ? undefined : row.branch
    // Independent git answers run concurrently; only the ancestry probe
    // waits on the primary's branch name.
    const [dirtyCount, ahead, target, branchTip, baseTip, merging] = await Promise.all([
      this.ports.git.dirtyCount(row.path).catch(() => 0),
      // Count from the primary so a stored symbolic base (HEAD, origin/HEAD)
      // resolves there, not inside the worktree where HEAD *is* the branch.
      branch === undefined ? Promise.resolve(0) : this.ports.git.aheadCount(primary, row.baseRef, branch).catch(() => 0),
      this.ports.git.currentBranch(primary).catch(() => undefined),
      branch === undefined ? Promise.resolve(undefined) : this.ports.git.revParse(row.path, branch).catch(() => undefined),
      this.resolveBaseTip(primary, row),
      this.ports.git.merging(row.path).catch(() => false),
    ])
    const mergedIntoTarget = branch === undefined || target === undefined
      ? false
      : await this.ports.git.isAncestor(primary, branch, target).catch(() => false)
    // Fresh-worktree discriminator: tip == base means no unique work yet,
    // never "merged" (see worktreeStatus).
    const tipEqualsBase = branchTip !== undefined && branchTip === baseTip
    return worktreeStatus({
      dirtyCount,
      aheadCount: ahead,
      mergedIntoTarget,
      tipEqualsBase,
      merging,
    })
  }

  /** Bindings reconciled against `git worktree list`; stale rows dropped. */
  private async reconciled(primary: string): Promise<readonly WorktreeBinding[]> {
    const path = `${primary}/.dsh/worktrees/registry.json`
    const [file, worktrees] = await Promise.all([
      this.ports.store.load(primary),
      this.ports.git.listWorktrees(primary),
    ])
    const initial = reconcile(file.bindings, worktrees)
    if (initial.dropped.length === 0 && !initial.changed) return initial.kept

    // Git collection cannot share the registry lock, but persistence must.
    // Reconcile only rows observed before that collection; a row added after
    // the snapshot is unknown to this Git list and must not be pruned here.
    const observed = new Set(file.bindings.map(bindingKey))
    return this.ports.store.mutate(primary, path, (current) => current.flatMap((row) =>
      observed.has(bindingKey(row)) ? reconcile([row], worktrees).kept : [row],
    ))
  }
}

/**
 * Whether a `.worktreeinclude` entry is safe to copy. Absolute paths and
 * `..` segments would read/write outside the worktree.
 */
function isUnsafeInclude(entry: string): boolean {
  const posix = entry.replace(/\\/g, '/')
  if (posix.startsWith('/') || /^[a-zA-Z]:/.test(posix)) return true
  return posix.split('/').includes('..')
}

function parentDir(path: string): string {
  const posix = path.replace(/\\/g, '/')
  const at = posix.lastIndexOf('/')
  return at <= 0 ? posix : posix.slice(0, at)
}

/** Stable identity for a row observed before an asynchronous Git read. */
function bindingKey(row: WorktreeBinding): string {
  return `${row.path}\u0000${row.createdAt}`
}

/** Slugs repeat across repositories, so setup state needs the checkout too. */
function setupJobKey(primary: string, slug: string): string {
  return `${primary}\u0000${slug}`
}

const SETUP_OUTPUT_MAX = 4_000

/** Tail of a failed setup command, if anything was printed. */
function clipSetupOutput(raw: string): string | undefined {
  const trimmed = raw.trim()
  if (trimmed === '') return undefined
  return trimmed.length <= SETUP_OUTPUT_MAX ? trimmed : trimmed.slice(-SETUP_OUTPUT_MAX)
}

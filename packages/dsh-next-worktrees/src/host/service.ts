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
 * - one writer per worktree: a session takes over only an unclaimed row.
 */
import { mergeVerdict, parseGitVersion, gitSupportsMergeTree, type MergeBlocker, type MergeWarning } from '../core/merge.ts'
import { updateVerdict, type UpdateBlocker } from '../core/update.ts'
import {
  reconcile,
  rowForCwd,
  rowForSession,
  rowsForSlug,
  type WorktreeBinding,
} from '../core/registry.ts'
import { nextSlug, normalizeName, suggestName, displayTitle } from '../core/slug.ts'
import {
  parseWorktreesJson,
  resolveSetupSteps,
  setupPlatform,
  worktreesJsonCandidates,
  SETUP_ENV_ROOT,
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

const fromGit = (error: unknown): never => {
  if (error instanceof GitError) {
    throw new WorktreeFlowError(error.code, error.message, error.hint)
  }
  throw error
}

/** The orchestration service. Constructed once by the host entry. */
export class WorktreesService {
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
    const baseRef = input.baseRef ?? await this.ports.git.defaultBaseRef(input.cwd)
    const hasCommits = await this.ports.git.refExists(input.cwd, 'HEAD')
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
    const bindings = await this.reconciled(placement.primary)
    const taken = [
      ...bindings.map((b) => b.slug),
    ]
    const slug = nextSlug({ takenSlugs: taken, seed: this.ports.seed })
    const name = normalizeName(input.name ?? '')
    const path = `${placement.worktreesRoot}/${slug}`
    const branch = `dsh-worktrees/${slug}`
    await this.ports.git.addWorktree({
      primary: placement.primary,
      path,
      branch,
      baseRef,
    }).catch(fromGit)
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
    try {
      await this.runWorktreesSetup(placement.primary, path)
    } catch (error) {
      await this.ports.git.removeWorktree({
        primary: placement.primary,
        path,
        force: true,
      }).catch(() => {})
      await this.ports.store.mutate(placement.primary, registryPath, (rows) =>
        rows.filter((row) => row.slug !== slug),
      ).catch(() => {})
      throw error
    }
    return { slug, name, title: displayTitle(name, slug), path, branch, baseRef, relPath: placement.relPath }
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

  /**
   * Run `.dsh/worktrees.json` (local override) or `.worktrees.json` at the
   * repo root. Missing file → no-op. Invalid file or a failed command
   * throws; create rolls the worktree back.
   */
  private async runWorktreesSetup(primary: string, worktreePath: string): Promise<void> {
    const readText = this.ports.readText
    const runCommand = this.ports.runCommand
    if (readText === undefined || runCommand === undefined) return
    let jsonPath: string | undefined
    let raw: string | undefined
    for (const candidate of worktreesJsonCandidates(primary)) {
      const text = await readText(candidate)
      if (text !== null) {
        jsonPath = candidate
        raw = text
        break
      }
    }
    if (jsonPath === undefined || raw === undefined) return
    const parsed = parseWorktreesJson(raw)
    if ('error' in parsed) {
      throw new WorktreeFlowError('setup-invalid', parsed.error)
    }
    const steps = resolveSetupSteps(parsed, setupPlatform(this.ports.platform ?? 'linux'))
    if ('error' in steps) {
      throw new WorktreeFlowError('setup-invalid', steps.error)
    }
    const jsonDir = parentDir(jsonPath)
    const env = { [SETUP_ENV_ROOT]: primary }
    for (const step of steps) {
      const result = step.kind === 'command'
        ? await runCommand({ command: step.command, cwd: worktreePath, env })
        : await runCommand({ script: `${jsonDir}/${step.path}`, cwd: worktreePath, env })
      if (result.code !== 0) {
        const label = step.kind === 'command' ? step.command : step.path
        throw new WorktreeFlowError(
          'setup-failed',
          `setup command failed: ${label}`,
          (result.stderr || result.stdout).trim() || undefined,
        )
      }
    }
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
      ?? rowForCwd(bindings, sessionId, cwd)
    if (row === undefined) {
      throw new WorktreeFlowError('no-worktree-here',
        'the session cwd is not inside a plugin worktree')
    }
    if (row.sessionId !== sessionId) {
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
    await this.ports.store.replaceAll(
      placement.primary,
      registryPath,
      bindings.filter((b) => b.slug !== input.slug),
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

  /** Merge preflight: facts and blockers for the confirmation modal. */
  async mergePreflight(input: { cwd: string; slug: string }): Promise<MergePreflightResult> {
    const placement = await this.ports.git.placement(input.cwd).catch(fromGit)
    const bindings = await this.reconciled(placement.primary)
    const row = rowsForSlug(bindings, input.slug)[0]
    const slugKnown = row !== undefined
    const none: readonly string[] = []
    const [target, versionStdout, dirtyPrimary, dirtyWorktree, branchTip, baseTip] = await Promise.all([
      this.ports.git.currentBranch(placement.primary),
      this.ports.git.versionStdout(),
      slugKnown ? this.ports.git.dirtyPaths(placement.primary) : Promise.resolve(none),
      slugKnown ? this.ports.git.dirtyPaths(row!.path) : Promise.resolve(none),
      slugKnown
        ? this.ports.git.revParse(row!.path, row!.branch).catch(() => undefined)
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
    const alreadyMerged = slugKnown && target !== undefined
      && branchTip !== baseTip
      && await this.ports.git.isAncestor(placement.primary, row!.branch, target)
    const dryRunRan = gitModern && slugKnown && target !== undefined && !alreadyMerged
    const [dryRunClean, fastForward, aheadCount] = await Promise.all([
      dryRunRan
        ? this.ports.git.mergeTreeClean(placement.primary, target!, row!.branch)
        : Promise.resolve(false),
      slugKnown && target !== undefined
        ? this.ports.git.isAncestor(placement.primary, target, row!.branch)
        : Promise.resolve(false),
      slugKnown
        ? this.ports.git.aheadCount(placement.primary, row!.baseRef, row!.branch)
        : Promise.resolve(0),
    ])
    const verdict = mergeVerdict({
      slugKnown, gitModern, primaryClean, worktreeClean, targetBranch: target,
      dryRunClean, dryRunRan, alreadyMerged,
    })
    const source = row?.branch
    return {
      blockers: verdict.blockers,
      warnings: verdict.warnings,
      green: verdict.green,
      target,
      source,
      fastForward,
      aheadCount,
      manualCommand: source === undefined ? undefined : `git merge ${source}`,
      dirtyPrimary: slugKnown ? dirtyPrimary : none,
      dirtyWorktree: slugKnown ? dirtyWorktree : none,
    }
  }

  /** Execute the guarded merge; re-runs the full preflight first. */
  async mergeExecute(input: { cwd: string; slug: string }): Promise<MergeExecuteResult> {
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
  async updatePreflight(input: { cwd: string; slug: string }): Promise<UpdatePreflightResult> {
    const placement = await this.ports.git.placement(input.cwd).catch(fromGit)
    const bindings = await this.reconciled(placement.primary)
    const row = rowsForSlug(bindings, input.slug)[0]
    const slugKnown = row !== undefined
    const sessionId = row !== undefined && row.sessionId !== '' ? row.sessionId : undefined
    const none: readonly string[] = []
    const [source, dirtyWorktree, inProgress] = await Promise.all([
      this.ports.git.currentBranch(placement.primary),
      slugKnown ? this.ports.git.dirtyPaths(row!.path) : Promise.resolve(none),
      slugKnown ? this.ports.git.merging(row!.path) : Promise.resolve(false),
    ])
    const boundSession = sessionId !== undefined
    const sessionRunning = boundSession && this.ports.isSessionRunning(sessionId)
    const alreadyUpdated = slugKnown && source !== undefined && !inProgress
      && await this.ports.git.isAncestor(placement.primary, source, row!.branch)
    const worktreeClean = !slugKnown || dirtyWorktree.length === 0
    const verdict = updateVerdict({
      slugKnown,
      sourceBranch: source,
      boundSession,
      sessionRunning,
      inProgress,
      worktreeClean,
      alreadyUpdated,
    })
    const gitModern = gitSupportsMergeTree(parseGitVersion(await this.ports.git.versionStdout()))
    const dryRunRan = gitModern && slugKnown && source !== undefined && !alreadyUpdated && !inProgress
    const [wouldConflict, fastForward] = await Promise.all([
      dryRunRan
        ? this.ports.git.mergeTreeClean(placement.primary, row!.branch, source!).then((clean) => !clean)
        : Promise.resolve(false),
      slugKnown && source !== undefined
        ? this.ports.git.isAncestor(placement.primary, row!.branch, source)
        : Promise.resolve(false),
    ])
    return {
      blockers: verdict.blockers,
      green: verdict.green,
      source,
      target: row?.branch,
      fastForward,
      wouldConflict,
      inProgress,
      sessionId,
      manualCommand: source === undefined ? undefined : `git merge ${source}`,
      dirtyWorktree: slugKnown ? dirtyWorktree : none,
    }
  }

  /**
   * Start (or complete) the update merge inside the worktree. A conflict
   * outcome is success: the tree is left MERGING for the bound session.
   */
  async updateExecute(input: { cwd: string; slug: string }): Promise<UpdateExecuteResult> {
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
    // Independent git answers run concurrently; only the ancestry probe
    // waits on the primary's branch name.
    const [dirtyCount, ahead, target, branchTip, baseTip, merging] = await Promise.all([
      this.ports.git.dirtyCount(row.path).catch(() => 0),
      // Count from the primary so a stored symbolic base (HEAD, origin/HEAD)
      // resolves there, not inside the worktree where HEAD *is* the branch.
      this.ports.git.aheadCount(primary, row.baseRef, row.branch).catch(() => 0),
      this.ports.git.currentBranch(primary).catch(() => undefined),
      this.ports.git.revParse(row.path, row.branch).catch(() => undefined),
      this.resolveBaseTip(primary, row),
      this.ports.git.merging(row.path).catch(() => false),
    ])
    const mergedIntoTarget = target === undefined
      ? false
      : await this.ports.git.isAncestor(primary, row.branch, target).catch(() => false)
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
    const { kept, dropped } = reconcile(file.bindings, worktrees)
    if (dropped.length > 0) {
      await this.ports.store.replaceAll(primary, path, kept)
    }
    return kept
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

/** Name suggestion for the create modal prefill. */
export function nameSuggestion(seed: number): string {
  return suggestName(seed)
}

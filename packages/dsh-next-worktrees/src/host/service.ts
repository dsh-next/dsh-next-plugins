/**
 * Worktrees orchestration service — every RPC's implementation.
 *
 * Invariants enforced here (docs/ideas/dsh-next-worktrees.md):
 * - git is the truth: every read reconciles the sidecar against
 *   `git worktree list`; every write is serialized per repo.
 * - user text never reaches a branch (slug-only refs; Name is display).
 * - the only writes to the user's checkout are the guarded worktree-add /
 *   worktree-remove pair and the preflighted merge.
 * - one writer per worktree: a session takes over only an unclaimed row.
 */
import { randomUUID } from 'node:crypto'
import { mergeVerdict, parseGitVersion, gitSupportsMergeTree, type MergeBlocker } from '../core/merge.ts'
import {
  reconcile,
  rowForCwd,
  rowForSession,
  rowsForSlug,
  type WorktreeBinding,
} from '../core/registry.ts'
import { nextSlug, normalizeName, suggestName, displayTitle } from '../core/slug.ts'
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

export interface ServicePorts {
  readonly git: GitPorts
  readonly store: RegistryStorePorts
  readonly getSessionCwd: GetSessionCwd
  readonly applySandboxMode: ApplySandboxMode
  /**
   * Copy one file for `.worktreeinclude` replication; a no-op when the
   * source is missing (best-effort convention).
   */
  readonly copyFile: (from: string, to: string) => Promise<void>
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
  /** Whether the worktree button may open the create modal here. */
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
  readonly green: boolean
  readonly target?: string
  readonly source?: string
  readonly fastForward: boolean
  readonly aheadCount: number
  readonly manualCommand?: string
}

export interface MergeExecuteResult {
  readonly target: string
  readonly source: string
  readonly fastForward: boolean
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
        role: 'owner' as const,
        createdAt: Date.now(),
      },
    ])
    await this.copyWorktreeInclude(placement.primary, placement.relPath, path)
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
      const from = join(primary, relPath, entry)
      const to = join(worktreePath, relPath, entry)
      await this.ports.copyFile(from, to)
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
    this.ports.applySandboxMode(sessionId, 'danger-full-access')
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
    const primaries = new Map<string, string>()
    const workspaces: WorkspaceFacts[] = []
    for (const cwd of cwds) {
      const facts = await this.workspaceFacts(cwd)
      workspaces.push(facts)
      if (facts.canCreate || facts.primary !== '') {
        primaries.set(facts.primary, facts.cwd)
      }
    }
    const repos: TopologyRepo[] = []
    for (const [primary] of primaries) {
      try {
        const bindings = await this.reconciled(primary)
        const worktrees: TopologyWorktree[] = []
        for (const row of bindings) {
          const status = await this.statusOf(primary, row)
          worktrees.push({
            slug: row.slug,
            title: displayTitle(row.name, row.slug),
            path: row.path,
            branch: row.branch,
            baseRef: row.baseRef,
            status,
            sessionIds: rowsForSlug(bindings, row.slug)
              .map((b) => b.sessionId)
              .filter((id) => id !== ''),
          })
        }
        repos.push({ primary, ok: true, worktrees })
      } catch {
        repos.push({ primary, ok: false, worktrees: [] })
      }
    }
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
    const target = await this.ports.git.currentBranch(placement.primary)
    const version = parseGitVersion(await this.ports.git.versionStdout())
    const gitModern = gitSupportsMergeTree(version)
    const slugKnown = row !== undefined
    // Unknown slug: the remaining facts are noise, not blockers — the
    // modal says "refresh" and nothing else.
    const primaryClean = !slugKnown || (await this.ports.git.dirtyCount(placement.primary)) === 0
    const worktreeClean = !slugKnown || (await this.ports.git.dirtyCount(row!.path)) === 0
    let alreadyMerged = false
    if (slugKnown && target !== undefined) {
      const [branchTip, baseTip] = await Promise.all([
        this.ports.git.revParse(row!.path, row!.branch).catch(() => undefined),
        this.ports.git.revParse(row!.path, row!.baseRef).catch(() => undefined),
      ])
      // A fresh branch (tip == base) is trivially an ancestor; that is
      // "no unique work yet", not "already merged".
      alreadyMerged = branchTip !== baseTip
        && await this.ports.git.isAncestor(placement.primary, row!.branch, target)
    }
    const dryRunRan = gitModern && slugKnown && target !== undefined && !alreadyMerged
    const dryRunClean = dryRunRan
      ? await this.ports.git.mergeTreeClean(placement.primary, target!, row!.branch)
      : false
    const fastForward = slugKnown && target !== undefined
      ? await this.ports.git.isAncestor(placement.primary, target, row!.branch)
      : false
    const aheadCount = slugKnown
      ? await this.ports.git.aheadCount(row!.path, row!.baseRef, row!.branch)
      : 0
    const verdict = mergeVerdict({
      slugKnown, gitModern, primaryClean, worktreeClean, targetBranch: target,
      dryRunClean, dryRunRan, alreadyMerged,
    })
    const source = row?.branch
    return {
      blockers: verdict.blockers,
      green: verdict.green,
      target,
      source,
      fastForward,
      aheadCount,
      manualCommand: source === undefined ? undefined : `git merge ${source}`,
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

  private async statusOf(primary: string, row: WorktreeBinding): Promise<WorktreeStatus> {
    const dirtyCount = await this.ports.git.dirtyCount(row.path).catch(() => 0)
    const ahead = await this.ports.git.aheadCount(row.path, row.baseRef, row.branch).catch(() => 0)
    const target = await this.ports.git.currentBranch(primary).catch(() => undefined)
    const mergedIntoTarget = target === undefined
      ? false
      : await this.ports.git.isAncestor(primary, row.branch, target).catch(() => false)
    // Fresh-worktree discriminator: tip == base means no unique work yet,
    // never "merged" (see worktreeStatus).
    const [branchTip, baseTip] = await Promise.all([
      this.ports.git.revParse(row.path, row.branch).catch(() => undefined),
      this.ports.git.revParse(row.path, row.baseRef).catch(() => undefined),
    ])
    const tipEqualsBase = branchTip !== undefined && branchTip === baseTip
    return worktreeStatus({ dirtyCount, aheadCount: ahead, mergedIntoTarget, tipEqualsBase })
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

/** Name suggestion for the create modal prefill. */
export function nameSuggestion(seed: number): string {
  return suggestName(seed)
}

/** Reserved for the M2 shuttle preflight (request correlation). */
export function newRequestId(): string {
  return randomUUID()
}

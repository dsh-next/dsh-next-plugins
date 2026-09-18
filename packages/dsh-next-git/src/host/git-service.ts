/**
 * The host git service: every read and write the panel performs.
 *
 * Shape of the module:
 *
 * - `resolveRepo` finds the repository a session runs in, and classifies the
 *   ways there may not be one (no git, not a repository, bare, denied).
 * - The read methods (`state`, `diff`, `history`) never mutate.
 * - The write methods assume their preflight already ran; each is wrapped in
 *   the runner's per-repository mutation lock, so the panel and the session's
 *   own agent can never interleave an index update.
 *
 * Parsing lives in `core/`; this file runs processes and assembles envelopes.
 */

import { basename, dirname, isAbsolute, join, resolve as resolvePath } from 'node:path'
import {
  classifyGitFailure,
  degradedFrom,
  MIN_GIT_VERSION,
  parseGitVersion,
  tooOldFailure,
  type GitVersion,
} from '../core/degraded.ts'
import { addedFileDiff, applyNumstat, parseNumstat, parseUnifiedDiff } from '../core/diff.ts'
import { buildHistory, LOG_FORMAT, parseLog } from '../core/log.ts'
import {
  BRANCH_FORMAT,
  localBranches,
  localNameForRemote,
  parseBranches,
  validateBranchName,
} from '../core/branches.ts'
import { draftCommitMessage } from '../core/commit-message.ts'
import { detectOperation, type OperationMarkers } from '../core/operation.ts'
import { changedPaths, parsePorcelainV2, summarizeChanges } from '../core/porcelain.ts'
import { decidePreflight, type PreflightInput } from '../core/preflight.ts'
import {
  describeWorktrees,
  INCLUDE_FILE,
  isUnsafeRelativePath,
  normalizeSlug,
  parseSetupFile,
  parseWorktreeInclude,
  parseWorktreeList,
  planWorktree,
  localBranchForRemoteRef,
  resolveSetupSteps,
  resolveWorktreeBase,
  slugForRef,
  SETUP_FILE,
  setupPlatform,
  shortBranch,
  slugFromBranch,
  validateSlug,
  withWorktreesExcluded,
  WORKTREE_BRANCH_PREFIX,
  worktreePathFor,
  type WorktreeEnrichment,
} from '../core/worktree.ts'
import { GitError, GitRunner, STATUS_TIMEOUT_MS, WRITE_TIMEOUT_MS, type CancellationRegistry } from './git-runner.ts'
import type { FsPorts } from './fs-adapter.ts'
import { runSetupSteps, type SetupExec } from './setup-exec.ts'
import type {
  BranchInfo,
  DiffFile,
  DiffResult,
  DiffSide,
  HistoryPage,
  OperationState,
  PanelState,
  PreflightAction,
  PreflightDecision,
  ReclaimResult,
  SetupReport,
  SetupStep,
  StatePayload,
  WorktreeInfo,
  WorktreePlan,
} from '../core/types.ts'

/** Ignored paths listed before the list is replaced by a count. */
export const IGNORED_LIST_LIMIT = 200

/** Injectables, so the service is testable without a real profile. */
export interface GitServicePorts {
  readonly runner: GitRunner
  readonly fs: FsPorts
  /** Resolve a session's working directory. */
  readonly cwdOf: (sessionId: string) => string | undefined
  /** Node platform string (`process.platform`). */
  readonly platform: string
  /** Parent environment for setup steps. */
  readonly env: Readonly<Record<string, string | undefined>>
  /** Injectable `.worktrees.json` executor. */
  readonly setupExec?: SetupExec
  /** Cancellation registry for the cancellable reads and a hanging hook. */
  readonly cancellations?: CancellationRegistry
  readonly logWarn?: (message: string) => void
}

/** Where a session's git work happens. */
export interface RepoRef {
  /** Primary worktree root (the main checkout); worktree operations run here. */
  readonly root: string
  /** The working tree the session's cwd is in (may be a linked worktree). */
  readonly toplevel: string
  /** Absolute git directory of `toplevel` (where MERGE_HEAD and friends live). */
  readonly gitDir: string
  /** Absolute common git directory (`<root>/.git`). */
  readonly commonDir: string
  /** The directory the session runs in. */
  readonly cwd: string
}

/** Options every read accepts. */
export interface ReadOptions {
  readonly signal?: AbortSignal | undefined
}

/** A source location for an operation: a session, or an explicit cwd. */
export interface SourceRef {
  readonly sessionId?: string
  readonly cwd?: string
}

/**
 * The service.
 *
 * Constructed once by the host entry; holds only the cached git version.
 */
export class GitService {
  private version: GitVersion | null | undefined
  /** Reports of the last setup run per worktree path. */
  private readonly setupReports = new Map<string, SetupReport>()

  constructor(private readonly ports: GitServicePorts) {}

  /* ----------------------------------------------------------- discovery */

  /**
   * The installed git version, or null when git cannot be spawned.
   *
   * @returns the parsed version; cached after the first call.
   */
  async gitVersion(signal?: AbortSignal): Promise<GitVersion | null> {
    if (this.version !== undefined) return this.version
    const outcome = await this.ports.runner.run(['--version'], cwdOrHome(), {
      timeoutMs: 10_000,
      ...(signal === undefined ? {} : { signal }),
    })
    if (outcome.code !== 0) {
      this.version = null
      return null
    }
    this.version = parseGitVersion(outcome.stdout)
    return this.version
  }

  /** Throw the degraded failure when git is missing or below the floor. */
  private async requireGit(signal?: AbortSignal): Promise<GitVersion> {
    const version = await this.gitVersion(signal)
    if (version === null) {
      throw new GitError({ code: 'git-unavailable', detail: 'git is not runnable on PATH' })
    }
    const required = parseGitVersion(MIN_GIT_VERSION)
    if (required !== null && compareVersionNumbers(version, required) < 0) {
      throw new GitError(tooOldFailure(version))
    }
    return version
  }

  /**
   * Resolve the repository a session runs in.
   *
   * @param cwd - the directory to treat as the session's root.
   * @returns the repository reference.
   * @throws GitError with `git-unavailable`, `not-a-repository`, `bare-repository` or `permission-denied`.
   */
  async resolveRepo(cwd: string, signal?: AbortSignal): Promise<RepoRef> {
    await this.requireGit(signal)
    const run = (args: readonly string[]) =>
      this.ports.runner.run(args, cwd, {
        timeoutMs: STATUS_TIMEOUT_MS,
        ...(signal === undefined ? {} : { signal }),
      })

    const commonOutcome = await run(['rev-parse', '--path-format=absolute', '--git-common-dir'])
    if (commonOutcome.code !== 0) throw new GitError(classifyGitFailure(commonOutcome))
    const commonDir = commonOutcome.stdout.trim()
    if (commonDir === '') throw new GitError({ code: 'not-a-repository', detail: cwd })

    const topOutcome = await run(['rev-parse', '--show-toplevel'])
    if (topOutcome.code !== 0) {
      const failure = classifyGitFailure(topOutcome)
      if (failure.code === 'bare-repository') throw new GitError(failure)
      // `--git-common-dir` resolved but there is no working tree: a bare
      // repository with a git dir that is not named `.git`.
      if (failure.code === 'git-failed' || failure.code === 'path-missing') {
        throw new GitError({ code: 'bare-repository', detail: commonDir })
      }
      throw new GitError(failure)
    }
    const toplevel = topOutcome.stdout.trim()
    const gitDirOutcome = await run(['rev-parse', '--absolute-git-dir'])
    const gitDir = gitDirOutcome.code === 0 && gitDirOutcome.stdout.trim() !== ''
      ? gitDirOutcome.stdout.trim()
      : join(toplevel, '.git')

    const root = basename(commonDir) === '.git' ? dirname(commonDir) : commonDir
    return { root, toplevel, gitDir, commonDir, cwd }
  }

  /** Resolve the session's repository, or a provided cwd in tests. */
  async repoFor(input: SourceRef, signal?: AbortSignal): Promise<RepoRef> {
    const cwd = input.cwd ?? (input.sessionId === undefined ? undefined : this.ports.cwdOf(input.sessionId))
    if (cwd === undefined || cwd === '') {
      throw new GitError({ code: 'not-a-repository', detail: 'session has no working directory' })
    }
    return this.resolveRepo(cwd, signal)
  }

  /* --------------------------------------------------------------- reads */

  /**
   * The whole panel in one round trip.
   *
   * @param input - session (or explicit cwd) to read.
   * @param options - cancellation.
   * @returns repository state, or a terminal failure.
   */
  async state(
    input: SourceRef & { includeIgnored?: boolean; base?: string },
    options: ReadOptions = {},
  ): Promise<StatePayload> {
    const repo = await this.repoFor(input, options.signal)
    const state = await this.readState(repo, input.includeIgnored === true, options.signal, input.base)
    return { state, notice: null }
  }

  /**
   * Read the panel state for an already-resolved repository.
   *
   * @param repo - the resolved repository.
   * @param includeIgnored - whether to include the ignored-path list.
   * @param signal - cancellation.
   * @param requestedBase - a branch the panel picked for the worktree columns.
   */
  async readState(
    repo: RepoRef,
    includeIgnored: boolean,
    signal?: AbortSignal,
    requestedBase?: string,
  ): Promise<PanelState> {
    const statusRaw = await this.ports.runner.runOk(
      // `--branch` is what makes porcelain v2 emit the `# branch.*` headers.
      ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all', '--ignored=matching'],
      repo.cwd,
      { timeoutMs: STATUS_TIMEOUT_MS, ...(signal === undefined ? {} : { signal }) },
    )
    const report = parsePorcelainV2(statusRaw)
    const ignoredEntries = report.entries.filter((entry) => entry.ignored)
    const changes = summarizeChanges(report.entries, {
      includeIgnored,
      ignoredCount: ignoredEntries.length,
      ignoredLimit: IGNORED_LIST_LIMIT,
      ignoredTruncated: ignoredEntries.length > IGNORED_LIST_LIMIT,
    })

    const markers = await this.readOperationMarkers(repo.gitDir)
    const operation = detectOperation(markers, report.entries)
    const branches = await this.readBranches(repo.cwd, signal)
    const worktreeBase = resolveWorktreeBase({
      defaultBranch: await this.defaultBranch(repo, signal),
      primaryBranch: await this.primaryBranch(repo, signal),
      requested: requestedBase ?? null,
      candidates: branches.filter((branch) => !branch.remote).map((branch) => branch.name),
    })
    const worktrees = await this.readWorktrees(repo, signal, worktreeBase.name)
    const tags = await this.readTags(repo, signal)
    const identity = await this.readIdentity(repo.toplevel, signal)

    return {
      root: repo.root,
      gitDir: repo.gitDir,
      bare: false,
      head: report.head,
      operation,
      changes,
      worktrees,
      worktreeBase,
      branches,
      tags,
      identity,
      cwd: repo.cwd,
    }
  }

  /** The diff of one path on one side of the index. */
  async diff(
    input: SourceRef & { path: string; side: DiffSide; oldPath?: string },
    options: ReadOptions = {},
  ): Promise<DiffResult> {
    const repo = await this.repoFor(input, options.signal)
    const side = input.side
    const path = input.path
    const base = side === 'staged' ? ['diff', '--cached'] : ['diff']
    const signalArgs = options.signal === undefined ? {} : { signal: options.signal }
    // A rename needs both paths in the pathspec: limiting to the new path
    // makes git drop rename detection and report a plain add instead.
    const pathspec = input.oldPath === undefined ? ['--', path] : ['--', input.oldPath, path]

    const patch = await this.ports.runner.runSoft([...base, ...pathspec], repo.cwd, {
      timeoutMs: STATUS_TIMEOUT_MS,
      ...signalArgs,
    })
    const numstat = await this.ports.runner.runSoft([...base, '--numstat', '-z', ...pathspec], repo.cwd, {
      timeoutMs: STATUS_TIMEOUT_MS,
      ...signalArgs,
    })

    if (patch === null || patch.trim() === '') {
      // Untracked paths have no diff at all; synthesize one so the panel can
      // still show the file's content.
      const synthetic = await this.syntheticUntracked(repo, path, options.signal)
      if (synthetic !== null && side === 'unstaged') {
        return { path, side, file: synthetic, empty: false }
      }
      return { path, side, file: null, empty: true }
    }

    const files = applyNumstat(parseUnifiedDiff(patch), parseNumstat(numstat ?? ''))
    const file = files.find((entry) => entry.path === path) ?? files[0] ?? null
    return { path, side, file, empty: file === null }
  }

  /** Synthesize the diff of an untracked file, or null when it is not untracked. */
  private async syntheticUntracked(repo: RepoRef, path: string, signal?: AbortSignal): Promise<DiffFile | null> {
    const statusRaw = await this.ports.runner.runSoft(
      ['status', '--porcelain=v2', '-z', '--untracked-files=all', '--', path],
      repo.cwd,
      { timeoutMs: STATUS_TIMEOUT_MS, ...(signal === undefined ? {} : { signal }) },
    )
    if (statusRaw === null) return null
    const entry = parsePorcelainV2(statusRaw).entries.find((candidate) => candidate.path === path)
    if (entry === undefined || !entry.untracked) return null
    const absolute = isAbsolute(path) ? path : join(repo.root, path)
    const contents = await this.ports.fs.readText(absolute)
    if (contents === null) return null
    if (contents.includes('\u0000')) return addedFileDiff(path, '', { binary: true })
    return addedFileDiff(path, contents)
  }

  /** A page of history with computed graph lanes. */
  async history(
    input: SourceRef & { limit?: number; skip?: number },
    options: ReadOptions = {},
  ): Promise<HistoryPage> {
    const repo = await this.repoFor(input, options.signal)
    const limit = Math.max(1, Math.min(input.limit ?? 50, 500))
    const skip = Math.max(0, input.skip ?? 0)
    const raw = await this.ports.runner.runOk(
      ['log', '-z', `--pretty=format:${LOG_FORMAT}`, '-n', String(limit + 1), '--skip', String(skip)],
      repo.cwd,
      { timeoutMs: STATUS_TIMEOUT_MS, ...(options.signal === undefined ? {} : { signal: options.signal }) },
    )
    // One extra row is fetched so the page can say whether more exist; the
    // window itself is still exactly `limit`.
    const page = buildHistory(parseLog(raw), { limit })
    return { ...page, commits: page.commits.slice(0, limit), lanes: page.lanes.slice(0, limit) }
  }

  /* -------------------------------------------------------- classification */

  /** Run the preflight model for one action against live state. */
  async preflight(
    input: SourceRef & { action: PreflightAction; target?: string },
    options: ReadOptions = {},
  ): Promise<PreflightDecision> {
    const state = (await this.state(input, options)).state
    return decidePreflight(this.preflightInput(state, input.action, input.target))
  }

  /** Assemble the model's input from a read state. */
  preflightInput(state: PanelState, action: PreflightAction, target?: string): PreflightInput {
    const modified = state.changes.unstaged
      .filter((entry) => entry.unmerged === undefined)
      .map((entry) => entry.path)
    const untracked = state.changes.untracked.map((entry) => entry.path)
    const conflicts = state.changes.conflicts.map((entry) => entry.path)
    const branch = target === undefined ? undefined : state.branches.find((candidate) => candidate.name === target)
    return {
      action,
      operation: state.operation.kind,
      modified,
      untracked,
      conflicts,
      detached: state.head.detached,
      ...(target === undefined ? {} : { target }),
      ...(branch === undefined ? {} : { current: branch.current }),
      ...(state.head.upstream === null ? { hasUpstream: false } : { hasUpstream: true }),
      ...(state.head.behind === 0 ? {} : { behind: state.head.behind }),
    }
  }

  /* --------------------------------------------------------------- writes */

  /** Stage the given paths (adds, modifications and deletions alike). */
  async stage(input: SourceRef & { paths: readonly string[] }): Promise<PanelState> {
    const repo = await this.repoFor(input)
    if (input.paths.length === 0) throw new GitError({ code: 'path-missing', detail: 'no paths given' })
    await this.ports.runner.mutate(repo.root, async () => {
      const outcome = await this.ports.runner.run(['add', '--', ...input.paths], repo.cwd, {
        timeoutMs: WRITE_TIMEOUT_MS,
        lockRetries: 4,
      })
      throwOnFailure(outcome)
    })
    return this.readState(repo, false)
  }

  /** Unstage the given paths, also in a repository with no commits. */
  async unstage(input: SourceRef & { paths: readonly string[] }): Promise<PanelState> {
    const repo = await this.repoFor(input)
    if (input.paths.length === 0) throw new GitError({ code: 'path-missing', detail: 'no paths given' })
    await this.ports.runner.mutate(repo.root, async () => {
      const hasHead = await this.ports.runner.ok(['rev-parse', '--verify', 'HEAD'], repo.cwd)
      const args = hasHead
        ? ['reset', '-q', 'HEAD', '--', ...input.paths]
        : ['rm', '-r', '--cached', '--quiet', '--', ...input.paths]
      const outcome = await this.ports.runner.run(args, repo.cwd, {
        timeoutMs: WRITE_TIMEOUT_MS,
        lockRetries: 4,
      })
      throwOnFailure(outcome)
    })
    return this.readState(repo, false)
  }

  /**
   * Discard changes on the given paths.
   *
   * Tracked paths are restored from the index; untracked paths are deleted
   * from disk, which is why the panel puts this behind the danger grammar.
   */
  async discard(input: SourceRef & { paths: readonly string[] }): Promise<PanelState> {
    const repo = await this.repoFor(input)
    if (input.paths.length === 0) throw new GitError({ code: 'path-missing', detail: 'no paths given' })
    const statusRaw = await this.ports.runner.runOk(
      ['status', '--porcelain=v2', '-z', '--untracked-files=all', '--ignored=no'],
      repo.cwd,
      { timeoutMs: STATUS_TIMEOUT_MS },
    )
    const entries = parsePorcelainV2(statusRaw).entries
    const untracked = new Set(entries.filter((entry) => entry.untracked).map((entry) => entry.path))
    const tracked = input.paths.filter((path) => !untracked.has(path))
    const deletes = input.paths.filter((path) => untracked.has(path))

    await this.ports.runner.mutate(repo.root, async () => {
      if (tracked.length > 0) {
        const outcome = await this.ports.runner.run(['restore', '--worktree', '--', ...tracked], repo.cwd, {
          timeoutMs: WRITE_TIMEOUT_MS,
          lockRetries: 4,
        })
        throwOnFailure(outcome)
      }
      for (const path of deletes) {
        if (isUnsafeRelativePath(path)) continue
        await this.ports.fs.remove(join(repo.root, path))
      }
    })
    return this.readState(repo, false)
  }

  /**
   * Commit the staged index.
   *
   * The message is passed with `-m` (never `-F`), so no editor can be opened
   * even by a hook; `--no-verify` is never passed. A failing hook is its own
   * named state carrying the hook's output, which is what the panel's Retry
   * and Cancel act on.
   */
  async commit(
    input: SourceRef & { message: string; amend?: boolean; paths?: readonly string[]; requestId?: string },
  ): Promise<PanelState> {
    const repo = await this.repoFor(input)
    const message = input.message.trim()
    if (message === '') throw new GitError({ code: 'nothing-to-commit', detail: 'empty commit message' })
    const signal = input.requestId === undefined ? undefined : this.ports.cancellations?.begin(input.requestId)
    try {
      await this.ports.runner.mutate(repo.root, async () => {
        const args = ['commit', '-m', message]
        if (input.amend === true) args.push('--amend')
        if (input.paths !== undefined && input.paths.length > 0) args.push('--', ...input.paths)
        const outcome = await this.ports.runner.run(args, repo.cwd, {
          timeoutMs: WRITE_TIMEOUT_MS,
          lockRetries: 4,
          ...(signal === undefined ? {} : { signal }),
        })
        if (outcome.code === 0) return
        if (outcome.killed === true && signal?.aborted === true) {
          throw new GitError({ code: 'hook-cancelled', detail: 'commit cancelled' })
        }
        const failure = classifyGitFailure(outcome)
        const hookOutput = `${outcome.stdout}\n${outcome.stderr}`.trim()
        if (failure.code === 'hook-failed' || (failure.code === 'git-failed' && hookOutput !== '')) {
          throw new GitError({
            code: 'hook-failed',
            detail: hookOutput.slice(-4000),
            exitCode: outcome.code,
          })
        }
        throw new GitError(failure)
      })
    } finally {
      if (input.requestId !== undefined) this.ports.cancellations?.end(input.requestId)
    }
    return this.readState(repo, false)
  }

  /** Cancel an in-flight commit (a hanging pre-commit hook). */
  cancel(requestId: string): boolean {
    return this.ports.cancellations?.cancel(requestId) ?? false
  }

  /* ------------------------------------------------------------ worktrees */

  /**
   * Read linked worktrees with their cleanliness and their standing against a
   * comparison base.
   *
   * Every linked worktree is measured against `base` — the repository's default
   * branch by default — not against whatever the primary checkout happens to
   * have checked out, so the same row cannot change meaning when the root
   * switches branches.
   *
   * @param repo - the resolved repository.
   * @param signal - cancellation.
   * @param base - the comparison ref, or null when the repository has none.
   */
  async readWorktrees(repo: RepoRef, signal?: AbortSignal, base: string | null = null): Promise<WorktreeInfo[]> {
    const raw = await this.ports.runner.runOk(['worktree', 'list', '--porcelain'], repo.root, {
      timeoutMs: STATUS_TIMEOUT_MS,
      ...(signal === undefined ? {} : { signal }),
    })
    const parsed = parseWorktreeList(raw)
    const enrichment: Record<string, WorktreeEnrichment> = {}
    for (const entry of parsed) {
      const branch = shortBranch(entry.branch)
      const signalArgs = signal === undefined ? {} : { signal }
      // Untracked files count as dirt: deleting a worktree would lose them.
      const cleanOutcome = await this.ports.runner.runSoft(
        ['status', '--porcelain', '--untracked-files=all'],
        entry.path,
        { timeoutMs: STATUS_TIMEOUT_MS, ...signalArgs },
      )
      const compared = branch === null || base === null || entry.path === repo.root
      const aheadRaw = compared
        ? null
        : await this.ports.runner.runSoft(['rev-list', '--count', `${base}..${branch}`], repo.root, {
            timeoutMs: STATUS_TIMEOUT_MS,
            ...signalArgs,
          })
      const behindRaw = compared
        ? null
        : await this.ports.runner.runSoft(['rev-list', '--count', `${branch}..${base}`], repo.root, {
            timeoutMs: STATUS_TIMEOUT_MS,
            ...signalArgs,
          })
      const merged = compared
        ? false
        : await this.ports.runner.ok(['merge-base', '--is-ancestor', branch, base], repo.root, {
            timeoutMs: STATUS_TIMEOUT_MS,
            ...signalArgs,
          })
      enrichment[entry.path] = {
        clean: cleanOutcome !== null && cleanOutcome.trim() === '',
        ahead: aheadRaw === null ? 0 : Number(aheadRaw.trim()) || 0,
        behind: behindRaw === null ? 0 : Number(behindRaw.trim()) || 0,
        merged,
      }
    }
    return describeWorktrees(parsed, enrichment)
  }

  /** The branch the primary worktree has checked out, the base's last resort. */
  private async primaryBranch(repo: RepoRef, signal?: AbortSignal): Promise<string | null> {
    const raw = await this.ports.runner.runSoft(['symbolic-ref', '--short', 'HEAD'], repo.root, {
      timeoutMs: STATUS_TIMEOUT_MS,
      ...(signal === undefined ? {} : { signal }),
    })
    return raw === null ? null : raw.trim() || null
  }

  /**
   * The repository's default branch as `origin/HEAD` names it (`origin/main`).
   *
   * This is what a pull request would compare against, which is why it is the
   * preferred base over the primary checkout's current branch.
   */
  private async defaultBranch(repo: RepoRef, signal?: AbortSignal): Promise<string | null> {
    const signalArgs = signal === undefined ? {} : { signal }
    const symbolic = await this.ports.runner.runSoft(
      ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'],
      repo.root,
      { timeoutMs: STATUS_TIMEOUT_MS, ...signalArgs },
    )
    if (symbolic !== null && symbolic.trim() !== '') return symbolic.trim()
    const abbrev = await this.ports.runner.runSoft(['rev-parse', '--abbrev-ref', 'origin/HEAD'], repo.root, {
      timeoutMs: STATUS_TIMEOUT_MS,
      ...signalArgs,
    })
    const name = abbrev === null ? '' : abbrev.trim()
    return name === '' || name === 'origin/HEAD' ? null : name
  }

  /** Tag names for the create picker, newest first and bounded. */
  private async readTags(repo: RepoRef, signal?: AbortSignal): Promise<string[]> {
    const raw = await this.ports.runner.runSoft(
      ['for-each-ref', '--count=100', '--sort=-creatordate', '--format=%(refname:short)', 'refs/tags'],
      repo.root,
      { timeoutMs: STATUS_TIMEOUT_MS, ...(signal === undefined ? {} : { signal }) },
    )
    if (raw === null) return []
    return raw.split('\n').map((line) => line.trim()).filter((line) => line !== '')
  }

  /** Read the local and remote-tracking branches. */
  async readBranches(cwd: string, signal?: AbortSignal): Promise<BranchInfo[]> {
    const raw = await this.ports.runner.runSoft(
      ['for-each-ref', `--format=${BRANCH_FORMAT}`, 'refs/heads', 'refs/remotes'],
      cwd,
      { timeoutMs: STATUS_TIMEOUT_MS, ...(signal === undefined ? {} : { signal }) },
    )
    return raw === null ? [] : parseBranches(raw)
  }

  /** Read `user.name` / `user.email`; either may be unset. */
  async readIdentity(cwd: string, signal?: AbortSignal): Promise<{ name: string | null; email: string | null }> {
    const read = async (key: string): Promise<string | null> => {
      const raw = await this.ports.runner.runSoft(['config', '--get', key], cwd, {
        timeoutMs: 10_000,
        ...(signal === undefined ? {} : { signal }),
      })
      const value = raw === null ? '' : raw.trim()
      return value === '' ? null : value
    }
    return { name: await read('user.name'), email: await read('user.email') }
  }

  /** Public read of the operation state for one repository. */
  async operation(repo: RepoRef, signal?: AbortSignal): Promise<OperationState> {
    const markers = await this.readOperationMarkers(repo.gitDir)
    const statusRaw = await this.ports.runner.runSoft(
      ['status', '--porcelain=v2', '-z', '--untracked-files=no'],
      repo.cwd,
      { timeoutMs: STATUS_TIMEOUT_MS, ...(signal === undefined ? {} : { signal }) },
    )
    const entries = statusRaw === null ? [] : parsePorcelainV2(statusRaw).entries
    return detectOperation(markers, entries)
  }

  /** Read every marker file git uses to record an in-progress operation. */
  private async readOperationMarkers(gitDir: string): Promise<OperationMarkers> {
    const read = (name: string): Promise<string | null> => this.ports.fs.readText(join(gitDir, name))
    const exists = (name: string): Promise<boolean> => this.ports.fs.exists(join(gitDir, name))
    const [mergeHead, cherryPickHead, revertHead, message, rebaseMerge, rebaseApply] = await Promise.all([
      read('MERGE_HEAD'),
      read('CHERRY_PICK_HEAD'),
      read('REVERT_HEAD'),
      read('MERGE_MSG'),
      exists('rebase-merge'),
      exists('rebase-apply'),
    ])
    let rebaseStep: OperationMarkers['rebaseStep'] = null
    if (rebaseMerge) {
      const [current, total] = await Promise.all([read('rebase-merge/msgnum'), read('rebase-merge/end')])
      const currentNumber = Number((current ?? '').trim())
      const totalNumber = Number((total ?? '').trim())
      if (Number.isFinite(currentNumber) && Number.isFinite(totalNumber) && totalNumber > 0) {
        rebaseStep = { current: currentNumber, total: totalNumber }
      }
    }
    return {
      mergeHead: normalizeMarker(mergeHead),
      cherryPickHead: normalizeMarker(cherryPickHead),
      revertHead: normalizeMarker(revertHead),
      message,
      rebaseMerge,
      rebaseApply,
      rebaseStep,
    }
  }

  /* --------------------------------------------------------- worktree ops */

  /** The primary branch name, used as the default base for a new worktree. */
  async defaultBase(repo: RepoRef, signal?: AbortSignal): Promise<string> {
    const signalArgs = signal === undefined ? {} : { signal }
    const symbolic = await this.ports.runner.runSoft(['symbolic-ref', '--short', 'HEAD'], repo.cwd, {
      timeoutMs: STATUS_TIMEOUT_MS,
      ...signalArgs,
    })
    if (symbolic !== null && symbolic.trim() !== '') return symbolic.trim()
    const remoteHead = await this.ports.runner.runSoft(['rev-parse', '--abbrev-ref', 'origin/HEAD'], repo.cwd, {
      timeoutMs: STATUS_TIMEOUT_MS,
      ...signalArgs,
    })
    if (remoteHead !== null && remoteHead.trim() !== '') return remoteHead.trim()
    return 'HEAD'
  }

  /**
   * Create a worktree for a slug.
   *
   * Ordering matters: the exclude entry is written before the directory
   * exists (so a reader can never observe the worktree in `git status`),
   * `worktree add` creates the branch, and a failed create throws rather than
   * leaving a half-made worktree behind.
   */
  async worktreeAdd(input: SourceRef & {
    /** `new` starts a fresh branch; `ref` checks out an existing one. */
    mode?: 'new' | 'ref'
    /** Slug/name for a new branch. */
    name?: string
    /** Existing ref for `ref` mode: a local branch, remote branch or tag. */
    ref?: string
    /** What kind of ref `ref` is; decides checkout vs tracking vs detached. */
    refKind?: 'branch' | 'remote' | 'tag'
    /** Start point for `new` mode. */
    base?: string
  }): Promise<{
    plan: WorktreePlan
    state: PanelState
    setup: SetupReport
    notice: string | null
  }> {
    const repo = await this.repoFor(input)
    const mode = input.mode === 'ref' ? 'ref' : 'new'
    const created = await this.resolveWorktreeTarget(repo, mode, input)
    const setup = await this.planSetup(repo)
    const plan = planWorktree({
      root: repo.root,
      slug: created.slug,
      base: created.base,
      branch: created.branch,
      setup: setup.steps,
    })

    await this.ensureExcluded(repo)
    const outcome = await this.ports.runner.run(created.args, repo.root, {
      timeoutMs: WRITE_TIMEOUT_MS,
      lockRetries: 4,
    })
    if (outcome.code !== 0) throw new GitError(classifyGitFailure(outcome))
    const path = created.path

    let report: SetupReport = { ran: 0, failed: false, output: '' }
    if (setup.steps.length > 0) {
      report = await runSetupSteps(setup.steps, path, repo.root, {
        parentEnv: this.ports.env,
        ...(this.ports.setupExec === undefined ? {} : { exec: this.ports.setupExec }),
      })
      this.setupReports.set(path, report)
    }
    await this.copyWorktreeInclude(repo, path)

    return {
      plan,
      state: await this.readState(repo, false),
      setup: report,
      notice: setup.error ?? (report.failed ? 'setup-failed' : null),
    }
  }

  /**
   * Validate one create request and build the git arguments that carry it out.
   *
   * `new` names a slug and starts `dsh-git/<slug>` from a base. `ref` checks out
   * an existing ref: a local branch directly, a remote-tracking branch as a new
   * local branch that tracks it, or a tag detached.
   */
  private async resolveWorktreeTarget(
    repo: RepoRef,
    mode: 'new' | 'ref',
    input: { name?: string; ref?: string; refKind?: 'branch' | 'remote' | 'tag'; base?: string },
  ): Promise<{ slug: string; path: string; branch: string | null; base: string; args: string[] }> {
    if (mode === 'new') {
      const slug = normalizeSlug(input.name ?? '')
      const verdict = validateSlug(slug)
      if (!verdict.ok) throw new GitError({ code: 'invalid-name', detail: verdict.issue })
      const path = worktreePathFor(repo.root, slug)
      await this.assertWorktreePathFree(repo, path)
      const branch = `${WORKTREE_BRANCH_PREFIX}${slug}`
      if (await this.ports.runner.ok(['rev-parse', '--verify', `refs/heads/${branch}`], repo.root)) {
        throw new GitError({ code: 'branch-exists', detail: branch })
      }
      const base = input.base ?? (await this.defaultBase(repo))
      return { slug, path, branch, base, args: ['worktree', 'add', '-b', branch, path, base] }
    }

    const ref = (input.ref ?? '').trim()
    const kind = input.refKind ?? 'branch'
    if (ref === '') throw new GitError({ code: 'invalid-name', detail: 'ref' })
    const slug = slugForRef(ref)
    if (slug === '') throw new GitError({ code: 'invalid-name', detail: ref })
    const path = worktreePathFor(repo.root, slug)
    await this.assertWorktreePathFree(repo, path)

    if (kind === 'tag') {
      if (!(await this.ports.runner.ok(['rev-parse', '--verify', `refs/tags/${ref}`], repo.root))) {
        throw new GitError({ code: 'path-missing', detail: ref })
      }
      return { slug, path, branch: null, base: ref, args: ['worktree', 'add', '--detach', path, ref] }
    }
    if (kind === 'remote') {
      if (!(await this.ports.runner.ok(['rev-parse', '--verify', `refs/remotes/${ref}`], repo.root))) {
        throw new GitError({ code: 'path-missing', detail: ref })
      }
      const branch = localBranchForRemoteRef(ref)
      if (branch === '') throw new GitError({ code: 'invalid-name', detail: ref })
      if (await this.ports.runner.ok(['rev-parse', '--verify', `refs/heads/${branch}`], repo.root)) {
        throw new GitError({ code: 'branch-exists', detail: branch })
      }
      return { slug, path, branch, base: ref, args: ['worktree', 'add', '--track', '-b', branch, path, ref] }
    }
    if (!(await this.ports.runner.ok(['rev-parse', '--verify', `refs/heads/${ref}`], repo.root))) {
      throw new GitError({ code: 'path-missing', detail: ref })
    }
    return { slug, path, branch: ref, base: ref, args: ['worktree', 'add', path, ref] }
  }

  /** Refuse a path a worktree already occupies, in git or on disk. */
  private async assertWorktreePathFree(repo: RepoRef, path: string): Promise<void> {
    const entries = await this.readWorktrees(repo)
    if (entries.some((entry) => entry.path === path)) {
      throw new GitError({ code: 'worktree-exists', detail: path })
    }
    if (await this.ports.fs.exists(path)) throw new GitError({ code: 'worktree-exists', detail: path })
  }

  /** Resolve `.worktrees.json` for the primary checkout. */
  private async planSetup(repo: RepoRef): Promise<{ steps: SetupStep[]; error: string | null }> {
    const raw = await this.ports.fs.readText(join(repo.root, SETUP_FILE))
    if (raw === null) return { steps: [], error: null }
    const parsed = parseSetupFile(raw)
    if ('error' in parsed) return { steps: [], error: 'setup-invalid' }
    const steps = resolveSetupSteps(parsed, setupPlatform(this.ports.platform))
    if (!Array.isArray(steps)) return { steps: [], error: steps.error }
    return { steps, error: null }
  }

  /** The stored setup report for a worktree path, empty when nothing ran. */
  setupReportFor(path: string): SetupReport {
    return this.setupReports.get(path) ?? { ran: 0, failed: false, output: '' }
  }

  /** Ensure `.git/info/exclude` hides the worktrees directory. */
  private async ensureExcluded(repo: RepoRef): Promise<void> {
    const path = join(repo.commonDir, 'info', 'exclude')
    const raw = (await this.ports.fs.readText(path)) ?? ''
    const next = withWorktreesExcluded(raw)
    if (next !== null) await this.ports.fs.writeText(path, next)
  }

  /** Copy `.worktreeinclude` entries from the primary checkout into a worktree. */
  private async copyWorktreeInclude(repo: RepoRef, worktreePath: string): Promise<string[]> {
    const raw = await this.ports.fs.readText(join(repo.root, INCLUDE_FILE))
    if (raw === null) return []
    const copied: string[] = []
    for (const entry of parseWorktreeInclude(raw)) {
      const from = join(repo.root, entry)
      if (!(await this.ports.fs.exists(from))) continue
      await this.ports.fs.copy(from, join(worktreePath, entry))
      copied.push(entry)
    }
    return copied
  }

  /**
   * Remove a worktree, honouring the preflight's force decision.
   *
   * The primary checkout and the checkout the session itself sits in are
   * refused: git refuses the former anyway, and deleting the latter out from
   * under a running session is not something a panel should arrange. A locked
   * worktree takes the second `--force` git requires.
   */
  async worktreeRemove(
    input: SourceRef & { path: string; force?: boolean; deleteBranch?: boolean },
  ): Promise<PanelState> {
    const repo = await this.repoFor(input)
    // The primary checkout is the repository root, which the containment check
    // below deliberately excludes, so it is named first.
    if (this.samePath(resolvePath(input.path), repo.root)) {
      throw new GitError({ code: 'worktree-primary', detail: input.path })
    }
    const target = this.containedWorktreePath(repo, input.path)
    const entry = await this.worktreeEntry(repo, target)
    if (entry.primary) throw new GitError({ code: 'worktree-primary', detail: target })
    if (this.samePath(target, repo.toplevel)) {
      throw new GitError({ code: 'worktree-current', detail: target })
    }
    const args = ['worktree', 'remove']
    if (input.force === true) args.push('--force')
    if (entry.locked) args.push('--force')
    args.push(target)
    const outcome = await this.ports.runner.run(args, repo.root, {
      timeoutMs: WRITE_TIMEOUT_MS,
      lockRetries: 4,
    })
    if (outcome.code !== 0) throw new GitError(classifyGitFailure(outcome))
    // Only a branch this plugin named is deleted with the worktree: a worktree
    // created from an existing branch does not own that branch.
    if (input.deleteBranch === true && slugFromBranch(entry.branch) !== null && entry.branch !== null) {
      await this.ports.runner.run(['branch', '-D', entry.branch], repo.root, {
        timeoutMs: WRITE_TIMEOUT_MS,
        lockRetries: 4,
      })
    }
    return this.readState(repo, false)
  }

  /**
   * Merge a worktree's branch into the checkout the session is in.
   *
   * The source is the worktree's real branch, read from git, not a name
   * reconstructed from the directory: a worktree made by hand, or one checked
   * out on an existing branch, merges exactly like one the panel created.
   */
  async worktreeMerge(input: SourceRef & { path: string }): Promise<PanelState> {
    const repo = await this.repoFor(input)
    const target = this.containedWorktreePath(repo, input.path)
    const entry = await this.worktreeEntry(repo, target)
    if (entry.branch === null) throw new GitError({ code: 'detached-head', detail: target })
    if ((await this.branchAt(repo.cwd)) === entry.branch) {
      throw new GitError({ code: 'current-branch', detail: entry.branch })
    }
    const outcome = await this.ports.runner.run(['merge', '--no-edit', entry.branch], repo.cwd, {
      timeoutMs: WRITE_TIMEOUT_MS,
      lockRetries: 4,
    })
    if (outcome.code !== 0 && !(await this.merging(repo.cwd))) {
      throw new GitError(classifyGitFailure(outcome))
    }
    return this.readState(repo, false)
  }

  /**
   * Update a worktree by merging the comparison base into it.
   *
   * The base is the same ref the panel's rows are measured against, so
   * "Update from main" and "2 ahead of main" talk about the same thing.
   */
  async worktreeUpdate(input: SourceRef & { path: string; base?: string }): Promise<PanelState> {
    const repo = await this.repoFor(input)
    const target = this.containedWorktreePath(repo, input.path)
    const base = input.base ?? (await this.worktreeBaseName(repo))
    if (base === null) throw new GitError({ code: 'no-upstream', detail: target })
    const outcome = await this.ports.runner.run(['merge', '--no-edit', base], target, {
      timeoutMs: WRITE_TIMEOUT_MS,
      lockRetries: 4,
    })
    // The merge happens in another working tree, which this panel is not
    // showing: a conflict there is a named state naming the path, not a silent
    // success, and it stays recoverable in that worktree.
    if (outcome.code !== 0) {
      if (await this.merging(target)) {
        throw new GitError({ code: 'operation-in-progress', detail: target })
      }
      throw new GitError(classifyGitFailure(outcome))
    }
    return this.readState(repo, false)
  }

  /** Drop git's records for worktrees whose directories are gone. */
  async worktreePrune(input: SourceRef): Promise<PanelState> {
    const repo = await this.repoFor(input)
    const outcome = await this.ports.runner.run(['worktree', 'prune', '--expire', 'now'], repo.root, {
      timeoutMs: WRITE_TIMEOUT_MS,
      lockRetries: 4,
    })
    if (outcome.code !== 0) throw new GitError(classifyGitFailure(outcome))
    return this.readState(repo, false)
  }

  /** Release a worktree lock so git will move, delete or prune it again. */
  async worktreeUnlock(input: SourceRef & { path: string }): Promise<PanelState> {
    const repo = await this.repoFor(input)
    const target = this.containedWorktreePath(repo, input.path)
    const entry = await this.worktreeEntry(repo, target)
    if (!entry.locked) return this.readState(repo, false)
    const outcome = await this.ports.runner.run(['worktree', 'unlock', target], repo.root, {
      timeoutMs: WRITE_TIMEOUT_MS,
      lockRetries: 4,
    })
    if (outcome.code !== 0) throw new GitError(classifyGitFailure(outcome))
    return this.readState(repo, false)
  }

  /** Whether a directory is mid-merge. */
  private async merging(cwd: string): Promise<boolean> {
    return this.ports.runner.ok(['rev-parse', '-q', '--verify', 'MERGE_HEAD'], cwd)
  }

  /** The current branch of one checkout, or null when detached or unborn. */
  private async branchAt(cwd: string): Promise<string | null> {
    const raw = await this.ports.runner.runSoft(['symbolic-ref', '--short', 'HEAD'], cwd, {
      timeoutMs: STATUS_TIMEOUT_MS,
    })
    return raw === null ? null : raw.trim() || null
  }

  /** The comparison base this plugin uses without a panel override. */
  private async worktreeBaseName(repo: RepoRef): Promise<string | null> {
    return resolveWorktreeBase({
      defaultBranch: await this.defaultBranch(repo),
      primaryBranch: await this.primaryBranch(repo),
    }).name
  }

  /** One described worktree by path, or a named missing-path failure. */
  private async worktreeEntry(repo: RepoRef, path: string): Promise<WorktreeInfo> {
    const raw = await this.ports.runner.runOk(['worktree', 'list', '--porcelain'], repo.root, {
      timeoutMs: STATUS_TIMEOUT_MS,
    })
    const parsed = parseWorktreeList(raw)
    const index = parsed.findIndex((entry) => this.samePath(entry.path, path))
    if (index < 0) throw new GitError({ code: 'path-missing', detail: path })
    return describeWorktrees(parsed, {})[index]!
  }

  /** Path equality that tolerates separator and trailing-slash differences. */
  private samePath(a: string, b: string): boolean {
    const norm = (value: string): string => value.replace(/\\/g, '/').replace(/\/+$/, '')
    return norm(a) === norm(b)
  }

  /** Refuse any path outside the repository, so a request cannot target /etc. */
  private containedWorktreePath(repo: RepoRef, path: string): string {
    const absolute = resolvePath(path)
    const normalRoot = repo.root.replace(/\\/g, '/').replace(/\/+$/, '')
    const normalPath = absolute.replace(/\\/g, '/')
    if (!normalPath.startsWith(`${normalRoot}/`)) {
      throw new GitError({ code: 'path-missing', detail: path })
    }
    return absolute
  }

  /* ------------------------------------------------------------- branches */

  /** Create a branch without checking it out. */
  async branchCreate(input: SourceRef & { name: string; from?: string }): Promise<PanelState> {
    const repo = await this.repoFor(input)
    const issue = validateBranchName(input.name)
    if (issue !== null) throw new GitError({ code: 'invalid-name', detail: issue })
    const args = ['branch', input.name]
    if (input.from !== undefined && input.from !== '') args.push(input.from)
    const outcome = await this.ports.runner.run(args, repo.cwd, {
      timeoutMs: WRITE_TIMEOUT_MS,
      lockRetries: 4,
    })
    if (outcome.code !== 0) {
      const failure = classifyGitFailure(outcome)
      if (/already exists/i.test(failure.detail)) throw new GitError({ code: 'branch-exists', detail: input.name })
      throw new GitError(failure)
    }
    return this.readState(repo, false)
  }

  /** Switch to a branch, creating it from a remote-tracking branch when asked. */
  async branchSwitch(input: SourceRef & { name: string; remote?: string }): Promise<PanelState> {
    const repo = await this.repoFor(input)
    const issue = validateBranchName(input.name)
    if (issue !== null) throw new GitError({ code: 'invalid-name', detail: issue })
    const args =
      input.remote === undefined ? ['switch', input.name] : ['switch', '-c', input.name, input.remote]
    const outcome = await this.ports.runner.run(args, repo.cwd, {
      timeoutMs: WRITE_TIMEOUT_MS,
      lockRetries: 4,
    })
    if (outcome.code !== 0) throw new GitError(classifyGitFailure(outcome))
    return this.readState(repo, false)
  }

  /** Rename a local branch. */
  async branchRename(input: SourceRef & { from: string; to: string }): Promise<PanelState> {
    const repo = await this.repoFor(input)
    const issue = validateBranchName(input.to)
    if (issue !== null) throw new GitError({ code: 'invalid-name', detail: issue })
    const outcome = await this.ports.runner.run(['branch', '-m', input.from, input.to], repo.cwd, {
      timeoutMs: WRITE_TIMEOUT_MS,
      lockRetries: 4,
    })
    if (outcome.code !== 0) throw new GitError(classifyGitFailure(outcome))
    return this.readState(repo, false)
  }

  /** Delete a local branch; `force` selects `-D` over `-d`. */
  async branchDelete(input: SourceRef & { name: string; force?: boolean }): Promise<PanelState> {
    const repo = await this.repoFor(input)
    const outcome = await this.ports.runner.run(
      ['branch', input.force === true ? '-D' : '-d', input.name],
      repo.cwd,
      { timeoutMs: WRITE_TIMEOUT_MS, lockRetries: 4 },
    )
    if (outcome.code !== 0) {
      const failure = classifyGitFailure(outcome)
      if (failure.code === 'not-merged') throw new GitError({ code: 'not-merged', detail: input.name })
      throw new GitError(failure)
    }
    return this.readState(repo, false)
  }

  /* ------------------------------------------------------ history writes */

  /** Continue the in-progress operation. */
  async operationContinue(input: SourceRef): Promise<PanelState> {
    const repo = await this.repoFor(input)
    const state = await this.readState(repo, false)
    const kind = state.operation.kind
    if (kind === null) throw new GitError({ code: 'operation-in-progress', detail: 'no operation in progress' })
    const args =
      kind === 'merge'
        ? ['commit', '--no-edit']
        : kind === 'rebase'
          ? ['rebase', '--continue']
          : [`${kind}`, '--continue']
    const outcome = await this.ports.runner.run(args, repo.cwd, {
      timeoutMs: WRITE_TIMEOUT_MS,
      lockRetries: 4,
    })
    if (outcome.code !== 0) throw new GitError(classifyGitFailure(outcome))
    return this.readState(repo, false)
  }

  /** Abort the in-progress operation. */
  async operationAbort(input: SourceRef): Promise<PanelState> {
    const repo = await this.repoFor(input)
    const state = await this.readState(repo, false)
    const kind = state.operation.kind
    if (kind === null) throw new GitError({ code: 'operation-in-progress', detail: 'no operation in progress' })
    const args = kind === 'merge' ? ['merge', '--abort'] : [kind, '--abort']
    const outcome = await this.ports.runner.run(args, repo.cwd, {
      timeoutMs: WRITE_TIMEOUT_MS,
      lockRetries: 4,
    })
    if (outcome.code !== 0) throw new GitError(classifyGitFailure(outcome))
    return this.readState(repo, false)
  }

  /** Merge the current branch's upstream into it. */
  async updateFromBranch(input: SourceRef): Promise<PanelState> {
    const repo = await this.repoFor(input)
    const outcome = await this.ports.runner.run(['merge', '--no-edit', '@{u}'], repo.cwd, {
      timeoutMs: WRITE_TIMEOUT_MS,
      lockRetries: 4,
    })
    // A conflicted merge is a recoverable state, not an error.
    if (outcome.code !== 0 && !(await this.merging(repo.cwd))) {
      throw new GitError(classifyGitFailure(outcome))
    }
    return this.readState(repo, false)
  }

  /** Revert one commit (non-rewriting, may conflict). */
  async revert(input: SourceRef & { hash: string }): Promise<PanelState> {
    return this.runHistoryWrite(input, ['revert', '--no-edit', input.hash])
  }

  /** Cherry-pick one commit (non-rewriting, may conflict). */
  async cherryPick(input: SourceRef & { hash: string }): Promise<PanelState> {
    return this.runHistoryWrite(input, ['cherry-pick', input.hash])
  }

  /** Check out a commit detached (the panel warns first). */
  async checkoutCommit(input: SourceRef & { hash: string }): Promise<PanelState> {
    const repo = await this.repoFor(input)
    const outcome = await this.ports.runner.run(['checkout', input.hash], repo.cwd, {
      timeoutMs: WRITE_TIMEOUT_MS,
      lockRetries: 4,
    })
    if (outcome.code !== 0) throw new GitError(classifyGitFailure(outcome))
    return this.readState(repo, false)
  }

  /** Shared path for revert/cherry-pick, where conflicts are recoverable. */
  private async runHistoryWrite(input: SourceRef, args: readonly string[]): Promise<PanelState> {
    const repo = await this.repoFor(input)
    const outcome = await this.ports.runner.run(args, repo.cwd, {
      timeoutMs: WRITE_TIMEOUT_MS,
      lockRetries: 4,
    })
    if (outcome.code !== 0) {
      const markers = await this.readOperationMarkers(repo.gitDir)
      if (detectOperation(markers).kind === null) throw new GitError(classifyGitFailure(outcome))
    }
    return this.readState(repo, false)
  }

  /* -------------------------------------------------------------- reclaim */

  /**
   * The reincarnation seam `dsh-next-reset` and `dsh-next-checkpoints`
   * resolve, under the retired `dsh-next-worktrees` key.
   *
   * Worktrees are git-native here, not session-bound, so there is no registry
   * row to move: a session that continues in the same checkout already keeps
   * its worktree, and the new session's cwd is what the fork inherited. What
   * this reports is whether that checkout really is a linked worktree, which
   * is what a caller needs before assuming anything about the new location.
   *
   * @param _from - the session being replaced (unused; nothing is stored).
   * @param to - the replacement session.
   * @returns whether a linked worktree was found for the replacement.
   */
  async reclaim(_from: string, to: string): Promise<ReclaimResult> {
    const cwd = this.ports.cwdOf(to)
    if (cwd === undefined) return { claimed: false, reason: 'not-a-worktree', path: null, branch: null }
    try {
      const repo = await this.resolveRepo(cwd)
      if (repo.toplevel === repo.root) {
        return { claimed: false, reason: 'not-a-worktree', path: null, branch: null }
      }
      const branch = await this.ports.runner.runSoft(['symbolic-ref', '--short', 'HEAD'], repo.toplevel)
      return {
        claimed: true,
        reason: 'reclaimed',
        path: repo.toplevel,
        branch: branch === null ? null : branch.trim() || null,
      }
    } catch {
      return { claimed: false, reason: 'not-a-worktree', path: null, branch: null }
    }
  }

  /* ----------------------------------------------------------------- misc */

  /** The deterministic commit-message draft, from live state. */
  async draftMessage(input: SourceRef): Promise<string> {
    const state = (await this.state(input)).state
    return draftCommitMessage(state.changes)
  }

  /** Resolve every changed path with its patch, for the agent verbs. */
  async agentFiles(input: SourceRef & { paths?: readonly string[] }): Promise<{
    state: PanelState
    files: {
      path: string
      patch: string
      added: number
      removed: number
      binary: boolean
      staged: boolean
    }[]
  }> {
    const state = (await this.state(input)).state
    const paths = input.paths ?? changedPaths(state.changes)
    const files = []
    for (const path of paths.slice(0, 40)) {
      const stagedEntry = state.changes.staged.find((entry) => entry.path === path)
      const side: DiffSide = stagedEntry === undefined ? 'unstaged' : 'staged'
      const result = await this.diff({ ...input, path, side })
      const file = result.file
      files.push({
        path,
        patch: file?.patch ?? '',
        added: file?.added ?? 0,
        removed: file?.removed ?? 0,
        binary: file?.binary ?? false,
        staged: side === 'staged',
      })
    }
    return { state, files }
  }

  /** Remote-tracking branches a checkout could create a local branch from. */
  async remoteCheckoutCandidates(input: SourceRef): Promise<(BranchInfo & { local: string })[]> {
    const repo = await this.repoFor(input)
    const branches = await this.readBranches(repo.cwd)
    return branches
      .filter((branch) => branch.remote)
      .map((branch) => ({ ...branch, local: localNameForRemote(branch.name) }))
      .filter((branch) => branch.local !== branch.name && !branches.some((other) => other.name === branch.local))
  }

  /** Local branches only, for the switch/delete UI. */
  async localBranchNames(input: SourceRef): Promise<string[]> {
    const repo = await this.repoFor(input)
    return localBranches(await this.readBranches(repo.cwd)).map((branch) => branch.name)
  }

  /** The degraded state for a terminal failure, for the RPC layer. */
  static degradedFor(error: GitError): ReturnType<typeof degradedFrom> {
    return degradedFrom(error.failure)
  }
}

/** Run git from a safe directory when no repository is known yet. */
function cwdOrHome(): string {
  return process.env.HOME ?? process.env.USERPROFILE ?? process.cwd()
}

/** Numeric comparison of two parsed versions. */
function compareVersionNumbers(a: GitVersion, b: GitVersion): number {
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  return a.patch - b.patch
}

/** Normalize a marker file's contents to a non-empty string or null. */
function normalizeMarker(raw: string | null): string | null {
  if (raw === null) return null
  const trimmed = raw.trim()
  return trimmed === '' ? null : trimmed
}

/** Throw the classified failure of a non-zero outcome. */
function throwOnFailure(outcome: { code: number; stdout: string; stderr: string; killed?: boolean; spawnFailed?: boolean }): void {
  if (outcome.code === 0) return
  throw new GitError(classifyGitFailure(outcome))
}

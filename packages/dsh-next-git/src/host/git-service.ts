/**
 * The host git service: every read and write the panel performs.
 *
 * Shape of the module:
 *
 * - `resolveRepo` finds the repository a session runs in, and classifies the
 *   ways there may not be one (no git, not a repository, bare, denied).
 * - The read methods (`state`, `diff`, `history`) never mutate.
 * - Writes recheck host safety conditions under a common-repository queue.
 *   This serializes plugin requests, not arbitrary external Git processes;
 *   Git's index lock and ref checks remain the final protection against those.
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
import { isHistoryOid } from '../core/history-view.ts'
import { changeMarkers, languageFor } from '../core/file-view.ts'
import {
  BRANCH_FORMAT,
  localBranches,
  localNameForRemote,
  parseBranches,
  parseTags,
  TAG_FORMAT,
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
import { GitError, GitProcessShutdownError, GitRunner, STATUS_TIMEOUT_MS, WRITE_TIMEOUT_MS, type CancellationRegistry } from './git-runner.ts'
import type { FsPorts } from './fs-adapter.ts'
import { ConflictService } from './conflict-service.ts'
import { HistoryOperations } from './history-operations.ts'
import { HistoryRead } from './history-read.ts'
import { captureIndexSnapshot, restoreIndexSnapshot } from './index-rollback.ts'
import { contextFingerprint } from './context-fingerprint.ts'
import { isSensitiveAgentPath } from '../core/agent-verbs.ts'
import type { WorktreeCreateOptions, WorktreeSetupPreview } from '../core/worktree-create.ts'
import { RepositoryActions } from './repository-actions.ts'
import { RepositoryCommands } from './repository-commands.ts'
import { runSetupSteps, type SetupExec } from './setup-exec.ts'
import type {
  BranchInfo,
  ChangeMarker,
  DiffFile,
  DiffResult,
  FileChanges,
  DiffSide,
  HistoryPage,
  OperationState,
  PanelState,
  PreflightAction,
  PreflightDecision,
  ReclaimResult,
  RefSummary,
  SetupReport,
  SetupStep,
  StatePayload,
  TagInfo,
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

/** Host commit inputs; paths restrict bulk staging or a path-specific commit. */
export interface CommitInput extends SourceRef {
  readonly message: string
  readonly amend?: boolean
  readonly signoff?: boolean
  readonly expectedHead?: string
  readonly paths?: readonly string[]
  readonly requestId?: string
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

  readonly conflicts: ConflictService
  readonly historyOperations: HistoryOperations
  readonly historyRead: HistoryRead
  readonly repositoryActions: RepositoryActions
  readonly repositoryCommands: RepositoryCommands

  constructor(private readonly ports: GitServicePorts) {
    this.conflicts = new ConflictService({ runner: ports.runner, resolveRepo: (source) => this.repoFor(source) })
    this.historyOperations = new HistoryOperations({ runner: ports.runner, resolveRepo: (source) => this.repoFor(source) })
    this.historyRead = new HistoryRead({ runner: ports.runner, resolveRepo: (source) => this.repoFor(source) })
    this.repositoryActions = new RepositoryActions({ runner: ports.runner, resolveRepo: (source) => this.repoFor(source) })
    this.repositoryCommands = new RepositoryCommands({ runner: ports.runner, resolveRepo: (source) => this.repoFor(source) })
  }

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

    const worktrees = await this.ports.runner.runOk(['worktree', 'list', '--porcelain'], toplevel, { signal })
    const root = parseWorktreeList(worktrees)[0]?.path ?? (basename(commonDir) === '.git' ? dirname(commonDir) : commonDir)
    return { root, toplevel, gitDir, commonDir, cwd }
  }

  /** Resolve the session's repository, or a provided cwd in tests. */
  async repoFor(input: SourceRef, signal?: AbortSignal): Promise<RepoRef> {
    const cwd = input.cwd ?? (input.sessionId === undefined ? undefined : this.ports.cwdOf(input.sessionId))
    if (cwd === undefined || cwd === '') {
      // Not the same as a folder that is not a repository: the session may
      // simply not be loaded in this host yet (a tab restored after a restart),
      // which resolves itself. The panel retries this code; it never retries a
      // real `not-a-repository`.
      throw new GitError({ code: 'session-not-ready', detail: 'session has no working directory' })
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
      repo.toplevel,
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

    const [markers, refs, defaultBranch, primaryBranch, identity] = await Promise.all([
      this.readOperationMarkers(repo.gitDir),
      this.readRefs(repo, signal),
      this.defaultBranch(repo, signal),
      this.primaryBranch(repo, signal),
      this.readIdentity(repo.toplevel, signal),
    ])
    const operation = detectOperation(markers, report.entries)
    const worktreeBase = resolveWorktreeBase({
      defaultBranch,
      primaryBranch,
      requested: requestedBase ?? null,
      candidates: refs.branches.filter((branch) => !branch.remote).map((branch) => branch.name),
    })
    const worktrees = await this.readWorktrees(repo, signal, worktreeBase.name)

    return {
      root: repo.toplevel,
      gitDir: repo.gitDir,
      bare: false,
      head: report.head,
      operation,
      changes,
      worktrees,
      worktreeBase,
      branches: refs.branches,
      tags: refs.tags,
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
    validatePaths(input.oldPath === undefined ? [path] : [input.oldPath, path])
    const base = side === 'staged' ? ['diff', '--cached'] : ['diff']
    const signalArgs = options.signal === undefined ? {} : { signal: options.signal }
    // A rename needs both paths in the pathspec: limiting to the new path
    // makes git drop rename detection and report a plain add instead.
    const pathspec = ['--', ...(input.oldPath === undefined ? [path] : [input.oldPath, path]).map(literalPath)]

    const patch = await this.ports.runner.runSoft([...base, ...pathspec], repo.toplevel, {
      timeoutMs: STATUS_TIMEOUT_MS,
      ...signalArgs,
    })
    const numstat = await this.ports.runner.runSoft([...base, '--numstat', '-z', ...pathspec], repo.toplevel, {
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

  /**
   * One changed path as a whole file, with the lines that changed.
   *
   * The panel's diff shows the hunks; this shows the file they belong to, so a
   * reader keeps the file's own line numbering. The displayed side is the same
   * side the diff is taken against: the worktree for `unstaged`, the index for
   * `staged`. A path that is gone from that side (a deletion) is served from
   * the other side with every line marked removed, which is what the change
   * actually did.
   *
   * @param input - session (or explicit cwd), path and side to read.
   * @param options - cancellation.
   * @returns the file text and its change markers.
   */
  async fileChanges(
    input: SourceRef & { path: string; side: DiffSide; oldPath?: string },
    options: ReadOptions = {},
  ): Promise<FileChanges> {
    const repo = await this.repoFor(input, options.signal)
    const { path, side } = input
    validatePaths([path])
    const language = languageFor(path) ?? null
    const result = await this.diff(input, options)
    const empty = { path, absolutePath: join(repo.toplevel, path), side, language, text: '', markers: [] as readonly ChangeMarker[], binary: false, truncated: false, deleted: false }
    if (result.file?.binary === true) return { ...empty, binary: true }

    if (input.side === 'unstaged') {
      const worktree = await this.ports.fs.readWorktree(repo.toplevel, path)
      if (worktree !== null && worktree.kind === 'binary') return { ...empty, binary: true }
      if (worktree !== null && worktree.kind === 'oversize') return { ...empty, truncated: true }
      if (worktree !== null) {
        return { ...empty, text: worktree.text, markers: result.file === null ? [] : changeMarkers(result.file) }
      }
      // Deleted from the worktree: the copy the change removed is the index
      // entry, or the committed one when the deletion is already staged.
      const removed = await this.blobText(repo, ':', path, options.signal)
        ?? await this.blobText(repo, 'HEAD:', path, options.signal)
      if (removed === null) return { ...empty, deleted: true }
      return { ...empty, text: removed, deleted: true, markers: removedEveryLine(removed) }
    }

    const index = await this.blobText(repo, ':', path, options.signal)
    if (index === null) {
      // Added to the index: the worktree copy is what the change introduced.
      const worktree = await this.ports.fs.readWorktree(repo.toplevel, path)
      if (worktree === null) return empty
      if (worktree.kind === 'binary') return { ...empty, binary: true }
      if (worktree.kind === 'oversize') return { ...empty, truncated: true }
      return { ...empty, text: worktree.text, markers: result.file === null ? [] : changeMarkers(result.file) }
    }
    return { ...empty, text: index, markers: result.file === null ? [] : changeMarkers(result.file) }
  }

  /**
   * One revision's copy of a path as text, or null when it has none.
   *
   * @param repo - resolved repository.
   * @param revision - `:` for the index, or a revision prefix such as `HEAD:`.
   * @param path - repository-relative path.
   * @param signal - cancellation.
   * @returns the text, or null for a missing entry, an oversized blob or binary bytes.
   */
  private async blobText(repo: RepoRef, revision: ':' | 'HEAD:', path: string, signal?: AbortSignal): Promise<string | null> {
    if (isUnsafeRelativePath(path) || path.split('/').some(part => part.toLowerCase() === '.git')) {
      throw new GitError({ code: 'path-missing', detail: 'Invalid repository path' })
    }
    const resolved = await this.ports.runner.run(
      ['rev-parse', '--verify', '--end-of-options', revision + path],
      repo.toplevel,
      { timeoutMs: STATUS_TIMEOUT_MS, ...(signal === undefined ? {} : { signal }) },
    )
    const oid = resolved.stdout.trim()
    if (resolved.code !== 0 || !/^[0-9a-f]{40,64}$/.test(oid)) return null
    const size = await this.ports.runner.run(['cat-file', '-s', oid], repo.toplevel, {
      timeoutMs: STATUS_TIMEOUT_MS,
      ...(signal === undefined ? {} : { signal }),
    })
    const bytes = Number(size.stdout.trim())
    if (size.code !== 0 || !Number.isSafeInteger(bytes) || bytes < 0 || bytes > INDEX_TEXT_LIMIT) return null
    const outcome = await this.ports.runner.run(['cat-file', 'blob', oid], repo.toplevel, {
      timeoutMs: STATUS_TIMEOUT_MS,
      ...(signal === undefined ? {} : { signal }),
    })
    if (outcome.code !== 0) return null
    // A NUL byte is how git itself reports binary content; never render it as text.
    if (outcome.stdout.includes('\u0000')) return null
    return outcome.stdout
  }

  /** Synthesize the diff of an untracked file, or null when it is not untracked. */
  private async syntheticUntracked(repo: RepoRef, path: string, signal?: AbortSignal): Promise<DiffFile | null> {
    const statusRaw = await this.ports.runner.runSoft(
      ['status', '--porcelain=v2', '-z', '--untracked-files=all', '--', literalPath(path)],
      repo.toplevel,
      { timeoutMs: STATUS_TIMEOUT_MS, ...(signal === undefined ? {} : { signal }) },
    )
    if (statusRaw === null) return null
    const entry = parsePorcelainV2(statusRaw).entries.find((candidate) => candidate.path === path)
    if (entry === undefined || !entry.untracked) return null
    const content = await this.ports.fs.readWorktree(repo.toplevel, path)
    if (content === null) return null
    if (content.kind === 'binary') return addedFileDiff(path, '', { binary: true })
    if (content.kind === 'oversize') return { ...addedFileDiff(path, ''), tooLarge: true, byteLimited: true, hunks: [], patch: 'File content omitted: exceeds the safe byte limit.' }
    const diff = addedFileDiff(path, content.text)
    return content.kind === 'symlink' ? { ...diff, patch: diff.patch.replace('new file mode 100644', 'new file mode 120000') } : diff
  }

  /** Recent checkout history; an immutable commit anchor keeps pagination stable. */
  async history(
    input: SourceRef & { limit?: number; skip?: number; anchor?: string },
    options: ReadOptions = {},
  ): Promise<HistoryPage> {
    if (input.anchor !== undefined && !isHistoryOid(input.anchor)) {
      throw new GitError({ code: 'invalid-name', detail: 'History pagination requires a full commit ID' })
    }
    const repo = await this.repoFor(input, options.signal)
    const head = await this.ports.runner.run(['rev-parse', '--verify', 'HEAD'], repo.toplevel, options)
    if (head.code !== 0) {
      // Only an unborn symbolic HEAD is an empty history; other failures remain errors.
      const status = await this.ports.runner.runOk(['status', '--porcelain=v2', '--branch', '-z'], repo.toplevel, options)
      if (parsePorcelainV2(status).head.unborn) return buildHistory([], { limit: 1 })
      throw new GitError(classifyGitFailure(head))
    }
    const revision = input.anchor === undefined ? head.stdout.trim() : await this.resolveCommit(repo, input.anchor)
    const limit = Math.max(1, Math.min(Math.floor(input.limit ?? 50), 500))
    const skip = Math.max(0, Math.floor(input.skip ?? 0))
    const raw = await this.ports.runner.runOk(
      ['log', '-z', `--pretty=format:${LOG_FORMAT}`, '-n', String(limit + 1), '--skip', String(skip), revision, '--'],
      repo.toplevel,
      { timeoutMs: STATUS_TIMEOUT_MS, ...(options.signal === undefined ? {} : { signal: options.signal }) },
    )
    // One extra row is fetched so the page can say whether more exist; the
    // window itself is still exactly `limit`.
    const page = buildHistory(parseLog(raw), { limit })
    return { ...page, anchor: revision, hasMore: page.commits.length > limit, commits: page.commits.slice(0, limit), lanes: page.lanes.slice(0, limit) }
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
    const modified = [...new Set([...state.changes.staged, ...state.changes.unstaged]
      .filter((entry) => entry.unmerged === undefined)
      .map((entry) => entry.path))]
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
    validatePaths(input.paths)
    return this.ports.runner.mutate(repo.commonDir, async () => {
      await this.assertResolved(repo, undefined, input.paths)
      const outcome = await this.ports.runner.run(['add', '--', ...input.paths.map(literalPath)], repo.toplevel, {
        timeoutMs: WRITE_TIMEOUT_MS,
        lockRetries: 4,
      })
      throwOnFailure(outcome)
      return this.readState(repo, false)
    })
  }

  /** Unstage the given paths, also in a repository with no commits. */
  async unstage(input: SourceRef & { paths: readonly string[] }): Promise<PanelState> {
    const repo = await this.repoFor(input)
    validatePaths(input.paths)
    await this.ports.runner.mutate(repo.commonDir, async () => {
      const hasHead = await this.ports.runner.ok(['rev-parse', '--verify', 'HEAD'], repo.toplevel)
      const args = hasHead
        ? ['reset', '-q', 'HEAD', '--', ...input.paths.map(literalPath)]
        : ['rm', '-r', '--cached', '--quiet', '--', ...input.paths.map(literalPath)]
      const outcome = await this.ports.runner.run(args, repo.toplevel, {
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
    validatePaths(input.paths)
    await this.ports.runner.mutate(repo.commonDir, async () => {
      const statusRaw = await this.ports.runner.runOk(
        ['status', '--porcelain=v2', '-z', '--untracked-files=all', '--ignored=no'],
        repo.toplevel,
        { timeoutMs: STATUS_TIMEOUT_MS },
      )
      const entries = parsePorcelainV2(statusRaw).entries
      const untracked = new Set(entries.filter((entry) => entry.untracked).map((entry) => entry.path))
      const tracked = input.paths.filter((path) => !untracked.has(path))
      const deletes = input.paths.filter((path) => untracked.has(path))

      if (tracked.length > 0) {
        const outcome = await this.ports.runner.run(['restore', '--worktree', '--', ...tracked.map(literalPath)], repo.toplevel, {
          timeoutMs: WRITE_TIMEOUT_MS,
          lockRetries: 4,
        })
        throwOnFailure(outcome)
      }
      for (const path of deletes) await this.ports.fs.remove(join(repo.toplevel, path))
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
  async commit(input: CommitInput): Promise<PanelState> {
    return this.commitTransaction(input, false)
  }

  /** Stage and commit under one queue lease; never add unresolved paths. */
  async commitAll(input: CommitInput): Promise<PanelState> {
    return this.commitTransaction(input, true)
  }

  private async commitTransaction(input: CommitInput, all: boolean): Promise<PanelState> {
    const message = input.message.trim()
    if (message === '') throw new GitError({ code: 'nothing-to-commit', detail: 'empty commit message' })
    if (input.paths !== undefined) validatePaths(input.paths)
    const signal = input.requestId === undefined
      ? undefined
      : this.ports.cancellations?.begin(input.requestId, input.sessionId)
    try {
      // Register before discovery: closing a just-opened commit dialog can race
      // even the first rev-parse, not only a later hook or queue lease.
      const repo = await this.repoFor(input)
      if (signal?.aborted) throw new GitError({ code: 'hook-cancelled', detail: 'commit cancelled' })
      return await this.ports.runner.mutate(repo.commonDir, async () => {
        if (input.expectedHead !== undefined && (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(input.expectedHead) || await this.resolveCommit(repo, 'HEAD') !== input.expectedHead)) {
          throw new GitError({ code: 'dirty-tree', detail: 'The last commit changed; review it again before amending.' })
        }
        await this.assertResolved(repo, signal)
        const previousIndex = all ? await captureIndexSnapshot(this.ports.runner, repo) : null
        let stagedTree: string | undefined
        try {
          if (all) {
            // Git add uses its own index lock and does not install a partial index on failure.
            const paths = input.paths === undefined ? ['.'] : input.paths.map(literalPath)
            const added = await this.ports.runner.run(['add', '-A', '--', ...paths], repo.toplevel, {
              timeoutMs: WRITE_TIMEOUT_MS, lockRetries: 4, signal,
            })
            throwOnFailure(added)
            // Capture the installed tree even if cancellation arrived as add finished.
            stagedTree = (await this.ports.runner.runOk(['write-tree'], repo.toplevel)).trim()
          }
          await this.assertResolved(repo, signal)
          if (input.expectedHead !== undefined && await this.resolveCommit(repo, 'HEAD') !== input.expectedHead) throw new GitError({ code: 'dirty-tree', detail: 'The last commit changed during preparation; review it again before amending.' })
          const args = ['commit', '-m', message]
          if (input.amend === true) args.push('--amend')
          if (input.signoff === true) args.push('--signoff')
          if (!all && input.paths !== undefined) args.push('--', ...input.paths.map(literalPath))
          const outcome = await this.ports.runner.run(args, repo.toplevel, {
            timeoutMs: WRITE_TIMEOUT_MS, lockRetries: 4, signal,
          })
          if (outcome.code !== 0) {
            if (signal?.aborted) throw new GitError({ code: 'hook-cancelled', detail: 'commit cancelled' })
            const failure = classifyGitFailure(outcome)
            const hookOutput = `${outcome.stdout}\n${outcome.stderr}`.trim()
            if (failure.code === 'hook-failed' || (failure.code === 'git-failed' && hookOutput !== '')) {
              throw new GitError({ code: 'hook-failed', detail: hookOutput.slice(-4000), exitCode: outcome.code })
            }
            throw new GitError(failure)
          }
        } catch (error) {
          const shutdownUnconfirmed = error instanceof GitProcessShutdownError
          if (!shutdownUnconfirmed && previousIndex !== null && stagedTree !== undefined) {
            await restoreIndexSnapshot(this.ports.runner, repo, previousIndex, stagedTree)
          }
          throw error
        }
        return this.readState(repo, false)
      })
    } catch (error) {
      if (error instanceof GitProcessShutdownError) throw error
      if (signal?.aborted) throw new GitError({ code: 'hook-cancelled', detail: 'commit cancelled' })
      throw error
    } finally {
      if (input.requestId !== undefined) this.ports.cancellations?.end(input.requestId, signal, input.sessionId)
    }
  }

  /** Refuse unresolved index stages even when a caller would stage them first. */
  private async assertResolved(repo: RepoRef, signal?: AbortSignal, paths?: readonly string[]): Promise<void> {
    const args = ['ls-files', '--unmerged', '-z']
    if (paths !== undefined) args.push('--', ...paths.map(literalPath))
    const unmerged = await this.ports.runner.runOk(args, repo.toplevel, { signal })
    if (unmerged !== '') throw new GitError({ code: 'operation-in-progress', detail: 'Resolve and explicitly stage conflicted files before committing.' })
  }

  /** Cancel only a request owned by the supplied session (unscoped callers remain supported). */
  cancel(requestId: string, sessionId?: string): boolean {
    return this.ports.cancellations?.cancel(requestId, sessionId) ?? false
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
      const compared = branch === null || base === null || entry.path === repo.root
      const noComparison = Promise.resolve(null)
      const [cleanOutcome, aheadRaw, behindRaw, merged] = await Promise.all([
        // Untracked files count as dirt: deleting a worktree would lose them.
        this.ports.runner.runSoft(
          ['status', '--porcelain', '--untracked-files=all'],
          entry.path,
          { timeoutMs: STATUS_TIMEOUT_MS, ...signalArgs },
        ),
        compared
          ? noComparison
          : this.ports.runner.runSoft(['rev-list', '--count', `${base}..${branch}`], repo.root, {
              timeoutMs: STATUS_TIMEOUT_MS,
              ...signalArgs,
            }),
        compared
          ? noComparison
          : this.ports.runner.runSoft(['rev-list', '--count', `${branch}..${base}`], repo.root, {
              timeoutMs: STATUS_TIMEOUT_MS,
              ...signalArgs,
            }),
        compared
          ? Promise.resolve(false)
          : this.ports.runner.ok(['merge-base', '--is-ancestor', branch, base], repo.root, {
              timeoutMs: STATUS_TIMEOUT_MS,
              ...signalArgs,
            }),
      ])
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

  /**
   * Tags for the ref picker, newest first and bounded.
   *
   * Each row carries its tagged commit so the picker can show the same
   * author/hash/subject detail line a branch row shows, and so a detached
   * checkout has a commit id to name.
   */
  private async readTags(repo: RepoRef, signal?: AbortSignal): Promise<TagInfo[]> {
    const raw = await this.ports.runner.runSoft(
      ['for-each-ref', '--count=100', '--sort=-creatordate', `--format=${TAG_FORMAT}`, 'refs/tags'],
      repo.root,
      { timeoutMs: STATUS_TIMEOUT_MS, ...(signal === undefined ? {} : { signal }) },
    )
    return raw === null ? [] : parseTags(raw)
  }

  /** Read both picker lists concurrently; callers do not need their process details. */
  private async readRefs(repo: RepoRef, signal?: AbortSignal): Promise<{
    branches: BranchInfo[]
    tags: TagInfo[]
  }> {
    const [branches, tags] = await Promise.all([
      this.readBranches(repo.toplevel, signal),
      this.readTags(repo, signal),
    ])
    return { branches, tags }
  }

  /**
   * Read the local and remote-tracking branches, most recently committed first.
   *
   * Recency is the order the picker shows: the branch you worked on last is
   * the one you are most likely to switch to.
   */
  async readBranches(cwd: string, signal?: AbortSignal): Promise<BranchInfo[]> {
    const raw = await this.ports.runner.runSoft(
      ['for-each-ref', '--sort=-committerdate', `--format=${BRANCH_FORMAT}`, 'refs/heads', 'refs/remotes'],
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
    const [name, email] = await Promise.all([read('user.name'), read('user.email')])
    return { name, email }
  }

  /**
   * Where HEAD is and everything that can be picked, in one bounded read.
   *
   * The composer's branch chip needs a branch name, its drift and the ref
   * lists; it does not need the working-tree status, the worktree list or the
   * identity. Reading only those keeps a session-start read cheap, and the
   * drift comes from the current branch's own row, so it costs no extra git
   * process.
   */
  async refSummary(input: SourceRef): Promise<RefSummary> {
    const repo = await this.repoFor(input)
    const [refs, branch, raw] = await Promise.all([
      this.readRefs(repo),
      this.branchAt(repo.toplevel),
      this.ports.runner.runSoft(['rev-parse', '--verify', 'HEAD'], repo.toplevel, { timeoutMs: STATUS_TIMEOUT_MS }),
    ])
    const oid = raw === null ? '' : raw.trim()
    const committed = /^[a-f0-9]{40,64}$/.test(oid)
    const current = refs.branches.find((candidate) => candidate.current && !candidate.remote)
    return {
      root: repo.toplevel,
      head: {
        oid: committed ? oid : null,
        branch,
        upstream: current?.upstream ?? null,
        ahead: current?.ahead ?? 0,
        behind: current?.behind ?? 0,
        // A detached checkout has a commit but no branch; an unborn one has a
        // branch name that no commit answers yet.
        detached: branch === null && committed,
        unborn: branch !== null && !committed,
      },
      branches: refs.branches,
      tags: refs.tags,
    }
  }

  /** Public read of the operation state for one repository. */
  async operation(repo: RepoRef, signal?: AbortSignal): Promise<OperationState> {
    const markers = await this.readOperationMarkers(repo.gitDir)
    const statusRaw = await this.ports.runner.runSoft(
      ['status', '--porcelain=v2', '-z', '--untracked-files=no'],
      repo.toplevel,
      { timeoutMs: STATUS_TIMEOUT_MS, ...(signal === undefined ? {} : { signal }) },
    )
    const entries = statusRaw === null ? [] : parsePorcelainV2(statusRaw).entries
    return detectOperation(markers, entries)
  }

  /** Read every marker file git uses to record an in-progress operation. */
  private async readOperationMarkers(gitDir: string): Promise<OperationMarkers> {
    const read = (name: string): Promise<string | null> => this.ports.fs.readText(join(gitDir, name))
    const exists = (name: string): Promise<boolean> => this.ports.fs.exists(join(gitDir, name))
    const [mergeHead, cherryPickHead, revertHead, message, rebaseMerge, rebaseApply, rebaseApplyApplying, rebaseApplyRebasing] = await Promise.all([
      read('MERGE_HEAD'),
      read('CHERRY_PICK_HEAD'),
      read('REVERT_HEAD'),
      read('MERGE_MSG'),
      exists('rebase-merge'),
      exists('rebase-apply'),
      exists('rebase-apply/applying'),
      exists('rebase-apply/rebasing'),
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
      rebaseApplyApplying,
      rebaseApplyRebasing,
      rebaseStep,
    }
  }

  /* --------------------------------------------------------- worktree ops */

  /** The primary branch name, used as the default base for a new worktree. */
  async defaultBase(repo: RepoRef, signal?: AbortSignal): Promise<string> {
    const signalArgs = signal === undefined ? {} : { signal }
    const symbolic = await this.ports.runner.runSoft(['symbolic-ref', '--short', 'HEAD'], repo.toplevel, {
      timeoutMs: STATUS_TIMEOUT_MS,
      ...signalArgs,
    })
    if (symbolic !== null && symbolic.trim() !== '') return symbolic.trim()
    const remoteHead = await this.ports.runner.runSoft(['rev-parse', '--abbrev-ref', 'origin/HEAD'], repo.toplevel, {
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
  /**
   * The setup a create request would perform, before anything is written.
   *
   * Read-only: the panel calls it to show the commands and copied paths, and
   * passes the returned `version` back with whatever the user approved.
   */
  async worktreeSetup(input: SourceRef & WorktreeCreateOptions): Promise<WorktreeSetupPreview> {
    const repo = await this.repoFor(input)
    const created = await this.resolveWorktreeTarget(repo, input.mode === 'ref' ? 'ref' : 'new', input)
    return (await this.planCreate(repo, created)).preview
  }

  /**
   * Create a worktree for a slug.
   *
   * Ordering matters: the exclude entry is written before the directory
   * exists (so a reader can never observe the worktree in `git status`),
   * `worktree add` creates the branch, and a failed create throws rather than
   * leaving a half-made worktree behind.
   *
   * Nothing a repository declares happens unless the caller approved it
   * against the exact preview: `setupApproved` runs `.worktrees.json`,
   * `copyApproved` copies `.worktreeinclude`. A plain create therefore runs no
   * project command and copies no local file, and an approval recorded against
   * a different setup definition is refused before anything runs.
   */
  async worktreeAdd(input: SourceRef & WorktreeCreateOptions): Promise<{
    plan: WorktreePlan
    state: PanelState
    setup: SetupReport
    copied: readonly string[]
    notice: string | null
  }> {
    const repo = await this.repoFor(input)
    return this.ports.runner.mutate(repo.commonDir, async () => {
      const mode = input.mode === 'ref' ? 'ref' : 'new'
      const created = await this.resolveWorktreeTarget(repo, mode, input)
      const planned = await this.planCreate(repo, created)
      const setupApproved = input.setupApproved === true && planned.steps.length > 0
      const copyApproved = input.copyApproved === true && planned.includePaths.length > 0
      if ((setupApproved || copyApproved) && input.expectedSetupVersion !== planned.preview.version) {
        throw new GitError({ code: 'setup-stale', detail: 'setup' })
      }
      const plan = planWorktree({
        root: repo.root,
        slug: created.slug,
        base: created.base,
        branch: created.branch,
        setup: setupApproved ? planned.steps : [],
      })

      await this.ensureExcluded(repo)
      const outcome = await this.ports.runner.run(created.args, repo.root, {
        timeoutMs: WRITE_TIMEOUT_MS,
        lockRetries: 4,
      })
      if (outcome.code !== 0) throw new GitError(classifyGitFailure(outcome))
      const path = created.path

      // Copy before setup: a setup command may need a copied file, and the
      // copy never replaces what the checkout just wrote.
      const copiedResult = copyApproved
        ? await this.copyWorktreeInclude(repo, path, planned.includePaths)
        : { copied: [] as string[], skipped: false }

      let report: SetupReport = { ran: 0, failed: false, output: '' }
      if (setupApproved) {
        report = await runSetupSteps(planned.steps, path, repo.root, {
          parentEnv: this.ports.env,
          ...(this.ports.setupExec === undefined ? {} : { exec: this.ports.setupExec }),
        })
        this.setupReports.set(path, report)
      }

      const skippedSetup = planned.steps.length > 0 && !setupApproved
      const skippedCopy = planned.includePaths.length > 0 && !copyApproved
      return {
        plan,
        state: await this.readState(repo, false),
        setup: report,
        copied: copiedResult.copied,
        notice: planned.notice
          ?? (report.failed ? 'setup-failed'
            : copiedResult.skipped ? 'copy-skipped'
              : skippedSetup || skippedCopy ? 'setup-skipped' : null),
      }
    })
  }

  /** Resolve the setup a create request would perform, its preview included. */
  private async planCreate(
    repo: RepoRef,
    created: { slug: string; path: string; branch: string | null; base: string; oid: string },
  ): Promise<{ steps: SetupStep[]; includePaths: string[]; notice: string | null; preview: WorktreeSetupPreview }> {
    const setup = await this.planSetup(repo)
    const includePaths = await this.planIncludes(repo)
    const preview: WorktreeSetupPreview = {
      root: repo.root,
      slug: created.slug,
      path: created.path,
      branch: created.branch,
      base: created.base,
      baseOid: created.oid,
      version: '',
      steps: setup.steps,
      includePaths,
      notice: setup.error,
    }
    const version = contextFingerprint({
      root: repo.root,
      slug: created.slug,
      path: created.path,
      branch: created.branch,
      base: created.base,
      baseOid: created.oid,
      platform: setupPlatform(this.ports.platform),
      steps: setup.steps,
      includePaths,
      notice: setup.error,
    })
    return { steps: setup.steps, includePaths, notice: setup.error, preview: { ...preview, version } }
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
  ): Promise<{ slug: string; path: string; branch: string | null; base: string; oid: string; args: string[] }> {
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
      const hash = await this.resolveCommit(repo, base)
      return { slug, path, branch, base, oid: hash, args: ['worktree', 'add', '-b', branch, path, hash] }
    }

    const ref = (input.ref ?? '').trim()
    const kind = input.refKind ?? 'branch'
    const refIssue = validateBranchName(ref)
    if (refIssue !== null) throw new GitError({ code: 'invalid-name', detail: refIssue })
    const slug = slugForRef(ref)
    if (slug === '') throw new GitError({ code: 'invalid-name', detail: ref })
    const path = worktreePathFor(repo.root, slug)
    await this.assertWorktreePathFree(repo, path)

    if (kind === 'tag') {
      if (!(await this.ports.runner.ok(['rev-parse', '--verify', `refs/tags/${ref}`], repo.root))) {
        throw new GitError({ code: 'path-missing', detail: ref })
      }
      const hash = await this.resolveCommit(repo, 'refs/tags/' + ref)
      return { slug, path, branch: null, base: ref, oid: hash, args: ['worktree', 'add', '--detach', path, hash] }
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
      const oid = await this.resolveCommit(repo, 'refs/remotes/' + ref)
      return { slug, path, branch, base: ref, oid, args: ['worktree', 'add', '--track', '-b', branch, path, 'refs/remotes/' + ref] }
    }
    if (!(await this.ports.runner.ok(['rev-parse', '--verify', `refs/heads/${ref}`], repo.root))) {
      throw new GitError({ code: 'path-missing', detail: ref })
    }
    const oid = await this.resolveCommit(repo, 'refs/heads/' + ref)
    return { slug, path, branch: ref, base: ref, oid, args: ['worktree', 'add', path, ref] }
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

  /** Resolve `.worktreeinclude` for the primary checkout. */
  private async planIncludes(repo: RepoRef): Promise<string[]> {
    const raw = await this.ports.fs.readText(join(repo.root, INCLUDE_FILE))
    return raw === null ? [] : parseWorktreeInclude(raw)
  }

  /**
   * Copy approved `.worktreeinclude` paths from the primary checkout.
   *
   * The copy is deliberately the safe one: it refuses a symbolic link, a path
   * that grew past the size cap, and an existing destination, so a fresh
   * worktree can never have a tracked file silently replaced or a link
   * followed out of the checkout. A declined path is reported, not retried
   * through a weaker API.
   */
  private async copyWorktreeInclude(
    repo: RepoRef,
    worktreePath: string,
    entries: readonly string[],
  ): Promise<{ copied: string[]; skipped: boolean }> {
    const copied: string[] = []
    let skipped = false
    for (const entry of entries) {
      // A declaration is a wish list: an entry that is simply not there is
      // normal, while a path that exists and was refused is worth reporting.
      if (!(await this.ports.fs.exists(join(repo.root, entry)))) continue
      if (await this.ports.fs.copyWorktree(repo.root, entry, worktreePath)) copied.push(entry)
      else skipped = true
    }
    return { copied, skipped }
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
    return this.ports.runner.mutate(repo.commonDir, async () => {
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
    })
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
    return this.ports.runner.mutate(repo.commonDir, async () => {
      const target = this.containedWorktreePath(repo, input.path)
      const entry = await this.worktreeEntry(repo, target)
      if (entry.branch === null) throw new GitError({ code: 'detached-head', detail: target })
      if ((await this.branchAt(repo.toplevel)) === entry.branch) {
        throw new GitError({ code: 'current-branch', detail: entry.branch })
      }
      await this.assertPreconditions(repo, 'merge')
      const hash = await this.resolveCommit(repo, 'refs/heads/' + entry.branch)
      const outcome = await this.ports.runner.run(['merge', '--no-edit', hash], repo.toplevel, {
        timeoutMs: WRITE_TIMEOUT_MS,
        lockRetries: 4,
      })
      if (outcome.code !== 0 && !(await this.merging(repo.toplevel))) {
        throw new GitError(classifyGitFailure(outcome))
      }
      return this.readState(repo, false)
    })
  }

  /**
   * Update a worktree by merging the comparison base into it.
   *
   * The base is the same ref the panel's rows are measured against, so
   * "Update from main" and "2 ahead of main" talk about the same thing.
   */
  async worktreeUpdate(input: SourceRef & { path: string; base?: string }): Promise<PanelState> {
    const repo = await this.repoFor(input)
    return this.ports.runner.mutate(repo.commonDir, async () => {
      const target = this.containedWorktreePath(repo, input.path)
      const base = input.base ?? (await this.worktreeBaseName(repo))
      if (base === null) throw new GitError({ code: 'no-upstream', detail: target })
      await this.worktreeEntry(repo, target)
      const targetRepo = await this.resolveRepo(target)
      await this.assertPreconditions(targetRepo, 'merge')
      const hash = await this.resolveCommit(repo, base)
      const outcome = await this.ports.runner.run(['merge', '--no-edit', hash], target, {
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
    })
  }

  /** Drop git's records for worktrees whose directories are gone. */
  async worktreePrune(input: SourceRef): Promise<PanelState> {
    const repo = await this.repoFor(input)
    return this.ports.runner.mutate(repo.commonDir, async () => {
      const outcome = await this.ports.runner.run(['worktree', 'prune', '--expire', 'now'], repo.root, {
        timeoutMs: WRITE_TIMEOUT_MS,
        lockRetries: 4,
      })
      if (outcome.code !== 0) throw new GitError(classifyGitFailure(outcome))
      return this.readState(repo, false)
    })
  }

  /** Release a worktree lock so git will move, delete or prune it again. */
  async worktreeUnlock(input: SourceRef & { path: string }): Promise<PanelState> {
    const repo = await this.repoFor(input)
    return this.ports.runner.mutate(repo.commonDir, async () => {
      const target = this.containedWorktreePath(repo, input.path)
      const entry = await this.worktreeEntry(repo, target)
      if (!entry.locked) return this.readState(repo, false)
      const outcome = await this.ports.runner.run(['worktree', 'unlock', target], repo.root, {
        timeoutMs: WRITE_TIMEOUT_MS,
        lockRetries: 4,
      })
      if (outcome.code !== 0) throw new GitError(classifyGitFailure(outcome))
      return this.readState(repo, false)
    })
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

  /** Recheck live safety conditions inside the mutation lease. */
  private async assertPreconditions(repo: RepoRef, action: PreflightAction): Promise<void> {
    const state = await this.readState(repo, false)
    const decision = decidePreflight(this.preflightInput(state, action))
    if (decision.verdict === 'block') throw new GitError({ code: decision.code, detail: decision.detail })
  }

  /** Resolve a single commit, never letting a ref become an option or path checkout. */
  private async resolveCommit(repo: RepoRef, ref: string): Promise<string> {
    if (ref === '' || ref.startsWith('-') || /[\s\u0000-\u001f\u007f]/.test(ref)) {
      throw new GitError({ code: 'invalid-name', detail: ref })
    }
    const raw = await this.ports.runner.runSoft(['rev-parse', '--verify', '--end-of-options', ref + '^{commit}'], repo.toplevel)
    const oid = raw?.trim()
    if (oid === undefined || !/^[a-f0-9]{40,64}$/.test(oid)) throw new GitError({ code: 'path-missing', detail: ref })
    return oid
  }

  /* ------------------------------------------------------------- branches */

  /** Create a branch without checking it out. */
  async branchCreate(input: SourceRef & { name: string; from?: string }): Promise<PanelState> {
    const repo = await this.repoFor(input)
    return this.ports.runner.mutate(repo.commonDir, async () => {
      const issue = validateBranchName(input.name)
      if (issue !== null) throw new GitError({ code: 'invalid-name', detail: issue })
      const args = ['branch', input.name]
      if (input.from !== undefined && input.from !== '') args.push(await this.resolveCommit(repo, input.from))
      const outcome = await this.ports.runner.run(args, repo.toplevel, {
        timeoutMs: WRITE_TIMEOUT_MS,
        lockRetries: 4,
      })
      if (outcome.code !== 0) {
        const failure = classifyGitFailure(outcome)
        if (/already exists/i.test(failure.detail)) throw new GitError({ code: 'branch-exists', detail: input.name })
        throw new GitError(failure)
      }
      return this.readState(repo, false)
    })
  }

  /** Switch to a branch, creating it from a remote-tracking branch when asked. */
  async branchSwitch(input: SourceRef & { name: string; remote?: string }): Promise<PanelState> {
    const repo = await this.repoFor(input)
    return this.ports.runner.mutate(repo.commonDir, async () => {
      await this.assertPreconditions(repo, 'switch-branch')
      const issue = validateBranchName(input.name)
      if (issue !== null) throw new GitError({ code: 'invalid-name', detail: issue })
      if (input.remote !== undefined) {
        const remoteIssue = validateBranchName(input.remote)
        if (remoteIssue !== null) throw new GitError({ code: 'invalid-name', detail: remoteIssue })
        await this.resolveCommit(repo, 'refs/remotes/' + input.remote)
      }
      const args = input.remote === undefined
        ? ['switch', '--no-overwrite-ignore', '--', input.name]
        : ['switch', '--no-overwrite-ignore', '--track', '-c', input.name, 'refs/remotes/' + input.remote]
      const outcome = await this.ports.runner.run(args, repo.toplevel, {
        timeoutMs: WRITE_TIMEOUT_MS,
        lockRetries: 4,
      })
      if (outcome.code !== 0) throw new GitError(classifyGitFailure(outcome))
      return this.readState(repo, false)
    })
  }

  /** Rename a local branch. */
  async branchRename(input: SourceRef & { from: string; to: string; expectedOid?: string }): Promise<PanelState> {
    const repo = await this.repoFor(input)
    return this.ports.runner.mutate(repo.commonDir, async () => {
      await this.assertPreconditions(repo, 'switch-branch')
      const issue = validateBranchName(input.from) ?? validateBranchName(input.to)
      if (issue !== null) throw new GitError({ code: 'invalid-name', detail: issue })
      if (input.expectedOid !== undefined && await this.resolveCommit(repo, 'refs/heads/' + input.from) !== input.expectedOid) throw new GitError({ code: 'dirty-tree', detail: 'Branch changed; review its current tip before renaming' })
      const outcome = await this.ports.runner.run(['branch', '-m', input.from, input.to], repo.toplevel, {
        timeoutMs: WRITE_TIMEOUT_MS,
        lockRetries: 4,
      })
      if (outcome.code !== 0) throw new GitError(classifyGitFailure(outcome))
      return this.readState(repo, false)
    })
  }

  /** Delete a local branch; `force` selects `-D` over `-d`. */
  async branchDelete(input: SourceRef & { name: string; force?: boolean; expectedOid?: string }): Promise<PanelState> {
    const repo = await this.repoFor(input)
    return this.ports.runner.mutate(repo.commonDir, async () => {
      await this.assertPreconditions(repo, 'delete-branch')
      const issue = validateBranchName(input.name)
      if (issue !== null) throw new GitError({ code: 'invalid-name', detail: issue })
      if (input.expectedOid !== undefined && await this.resolveCommit(repo, 'refs/heads/' + input.name) !== input.expectedOid) throw new GitError({ code: 'dirty-tree', detail: 'Branch changed; review its current tip before deleting' })
      const outcome = await this.ports.runner.run(
        ['branch', input.force === true ? '-D' : '-d', '--', input.name],
        repo.toplevel,
        { timeoutMs: WRITE_TIMEOUT_MS, lockRetries: 4 },
      )
      if (outcome.code !== 0) {
        const failure = classifyGitFailure(outcome)
        if (failure.code === 'not-merged') throw new GitError({ code: 'not-merged', detail: input.name })
        throw new GitError(failure)
      }
      return this.readState(repo, false)
    })
  }

  /* ------------------------------------------------------ history writes */

  /** Continue the in-progress operation. */
  async operationContinue(input: SourceRef): Promise<PanelState> {
    const repo = await this.repoFor(input)
    return this.ports.runner.mutate(repo.commonDir, async () => {
      await this.assertResolved(repo)
      const state = await this.readState(repo, false)
      const kind = state.operation.kind
      if (kind === null) throw new GitError({ code: 'operation-in-progress', detail: 'no operation in progress' })
      const args =
        kind === 'merge'
          ? ['commit', '--no-edit']
          : kind === 'rebase'
            ? ['rebase', '--continue']
            : [`${kind}`, '--continue']
      const outcome = await this.ports.runner.run(args, repo.toplevel, {
        timeoutMs: WRITE_TIMEOUT_MS,
        lockRetries: 4,
      })
      if (outcome.code !== 0) throw new GitError(classifyGitFailure(outcome))
      return this.readState(repo, false)
    })
  }

  /** Skip one stopped replay step. Git itself owns the remaining sequence. */
  async operationSkip(input: SourceRef): Promise<PanelState> {
    const repo = await this.repoFor(input)
    return this.ports.runner.mutate(repo.commonDir, async () => {
      const state = await this.readState(repo, false)
      const kind = state.operation.kind
      if (kind === null || kind === 'merge') throw new GitError({ code: 'operation-in-progress', detail: 'This operation has no skippable step' })
      const outcome = await this.ports.runner.run([kind, '--skip'], repo.toplevel, { timeoutMs: WRITE_TIMEOUT_MS })
      if (outcome.code !== 0) throw new GitError(classifyGitFailure(outcome))
      return this.readState(repo, false)
    })
  }

  /** Abort the in-progress operation. */
  async operationAbort(input: SourceRef & { expectedKind?: 'rebase' }): Promise<PanelState> {
    const repo = await this.repoFor(input)
    return this.ports.runner.mutate(repo.commonDir, async () => {
      const state = await this.readState(repo, false)
      const kind = state.operation.kind
      if (kind === null) throw new GitError({ code: 'operation-in-progress', detail: 'no operation in progress' })
      if (input.expectedKind !== undefined && kind !== input.expectedKind) throw new GitError({ code: 'operation-in-progress', detail: 'The active operation changed; review it before aborting.' })
      const args = kind === 'merge' ? ['merge', '--abort'] : [kind, '--abort']
      const outcome = await this.ports.runner.run(args, repo.toplevel, {
        timeoutMs: WRITE_TIMEOUT_MS,
        lockRetries: 4,
      })
      if (outcome.code !== 0) throw new GitError(classifyGitFailure(outcome))
      return this.readState(repo, false)
    })
  }

  /** Merge the current branch's upstream into it. */
  async updateFromBranch(input: SourceRef): Promise<PanelState> {
    const repo = await this.repoFor(input)
    return this.ports.runner.mutate(repo.commonDir, async () => {
      await this.assertPreconditions(repo, 'update')
      const upstream = await this.resolveCommit(repo, '@{u}')
      const outcome = await this.ports.runner.run(['merge', '--no-edit', upstream], repo.toplevel, {
        timeoutMs: WRITE_TIMEOUT_MS,
        lockRetries: 4,
      })
      // A conflicted merge is a recoverable state, not an error.
      if (outcome.code !== 0 && !(await this.merging(repo.toplevel))) {
        throw new GitError(classifyGitFailure(outcome))
      }
      return this.readState(repo, false)
    })
  }

  /** Check out a commit detached (the panel warns first). */
  async checkoutCommit(input: SourceRef & { hash: string }): Promise<PanelState> {
    const repo = await this.repoFor(input)
    return this.ports.runner.mutate(repo.commonDir, async () => {
      await this.assertPreconditions(repo, 'checkout-commit')
      const hash = await this.resolveCommit(repo, input.hash)
      const outcome = await this.ports.runner.run(['checkout', '--no-overwrite-ignore', '--detach', hash], repo.toplevel, {
        timeoutMs: WRITE_TIMEOUT_MS,
        lockRetries: 4,
      })
      if (outcome.code !== 0) throw new GitError(classifyGitFailure(outcome))
      return this.readState(repo, false)
    })
  }

  /* -------------------------------------------------------------- reclaim */

  /**
   * The reincarnation seam `dsh-next-checkpoints` resolves, under the retired
   * `dsh-next-worktrees` key.
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

  /** Collect scope before limits, preserving both sides of partially staged paths. */
  async agentFiles(input: SourceRef & { paths?: readonly string[]; side?: DiffSide; verb?: string; includeSensitive?: boolean }): Promise<{
    state: PanelState
    files: { path: string; patch: string; added: number; removed: number; binary: boolean; staged: boolean }[]
    omittedPaths: readonly string[]
    fingerprint: string
    repositoryVersion: string
    availableFiles: readonly string[]
  }> {
    const state = (await this.state(input)).state
    const changed = changedPaths(state.changes)
    const staged = new Set(state.changes.staged.map((entry) => entry.path))
    const unstaged = new Set([...state.changes.unstaged, ...state.changes.untracked].map((entry) => entry.path))
    const conflicts = new Set(state.changes.conflicts.map((entry) => entry.path))
    const side = input.side ?? (input.verb === 'draft' ? 'staged' : undefined)
    const availableFiles = [...new Set(input.paths ?? changed)].filter((path) => changed.includes(path))
      .filter((path) => input.verb !== 'resolve' || conflicts.has(path))
      .filter((path) => side === undefined || (side === 'staged' ? staged : unstaged).has(path))
    const paths = availableFiles.filter(path => input.includeSensitive === true || !isSensitiveAgentPath(path))
    const files = []
    const omittedPaths = [...paths.slice(40), ...availableFiles.filter(path => !paths.includes(path))]
    for (const path of paths.slice(0, 40)) {
      if (conflicts.has(path)) {
        const conflict = await this.conflicts.inspect(input, path)
        if (input.verb === 'resolve' && !conflict.canSave) throw new GitError({ code: 'git-failed', detail: conflict.unsupportedReason ?? 'Use an explicit file-level choice for non-text conflicts' })
        const sections = [
          'Untrusted conflict evidence. Operation: ' + conflict.labels.operation,
          'Base: ' + (conflict.stages.base.content ?? '[' + conflict.stages.base.kind + ']'),
          conflict.labels.current + ': ' + (conflict.stages.current.content ?? '[' + conflict.stages.current.kind + ']'),
          conflict.labels.incoming + ': ' + (conflict.stages.incoming.content ?? '[' + conflict.stages.incoming.kind + ']'),
          'Working result: ' + (conflict.worktree.content ?? '[' + conflict.worktree.kind + ']'),
        ]
        files.push({ path, patch: sections.join('\n\n').slice(0, 24_001), added: 0, removed: 0,
          binary: conflict.worktree.kind === 'binary', staged: false })
        continue
      }
      const sides: DiffSide[] = side === undefined
        ? [...(staged.has(path) ? ['staged' as const] : []), ...(unstaged.has(path) ? ['unstaged' as const] : [])]
        : [side]
      for (const selected of sides) {
        const entry = (selected === 'staged' ? state.changes.staged : state.changes.unstaged).find(item => item.path === path)
        const result = await this.diff({ ...input, path, side: selected, ...(entry?.oldPath === undefined ? {} : { oldPath: entry.oldPath }) })
        const file = result.file
        if (file?.byteLimited) { if (!omittedPaths.includes(path)) omittedPaths.push(path); continue }
        files.push({
          path, patch: (file?.patch ?? '').slice(0, 24_001),
          added: file?.added ?? 0, removed: file?.removed ?? 0,
          binary: file?.binary ?? false, staged: selected === 'staged',
        })
      }
    }
    const repo = await this.repoFor(input)
    if (repo.toplevel !== state.root) throw new GitError({ code: 'dirty-tree', detail: 'Checkout changed during context preparation' })
    const index = await this.ports.runner.runBytesOk(['ls-files', '--stage', '-z'], repo.toplevel)
    const repositoryVersion = contextFingerprint([state.root, state.cwd, state.head.oid, Buffer.from(index).toString('base64')])
    return { state, files, omittedPaths, availableFiles, repositoryVersion, fingerprint: contextFingerprint({ root: state.root, cwd: state.cwd, head: state.head, operation: state.operation, files, omittedPaths }) }
  }

  /** Remote-tracking branches a checkout could create a local branch from. */
  async remoteCheckoutCandidates(input: SourceRef): Promise<(BranchInfo & { local: string })[]> {
    const repo = await this.repoFor(input)
    const branches = await this.readBranches(repo.toplevel)
    return branches
      .filter((branch) => branch.remote)
      .map((branch) => ({ ...branch, local: localNameForRemote(branch.name) }))
      .filter((branch) => branch.local !== branch.name && !branches.some((other) => other.name === branch.local))
  }

  /** Local branches only, for the switch/delete UI. */
  async localBranchNames(input: SourceRef): Promise<string[]> {
    const repo = await this.repoFor(input)
    return localBranches(await this.readBranches(repo.toplevel)).map((branch) => branch.name)
  }

  /** The degraded state for a terminal failure, for the RPC layer. */
  static degradedFor(error: GitError): ReturnType<typeof degradedFrom> {
    return degradedFrom(error.failure)
  }
}

/** Byte budget for one index copy read into the whole-file change view. */
const INDEX_TEXT_LIMIT = 2 * 1024 * 1024

/**
 * Every displayed line of a text is removed: the shape of a deleted file's view.
 *
 * The trailing newline ends the last line rather than starting an empty one,
 * which is also how the code surface numbers what it draws.
 */
function removedEveryLine(text: string): readonly ChangeMarker[] {
  const body = text.endsWith('\n') ? text.slice(0, -1) : text
  const count = body === '' ? 0 : body.split('\n').length
  return Array.from({ length: count }, (_, index) => ({ line: index + 1, kind: 'removed' as const }))
}

/** Git paths are root-relative filenames, never directories or pathspec expressions. */
function validatePaths(paths: readonly string[]): void {
  if (paths.length === 0) throw new GitError({ code: 'path-missing', detail: 'no paths given' })
  for (const path of paths) {
    if (path === '' || path.includes('\0') || isAbsolute(path) || isUnsafeRelativePath(path)
      || path.split('/').some((part) => part === '' || part === '.' || part.toLowerCase() === '.git')) {
      throw new GitError({ code: 'path-missing', detail: 'Expected a repository-relative file path.' })
    }
  }
}

function literalPath(path: string): string {
  return `:(literal)${path}`
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

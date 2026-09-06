/**
 * Git subprocess runner — the only place the host half shells out to git.
 *
 * Every command runs through execFile with a bounded timeout and returns
 * typed outcomes (GitError carries a machine code plus a user-facing fix
 * hint). Pure parsing lives in src/core; this file owns process mechanics.
 */
import { execFile } from 'node:child_process'
import { computePlacement, type RepoPlacement } from '../core/placement.ts'
import { parseWorktreeList, type WorktreeListEntry } from '../core/registry.ts'
import { porcelainDirtyPaths } from '../core/status.ts'

/** Machine-readable git failure codes surfaced to the client. */
export type GitErrorCode =
  | 'git-unavailable'
  | 'not-a-repository'
  | 'bare-or-unknown-layout'
  | 'already-in-worktree'
  | 'worktree-exists'
  | 'branch-exists'
  | 'dirty-remove-refused'
  | 'merge-blocked'
  | 'git-failed'

/** A git failure with a short, user-facing fix hint. */
export class GitError extends Error {
  constructor(
    readonly code: GitErrorCode,
    message: string,
    readonly hint?: string,
  ) {
    super(message)
    this.name = 'GitError'
  }
}

/** One completed git invocation. */
export interface GitResult {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

/** Injectable executor (tests substitute a fake; production uses execFile). */
export type ExecFn = (
  file: string,
  args: readonly string[],
  options: { cwd: string; timeoutMs: number },
) => Promise<GitResult>

/** Default executor over node:child_process. */
export const execGit: ExecFn = (file, args, options) =>
  new Promise((resolve) => {
    execFile(
      file,
      args,
      { cwd: options.cwd, timeout: options.timeoutMs, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const err = error as (NodeJS.ErrnoException & { code?: number | string }) | null
        if (err && err.code === 'ENOENT') {
          resolve({
            code: 127,
            stdout: String(stdout ?? ''),
            stderr: String(stderr ?? 'git not found'),
          })
          return
        }
        const code = typeof err?.code === 'number' ? err.code : err ? 1 : 0
        resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
      },
    )
  })

const TIMEOUT_MS = 15_000

/** Ports the service consumes; the concrete runner implements all of them. */
export interface GitPorts {
  /** Placement for a cwd, or a GitError carrying the placement issue. */
  placement(cwd: string): Promise<RepoPlacement>
  /** Absolute `git rev-parse --git-common-dir`, or undefined outside a repo. */
  gitCommonDir(cwd: string): Promise<string | undefined>
  /** Live worktree entries (`git worktree list --porcelain`). */
  listWorktrees(primary: string): Promise<WorktreeListEntry[]>
  /** Resolve the default base ref: origin/HEAD, falling back to HEAD. */
  defaultBaseRef(cwd: string): Promise<string>
  /** Whether a ref already exists (`git rev-parse --verify`). */
  refExists(cwd: string, ref: string): Promise<boolean>
  /** Create the worktree plus its branch; returns the worktree path. */
  addWorktree(input: {
    primary: string
    path: string
    branch: string
    baseRef: string
  }): Promise<void>
  /** Remove a worktree; dirty trees refuse unless force. */
  removeWorktree(input: {
    primary: string
    path: string
    force: boolean
  }): Promise<void>
  /** Porcelain line count at a directory (0 = clean). */
  dirtyCount(cwd: string): Promise<number>
  /**
   * Relative paths that count as dirt at a directory (sidecar `.dsh/`
   * omitted). Empty when clean.
   */
  dirtyPaths(cwd: string): Promise<readonly string[]>
  /** `rev-list --count <base>..<branch>` at cwd (the primary, so symbolic bases resolve); 0 when the range is empty. */
  aheadCount(cwd: string, base: string, branch: string): Promise<number>
  /** Whether `merge-base --is-ancestor a b` holds. */
  isAncestor(cwd: string, a: string, b: string): Promise<boolean>
  /** The resolved commit id of a ref (undefined when it does not resolve). */
  revParse(cwd: string, ref: string): Promise<string | undefined>
  /** The checked-out branch name at a directory. */
  currentBranch(cwd: string): Promise<string | undefined>
  /** `git --version` raw stdout. */
  versionStdout(): Promise<string>
  /** merge-tree dry-run exit cleanliness (true = no conflicts). */
  mergeTreeClean(cwd: string, target: string, source: string): Promise<boolean>
  /** The guarded write: `git merge --no-edit <source>` at cwd. */
  merge(cwd: string, source: string): Promise<void>
  /**
   * Merge that MAY leave the tree mid-merge: used for update-from-main
   * inside a worktree. `'clean'` on exit 0; `'conflict'` when MERGE_HEAD
   * remains; anything else throws.
   */
  mergeAllowConflicts(cwd: string, source: string): Promise<'clean' | 'conflict'>
  /** Whether `MERGE_HEAD` exists at cwd (in-flight merge). */
  merging(cwd: string): Promise<boolean>
  /** `git merge --abort` at cwd. */
  mergeAbort(cwd: string): Promise<void>
  /** Execute an arbitrary git call (worktreeinclude copying etc.). */
  raw(args: readonly string[], cwd: string): Promise<GitResult>
}

/** Production GitPorts over execGit. */
export class GitRunner implements GitPorts {
  constructor(private readonly exec: ExecFn = execGit) {}

  private async run(
    args: readonly string[],
    cwd: string,
  ): Promise<GitResult> {
    const result = await this.exec('git', args, { cwd, timeoutMs: TIMEOUT_MS })
    if (result.code !== 0 && /not a git repository/i.test(result.stderr)) {
      throw new GitError('not-a-repository', `git ${args[0]}: not a repository`)
    }
    return result
  }

  private static readonly NOT_REPO = 128

  async gitCommonDir(cwd: string): Promise<string | undefined> {
    try {
      const result = await this.run(
        ['rev-parse', '--path-format=absolute', '--git-common-dir'],
        cwd,
      )
      if (result.code !== 0) return undefined
      const value = result.stdout.trim()
      return value === '' ? undefined : value
    } catch {
      return undefined
    }
  }

  async placement(cwd: string): Promise<RepoPlacement> {
    let commonDir: string | undefined
    try {
      const result = await this.exec('git',
        ['rev-parse', '--path-format=absolute', '--git-common-dir'],
        { cwd, timeoutMs: TIMEOUT_MS })
      if (result.code === 127) {
        throw new GitError('git-unavailable', 'git is not runnable', result.stderr)
      }
      if (result.code === GitRunner.NOT_REPO) {
        throw new GitError('not-a-repository', 'cwd is not inside a work tree')
      }
      commonDir = result.stdout.trim() || undefined
    } catch (error) {
      if (error instanceof GitError) throw error
      throw new GitError('git-unavailable', 'git is not runnable', String(error))
    }
    const outcome = computePlacement({ cwd, gitCommonDir: commonDir })
    if (typeof outcome === 'string') {
      throw new GitError(outcome, `placement refused: ${outcome}`)
    }
    return outcome
  }

  async listWorktrees(primary: string): Promise<WorktreeListEntry[]> {
    const result = await this.run(['worktree', 'list', '--porcelain'], primary)
    if (result.code !== 0) {
      throw new GitError('git-failed', `git worktree list failed: ${result.stderr.trim()}`)
    }
    return parseWorktreeList(result.stdout)
  }

  async defaultBaseRef(cwd: string): Promise<string> {
    const remote = await this.run(
      ['rev-parse', '--verify', '--quiet', 'origin/HEAD'],
      cwd,
    )
    if (remote.code === 0 && remote.stdout.trim() !== '') return 'origin/HEAD'
    return 'HEAD'
  }

  async refExists(cwd: string, ref: string): Promise<boolean> {
    const result = await this.run(
      ['rev-parse', '--verify', '--quiet', ref],
      cwd,
    )
    return result.code === 0
  }

  async addWorktree(input: {
    primary: string
    path: string
    branch: string
    baseRef: string
  }): Promise<void> {
    if (await this.refExists(input.primary, input.branch)) {
      throw new GitError('branch-exists', `branch ${input.branch} already exists`)
    }
    // Parallel checkout (git >= 2.29; unknown -c keys are ignored):
    // `git worktree add` copies every tracked file, which dominates
    // create latency on large trees. workers=0 = one per logical CPU.
    const result = await this.run(
      ['-c', 'checkout.workers=0', 'worktree', 'add', '-b', input.branch, input.path, input.baseRef],
      input.primary,
    )
    if (result.code !== 0) {
      const existed = /already exists|already checked out/i.test(result.stderr)
      throw new GitError(
        existed ? 'worktree-exists' : 'git-failed',
        `git worktree add failed: ${result.stderr.trim()}`,
        existed ? 'the worktree directory or branch already exists; refreshing may help' : undefined,
      )
    }
  }

  async removeWorktree(input: {
    primary: string
    path: string
    force: boolean
  }): Promise<void> {
    if (!input.force && (await this.dirtyCount(input.path)) > 0) {
      throw new GitError(
        'dirty-remove-refused',
        'worktree has uncommitted changes',
        'commit them, or force the removal',
      )
    }
    const args = ['worktree', 'remove', ...(input.force ? ['--force'] : []), input.path]
    const result = await this.run(args, input.primary)
    if (result.code !== 0) {
      throw new GitError('git-failed', `git worktree remove failed: ${result.stderr.trim()}`)
    }
  }

  async dirtyCount(cwd: string): Promise<number> {
    return (await this.dirtyPaths(cwd)).length
  }

  async dirtyPaths(cwd: string): Promise<readonly string[]> {
    const result = await this.run(['status', '--porcelain'], cwd)
    if (result.code !== 0) {
      throw new GitError('git-failed', `git status failed: ${result.stderr.trim()}`)
    }
    return porcelainDirtyPaths(result.stdout)
  }

  async aheadCount(cwd: string, base: string, branch: string): Promise<number> {
    const result = await this.run(
      ['rev-list', '--count', `${base}..${branch}`],
      cwd,
    )
    const value = Number(result.stdout.trim())
    return Number.isFinite(value) && value > 0 ? value : 0
  }

  async isAncestor(cwd: string, a: string, b: string): Promise<boolean> {
    const result = await this.run(
      ['merge-base', '--is-ancestor', a, b],
      cwd,
    )
    return result.code === 0
  }

  async revParse(cwd: string, ref: string): Promise<string | undefined> {
    const result = await this.run(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], cwd)
    if (result.code !== 0) return undefined
    const value = result.stdout.trim()
    return value === '' ? undefined : value
  }

  async currentBranch(cwd: string): Promise<string | undefined> {
    const result = await this.run(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)
    if (result.code !== 0) return undefined
    const name = result.stdout.trim()
    return name === '' || name === 'HEAD' ? undefined : name
  }

  async versionStdout(): Promise<string> {
    const result = await this.exec('git', ['--version'], {
      cwd: process.cwd(),
      timeoutMs: TIMEOUT_MS,
    })
    return result.stdout
  }

  async mergeTreeClean(cwd: string, target: string, source: string): Promise<boolean> {
    const result = await this.exec('git',
      ['merge-tree', '--write-tree', target, source],
      { cwd, timeoutMs: TIMEOUT_MS })
    // Exit 1 with conflicted-file info on stdout means conflicts; exit 0
    // printed the merged tree id.
    return result.code === 0
  }

  async merge(cwd: string, source: string): Promise<void> {
    const result = await this.run(['merge', '--no-edit', source], cwd)
    if (result.code !== 0) {
      throw new GitError(
        'merge-blocked',
        `git merge failed: ${result.stderr.trim()}`,
        'the preflight should have caught this; resolve manually',
      )
    }
  }

  async mergeAllowConflicts(cwd: string, source: string): Promise<'clean' | 'conflict'> {
    const result = await this.run(['merge', '--no-edit', source], cwd)
    if (result.code === 0) return 'clean'
    if (await this.merging(cwd)) return 'conflict'
    throw new GitError(
      'merge-blocked',
      `git merge failed: ${result.stderr.trim()}`,
      'resolve manually inside the worktree',
    )
  }

  async merging(cwd: string): Promise<boolean> {
    const result = await this.run(['rev-parse', '-q', '--verify', 'MERGE_HEAD'], cwd)
    return result.code === 0
  }

  async mergeAbort(cwd: string): Promise<void> {
    const result = await this.run(['merge', '--abort'], cwd)
    if (result.code !== 0) {
      throw new GitError('git-failed', `git merge --abort failed: ${result.stderr.trim()}`)
    }
  }

  async raw(args: readonly string[], cwd: string): Promise<GitResult> {
    return this.run(args, cwd)
  }
}

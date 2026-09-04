/**
 * Git subprocess runner — the only place the host half shells out to git.
 *
 * Every command runs through execFile with a bounded timeout and returns
 * typed outcomes (GitError carries a machine code plus a user-facing fix
 * hint). Pure parsing lives in src/core; this file owns process mechanics.
 */
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { computePlacement, type RepoPlacement } from '../core/placement.ts'
import { parseWorktreeList } from '../core/registry.ts'

/** Machine-readable git failure codes surfaced to the client. */
export type GitErrorCode =
  | 'git-unavailable'
  | 'not-a-repository'
  | 'bare-or-unknown-layout'
  | 'worktree-exists'
  | 'branch-exists'
  | 'dirty-remove-refused'
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
        const code = typeof err?.code === 'number' ? err.code : err ? 1 : 0
        resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
      },
    )
  })

/** Resolved repository facts for one directory. */
export interface RepoFacts {
  readonly toplevel: string
  readonly gitCommonDir: string
  readonly placement: RepoPlacement
}

/**
 * The git runner. One instance per host; all methods are stateless apart
 * from the injected executor and timeout.
 */
export class GitRunner {
  constructor(
    private readonly exec: ExecFn = execGit,
    private readonly timeoutMs = 15_000,
  ) {}

  private async git(args: readonly string[], cwd: string): Promise<GitResult> {
    return this.exec('git', args, { cwd, timeoutMs: this.timeoutMs })
  }

  /** Run `git --version`; false when no usable git binary exists. */
  async available(): Promise<boolean> {
    const result = await this.git(['--version'], process.cwd())
    return result.code === 0
  }

  /**
   * Resolve repository facts for a directory. Throws GitError
   * 'not-a-repository' outside a repo; 'bare-or-unknown-layout' when the
   * common dir does not yield a primary working tree.
   */
  async facts(cwd: string): Promise<RepoFacts> {
    const toplevelResult = await this.git(
      ['rev-parse', '--show-toplevel'], cwd,
    )
    if (toplevelResult.code !== 0) {
      throw new GitError('not-a-repository', 'not inside a git repository')
    }
    const commonResult = await this.git(
      ['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd,
    )
    const toplevel = toplevelResult.stdout.trim()
    const gitCommonDir = commonResult.stdout.trim()
    const placement = computePlacement(toplevel, gitCommonDir)
    if (commonResult.code !== 0 || placement === null) {
      throw new GitError(
        'bare-or-unknown-layout',
        'repository layout does not expose a primary working tree',
      )
    }
    return { toplevel, gitCommonDir, placement }
  }

  /** Resolve the creation base: `origin/HEAD`, falling back to `HEAD`. */
  async resolveBaseRef(cwd: string): Promise<string | null> {
    const origin = await this.git(
      ['rev-parse', '--verify', '--quiet', 'origin/HEAD'], cwd,
    )
    if (origin.code === 0) return 'origin/HEAD'
    const local = await this.git(
      ['rev-parse', '--verify', '--quiet', 'HEAD'], cwd,
    )
    return local.code === 0 ? 'HEAD' : null
  }

  /** Whether a branch name already exists. */
  async branchExists(cwd: string, branch: string): Promise<boolean> {
    const result = await this.git(
      ['rev-parse', '--verify', '--quiet', branch], cwd,
    )
    return result.code === 0
  }

  /**
   * Create a linked worktree on a new branch.
   * `worktree-exists` / `branch-exists` map to the client's one-click retry
   * (fresh slug); anything else is a plain git-failed.
   */
  async createWorktree(input: {
    primaryRoot: string
    path: string
    branch: string
    baseRef: string
  }): Promise<void> {
    const result = await this.git(
      ['worktree', 'add', '-b', input.branch, input.path, input.baseRef],
      input.primaryRoot,
    )
    if (result.code === 0) return
    if (/already exists/i.test(result.stderr) || /already checked out/i.test(result.stderr)) {
      if (await this.branchExists(input.primaryRoot, input.branch)) {
        throw new GitError('branch-exists', `branch ${input.branch} already exists`)
      }
      throw new GitError('worktree-exists', `worktree at ${input.path} already exists`)
    }
    throw new GitError('git-failed', result.stderr.trim() || 'git worktree add failed')
  }

  /**
   * Remove a worktree. Without `force`, git refuses a dirty worktree — the
   * refusal maps to `dirty-remove-refused` so the UI can ask for explicit
   * confirmation before retrying with force.
   */
  async removeWorktree(input: {
    primaryRoot: string
    path: string
    force: boolean
  }): Promise<void> {
    const args = ['worktree', 'remove', input.path]
    if (input.force) args.push('--force')
    const result = await this.git(args, input.primaryRoot)
    if (result.code === 0) return
    if (!input.force && /dirty|contains modified|use --force/i.test(result.stderr)) {
      throw new GitError(
        'dirty-remove-refused',
        'worktree has uncommitted or untracked changes',
        'remove keeps nothing: commit or stash first, or confirm a forced remove',
      )
    }
    throw new GitError('git-failed', result.stderr.trim() || 'git worktree remove failed')
  }

  /** Worktree paths from `git worktree list --porcelain` (git is truth). */
  async listWorktrees(primaryRoot: string): Promise<readonly string[]> {
    const result = await this.git(
      ['worktree', 'list', '--porcelain'], primaryRoot,
    )
    if (result.code !== 0) {
      throw new GitError('git-failed', result.stderr.trim() || 'git worktree list failed')
    }
    return parseWorktreeList(result.stdout)
  }

  /**
   * Commits on a branch not on its base. Runs from the primary and names
   * the branch explicitly: `HEAD` is contextual (in a linked worktree it is
   * the branch itself), while refs are repo-global.
   */
  async aheadCount(primaryRoot: string, baseRef: string, branch: string): Promise<number | null> {
    const result = await this.git(
      ['rev-list', '--count', `${baseRef}..${branch}`], primaryRoot,
    )
    if (result.code !== 0) return null
    const trimmed = result.stdout.trim()
    if (!/^\d+$/.test(trimmed)) return null
    return Number.parseInt(trimmed, 10)
  }

  /** Dirty flag from `git status --porcelain`; null when git failed. */
  async dirty(worktreeDir: string): Promise<boolean | null> {
    const result = await this.git(
      ['status', '--porcelain'], worktreeDir,
    )
    if (result.code !== 0) return null
    return result.stdout.trim().length > 0
  }

  /** Whether the repo's gitignore covers the worktree dir (via check-ignore). */
  async dirIgnored(primaryRoot: string, dir: string): Promise<boolean> {
    const result = await this.git(
      ['check-ignore', '-q', dir], primaryRoot,
    )
    // check-ignore: 0 ignored, 1 not ignored, 128 error (no ignore file) -> not ignored
    return result.code === 0
  }

  /** Read `.worktreeinclude` lines (paths to copy into new worktrees). */
  async worktreeInclude(primaryRoot: string): Promise<readonly string[]> {
    let raw: string
    try {
      raw = await readFile(`${primaryRoot}/.worktreeinclude`, 'utf8')
    } catch {
      return []
    }
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'))
  }
}

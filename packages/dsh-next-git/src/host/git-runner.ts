/**
 * The host half's only place that spawns git.
 *
 * Three concerns live here, and nowhere else:
 *
 * - **Process mechanics** — `execFile` with a bounded timeout, a bounded
 *   buffer, and an optional `AbortSignal` for the cancellable reads.
 * - **Index contention** — the session's own agent runs git in the same
 *   repository, so mutations serialize per repository and an `index.lock`
 *   collision retries with backoff before it is reported as a named state.
 * - **Classification** — every failure becomes a `GitFailure` (see
 *   `core/degraded.ts`), never a raw stderr string.
 *
 * Pure parsing stays in `core/`; this file owns processes.
 */

import { execFile } from 'node:child_process'
import { classifyGitFailure, type RawGitOutcome } from '../core/degraded.ts'
import type { GitFailure } from '../core/types.ts'

/** A git invocation that did not succeed, carrying its classified failure. */
export class GitError extends Error {
  readonly failure: GitFailure

  constructor(failure: GitFailure, message?: string) {
    super(message ?? (failure.detail === '' ? failure.code : failure.detail))
    this.name = 'GitError'
    this.failure = failure
  }
}

/** Every failure a caller may catch from the runner. */
export function isGitError(error: unknown): error is GitError {
  return error instanceof GitError
}

/** Injectable executor, so tests can drive the runner without spawning git. */
export type ExecFn = (
  file: string,
  args: readonly string[],
  options: { cwd: string; timeoutMs: number; maxBuffer: number; signal?: AbortSignal | undefined },
) => Promise<RawGitOutcome>

/** Production executor over `node:child_process`. */
export const execGit: ExecFn = (file, args, options) =>
  new Promise((resolve) => {
    execFile(
      file,
      [...args],
      {
        cwd: options.cwd,
        timeout: options.timeoutMs,
        maxBuffer: options.maxBuffer,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        env: gitEnv(),
      },
      (error, stdout, stderr) => {
        const err = error as (Error & { code?: number | string; killed?: boolean }) | null
        if (err !== null && err.code === 'ENOENT') {
          resolve({ code: 127, stdout: '', stderr: 'git not found on PATH', spawnFailed: true })
          return
        }
        const aborted = options.signal?.aborted === true
        if (err !== null && aborted) {
          resolve({ code: 130, stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), killed: true })
          return
        }
        const code = typeof err?.code === 'number' ? err.code : err === null ? 0 : 1
        resolve({
          code,
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? ''),
          ...(err?.killed === true && err.code === null ? { killed: true } : {}),
        })
      },
    )
  })

/**
 * Environment for every git child.
 *
 * The plugin must never inherit a user's interactive git environment in a way
 * that changes behavior non-deterministically: no editor, no pager, and no
 * terminal prompts (a prompt would hang the panel behind a hidden TTY).
 */
export function gitEnv(parent: Readonly<Record<string, string | undefined>> = process.env): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(parent)) {
    if (value !== undefined) env[key] = value
  }
  env.GIT_TERMINAL_PROMPT = '0'
  env.GIT_PAGER = 'cat'
  env.GIT_EDITOR = 'true'
  env.GIT_OPTIONAL_LOCKS = '0'
  env.LC_ALL = 'C'
  return env
}

/** Bounded limits for one invocation. */
export interface RunOptions {
  readonly timeoutMs?: number
  readonly signal?: AbortSignal | undefined
  /** Retry `index.lock` collisions this many times (writes only). */
  readonly lockRetries?: number
}

/** Default timeout for a read. */
export const READ_TIMEOUT_MS = 20_000

/** Default timeout for a write; hooks can be slow, but not unbounded. */
export const WRITE_TIMEOUT_MS = 120_000

/** Default timeout for status/diff on a large repository. */
export const STATUS_TIMEOUT_MS = 30_000

const MAX_BUFFER = 32 * 1024 * 1024

/** Backoff schedule for `index.lock` collisions, in milliseconds. */
export const LOCK_BACKOFF_MS = [50, 150, 400, 900] as const

/** Whether a failure is the transient index-lock collision the panel retries. */
export function isLockContention(failure: GitFailure): boolean {
  return failure.code === 'index-locked'
}

/**
 * Serializes mutations per repository and executes bounded git calls.
 *
 * Reads are not serialized: `git status` and `git diff` are safe to run
 * concurrently with each other and with a write. Mutations go through
 * {@link GitRunner.mutate}, which queues per repository key so two panel
 * clicks (or a panel click and the session's agent) never interleave an
 * index update.
 */
export class GitRunner {
  /** Per-repository tail of the mutation queue. */
  private readonly chains = new Map<string, Promise<void>>()

  constructor(
    private readonly exec: ExecFn = execGit,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  /** Run git and return the raw outcome; never throws for a non-zero exit. */
  async run(args: readonly string[], cwd: string, options: RunOptions = {}): Promise<RawGitOutcome> {
    const timeoutMs = options.timeoutMs ?? READ_TIMEOUT_MS
    if (options.signal?.aborted === true) {
      return { code: 130, stdout: '', stderr: 'cancelled', killed: true }
    }
    let outcome = await this.exec('git', args, {
      cwd,
      timeoutMs,
      maxBuffer: MAX_BUFFER,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })

    const retries = options.lockRetries ?? 0
    for (let attempt = 0; attempt < retries; attempt += 1) {
      const failure = classifyGitFailure(outcome)
      if (!isLockContention(failure)) break
      const backoff = LOCK_BACKOFF_MS[Math.min(attempt, LOCK_BACKOFF_MS.length - 1)]!
      await this.sleep(backoff)
      if (options.signal !== undefined && options.signal.aborted) break
      outcome = await this.exec('git', args, {
        cwd,
        timeoutMs,
        maxBuffer: MAX_BUFFER,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      })
    }

    return outcome
  }

  /** Run git and throw a {@link GitError} on any non-zero exit. */
  async runOk(args: readonly string[], cwd: string, options: RunOptions = {}): Promise<string> {
    const outcome = await this.run(args, cwd, options)
    if (outcome.code !== 0) throw new GitError(classifyGitFailure(outcome))
    return outcome.stdout
  }

  /**
   * Run git, returning null instead of throwing.
   *
   * @returns stdout on success, null when the invocation failed.
   */
  async runSoft(args: readonly string[], cwd: string, options: RunOptions = {}): Promise<string | null> {
    const outcome = await this.run(args, cwd, options)
    return outcome.code === 0 ? outcome.stdout : null
  }

  /** Whether `git <args>` exits zero. */
  async ok(args: readonly string[], cwd: string, options: RunOptions = {}): Promise<boolean> {
    const outcome = await this.run(args, cwd, options)
    return outcome.code === 0
  }

  /**
   * Run one mutation under the repository's serialization lock.
   *
   * The lock is a promise chain per `repoKey` (the repository root). A failing
   * mutation does not poison the chain: the next caller still runs.
   *
   * @param repoKey - stable repository identity (its primary root).
   * @param work - the mutation; receives the run helpers.
   * @returns the mutation's value.
   */
  async mutate<T>(repoKey: string, work: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(repoKey) ?? Promise.resolve()
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = previous.then(() => gate)
    this.chains.set(repoKey, tail)

    await previous
    try {
      return await work()
    } finally {
      release?.()
      // Only the last waiter clears the key; an interleaved caller already
      // replaced the map entry with a newer tail.
      if (this.chains.get(repoKey) === tail) this.chains.delete(repoKey)
    }
  }

  /** Cancel a read by aborting its signal; writes are not cancellable. */
  static aborted(): RawGitOutcome {
    return { code: 130, stdout: '', stderr: 'cancelled', killed: true }
  }
}

/** A cancellation registry: one-shot controllers keyed by request id. */
export class CancellationRegistry {
  private readonly controllers = new Map<string, AbortController>()

  /** Create (or replace) the controller for a request id. */
  begin(requestId: string): AbortSignal {
    this.controllers.get(requestId)?.abort()
    const controller = new AbortController()
    this.controllers.set(requestId, controller)
    return controller.signal
  }

  /** Abort one request; returns whether it was in flight. */
  cancel(requestId: string): boolean {
    const controller = this.controllers.get(requestId)
    if (controller === undefined) return false
    controller.abort()
    this.controllers.delete(requestId)
    return true
  }

  /** Drop the controller once its request settled. */
  end(requestId: string): void {
    this.controllers.delete(requestId)
  }

  /** Abort everything; used on plugin unload. */
  dispose(): void {
    for (const controller of this.controllers.values()) controller.abort()
    this.controllers.clear()
  }
}

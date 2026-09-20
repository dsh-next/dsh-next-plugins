/**
 * The host half's only place that spawns git.
 *
 * Three concerns live here, and nowhere else:
 *
 * - **Process mechanics** — an owned process group with bounded timeout,
 *   output and shutdown, and an optional `AbortSignal`.
 * - **Index contention** — the session's own agent runs git in the same
 *   repository, so mutations serialize per repository and an `index.lock`
 *   collision retries with backoff before it is reported as a named state.
 * - **Classification** — every failure becomes a `GitFailure` (see
 *   `core/degraded.ts`), never a raw stderr string.
 *
 * Pure parsing stays in `core/`; this file owns processes.
 */

import { spawn } from 'node:child_process'
import { AsyncLocalStorage } from 'node:async_hooks'
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

/**
 * The OS could not confirm tree shutdown within the bound. Unlike an ordinary
 * Git failure, rollback and subsequent mutations are unsafe; the owning service
 * must retain/quarantine its repository lease rather than restoring files.
 */
export class GitProcessShutdownError extends GitError {
  constructor(detail: string) {
    super({ code: 'git-failed', detail })
    this.name = 'GitProcessShutdownError'
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

/** Binary reads preserve blob bytes rather than round-tripping through UTF-8. */
export interface RawGitBytesOutcome {
  readonly code: number
  readonly stdout: Uint8Array
  readonly stderr: string
  readonly spawnFailed?: boolean
  readonly killed?: boolean
}

export type ExecBytesFn = (file: string, args: readonly string[], options: Parameters<ExecFn>[2]) => Promise<RawGitBytesOutcome>

/** Grace for cooperative hooks, then a bounded wait for forced shutdown. */
const TERMINATE_GRACE_MS = 250
const KILL_WAIT_MS = 2_000

/**
 * One lifecycle for both ports. POSIX children own a new process group, so a
 * hook's children (even with closed stdio) cannot outlive cancellation unnoticed.
 * A hook that deliberately daemonizes into another session/group escapes this
 * boundary; this is not coordination with arbitrary external repository writers.
 * Windows is refused before spawning: Node has no process-group/job-object tree
 * guarantee there, and this port cannot distinguish reads from cancellable writes.
 * OS signal failures/unconfirmed shutdown are explicit failures, not a claim that
 * rollback is safe. Callers must not treat such a failure as ordinary cancellation.
 */
const execManaged: ExecBytesFn = (file, args, options) => new Promise((resolve, reject) => {
  const empty = (code: number, stderr: string): RawGitBytesOutcome => ({ code, stdout: new Uint8Array(), stderr })
  if (options.signal?.aborted) {
    resolve({ ...empty(130, 'cancelled'), killed: true })
    return
  }
  if (process.platform === 'win32') {
    resolve(empty(1, 'Managed Git execution is unsupported on Windows: safe process-tree shutdown is unavailable.'))
    return
  }
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 0) {
    throw new RangeError('timeoutMs must be a nonnegative integer')
  }
  if (Number.isNaN(options.maxBuffer) || options.maxBuffer < 0) {
    throw new RangeError('maxBuffer must be nonnegative')
  }
  const child = spawn(file, [...args], {
    cwd: options.cwd, env: gitEnv(), detached: true, stdio: ['ignore', 'pipe', 'pipe'], shell: false,
  })
  const stdout: Buffer[] = []
  const stderr: Buffer[] = []
  let stdoutSize = 0
  let stderrSize = 0
  let closed = false
  let settled = false
  let groupGone = child.pid === undefined
  let exitCode = 1
  let exitSignal: NodeJS.Signals | null = null
  let error: NodeJS.ErrnoException | undefined
  let reason: 'cancelled' | 'timeout' | 'maxBuffer' | undefined
  let signalError = ''
  let stopping = false
  let forced = false
  let graceDeadline = 0
  let shutdownDeadline = 0
  let timeout: ReturnType<typeof setTimeout> | undefined
  let shutdownTimer: ReturnType<typeof setTimeout> | undefined

  // Never address a group again once ESRCH was observed, avoiding stale-id kills.
  const signalGroup = (signal: NodeJS.Signals | 0): void => {
    if (groupGone || child.pid === undefined) return
    try {
      process.kill(-child.pid, signal)
    } catch (cause) {
      const err = cause as NodeJS.ErrnoException
      if (err.code === 'ESRCH') groupGone = true
      else signalError = 'Process-group signal ' + signal + ' failed: ' + err.message
    }
  }
  const finish = (unconfirmed = false): void => {
    if (settled) return
    settled = true
    clearTimeout(timeout)
    clearTimeout(shutdownTimer)
    options.signal?.removeEventListener('abort', onAbort)
    child.stdout.removeListener('data', onStdout)
    child.stderr.removeListener('data', onStderr)
    // Escaped descendants may retain pipes; do not keep the host alive forever.
    child.stdout.destroy()
    child.stderr.destroy()
    child.removeListener('exit', onExit)
    child.removeListener('close', onClose)
    child.removeListener('error', onError)
    child.unref()
    if (unconfirmed) {
      reject(new GitProcessShutdownError(('Git process-tree shutdown unconfirmed; do not rollback or start another mutation. ' + signalError).trim()))
      return
    }
    const missing = error?.code === 'ENOENT'
    const detail = Buffer.concat(stderr, stderrSize).toString('utf8') || (missing ? 'git not found on PATH' : error?.message ?? '')
    resolve({
      code: reason === 'cancelled' ? 130 : missing ? 127 : reason !== undefined || error !== undefined ? 1 : exitCode,
      stdout: Buffer.concat(stdout, stdoutSize), stderr: detail,
      ...(missing ? { spawnFailed: true } : {}),
      ...(reason !== undefined || exitSignal !== null ? { killed: true } : {}),
    })
  }
  const checkShutdown = (): void => {
    signalGroup(0)
    if (closed && groupGone) {
      finish()
      return
    }
    const now = performance.now()
    if (!forced && now >= graceDeadline) {
      forced = true
      signalGroup('SIGKILL')
    }
    if (now >= shutdownDeadline) {
      finish(true)
      return
    }
    shutdownTimer = setTimeout(checkShutdown, 10)
  }
  const stop = (): void => {
    if (stopping || settled) return
    stopping = true
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', onAbort)
    graceDeadline = performance.now() + TERMINATE_GRACE_MS
    shutdownDeadline = graceDeadline + KILL_WAIT_MS
    signalGroup('SIGTERM')
    checkShutdown()
  }
  const terminate = (why: NonNullable<typeof reason>): void => {
    if (closed || stopping || settled) return
    reason = why
    stop()
  }
  const onAbort = (): void => terminate('cancelled')
  const collect = (chunks: Buffer[], chunk: Buffer, size: number): number => {
    if (settled) return size
    const remaining = Math.max(0, options.maxBuffer - size)
    if (remaining > 0) chunks.push(chunk.subarray(0, remaining))
    if (chunk.length > remaining && reason === undefined) {
      reason = 'maxBuffer'
      stop()
    }
    return size + Math.min(chunk.length, remaining)
  }
  const onStdout = (chunk: Buffer): void => { stdoutSize = collect(stdout, chunk, stdoutSize) }
  const onStderr = (chunk: Buffer): void => { stderrSize = collect(stderr, chunk, stderrSize) }
  const onError = (cause: Error): void => {
    error = cause
    // Spawn failure still emits close. Errors after spawn also require tree cleanup.
    if (child.pid !== undefined) stop()
  }
  const onExit = (): void => {
    // Git can exit while a hook descendant still holds inherited pipes open.
    // Start cleanup at exit, not only close, but continue draining bounded output.
    signalGroup(0)
    if (!groupGone) stop()
  }
  const onClose = (code: number | null, signal: NodeJS.Signals | null): void => {
    closed = true
    exitCode = code ?? 1
    exitSignal = signal
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', onAbort)
    signalGroup(0)
    if (groupGone) finish()
    else stop()
  }
  child.stdout.on('data', onStdout)
  child.stderr.on('data', onStderr)
  child.once('error', onError)
  child.once('exit', onExit)
  child.once('close', onClose)
  options.signal?.addEventListener('abort', onAbort, { once: true })
  if (options.timeoutMs > 0) timeout = setTimeout(() => terminate('timeout'), options.timeoutMs)
  // Cover an abort between the pre-spawn check and listener installation.
  if (options.signal?.aborted) onAbort()
})

/** Bounded raw-byte executor sharing the deterministic Git environment. */
export const execGitBytes: ExecBytesFn = execManaged

/** Production text port; decode only after the shared byte lifecycle settles. */
export const execGit: ExecFn = async (file, args, options) => {
  const outcome = await execManaged(file, args, options)
  return { ...outcome, stdout: Buffer.from(outcome.stdout).toString('utf8') }
}

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
  env.GIT_ASKPASS = 'true'
  env.SSH_ASKPASS = 'true'
  env.SSH_ASKPASS_REQUIRE = 'never'
  // GUI operations use standard SSH configuration, never an interactive askpass helper.
  env.GIT_SSH_COMMAND = 'ssh -o BatchMode=yes -o StrictHostKeyChecking=yes'
  env.GIT_SSH_VARIANT = 'ssh'
  delete env.GIT_SSH
  env.GIT_PAGER = 'cat'
  env.GIT_EDITOR = 'true'
  env.GIT_OPTIONAL_LOCKS = '0'
  // Callers supply explicit literal pathspecs; inherited modes must not reinterpret them.
  for (const key of ['GIT_LITERAL_PATHSPECS', 'GIT_GLOB_PATHSPECS', 'GIT_NOGLOB_PATHSPECS', 'GIT_ICASE_PATHSPECS']) {
    delete env[key]
  }
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
 * requests cannot interleave an index update. External Git processes do not
 * participate in this queue; Git's own locks still apply.
 */
export class GitRunner {
  /** Per-repository tail of the mutation queue. */
  private readonly chains = new Map<string, Promise<void>>()
  /** Fail closed after an OS-level shutdown failure; ordinary Git errors do not poison queues. */
  private readonly shutdownFailures = new Map<string, GitProcessShutdownError>()
  private readonly lease = new AsyncLocalStorage<string>()

  constructor(
    private readonly exec: ExecFn = execGit,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    private readonly execBytes: ExecBytesFn = execGitBytes,
  ) {}

  /** Quarantine immediately, even if an operation catches and converts the error. */
  private async managed<T>(run: () => Promise<T>): Promise<T> {
    const key = this.lease.getStore()
    const blocked = key === undefined ? undefined : this.shutdownFailures.get(key)
    if (blocked) throw blocked
    try { return await run() } catch (error) {
      if (key !== undefined && error instanceof GitProcessShutdownError) this.shutdownFailures.set(key, error)
      throw error
    }
  }

  private invoke(file: string, args: readonly string[], options: Parameters<ExecFn>[2]): Promise<RawGitOutcome> {
    return this.managed(() => this.exec(file, args, options))
  }

  private invokeBytes(file: string, args: readonly string[], options: Parameters<ExecFn>[2]): Promise<RawGitBytesOutcome> {
    return this.managed(() => this.execBytes(file, args, options))
  }

  /** Read a bounded binary Git result without corrupting non-UTF8 content. */
  async runBytesOk(args: readonly string[], cwd: string, options: RunOptions = {}): Promise<Uint8Array> {
    if (options.signal?.aborted) throw new GitError({ code: 'cancelled', detail: '' })
    const outcome = await this.invokeBytes('git', args, {
      cwd, timeoutMs: options.timeoutMs ?? READ_TIMEOUT_MS, maxBuffer: MAX_BUFFER,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
    if (outcome.code !== 0) throw new GitError(classifyGitFailure({ ...outcome, stdout: '' }))
    return outcome.stdout
  }

  /** Run git and return the raw outcome; never throws for a non-zero exit. */
  async run(args: readonly string[], cwd: string, options: RunOptions = {}): Promise<RawGitOutcome> {
    const timeoutMs = options.timeoutMs ?? READ_TIMEOUT_MS
    if (options.signal?.aborted === true) {
      return { code: 130, stdout: '', stderr: 'cancelled', killed: true }
    }
    let outcome = await this.invoke('git', args, {
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
      outcome = await this.invoke('git', args, {
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
   * The lock is a promise chain per `repoKey` (the common git directory). A failing
   * mutation does not poison the chain, except unconfirmed process-tree shutdown:
   * that repository is quarantined and queued callbacks are refused.
   *
   * @param repoKey - stable repository identity (its common git directory).
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
      const unsafe = this.shutdownFailures.get(repoKey)
      if (unsafe !== undefined) throw unsafe
      return await this.lease.run(repoKey, async () => {
        const value = await work()
        const unconfirmed = this.shutdownFailures.get(repoKey)
        if (unconfirmed !== undefined) throw unconfirmed
        return value
      })
    } catch (error) {
      if (error instanceof GitProcessShutdownError) this.shutdownFailures.set(repoKey, error)
      throw error
    } finally {
      release?.()
      // Only the last waiter clears the key; an interleaved caller already
      // replaced the map entry with a newer tail.
      if (this.chains.get(repoKey) === tail) this.chains.delete(repoKey)
    }
  }

  /** The raw outcome used when cancellation prevents execution. */
  static aborted(): RawGitOutcome {
    return { code: 130, stdout: '', stderr: 'cancelled', killed: true }
  }
}

/** A cancellation registry: one-shot controllers keyed by request id. */
export class CancellationRegistry {
  private readonly controllers = new Map<string, AbortController>()

  /** Create (or replace) the controller for a request id. */
  begin(requestId: string, sessionId?: string): AbortSignal {
    const key = this.key(requestId, sessionId)
    this.controllers.get(key)?.abort()
    const controller = new AbortController()
    this.controllers.set(key, controller)
    return controller.signal
  }

  /** Abort one request; returns whether it was in flight. */
  cancel(requestId: string, sessionId?: string): boolean {
    const key = this.key(requestId, sessionId)
    const controller = this.controllers.get(key)
    if (controller === undefined) return false
    controller.abort()
    this.controllers.delete(key)
    return true
  }

  /** Drop only the controller this request owns; legacy unowned cleanup remains supported. */
  end(requestId: string, signal?: AbortSignal, sessionId?: string): void {
    const key = this.key(requestId, sessionId)
    if (signal === undefined || this.controllers.get(key)?.signal === signal) this.controllers.delete(key)
  }

  private key(requestId: string, sessionId?: string): string {
    return JSON.stringify([sessionId ?? null, requestId])
  }

  /** Abort everything; used on plugin unload. */
  dispose(): void {
    for (const controller of this.controllers.values()) controller.abort()
    this.controllers.clear()
  }
}

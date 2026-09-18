/**
 * The refresh model.
 *
 * The panel re-reads the repository on open, on window focus, when the tab
 * becomes visible again, after the session's agent finishes a turn, and on the
 * manual Refresh carried over from the retired plugin. Those triggers arrive
 * at arbitrary times — a focus event during a write, an agent turn ending
 * while a diff is open — so they run through one coalescing scheduler:
 *
 * - a refresh already in flight is never duplicated;
 * - triggers that arrive while one is in flight collapse into exactly one
 *   follow-up run;
 * - the manual path reports its own completion so the spinner can stop.
 *
 * The scheduler owns no timers of its own: `schedule` is injected, which is
 * what makes the whole model testable with a fake clock.
 */

/** Why a refresh was requested; the panel uses it for the spinner only. */
export type RefreshReason = 'open' | 'focus' | 'visible' | 'agent-turn' | 'manual' | 'write'

/** What one refresh run may report. */
export interface RefreshResult {
  /** Whether the repository state actually changed since the last read. */
  readonly changed: boolean
}

/** The scheduler's dependencies. */
export interface RefreshPorts {
  /** Perform one read. Resolves when the read settled (success or failure). */
  readonly load: (reason: RefreshReason) => Promise<RefreshResult>
  /** Report a read failure; the scheduler itself never throws. */
  readonly onError: (error: unknown) => void
  /** Schedule a callback; defaults to `setTimeout(…, 0)`. */
  readonly schedule?: (callback: () => void) => void
}

/**
 * A single-flight, trailing-coalescing refresh scheduler.
 */
export class RefreshScheduler {
  private running = false
  private pending: RefreshReason | null = null
  private disposed = false
  /** Resolvers waiting on the next settled run, for `refreshNow`. */
  private waiters: (() => void)[] = []

  constructor(private readonly ports: RefreshPorts) {}

  /** Whether a read is in flight. */
  get busy(): boolean {
    return this.running
  }

  /**
   * Request a refresh.
   *
   * @param reason - what asked for it.
   * @param wait - resolve when this request (or the run that absorbs it) settles.
   * @returns a promise that settles after the read that covers this request.
   */
  async request(reason: RefreshReason, wait = false): Promise<void> {
    if (this.disposed) return
    if (this.running) {
      this.pending = mergeReasons(this.pending, reason)
      if (wait) await new Promise<void>((resolve) => this.waiters.push(resolve))
      return
    }
    if (wait) {
      const settled = new Promise<void>((resolve) => this.waiters.push(resolve))
      await this.run(reason)
      await settled
      return
    }
    await this.run(reason)
  }

  /** Trigger a refresh without awaiting it; used by event listeners. */
  trigger(reason: RefreshReason): void {
    void this.request(reason)
  }

  /** Stop accepting work and drop waiters. */
  dispose(): void {
    this.disposed = true
    this.flushWaiters()
  }

  /** One read, then exactly one coalesced follow-up when triggers arrived. */
  private async run(reason: RefreshReason): Promise<void> {
    this.running = true
    let current: RefreshReason | null = reason
    while (current !== null && !this.disposed) {
      try {
        await this.ports.load(current)
      } catch (error) {
        this.ports.onError(error)
      }
      current = this.pending
      this.pending = null
    }
    this.running = false
    this.flushWaiters()
  }

  /** Release everyone waiting on the settled run. */
  private flushWaiters(): void {
    const waiters = this.waiters
    this.waiters = []
    for (const resolve of waiters) resolve()
  }
}

/** Coalesce two reasons, keeping the more deliberate one. */
export function mergeReasons(pending: RefreshReason | null, next: RefreshReason): RefreshReason {
  if (pending === null) return next
  const rank: Record<RefreshReason, number> = {
    'agent-turn': 0,
    focus: 1,
    visible: 1,
    open: 2,
    write: 3,
    manual: 4,
  }
  return rank[next] >= rank[pending] ? next : pending
}

/** Whether a change to the visible state should trigger a refresh. */
export function visibleTriggered(hidden: boolean): boolean {
  return !hidden
}

/**
 * Wire the DOM triggers a panel has: window focus and tab visibility.
 *
 * @param target - the window-like object (a stub in tests).
 * @param onTrigger - called with the reason to refresh.
 * @param isHidden - whether the document is hidden right now.
 * @returns a disposer removing both listeners.
 */
export function bindDomTriggers(
  target: {
    addEventListener(type: string, listener: () => void): void
    removeEventListener(type: string, listener: () => void): void
  },
  onTrigger: (reason: RefreshReason) => void,
  isHidden: () => boolean = () => (typeof document === 'undefined' ? false : document.hidden),
): () => void {
  const onFocus = (): void => onTrigger('focus')
  const onVisibility = (): void => {
    if (visibleTriggered(isHidden())) onTrigger('visible')
  }
  target.addEventListener('focus', onFocus)
  target.addEventListener('visibilitychange', onVisibility)
  return () => {
    target.removeEventListener('focus', onFocus)
    target.removeEventListener('visibilitychange', onVisibility)
  }
}

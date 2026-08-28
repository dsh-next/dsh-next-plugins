/**
 * Stateful host implementation for the notifier: owns the presence report,
 * the pending queue, the sound backend, and the event listeners. Constructed
 * once per apply() and disposed with the plugin fiber.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import type { NotifierConfig } from '../core/types.ts'
import type { TimerLike } from '../core/timer.ts'
import { decide, type Presence } from '../core/decision.ts'
import { normalizeConfig } from '../core/config.ts'
import { SOUNDS } from '../core/sounds.ts'
import { SoundDriver, type Backends } from './sound-driver.ts'

// Load the Cordis event augmentations each of these SDK packages declares
// (agent/status, subagent/end, approval/request, tools/execute, goal/changed)
// so `ctx.on(...)` type-checks against the real event vocabulary.
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-subagent'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import type { ToolDispatchExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-goal'

const PRESENCE_MAX_AGE_MS = 25000
const PENDING_MAX_AGE_MS = 30000
const PENDING_MAX = 100
const FINISH_SETTLE_MS = 2000

type EventKind = 'finished' | 'approval' | 'question' | 'subagent' | 'goal-complete' | 'goal-blocked'
type GroupKey = 'finished' | 'approval' | 'question'

export interface Pending {
  id: number
  kind: EventKind
  title: string
  body: string
  sessionId: string | null
  at: number
}

/** Minimal structural timer surface (matches the merged Context timer). */
export type { TimerLike } from '../core/timer.ts'

export interface NotifierOptions {
  ctx: Context
  scope: SettingsScope<NotifierConfig> | null
  timer: TimerLike | undefined
  goals: { get(agent: unknown): { phase: string; activation: string } | undefined } | undefined
}

export class Notifier {
  private presence: Presence | null = null
  private presenceAt = 0
  private pending: Pending[] = []
  private pendingSeq = 0
  private webPermission: 'granted' | 'denied' | 'default' | 'unsupported' | null = null
  private finishTimer: (() => void) | null = null
  private backends: Backends = { win: null, sh: null, afplay: null, paplay: null, aplay: null }
  private readonly driver: SoundDriver
  private readonly disposers: (() => void)[] = []

  constructor(private readonly opts: NotifierOptions) {
    const sp = this.opts.ctx.get('subprocess')
    const cwd = this.opts.ctx.get('sandboxPolicy')?.workspaceRoot ?? '.'
    this.driver = new SoundDriver(sp, cwd)
  }

  config(): NotifierConfig {
    let stored: unknown = null
    if (this.opts.scope) {
      try { stored = this.opts.scope.get() ?? null } catch { stored = null }
    }
    return normalizeConfig(stored)
  }

  /**
   * The full browser-facing state envelope for the settings card: normalized
   * config, the detected playback platform, the browser notification
   * permission, and the sound catalog (for the per-category sound selectors).
   */
  state() {
    return {
      config: this.config(),
      platform: this.platformName(),
      webPermission: this.webPermission,
      sounds: SOUNDS.map((s) => ({ id: s.id, name: s.name, group: s.group })),
    }
  }

  /** Canonical platform label matching the card's `platformName()` mapping. */
  private platformName(): string | null {
    if (this.backends.afplay) return 'macos'
    if (this.backends.win) return 'windows'
    if (this.backends.paplay || this.backends.aplay) return 'linux'
    return null
  }

  /** Detect backend players and pre-generate the sound set. */
  async start(): Promise<void> {
    this.backends = await this.driver.detect()
    await this.driver.ensureSounds(this.config().volume, this.backends)
    this.wire()
  }

  /** Re-synthesize sounds after a volume change (keeps last good on failure). */
  onConfigChanged(): void {
    void this.driver.ensureSounds(this.config().volume, this.backends)
  }

  preview(id: string): boolean {
    return this.driver.play(id, this.backends)
  }

  // ---- presence / permission reporting (called by the RPC layer) ----

  reportPresence(p: Partial<Presence>): void {
    this.presence = {
      focused: p.focused === true,
      visible: p.visible !== false,
      open: (p as { open?: boolean }).open !== false,
      sessionId: typeof p.sessionId === 'string' ? p.sessionId : null,
    }
    this.presenceAt = Date.now()
  }

  reportWebPermission(status: string): void {
    if (['granted', 'denied', 'default', 'unsupported'].includes(status)) {
      this.webPermission = status as Notifier['webPermission']
    }
  }

  getPresence() {
    return {
      focused: this.presence ? this.presence.focused : false,
      visible: this.presence ? this.presence.visible : true,
      sessionId: this.presence ? this.presence.sessionId : null,
      ageMs: this.presence ? Date.now() - this.presenceAt : null,
    }
  }

  drainPending(): Pending[] {
    const now = Date.now()
    const fresh = this.pending.filter((p) => now - p.at <= PENDING_MAX_AGE_MS)
    this.pending = []
    return fresh
  }

  // ---- notification pipeline ----

  private notify(kind: EventKind, groupKey: GroupKey, title: string, body: string, sessionId: string | null, viewingAtEvent?: boolean): boolean {
    const cfg = this.config()
    const decision = decide(
      {
        config: cfg,
        presence: this.presence,
        presenceAgeMs: Date.now() - this.presenceAt,
        eventKind: kind,
        title,
        body,
        sessionId,
        viewingAtEvent,
        group: groupKey,
        subagentEnabled: cfg.finished.subagent,
      },
      PRESENCE_MAX_AGE_MS,
      this.webPermission,
    )
    if (!decision.notify) return false
    this.pending.push({ id: ++this.pendingSeq, kind, title, body, sessionId, at: Date.now() })
    if (this.pending.length > PENDING_MAX) this.pending.shift()
    if (decision.soundName) this.driver.play(decision.soundName, this.backends)
    return true
  }

  private scheduleFinish(agent: unknown): void {
    this.cancelFinishTimer()
    const sessionId = this.sessionIdOf(agent)
    const viewingAtIdle = this.isViewingNow(sessionId)
    const quietForGoal = this.config().finished.goalOnly && this.goalActiveArmed(agent)
    const timer = this.opts.timer
    if (timer) {
      this.finishTimer = timer.timeout(() => {
        this.finishTimer = null
        if (!quietForGoal) {
          this.notify('finished', 'finished', 'Agent finished', 'Agent finished its turn.', sessionId, viewingAtIdle)
        }
      }, FINISH_SETTLE_MS)
    } else if (!quietForGoal) {
      this.notify('finished', 'finished', 'Agent finished', 'Agent finished its turn.', sessionId, viewingAtIdle)
    }
  }

  private cancelFinishTimer(): void {
    if (this.finishTimer) {
      try { this.finishTimer() } catch {}
      this.finishTimer = null
    }
  }

  private wire(): void {
    const { ctx } = this.opts
    this.disposers.push(ctx.on('agent/status', (payload: unknown) => {
      if (!payload || typeof payload !== 'object') return
      const p = payload as { status?: string; agent?: unknown }
      if (p.status === 'idle') this.scheduleFinish(p.agent)
    }))

    this.disposers.push(ctx.on('subagent/end', (info: unknown) => {
      const i = (info && typeof info === 'object' ? info : {}) as { id?: string }
      this.notify('subagent', 'finished', 'Subagent finished', 'A subagent finished its turn.', typeof i.id === 'string' ? i.id : null)
    }))

    this.disposers.push(ctx.on('approval/request', (req: ApprovalRequest, next: () => Promise<ApprovalOutcome>): Promise<ApprovalOutcome> => {
      const tool = typeof req.toolName === 'string' ? req.toolName : 'a tool'
      const reason = typeof req.reason === 'string' && req.reason.length > 0 ? ' - ' + req.reason : ''
      this.notify('approval', 'approval', 'Approval needed', 'Waiting for your approval: ' + tool + reason, this.sessionIdOf(req.agent))
      return next()
    }))

    this.disposers.push(ctx.on('tools/execute', (exec: ToolDispatchExecution, next: () => Promise<ToolExecutionResult>): Promise<ToolExecutionResult> => {
      if (exec.name === 'ask_user_question') {
        this.notify('question', 'question', 'Question asked', 'The agent asked you a question and is waiting for your answer.', this.sessionIdOf((exec as { agent?: unknown }).agent))
      }
      return next()
    }))

    this.disposers.push(ctx.on('goal/changed', (payload: unknown) => {
      const p = (payload && typeof payload === 'object' ? payload : {}) as {
        agent?: unknown
        change?: { operation?: string; goal?: { blockedReason?: { message?: string } } }
      }
      const change = p.change
      if (!change) return
      const sessionId = this.sessionIdOf(p.agent)
      if (change.operation === 'complete') {
        this.notify('goal-complete', 'finished', 'Goal completed', 'The session goal completed.', sessionId)
      } else if (change.operation === 'block') {
        const reason = change.goal?.blockedReason?.message && change.goal.blockedReason.message.length > 0
          ? change.goal.blockedReason.message
          : 'No reason given'
        this.notify('goal-blocked', 'finished', 'Goal blocked', 'The session goal was blocked: ' + reason, sessionId)
      }
    }))
  }

  // ---- helpers ----

  private sessionIdOf(agent: unknown): string | null {
    const a = (agent && typeof agent === 'object' ? agent : {}) as { session?: { id?: unknown }; sessionId?: unknown }
    if (a.session && typeof a.session.id === 'string') return a.session.id
    if (typeof a.sessionId === 'string') return a.sessionId
    return null
  }

  private isViewingNow(sessionId: string | null): boolean {
    if (!sessionId || !this.presence) return false
    if (Date.now() - this.presenceAt > PRESENCE_MAX_AGE_MS) return false
    return this.presence.focused === true && this.presence.visible === true && this.presence.sessionId === sessionId
  }

  private goalActiveArmed(agent: unknown): boolean {
    const goals = this.opts.goals
    if (!goals || typeof goals.get !== 'function') return false
    try {
      const view = goals.get(agent)
      return !!view && view.phase === 'active' && view.activation === 'armed'
    } catch {
      return false
    }
  }

  dispose(): void {
    this.cancelFinishTimer()
    for (const off of this.disposers) {
      try { off() } catch {}
    }
    this.disposers.length = 0
  }
}

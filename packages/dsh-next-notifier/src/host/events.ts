import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session, TurnEndReason } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-goal'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-user-questions/types'
import type { NotificationEvent } from '../core/notifications.ts'
import type { NotifierConfig } from '../core/types.ts'
import type { TimerLike } from '../core/timer.ts'

export interface EventOptions {
  ctx: Context
  timer: TimerLike
  config: () => NotifierConfig
  goals: { get(agent: Agent): { phase: string; activation: string } | undefined } | undefined
  publish: (event: NotificationEvent) => () => void
}

type Cancel = () => void
interface SessionState {
  agent?: Agent
  lastTurn?: number
  goalRef?: string
  subagentRun?: string
  goalTerminal?: boolean
  event?: NotificationEvent
  cancelTimer?: Cancel
  cancelQueued?: Cancel
}

function child(session: Session): boolean {
  return session.header.origin === 'subagent' || (session.header.delegationDepth ?? 0) > 0
}

function terminal(sessionId: string, reason: TurnEndReason['kind']): NotificationEvent | undefined {
  switch (reason) {
    case 'completed': return { kind: 'finished', group: 'finished', title: 'Agent finished', body: 'Agent finished its turn.', sessionId }
    case 'error': return { kind: 'error', group: 'finished', title: 'Agent error', body: 'The agent turn ended with an error.', sessionId }
    case 'blocked': return { kind: 'blocked', group: 'finished', title: 'Agent blocked', body: 'The agent turn was blocked.', sessionId }
    case 'max-tokens': return { kind: 'max-tokens', group: 'finished', title: 'Agent reached token limit', body: 'The agent reached its output-token limit.', sessionId }
    default: return undefined
  }
}

/** Observe only: cleanup and delivery failures must never change tool outcomes. */
function cancel(dispose?: Cancel): void {
  try { dispose?.() } catch { /* A failed notification cleanup must not affect the agent. */ }
}

/** Register every listener synchronously; all pending work belongs to the returned disposer. */
export function wireEvents({ ctx, timer, config, goals, publish }: EventOptions): Cancel {
  let disposed = false
  const sessions = new Map<string, SessionState>()
  const deadAgents = new WeakSet<Agent>()
  const requests = new Map<Cancel, Agent>()
  const listeners: Cancel[] = []

  function state(id: string, agent?: Agent): SessionState {
    let value = sessions.get(id)
    if (!value) { value = {}; sessions.set(id, value) }
    if (agent) value.agent = agent
    return value
  }

  function reset(value: SessionState): void {
    cancel(value.cancelTimer); value.cancelTimer = undefined
    cancel(value.cancelQueued); value.cancelQueued = undefined
    value.event = undefined
  }

  function goalView(agent: Agent) {
    try { return goals?.get(agent) } catch { return undefined }
  }

  function schedule(value: SessionState): void {
    if (disposed || value.cancelTimer || !value.event || value.cancelQueued) return
    if (value.agent && value.agent.status !== 'idle') return
    value.cancelTimer = timer.timeout(() => {
      value.cancelTimer = undefined
      const event = value.event
      const agent = value.agent
      if (disposed || !event || (agent && (deadAgents.has(agent) || agent.status !== 'idle'))) return
      value.event = undefined
      const goal = agent && goalView(agent)
      if (event.kind === 'finished' && config().finished.goalOnly && goal?.phase === 'active' && goal.activation === 'armed') return
      if (goal && event.kind === 'goal-complete' && goal.phase !== 'complete') return
      if (goal && event.kind === 'goal-blocked' && goal.phase !== 'blocked') return
      if (value.subagentRun && !config().finished.subagent) return
      try {
        const retract = publish(event)
        if (disposed || (agent && (deadAgents.has(agent) || agent.status !== 'idle'))) cancel(retract)
        else value.cancelQueued = retract
      } catch { /* Delivery is not agent work. */ }
    }, 2000)
  }

  // Keep the waterfall's result/rejection unchanged. The delay distinguishes a
  // pending human answer from immediate unavailability, rejection, or tool failure.
  function pending<T>(agent: Agent, signal: AbortSignal | undefined, event: NotificationEvent, next: () => Promise<T>): Promise<T> {
    const result = next()
    if (disposed || deadAgents.has(agent) || signal?.aborted) return result
    let done = false
    let cancelTimer: Cancel | undefined
    let cancelQueued: Cancel | undefined
    const cleanup = () => {
      if (done) return
      done = true
      cancel(cancelTimer)
      cancel(cancelQueued)
      signal?.removeEventListener('abort', cleanup)
      requests.delete(cleanup)
    }
    requests.set(cleanup, agent)
    signal?.addEventListener('abort', cleanup, { once: true })
    try {
      cancelTimer = timer.timeout(() => {
        cancelTimer = undefined
        if (!done && !disposed && !signal?.aborted) {
          try {
            const retract = publish(event)
            if (done) cancel(retract)
            else cancelQueued = retract
          } catch { /* Delivery is not tool work. */ }
        }
      }, 200)
    } catch { cleanup() }
    return (async () => {
      try { return await result } finally { cleanup() }
    })()
  }

  listeners.push(ctx.on('agent/status', ({ agent, status }) => {
    if (disposed || deadAgents.has(agent)) return
    const value = state(agent.session.id, agent)
    if (status === 'running') {
      reset(value)
      value.goalTerminal = false
    } else {
      schedule(value)
    }
  }))

  listeners.push(ctx.on('session/event', (session, event) => {
    if (disposed || child(session)) return
    if (event.type !== 'turn/start' && event.type !== 'turn/end') return
    const value = state(session.id)
    if (value.agent && deadAgents.has(value.agent)) return
    if (event.type === 'turn/start') {
      // Turn counters can restart after session replacement or synthetic markers.
      // A new boundary supersedes the old terminal, even within one running driver.
      reset(value)
      value.lastTurn = undefined
      value.goalTerminal = false
      return
    }
    if (value.lastTurn !== undefined && event.data.turn <= value.lastTurn) return
    value.lastTurn = event.data.turn
    if (value.goalTerminal) return
    reset(value)
    value.event = terminal(session.id, event.data.reason.kind)
    // A turn boundary is not idle: an autonomous continuation may already be queued.
    if (value.agent) schedule(value)
  }))

  listeners.push(ctx.on('goal/changed', ({ agent, change }) => {
    if (disposed || deadAgents.has(agent) || child(agent.session)) return
    const value = state(agent.session.id, agent)
    const ref = change.ref.id + ':' + change.ref.revision
    if (value.goalRef === ref) return
    value.goalRef = ref
    if (change.operation !== 'complete' && change.operation !== 'block') {
      if (value.goalTerminal) reset(value)
      value.goalTerminal = false
      return
    }
    reset(value)
    value.goalTerminal = true
    value.event = change.operation === 'complete'
      ? { kind: 'goal-complete', group: 'finished', title: 'Goal completed', body: 'The session goal completed.', sessionId: agent.session.id }
      : { kind: 'goal-blocked', group: 'finished', title: 'Goal blocked', body: 'The session goal was blocked: ' + (change.goal?.blockedReason?.message || 'No reason given'), sessionId: agent.session.id }
    schedule(value)
  }))

  listeners.push(ctx.on('subagent/start', info => {
    if (disposed) return
    const value = sessions.get(info.id)
    if (value) reset(value)
  }))

  listeners.push(ctx.on('subagent/end', info => {
    if (disposed) return
    if (!config().finished.subagent) {
      const existing = sessions.get(info.id)
      if (existing) reset(existing)
      return
    }
    const value = state(info.id)
    if (value.subagentRun === info.runId) return
    reset(value)
    value.subagentRun = info.runId
    // This event is authoritative even for non-resident and already disposed children.
    value.agent = undefined
    sessions.delete(info.id)
    sessions.set(info.id, value)
    value.event = info.stopReason === 'completed'
      ? { kind: 'subagent', group: 'finished', title: 'Subagent finished', body: 'A subagent finished its turn.', sessionId: info.id }
      : terminal(info.id, info.stopReason === 'refusal' ? 'blocked' : info.stopReason)
    if (value.event && info.stopReason !== 'completed') {
      value.event.title = value.event.title.replace('Agent', 'Subagent')
      value.event.body = value.event.body.replace('agent', 'subagent')
    }
    if (value.event) value.event.isSubagent = true
    schedule(value)
    // Remote runs and end-after-dispose children have no later disposed event.
    // Keep only the latest queue-sized window of their cancellation/dedup state.
    const detached = [...sessions].filter(([, entry]) => entry.subagentRun && !entry.agent)
    for (const [id, entry] of detached.slice(0, Math.max(0, detached.length - 100))) {
      reset(entry)
      sessions.delete(id)
    }
  }))

  listeners.push(ctx.on('approval/request', (req, next) => pending(req.agent, req.signal, {
    kind: 'approval', group: 'approval', title: 'Approval needed',
    body: 'Waiting for your approval: ' + req.toolName + (req.reason ? ' - ' + req.reason : ''),
    sessionId: req.agent.session.id,
  }, next)))

  // This SDK seam runs after validation and live-root ownership checks. Tool
  // dispatch can instead be waiting on policy or an internal parent answerer.
  listeners.push(ctx.on('user-questions/request', (req, next) => {
    if (!req.agent) return next()
    return pending(req.agent, req.signal, {
      kind: 'question', group: 'question', title: 'Question asked',
      body: 'The agent asked you a question and is waiting for your answer.',
      sessionId: req.agent.session.id,
    }, next)
  }))

  listeners.push(ctx.on('agent/disposed', ({ agent }) => {
    deadAgents.add(agent)
    const value = sessions.get(agent.session.id)
    if (value && (!value.agent || value.agent === agent)) {
      reset(value)
      sessions.delete(agent.session.id)
    }
    for (const [cleanup, owner] of requests) if (owner === agent) cleanup()
  }))

  return () => {
    if (disposed) return
    disposed = true
    for (const listener of listeners) cancel(listener)
    for (const value of sessions.values()) reset(value)
    for (const cleanup of requests.keys()) cleanup()
    listeners.length = 0
    sessions.clear()
  }
}

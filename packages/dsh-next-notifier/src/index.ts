/** Wire host event policy and delivery; all presentation is client-owned. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { configScope } from './host/config-scope.ts'
import { notifierSchema, type NotifierConfigShape } from './core/schema.ts'
import type { TimerLike } from './core/timer.ts'
import { Notifier } from './host/notifier.ts'
import { registerRpc } from './host/rpc.ts'

export const name = 'dsh-next-notifier'
export const inject = ['settings', 'webServer', 'timer'] as const
export const Config = notifierSchema
export type { NotifierConfigShape }

export function apply(ctx: Context, config?: NotifierConfigShape): void {
  const scope = configScope(ctx, config)
  const notifier = new Notifier({ ctx, scope, timer: ctx.get('timer') as TimerLike,
    goals: { get: (agent: Agent) => ctx.get('goals')?.get(agent) } })
  registerRpc(ctx, notifier, scope)
  notifier.wire()
  ctx.effect(() => () => notifier.dispose())
}

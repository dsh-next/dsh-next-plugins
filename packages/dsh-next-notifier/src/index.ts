/**
 * Host loader entry for the notifier plugin — runs in the DSH host process.
 *
 * The host half registers the settings namespace, owns the presence/queue
 * state, listens to the agent/approval/tool/goal/subagent events, and serves a
 * same-origin JSON RPC route for the browser card. All behavior lives in
 * `src/host/` (stateful) and `src/core/` (pure); this entry stays thin.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import { notifierSchema, type NotifierConfigShape } from './core/schema.ts'
import { NOTIFIER_NAMESPACE } from './core/namespace.ts'
import type { TimerLike } from './core/timer.ts'
import { Notifier } from './host/notifier.ts'
import { registerRpc } from './host/rpc.ts'

export const inject = ['settings', 'webServer', 'subprocess'] as const

export function apply(ctx: Context): void {
  const settings = ctx.get('settings')
  const timerRaw = ctx.get('timer') as TimerLike | undefined
  const goals = ctx.get('goals')

  // Register the settings namespace (typed scope). Without the settings
  // service the card still renders but config cannot persist; the notifier
  // keeps notifying with in-memory defaults.
  const scope: SettingsScope<NotifierConfigShape> | null = settings && typeof settings.register === 'function'
    ? settings.register(NOTIFIER_NAMESPACE, notifierSchema, { applies: 'live' })
    : null

  const notifier = new Notifier({ ctx, scope, timer: timerRaw ?? undefined, goals })

  // Re-synthesize the sound set when the stored config's volume changes.
  if (scope && typeof scope.watch === 'function') {
    scope.watch(() => notifier.onConfigChanged())
  }

  registerRpc(ctx, notifier, scope)

  // Wire the event listeners synchronously: effects created after an await
  // (start's async sound detection used to wire) land on an inactive context
  // once loading has moved on, which aborted the whole profile load.
  notifier.wire()

  void notifier.start()

  ctx.effect(() => () => notifier.dispose())
}

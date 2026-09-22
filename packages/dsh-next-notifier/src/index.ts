/**
 * Host loader entry for the notifier plugin — runs in the DSH host process.
 *
 * DeepSeek Harness 0.1.7 derives plugin settings from the owning Loader entry's
 * own config, so the notifier's card configuration is this plugin's `Config`
 * rather than a registered namespace. Every field is volatile, so a write
 * commits into the running fiber without a restart. The host half owns the
 * presence/queue state, listens to the agent/approval/tool/goal/subagent
 * events, and serves a same-origin JSON RPC route for the browser card. All
 * behavior lives in `src/host/` (stateful) and `src/core/` (pure); this entry
 * stays thin.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import { notifierSchema, type NotifierConfigShape } from './core/schema.ts'
import type { NotifierConfig } from './core/types.ts'
import type { TimerLike } from './core/timer.ts'
import { Notifier } from './host/notifier.ts'
import { registerRpc } from './host/rpc.ts'

export const name = 'dsh-next-notifier'

export const inject = ['settings', 'webServer', 'subprocess', 'timer'] as const

/** The Loader reads the exported schema to build this plugin's settings form. */
export const Config = notifierSchema

export type { NotifierConfigShape }

/** Structural face of the profile config editor this plugin writes through. */
interface ConfigEditorFace {
  edit(
    entry: unknown,
    change: (current: Record<string, unknown>, inherited: Record<string, unknown>) => Record<string, unknown>,
  ): Promise<void>
}

/**
 * Adapt the volatile Loader config to the settings-scope face the notifier and
 * its RPC already consume. Absent without a profile config editor, in which
 * case the card renders read-only and the notifier keeps in-memory defaults.
 */
function configScope(ctx: Context, config: NotifierConfigShape | undefined): SettingsScope<NotifierConfig> | null {
  const entry = (ctx as unknown as { fiber?: { entry?: unknown } }).fiber?.entry
  const editor = ctx.get('configEditor') as ConfigEditorFace | undefined
  if (config === undefined || entry === undefined || editor === undefined) return null

  const watchers = new Set<() => void>()
  // The loader applies the schema defaults, so a volatile ref is never empty
  // for a defaulted field; the casts only drop the generic mode union.
  const current = (): NotifierConfig => ({
    enabled: config.enabled.get() as boolean,
    suppressFocused: config.suppressFocused.get() as boolean,
    volume: config.volume.get() as number,
    finished: config.finished.get() as NotifierConfig['finished'],
    approval: config.approval.get() as NotifierConfig['approval'],
    question: config.question.get() as NotifierConfig['question'],
  })
  const write = async (patch: Record<string, unknown>): Promise<void> => {
    await editor.edit(entry, (raw) => ({ ...raw, ...patch }))
    for (const watcher of watchers) watcher()
  }

  return {
    get: () => current(),
    update: async (patch: object) => write(patch as Record<string, unknown>),
    replace: async (section: object) => write(section as Record<string, unknown>),
    watch: (callback: (next: unknown, prev: unknown) => void) => {
      const listener = (): void => callback(current(), undefined)
      watchers.add(listener)
      return () => { watchers.delete(listener) }
    },
  } as unknown as SettingsScope<NotifierConfig>
}

export function apply(ctx: Context, config?: NotifierConfigShape): void {
  const timer = ctx.get('timer') as TimerLike
  const goals = { get: (agent: Agent) => ctx.get('goals')?.get(agent) }

  const scope = configScope(ctx, config)

  const notifier = new Notifier({ ctx, scope, timer, goals })

  // Re-synthesize the sound set when the stored config's volume changes.
  if (scope && typeof scope.watch === 'function') {
    ctx.effect(() => scope.watch(() => notifier.onConfigChanged()))
  }

  registerRpc(ctx, notifier, scope)

  // Wire the event listeners synchronously: effects created after an await
  // (start's async sound detection used to wire) land on an inactive context
  // once loading has moved on, which aborted the whole profile load.
  notifier.wire()

  void notifier.start()

  ctx.effect(() => () => notifier.dispose())
}

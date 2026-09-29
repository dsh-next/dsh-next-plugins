import type { Context } from '@deepseek-ai/cordis'
import type { NotifierConfigShape } from '../core/schema.ts'
import type { NotifierConfig } from '../core/types.ts'

/** Read live volatile fields; retain the legacy RPC write seam for older clients. */
export interface ConfigScope {
  get(): NotifierConfig
  update(patch: Record<string, unknown>): Promise<void>
}
interface ConfigEditor {
  edit(entry: unknown, change: (current: Record<string, unknown>) => Record<string, unknown>): Promise<void>
}

export function configScope(ctx: Context, config: NotifierConfigShape | undefined): ConfigScope | null {
  if (!config) return null
  return {
    get: () => ({
      enabled: config.enabled.get() as boolean,
      suppressFocused: config.suppressFocused.get() as boolean,
      volume: config.volume.get() as number,
      finished: config.finished.get() as NotifierConfig['finished'],
      approval: config.approval.get() as NotifierConfig['approval'],
      question: config.question.get() as NotifierConfig['question'],
    }),
    async update(patch) {
      const entry = (ctx as unknown as { fiber?: { entry?: unknown } }).fiber?.entry
      const editor = ctx.get('configEditor') as ConfigEditor | undefined
      if (!entry || !editor) throw new Error('configuration is read-only')
      await editor.edit(entry, raw => {
        const next = { ...raw, ...patch }
        for (const group of ['finished', 'approval', 'question']) {
          if (patch[group]) next[group] = { ...(raw[group] as object), ...(patch[group] as object) }
        }
        return next
      })
    },
  }
}

import Schema from '@deepseek-ai/schemastery'
import { DecisionError, SERVICE_KEY, type DecisionProvider } from '../core/types.ts'
import { parseProviders } from '../core/validation.ts'

export const Config: Schemastery<any, { providers: { get(): unknown } }> = Schema.object({
  providers: Schema.array(Schema.object({
    id: Schema.string(), name: Schema.string(), baseUrl: Schema.string(),
    models: Schema.array(Schema.object({ id: Schema.string(), name: Schema.string(), contextWindow: Schema.number() })),
    modelIds: Schema.array(Schema.string()),
  })).default([]).volatile(),
})
export interface ProviderConfig { providers?: { get(): unknown } }
export interface ConfigStore { read(): DecisionProvider[]; write(providers: DecisionProvider[], expected: DecisionProvider[]): Promise<void>; writable: boolean }
export interface ConfigEditor {
  entries(): Array<{ id: string }>
  configuration(): Array<{ entry: { id: string }; inherited?: Record<string, unknown>; override?: Record<string, unknown> }>
  edit(entry: { id: string }, change: (value: Record<string, unknown>, inherited: Record<string, unknown>) => Record<string, unknown>): Promise<void>
}
export function configStore(config: ProviderConfig | undefined, editor: ConfigEditor | undefined): ConfigStore {
  const entry = editor?.entries().find(item => item.id === SERVICE_KEY || item.id === `include:${SERVICE_KEY}`)
  return {
    writable: Boolean(entry && editor),
    read: () => {
      if (editor && entry) {
        const current = editor.configuration().find(item => item.entry.id === entry.id)
        if (!current) throw new DecisionError('configuration')
        return parseProviders(({ ...current.inherited, ...current.override }).providers ?? [])
      }
      return parseProviders(config?.providers?.get() ?? [])
    },
    write: async (providers, expected) => {
      if (!editor || !entry) throw new DecisionError('read-only')
      await editor.edit(entry, (current, inherited) => {
        if (JSON.stringify(parseProviders(({ ...inherited, ...current }).providers ?? [])) !== JSON.stringify(expected)) throw new DecisionError('conflict')
        return { ...current, providers }
      })
    },
  }
}

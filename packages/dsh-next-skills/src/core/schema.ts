/**
 * The Schemastery config schema for the `dsh-next-skills` plugin. It is the
 * single source of truth for the plugin config's shape and defaults; the host
 * reads the resolved value through its volatile references. Both top-level
 * fields are volatile, so a `configEditor.edit` write commits into the running
 * fiber without a restart.
 *
 * The document is hand-editable; `core/settings.ts`
 * normalizes and validates the resolved value defensively at every read.
 */
import Schema from '@deepseek-ai/schemastery'

export const SKILLS_NAMESPACE = 'dsh-next-skills' as const

// Casts to the global schema-instance interface keep declaration emit
// nameable: array/dict members otherwise infer types that reference
// @deepseek-ai/cosmokit transitively (TS2742).
export const skillsConfigSchema = Schema.object({
  providers: (Schema.array(
    Schema.object({
      id: Schema.string(),
      spec: Schema.string(),
      addedAt: Schema.string().default(''),
    }),
  ) as Schemastery<Array<{ id: string; spec: string; addedAt: string }>>)
    .default([]).description('Configured skill providers (GitHub owner/repo sources)').volatile(),
  installations: (Schema.array(
    Schema.object({
      name: Schema.string(),
      providerId: Schema.string(),
      providerSpec: Schema.string(),
      skillPath: Schema.string(),
    }),
  ) as Schemastery<Array<{
    name: string
    providerId: string
    providerSpec: string
    skillPath: string
  }>>)
    .default([]).description('Skills the plugin installed into the global root (provenance ledger)').volatile(),
})

export type SkillsConfigShape = Schemastery.TypeT<typeof skillsConfigSchema>

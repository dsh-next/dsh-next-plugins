/**
 * The Schemastery settings schema for the `dsh-next-skills` namespace. It is
 * the single source of truth for the settings.yaml section's shape and
 * defaults; the host registers it with `settings.register()` and reads the
 * resolved value through the returned scope.
 *
 * The schema is deliberately permissive (plain string arrays and a free-form
 * scope map) because the document is hand-editable; `core/settings.ts`
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
    .default([]).description('Configured skill providers (GitHub owner/repo sources)'),
  installed: (Schema.array(
    Schema.object({
      name: Schema.string(),
      providerId: Schema.string(),
      providerSpec: Schema.string(),
      skillPath: Schema.string(),
      version: Schema.string(),
      installedAt: Schema.string(),
    }),
  ) as Schemastery<Array<{
    name: string
    providerId: string
    providerSpec: string
    skillPath: string
    version: string
    installedAt: string
  }>>)
    .default([]).description('Skills the plugin installed into the global root'),
  scopes: (Schema.dict(Schema.any()) as Schemastery<Record<string, unknown>>)
    .default({}).description('Per-skill-name enablement: { kind: global } or { kind: workspaces, workspacePaths: [...] }'),
})

export type SkillsConfigShape = Schemastery.TypeT<typeof skillsConfigSchema>

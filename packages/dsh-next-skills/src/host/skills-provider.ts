/**
 * The plugin's own `ctx.skills` provider: re-publishes every skill the DSH
 * filesystem provider discovers in the USER/GLOBAL roots with each
 * candidate's rank lowered by one, so the plugin wins every duplicate name
 * and can resolve the invocation policy per lookup from the settings-backed
 * scopes.
 *
 * Project/workspace-root skills are intentionally NOT re-published: they are
 * hand-managed in the project, served natively by the filesystem provider,
 * and outside this plugin's enablement config entirely.
 *
 * This is what makes enable/disable pure config:
 *  - scope disabled for the lookup's cwd -> both invocation flags false, so
 *    the skill disappears from every model and command surface;
 *  - otherwise the skill's own frontmatter flags apply (author intent).
 *
 * Precedence is preserved exactly: subtracting one from each rank keeps the
 * global roots' ordering (user-dsh > user-agents) intact.
 */
import type { SkillCandidate, SkillDefinition, SkillLookupOptions, SkillProvider } from '@deepseek-ai/dsh-skill'
import { parseSkillFile } from '../core/frontmatter.ts'
import { joinPath } from '../core/path.ts'
import { resolveSkillRoots, sortRootsByPrecedence } from '../core/scope.ts'
import { isScopeEnabled, normalizeSkillsConfig, scopeForName, type SkillsConfig } from '../core/settings.ts'
import type { FsLike } from '../core/types.ts'
import { discoverRoot, type ConfigScopeFace } from './skills-service.ts'

/** Provider name in the `ctx.skills` registry. */
export const MANAGED_PROVIDER_NAME = 'dsh-next-skills'

export interface ManagedProviderDeps {
  fs: FsLike
  dshHome: string
  agentsHome: string
  config: ConfigScopeFace
}

/** Build the provider (pure factory; registration happens in the entry). */
export function createManagedSkillProvider(deps: ManagedProviderDeps): SkillProvider {
  const config = (): SkillsConfig => normalizeSkillsConfig(deps.config.get())

  return {
    name: MANAGED_PROVIDER_NAME,

    async list(options: SkillLookupOptions): Promise<readonly SkillCandidate[]> {
      const cfg = config()
      // Global roots only: project/workspace skills are hand-managed in the
      // project and served natively by the DSH filesystem provider — this
      // provider shadows nothing it does not own, so per-name enablement
      // config applies exclusively to globally installed skills.
      const roots = sortRootsByPrecedence(resolveSkillRoots({
        dshHome: deps.dshHome,
        agentsHome: deps.agentsHome,
      }))
      const out: SkillCandidate[] = []
      for (const root of roots) {
        const discovered = await discoverRoot(deps.fs, root)
        for (const skill of discovered) {
          const enabled = isScopeEnabled(scopeForName(cfg.scopes, skill.name), options.cwd)
          out.push({
            name: skill.name,
            description: skill.description,
            ...(skill.whenToUse !== undefined ? { whenToUse: skill.whenToUse } : {}),
            invocation: {
              modelInvocable: enabled && skill.fileModelInvocable,
              userInvocable: enabled && skill.fileUserInvocable,
            },
            source: skill.source,
            provider: MANAGED_PROVIDER_NAME,
            rank: root.rank - 1,
            locator: { kind: skill.kind, path: skill.path, directory: skill.directory },
            path: skill.path,
          })
        }
      }
      return out
    },

    async get(candidate: SkillCandidate, options: SkillLookupOptions): Promise<SkillDefinition | undefined> {
      const locator = candidate.locator as { kind?: string; path?: string; directory?: string } | undefined
      const path = typeof locator?.path === 'string' ? locator.path : candidate.path
      if (path === undefined) return undefined
      let content: string
      try {
        content = await deps.fs.readFile(path)
      } catch {
        return undefined
      }
      const parsed = parseSkillFile(content)
      if (parsed === undefined) return undefined
      const cfg = config()
      const enabled = isScopeEnabled(scopeForName(cfg.scopes, candidate.name), options.cwd)
      const directory = typeof locator?.directory === 'string' ? locator.directory : joinPath(path, '..')
      return {
        name: parsed.name,
        description: parsed.description,
        ...(parsed.whenToUse !== undefined ? { whenToUse: parsed.whenToUse } : {}),
        invocation: {
          modelInvocable: enabled && parsed.modelInvocable,
          userInvocable: enabled && parsed.userInvocable,
        },
        source: candidate.source,
        provider: MANAGED_PROVIDER_NAME,
        resourceBase: { kind: 'directory', path: directory },
        content: parsed.body,
        path,
        ...(parsed.metadata !== undefined ? { metadata: parsed.metadata } : {}),
      }
    },
  }
}

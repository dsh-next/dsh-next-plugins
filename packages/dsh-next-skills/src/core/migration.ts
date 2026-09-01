/**
 * One-time migration from the pre-settings state model into the settings.yaml
 * section. The legacy model kept providers in `providers.json`, recorded
 * installs as on-disk manifests, and expressed enablement by editing skill
 * frontmatter or dropping workspace "shadow" skills.
 *
 * The new model keeps providers and installs in settings and expresses
 * enablement as per-name scopes (pure config, no file writes). This module
 * PLANS the migration as pure data; the host applies file moves.
 *
 * Migration rules:
 *  - Legacy providers become provider records.
 *  - Managed global skills become installed records (their manifest carries
 *    provider + version).
 *  - Managed workspace skills move to the global root (when the name is free
 *    there) and become installed records; an occupied name stays in place
 *    and is reported as a note.
 *  - A skill that was disabled anywhere (disabled frontmatter flags on the
 *    winning copy, or a shadow in any workspace) migrates to an explicit
 *    "enabled nowhere" whitelist ({ workspaces: [] }) — the conservative
 *    reading of "the user turned this off", and the closest representable
 *    state under the whitelist model. Shadow directories are deleted.
 *  - Entries already present in the existing config are never touched.
 */
import type { InstalledRecord, ProviderRecord, SkillsConfig, SkillScopeSetting } from './settings.ts'
import { emptySkillsConfig, withScope } from './settings.ts'

/** The manifest facts a managed skill carries on disk. */
export interface MigrationManifest {
  providerId: string
  providerSpec: string
  skillPath: string
  version: string
  installedAt: string
}

/** One discovered skill as the migration input (host discovery output). */
export interface MigrationSkill {
  name: string
  /** Absolute path to the SKILL.md (or the flat .md file). */
  path: string
  /** Absolute directory (bundle) or file path (flat). */
  directory: string
  kind: 'bundle' | 'flat'
  /** Frontmatter `disable-model-invocation` resolved (true = model-invocable). */
  fileModelInvocable: boolean
  /** Frontmatter `user-invocable` resolved (true = user-invocable). */
  fileUserInvocable: boolean
  /** True for plugin-generated workspace shadows. */
  shadow?: boolean
  /** Manifest facts when the skill was provider-installed. */
  manifest?: MigrationManifest
}

/** A workspace's discovered skills. */
export interface MigrationWorkspace {
  workspacePath: string
  skills: MigrationSkill[]
}

/** The global root a workspace skill should move into. */
export function globalInstallPath(agentsHome: string, name: string): string {
  const base = agentsHome.endsWith('/') ? agentsHome.slice(0, -1) : agentsHome
  return `${base}/skills/${name}`
}

export interface MigrationPlan {
  config: SkillsConfig
  /** Workspace skill directories to move into the global root. */
  moveToGlobal: Array<{ name: string; from: string; to: string }>
  /** Plugin-generated directories to delete (shadows). */
  deleteDirs: string[]
  /** SKILL.md files whose legacy toggle lines should be stripped. */
  stripFlags: string[]
  notes: string[]
}

/** Plan the migration (pure: no I/O, no moves executed). */
export function planMigration(input: {
  agentsHome: string
  legacyProviders: ProviderRecord[]
  globalSkills: MigrationSkill[]
  workspaces: MigrationWorkspace[]
  existing?: SkillsConfig
}): MigrationPlan {
  const { agentsHome, legacyProviders, globalSkills, workspaces } = input
  const existing = input.existing ?? emptySkillsConfig()
  const config: SkillsConfig = {
    providers: [...existing.providers],
    installed: [...existing.installed],
    scopes: { ...existing.scopes },
  }
  const notes: string[] = []
  const moveToGlobal: MigrationPlan['moveToGlobal'] = []
  const deleteDirs: string[] = []
  const stripFlags: string[] = []

  // Providers: adopt legacy entries the config does not know yet.
  const providerIds = new Set(config.providers.map((p) => p.id))
  for (const provider of legacyProviders) {
    if (!providerIds.has(provider.id)) {
      config.providers.push(provider)
      providerIds.add(provider.id)
    }
  }

  const installedNames = new Set(config.installed.map((r) => r.name))

  // Disabled-everywhere marks collected while walking the discoveries.
  const disabledEverywhere = new Set<string>()

  const recordInstalled = (skill: MigrationSkill): void => {
    if (skill.manifest === undefined || installedNames.has(skill.name)) return
    const record: InstalledRecord = {
      name: skill.name,
      providerId: skill.manifest.providerId,
      providerSpec: skill.manifest.providerSpec,
      skillPath: skill.manifest.skillPath,
      version: skill.manifest.version,
      installedAt: skill.manifest.installedAt,
    }
    config.installed.push(record)
    installedNames.add(skill.name)
  }

  // Global roots: install records + legacy-toggle marks.
  for (const skill of globalSkills) {
    if (skill.shadow === true) continue // shadows never live in global roots
    recordInstalled(skill)
    // Both invocation keys disabled is the old panel's toggle signature:
    // record "off everywhere" and strip the lines so a later re-enable
    // (clearing the scope entry) shows the skill again.
    if (!skill.fileModelInvocable && !skill.fileUserInvocable) {
      disabledEverywhere.add(skill.name)
      stripFlags.push(skill.path)
    }
  }

  // Workspace roots: managed skills move to global; shadows delete and mark.
  const movedNames = new Set<string>()
  for (const workspace of workspaces) {
    for (const skill of workspace.skills) {
      if (skill.shadow === true) {
        deleteDirs.push(skill.directory)
        disabledEverywhere.add(skill.name)
        continue
      }
      if (skill.manifest === undefined) continue // manually created: untouched
      if (movedNames.has(skill.name)) continue
      const globalOccupied = globalSkills.some((s) => s.name === skill.name)
      if (globalOccupied || installedNames.has(skill.name)) {
        notes.push(`workspace copy of "${skill.name}" left in ${workspace.workspacePath} (global root already has it)`)
        continue
      }
      moveToGlobal.push({ name: skill.name, from: skill.directory, to: globalInstallPath(agentsHome, skill.name) })
      movedNames.add(skill.name)
      recordInstalled(skill)
    }
  }

  // Enablement: any skill that was disabled anywhere becomes an explicit
  // "enabled nowhere" whitelist so migration never silently turns a skill on.
  for (const name of disabledEverywhere) {
    const scope: SkillScopeSetting = { kind: 'workspaces', workspacePaths: [] }
    config.scopes = withScope(config.scopes, name, scope)
  }

  // Names discovered but absent from the config get no scope entry: absent
  // means the default (enabled everywhere), which matches the old semantics
  // for skills that were enabled.

  return { config, moveToGlobal, deleteDirs, stripFlags, notes }
}

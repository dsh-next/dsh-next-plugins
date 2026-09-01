import { describe, expect, it } from 'vitest'
import { planMigration, type MigrationSkill } from '../src/core/migration.ts'
import { emptySkillsConfig } from '../src/core/settings.ts'

const AGENTS = '/home/u/.agents'

const skill = (name: string, overrides: Partial<MigrationSkill> = {}): MigrationSkill => ({
  name,
  path: `/x/${name}/SKILL.md`,
  directory: `/x/${name}`,
  kind: 'bundle',
  fileModelInvocable: true,
  fileUserInvocable: true,
  ...overrides,
})

const manifest = { providerId: 'o-r', providerSpec: 'o/r', skillPath: 'skills/x', version: 'v1', installedAt: 't' }

describe('planMigration', () => {
  it('adopts legacy providers and records managed global skills', () => {
    const plan = planMigration({
      agentsHome: AGENTS,
      legacyProviders: [{ id: 'o-r', spec: 'o/r', addedAt: 't0' }],
      globalSkills: [skill('a', { manifest })],
      workspaces: [],
    })
    expect(plan.config.providers).toEqual([{ id: 'o-r', spec: 'o/r', addedAt: 't0' }])
    expect(plan.config.installed).toEqual([{ name: 'a', ...manifest }])
    expect(plan.moveToGlobal).toEqual([])
    expect(plan.deleteDirs).toEqual([])
    expect(plan.stripFlags).toEqual([])
    expect(plan.config.scopes).toEqual({})
  })

  it('moves managed workspace skills into the global root and records them', () => {
    const wsManifest = { ...manifest, skillPath: 'skills/m' }
    const plan = planMigration({
      agentsHome: AGENTS,
      legacyProviders: [],
      globalSkills: [],
      workspaces: [
        { workspacePath: '/repo', skills: [skill('m', { directory: '/repo/.agents/skills/m', manifest: wsManifest })] },
      ],
    })
    expect(plan.moveToGlobal).toEqual([
      { name: 'm', from: '/repo/.agents/skills/m', to: `${AGENTS}/skills/m` },
    ])
    expect(plan.config.installed).toEqual([{ name: 'm', ...wsManifest }])
  })

  it('leaves a workspace copy in place when the global root already has the name', () => {
    const plan = planMigration({
      agentsHome: AGENTS,
      legacyProviders: [],
      globalSkills: [skill('m', { manifest })],
      workspaces: [
        { workspacePath: '/repo', skills: [skill('m', { directory: '/repo/.agents/skills/m', manifest })] },
      ],
    })
    expect(plan.moveToGlobal).toEqual([])
    expect(plan.config.installed).toEqual([{ name: 'm', ...manifest }])
    expect(plan.notes.some((n) => n.includes('left in'))).toBe(true)
  })

  it('deletes shadows, marks the skill off everywhere, and notes nothing else', () => {
    const plan = planMigration({
      agentsHome: AGENTS,
      legacyProviders: [],
      globalSkills: [skill('s', { manifest })],
      workspaces: [
        { workspacePath: '/repo', skills: [skill('s', { directory: '/repo/.agents/skills/s', shadow: true })] },
      ],
    })
    expect(plan.deleteDirs).toEqual(['/repo/.agents/skills/s'])
    expect(plan.config.scopes.s).toEqual([])
    // The shadow carried no manifest; the global copy provides the record.
    expect(plan.config.installed).toEqual([{ name: 's', ...manifest }])
  })

  it('treats the legacy frontmatter toggle (both flags off) as off-everywhere and strips the lines', () => {
    const plan = planMigration({
      agentsHome: AGENTS,
      legacyProviders: [],
      globalSkills: [skill('d', { fileModelInvocable: false, fileUserInvocable: false, manifest })],
      workspaces: [],
    })
    expect(plan.config.scopes.d).toEqual([])
    expect(plan.stripFlags).toEqual([`/x/d/SKILL.md`])
  })

  it('a single author flag off is honored as author intent, not a disable', () => {
    const plan = planMigration({
      agentsHome: AGENTS,
      legacyProviders: [],
      globalSkills: [skill('u', { fileUserInvocable: false })],
      workspaces: [],
    })
    expect(plan.config.scopes).toEqual({})
    expect(plan.stripFlags).toEqual([])
  })

  it('never touches entries already present in the existing config', () => {
    const existing = emptySkillsConfig()
    existing.providers.push({ id: 'o-r', spec: 'o/r', addedAt: 'kept' })
    existing.installed.push({ name: 'a', providerId: 'x', providerSpec: 'x/y', skillPath: 's', version: 'v', installedAt: 'kept' })
    const plan = planMigration({
      agentsHome: AGENTS,
      legacyProviders: [{ id: 'o-r', spec: 'o/r', addedAt: 'legacy' }],
      globalSkills: [skill('a', { manifest })],
      workspaces: [],
      existing,
    })
    expect(plan.config.providers).toEqual([{ id: 'o-r', spec: 'o/r', addedAt: 'kept' }])
    expect(plan.config.installed).toEqual(existing.installed)
  })

  it('unmanaged skills get no record and no scope (absent = enabled default)', () => {
    const plan = planMigration({
      agentsHome: AGENTS,
      legacyProviders: [],
      globalSkills: [skill('hand-made')],
      workspaces: [{ workspacePath: '/repo', skills: [skill('proj', { directory: '/repo/.agents/skills/proj' })] }],
    })
    expect(plan.config.installed).toEqual([])
    expect(plan.config.scopes).toEqual({})
    expect(plan.moveToGlobal).toEqual([])
    expect(plan.notes).toEqual([])
  })

  it('records each name once when the same skill exists in two workspaces', () => {
    const plan = planMigration({
      agentsHome: AGENTS,
      legacyProviders: [],
      globalSkills: [],
      workspaces: [
        { workspacePath: '/repo-a', skills: [skill('m', { directory: '/repo-a/.agents/skills/m', manifest })] },
        { workspacePath: '/repo-b', skills: [skill('m', { directory: '/repo-b/.agents/skills/m', manifest })] },
      ],
    })
    expect(plan.moveToGlobal).toHaveLength(1)
    expect(plan.config.installed).toHaveLength(1)
  })
})

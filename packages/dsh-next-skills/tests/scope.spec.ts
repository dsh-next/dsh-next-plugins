import { describe, expect, it } from 'vitest'
import {
  PROJECT_DSH_RANK,
  globalSkillsRoot,
  resolveSkillRoots,
  sortRootsByPrecedence,
  workspaceSkillsRoot,
} from '../src/core/scope.ts'

describe('resolveSkillRoots', () => {
  it('returns only user roots without a project root', () => {
    const roots = resolveSkillRoots({ dshHome: '/home/u/.dsh', agentsHome: '/home/u/.agents' })
    expect(roots.map((r) => r.source)).toEqual(['user-dsh', 'user-agents'])
    expect(roots.every((r) => r.scope === 'global')).toBe(true)
  })
  it('includes project roots (workspace) before user roots when a project root is given', () => {
    const roots = resolveSkillRoots({ projectRoot: '/repo', dshHome: '/home/u/.dsh', agentsHome: '/home/u/.agents' })
    expect(roots.map((r) => r.source)).toEqual(['project-dsh', 'project-agents', 'user-dsh', 'user-agents'])
    expect(roots[0].path).toBe('/repo/.dsh/skills')
    expect(roots[1].path).toBe('/repo/.agents/skills')
    expect(roots[0].scope).toBe('workspace')
    expect(roots[1].scope).toBe('workspace')
  })
  it('inserts custom roots between project and user roots', () => {
    const roots = resolveSkillRoots({ projectRoot: '/repo', dshHome: '/d', agentsHome: '/a', customSkillDirs: ['/custom'] })
    expect(roots.map((r) => r.source)).toEqual(['project-dsh', 'project-agents', 'custom', 'user-dsh', 'user-agents'])
    expect(roots.find((r) => r.source === 'custom')!.rank).toBe(300)
  })
  it('ranks project above user so workspace shadows global', () => {
    const roots = sortRootsByPrecedence(resolveSkillRoots({ projectRoot: '/repo', dshHome: '/d', agentsHome: '/a' }))
    expect(roots[0].rank).toBe(PROJECT_DSH_RANK)
    expect(roots[roots.length - 1].rank).toBe(500)
  })
})

describe('root helpers', () => {
  it('globalSkillsRoot points at the shared agents skills dir', () => {
    expect(globalSkillsRoot('/home/u/.agents')).toBe('/home/u/.agents/skills')
  })
  it('workspaceSkillsRoot points at the project .agents skills dir', () => {
    expect(workspaceSkillsRoot('/repo')).toBe('/repo/.agents/skills')
  })
})

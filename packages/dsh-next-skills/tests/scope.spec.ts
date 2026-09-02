import { describe, expect, it } from 'vitest'
import {
  PROJECT_AGENTS_RANK,
  PROJECT_DSH_RANK,
  USER_AGENTS_RANK,
  USER_DSH_RANK,
  globalSkillsRoot,
  resolveSkillRoots,
  sortRootsByPrecedence,
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
  it('ranks project above user so workspace shadows global', () => {
    const roots = sortRootsByPrecedence(resolveSkillRoots({ projectRoot: '/repo', dshHome: '/d', agentsHome: '/a' }))
    expect(roots.map((r) => r.source)).toEqual(['project-dsh', 'project-agents', 'user-dsh', 'user-agents'])
    expect(roots.map((r) => r.rank)).toEqual([PROJECT_DSH_RANK, PROJECT_AGENTS_RANK, USER_DSH_RANK, USER_AGENTS_RANK])
  })
})

describe('root helpers', () => {
  it('globalSkillsRoot points at the shared agents skills dir', () => {
    expect(globalSkillsRoot('/home/u/.agents')).toBe('/home/u/.agents/skills')
  })
})

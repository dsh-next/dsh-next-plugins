import { describe, expect, it } from 'vitest'
import { USER_AGENTS_RANK, USER_DSH_RANK, globalSkillsRoot, resolveSkillRoots, sortRootsByPrecedence } from '../src/core/scope.ts'

describe('global root helpers', () => {
  it('returns only global roots, without physical scope metadata', () => {
    expect(resolveSkillRoots({ dshHome: '/d', agentsHome: '/a' })).toEqual([
      { path: '/d/skills', source: 'user-dsh', rank: USER_DSH_RANK },
      { path: '/a/skills', source: 'user-agents', rank: USER_AGENTS_RANK },
    ])
  })
  it('ignores stale project root arguments instead of discovering workspace files', () => {
    const args = { projectRoot: '/repo', dshHome: '/d', agentsHome: '/a' }
    expect(resolveSkillRoots(args).map((r) => r.path)).toEqual(['/d/skills', '/a/skills'])
  })
  it('sorts by native precedence without mutating inputs', () => {
    const roots = resolveSkillRoots({ dshHome: '/d', agentsHome: '/a' }).reverse()
    expect(sortRootsByPrecedence(roots).map((r) => r.rank)).toEqual([400, 500])
    expect(roots.map((r) => r.rank)).toEqual([500, 400])
    expect(sortRootsByPrecedence([])).toEqual([])
  })
  it('uses the shared agents convention for global installs', () => {
    expect(globalSkillsRoot('/home/u/.agents/')).toBe('/home/u/.agents/skills')
  })
})

import { describe, expect, it } from 'vitest'
import type { InstalledSkill } from '../src/core/types.ts'
import { mergeInstalled, sortInstalled } from '../src/core/skill-list.ts'

function skill(name: string, scope: 'global' | 'workspace' = 'global'): InstalledSkill {
  return {
    name, description: name, scope, source: scope === 'workspace' ? 'project-agents' : 'user-agents',
    kind: 'bundle', path: `/x/${name}/SKILL.md`, directory: `/x/${name}`, fileModelInvocable: true, fileUserInvocable: true, managed: false,
  }
}

describe('sortInstalled', () => {
  it('sorts by name', () => {
    expect(sortInstalled([skill('b'), skill('a')]).map((s) => s.name)).toEqual(['a', 'b'])
  })
})

describe('mergeInstalled', () => {
  it('first list wins a duplicate name', () => {
    const workspace = [skill('shared', 'workspace')]
    const global = [skill('shared', 'global')]
    const merged = mergeInstalled(workspace, global)
    expect(merged).toHaveLength(1)
    expect(merged[0].scope).toBe('workspace')
  })
  it('merges distinct names', () => {
    const merged = mergeInstalled([skill('a')], [skill('b')])
    expect(merged.map((s) => s.name)).toEqual(['a', 'b'])
  })
  it('handles empty lists', () => {
    expect(mergeInstalled([], [])).toEqual([])
  })
})

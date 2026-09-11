import { describe, expect, it } from 'vitest'
import type { InstalledSkill } from '../src/core/types.ts'
import { mergeInstalled, sortInstalled } from '../src/core/skill-list.ts'

function skill(name: string, source: InstalledSkill['source'] = 'user-agents'): InstalledSkill {
  return {
    name, description: name, source,
    kind: 'bundle', path: `/x/${name}/SKILL.md`, directory: `/x/${name}`,
  }
}

describe('sortInstalled', () => {
  it('sorts by name', () => {
    expect(sortInstalled([skill('b'), skill('a')]).map((s) => s.name)).toEqual(['a', 'b'])
  })
})

describe('mergeInstalled', () => {
  it('first list wins a duplicate name', () => {
    const dsh = [skill('shared', 'user-dsh')]
    const agents = [skill('shared', 'user-agents')]
    const merged = mergeInstalled(dsh, agents)
    expect(merged).toHaveLength(1)
    expect(merged[0].source).toBe('user-dsh')
  })
  it('merges distinct names', () => {
    const merged = mergeInstalled([skill('a')], [skill('b')])
    expect(merged.map((s) => s.name)).toEqual(['a', 'b'])
  })
  it('handles empty lists', () => {
    expect(mergeInstalled([], [])).toEqual([])
  })
})

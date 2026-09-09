import { describe, expect, it } from 'vitest'
import { DEFAULT_PROVIDER_SPECS } from '../src/core/defaults.ts'

describe('default provider specs', () => {
  it('seeds only the supported default providers', () => {
    expect(DEFAULT_PROVIDER_SPECS).toEqual([
      'anthropics/skills',
      'mattpocock/skills',
      'muratcankoylan/Agent-Skills-for-Context-Engineering',
      'nextlevelbuilder/ui-ux-pro-max-skill',
      'addyosmani/agent-skills',
      'Leonxlnx/taste-skill',
    ])
  })
})

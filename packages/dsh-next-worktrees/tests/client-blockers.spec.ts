import { describe, expect, it } from 'vitest'
import { BLOCKER_KEYS } from '../src/client/modal-host.tsx'
import { en } from '../src/client/dictionaries/en.ts'
import type { MergeBlocker } from '../src/core/merge.ts'

const ALL_BLOCKERS: readonly MergeBlocker[] = [
  'unknown-slug',
  'old-git',
  'dirty-primary',
  'dirty-worktree',
  'conflict',
  'already-merged',
  'no-target-branch',
]

describe('merge blocker copy', () => {
  it('maps every host blocker to an English dictionary key', () => {
    for (const code of ALL_BLOCKERS) {
      const key = BLOCKER_KEYS[code]
      expect(key, code).toBeTypeOf('string')
      expect(en[key as keyof typeof en], key).toBeTypeOf('string')
    }
    expect(Object.keys(BLOCKER_KEYS).sort()).toEqual([...ALL_BLOCKERS].sort())
  })
})

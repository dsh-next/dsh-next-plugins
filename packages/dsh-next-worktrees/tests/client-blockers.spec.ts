import { describe, expect, it } from 'vitest'
import { BLOCKER_KEYS, UPDATE_BLOCKER_KEYS } from '../src/client/modal-host.tsx'
import { en } from '../src/client/dictionaries/en.ts'
import type { MergeBlocker } from '../src/core/merge.ts'
import type { UpdateBlocker } from '../src/core/update.ts'

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

  it('points conflict at Resolve in this session, not a CLI dump', () => {
    expect(en['merge.blocker.conflict']).toContain('Resolve in this session')
    expect(en['merge.blocker.conflict']).not.toMatch(/git merge|\{command\}|\{branch\}/)
    expect(en['merge.blocker.oldGit']).toContain('{command}')
  })

  it('keeps ellipsis on menu items and dialog-opening CTAs, not on confirms', () => {
    expect(en['row.merge']).toBe('Merge…')
    expect(en['row.update']).toBe('Update from {branch}…')
    expect(en['merge.resolve']).toBe('Resolve in this session…')
    expect(en['merge.confirm']).toBe('Merge')
    expect(en['update.confirm']).toBe('Update from {branch}')
    expect(en['update.resolve']).toBe('Resolve in this session')
  })
})

const ALL_UPDATE_BLOCKERS: readonly UpdateBlocker[] = [
  'unknown-slug',
  'no-target-branch',
  'no-bound-session',
  'running-session',
  'in-progress',
  'dirty-worktree',
  'already-updated',
]

describe('update blocker copy', () => {
  it('maps every host blocker to an English dictionary key', () => {
    for (const code of ALL_UPDATE_BLOCKERS) {
      const key = UPDATE_BLOCKER_KEYS[code]
      expect(key, code).toBeTypeOf('string')
      expect(en[key as keyof typeof en], key).toBeTypeOf('string')
    }
    expect(Object.keys(UPDATE_BLOCKER_KEYS).sort()).toEqual([...ALL_UPDATE_BLOCKERS].sort())
  })
})

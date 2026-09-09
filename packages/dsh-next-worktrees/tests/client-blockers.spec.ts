import { describe, expect, it } from 'vitest'
import { BLOCKER_KEYS, UPDATE_BLOCKER_KEYS, WARNING_KEYS } from '../src/client/modal-host.tsx'
import { en } from '../src/client/dictionaries/en.ts'
import type { MergeBlocker, MergeWarning } from '../src/core/merge.ts'
import type { UpdateBlocker } from '../src/core/update.ts'

const ALL_BLOCKERS: readonly MergeBlocker[] = [
  'unknown-slug',
  'old-git',
  'conflict',
  'already-merged',
  'no-target-branch',
  'no-source-branch',
  'running-session',
]

const ALL_WARNINGS: readonly MergeWarning[] = [
  'dirty-primary',
  'dirty-worktree',
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

  it('maps every merge warning to an English dictionary key', () => {
    for (const code of ALL_WARNINGS) {
      const key = WARNING_KEYS[code]
      expect(key, code).toBeTypeOf('string')
      expect(en[key as keyof typeof en], key).toBeTypeOf('string')
    }
    expect(Object.keys(WARNING_KEYS).sort()).toEqual([...ALL_WARNINGS].sort())
  })

  it('points conflict at Resolve in this session, not a CLI dump', () => {
    expect(en['merge.blocker.conflict']).toContain('Resolve in this session')
    expect(en['merge.blocker.conflict']).not.toMatch(/git merge|\{command\}|\{branch\}/)
    expect(en['merge.blocker.oldGit']).toContain('{command}')
    expect(en['merge.blocker.dirtyPrimary']).toContain('{branch}')
    expect(en['merge.blocker.dirtyWorktree']).toContain('{branch}')
    expect(en['update.blocker.dirtyWorktree']).toContain('{branch}')
  })

  it('keeps dialog copy unchanged while menu actions omit ellipses', () => {
    expect(en['row.merge']).toBe('Merge to {branch}')
    expect(en['row.update']).toBe('Update from {branch}')
    expect(en['row.delete']).toBe('Delete worktree')
    expect(en['merge.resolve']).toBe('Resolve in this session…')
    expect(en['merge.confirm']).toBe('Merge')
    expect(en['update.confirm']).toBe('Update from {branch}')
    expect(en['update.resolve']).toBe('Resolve in this session')
    expect(en['update.inProgressTitle']).toBe('Merge in progress')
  })
})

const ALL_UPDATE_BLOCKERS: readonly UpdateBlocker[] = [
  'unknown-slug',
  'no-target-branch',
  'no-source-branch',
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

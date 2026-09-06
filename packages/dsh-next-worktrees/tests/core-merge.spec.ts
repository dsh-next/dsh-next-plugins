import { describe, expect, it } from 'vitest'
import {
  gitSupportsMergeTree,
  mergeVerdict,
  mergeWouldFastForward,
  parseGitVersion,
  type MergeFactsInput,
} from '../src/core/merge.ts'

function facts(overrides: Partial<MergeFactsInput> = {}): MergeFactsInput {
  return {
    slugKnown: true,
    gitModern: true,
    primaryClean: true,
    worktreeClean: true,
    targetBranch: 'main',
    dryRunClean: true,
    dryRunRan: true,
    alreadyMerged: false,
    ...overrides,
  }
}

describe('mergeVerdict', () => {
  it('is green when every gate passes', () => {
    expect(mergeVerdict(facts())).toEqual({ blockers: [], warnings: [], green: true })
  })

  it('blocks an unknown slug', () => {
    const verdict = mergeVerdict(facts({ slugKnown: false }))
    expect(verdict.blockers).toContain('unknown-slug')
    expect(verdict.green).toBe(false)
  })

  it('blocks old git', () => {
    expect(mergeVerdict(facts({ gitModern: false })).blockers).toContain('old-git')
  })

  it('warns on a dirty primary without blocking Merge', () => {
    const verdict = mergeVerdict(facts({ primaryClean: false }))
    expect(verdict.warnings).toContain('dirty-primary')
    expect(verdict.blockers).not.toContain('dirty-primary')
    expect(verdict.green).toBe(true)
  })

  it('warns on a dirty worktree without blocking Merge', () => {
    const verdict = mergeVerdict(facts({ worktreeClean: false }))
    expect(verdict.warnings).toContain('dirty-worktree')
    expect(verdict.blockers).not.toContain('dirty-worktree')
    expect(verdict.green).toBe(true)
  })

  it('blocks conflicts only when the dry run actually ran', () => {
    expect(mergeVerdict(facts({ dryRunClean: false })).blockers).toContain('conflict')
    // Old git never ran the dry run: conflict must not pile on top of old-git.
    const verdict = mergeVerdict(facts({ gitModern: false, dryRunRan: false }))
    expect(verdict.blockers).toContain('old-git')
    expect(verdict.blockers).not.toContain('conflict')
  })

  it('reports already-merged without a conflict blocker', () => {
    const verdict = mergeVerdict(facts({
      alreadyMerged: true,
      dryRunRan: false,
      dryRunClean: false,
    }))
    expect(verdict.blockers).toContain('already-merged')
    expect(verdict.blockers).not.toContain('conflict')
  })

  it('blocks a missing target branch', () => {
    const verdict = mergeVerdict(facts({ targetBranch: undefined }))
    expect(verdict.blockers).toContain('no-target-branch')
  })

  it('orders identity blockers before state blockers', () => {
    const verdict = mergeVerdict(facts({
      slugKnown: false,
      primaryClean: false,
    }))
    expect(verdict.blockers[0]).toBe('unknown-slug')
    expect(verdict.warnings).toContain('dirty-primary')
    expect(verdict.green).toBe(false)
  })
})

describe('parseGitVersion', () => {
  it('parses a standard version line', () => {
    expect(parseGitVersion('git version 2.39.5 (Apple Git-101)\n')).toEqual([2, 39])
  })

  it('returns undefined for garbage', () => {
    expect(parseGitVersion('not git')).toBeUndefined()
  })
})

describe('gitSupportsMergeTree', () => {
  it('accepts 2.38 and newer', () => {
    expect(gitSupportsMergeTree([2, 38])).toBe(true)
    expect(gitSupportsMergeTree([2, 45])).toBe(true)
    expect(gitSupportsMergeTree([3, 0])).toBe(true)
  })

  it('refuses older and unknown versions', () => {
    expect(gitSupportsMergeTree([2, 37])).toBe(false)
    expect(gitSupportsMergeTree(undefined)).toBe(false)
  })
})

describe('mergeWouldFastForward', () => {
  it('mirrors the ancestor answer', () => {
    expect(mergeWouldFastForward(true)).toBe(true)
    expect(mergeWouldFastForward(false)).toBe(false)
  })
})

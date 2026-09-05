import { describe, expect, it } from 'vitest'
import { updateVerdict, type UpdateFactsInput } from '../src/core/update.ts'

function facts(overrides: Partial<UpdateFactsInput> = {}): UpdateFactsInput {
  return {
    slugKnown: true,
    sourceBranch: 'main',
    boundSession: true,
    sessionRunning: false,
    inProgress: false,
    worktreeClean: true,
    alreadyUpdated: false,
    ...overrides,
  }
}

describe('updateVerdict', () => {
  it('is green when every gate passes', () => {
    expect(updateVerdict(facts())).toEqual({ blockers: [], green: true })
  })

  it('blocks an unknown slug', () => {
    const verdict = updateVerdict(facts({ slugKnown: false }))
    expect(verdict.blockers).toContain('unknown-slug')
    expect(verdict.green).toBe(false)
  })

  it('blocks a missing source branch', () => {
    expect(updateVerdict(facts({ sourceBranch: undefined })).blockers)
      .toContain('no-target-branch')
  })

  it('blocks a missing bound session', () => {
    expect(updateVerdict(facts({ boundSession: false })).blockers)
      .toContain('no-bound-session')
  })

  it('blocks a running session', () => {
    expect(updateVerdict(facts({ sessionRunning: true })).blockers)
      .toContain('running-session')
  })

  it('blocks an in-progress merge and suppresses dirty-worktree', () => {
    const verdict = updateVerdict(facts({ inProgress: true, worktreeClean: false }))
    expect(verdict.blockers).toContain('in-progress')
    expect(verdict.blockers).not.toContain('dirty-worktree')
    expect(verdict.green).toBe(false)
  })

  it('blocks a dirty worktree when no merge is in flight', () => {
    expect(updateVerdict(facts({ worktreeClean: false })).blockers)
      .toContain('dirty-worktree')
  })

  it('blocks already-updated', () => {
    expect(updateVerdict(facts({ alreadyUpdated: true })).blockers)
      .toContain('already-updated')
  })

  it('suppresses session and tree blockers when the slug is unknown', () => {
    const verdict = updateVerdict(facts({
      slugKnown: false,
      boundSession: false,
      worktreeClean: false,
    }))
    expect(verdict.blockers).toEqual(['unknown-slug'])
  })
})

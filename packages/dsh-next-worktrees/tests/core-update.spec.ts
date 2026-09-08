import { describe, expect, it } from 'vitest'
import { updateVerdict, type UpdateFactsInput } from '../src/core/update.ts'

function facts(overrides: Partial<UpdateFactsInput> = {}): UpdateFactsInput {
  return {
    slugKnown: true,
    sourceBranch: 'main',
    targetBranch: 'dsh-worktrees/swift-01',
    boundSession: true,
    sessionRunning: false,
    inProgress: false,
    worktreeClean: true,
    alreadyUpdated: false,
    ...overrides,
  }
}

describe('updateVerdict', () => {
  it('preserves blocker order and suppression across every fact combination', () => {
    const branches = [undefined, '', 'main']
    for (let mask = 0; mask < 64; mask += 1) {
      for (const sourceBranch of branches) {
        for (const targetBranch of branches) {
          const input = facts({
            slugKnown: Boolean(mask & 1),
            boundSession: Boolean(mask & 2),
            sessionRunning: Boolean(mask & 4),
            inProgress: Boolean(mask & 8),
            worktreeClean: Boolean(mask & 16),
            alreadyUpdated: Boolean(mask & 32),
            sourceBranch,
            targetBranch,
          })
          const candidates: [string, boolean][] = [
            ['unknown-slug', !input.slugKnown],
            ['no-target-branch', !sourceBranch],
            ['no-source-branch', input.slugKnown && !targetBranch],
            ['no-bound-session', input.slugKnown && !input.boundSession],
            ['running-session', input.slugKnown && input.sessionRunning],
            ['in-progress', input.slugKnown && input.inProgress],
            ['dirty-worktree', input.slugKnown && !input.inProgress && !input.worktreeClean],
            ['already-updated', input.slugKnown && input.alreadyUpdated],
          ]
          const blockers = candidates.filter(([, applies]) => applies).map(([code]) => code)
          expect(updateVerdict(input), JSON.stringify(input)).toEqual({
            blockers, green: blockers.length === 0,
          })
        }
      }
    }
  })

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

  it('blocks a detached worktree without a target branch', () => {
    expect(updateVerdict(facts({ targetBranch: undefined })).blockers)
      .toContain('no-source-branch')
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

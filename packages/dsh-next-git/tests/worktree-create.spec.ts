import { describe, expect, it } from 'vitest'
import { setupHasEffects, type WorktreeSetupPreview } from '../src/core/worktree-create.ts'

/**
 * The create-approval seam: the panel only shows its confirmation step (and
 * the host only ever runs anything) when the preview says there is something
 * to approve. These cases pin that boundary in both directions.
 */

function preview(overrides: Partial<WorktreeSetupPreview> = {}): WorktreeSetupPreview {
  return {
    root: '/repo',
    slug: 'feature',
    path: '/repo/.worktrees/feature',
    branch: 'dsh-git/feature',
    base: 'main',
    baseOid: 'a'.repeat(40),
    version: 'v1',
    steps: [],
    includePaths: [],
    notice: null,
    ...overrides,
  }
}

describe('worktree create preview', () => {
  it('reports no effects for an empty declaration', () => {
    expect(setupHasEffects(preview())).toBe(false)
  })

  it('reports effects for either commands or copied paths', () => {
    expect(setupHasEffects(preview({ steps: [{ kind: 'command', command: 'pnpm install' }] }))).toBe(true)
    expect(setupHasEffects(preview({ steps: [{ kind: 'script', path: 'scripts/setup.sh' }] }))).toBe(true)
    expect(setupHasEffects(preview({ includePaths: ['.env'] }))).toBe(true)
  })

  it('reports an invalid declaration with no parseable step as no effect', () => {
    expect(setupHasEffects(preview({ notice: 'setup-invalid' }))).toBe(false)
  })
})

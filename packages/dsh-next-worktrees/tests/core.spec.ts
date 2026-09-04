import { describe, expect, it } from 'vitest'
import {
  branchName,
  deriveTitle,
  generateSlug,
  sanitizeSlugSegment,
} from '../src/core/slug.ts'
import {
  computePlacement,
  ignoresWorktreeDir,
  registryPath,
  sessionCwdFor,
  worktreePath,
} from '../src/core/placement.ts'
import { evaluatePreflight } from '../src/core/preflight.ts'
import {
  parseRegistry,
  parseWorktreeList,
  reconcile,
  serializeRegistry,
  type WorktreeBinding,
} from '../src/core/registry.ts'
import { deriveChipStatus, parseAheadCount } from '../src/core/status.ts'

describe('slug', () => {
  it('generates word-digits slugs from the injected random source', () => {
    const fixed = (values: number[]) => {
      let index = 0
      return (max: number) => values[index++ % values.length] % max
    }
    expect(generateSlug(fixed([0, 0]))).toBe('amber-00')
    expect(generateSlug(fixed([3, 99]))).toBe('delta-99')
  })

  it('sanitizes to safe branch segments', () => {
    expect(sanitizeSlugSegment('Amber_42!!')).toBe('amber-42')
    expect(sanitizeSlugSegment('--..--')).toBe('')
  })

  it('builds branch names with the default prefix', () => {
    expect(branchName('amber-42')).toBe('dsh-worktrees/amber-42')
    expect(branchName('x', 'wt')).toBe('wt/x')
  })

  it('derives titles from the first prompt words', () => {
    expect(deriveTitle('fix the login bug please')).toBe('fix the login bug')
    expect(deriveTitle('  a\n\nb  ')).toBe('a b')
    expect(deriveTitle('word '.repeat(20))).toBe('word word word word')
    expect(deriveTitle('one-two-three-four-five six')).toBe('one-two-three-four-five six')
    expect(deriveTitle('')).toBe('')
    expect(deriveTitle('abcdefghijklmnopqrstuvwxyz1234')).toBe('abcdefghijklmnopqrstuvwxyz12')
  })
})

describe('placement', () => {
  it('computes the primary from the common dir', () => {
    const p = computePlacement('/repo', '/repo/.git')
    expect(p).toEqual({ primaryRoot: '/repo', isLinkedWorktree: false })
  })

  it('flags linked worktrees (same common dir, different toplevel)', () => {
    const p = computePlacement('/repo/.dsh/worktrees/amber-42', '/repo/.git')
    expect(p).toEqual({ primaryRoot: '/repo', isLinkedWorktree: true })
  })

  it('rejects bare or unknown layouts', () => {
    expect(computePlacement('/repo', '/repo')).toBeNull()
    expect(computePlacement('/repo', '/repo/.gitx')).toBeNull()
    expect(computePlacement('/repo', '/.git')).toBeNull()
  })

  it('places worktrees and the registry under the primary', () => {
    expect(worktreePath('/repo', 'amber-42')).toBe('/repo/.dsh/worktrees/amber-42')
    expect(registryPath('/repo')).toBe('/repo/.dsh/worktrees/registry.json')
  })

  it('preserves the session sub-path below the toplevel', () => {
    expect(sessionCwdFor('/w', '/repo', '/repo')).toBe('/w')
    expect(sessionCwdFor('/w', '/repo', '/repo/packages/foo')).toBe('/w/packages/foo')
    expect(sessionCwdFor('/w', '/repo', '/elsewhere')).toBeNull()
  })

  it('matches gitignore coverage of the worktree dir', () => {
    expect(ignoresWorktreeDir(['.dsh/', 'node_modules'])).toBe(true)
    expect(ignoresWorktreeDir(['/.dsh', '# comment', ''])).toBe(true)
    expect(ignoresWorktreeDir(['.dshx'])).toBe(false)
    expect(ignoresWorktreeDir([])).toBe(false)
  })
})

describe('preflight', () => {
  const base = {
    gitAvailable: true,
    toplevel: '/repo',
    placementOk: true,
    baseRef: 'origin/HEAD',
    dirIgnored: true,
  }

  it('passes with no reasons and no hint when ignored', () => {
    expect(evaluatePreflight(base)).toEqual({
      ok: true, degraded: false, reasons: [], showIgnoreHint: false,
    })
  })

  it('shows the ignore hint when the dir is not covered', () => {
    expect(evaluatePreflight({ ...base, dirIgnored: false }).showIgnoreHint).toBe(true)
  })

  it('degrades for every fatal branch', () => {
    expect(evaluatePreflight({ ...base, gitAvailable: false }).reasons).toEqual(['git-unavailable'])
    expect(evaluatePreflight({ ...base, toplevel: null }).reasons).toEqual(['not-a-repository'])
    expect(evaluatePreflight({ ...base, placementOk: false }).reasons).toEqual(['bare-or-unknown-layout'])
    expect(evaluatePreflight({ ...base, baseRef: null }).reasons).toEqual(['no-base-ref'])
    expect(evaluatePreflight({ ...base, baseRef: null }).degraded).toBe(true)
  })
})

describe('registry', () => {
  const binding: WorktreeBinding = {
    slug: 'amber-42', path: '/repo/.dsh/worktrees/amber-42',
    branch: 'dsh-worktrees/amber-42', baseRef: 'origin/HEAD',
    title: 'fix login', sessionId: null, role: 'owner', createdAt: '2026-09-04T00:00:00.000Z',
  }

  it('round-trips through serialize and parse', () => {
    const body = serializeRegistry({ version: 1, bindings: [binding] })
    expect(parseRegistry(body)).toEqual({ version: 1, bindings: [binding] })
  })

  it('rejects corrupt bodies and drops invalid entries', () => {
    expect(parseRegistry('not json')).toBeNull()
    expect(parseRegistry('{"version":2,"bindings":[]}')).toBeNull()
    const body = serializeRegistry({
      version: 1,
      bindings: [{ ...binding, role: 'inspector' as never }, { ...binding, slug: '' }],
    })
    expect(parseRegistry(body)?.bindings).toEqual([])
  })

  it('parses worktree list porcelain paths', () => {
    const porcelain = [
      'worktree /repo',
      'HEAD abc',
      '',
      'worktree /repo/.dsh/worktrees/amber-42',
      'branch refs/heads/dsh-worktrees/amber-42',
    ].join('\n')
    expect(parseWorktreeList(porcelain)).toEqual(['/repo', '/repo/.dsh/worktrees/amber-42'])
  })

  it('reconciles bindings against live git worktrees', () => {
    const stale = { ...binding, slug: 'gone-01', path: '/repo/.dsh/worktrees/gone-01' }
    const { kept, dropped } = reconcile(
      [binding, stale],
      ['/repo', binding.path],
    )
    expect(kept).toEqual([binding])
    expect(dropped).toEqual([stale])
  })
})

describe('status', () => {
  it('parses ahead counts and flags garbage', () => {
    expect(parseAheadCount('3\n')).toBe(3)
    expect(parseAheadCount('0')).toBe(0)
    expect(parseAheadCount('')).toBeNull()
    expect(parseAheadCount('x3')).toBeNull()
    expect(parseAheadCount('-1')).toBeNull()
  })

  it('derives the chip dot state', () => {
    expect(deriveChipStatus({ dirty: false, aheadOk: true })).toBe('clean')
    expect(deriveChipStatus({ dirty: true, aheadOk: true })).toBe('dirty')
    expect(deriveChipStatus({ dirty: false, aheadOk: false })).toBe('error')
  })
})

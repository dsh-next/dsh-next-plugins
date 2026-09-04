import { describe, expect, it } from 'vitest'
import { GitError, type GitPorts } from '../src/host/git.ts'
import type { RepoPlacement } from '../src/core/placement.ts'
import {
  EMPTY_REGISTRY,
  type RegistryFile,
  type WorktreeBinding,
  type WorktreeListEntry,
} from '../src/core/registry.ts'
import type { RegistryStorePorts } from '../src/host/registry-store.ts'
import { WorktreesService } from '../src/host/service.ts'
import { nextSlug } from '../src/core/slug.ts'

const PRIMARY = '/repos/wt-repo'

function placement(overrides: Partial<RepoPlacement> = {}): RepoPlacement {
  return {
    primary: PRIMARY,
    relPath: '',
    worktreesRoot: `${PRIMARY}/.dsh/worktrees`,
    insideWorktreesRoot: false,
    ...overrides,
  }
}

class FakeGit implements GitPorts {
  readonly placements = new Map<string, RepoPlacement | GitError>()
  worktrees: WorktreeListEntry[] = [{ path: PRIMARY }]
  baseRefs = new Map<string, string>()
  existingRefs = new Set<string>()
  addCalls: { primary: string; path: string; branch: string; baseRef: string }[] = []
  addImpl: ((input: { primary: string; path: string; branch: string; baseRef: string }) => Promise<void>) | undefined
  removeCalls: { primary: string; path: string; force: boolean }[] = []
  removeImpl: ((input: { primary: string; path: string; force: boolean }) => Promise<void>) | undefined
  dirtyCounts = new Map<string, number>()
  aheadCounts = new Map<string, number>()
  ancestors = new Set<string>()
  branches = new Map<string, string | undefined>()
  version = 'git version 2.45.0'
  mergeTreeResults = new Map<string, boolean>()
  mergeCalls: { cwd: string; source: string }[] = []
  rawResults = new Map<string, { code: number; stdout: string; stderr: string }>()

  async placement(cwd: string): Promise<RepoPlacement> {
    const found = this.placements.get(cwd)
    if (found instanceof GitError) throw found
    if (found === undefined) {
      throw new GitError('not-a-repository', `fake has no placement for ${cwd}`)
    }
    return found
  }

  async gitCommonDir(cwd: string): Promise<string | undefined> {
    return this.placements.has(cwd) ? `${PRIMARY}/.git` : undefined
  }

  async listWorktrees(): Promise<WorktreeListEntry[]> {
    return this.worktrees
  }

  async defaultBaseRef(cwd: string): Promise<string> {
    return this.baseRefs.get(cwd) ?? 'origin/HEAD'
  }

  async refExists(_cwd: string, ref: string): Promise<boolean> {
    return this.existingRefs.has(ref)
  }

  async addWorktree(input: { primary: string; path: string; branch: string; baseRef: string }): Promise<void> {
    this.addCalls.push(input)
    await this.addImpl?.(input)
  }

  async removeWorktree(input: { primary: string; path: string; force: boolean }): Promise<void> {
    this.removeCalls.push(input)
    await this.removeImpl?.(input)
  }

  async dirtyCount(cwd: string): Promise<number> {
    return this.dirtyCounts.get(cwd) ?? 0
  }

  async aheadCount(_cwd: string, base: string, branch: string): Promise<number> {
    return this.aheadCounts.get(`${base}..${branch}`) ?? 0
  }

  async isAncestor(cwd: string, a: string, b: string): Promise<boolean> {
    return this.ancestors.has(`${cwd}|${a}|${b}`)
  }

  async currentBranch(cwd: string): Promise<string | undefined> {
    return this.branches.get(cwd)
  }

  async versionStdout(): Promise<string> {
    return this.version
  }

  async mergeTreeClean(_cwd: string, target: string, source: string): Promise<boolean> {
    return this.mergeTreeResults.get(`${target}..${source}`) ?? true
  }

  async merge(cwd: string, source: string): Promise<void> {
    this.mergeCalls.push({ cwd, source })
  }

  async raw(args: readonly string[], _cwd: string) {
    const key = args.join(' ')
    const found = this.rawResults.get(key)
    return found ?? { code: 1, stdout: '', stderr: '' }
  }
}

class MemoryStore implements RegistryStorePorts {
  files = new Map<string, RegistryFile>()
  replaceCount = 0

  async load(primary: string): Promise<RegistryFile> {
    return this.files.get(primary) ?? EMPTY_REGISTRY
  }

  async mutate(
    primary: string,
    _path: string,
    fn: (rows: readonly WorktreeBinding[]) => readonly WorktreeBinding[] | Promise<readonly WorktreeBinding[]>,
  ): Promise<readonly WorktreeBinding[]> {
    const current = await this.load(primary)
    const rows = await fn(current.bindings)
    this.files.set(primary, { version: 1, bindings: rows })
    return rows
  }

  async replaceAll(primary: string, _path: string, rows: readonly WorktreeBinding[]): Promise<void> {
    this.replaceCount += 1
    this.files.set(primary, { version: 1, bindings: rows })
  }
}

interface Harness {
  readonly service: WorktreesService
  readonly git: FakeGit
  readonly store: MemoryStore
  readonly sessionCwds: Map<string, string | null>
  readonly knobWrites: { sessionId: string; mode: 'danger-full-access' }[]
  readonly copies: { from: string; to: string }[]
}

function harness(seed = 7): Harness {
  const git = new FakeGit()
  git.placements.set(PRIMARY, placement())
  git.placements.set(`${PRIMARY}/packages/foo`, placement({ relPath: 'packages/foo' }))
  git.existingRefs.add('HEAD')
  const store = new MemoryStore()
  const sessionCwds = new Map<string, string | null>()
  const knobWrites: { sessionId: string; mode: 'danger-full-access' }[] = []
  const copies: { from: string; to: string }[] = []
  const service = new WorktreesService({
    git,
    store,
    getSessionCwd: (id) => sessionCwds.get(id) ?? null,
    applySandboxMode: (sessionId, mode) => {
      knobWrites.push({ sessionId, mode })
      return true
    },
    copyFile: async (from, to) => {
      copies.push({ from, to })
    },
    seed,
  })
  return { service, git, store, sessionCwds, knobWrites, copies }
}

/** Register a live worktree row in the fake + store, as create would. */
function seedWorktree(h: Harness, overrides: Partial<WorktreeBinding> = {}): WorktreeBinding {
  const slug = overrides.slug ?? 'swift-01'
  const path = overrides.path ?? `${PRIMARY}/.dsh/worktrees/${slug}`
  const binding: WorktreeBinding = {
    sessionId: '',
    slug,
    name: 'login race fix',
    path,
    branch: `dsh-worktrees/${slug}`,
    baseRef: 'origin/HEAD',
    relPath: '',
    role: 'owner',
    createdAt: 1,
    ...overrides,
  }
  // Sessions bound to this worktree resolve placement from inside it.
  h.git.placements.set(path, placement({
    relPath: `.dsh/worktrees/${slug}`,
    insideWorktreesRoot: true,
  }))
  h.git.worktrees = [...h.git.worktrees, { path, branch: binding.branch }]
  const existing = h.store.files.get(PRIMARY)?.bindings ?? []
  h.store.files.set(PRIMARY, { version: 1, bindings: [...existing, binding] })
  return binding
}

describe('preflight', () => {
  it('answers ok with placement and base ref', async () => {
    const h = harness()
    await expect(h.service.preflight(PRIMARY)).resolves.toEqual({
      ok: true,
      primary: PRIMARY,
      relPath: '',
      baseRef: 'origin/HEAD',
      dotDshIgnored: false,
    })
  })

  it('answers ok false for a repo without commits', async () => {
    const h = harness()
    h.git.existingRefs.delete('HEAD')
    await expect(h.service.preflight(PRIMARY)).resolves.toMatchObject({
      ok: false,
      issue: 'no-commits',
    })
  })

  it('refuses a cwd inside the worktrees root', async () => {
    const h = harness()
    const inside = `${PRIMARY}/.dsh/worktrees/swift-01`
    h.git.placements.set(inside, placement({ relPath: '.dsh/worktrees/swift-01', insideWorktreesRoot: true }))
    await expect(h.service.preflight(inside)).resolves.toMatchObject({
      ok: false,
      issue: 'already-in-worktree',
    })
  })

  it('reports a non-repository as an issue, not a throw', async () => {
    const h = harness()
    h.git.placements.set('/repos/wt-plain', new GitError('not-a-repository', 'outside'))
    await expect(h.service.preflight('/repos/wt-plain')).resolves.toMatchObject({
      ok: false,
      issue: 'not-a-repository',
    })
  })
})

describe('create', () => {
  it('creates the worktree, the registry row, and the title', async () => {
    const h = harness()
    const expectedSlug = nextSlug({ takenSlugs: [], seed: 7 })
    const result = await h.service.create({ cwd: PRIMARY, name: '  login   race fix ' })
    expect(result).toEqual({
      slug: expectedSlug,
      name: 'login race fix',
      title: 'login race fix',
      path: `${PRIMARY}/.dsh/worktrees/${expectedSlug}`,
      branch: `dsh-worktrees/${expectedSlug}`,
      baseRef: 'origin/HEAD',
      relPath: '',
    })
    expect(h.git.addCalls).toEqual([{
      primary: PRIMARY,
      path: `${PRIMARY}/.dsh/worktrees/${expectedSlug}`,
      branch: `dsh-worktrees/${expectedSlug}`,
      baseRef: 'origin/HEAD',
    }])
    const saved = h.store.files.get(PRIMARY)
    expect(saved?.bindings).toHaveLength(1)
    expect(saved?.bindings[0]).toMatchObject({
      sessionId: '',
      slug: expectedSlug,
      name: 'login race fix',
      role: 'owner',
    })
  })

  it('falls back to the slug title for an empty name', async () => {
    const h = harness()
    const result = await h.service.create({ cwd: PRIMARY, name: '   ' })
    const saved = h.store.files.get(PRIMARY)?.bindings[0]
    expect(result.title).toBe(result.slug)
    expect(saved).toMatchObject({ name: '' })
  })

  it('preserves the subdirectory relPath into the registry', async () => {
    const h = harness()
    await h.service.create({ cwd: `${PRIMARY}/packages/foo` })
    expect(h.store.files.get(PRIMARY)?.bindings[0]).toMatchObject({ relPath: 'packages/foo' })
  })

  it('never nests a worktree inside another', async () => {
    const h = harness()
    const inside = `${PRIMARY}/.dsh/worktrees/swift-01`
    h.git.placements.set(inside, placement({ relPath: '.dsh/worktrees/swift-01', insideWorktreesRoot: true }))
    await expect(h.service.create({ cwd: inside })).rejects.toMatchObject({
      code: 'already-in-worktree',
    })
    expect(h.git.addCalls).toHaveLength(0)
  })

  it('surfaces a branch collision as a structured error', async () => {
    const h = harness()
    h.git.addImpl = () => Promise.reject(new GitError('branch-exists', 'branch taken'))
    await expect(h.service.create({ cwd: PRIMARY })).rejects.toMatchObject({ code: 'branch-exists' })
  })

  it('copies .worktreeinclude entries into the fresh worktree', async () => {
    const h = harness()
    h.git.rawResults.set('show HEAD:.worktreeinclude', {
      code: 0,
      stdout: '.env\ncache/data\n# a comment\n',
      stderr: '',
    })
    await h.service.create({ cwd: PRIMARY })
    expect(h.copies).toEqual([
      { from: `${PRIMARY}/.env`, to: expect.stringContaining('/.env') },
      { from: `${PRIMARY}/cache/data`, to: expect.stringContaining('/cache/data') },
    ])
  })
})

describe('bind', () => {
  it('claims an unclaimed row and switches the sandbox knob', async () => {
    const h = harness()
    const binding = seedWorktree(h)
    h.sessionCwds.set('session-a', binding.path)
    await expect(h.service.bind('session-a')).resolves.toEqual({
      slug: 'swift-01',
      title: 'login race fix',
      path: binding.path,
    })
    expect(h.store.files.get(PRIMARY)?.bindings[0]).toMatchObject({ sessionId: 'session-a' })
    expect(h.knobWrites).toEqual([{ sessionId: 'session-a', mode: 'danger-full-access' }])
  })

  it('is idempotent for the owning session', async () => {
    const h = harness()
    const binding = seedWorktree(h, { sessionId: 'session-a' })
    h.sessionCwds.set('session-a', binding.path)
    await h.service.bind('session-a')
    expect(h.store.files.get(PRIMARY)?.bindings[0]).toMatchObject({ sessionId: 'session-a' })
  })

  it('refuses a takeover of a row claimed by another session', async () => {
    const h = harness()
    const binding = seedWorktree(h, { sessionId: 'session-a' })
    h.sessionCwds.set('session-b', binding.path)
    await expect(h.service.bind('session-b')).rejects.toMatchObject({ code: 'no-worktree-here' })
  })

  it('refuses a session whose cwd is no worktree', async () => {
    const h = harness()
    seedWorktree(h)
    h.sessionCwds.set('session-x', PRIMARY)
    await expect(h.service.bind('session-x')).rejects.toMatchObject({ code: 'no-worktree-here' })
  })

  it('refuses an unknown session', async () => {
    const h = harness()
    await expect(h.service.bind('ghost')).rejects.toMatchObject({ code: 'unknown-session' })
  })
})

describe('status', () => {
  it('reports dirty, ahead, and merged facts for the bound session', async () => {
    const h = harness()
    const binding = seedWorktree(h, { sessionId: 'session-a' })
    h.sessionCwds.set('session-a', binding.path)
    h.git.dirtyCounts.set(binding.path, 2)
    h.git.aheadCounts.set(`origin/HEAD..dsh-worktrees/swift-01`, 3)
    h.git.branches.set(PRIMARY, 'main')
    h.git.ancestors.add(`${PRIMARY}|dsh-worktrees/swift-01|main`)
    await expect(h.service.status('session-a')).resolves.toEqual({
      slug: 'swift-01',
      title: 'login race fix',
      path: binding.path,
      branch: 'dsh-worktrees/swift-01',
      baseRef: 'origin/HEAD',
      status: { clean: false, dirty: true, ahead: 3, merged: true },
    })
  })

  it('refuses an unbound session', async () => {
    const h = harness()
    h.sessionCwds.set('session-x', PRIMARY)
    await expect(h.service.status('session-x')).rejects.toMatchObject({ code: 'no-worktree-here' })
  })
})

describe('remove', () => {
  it('removes the worktree and drops every registry row for the slug', async () => {
    const h = harness()
    const binding = seedWorktree(h)
    await h.service.remove({ cwd: PRIMARY, slug: 'swift-01', force: false })
    expect(h.git.removeCalls).toEqual([{ primary: PRIMARY, path: binding.path, force: false }])
    expect(h.store.files.get(PRIMARY)?.bindings).toEqual([])
  })

  it('refuses an unknown slug', async () => {
    const h = harness()
    await expect(h.service.remove({ cwd: PRIMARY, slug: 'nope-99', force: false }))
      .rejects.toMatchObject({ code: 'unknown-slug' })
  })

  it('lets a dirty worktree refuse without force', async () => {
    const h = harness()
    const binding = seedWorktree(h)
    h.git.dirtyCounts.set(binding.path, 4)
    h.git.removeImpl = (input) => input.force
      ? Promise.resolve()
      : Promise.reject(new GitError('dirty-remove-refused', 'dirty'))
    await expect(h.service.remove({ cwd: PRIMARY, slug: 'swift-01', force: false }))
      .rejects.toMatchObject({ code: 'dirty-remove-refused' })
  })
})

describe('topology', () => {
  it('groups per repo and lists only claimed session ids', async () => {
    const h = harness()
    seedWorktree(h, { sessionId: 'session-a' })
    seedWorktree(h, {
      slug: 'amber-02',
      name: '',
      sessionId: '',
      path: `${PRIMARY}/.dsh/worktrees/amber-02`,
      branch: 'dsh-worktrees/amber-02',
    })
    const result = await h.service.topology([PRIMARY, '/repos/wt-plain'])
    expect(result.repos).toHaveLength(1)
    expect(result.workspaces).toEqual([
      { cwd: PRIMARY, primary: PRIMARY, canCreate: true },
      { cwd: '/repos/wt-plain', primary: '', canCreate: false, reason: 'not-a-repository' },
    ])
    const repo = result.repos[0]!
    expect(repo.primary).toBe(PRIMARY)
    expect(repo.worktrees.map((w) => w.slug)).toEqual(['swift-01', 'amber-02'])
    expect(repo.worktrees[0]).toMatchObject({ title: 'login race fix', sessionIds: ['session-a'] })
    expect(repo.worktrees[1]).toMatchObject({ title: 'amber-02', sessionIds: [] })
  })

  it('drops stale rows through reconcile while listing', async () => {
    const h = harness()
    // Registered row whose worktree is absent from the live list.
    h.store.files.set(PRIMARY, {
      version: 1,
      bindings: [{
        sessionId: '',
        slug: 'gone-01',
        name: '',
        path: `${PRIMARY}/.dsh/worktrees/gone-01`,
        branch: 'dsh-worktrees/gone-01',
        baseRef: 'origin/HEAD',
        relPath: '',
        role: 'owner',
        createdAt: 1,
      }],
    })
    const result = await h.service.topology([PRIMARY])
    expect(result.repos[0]!.worktrees).toEqual([])
    expect(h.store.files.get(PRIMARY)?.bindings).toEqual([])
  })
})

describe('mergePreflight', () => {
  function mergeHarness(): Harness {
    const h = harness()
    const binding = seedWorktree(h, { sessionId: 'session-a' })
    h.sessionCwds.set('session-a', binding.path)
    h.git.branches.set(PRIMARY, 'main')
    // Fast-forward by default: main is an ancestor of the branch, and the
    // branch is not yet an ancestor of main.
    h.git.ancestors.add(`${PRIMARY}|main|dsh-worktrees/swift-01`)
    h.git.aheadCounts.set('origin/HEAD..dsh-worktrees/swift-01', 2)
    return h
  }

  it('answers green with target, source, and fast-forward', async () => {
    const h = mergeHarness()
    await expect(h.service.mergePreflight({ cwd: PRIMARY, slug: 'swift-01' })).resolves.toEqual({
      blockers: [],
      green: true,
      target: 'main',
      source: 'dsh-worktrees/swift-01',
      fastForward: true,
      aheadCount: 2,
      manualCommand: 'git merge dsh-worktrees/swift-01',
    })
  })

  it('blocks a dirty primary', async () => {
    const h = mergeHarness()
    h.git.dirtyCounts.set(PRIMARY, 1)
    await expect(h.service.mergePreflight({ cwd: PRIMARY, slug: 'swift-01' }))
      .resolves.toMatchObject({ green: false, blockers: ['dirty-primary'] })
  })

  it('blocks a dirty worktree', async () => {
    const h = mergeHarness()
    h.git.dirtyCounts.set(`${PRIMARY}/.dsh/worktrees/swift-01`, 2)
    await expect(h.service.mergePreflight({ cwd: PRIMARY, slug: 'swift-01' }))
      .resolves.toMatchObject({ green: false, blockers: ['dirty-worktree'] })
  })

  it('blocks conflicts from the dry run', async () => {
    const h = mergeHarness()
    h.git.mergeTreeResults.set('main..dsh-worktrees/swift-01', false)
    await expect(h.service.mergePreflight({ cwd: PRIMARY, slug: 'swift-01' }))
      .resolves.toMatchObject({ green: false, blockers: ['conflict'] })
  })

  it('blocks old git with the manual command still offered', async () => {
    const h = mergeHarness()
    h.git.version = 'git version 2.30.1'
    const result = await h.service.mergePreflight({ cwd: PRIMARY, slug: 'swift-01' })
    expect(result.blockers).toEqual(['old-git'])
    expect(result.manualCommand).toBe('git merge dsh-worktrees/swift-01')
  })

  it('reports already merged', async () => {
    const h = mergeHarness()
    h.git.ancestors.delete(`${PRIMARY}|main|dsh-worktrees/swift-01`)
    h.git.ancestors.add(`${PRIMARY}|dsh-worktrees/swift-01|main`)
    await expect(h.service.mergePreflight({ cwd: PRIMARY, slug: 'swift-01' }))
      .resolves.toMatchObject({ green: false, blockers: ['already-merged'] })
  })

  it('blocks an unknown slug', async () => {
    const h = mergeHarness()
    await expect(h.service.mergePreflight({ cwd: PRIMARY, slug: 'nope-99' }))
      .resolves.toMatchObject({ green: false, blockers: ['unknown-slug'] })
  })
})

describe('mergeExecute', () => {
  it('runs the guarded merge at the primary on green', async () => {
    const h = harness()
    seedWorktree(h, { sessionId: 'session-a' })
    h.git.branches.set(PRIMARY, 'main')
    h.git.ancestors.add(`${PRIMARY}|main|dsh-worktrees/swift-01`)
    await expect(h.service.mergeExecute({ cwd: PRIMARY, slug: 'swift-01' })).resolves.toEqual({
      target: 'main',
      source: 'dsh-worktrees/swift-01',
      fastForward: true,
    })
    expect(h.git.mergeCalls).toEqual([{ cwd: PRIMARY, source: 'dsh-worktrees/swift-01' }])
  })

  it('refuses to execute when the preflight is not green', async () => {
    const h = harness()
    seedWorktree(h)
    h.git.branches.set(PRIMARY, 'main')
    h.git.ancestors.add(`${PRIMARY}|main|dsh-worktrees/swift-01`)
    h.git.dirtyCounts.set(PRIMARY, 5)
    await expect(h.service.mergeExecute({ cwd: PRIMARY, slug: 'swift-01' }))
      .rejects.toMatchObject({ code: 'merge-blocked' })
    expect(h.git.mergeCalls).toEqual([])
  })
})

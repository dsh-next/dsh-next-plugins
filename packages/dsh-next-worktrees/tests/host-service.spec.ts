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
  dirtyFiles = new Map<string, readonly string[]>()
  aheadCounts = new Map<string, number>()
  ancestors = new Set<string>()
  branches = new Map<string, string | undefined>()
  version = 'git version 2.45.0'
  mergeTreeResults = new Map<string, boolean>()
  mergeCalls: { cwd: string; source: string }[] = []
  mergingPaths = new Set<string>()
  mergeAbortCalls: string[] = []
  mergeAllowOutcomes = new Map<string, 'clean' | 'conflict'>()
  rawResults = new Map<string, { code: number; stdout: string; stderr: string }>()
  /** Resolved commit ids by `cwd|ref`; defaults give every ref a distinct tip. */
  tips = new Map<string, string>()
  listError: Error | undefined

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
    if (this.listError !== undefined) throw this.listError
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
    this.worktrees = [...this.worktrees, { path: input.path, branch: input.branch }]
    await this.addImpl?.(input)
  }

  async removeWorktree(input: { primary: string; path: string; force: boolean }): Promise<void> {
    this.removeCalls.push(input)
    this.worktrees = this.worktrees.filter((entry) => entry.path !== input.path)
    await this.removeImpl?.(input)
  }

  async dirtyCount(cwd: string): Promise<number> {
    return (await this.dirtyPaths(cwd)).length
  }

  async dirtyPaths(cwd: string): Promise<readonly string[]> {
    const listed = this.dirtyFiles.get(cwd)
    if (listed !== undefined) return listed
    const n = this.dirtyCounts.get(cwd) ?? 0
    return n === 0 ? [] : Array.from({ length: n }, (_, i) => `uncommitted-${i + 1}`)
  }

  lastAheadCwd: string | undefined
  async aheadCount(cwd: string, base: string, branch: string): Promise<number> {
    this.lastAheadCwd = cwd
    return this.aheadCounts.get(`${base}..${branch}`) ?? 0
  }

  async isAncestor(cwd: string, a: string, b: string): Promise<boolean> {
    return this.ancestors.has(`${cwd}|${a}|${b}`)
  }

  async revParse(cwd: string, ref: string): Promise<string | undefined> {
    return this.tips.get(`${cwd}|${ref}`) ?? `tip-${cwd}/${ref}`
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

  async mergeAllowConflicts(cwd: string, source: string): Promise<'clean' | 'conflict'> {
    this.mergeCalls.push({ cwd, source })
    const outcome = this.mergeAllowOutcomes.get(cwd) ?? 'clean'
    if (outcome === 'conflict') this.mergingPaths.add(cwd)
    return outcome
  }

  async merging(cwd: string): Promise<boolean> {
    return this.mergingPaths.has(cwd)
  }

  async mergeAbort(cwd: string): Promise<void> {
    this.mergeAbortCalls.push(cwd)
    this.mergingPaths.delete(cwd)
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
  throwOnMutate: Error | undefined

  async load(primary: string): Promise<RegistryFile> {
    return this.files.get(primary) ?? EMPTY_REGISTRY
  }

  async mutate(
    primary: string,
    _path: string,
    fn: (rows: readonly WorktreeBinding[]) => readonly WorktreeBinding[] | Promise<readonly WorktreeBinding[]>,
  ): Promise<readonly WorktreeBinding[]> {
    if (this.throwOnMutate !== undefined) throw this.throwOnMutate
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
  readonly files: Map<string, string>
  readonly commands: { command?: string; script?: string; cwd: string; env: Readonly<Record<string, string>> }[]
  commandImpl?: (input: { command?: string; script?: string }) => { code: number; stdout: string; stderr: string }
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
  const files = new Map<string, string>()
  const commands: Harness['commands'] = []
  const box: Pick<Harness, 'commandImpl'> = {}
  const service = new WorktreesService({
    git,
    store,
    getSessionCwd: (id) => sessionCwds.get(id) ?? null,
    applySandboxMode: (sessionId, mode) => {
      knobWrites.push({ sessionId, mode })
      return true
    },
    isSessionRunning: (sessionId) => sessionId === 'running-session',
    copyFile: async (from, to) => {
      copies.push({ from, to })
    },
    readText: async (path) => files.get(path) ?? null,
    runCommand: async (input) => {
      commands.push(input)
      return box.commandImpl?.(input) ?? { code: 0, stdout: '', stderr: '' }
    },
    platform: 'darwin',
    seed,
  })
  return { service, git, store, sessionCwds, knobWrites, copies, files, commands, get commandImpl() { return box.commandImpl }, set commandImpl(value) { box.commandImpl = value } }
}

/** Register a live worktree row in the fake + store, as create would. */
function seedWorktree(h: { git: FakeGit; store: MemoryStore }, overrides: Partial<WorktreeBinding> = {}): WorktreeBinding {
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
    baseSha: '',
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
      setupPending: false,
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
      baseSha: `tip-${PRIMARY}/origin/HEAD`,
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

  it('removes the git worktree when the registry write fails after add', async () => {
    const h = harness()
    h.store.throwOnMutate = new Error('disk full')
    await expect(h.service.create({ cwd: PRIMARY })).rejects.toThrow('disk full')
    expect(h.git.addCalls).toHaveLength(1)
    expect(h.git.removeCalls).toEqual([{
      primary: PRIMARY,
      path: h.git.addCalls[0]!.path,
      force: true,
    }])
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

  it('skips absolute and parent-directory .worktreeinclude entries', async () => {
    const h = harness()
    h.git.rawResults.set('show HEAD:.worktreeinclude', {
      code: 0,
      stdout: '.env\n../secret\n/etc/passwd\nC:\\windows\\hint\n',
      stderr: '',
    })
    await h.service.create({ cwd: PRIMARY })
    expect(h.copies).toEqual([
      { from: `${PRIMARY}/.env`, to: expect.stringContaining('/.env') },
    ])
  })

  it('defers setup-worktree commands until setup() so the session row can appear', async () => {
    const h = harness()
    h.files.set(`${PRIMARY}/.worktrees.json`, JSON.stringify({
      'setup-worktree': ['pnpm install', 'cp "$ROOT_WORKTREE_PATH/.env" .env'],
    }))
    const created = await h.service.create({ cwd: PRIMARY })
    expect(created.setupPending).toBe(true)
    expect(h.commands).toEqual([])
    await h.service.setup({ cwd: PRIMARY, slug: created.slug })
    expect(h.commands).toEqual([
      expect.objectContaining({
        command: 'pnpm install',
        cwd: expect.stringContaining('/.dsh/worktrees/'),
        env: { ROOT_WORKTREE_PATH: PRIMARY },
      }),
      expect.objectContaining({ command: 'cp "$ROOT_WORKTREE_PATH/.env" .env' }),
    ])
  })

  it('prefers .dsh/worktrees.json over the project-root file', async () => {
    const h = harness()
    h.files.set(`${PRIMARY}/.worktrees.json`, JSON.stringify({ 'setup-worktree': ['root'] }))
    h.files.set(`${PRIMARY}/.dsh/worktrees.json`, JSON.stringify({ 'setup-worktree': ['local'] }))
    const created = await h.service.create({ cwd: PRIMARY })
    await h.service.setup({ cwd: PRIMARY, slug: created.slug })
    expect(h.commands.map((c) => c.command)).toEqual(['local'])
  })

  it('rolls back the worktree when a setup command fails', async () => {
    const h = harness()
    h.files.set(`${PRIMARY}/.worktrees.json`, JSON.stringify({ 'setup-worktree': ['false'] }))
    h.commandImpl = () => ({ code: 1, stdout: '', stderr: 'nope' })
    const created = await h.service.create({ cwd: PRIMARY })
    expect(created.setupPending).toBe(true)
    await expect(h.service.setup({ cwd: PRIMARY, slug: created.slug })).rejects.toMatchObject({
      code: 'setup-failed',
    })
    expect(h.git.removeCalls).toEqual([expect.objectContaining({ force: true })])
    expect(h.store.files.get(PRIMARY)?.bindings).toEqual([])
  })

  it('rejects invalid setup JSON without adding a worktree row', async () => {
    const h = harness()
    h.files.set(`${PRIMARY}/.worktrees.json`, '{')
    await expect(h.service.create({ cwd: PRIMARY })).rejects.toMatchObject({
      code: 'setup-invalid',
    })
    expect(h.git.removeCalls.length).toBeGreaterThan(0)
    expect(h.store.files.get(PRIMARY)?.bindings).toEqual([])
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

  it('surfaces a sandbox-knob refusal', async () => {
    const git = new FakeGit()
    git.placements.set(PRIMARY, placement())
    git.existingRefs.add('HEAD')
    const store = new MemoryStore()
    const sessionCwds = new Map<string, string | null>()
    const service = new WorktreesService({
      git,
      store,
      getSessionCwd: (id) => sessionCwds.get(id) ?? null,
      applySandboxMode: () => false,
      isSessionRunning: () => false,
      copyFile: async () => {},
    })
    const h = { service, git, store, sessionCwds, knobWrites: [], copies: [] }
    const binding = seedWorktree(h)
    sessionCwds.set('session-a', binding.path)
    await expect(service.bind('session-a')).rejects.toMatchObject({ code: 'sandbox-refused' })
  })
})

describe('reclaim', () => {
  it('retargets the row from self onto to in one mutate and grants sandbox', async () => {
    const h = harness()
    const binding = seedWorktree(h, { sessionId: 'session-old' })
    h.sessionCwds.set('session-old', binding.path)
    h.sessionCwds.set('session-new', binding.path)
    await expect(h.service.reclaim('session-old', 'session-new')).resolves.toEqual({
      claimed: true,
      slug: 'swift-01',
      title: 'login race fix',
      path: binding.path,
    })
    expect(h.store.files.get(PRIMARY)?.bindings[0]).toMatchObject({ sessionId: 'session-new' })
    expect(h.knobWrites).toEqual([{ sessionId: 'session-new', mode: 'danger-full-access' }])
  })

  it('is idempotent when to already owns the row', async () => {
    const h = harness()
    const binding = seedWorktree(h, { sessionId: 'session-new' })
    h.sessionCwds.set('session-old', binding.path)
    h.sessionCwds.set('session-new', binding.path)
    await expect(h.service.reclaim('session-old', 'session-new')).resolves.toMatchObject({ claimed: true })
    expect(h.store.files.get(PRIMARY)?.bindings[0]).toMatchObject({ sessionId: 'session-new' })
    expect(h.knobWrites).toEqual([{ sessionId: 'session-new', mode: 'danger-full-access' }])
  })

  it('skips a cwd that is not a plugin worktree', async () => {
    const h = harness()
    seedWorktree(h, { sessionId: 'session-old' })
    h.sessionCwds.set('session-old', PRIMARY)
    h.sessionCwds.set('session-new', PRIMARY)
    await expect(h.service.reclaim('session-old', 'session-new')).resolves.toEqual({
      claimed: false,
      reason: 'no-worktree-here',
    })
    expect(h.store.files.get(PRIMARY)?.bindings[0]).toMatchObject({ sessionId: 'session-old' })
    expect(h.knobWrites).toEqual([])
  })

  it('skips a row owned by some other session', async () => {
    const h = harness()
    const binding = seedWorktree(h, { sessionId: 'session-other' })
    h.sessionCwds.set('session-old', binding.path)
    h.sessionCwds.set('session-new', binding.path)
    await expect(h.service.reclaim('session-old', 'session-new')).resolves.toEqual({
      claimed: false,
      reason: 'not-owner',
    })
    expect(h.store.files.get(PRIMARY)?.bindings[0]).toMatchObject({ sessionId: 'session-other' })
    expect(h.knobWrites).toEqual([])
  })

  it('skips a non-repository cwd instead of throwing', async () => {
    const h = harness()
    h.git.placements.set('/plain', new GitError('not-a-repository', 'outside'))
    h.sessionCwds.set('session-old', '/plain')
    h.sessionCwds.set('session-new', '/plain')
    await expect(h.service.reclaim('session-old', 'session-new')).resolves.toEqual({
      claimed: false,
      reason: 'no-worktree-here',
    })
  })

  it('refuses identical from and to', async () => {
    const h = harness()
    await expect(h.service.reclaim('session-a', 'session-a')).rejects.toMatchObject({ code: 'bad-request' })
  })

  it('leaves the row on from when the sandbox knob is refused', async () => {
    const git = new FakeGit()
    git.placements.set(PRIMARY, placement())
    git.existingRefs.add('HEAD')
    const store = new MemoryStore()
    const sessionCwds = new Map<string, string | null>()
    const service = new WorktreesService({
      git,
      store,
      getSessionCwd: (id) => sessionCwds.get(id) ?? null,
      applySandboxMode: () => false,
      isSessionRunning: () => false,
      copyFile: async () => {},
    })
    const h = { service, git, store, sessionCwds, knobWrites: [], copies: [] }
    const binding = seedWorktree(h, { sessionId: 'session-old' })
    sessionCwds.set('session-old', binding.path)
    sessionCwds.set('session-new', binding.path)
    await expect(service.reclaim('session-old', 'session-new')).rejects.toMatchObject({ code: 'sandbox-refused' })
    expect(store.files.get(PRIMARY)?.bindings[0]).toMatchObject({ sessionId: 'session-old' })
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
      status: { clean: false, dirty: true, ahead: 3, merged: true, conflict: false },
    })
    expect(h.git.lastAheadCwd).toBe(PRIMARY)
  })

  it('never reports merged for a fresh worktree whose tip equals the base', async () => {
    const h = harness()
    const binding = seedWorktree(h, { sessionId: 'session-a' })
    h.sessionCwds.set('session-a', binding.path)
    h.git.branches.set(PRIMARY, 'main')
    h.git.ancestors.add(`${PRIMARY}|dsh-worktrees/swift-01|main`)
    const same = 'tip-fresh'
    h.git.tips.set(`${binding.path}|dsh-worktrees/swift-01`, same)
    h.git.tips.set(`${PRIMARY}|origin/HEAD`, same)
    await expect(h.service.status('session-a')).resolves.toMatchObject({
      status: { clean: true, dirty: false, ahead: 0, merged: false, conflict: false },
    })
  })

  it('reports merged after a fast-forward when the base SHA was pinned at create', async () => {
    const h = harness()
    const binding = seedWorktree(h, {
      sessionId: 'session-a',
      baseRef: 'HEAD',
      baseSha: 'sha-at-create',
    })
    h.sessionCwds.set('session-a', binding.path)
    h.git.branches.set(PRIMARY, 'main')
    h.git.ancestors.add(`${PRIMARY}|dsh-worktrees/swift-01|main`)
    // After FF, live HEAD at the primary equals the branch tip — the
    // discriminator the unpinned HEAD base used to trip. The pin keeps
    // merged true.
    h.git.tips.set(`${binding.path}|dsh-worktrees/swift-01`, 'feature-tip')
    h.git.tips.set(`${PRIMARY}|HEAD`, 'feature-tip')
    await expect(h.service.status('session-a')).resolves.toMatchObject({
      status: { merged: true },
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
        baseSha: '',
        role: 'owner',
        createdAt: 1,
      }],
    })
    const result = await h.service.topology([PRIMARY])
    expect(result.repos[0]!.worktrees).toEqual([])
    expect(h.store.files.get(PRIMARY)?.bindings).toEqual([])
  })

  it('does not persist a reconcile drop when git worktree list fails', async () => {
    const h = harness()
    seedWorktree(h)
    h.git.listError = new GitError('git-failed', 'unable to read index')
    const result = await h.service.topology([PRIMARY])
    expect(result.repos[0]).toMatchObject({ ok: false, worktrees: [] })
    expect(h.store.files.get(PRIMARY)?.bindings).toHaveLength(1)
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
      warnings: [],
      dirtyPrimary: [],
      dirtyWorktree: [],
    })
  })

  it('warns a dirty primary without blocking Merge', async () => {
    const h = mergeHarness()
    h.git.dirtyFiles.set(PRIMARY, ['docs/screenshots/foo.png'])
    await expect(h.service.mergePreflight({ cwd: PRIMARY, slug: 'swift-01' }))
      .resolves.toMatchObject({
        green: true,
        blockers: [],
        warnings: ['dirty-primary'],
        dirtyPrimary: ['docs/screenshots/foo.png'],
        dirtyWorktree: [],
      })
  })

  it('warns a dirty worktree without blocking Merge', async () => {
    const h = mergeHarness()
    h.git.dirtyFiles.set(`${PRIMARY}/.dsh/worktrees/swift-01`, ['scratch.txt', 'tmp.log'])
    await expect(h.service.mergePreflight({ cwd: PRIMARY, slug: 'swift-01' }))
      .resolves.toMatchObject({
        green: true,
        blockers: [],
        warnings: ['dirty-worktree'],
        dirtyPrimary: [],
        dirtyWorktree: ['scratch.txt', 'tmp.log'],
      })
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

  it('treats a fresh worktree (tip == base) as mergeable, not already merged', async () => {
    const h = mergeHarness()
    h.git.ancestors.add(`${PRIMARY}|dsh-worktrees/swift-01|main`)
    const binding = h.store.files.get(PRIMARY)!.bindings[0]!
    const same = 'tip-fresh'
    h.git.tips.set(`${binding.path}|dsh-worktrees/swift-01`, same)
    h.git.tips.set(`${PRIMARY}|origin/HEAD`, same)
    await expect(h.service.mergePreflight({ cwd: PRIMARY, slug: 'swift-01' }))
      .resolves.toMatchObject({ green: true, fastForward: true, blockers: [] })
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

  it('executes Merge even when the primary is dirty', async () => {
    const h = harness()
    seedWorktree(h)
    h.git.branches.set(PRIMARY, 'main')
    h.git.ancestors.add(`${PRIMARY}|main|dsh-worktrees/swift-01`)
    h.git.dirtyCounts.set(PRIMARY, 5)
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
    h.git.mergeTreeResults.set('main..dsh-worktrees/swift-01', false)
    await expect(h.service.mergeExecute({ cwd: PRIMARY, slug: 'swift-01' }))
      .rejects.toMatchObject({ code: 'merge-blocked' })
    expect(h.git.mergeCalls).toEqual([])
  })
})

describe('updatePreflight', () => {
  function updateHarness(): Harness {
    const h = harness()
    const binding = seedWorktree(h, { sessionId: 'session-a' })
    h.sessionCwds.set('session-a', binding.path)
    h.git.branches.set(PRIMARY, 'main')
    // Worktree is behind main: merging main in is a fast-forward.
    h.git.ancestors.add(`${PRIMARY}|dsh-worktrees/swift-01|main`)
    return h
  }

  it('answers green with source, target, and fast-forward', async () => {
    const h = updateHarness()
    await expect(h.service.updatePreflight({ cwd: PRIMARY, slug: 'swift-01' })).resolves.toEqual({
      blockers: [],
      green: true,
      source: 'main',
      target: 'dsh-worktrees/swift-01',
      fastForward: true,
      wouldConflict: false,
      inProgress: false,
      sessionId: 'session-a',
      manualCommand: 'git merge main',
      dirtyWorktree: [],
    })
  })

  it('does not treat a merge-tree conflict as a blocker', async () => {
    const h = updateHarness()
    h.git.mergeTreeResults.set('dsh-worktrees/swift-01..main', false)
    await expect(h.service.updatePreflight({ cwd: PRIMARY, slug: 'swift-01' }))
      .resolves.toMatchObject({ green: true, wouldConflict: true, blockers: [] })
  })

  it('blocks a dirty worktree', async () => {
    const h = updateHarness()
    h.git.dirtyFiles.set(`${PRIMARY}/.dsh/worktrees/swift-01`, ['scratch.txt'])
    await expect(h.service.updatePreflight({ cwd: PRIMARY, slug: 'swift-01' }))
      .resolves.toMatchObject({
        green: false,
        blockers: ['dirty-worktree'],
        dirtyWorktree: ['scratch.txt'],
      })
  })

  it('blocks a missing bound session', async () => {
    const h = updateHarness()
    const rows = h.store.files.get(PRIMARY)!.bindings.map((b) => ({ ...b, sessionId: '' }))
    h.store.files.set(PRIMARY, { version: 1, bindings: rows })
    await expect(h.service.updatePreflight({ cwd: PRIMARY, slug: 'swift-01' }))
      .resolves.toMatchObject({ green: false, blockers: ['no-bound-session'] })
  })

  it('blocks a running session', async () => {
    const h = updateHarness()
    const rows = h.store.files.get(PRIMARY)!.bindings.map((b) => ({ ...b, sessionId: 'running-session' }))
    h.store.files.set(PRIMARY, { version: 1, bindings: rows })
    await expect(h.service.updatePreflight({ cwd: PRIMARY, slug: 'swift-01' }))
      .resolves.toMatchObject({ green: false, blockers: ['running-session'] })
  })

  it('blocks an in-progress merge instead of dirty', async () => {
    const h = updateHarness()
    h.git.mergingPaths.add(`${PRIMARY}/.dsh/worktrees/swift-01`)
    h.git.dirtyCounts.set(`${PRIMARY}/.dsh/worktrees/swift-01`, 4)
    await expect(h.service.updatePreflight({ cwd: PRIMARY, slug: 'swift-01' }))
      .resolves.toMatchObject({ green: false, inProgress: true, blockers: ['in-progress'] })
  })

  it('blocks already-updated when the primary is an ancestor of the worktree', async () => {
    const h = updateHarness()
    h.git.ancestors.delete(`${PRIMARY}|dsh-worktrees/swift-01|main`)
    h.git.ancestors.add(`${PRIMARY}|main|dsh-worktrees/swift-01`)
    await expect(h.service.updatePreflight({ cwd: PRIMARY, slug: 'swift-01' }))
      .resolves.toMatchObject({ green: false, blockers: ['already-updated'] })
  })

  it('blocks an unknown slug', async () => {
    const h = updateHarness()
    await expect(h.service.updatePreflight({ cwd: PRIMARY, slug: 'nope-99' }))
      .resolves.toMatchObject({ green: false, blockers: ['unknown-slug'] })
  })
})

describe('updateExecute', () => {
  it('merges the primary branch into the worktree on green', async () => {
    const h = harness()
    const binding = seedWorktree(h, { sessionId: 'session-a' })
    h.git.branches.set(PRIMARY, 'main')
    h.git.ancestors.add(`${PRIMARY}|dsh-worktrees/swift-01|main`)
    await expect(h.service.updateExecute({ cwd: PRIMARY, slug: 'swift-01' })).resolves.toEqual({
      source: 'main',
      target: 'dsh-worktrees/swift-01',
      fastForward: true,
      conflict: false,
      sessionId: 'session-a',
    })
    expect(h.git.mergeCalls).toEqual([{ cwd: binding.path, source: 'main' }])
  })

  it('returns conflict when the worktree merge stops mid-merge', async () => {
    const h = harness()
    const binding = seedWorktree(h, { sessionId: 'session-a' })
    h.git.branches.set(PRIMARY, 'main')
    h.git.ancestors.add(`${PRIMARY}|dsh-worktrees/swift-01|main`)
    h.git.mergeAllowOutcomes.set(binding.path, 'conflict')
    await expect(h.service.updateExecute({ cwd: PRIMARY, slug: 'swift-01' }))
      .resolves.toMatchObject({ conflict: true, sessionId: 'session-a' })
    expect(h.git.mergingPaths.has(binding.path)).toBe(true)
  })

  it('refuses to execute when the preflight is not green', async () => {
    const h = harness()
    seedWorktree(h, { sessionId: 'session-a' })
    h.git.branches.set(PRIMARY, 'main')
    h.git.dirtyCounts.set(`${PRIMARY}/.dsh/worktrees/swift-01`, 3)
    await expect(h.service.updateExecute({ cwd: PRIMARY, slug: 'swift-01' }))
      .rejects.toMatchObject({ code: 'update-blocked' })
    expect(h.git.mergeCalls).toEqual([])
  })
})

describe('updateAbort', () => {
  it('aborts an in-flight merge in the worktree', async () => {
    const h = harness()
    const binding = seedWorktree(h, { sessionId: 'session-a' })
    h.git.mergingPaths.add(binding.path)
    await h.service.updateAbort({ cwd: PRIMARY, slug: 'swift-01' })
    expect(h.git.mergeAbortCalls).toEqual([binding.path])
    expect(h.git.mergingPaths.has(binding.path)).toBe(false)
  })

  it('refuses when no merge is in progress', async () => {
    const h = harness()
    seedWorktree(h, { sessionId: 'session-a' })
    await expect(h.service.updateAbort({ cwd: PRIMARY, slug: 'swift-01' }))
      .rejects.toMatchObject({ code: 'not-in-progress' })
  })
})

describe('status conflict', () => {
  it('reports conflict when MERGE_HEAD is present', async () => {
    const h = harness()
    const binding = seedWorktree(h, { sessionId: 'session-a' })
    h.sessionCwds.set('session-a', binding.path)
    h.git.mergingPaths.add(binding.path)
    h.git.dirtyCounts.set(binding.path, 2)
    await expect(h.service.status('session-a')).resolves.toMatchObject({
      status: { conflict: true, dirty: true },
    })
  })
})

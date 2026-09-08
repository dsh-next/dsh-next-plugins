/** Disposable deterministic registry interleavings; never touches the workspace Git state. */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GitRunner } from '../src/host/git.ts'
import { RegistryStore } from '../src/host/registry-store.ts'
import { WorktreesService } from '../src/host/service.ts'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

class PausableGit extends GitRunner {
  private removalGate: { entered: ReturnType<typeof deferred>; released: ReturnType<typeof deferred> } | undefined
  private listGate: { entered: ReturnType<typeof deferred>; released: ReturnType<typeof deferred> } | undefined

  pauseNextRemoval() {
    const gate = { entered: deferred(), released: deferred() }
    this.removalGate = gate
    return { entered: gate.entered.promise, release: gate.released.resolve }
  }

  pauseNextList() {
    const gate = { entered: deferred(), released: deferred() }
    this.listGate = gate
    return { entered: gate.entered.promise, release: gate.released.resolve }
  }

  override async removeWorktree(input: { primary: string; path: string; force: boolean }): Promise<void> {
    const gate = this.removalGate
    this.removalGate = undefined
    if (gate !== undefined) {
      gate.entered.resolve()
      await gate.released.promise
    }
    await super.removeWorktree(input)
  }

  override async listWorktrees(primary: string) {
    const gate = this.listGate
    this.listGate = undefined
    if (gate !== undefined) {
      gate.entered.resolve()
      await gate.released.promise
    }
    return super.listWorktrees(primary)
  }
}

async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-diag-host-race-b983c4-'))
  roots.push(root)
  const dir = await realpath(root)
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'diagnostic@example.invalid')
  git('config', 'user.name', 'Disposable diagnostic')
  git('config', 'commit.gpgsign', 'false')
  git('config', 'core.hooksPath', '/dev/null')
  await writeFile(join(dir, 'seed.txt'), 'seed\n')
  git('add', 'seed.txt')
  git('commit', '-q', '-m', 'seed')
  const runner = new PausableGit()
  const store = new RegistryStore()
  const sessionCwds = new Map<string, string>()
  const service = new WorktreesService({
    git: runner,
    store,
    getSessionCwd: (id) => sessionCwds.get(id) ?? null,
    applySandboxMode: () => true,
    isSessionRunning: () => false,
    copyFile: async () => {},
  })
  return { dir, git, runner, store, service, sessionCwds }
}

describe('diagnostic host serialized registry contract b983c4', { timeout: 15_000 }, () => {
  // service.ts invariant: every write is serialized per repo. Pause only a public
  // Git port to hold one valid concurrent schedule; all filesystem/Git writes are real.
  it('deleting one worktree preserves another created while Git removal is in flight', async () => {
    const h = await harness()
    const first = await h.service.create({ cwd: h.dir, name: 'first-tree' })
    const gate = h.runner.pauseNextRemoval()
    const removal = h.service.remove({ cwd: h.dir, slug: first.slug, force: false })
    await gate.entered
    let second
    try {
      second = await h.service.create({ cwd: h.dir, name: 'second-tree' })
      expect((await h.store.load(h.dir)).bindings.map((row) => row.slug)).toEqual(['first-tree', 'second-tree'])
    } finally {
      gate.release()
      await removal
    }
    expect(existsSync(first.path)).toBe(false)
    expect(existsSync(second!.path)).toBe(true)
    expect((await h.runner.listWorktrees(h.dir)).map((row) => row.path)).toContain(second!.path)
    expect((await h.store.load(h.dir)).bindings.map((row) => row.slug)).toEqual(['second-tree'])
  })

  it('preserves a concurrent session claim while branch reconciliation persists', async () => {
    const h = await harness()
    const first = await h.service.create({ cwd: h.dir, name: 'first-tree' })
    h.sessionCwds.set('session-a', first.path)
    h.git('-C', first.path, 'checkout', '-q', '-b', 'agent-feature')
    const gate = h.runner.pauseNextList()
    const status = h.service.status('session-a')
    await gate.entered
    await h.service.bind('session-a')
    gate.release()
    await status

    expect((await h.store.load(h.dir)).bindings).toEqual([
      expect.objectContaining({ slug: first.slug, branch: 'agent-feature', sessionId: 'session-a' }),
    ])
  })

  it('preserves a concurrent create while branch reconciliation persists', async () => {
    const h = await harness()
    const first = await h.service.create({ cwd: h.dir, name: 'first-tree' })
    h.sessionCwds.set('session-a', first.path)
    h.git('-C', first.path, 'checkout', '-q', '-b', 'agent-feature')
    const gate = h.runner.pauseNextList()
    const status = h.service.status('session-a')
    await gate.entered
    const second = await h.service.create({ cwd: h.dir, name: 'second-tree' })
    gate.release()
    await status

    expect((await h.store.load(h.dir)).bindings).toEqual(expect.arrayContaining([
      expect.objectContaining({ slug: first.slug, branch: 'agent-feature' }),
      expect.objectContaining({ slug: second.slug }),
    ]))
  })

  it.each(['before', 'after'] as const)('negative control: another create %s deletion preserves its row', async (when) => {
    const h = await harness()
    const first = await h.service.create({ cwd: h.dir, name: 'first-tree' })
    if (when === 'before') await h.service.create({ cwd: h.dir, name: 'second-tree' })
    await h.service.remove({ cwd: h.dir, slug: first.slug, force: false })
    if (when === 'after') await h.service.create({ cwd: h.dir, name: 'second-tree' })
    expect((await h.store.load(h.dir)).bindings.map((row) => row.slug)).toEqual(['second-tree'])
  })

  it('deleting one worktree preserves a new session claim on another during removal', async () => {
    const h = await harness()
    const first = await h.service.create({ cwd: h.dir, name: 'first-tree' })
    const second = await h.service.create({ cwd: h.dir, name: 'second-tree' })
    h.sessionCwds.set('session-b', second.path)
    const gate = h.runner.pauseNextRemoval()
    const removal = h.service.remove({ cwd: h.dir, slug: first.slug, force: false })
    await gate.entered
    try {
      await h.service.bind('session-b')
      expect((await h.store.load(h.dir)).bindings.find((row) => row.slug === second.slug)?.sessionId).toBe('session-b')
    } finally {
      gate.release()
      await removal
    }
    expect((await h.store.load(h.dir)).bindings[0]).toMatchObject({ slug: second.slug, sessionId: 'session-b' })
  })

  it('negative control: concurrent store mutations preserve both updates under the same store lock', async () => {
    const h = await harness()
    const first = await h.service.create({ cwd: h.dir, name: 'first-tree' })
    const second = await h.service.create({ cwd: h.dir, name: 'second-tree' })
    const registryPath = join(h.dir, '.dsh/worktrees/registry.json')
    await Promise.all([
      h.store.mutate(h.dir, registryPath, (rows) => rows.map((row) => row.slug === first.slug ? { ...row, sessionId: 'session-a' } : row)),
      h.store.mutate(h.dir, registryPath, (rows) => rows.map((row) => row.slug === second.slug ? { ...row, sessionId: 'session-b' } : row)),
    ])
    expect((await h.store.load(h.dir)).bindings.map((row) => row.sessionId)).toEqual(['session-a', 'session-b'])
  })

  it('keeps a concurrent checkout addressable after restarting the service', async () => {
    const h = await harness()
    const first = await h.service.create({ cwd: h.dir, name: 'first-tree' })
    const gate = h.runner.pauseNextRemoval()
    const removal = h.service.remove({ cwd: h.dir, slug: first.slug, force: false })
    await gate.entered
    let second
    try {
      second = await h.service.create({ cwd: h.dir, name: 'second-tree' })
    } finally {
      gate.release()
      await removal
    }
    const cold = new WorktreesService({
      git: new GitRunner(), store: new RegistryStore(),
      getSessionCwd: () => null, applySandboxMode: () => true,
      isSessionRunning: () => false, copyFile: async () => {},
    })
    expect((await h.runner.listWorktrees(h.dir)).map((row) => row.path)).toContain(second!.path)
    expect((await cold.topology([h.dir])).repos[0]).toMatchObject({
      ok: true,
      worktrees: [expect.objectContaining({ slug: second!.slug })],
    })
    await expect(cold.remove({ cwd: h.dir, slug: second!.slug, force: false }))
      .resolves.toBeUndefined()
  })
})

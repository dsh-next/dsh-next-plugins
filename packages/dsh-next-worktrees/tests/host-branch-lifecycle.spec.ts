/** Disposable diagnosis only. All Git state lives in temporary repositories. */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
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

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
  }).trim()
}

async function commit(cwd: string, path: string, content: string): Promise<void> {
  await writeFile(join(cwd, path), content)
  git(cwd, 'add', '--', path)
  git(cwd, 'commit', '-q', '-m', `write ${path}`)
}

async function harness(basename = 'ordinary-repo') {
  const root = await mkdtemp(join(tmpdir(), 'dsh-diag-host-b983c4-'))
  roots.push(root)
  await mkdir(join(root, basename))
  const dir = await realpath(join(root, basename))
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'user.email', 'diagnostic@example.invalid')
  git(dir, 'config', 'user.name', 'Disposable diagnostic')
  git(dir, 'config', 'commit.gpgsign', 'false')
  git(dir, 'config', 'core.hooksPath', '/dev/null')
  await commit(dir, 'seed.txt', 'seed\n')
  const sessionCwds = new Map<string, string>()
  const runner = new GitRunner()
  const store = new RegistryStore()
  const service = new WorktreesService({
    git: runner,
    store,
    getSessionCwd: (id) => sessionCwds.get(id) ?? null,
    applySandboxMode: () => true,
    isSessionRunning: () => false,
    copyFile: async () => {},
    seed: 19,
  })
  const restart = () => new WorktreesService({
    git: new GitRunner(),
    store: new RegistryStore(),
    getSessionCwd: (id) => sessionCwds.get(id) ?? null,
    applySandboxMode: () => true,
    isSessionRunning: () => false,
    copyFile: async () => {},
  })
  return { dir, runner, store, service, sessionCwds, restart }
}

describe('diagnostic host documented lifecycle contracts b983c4', { timeout: 15_000 }, () => {
  // README: create, dirty/ahead status, merge into primary, remove while retaining branch.
  it.each(['ordinary-repo', 'projet-caf\u00e9', 'repo-with-"quote'])('completes lifecycle at %s', async (basename) => {
    const h = await harness(basename)
    const created = await h.service.create({ cwd: h.dir, name: 'audit-tree' })
    h.sessionCwds.set('session-a', created.path)
    await h.service.bind('session-a')
    expect((await h.service.status('session-a')).status).toMatchObject({ clean: true, ahead: 0 })
    await commit(created.path, 'feature.txt', 'feature\n')
    expect((await h.service.status('session-a')).status).toMatchObject({ clean: true, ahead: 1 })
    await h.service.mergeExecute({ cwd: h.dir, slug: created.slug })
    expect(git(h.dir, 'show', 'HEAD:feature.txt')).toBe('feature')
    await h.service.remove({ cwd: h.dir, slug: created.slug, force: false })
    expect(existsSync(created.path)).toBe(false)
    expect(git(h.dir, 'rev-parse', '--verify', `refs/heads/${created.branch}`)).not.toBe('')
    expect((await h.store.load(h.dir)).bindings).toEqual([])
  })

  // Product invariant: Git is the source of truth; Refresh re-reads the checkout status.
  it('refresh reflects the checked-out branch after an agent switches branches', async () => {
    const h = await harness()
    const created = await h.service.create({ cwd: h.dir, name: 'audit-tree' })
    h.sessionCwds.set('session-a', created.path)
    await h.service.bind('session-a')
    git(created.path, 'checkout', '-q', '-b', 'agent-feature')
    const status = await h.service.status('session-a')
    expect(status.branch).toBe(git(created.path, 'branch', '--show-current'))
  })

  it('reconciles live Git branch facts in topology and after restart', async () => {
    const h = await harness()
    const created = await h.service.create({ cwd: h.dir, name: 'audit-tree' })
    h.sessionCwds.set('session-a', created.path)
    await h.service.bind('session-a')
    git(created.path, 'checkout', '-q', '-b', 'agent-feature')
    await commit(created.path, 'feature.txt', 'feature\n')
    expect(await h.runner.currentBranch(created.path)).toBe('agent-feature')
    expect(await h.runner.currentBranch(h.dir)).toBe('main')
    expect(await h.runner.placement(created.path)).toMatchObject({ primary: h.dir, insideWorktreesRoot: true })
    expect((await h.runner.listWorktrees(h.dir)).find((row) => row.path === created.path)?.branch).toBe('agent-feature')
    expect((await h.service.topology([h.dir])).repos[0]?.worktrees[0]).toMatchObject({
      branch: 'agent-feature', status: { ahead: 1 },
    })
    expect(await h.restart().status('session-a')).toMatchObject({ branch: 'agent-feature', status: { ahead: 1 } })
    expect((await h.store.load(h.dir)).bindings[0]?.branch).toBe('agent-feature')
  })

  it('merge lands the committed checkout work after an agent switches branches', async () => {
    const h = await harness()
    const created = await h.service.create({ cwd: h.dir, name: 'audit-tree' })
    git(created.path, 'checkout', '-q', '-b', 'agent-feature')
    await commit(created.path, 'feature.txt', 'feature\n')
    const result = await h.service.mergeExecute({ cwd: h.dir, slug: created.slug })
    expect(result.target).toBe('main')
    expect(git(h.dir, 'ls-tree', '--name-only', 'HEAD')).toContain('feature.txt')
  })

  it('blocks Merge and Update when the worktree is detached', async () => {
    const h = await harness()
    const created = await h.service.create({ cwd: h.dir, name: 'audit-tree' })
    h.sessionCwds.set('session-a', created.path)
    await h.service.bind('session-a')
    git(created.path, 'checkout', '--detach', '-q')
    await commit(created.path, 'feature.txt', 'feature\n')

    expect((await h.service.status('session-a')).branch).toBe('')
    await expect(h.service.mergePreflight({ cwd: h.dir, slug: created.slug }))
      .resolves.toMatchObject({ green: false, blockers: expect.arrayContaining(['no-source-branch']) })
    await expect(h.service.mergeExecute({ cwd: h.dir, slug: created.slug }))
      .rejects.toMatchObject({ code: 'merge-blocked' })
    await expect(h.service.updatePreflight({ cwd: h.dir, slug: created.slug }))
      .resolves.toMatchObject({ green: false, blockers: expect.arrayContaining(['no-source-branch']) })
    expect(git(h.dir, 'ls-tree', '--name-only', 'HEAD')).not.toContain('feature.txt')
  })

  it('negative control: checkout switch back to the plugin branch restores branch status', async () => {
    const h = await harness()
    const created = await h.service.create({ cwd: h.dir, name: 'audit-tree' })
    h.sessionCwds.set('session-a', created.path)
    await h.service.bind('session-a')
    git(created.path, 'checkout', '-q', '-b', 'agent-feature')
    git(created.path, 'checkout', '-q', created.branch)
    expect((await h.service.status('session-a')).branch).toBe(git(created.path, 'branch', '--show-current'))
  })
})

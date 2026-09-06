/**
 * WorktreesService against a real git repo — every merge/update execute
 * path and blocker the FakeGit suite cannot prove.
 */
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GitRunner } from '../src/host/git.ts'
import type { GitPorts } from '../src/host/git.ts'
import { RegistryStore } from '../src/host/registry-store.ts'
import { WorktreesService } from '../src/host/service.ts'
import { runSetupCommand } from '../src/host/setup-exec.ts'
import {
  commitFile,
  completeConflictedMerge,
  gitOk,
  hasMergeHead,
  makeTempRepo,
  runGit,
  writeUncommitted,
} from './git-fixture.ts'

/** Real git except `--version`, so merge-tree gating can be failed closed. */
class OldGitRunner extends GitRunner {
  override async versionStdout(): Promise<string> {
    return 'git version 2.30.1\n'
  }
}

interface Harness {
  readonly dir: string
  readonly service: WorktreesService
  readonly sessionCwds: Map<string, string | null>
  readonly running: Set<string>
  cleanup(): Promise<void>
}

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((fn) => fn()))
})

async function harness(git: GitPorts = new GitRunner()): Promise<Harness> {
  const repo = await makeTempRepo()
  const sessionCwds = new Map<string, string | null>()
  const running = new Set<string>()
  const service = new WorktreesService({
    git,
    store: new RegistryStore(),
    getSessionCwd: (id) => sessionCwds.get(id) ?? null,
    applySandboxMode: () => true,
    isSessionRunning: (id) => running.has(id),
    copyFile: async (from, to) => {
      try {
        await mkdir(dirname(to), { recursive: true })
        await copyFile(from, to)
      } catch {
        // Best-effort, same as the host entry.
      }
    },
    readText: async (path) => {
      try {
        return await readFile(path, 'utf8')
      } catch {
        return null
      }
    },
    runCommand: runSetupCommand,
    platform: process.platform,
    seed: 1,
  })
  const h: Harness = {
    dir: repo.dir,
    service,
    sessionCwds,
    running,
    cleanup: repo.cleanup,
  }
  cleanups.push(() => h.cleanup())
  return h
}

async function createBound(h: Harness, sessionId = 'session-a'): Promise<{
  slug: string
  path: string
  branch: string
}> {
  const created = await h.service.create({ cwd: h.dir })
  const cwd = created.relPath === '' ? created.path : `${created.path}/${created.relPath}`
  h.sessionCwds.set(sessionId, cwd)
  await h.service.bind(sessionId)
  return { slug: created.slug, path: created.path, branch: created.branch }
}

describe('WorktreesService real-git merge', () => {
  it('fast-forwards unique worktree commits into main', async () => {
    const h = await harness()
    const created = await createBound(h)
    await commitFile(created.path, 'feature.txt', 'from worktree\n', 'feature')
    const result = await h.service.mergeExecute({ cwd: h.dir, slug: created.slug })
    expect(result).toMatchObject({ fastForward: true, target: 'main', source: created.branch })
    expect(gitOk(h.dir, ['merge-base', '--is-ancestor', created.branch, 'HEAD'])).toBe(true)
    const pre = await h.service.mergePreflight({ cwd: h.dir, slug: created.slug })
    expect(pre.blockers).toContain('already-merged')
    expect(pre.green).toBe(false)
  })

  it('creates a merge commit when both sides have unique files', async () => {
    const h = await harness()
    const created = await createBound(h)
    await commitFile(created.path, 'wt-only.txt', 'wt\n', 'worktree unique')
    await commitFile(h.dir, 'main-only.txt', 'main\n', 'main unique')
    const pre = await h.service.mergePreflight({ cwd: h.dir, slug: created.slug })
    expect(pre.green).toBe(true)
    expect(pre.fastForward).toBe(false)
    const result = await h.service.mergeExecute({ cwd: h.dir, slug: created.slug })
    expect(result.fastForward).toBe(false)
    expect(gitOk(h.dir, ['merge-base', '--is-ancestor', created.branch, 'HEAD'])).toBe(true)
  })

  it('blocks a conflicting merge and does not touch the primary', async () => {
    const h = await harness()
    const created = await createBound(h)
    await commitFile(created.path, 'seed.txt', 'worktree\n', 'wt seed')
    await commitFile(h.dir, 'seed.txt', 'main\n', 'main seed')
    const pre = await h.service.mergePreflight({ cwd: h.dir, slug: created.slug })
    expect(pre.blockers).toContain('conflict')
    expect(pre.green).toBe(false)
    await expect(h.service.mergeExecute({ cwd: h.dir, slug: created.slug }))
      .rejects.toMatchObject({ code: 'merge-blocked' })
    expect(hasMergeHead(h.dir)).toBe(false)
    expect(runGit(h.dir, ['log', '-1', '--pretty=%s']).trim()).toBe('main seed')
  })

  it('blocks a dirty primary and a dirty worktree', async () => {
    const h = await harness()
    const created = await createBound(h)
    await commitFile(created.path, 'feature.txt', 'x\n', 'feature')
    await writeUncommitted(h.dir, 'dirty-primary.txt', 'nope\n')
    await expect(h.service.mergePreflight({ cwd: h.dir, slug: created.slug }))
      .resolves.toMatchObject({ green: false, blockers: ['dirty-primary'] })
    await unlink(join(h.dir, 'dirty-primary.txt'))
    await writeUncommitted(created.path, 'dirty-wt.txt', 'nope\n')
    await expect(h.service.mergePreflight({ cwd: h.dir, slug: created.slug }))
      .resolves.toMatchObject({ green: false, blockers: ['dirty-worktree'] })
  })
})

describe('WorktreesService real-git update', () => {
  it('fast-forwards main into a behind worktree, then already-updated', async () => {
    const h = await harness()
    const created = await createBound(h)
    await commitFile(h.dir, 'main-only.txt', 'from main\n', 'main only')
    const result = await h.service.updateExecute({ cwd: h.dir, slug: created.slug })
    expect(result).toMatchObject({
      conflict: false,
      fastForward: true,
      source: 'main',
      sessionId: 'session-a',
    })
    expect(gitOk(created.path, ['merge-base', '--is-ancestor', 'main', 'HEAD'])).toBe(true)
    await expect(h.service.updatePreflight({ cwd: h.dir, slug: created.slug }))
      .resolves.toMatchObject({ green: false, blockers: ['already-updated'] })
  })

  it('starts a conflicting update in the worktree and abort restores it', async () => {
    const h = await harness()
    const created = await createBound(h)
    await commitFile(created.path, 'seed.txt', 'worktree\n', 'wt seed')
    await commitFile(h.dir, 'seed.txt', 'main\n', 'main seed')
    const pre = await h.service.updatePreflight({ cwd: h.dir, slug: created.slug })
    expect(pre.green).toBe(true)
    expect(pre.wouldConflict).toBe(true)
    const result = await h.service.updateExecute({ cwd: h.dir, slug: created.slug })
    expect(result.conflict).toBe(true)
    expect(hasMergeHead(created.path)).toBe(true)
    expect(hasMergeHead(h.dir)).toBe(false)
    await h.service.updateAbort({ cwd: h.dir, slug: created.slug })
    expect(hasMergeHead(created.path)).toBe(false)
    expect(runGit(created.path, ['log', '-1', '--pretty=%s']).trim()).toBe('wt seed')
  })

  it('after the agent resolves the worktree merge, Merge into main is a fast-forward', async () => {
    const h = await harness()
    const created = await createBound(h)
    await commitFile(created.path, 'seed.txt', 'worktree\n', 'wt seed')
    await commitFile(h.dir, 'seed.txt', 'main\n', 'main seed')
    const started = await h.service.updateExecute({ cwd: h.dir, slug: created.slug })
    expect(started.conflict).toBe(true)
    expect(hasMergeHead(h.dir)).toBe(false)
    await completeConflictedMerge(created.path, 'seed.txt', 'resolved\n', 'resolve conflicts')
    expect(hasMergeHead(created.path)).toBe(false)
    const pre = await h.service.mergePreflight({ cwd: h.dir, slug: created.slug })
    expect(pre.green).toBe(true)
    expect(pre.fastForward).toBe(true)
    const landed = await h.service.mergeExecute({ cwd: h.dir, slug: created.slug })
    expect(landed.fastForward).toBe(true)
    expect(gitOk(h.dir, ['merge-base', '--is-ancestor', created.branch, 'HEAD'])).toBe(true)
  })

  it('blocks Merge on old git but still runs Update (no merge-tree required)', async () => {
    const h = await harness(new OldGitRunner())
    const created = await createBound(h)
    await commitFile(created.path, 'feature.txt', 'x\n', 'feature')
    await commitFile(h.dir, 'main-only.txt', 'y\n', 'main unique')
    const mergePre = await h.service.mergePreflight({ cwd: h.dir, slug: created.slug })
    expect(mergePre.blockers).toContain('old-git')
    expect(mergePre.green).toBe(false)
    await expect(h.service.mergeExecute({ cwd: h.dir, slug: created.slug }))
      .rejects.toMatchObject({ code: 'merge-blocked' })
    const updatePre = await h.service.updatePreflight({ cwd: h.dir, slug: created.slug })
    expect(updatePre.blockers).not.toContain('old-git')
    expect(updatePre.green).toBe(true)
    const updated = await h.service.updateExecute({ cwd: h.dir, slug: created.slug })
    expect(updated.conflict).toBe(false)
  })

  it('blocks dirty worktree, running session, and unbound session', async () => {
    const h = await harness()
    const created = await createBound(h)
    await commitFile(created.path, 'feature.txt', 'x\n', 'feature')
    await writeUncommitted(created.path, 'dirty-wt.txt', 'nope\n')
    let pre = await h.service.updatePreflight({ cwd: h.dir, slug: created.slug })
    expect(pre.green).toBe(false)
    expect(pre.blockers).toContain('dirty-worktree')
    await unlink(join(created.path, 'dirty-wt.txt'))
    h.running.add('session-a')
    pre = await h.service.updatePreflight({ cwd: h.dir, slug: created.slug })
    expect(pre.green).toBe(false)
    expect(pre.blockers).toContain('running-session')
    h.running.delete('session-a')
    const created2 = await h.service.create({ cwd: h.dir })
    const unbound = await h.service.updatePreflight({ cwd: h.dir, slug: created2.slug })
    expect(unbound.green).toBe(false)
    expect(unbound.blockers).toContain('no-bound-session')
  })
})

describe('WorktreesService real-git setup', () => {
  it('runs .worktrees.json commands in the new worktree', async () => {
    const h = await harness()
    await writeFile(join(h.dir, '.worktrees.json'), JSON.stringify({
      'setup-worktree': ['printf done > setup-ok'],
    }))
    const created = await h.service.create({ cwd: h.dir })
    expect(existsSync(join(created.path, 'setup-ok'))).toBe(true)
  })

  it('does not leave a worktree when setup fails', async () => {
    const h = await harness()
    await writeFile(join(h.dir, '.worktrees.json'), JSON.stringify({
      'setup-worktree': ['false'],
    }))
    await expect(h.service.create({ cwd: h.dir })).rejects.toMatchObject({
      code: 'setup-failed',
    })
    const listing = runGit(h.dir, ['worktree', 'list', '--porcelain'])
    expect(listing.split('\n').filter((line) => line.startsWith('worktree '))).toHaveLength(1)
  })
})

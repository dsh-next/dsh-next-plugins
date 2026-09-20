import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GitService } from '../src/host/git-service.ts'
import { CancellationRegistry, execGit, GitRunner } from '../src/host/git-runner.ts'
import { nodeFs } from '../src/host/fs-adapter.ts'
import { createFixture, type GitFixture, type ScenarioName } from './git-fixture.ts'

const fixtures: GitFixture[] = []
afterEach(() => { for (const fixture of fixtures.splice(0)) fixture.dispose() })
function fixture(scenario: ScenarioName = 'clean'): GitFixture {
  const value = createFixture(scenario)
  fixtures.push(value)
  return value
}
function service(repo: GitFixture, cwd = repo.dir, runner = new GitRunner(), cancellations = new CancellationRegistry()): GitService {
  return new GitService({ runner, fs: nodeFs(), cwdOf: () => cwd, platform: process.platform, env: process.env, cancellations })
}
const failure = (code: string) => ({ failure: { code } })

// The audit probes become assertions about the actual index, HEAD and filesystem.
describe('active checkout and literal filenames', () => {
  it('reads and deletes only the linked checkout, retaining primary allocation identity', async () => {
    const repo = fixture()
    const linked = repo.addWorktree('linked')
    repo.commit('same.txt', 'PRIMARY TRACKED\n', 'primary only')
    writeFileSync(join(linked, 'same.txt'), 'LINKED UNTRACKED\n')
    const git = service(repo, join(linked, 'src'))
    const identity = await git.repoFor({ sessionId: 'linked' })
    expect(identity.root).toBe(repo.dir)
    expect(identity.toplevel).toBe(linked)
    const state = (await git.state({ sessionId: 'linked' })).state
    expect(state.root).toBe(linked)
    expect(state.cwd).toBe(join(linked, 'src'))
    const diff = await git.diff({ sessionId: 'linked', path: 'same.txt', side: 'unstaged' })
    expect(diff.file?.patch).toContain('LINKED UNTRACKED')
    expect(diff.file?.patch).not.toContain('PRIMARY TRACKED')
    await git.discard({ sessionId: 'linked', paths: ['same.txt'] })
    expect(existsSync(join(linked, 'same.txt'))).toBe(false)
    expect(readFileSync(repo.path('same.txt'), 'utf8')).toBe('PRIMARY TRACKED\n')
    const added = await git.worktreeAdd({ sessionId: 'linked', name: 'from-linked' })
    expect(added.plan.path).toBe(repo.path('.worktrees/from-linked'))
    expect(added.state.root).toBe(linked)
  })

  it('diffs, stages, unstages, commits and discards root-relative paths from nested cwd', async () => {
    const repo = fixture('unstaged')
    const git = service(repo, repo.path('src'))
    const source = { sessionId: 'nested' }
    expect((await git.diff({ ...source, path: 'src/app.ts', side: 'unstaged' })).empty).toBe(false)
    await git.stage({ ...source, paths: ['src/app.ts'] })
    expect(repo.gitOk(['diff', '--cached', '--name-only']).trim()).toBe('src/app.ts')
    await git.unstage({ ...source, paths: ['src/app.ts'] })
    expect(repo.gitOk(['diff', '--cached', '--name-only']).trim()).toBe('')
    await git.stage({ ...source, paths: ['src/app.ts'] })
    await git.commit({ ...source, paths: ['src/app.ts'], message: 'nested commit' })
    repo.write('src/app.ts', 'discard this\n')
    await git.discard({ ...source, paths: ['src/app.ts'] })
    expect(repo.gitOk(['diff']).trim()).toBe('')
    repo.write('outside.txt', 'root addition\n')
    await git.commitAll({ ...source, message: 'all from nested' })
    expect(repo.gitOk(['show', 'HEAD:outside.txt'])).toBe('root addition\n')
  })

  it.each(['file[1].txt', 'star*.txt', ':(glob)*', '-option.txt'])('addresses %s literally through every file mutation', async (path) => {
    const repo = fixture()
    const git = service(repo)
    repo.write(path, 'first\n')
    repo.write('file1.txt', 'do not stage\n')
    repo.write('star-other.txt', 'do not stage\n')
    await git.stage({ cwd: repo.dir, paths: [path] })
    expect(repo.gitOk(['diff', '--cached', '--name-only', '-z']).split('\0').filter(Boolean)).toEqual([path])
    await git.unstage({ cwd: repo.dir, paths: [path] })
    expect(repo.gitOk(['diff', '--cached', '--name-only'])).toBe('')
    await git.stage({ cwd: repo.dir, paths: [path] })
    await git.commit({ cwd: repo.dir, message: 'literal file', paths: [path] })
    repo.write(path, 'changed\n')
    expect((await git.diff({ cwd: repo.dir, path, side: 'unstaged' })).file?.patch).toContain('changed')
    await git.discard({ cwd: repo.dir, paths: [path] })
    expect(readFileSync(repo.path(path), 'utf8')).toBe('first\n')
    expect(readFileSync(repo.path('file1.txt'), 'utf8')).toBe('do not stage\n')
  })

  it.each(['../outside', '/tmp/outside', '.git/config', '.', 'src/../README.md'])('rejects unsafe file address %s', async (path) => {
    const repo = fixture()
    const git = service(repo)
    await expect(git.diff({ cwd: repo.dir, path, side: 'unstaged' })).rejects.toMatchObject(failure('path-missing'))
    await expect(git.discard({ cwd: repo.dir, paths: [path] })).rejects.toMatchObject(failure('path-missing'))
    await expect(git.stage({ cwd: repo.dir, paths: [path] })).rejects.toMatchObject(failure('path-missing'))
  })
})

describe('commit transaction safety', () => {
  it('rejects conflicts before bulk add, including legacy stage then commit calls', async () => {
    const repo = fixture('merge-conflict')
    const git = service(repo)
    repo.write('new.txt', 'untracked\n')
    const beforeHead = repo.gitOk(['rev-parse', 'HEAD'])
    const beforeIndex = repo.gitOk(['ls-files', '--stage', '-z'])
    await expect(git.commitAll({ cwd: repo.dir, message: 'unsafe bulk' })).rejects.toMatchObject(failure('operation-in-progress'))
    await expect(git.stage({ cwd: repo.dir, paths: ['src/app.ts', 'new.txt'] })).rejects.toMatchObject(failure('operation-in-progress'))
    await expect(git.commit({ cwd: repo.dir, message: 'unsafe partial', paths: ['new.txt'] })).rejects.toMatchObject(failure('operation-in-progress'))
    expect(repo.gitOk(['ls-files', '--stage', '-z'])).toBe(beforeIndex)
    expect(repo.gitOk(['rev-parse', 'HEAD'])).toBe(beforeHead)
    expect(existsSync(repo.path('.git/MERGE_HEAD'))).toBe(true)
  })

  it('never commits the old index after add fails on a stale path', async () => {
    const repo = fixture('staged')
    const git = service(repo)
    repo.write('README.md', 'unstaged work\n')
    const head = repo.gitOk(['rev-parse', 'HEAD'])
    const index = repo.gitOk(['write-tree'])
    await expect(git.commitAll({ cwd: repo.dir, paths: ['src/app.ts', 'README.md', 'vanished.txt'], message: 'must not commit' })).rejects.toMatchObject(failure('path-missing'))
    expect(repo.gitOk(['rev-parse', 'HEAD'])).toBe(head)
    expect(repo.gitOk(['write-tree'])).toBe(index)
    expect(repo.gitOk(['diff'])).toContain('unstaged work')
  })

  it('restores partially staged selections after hook failure without changing files', async () => {
    const repo = fixture('hook-fail')
    const git = service(repo)
    repo.write('src/app.ts', 'unstaged version\n')
    repo.write('new.txt', 'keep untracked\n')
    const index = repo.gitOk(['write-tree'])
    const head = repo.gitOk(['rev-parse', 'HEAD'])
    await expect(git.commitAll({ cwd: repo.dir, message: 'hook rejects' })).rejects.toMatchObject(failure('hook-failed'))
    expect(repo.gitOk(['write-tree'])).toBe(index)
    expect(repo.gitOk(['rev-parse', 'HEAD'])).toBe(head)
    expect(readFileSync(repo.path('src/app.ts'), 'utf8')).toBe('unstaged version\n')
    expect(repo.gitOk(['ls-files', 'new.txt'])).toBe('')
  })

  it('restores the previous index when cancellation arrives immediately after add', async () => {
    const repo = fixture('staged')
    repo.write('README.md', 'unstaged README\n')
    const index = repo.gitOk(['write-tree'])
    const head = repo.gitOk(['rev-parse', 'HEAD'])
    const cancellations = new CancellationRegistry()
    let committed = false
    const runner = new GitRunner(async (file, args, options) => {
      const outcome = await execGit(file, args, options)
      if (args[0] === 'add' && outcome.code === 0) cancellations.cancel('bulk', 'owner')
      if (args[0] === 'commit') committed = true
      return outcome
    })
    const git = service(repo, repo.dir, runner, cancellations)
    await expect(git.commitAll({ sessionId: 'owner', requestId: 'bulk', message: 'cancel after add' })).rejects.toMatchObject(failure('hook-cancelled'))
    expect(committed).toBe(false)
    expect(repo.gitOk(['write-tree'])).toBe(index)
    expect(repo.gitOk(['rev-parse', 'HEAD'])).toBe(head)
  })

  it('does not overwrite an index changed by a failing hook', async () => {
    const repo = fixture('staged')
    const hook = join(repo.hooksDir, 'pre-commit')
    writeFileSync(hook, '#!/bin/sh\nprintf "hook edit\\n" > hook.txt\ngit add -- hook.txt\necho hook-refused >&2\nexit 1\n')
    chmodSync(hook, 0o755)
    await expect(service(repo).commitAll({ cwd: repo.dir, message: 'hook rejects' })).rejects.toMatchObject(failure('hook-failed'))
    expect(repo.gitOk(['show', ':hook.txt'])).toBe('hook edit\n')
  })

  it('commits all changes in an unborn repository and returns empty history beforehand', async () => {
    const repo = fixture('unborn')
    const git = service(repo)
    expect((await git.history({ cwd: repo.dir })).commits).toEqual([])
    repo.write('first.txt', 'first\n')
    const state = await git.commitAll({ cwd: repo.dir, message: 'first' })
    expect(state.head.unborn).toBe(false)
    expect(state.changes.staged).toEqual([])
    expect((await git.history({ cwd: repo.dir })).commits[0]?.subject).toBe('first')
  })
})

describe('session commit ownership', () => {
  it('keeps equal request ids isolated across repositories through begin and cleanup', async () => {
    const a = fixture('staged')
    const b = fixture('staged')
    let releaseA!: () => void
    let releaseB!: () => void
    let enterA!: () => void
    let enterB!: () => void
    const gateA = new Promise<void>((resolve) => { releaseA = resolve })
    const gateB = new Promise<void>((resolve) => { releaseB = resolve })
    const startedA = new Promise<void>((resolve) => { enterA = resolve })
    const startedB = new Promise<void>((resolve) => { enterB = resolve })
    const signals = new Map<string, AbortSignal>()
    const cancellations = new CancellationRegistry()
    const runner = new GitRunner(async (file, args, options) => {
      if (args[0] === 'commit') {
        signals.set(options.cwd, options.signal!)
        if (options.cwd === a.dir) { enterA(); await gateA }
        else { enterB(); await gateB }
      }
      return execGit(file, args, options)
    })
    const git = new GitService({ runner, fs: nodeFs(), cwdOf: (id) => id === 'A' ? a.dir : b.dir, platform: process.platform, env: process.env, cancellations })
    const first = git.commit({ sessionId: 'A', message: 'A commit', requestId: 'commit' })
    await startedA
    const second = git.commit({ sessionId: 'B', message: 'B commit', requestId: 'commit' })
    const cancelled = expect(second).rejects.toMatchObject(failure('hook-cancelled'))
    await startedB
    expect(signals.get(a.dir)?.aborted).toBe(false)
    expect(git.cancel('commit')).toBe(false)
    releaseA()
    await first
    expect(git.cancel('commit', 'A')).toBe(false)
    expect(git.cancel('commit', 'B')).toBe(true)
    releaseB()
    await cancelled
    expect(a.gitOk(['log', '-1', '--format=%s']).trim()).toBe('A commit')
    expect(b.gitOk(['log', '-1', '--format=%s']).trim()).toBe('feat: add app')
  })
})

describe('mutation preconditions and ref safety', () => {
  it('includes staged-only dirt in preflight and blocks history mutations', async () => {
    const repo = fixture('staged')
    const git = service(repo)
    const head = repo.gitOk(['rev-parse', 'HEAD']).trim()
    expect(await git.preflight({ cwd: repo.dir, action: 'revert' })).toMatchObject({ verdict: 'block', code: 'dirty-tree', paths: ['src/app.ts'] })
    await expect(git.revert({ cwd: repo.dir, hash: head })).rejects.toMatchObject(failure('dirty-tree'))
    await expect(git.cherryPick({ cwd: repo.dir, hash: head })).rejects.toMatchObject(failure('dirty-tree'))
    expect(repo.gitOk(['rev-parse', 'HEAD']).trim()).toBe(head)
  })

  it('blocks merges and updates on staged-only dirt in either target checkout', async () => {
    const repo = fixture('worktrees')
    const git = service(repo)
    repo.write('README.md', 'staged primary\n')
    repo.gitOk(['add', 'README.md'])
    await expect(git.worktreeMerge({ cwd: repo.dir, path: repo.path('.worktrees/ahead') })).rejects.toMatchObject(failure('dirty-tree'))
    const target = repo.path('.worktrees/ready')
    writeFileSync(join(target, 'README.md'), 'staged linked\n')
    repo.gitOk(['-C', target, 'add', 'README.md'])
    await expect(git.worktreeUpdate({ cwd: repo.dir, path: target, base: 'main' })).rejects.toMatchObject(failure('dirty-tree'))
    const upstreamRepo = fixture('ahead-behind')
    upstreamRepo.write('README.md', 'staged upstream checkout\n')
    upstreamRepo.gitOk(['add', 'README.md'])
    await expect(service(upstreamRepo).updateFromBranch({ cwd: upstreamRepo.dir })).rejects.toMatchObject(failure('dirty-tree'))
  })

  it('rejects checkout options and filenames instead of restoring or switching anything', async () => {
    const repo = fixture()
    const git = service(repo)
    await expect(git.checkoutCommit({ cwd: repo.dir, hash: '--force' })).rejects.toMatchObject(failure('invalid-name'))
    await expect(git.checkoutCommit({ cwd: repo.dir, hash: 'README.md' })).rejects.toMatchObject(failure('path-missing'))
    await expect(git.revert({ cwd: repo.dir, hash: '--abort' })).rejects.toMatchObject(failure('invalid-name'))
    await expect(git.branchDelete({ cwd: repo.dir, name: '--all', force: true })).rejects.toMatchObject(failure('invalid-name'))
    await expect(git.branchRename({ cwd: repo.dir, from: '--force', to: 'new' })).rejects.toMatchObject(failure('invalid-name'))
    await expect(git.worktreeAdd({ cwd: repo.dir, name: 'bad-base', base: '--detach' })).rejects.toMatchObject(failure('invalid-name'))
    const state = await git.checkoutCommit({ cwd: repo.dir, hash: 'main' })
    expect(state.head.detached).toBe(true)
  })

  it('queues branch mutations behind staging in the same repository without reentrant deadlocks', async () => {
    const repo = fixture('unstaged')
    let release!: () => void
    let entered!: () => void
    let secondQueued!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const started = new Promise<void>((resolve) => { entered = resolve })
    const queued = new Promise<void>((resolve) => { secondQueued = resolve })
    const writes: string[] = []
    class ObservedRunner extends GitRunner {
      count = 0
      override mutate<T>(key: string, work: () => Promise<T>): Promise<T> {
        this.count += 1
        if (this.count === 2) secondQueued()
        return super.mutate(key, work)
      }
    }
    const runner = new ObservedRunner(async (file, args, options) => {
      if (args[0] === 'add') { writes.push('add'); entered(); await gate }
      if (args[0] === 'branch') writes.push('branch')
      return execGit(file, args, options)
    })
    const git = service(repo, repo.dir, runner)
    const stage = git.stage({ cwd: repo.dir, paths: ['src/app.ts'] })
    await started
    const branch = git.branchCreate({ cwd: repo.dir, name: 'queued' })
    await queued
    expect(writes).toEqual(['add'])
    release()
    await Promise.all([stage, branch])
    expect(writes).toEqual(['add', 'branch'])
  })
})

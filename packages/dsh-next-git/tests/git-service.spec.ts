import { readFileSync, existsSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createFixture, createNonRepository, MAIN_BRANCH, type GitFixture } from './git-fixture.ts'
import { GitError, GitRunner } from '../src/host/git-runner.ts'
import { GitService } from '../src/host/git-service.ts'
import { memoryFs, nodeFs, type FsPorts } from '../src/host/fs-adapter.ts'
import type { SetupExec } from '../src/host/setup-exec.ts'

/**
 * Host contract suite: the git service driven against real repositories built
 * by the shared fixture. Every case asserts the returned envelope *and*, where
 * the operation writes, the on-disk truth read back with git — a passing
 * envelope around a no-op git call would still fail here.
 */

const disposers: (() => void)[] = []

afterEach(() => {
  while (disposers.length > 0) disposers.pop()?.()
})

/** Build a service over a fixture's repository. */
function serviceFor(
  fixture: GitFixture,
  options: { cwd?: string; fs?: FsPorts; setupExec?: SetupExec; runner?: GitRunner } = {},
): GitService {
  disposers.push(() => fixture.dispose())
  const cwd = options.cwd ?? fixture.dir
  return new GitService({
    runner: options.runner ?? new GitRunner(),
    fs: options.fs ?? nodeFs(),
    cwdOf: () => cwd,
    platform: process.platform,
    env: process.env,
    ...(options.setupExec === undefined ? {} : { setupExec: options.setupExec }),
  })
}

async function expectGitError(promise: Promise<unknown>, code: string): Promise<GitError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(GitError)
    const gitError = error as GitError
    expect(gitError.failure.code).toBe(code)
    return gitError
  }
  throw new Error(`expected a GitError with code ${code}`)
}

describe('repository resolution', () => {
  it('resolves the primary root beneath a nested working directory', async () => {
    const fixture = createFixture('clean')
    const nested = join(fixture.dir, 'src')
    const service = serviceFor(fixture, { cwd: nested })
    const repo = await service.resolveRepo(nested)
    expect(repo.root).toBe(fixture.dir)
    expect(repo.toplevel).toBe(fixture.dir)
    expect(repo.cwd).toBe(nested)
    expect(repo.gitDir).toContain('.git')
  })

  it('classifies a directory that is not a repository', async () => {
    const plain = createNonRepository()
    disposers.push(plain.dispose)
    const service = new GitService({
      runner: new GitRunner(),
      fs: nodeFs(),
      cwdOf: () => plain.dir,
      platform: process.platform,
      env: process.env,
    })
    await expectGitError(service.state({ cwd: plain.dir }), 'not-a-repository')
  })

  it('classifies a missing git binary', async () => {
    const fixture = createFixture('clean')
    const runner = new GitRunner(async () => ({ code: 127, stdout: '', stderr: 'git not found', spawnFailed: true }))
    const service = serviceFor(fixture, { runner })
    await expectGitError(service.state({ cwd: fixture.dir }), 'git-unavailable')
  })

  it('classifies a git below the required version', async () => {
    const fixture = createFixture('clean')
    const runner = new GitRunner(async (_file, args) => {
      if (args[0] === '--version') return { code: 0, stdout: 'git version 2.20.1\n', stderr: '' }
      return { code: 128, stdout: '', stderr: 'fatal: not a git repository' }
    })
    const service = serviceFor(fixture, { runner })
    await expectGitError(service.state({ cwd: fixture.dir }), 'git-too-old')
  })

  // A session the host has not loaded yet is not the same as a folder that is
  // not a repository: the panel must be able to retry instead of reporting a
  // terminal "not in a git repository" state.
  it('reports a session whose working directory is not available yet', async () => {
    const fixture = createFixture('clean')
    const service = new GitService({
      runner: new GitRunner(),
      fs: nodeFs(),
      cwdOf: () => undefined,
      platform: process.platform,
      env: process.env,
    })
    disposers.push(() => fixture.dispose())
    const error = await expectGitError(service.state({ sessionId: 'unknown' }), 'session-not-ready')
    expect(GitService.degradedFor(error)).toBeNull()
  })

  it('resolves a session again once its working directory is known', async () => {
    const fixture = createFixture('clean')
    let cwd: string | undefined
    const service = new GitService({
      runner: new GitRunner(),
      fs: nodeFs(),
      cwdOf: () => cwd,
      platform: process.platform,
      env: process.env,
    })
    disposers.push(() => fixture.dispose())
    await expectGitError(service.state({ sessionId: 'restored' }), 'session-not-ready')
    cwd = fixture.dir
    const payload = await service.state({ sessionId: 'restored' })
    expect(payload.state.root).toBe(fixture.dir)
  })
})

describe('deleted files', () => {
  // A deletion is a change like any other: the panel lists it, and the change
  // view can still show the content that was removed.
  it('lists a worktree deletion as unstaged and serves it from the index', async () => {
    const fixture = createFixture('clean')
    const service = serviceFor(fixture)
    disposers.push(() => fixture.dispose())
    const committed = fixture.gitOk(['show', 'HEAD:src/app.ts'])
    rmSync(join(fixture.dir, 'src/app.ts'))

    const state = (await service.state({ cwd: fixture.dir })).state
    expect(state.changes.unstaged.find((entry) => entry.path === 'src/app.ts')).toMatchObject({
      worktree: 'deleted',
      xy: '.D',
    })

    const view = await service.fileChanges({ cwd: fixture.dir, path: 'src/app.ts', side: 'unstaged' })
    expect(view).toMatchObject({ deleted: true, text: committed, language: 'typescript', binary: false })
    expect(view.markers.every((marker) => marker.kind === 'removed')).toBe(true)
  })

  it('lists a staged deletion as staged and serves it from the commit', async () => {
    const fixture = createFixture('clean')
    const service = serviceFor(fixture)
    disposers.push(() => fixture.dispose())
    const committed = fixture.gitOk(['show', 'HEAD:src/app.ts'])
    fixture.gitOk(['rm', '-q', '--', 'src/app.ts'])

    const state = (await service.state({ cwd: fixture.dir })).state
    expect(state.changes.staged.find((entry) => entry.path === 'src/app.ts')).toMatchObject({ index: 'deleted' })

    const view = await service.fileChanges({ cwd: fixture.dir, path: 'src/app.ts', side: 'unstaged' })
    expect(view).toMatchObject({ deleted: true, text: committed })
  })
})

describe('state contract', () => {
  it('reports a clean tree, identity and branch position', async () => {
    const fixture = createFixture('ahead-behind')
    const service = serviceFor(fixture)
    const payload = await service.state({ cwd: fixture.dir })
    expect(Object.keys(payload).sort()).toEqual(['notice', 'state'])
    expect(payload.notice).toBeNull()
    const state = payload.state
    expect(state.root).toBe(fixture.dir)
    expect(state.bare).toBe(false)
    expect(state.head.branch).toBe('main')
    expect(state.head.upstream).toBe('origin/main')
    expect(state.head.ahead).toBe(1)
    expect(state.head.behind).toBe(1)
    expect(state.head.detached).toBe(false)
    expect(state.identity).toEqual({ name: 'Fixture Author', email: 'fixture@example.com' })
    expect(state.changes.staged).toEqual([])
    expect(state.changes.untracked).toEqual([])
  })

  it('groups staged, unstaged and untracked entries', async () => {
    const fixture = createFixture('untracked')
    fixture.write('src/app.ts', 'export const app = 99\n')
    fixture.gitOk(['add', '--', 'src/app.ts'])
    fixture.write('src/other.ts', 'export const other = 1\n')
    const service = serviceFor(fixture)
    const { state } = await service.state({ cwd: fixture.dir })
    expect(state.changes.staged.map((entry) => entry.path)).toEqual(['src/app.ts'])
    expect(state.changes.unstaged).toEqual([])
    expect(state.changes.untracked.map((entry) => entry.path)).toEqual(['docs/notes.md', 'src/other.ts'])
  })

  it('counts ignored paths without listing them by default', async () => {
    const fixture = createFixture('ignored')
    const service = serviceFor(fixture)
    const plain = await service.state({ cwd: fixture.dir })
    expect(plain.state.changes.ignoredCount).toBeGreaterThan(0)
    expect(plain.state.changes.ignored).toEqual([])
    const listed = await service.state({ cwd: fixture.dir, includeIgnored: true })
    expect(listed.state.changes.ignored.map((entry) => entry.path)).toContain('ignored.txt')
    expect(listed.state.changes.ignoredTruncated).toBe(false)
  })

  it('reports an unborn repository', async () => {
    const fixture = createFixture('unborn')
    const service = serviceFor(fixture)
    const { state } = await service.state({ cwd: fixture.dir })
    expect(state.head.unborn).toBe(true)
    expect(state.head.oid).toBeNull()
    expect(state.branches).toEqual([])
  })

  it('reports a detached HEAD', async () => {
    const fixture = createFixture('detached')
    const service = serviceFor(fixture)
    const { state } = await service.state({ cwd: fixture.dir })
    expect(state.head.detached).toBe(true)
    expect(state.head.branch).toBeNull()
  })

  it('reports a conflicted merge with its unmerged files', async () => {
    const fixture = createFixture('merge-conflict')
    const service = serviceFor(fixture)
    const { state } = await service.state({ cwd: fixture.dir })
    expect(state.operation.kind).toBe('merge')
    expect(state.operation.conflicts).toEqual(['src/app.ts'])
    expect(state.changes.conflicts.map((entry) => entry.path)).toEqual(['src/app.ts'])
    expect(state.operation.message).toContain('Merge')
  })

  it('reports the rebase step and the cherry-pick state', async () => {
    const rebase = createFixture('rebase-conflict')
    const rebaseState = (await serviceFor(rebase).state({ cwd: rebase.dir })).state
    expect(rebaseState.operation.kind).toBe('rebase')
    expect(rebaseState.operation.step).toBe('1/1')

    const cherry = createFixture('cherry-pick-conflict')
    const cherryState = (await serviceFor(cherry).state({ cwd: cherry.dir })).state
    expect(cherryState.operation.kind).toBe('cherry-pick')
  })

  it('lists branches and enumerates local worktrees with host facts', async () => {
    const fixture = createFixture('worktrees')
    const service = serviceFor(fixture)
    const { state } = await service.state({ cwd: fixture.dir })
    // git lists refs alphabetically, so the managed branches come first here.
    expect(state.branches.filter((branch) => !branch.remote).map((branch) => branch.name)).toEqual([
      'dsh-git/ahead',
      'dsh-git/dirty',
      'dsh-git/merged',
      'dsh-git/ready',
      'main',
    ])
    expect(state.branches.find((branch) => branch.name === 'main')?.current).toBe(true)
    const bySlug = new Map(state.worktrees.map((worktree) => [worktree.slug, worktree]))
    expect(state.worktrees[0]!.primary).toBe(true)
    expect(bySlug.get('ready')).toMatchObject({ managed: true, clean: true, merged: true, ahead: 0 })
    expect(bySlug.get('merged')).toMatchObject({ managed: true, merged: true })
    expect(bySlug.get('dirty')).toMatchObject({ managed: true, clean: false })
    expect(bySlug.get('ahead')).toMatchObject({ managed: true, ahead: 1, merged: false })
  })
})

describe('diff contract', () => {
  it('returns an unstaged diff with exact counts and a renderable hunk', async () => {
    const fixture = createFixture('unstaged')
    const service = serviceFor(fixture)
    const result = await service.diff({ cwd: fixture.dir, path: 'src/app.ts', side: 'unstaged' })
    expect(result.empty).toBe(false)
    expect(result.file?.path).toBe('src/app.ts')
    expect(result.file?.displayPath).toBe('src/app.ts')
    expect(result.file?.added).toBe(1)
    expect(result.file?.removed).toBe(1)
    expect(result.file?.hunks.length).toBeGreaterThan(0)
    expect(result.file?.patch).toContain('@@')
  })

  it('returns the staged side separately', async () => {
    const fixture = createFixture('staged')
    const service = serviceFor(fixture)
    const staged = await service.diff({ cwd: fixture.dir, path: 'src/app.ts', side: 'staged' })
    expect(staged.empty).toBe(false)
    const unstaged = await service.diff({ cwd: fixture.dir, path: 'src/app.ts', side: 'unstaged' })
    expect(unstaged.empty).toBe(true)
    expect(unstaged.file).toBeNull()
  })

  it('synthesizes a diff for an untracked file', async () => {
    const fixture = createFixture('untracked')
    const service = serviceFor(fixture)
    const result = await service.diff({ cwd: fixture.dir, path: 'docs/notes.md', side: 'unstaged' })
    expect(result.empty).toBe(false)
    expect(result.file?.added).toBe(1)
    expect(result.file?.patch).toContain('new file mode')
    expect(result.file?.hunks[0]!.newText).toBe('notes')
  })

  it('resolves a rename when both sides are given, and degrades without the source', async () => {
    const fixture = createFixture('renamed')
    const service = serviceFor(fixture)
    // `git mv` stages the rename, so it shows on the staged side; the source
    // path has to be in the pathspec or git drops rename detection.
    const withSource = await service.diff({
      cwd: fixture.dir,
      path: 'src/main.ts',
      oldPath: 'src/app.ts',
      side: 'staged',
    })
    expect(withSource.file?.displayPath).toBe('src/app.ts -> src/main.ts')
    const withoutSource = await service.diff({ cwd: fixture.dir, path: 'src/main.ts', side: 'staged' })
    expect(withoutSource.file?.displayPath).toBe('src/main.ts')
  })

  it('reports a binary diff', async () => {
    const fixture = createFixture('binary')
    const service = serviceFor(fixture)
    const result = await service.diff({ cwd: fixture.dir, path: 'logo.bin', side: 'unstaged' })
    expect(result.file?.binary).toBe(true)
    expect(result.file?.hunks).toEqual([])
  })

  it('marks a very large diff as too large but keeps the patch', async () => {
    const fixture = createFixture('large')
    const service = serviceFor(fixture)
    const result = await service.diff({ cwd: fixture.dir, path: 'src/big.ts', side: 'unstaged' })
    expect(result.file?.tooLarge).toBe(true)
    expect(result.file?.hunks).toEqual([])
    expect(result.file?.patch.length).toBeGreaterThan(10_000)
    expect(result.file?.added).toBe(6000)
  })

  it('reports an empty diff for an unchanged path', async () => {
    const fixture = createFixture('clean')
    const service = serviceFor(fixture)
    const result = await service.diff({ cwd: fixture.dir, path: 'README.md', side: 'unstaged' })
    expect(result).toEqual({ path: 'README.md', side: 'unstaged', file: null, empty: true })
  })
})

describe('history contract', () => {
  it('returns commits newest-first with lanes', async () => {
    const fixture = createFixture('clean')
    const service = serviceFor(fixture)
    const page = await service.history({ cwd: fixture.dir, limit: 10 })
    expect(page.commits).toHaveLength(2)
    expect(page.commits[0]!.subject).toBe('feat: add app')
    expect(page.commits[1]!.subject).toBe('chore: seed')
    expect(page.commits[1]!.parents).toEqual([])
    expect(page.lanes).toHaveLength(2)
    expect(page.hasMore).toBe(false)
  })

  it('clips a page and reports more', async () => {
    const fixture = createFixture('clean')
    const service = serviceFor(fixture)
    const page = await service.history({ cwd: fixture.dir, limit: 1 })
    expect(page.commits).toHaveLength(1)
    expect(page.hasMore).toBe(true)
    const second = await service.history({ cwd: fixture.dir, limit: 1, skip: 1 })
    expect(second.commits[0]!.subject).toBe('chore: seed')
  })

  it('returns nothing for an empty repository', async () => {
    // `git log` fails with no commits; the service must not throw for a read.
    const fixture = createFixture('unborn')
    const service = serviceFor(fixture)
    expect(await service.history({ cwd: fixture.dir })).toEqual({ commits: [], lanes: [], hasMore: false })
  })
})

describe('cheap writes', () => {
  it('stages and unstages paths, and proves it on disk', async () => {
    const fixture = createFixture('untracked')
    fixture.write('src/app.ts', 'export const app = 42\n')
    const service = serviceFor(fixture)
    const staged = await service.stage({ cwd: fixture.dir, paths: ['src/app.ts'] })
    expect(staged.changes.staged.map((entry) => entry.path)).toContain('src/app.ts')
    expect(fixture.gitOk(['diff', '--cached', '--name-only'])).toContain('src/app.ts')
    const unstaged = await service.unstage({ cwd: fixture.dir, paths: ['src/app.ts'] })
    expect(unstaged.changes.staged.map((entry) => entry.path)).not.toContain('src/app.ts')
    expect(fixture.gitOk(['diff', '--cached', '--name-only'])).not.toContain('src/app.ts')
  })

  it('unstages in an unborn repository', async () => {
    const fixture = createFixture('unborn')
    fixture.write('first.txt', 'hello\n')
    const service = serviceFor(fixture)
    await service.stage({ cwd: fixture.dir, paths: ['first.txt'] })
    expect(fixture.gitOk(['diff', '--cached', '--name-only'])).toContain('first.txt')
    const state = await service.unstage({ cwd: fixture.dir, paths: ['first.txt'] })
    expect(state.changes.staged).toEqual([])
    expect(state.changes.untracked.map((entry) => entry.path)).toEqual(['first.txt'])
  })

  it('refuses a write without paths', async () => {
    const fixture = createFixture('clean')
    const service = serviceFor(fixture)
    await expectGitError(service.stage({ cwd: fixture.dir, paths: [] }), 'path-missing')
    await expectGitError(service.unstage({ cwd: fixture.dir, paths: [] }), 'path-missing')
    await expectGitError(service.discard({ cwd: fixture.dir, paths: [] }), 'path-missing')
  })

  it('commits the staged index and leaves nothing behind', async () => {
    const fixture = createFixture('staged')
    const service = serviceFor(fixture)
    const state = await service.commit({ cwd: fixture.dir, message: 'fix: raise app' })
    expect(state.changes.staged).toEqual([])
    expect(fixture.gitOk(['log', '-1', '--pretty=%s']).trim()).toBe('fix: raise app')
  })

  it('refuses an empty commit message', async () => {
    const fixture = createFixture('staged')
    const service = serviceFor(fixture)
    await expectGitError(service.commit({ cwd: fixture.dir, message: '   ' }), 'nothing-to-commit')
  })

  it('surfaces a failing hook with its output', async () => {
    const fixture = createFixture('hook-fail')
    const service = serviceFor(fixture)
    const error = await expectGitError(service.commit({ cwd: fixture.dir, message: 'feat: nope' }), 'hook-failed')
    expect(error.failure.detail).toContain('fixture pre-commit refused')
    expect(error.failure.exitCode).not.toBe(0)
    // Nothing was committed: the index still holds the change.
    expect(fixture.gitOk(['log', '-1', '--pretty=%s']).trim()).toBe('feat: add app')
  })

  it('accepts cancellation before repository discovery completes', async () => {
    const fixture = createFixture('staged')
    const cancellations = new (await import('../src/host/git-runner.ts')).CancellationRegistry()
    const service = new GitService({ runner: new GitRunner(), fs: nodeFs(), cwdOf: () => fixture.dir, platform: process.platform, env: process.env, cancellations })
    disposers.push(() => fixture.dispose())
    const before = fixture.gitOk(['rev-parse', 'HEAD'])
    const pending = service.commit({ sessionId: 's', message: 'must not commit', requestId: 'early' }).then(() => null, error => error as GitError)
    const cancelled = cancellations.cancel('early', 's')
    const outcome = await pending
    expect(cancelled).toBe(true)
    expect(outcome?.failure.code).toBe('hook-cancelled')
    expect(fixture.gitOk(['rev-parse', 'HEAD'])).toBe(before)
  })

  it('cancels a hanging hook', async () => {
    const fixture = createFixture('hook-hang')
    const cancellations = new (await import('../src/host/git-runner.ts')).CancellationRegistry()
    const service = new GitService({
      runner: new GitRunner(),
      fs: nodeFs(),
      cwdOf: () => fixture.dir,
      platform: process.platform,
      env: process.env,
      cancellations,
    })
    disposers.push(() => fixture.dispose())
    const commit = service.commit({ cwd: fixture.dir, message: 'feat: hangs', requestId: 'r1' })
    setTimeout(() => cancellations.cancel('r1'), 150)
    const error = await expectGitError(commit, 'hook-cancelled')
    expect(error.failure.code).toBe('hook-cancelled')
  })

  it('discards tracked changes and deletes untracked ones', async () => {
    const fixture = createFixture('untracked')
    fixture.write('src/app.ts', 'export const app = 7\n')
    const service = serviceFor(fixture)
    const state = await service.discard({ cwd: fixture.dir, paths: ['src/app.ts', 'docs/notes.md'] })
    expect(readFileSync(join(fixture.dir, 'src/app.ts'), 'utf8')).toBe('export const app = 1\n')
    expect(existsSync(join(fixture.dir, 'docs/notes.md'))).toBe(false)
    expect(state.changes.unstaged.filter((entry) => entry.path === 'src/app.ts')).toEqual([])
  })
})

describe('preflight through the service', () => {
  it('allows a merge on a clean tree and blocks it on a dirty one', async () => {
    const clean = createFixture('clean')
    const cleanService = serviceFor(clean)
    expect(await cleanService.preflight({ cwd: clean.dir, action: 'merge' })).toEqual({ verdict: 'allow' })

    const dirty = createFixture('unstaged')
    const dirtyService = serviceFor(dirty)
    const decision = await dirtyService.preflight({ cwd: dirty.dir, action: 'merge' })
    expect(decision).toMatchObject({ verdict: 'block', code: 'dirty-tree', paths: ['src/app.ts'] })
  })

  it('confirms a discard with the affected paths', async () => {
    const fixture = createFixture('untracked')
    const service = serviceFor(fixture)
    const decision = await service.preflight({ cwd: fixture.dir, action: 'discard' })
    expect(decision.verdict).toBe('confirm')
    expect(decision.verdict === 'confirm' ? decision.paths : []).toEqual(['docs/notes.md'])
  })

  it('blocks a branch switch mid-merge and names the operation', async () => {
    const fixture = createFixture('merge-conflict')
    const service = serviceFor(fixture)
    const decision = await service.preflight({ cwd: fixture.dir, action: 'switch-branch', target: 'main' })
    expect(decision).toMatchObject({ verdict: 'block', code: 'operation-in-progress' })
  })
})

describe('operation recovery', () => {
  it('aborts a conflicted merge and continues a resolved one', async () => {
    const aborting = createFixture('merge-conflict')
    const abortState = await serviceFor(aborting).operationAbort({ cwd: aborting.dir })
    expect(abortState.operation.kind).toBeNull()
    expect(aborting.git(['rev-parse', '-q', '--verify', 'MERGE_HEAD']).code).not.toBe(0)

    const continuing = createFixture('merge-conflict')
    writeFileSync(join(continuing.dir, 'src', 'app.ts'), 'export const app = 300\n')
    continuing.gitOk(['add', '--', 'src/app.ts'])
    const service = serviceFor(continuing)
    const state = await service.operationContinue({ cwd: continuing.dir })
    expect(state.operation.kind).toBeNull()
    expect(continuing.gitOk(['log', '-1', '--pretty=%s'])).toContain('Merge')
  })

  it('refuses continue and abort when nothing is in progress', async () => {
    const fixture = createFixture('clean')
    const service = serviceFor(fixture)
    await expectGitError(service.operationContinue({ cwd: fixture.dir }), 'operation-in-progress')
    await expectGitError(service.operationAbort({ cwd: fixture.dir }), 'operation-in-progress')
  })

  it('updates from the upstream branch', async () => {
    const fixture = createFixture('ahead-behind')
    const service = serviceFor(fixture)
    const state = await service.updateFromBranch({ cwd: fixture.dir })
    expect(state.head.behind).toBe(0)
    expect(state.head.ahead).toBeGreaterThanOrEqual(1)
    expect(existsSync(join(fixture.dir, 'src', 'remote.ts'))).toBe(true)
  })
})

describe('commit checkout', () => {
  it('checks out a commit detached', async () => {
    const fixture = createFixture('clean')
    const service = serviceFor(fixture)
    const older = fixture.gitOk(['rev-parse', 'HEAD~1']).trim()
    const state = await service.checkoutCommit({ cwd: fixture.dir, hash: older })
    expect(state.head.detached).toBe(true)
    expect(state.head.oid).toBe(older)
  })

  it('names an unknown commit as a missing path', async () => {
    const fixture = createFixture('clean')
    const service = serviceFor(fixture)
    // git reports an unknown revision as a pathspec failure.
    await expectGitError(service.checkoutCommit({ cwd: fixture.dir, hash: 'deadbeef' }), 'path-missing')
  })
})

describe('history operation engine wiring', () => {
  it('wires historyOperations through the service runner and source resolution', async () => {
    const fixture = createFixture('clean')
    const service = serviceFor(fixture)
    const head = fixture.gitOk(['rev-parse', 'HEAD']).trim()
    const preview = await service.historyOperations.preview({ sessionId: 'test-session' }, { action: 'revert', commits: [head] })
    expect(preview.binding).toMatchObject({ checkout: fixture.dir, head, headRef: `refs/heads/${MAIN_BRANCH}` })
    expect(preview.plan).toMatchObject({ action: 'revert', selected: [head], rewrites: false })
    const status = await service.historyOperations.execute({ sessionId: 'test-session' }, preview.operationId, { approved: true })
    expect(status).toMatchObject({ phase: 'completed', error: null, canRestore: true })
    expect(status.currentHead).not.toBe(head)
    // The anchor-paginated read stays bound to the live checkout.
    expect((await service.history({ sessionId: 'test-session' })).anchor).toBe(status.currentHead)
  })

  it('keeps the removed per-row revert and cherry-pick commands off the service', () => {
    const fixture = createFixture('clean')
    const service = serviceFor(fixture)
    expect('revert' in service).toBe(false)
    expect('cherryPick' in service).toBe(false)
  })
})

describe('branch operations', () => {
  it('creates, switches, renames and deletes', async () => {
    const fixture = createFixture('clean')
    const service = serviceFor(fixture)
    const created = await service.branchCreate({ cwd: fixture.dir, name: 'feature/x' })
    expect(created.branches.map((branch) => branch.name)).toContain('feature/x')
    const switched = await service.branchSwitch({ cwd: fixture.dir, name: 'feature/x' })
    expect(switched.head.branch).toBe('feature/x')
    const renamed = await service.branchRename({ cwd: fixture.dir, from: 'feature/x', to: 'feature/y' })
    expect(renamed.branches.map((branch) => branch.name)).toContain('feature/y')
    const deleted = await service.branchDelete({ cwd: fixture.dir, name: 'main', force: true })
    expect(deleted.branches.map((branch) => branch.name)).not.toContain('main')
  })

  it('switches to a remote-tracking branch by creating a local one', async () => {
    const fixture = createFixture('ahead-behind')
    // A remote branch with no local twin is the checkout candidate.
    fixture.gitOk(['update-ref', 'refs/remotes/origin/remote-only', 'HEAD'])
    const service = serviceFor(fixture)
    const candidates = await service.remoteCheckoutCandidates({ cwd: fixture.dir })
    expect(candidates.map((branch) => branch.name)).toEqual(['origin/remote-only'])
    expect(candidates[0]!.local).toBe('remote-only')
    const state = await service.branchSwitch({
      cwd: fixture.dir,
      name: 'remote-only',
      remote: 'origin/remote-only',
    })
    expect(state.head.branch).toBe('remote-only')
  })

  it('refuses an invalid name and a duplicate branch', async () => {
    const fixture = createFixture('branches')
    const service = serviceFor(fixture)
    await expectGitError(service.branchCreate({ cwd: fixture.dir, name: 'bad name' }), 'invalid-name')
    await expectGitError(service.branchCreate({ cwd: fixture.dir, name: 'alpha' }), 'branch-exists')
  })

  it('refuses to delete the current branch', async () => {
    const fixture = createFixture('clean')
    const service = serviceFor(fixture)
    // git refuses; the panel blocks this before it gets here, and the failure
    // must still be a named state rather than a raw stderr string.
    await expect(service.branchDelete({ cwd: fixture.dir, name: 'main' })).rejects.toBeInstanceOf(GitError)
  })

  it('reports unmerged branch deletion', async () => {
    const fixture = createFixture('branches')
    fixture.gitOk(['checkout', '-q', '-b', 'wip'])
    fixture.commit('src/wip.ts', 'export const wip = true\n', 'feat: wip')
    fixture.gitOk(['checkout', '-q', 'main'])
    const service = serviceFor(fixture)
    const error = await expectGitError(service.branchDelete({ cwd: fixture.dir, name: 'wip' }), 'not-merged')
    expect(error.failure.detail).toBe('wip')
  })

  it('lists local branch names and remote candidates', async () => {
    const fixture = createFixture('branches')
    const service = serviceFor(fixture)
    expect(await service.localBranchNames({ cwd: fixture.dir })).toEqual(['alpha', 'beta', 'main'])
  })
})

describe('ref summary', () => {
  it('reads the checkout position and both ref lists without the panel state', async () => {
    const fixture = createFixture('ahead-behind')
    const service = serviceFor(fixture)
    const summary = await service.refSummary({ cwd: fixture.dir })
    expect(summary.root).toBe(fixture.dir)
    expect(summary.head.branch).toBe(MAIN_BRANCH)
    expect(summary.head.oid).toBe(fixture.gitOk(['rev-parse', 'HEAD']).trim())
    expect(summary.head.detached).toBe(false)
    expect(summary.head.unborn).toBe(false)
    // Drift comes from the current branch's own row, so it costs no extra read.
    expect(summary.head.ahead).toBe(1)
    expect(summary.head.behind).toBe(1)
    expect(summary.head.upstream).toBe('origin/main')
    expect(summary.branches.map((branch) => branch.name)).toContain(MAIN_BRANCH)
    expect(summary.branches.every((branch) => branch.subject !== '')).toBe(true)
    expect(summary.tags).toEqual([])
  })

  it('names a detached HEAD and an unborn repository', async () => {
    const fixture = createFixture('clean')
    const service = serviceFor(fixture)
    const oid = fixture.gitOk(['rev-parse', 'HEAD']).trim()
    fixture.gitOk(['checkout', '-q', '--detach', oid])
    const detached = await service.refSummary({ cwd: fixture.dir })
    expect(detached.head).toMatchObject({ branch: null, oid, detached: true, unborn: false })

    const unborn = createFixture('unborn')
    const unbornService = serviceFor(unborn)
    const summary = await unbornService.refSummary({ cwd: unborn.dir })
    expect(summary.head.branch).toBe(MAIN_BRANCH)
    expect(summary.head).toMatchObject({ oid: null, detached: false, unborn: true })
  })

  it('reports a directory that is not a repository as a named failure', async () => {
    const outside = createNonRepository()
    disposers.push(outside.dispose)
    const service = new GitService({
      runner: new GitRunner(),
      fs: nodeFs(),
      cwdOf: () => outside.dir,
      platform: process.platform,
      env: process.env,
    })
    await expectGitError(service.refSummary({ cwd: outside.dir }), 'not-a-repository')
  })
})

describe('worktree lifecycle', () => {
  it('creates a worktree without running project commands or copying files', async () => {
    const fixture = createFixture('clean')
    fixture.write('.worktreeinclude', '# local files\n.env\nmissing.txt\n')
    fixture.write('.worktrees.json', JSON.stringify({ 'setup-worktree': ['echo one'] }))
    fixture.write('.env', 'SECRET=1\n')
    const ran: string[] = []
    const setupExec: SetupExec = async () => {
      ran.push('step')
      return { code: 0, output: 'ok' }
    }
    const service = serviceFor(fixture, { setupExec })
    const result = await service.worktreeAdd({ cwd: fixture.dir, name: 'My Feature' })
    expect(result.plan.slug).toBe('my-feature')
    expect(result.plan.branch).toBe('dsh-git/my-feature')
    expect(result.plan.path).toBe(join(fixture.dir, '.worktrees', 'my-feature'))
    expect(result.plan.setup).toEqual([])
    expect(result.state.worktrees.map((worktree) => worktree.slug)).toContain('my-feature')
    // The declaration is inert until it is approved, in either direction.
    expect(ran).toEqual([])
    expect(result.copied).toEqual([])
    expect(existsSync(join(result.plan.path, '.env'))).toBe(false)
    expect(existsSync(join(result.plan.path, 'missing.txt'))).toBe(false)
    expect(result.notice).toBe('setup-skipped')
    // Local-only ignore, never the committed .gitignore.
    expect(readFileSync(join(fixture.gitDir, 'info', 'exclude'), 'utf8')).toContain('.worktrees/')
    expect(existsSync(join(fixture.dir, '.gitignore'))).toBe(false)
    // The worktrees directory never shows up in the primary's status.
    expect(fixture.gitOk(['status', '--porcelain'])).not.toContain('.worktrees/')
  })

  it('previews the resolved setup and applies only the approval given', async () => {
    const fixture = createFixture('clean')
    fixture.write('.worktrees.json', JSON.stringify({ 'setup-worktree': ['echo one', 'echo two'] }))
    fixture.write('.worktreeinclude', '# comment\nmissing.txt\n.env\n')
    fixture.write('.env', 'SECRET=1\n')
    const ran: string[] = []
    const setupExec: SetupExec = async () => {
      ran.push('step')
      return { code: 0, output: 'ok' }
    }
    const service = serviceFor(fixture, { setupExec })
    const preview = await service.worktreeSetup({ cwd: fixture.dir, name: 'setup-happy' })
    expect(preview.root).toBe(fixture.dir)
    expect(preview.slug).toBe('setup-happy')
    expect(preview.path).toBe(join(fixture.dir, '.worktrees', 'setup-happy'))
    expect(preview.steps.map((step) => (step.kind === 'command' ? step.command : 'sh ' + step.path)))
      .toEqual(['echo one', 'echo two'])
    expect(preview.includePaths).toEqual(['missing.txt', '.env'])
    expect(preview.baseOid).toMatch(/^[0-9a-f]{40}$/)
    expect(preview.version).not.toBe('')
    expect(preview.notice).toBeNull()
    // A preview writes nothing.
    expect(existsSync(preview.path)).toBe(false)

    const result = await service.worktreeAdd({
      cwd: fixture.dir,
      name: 'setup-happy',
      copyApproved: true,
      expectedSetupVersion: preview.version,
    })
    expect(ran).toEqual([])
    expect(result.plan.setup).toEqual([])
    expect(result.copied).toEqual(['.env'])
    expect(existsSync(join(result.plan.path, '.env'))).toBe(true)
    expect(existsSync(join(result.plan.path, 'missing.txt'))).toBe(false)
    expect(result.setup).toEqual({ ran: 0, failed: false, output: '' })
    expect(result.notice).toBe('setup-skipped')
  })

  it('runs approved .worktrees.json setup and reports it', async () => {
    const fixture = createFixture('clean')
    fixture.write('.worktrees.json', JSON.stringify({ 'setup-worktree': ['echo one', 'echo two'] }))
    const calls: string[] = []
    const setupExec: SetupExec = async (step, cwd) => {
      calls.push(`${step.kind}:${step.kind === 'command' ? step.command : step.path}@${cwd}`)
      return { code: 0, output: 'ok' }
    }
    const service = serviceFor(fixture, { setupExec })
    const preview = await service.worktreeSetup({ cwd: fixture.dir, name: 'setup-happy' })
    const result = await service.worktreeAdd({
      cwd: fixture.dir,
      name: 'setup-happy',
      setupApproved: true,
      expectedSetupVersion: preview.version,
    })
    expect(calls).toHaveLength(2)
    expect(calls[0]).toContain('command:echo one')
    expect(result.plan.setup).toEqual(preview.steps)
    expect(result.setup).toEqual({ ran: 2, failed: false, output: 'ok' })
    expect(result.notice).toBeNull()
    expect(service.setupReportFor(result.plan.path).ran).toBe(2)
  })

  it('refuses an approval recorded against a different setup definition', async () => {
    const fixture = createFixture('clean')
    fixture.write('.worktrees.json', JSON.stringify({ 'setup-worktree': ['echo safe'] }))
    const ran: string[] = []
    const setupExec: SetupExec = async () => {
      ran.push('step')
      return { code: 0, output: 'ok' }
    }
    const service = serviceFor(fixture, { setupExec })
    const preview = await service.worktreeSetup({ cwd: fixture.dir, name: 'swap' })
    // The repository changes between the preview and the approval.
    fixture.write('.worktrees.json', JSON.stringify({ 'setup-worktree': ['echo replaced'] }))
    await expectGitError(
      service.worktreeAdd({
        cwd: fixture.dir,
        name: 'swap',
        setupApproved: true,
        expectedSetupVersion: preview.version,
      }),
      'setup-stale',
    )
    expect(ran).toEqual([])
    expect(existsSync(join(fixture.dir, '.worktrees', 'swap'))).toBe(false)
  })

  it('never overwrites or follows an included path', async () => {
    const fixture = createFixture('clean')
    const tracked = readFileSync(join(fixture.dir, 'README.md'), 'utf8')
    fixture.write('.worktreeinclude', 'README.md\nsecret-link.txt\n')
    fixture.write('README.md', 'local edit\n')
    fixture.write('.env.local', 'SECRET=1\n')
    symlinkSync(join(fixture.dir, '.env.local'), join(fixture.dir, 'secret-link.txt'))
    const service = serviceFor(fixture)
    const preview = await service.worktreeSetup({ cwd: fixture.dir, name: 'copy-guard' })
    const result = await service.worktreeAdd({
      cwd: fixture.dir,
      name: 'copy-guard',
      copyApproved: true,
      expectedSetupVersion: preview.version,
    })
    expect(result.copied).toEqual([])
    expect(readFileSync(join(result.plan.path, 'README.md'), 'utf8')).toBe(tracked)
    expect(existsSync(join(result.plan.path, 'secret-link.txt'))).toBe(false)
    expect(result.notice).toBe('copy-skipped')
  })

  it('reports a failed setup without failing the create', async () => {
    const fixture = createFixture('clean')
    fixture.write('.worktrees.json', JSON.stringify({ 'setup-worktree': ['false'] }))
    const setupExec: SetupExec = async () => ({ code: 1, output: 'boom' })
    const service = serviceFor(fixture, { setupExec })
    const preview = await service.worktreeSetup({ cwd: fixture.dir, name: 'setup-broken' })
    const result = await service.worktreeAdd({
      cwd: fixture.dir,
      name: 'setup-broken',
      setupApproved: true,
      expectedSetupVersion: preview.version,
    })
    expect(result.setup).toEqual({ ran: 1, failed: true, output: 'boom' })
    expect(result.notice).toBe('setup-failed')
    expect(existsSync(result.plan.path)).toBe(true)
  })

  it('reports invalid setup JSON without failing the create', async () => {
    const fixture = createFixture('clean')
    fixture.write('.worktrees.json', '{ not json')
    const setupExec: SetupExec = async () => ({ code: 0, output: '' })
    const service = serviceFor(fixture, { setupExec })
    const preview = await service.worktreeSetup({ cwd: fixture.dir, name: 'setup-invalid' })
    expect(preview.steps).toEqual([])
    expect(preview.notice).toBe('setup-invalid')
    const result = await service.worktreeAdd({ cwd: fixture.dir, name: 'setup-invalid' })
    expect(result.notice).toBe('setup-invalid')
    expect(result.setup.ran).toBe(0)
  })

  it('refuses a duplicate, an existing branch and an invalid name', async () => {
    const fixture = createFixture('worktrees')
    const service = serviceFor(fixture)
    await expectGitError(service.worktreeAdd({ cwd: fixture.dir, name: 'ready' }), 'worktree-exists')
    await expectGitError(service.worktreeAdd({ cwd: fixture.dir, name: '...' }), 'invalid-name')
    fixture.gitOk(['branch', 'dsh-git/taken'])
    await expectGitError(service.worktreeAdd({ cwd: fixture.dir, name: 'taken' }), 'branch-exists')
    // A directory that exists without being a worktree is refused too.
    fixture.write('.worktrees/loose/keep.txt', 'x\n')
    await expectGitError(service.worktreeAdd({ cwd: fixture.dir, name: 'loose' }), 'worktree-exists')
  })

  it('merges a worktree branch into the current branch', async () => {
    const fixture = createFixture('worktrees')
    const service = serviceFor(fixture)
    const target = join(fixture.dir, '.worktrees', 'ahead')
    const state = await service.worktreeMerge({ cwd: fixture.dir, path: target })
    expect(state.head.oid).toBe(fixture.gitOk(['rev-parse', 'dsh-git/ahead']).trim())
  })

  it('updates a worktree from the primary branch', async () => {
    const fixture = createFixture('worktrees')
    fixture.commit('src/main-only.ts', 'export const mainOnly = true\n', 'feat: main only')
    const service = serviceFor(fixture)
    const target = join(fixture.dir, '.worktrees', 'ready')
    const state = await service.worktreeUpdate({ cwd: fixture.dir, path: target })
    expect(state.operation.kind).toBeNull()
    expect(existsSync(join(target, 'src', 'main-only.ts'))).toBe(true)
  })

  it('names a conflicted worktree update instead of reporting success', async () => {
    const fixture = createFixture('worktrees')
    fixture.write(join('.worktrees', 'ready', 'src', 'app.ts'), 'export const app = 111\n')
    fixture.gitOk(['-C', join(fixture.dir, '.worktrees', 'ready'), 'commit', '-q', '-am', 'feat: worktree change'])
    fixture.commit('src/app.ts', 'export const app = 222\n', 'feat: main change')
    const service = serviceFor(fixture)
    const target = join(fixture.dir, '.worktrees', 'ready')
    // The merge happens in another working tree, so a conflict is a named
    // state naming that path, never a silent success.
    const error = await expectGitError(service.worktreeUpdate({ cwd: fixture.dir, path: target }), 'operation-in-progress')
    expect(error.failure.detail).toBe(target)
    expect(fixture.git(['-C', target, 'rev-parse', '-q', '--verify', 'MERGE_HEAD']).code).toBe(0)
  })

  it('removes a worktree, refusing a dirty one without force', async () => {
    const fixture = createFixture('worktrees')
    const service = serviceFor(fixture)
    const dirty = join(fixture.dir, '.worktrees', 'dirty')
    await expect(service.worktreeRemove({ cwd: fixture.dir, path: dirty })).rejects.toBeInstanceOf(GitError)
    const state = await service.worktreeRemove({ cwd: fixture.dir, path: dirty, force: true })
    expect(state.worktrees.map((worktree) => worktree.slug)).not.toContain('dirty')
    expect(existsSync(dirty)).toBe(false)
  })

  it('removes a clean worktree and optionally its branch', async () => {
    const fixture = createFixture('worktrees')
    const service = serviceFor(fixture)
    const ready = join(fixture.dir, '.worktrees', 'ready')
    const state = await service.worktreeRemove({ cwd: fixture.dir, path: ready, deleteBranch: true })
    expect(state.branches.map((branch) => branch.name)).not.toContain('dsh-git/ready')
  })

  it('refuses a worktree path outside the repository', async () => {
    const fixture = createFixture('clean')
    const service = serviceFor(fixture)
    await expectGitError(service.worktreeRemove({ cwd: fixture.dir, path: '/etc' }), 'path-missing')
    await expectGitError(service.worktreeMerge({ cwd: fixture.dir, path: '/etc' }), 'path-missing')
  })

  it('refuses a merge for a path that is not a managed worktree', async () => {
    const fixture = createFixture('clean')
    const service = serviceFor(fixture)
    fixture.write('src/keep.ts', 'export const keep = 1\n')
    await expectGitError(
      service.worktreeMerge({ cwd: fixture.dir, path: join(fixture.dir, 'src') }),
      'path-missing',
    )
  })


  it('measures every linked worktree against the base, not the root checkout', async () => {
    const fixture = createFixture('worktrees')
    const service = serviceFor(fixture)
    // The primary checkout moves aside; the rows must not follow it.
    fixture.gitOk(['checkout', '-q', '-b', 'side'])
    const read = await service.state({ cwd: fixture.dir })
    expect(read.state.worktreeBase.source).toBe('primary')
    expect(read.state.worktreeBase.name).toBe('side')

    const overridden = await service.state({ cwd: fixture.dir, base: MAIN_BRANCH })
    expect(overridden.state.worktreeBase).toMatchObject({ name: MAIN_BRANCH, source: 'panel' })
    expect(overridden.state.worktreeBase.candidates).toContain(MAIN_BRANCH)
    expect(overridden.state.worktrees.find((worktree) => worktree.slug === 'ahead'))
      .toMatchObject({ ahead: 1, behind: 0, merged: false })
    // A branch the base contains reads merged; the base has moved on since, so
    // the row is behind as well as merged.
    expect(overridden.state.worktrees.find((worktree) => worktree.slug === 'ready'))
      .toMatchObject({ ahead: 0, behind: 1, merged: true })
    expect(overridden.state.worktrees.find((worktree) => worktree.slug === 'merged'))
      .toMatchObject({ merged: true, ahead: 0 })
  })

  it('uses origin/HEAD as the default base when the repository has one', async () => {
    const fixture = createFixture('worktrees')
    const remote = join(fixture.scratch('remote'), 'origin.git')
    fixture.gitOk(['init', '-q', '--bare', '-b', MAIN_BRANCH, remote])
    fixture.gitOk(['remote', 'add', 'origin', remote])
    fixture.gitOk(['push', '-q', '-u', 'origin', MAIN_BRANCH])
    fixture.gitOk(['remote', 'set-head', 'origin', '-a'])
    const service = serviceFor(fixture)
    const read = await service.state({ cwd: fixture.dir })
    expect(read.state.worktreeBase.name).toBe('origin/' + MAIN_BRANCH)
    expect(read.state.worktreeBase.source).toBe('default-branch')
    expect(read.state.worktreeBase.candidates).toContain(MAIN_BRANCH)
  })

  it('merges the branch a hand-made worktree actually checks out', async () => {
    const fixture = createFixture('clean')
    fixture.gitOk(['branch', 'wk-manual'])
    const target = fixture.addWorktreeOnBranch('manual', 'wk-manual')
    // Keep the primary checkout clean for the host's enforced merge preconditions.
    fixture.write('.git/info/exclude', '.worktrees/\n')
    fixture.gitOk(['-C', target, 'commit', '-q', '--allow-empty', '-m', 'feat: manual work'])
    const service = serviceFor(fixture)
    // The old shape looked for a `dsh-git/manual` branch; the real one is `wk-manual`.
    const state = await service.worktreeMerge({ cwd: fixture.dir, path: target })
    expect(state.head.oid).toBe(fixture.gitOk(['rev-parse', 'wk-manual']).trim())
  })

  it('creates worktrees from an existing branch, a remote branch and a tag', async () => {
    const fixture = createFixture('clean')
    fixture.gitOk(['branch', 'wk-existing'])
    fixture.gitOk(['tag', 'v1.0.0'])
    const remote = join(fixture.scratch('remote'), 'origin.git')
    fixture.gitOk(['init', '-q', '--bare', '-b', MAIN_BRANCH, remote])
    fixture.gitOk(['remote', 'add', 'origin', remote])
    fixture.gitOk(['push', '-q', 'origin', MAIN_BRANCH + ':wk-remote'])
    fixture.gitOk(['fetch', '-q', 'origin'])
    const service = serviceFor(fixture)

    const existing = await service.worktreeAdd({
      cwd: fixture.dir,
      mode: 'ref',
      ref: 'wk-existing',
      refKind: 'branch',
    })
    expect(existing.plan).toMatchObject({ slug: 'wk-existing', branch: 'wk-existing' })
    expect(fixture.gitOk(['-C', existing.plan.path, 'rev-parse', '--abbrev-ref', 'HEAD']).trim()).toBe('wk-existing')

    const tracked = await service.worktreeAdd({
      cwd: fixture.dir,
      mode: 'ref',
      ref: 'origin/wk-remote',
      refKind: 'remote',
    })
    expect(tracked.plan.branch).toBe('wk-remote')
    expect(fixture.gitOk(['-C', tracked.plan.path, 'rev-parse', '--abbrev-ref', 'HEAD']).trim()).toBe('wk-remote')

    const tag = await service.worktreeAdd({ cwd: fixture.dir, mode: 'ref', ref: 'v1.0.0', refKind: 'tag' })
    expect(tag.plan.branch).toBeNull()
    expect(fixture.gitOk(['-C', tag.plan.path, 'rev-parse', '--abbrev-ref', 'HEAD']).trim()).toBe('HEAD')

    // A ref that does not exist is named, not guessed.
    await expectGitError(
      service.worktreeAdd({ cwd: fixture.dir, mode: 'ref', ref: 'nope', refKind: 'branch' }),
      'path-missing',
    )
  })

  it('refuses to remove the primary checkout or the session checkout', async () => {
    const fixture = createFixture('worktrees')
    const service = serviceFor(fixture)
    await expectGitError(service.worktreeRemove({ cwd: fixture.dir, path: fixture.dir }), 'worktree-primary')
    const ready = join(fixture.dir, '.worktrees', 'ready')
    const inWorktree = serviceFor(fixture, { cwd: ready })
    await expectGitError(inWorktree.worktreeRemove({ cwd: ready, path: ready }), 'worktree-current')
  })

  it('unlocks a locked worktree and prunes one whose folder is gone', async () => {
    const fixture = createFixture('worktrees')
    const service = serviceFor(fixture)
    const ready = join(fixture.dir, '.worktrees', 'ready')
    fixture.gitOk(['worktree', 'lock', ready])
    expect((await service.state({ cwd: fixture.dir })).state.worktrees.find((worktree) => worktree.slug === 'ready')?.locked)
      .toBe(true)
    const unlocked = await service.worktreeUnlock({ cwd: fixture.dir, path: ready })
    expect(unlocked.worktrees.find((worktree) => worktree.slug === 'ready')?.locked).toBe(false)

    rmSync(ready, { recursive: true, force: true })
    expect((await service.state({ cwd: fixture.dir })).state.worktrees.find((worktree) => worktree.slug === 'ready')?.prunable)
      .toBe(true)
    const pruned = await service.worktreePrune({ cwd: fixture.dir })
    expect(pruned.worktrees.some((worktree) => worktree.slug === 'ready')).toBe(false)
  })

  it('updates a worktree from a chosen base', async () => {
    const fixture = createFixture('worktrees')
    fixture.gitOk(['branch', 'release'])
    fixture.gitOk(['checkout', '-q', 'release'])
    fixture.commit('src/release-only.ts', 'export const releaseOnly = true\n', 'feat: release only')
    fixture.gitOk(['checkout', '-q', MAIN_BRANCH])
    const service = serviceFor(fixture)
    const target = join(fixture.dir, '.worktrees', 'ready')
    const state = await service.worktreeUpdate({ cwd: fixture.dir, path: target, base: 'release' })
    expect(state.operation.kind).toBeNull()
    expect(existsSync(join(target, 'src', 'release-only.ts'))).toBe(true)
  })
})

describe('reclaim seam', () => {
  it('claims a linked worktree and skips the primary checkout', async () => {
    const fixture = createFixture('worktrees')
    const worktree = join(fixture.dir, '.worktrees', 'ready')
    const inWorktree = new GitService({
      runner: new GitRunner(),
      fs: nodeFs(),
      cwdOf: (sessionId) => (sessionId === 'child' ? worktree : fixture.dir),
      platform: process.platform,
      env: process.env,
    })
    disposers.push(() => fixture.dispose())
    expect(await inWorktree.reclaim('parent', 'child')).toEqual({
      claimed: true,
      reason: 'reclaimed',
      path: worktree,
      branch: 'dsh-git/ready',
    })
    expect(await inWorktree.reclaim('parent', 'primary')).toEqual({
      claimed: false,
      reason: 'not-a-worktree',
      path: null,
      branch: null,
    })
    expect(await inWorktree.reclaim('parent', 'unknown')).toEqual({
      claimed: false,
      reason: 'not-a-worktree',
      path: null,
      branch: null,
    })
  })

  it('skips a session whose cwd is not a repository', async () => {
    const plain = createNonRepository()
    disposers.push(plain.dispose)
    const service = new GitService({
      runner: new GitRunner(),
      fs: nodeFs(),
      cwdOf: () => plain.dir,
      platform: process.platform,
      env: process.env,
    })
    expect(await service.reclaim('a', 'b')).toMatchObject({ claimed: false, reason: 'not-a-worktree' })
  })
})

describe('agent payload support', () => {
  it('drafts a message from the staged change list', async () => {
    const fixture = createFixture('staged')
    const service = serviceFor(fixture)
    expect(await service.draftMessage({ cwd: fixture.dir })).toBe('Update src: app.ts')
  })

  it('collects changed files with their patches', async () => {
    const fixture = createFixture('untracked')
    fixture.write('src/app.ts', 'export const app = 5\n')
    fixture.gitOk(['add', '--', 'src/app.ts'])
    const service = serviceFor(fixture)
    const result = await service.agentFiles({ cwd: fixture.dir })
    const paths = result.files.map((file) => file.path)
    expect(paths).toContain('src/app.ts')
    expect(paths).toContain('docs/notes.md')
    const staged = result.files.find((file) => file.path === 'src/app.ts')
    expect(staged?.staged).toBe(true)
    expect(staged?.patch).toContain('@@')
    const untracked = result.files.find((file) => file.path === 'docs/notes.md')
    expect(untracked?.staged).toBe(false)
    expect(untracked?.added).toBe(1)
  })

  it('honors an explicit path list', async () => {
    const fixture = createFixture('untracked')
    const service = serviceFor(fixture)
    const result = await service.agentFiles({ cwd: fixture.dir, paths: ['docs/notes.md'] })
    expect(result.files.map((file) => file.path)).toEqual(['docs/notes.md'])
  })
})

describe('filesystem port injection', () => {
  it('reads operation markers through the injected port', async () => {
    const fixture = createFixture('clean')
    const fs = memoryFs({
      [join(fixture.gitDir, 'MERGE_HEAD')]: 'abc\n',
      [join(fixture.gitDir, 'MERGE_MSG')]: 'Merge branch other\n',
    })
    const service = serviceFor(fixture, { fs })
    const state = await (await service.state({ cwd: fixture.dir })).state
    // The status has no unmerged entries, but MERGE_HEAD alone is enough to
    // report the operation.
    expect(state.operation.kind).toBe('merge')
    expect(state.operation.message).toBe('Merge branch other')
  })
})

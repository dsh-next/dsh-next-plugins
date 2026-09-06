import { describe, expect, it } from 'vitest'
import { GitError, GitRunner, type GitResult } from '../src/host/git.ts'
import { commitFile, makeTempRepo, runGit } from './git-fixture.ts'

function runner(
  handler: (args: readonly string[], cwd: string) => Partial<GitResult>,
): GitRunner {
  return new GitRunner(async (_file, args, options) => ({
    code: 0,
    stdout: '',
    stderr: '',
    ...handler(args, options.cwd),
  }))
}

describe('GitRunner.dirtyCount', () => {
  it('ignores the plugin sidecar, including quoted porcelain paths', async () => {
    const git = runner(() => ({
      stdout: [
        '?? .dsh',
        '?? .dsh/worktrees/registry.json',
        '?? ".dsh/quoted"',
        ' M src/index.ts',
        '',
      ].join('\n'),
    }))
    await expect(git.dirtyCount('/repos/wt-repo')).resolves.toBe(1)
    await expect(git.dirtyPaths('/repos/wt-repo')).resolves.toEqual(['src/index.ts'])
  })

  it('throws when git status fails instead of reporting clean', async () => {
    const git = runner(() => ({ code: 128, stderr: 'unable to read index' }))
    await expect(git.dirtyCount('/repos/wt-repo')).rejects.toMatchObject({
      code: 'git-failed',
    })
  })
})

describe('GitRunner.listWorktrees', () => {
  it('parses porcelain on success', async () => {
    const git = runner(() => ({
      stdout: [
        'worktree /repos/wt-repo',
        'HEAD abc',
        'branch refs/heads/main',
        '',
      ].join('\n'),
    }))
    await expect(git.listWorktrees('/repos/wt-repo')).resolves.toEqual([
      { path: '/repos/wt-repo', head: 'abc', branch: 'main' },
    ])
  })

  it('throws when git worktree list fails instead of returning empty', async () => {
    const git = runner(() => ({ code: 128, stderr: 'index.lock' }))
    await expect(git.listWorktrees('/repos/wt-repo')).rejects.toMatchObject({
      code: 'git-failed',
    })
  })
})

describe('GitRunner.placement', () => {
  it('reports git-unavailable when git is missing', async () => {
    const git = runner(() => ({ code: 127, stderr: 'git not found' }))
    await expect(git.placement('/repos/wt-repo')).rejects.toBeInstanceOf(GitError)
    await expect(git.placement('/repos/wt-repo')).rejects.toMatchObject({
      code: 'git-unavailable',
    })
  })

  it('reports not-a-repository on git exit 128', async () => {
    const git = runner(() => ({ code: 128, stderr: 'fatal: not a git repository' }))
    await expect(git.placement('/repos/plain')).rejects.toMatchObject({
      code: 'not-a-repository',
    })
  })
})

describe('GitRunner.addWorktree', () => {
  it('enables parallel checkout on git worktree add', async () => {
    const calls: string[][] = []
    const git = runner((args) => {
      calls.push([...args])
      if (args.includes('rev-parse')) return { code: 1 }
      return { code: 0 }
    })
    await git.addWorktree({
      primary: '/repos/wt-repo',
      path: '/repos/wt-repo/.dsh/worktrees/swift-01',
      branch: 'dsh-worktrees/swift-01',
      baseRef: 'HEAD',
    })
    expect(calls.some((args) =>
      args[0] === '-c'
      && args[1] === 'checkout.workers=0'
      && args[2] === 'worktree'
      && args[3] === 'add',
    )).toBe(true)
  })
})

describe('GitRunner.mergeAllowConflicts (mocked)', () => {
  it('returns clean on exit 0', async () => {
    const git = runner((args) => {
      if (args[0] === 'merge') return { code: 0 }
      return { code: 1 }
    })
    await expect(git.mergeAllowConflicts('/r', 'main')).resolves.toBe('clean')
  })

  it('returns conflict when MERGE_HEAD remains after a failed merge', async () => {
    const git = runner((args) => {
      if (args[0] === 'merge' && args[1] === '--no-edit') return { code: 1, stderr: 'conflict' }
      if (args[0] === 'rev-parse' && args.includes('MERGE_HEAD')) return { code: 0, stdout: 'abc\n' }
      return { code: 1 }
    })
    await expect(git.mergeAllowConflicts('/r', 'main')).resolves.toBe('conflict')
  })

  it('throws when the merge fails without MERGE_HEAD', async () => {
    const git = runner((args) => {
      if (args[0] === 'merge') return { code: 1, stderr: 'index.lock' }
      return { code: 1 }
    })
    await expect(git.mergeAllowConflicts('/r', 'main')).rejects.toMatchObject({
      code: 'merge-blocked',
    })
  })
})

describe('GitRunner merging / abort against a real repo', () => {
  it('reports merging, then abort restores a clean tree', async () => {
    const { dir, cleanup } = await makeTempRepo()
    try {
      runGit(dir, ['checkout', '-q', '-b', 'feature'])
      await commitFile(dir, 'seed.txt', 'feature\n', 'feature')
      runGit(dir, ['checkout', '-q', 'main'])
      await commitFile(dir, 'seed.txt', 'main\n', 'main')
      const runner = new GitRunner()
      await expect(runner.merging(dir)).resolves.toBe(false)
      await expect(runner.mergeAllowConflicts(dir, 'feature')).resolves.toBe('conflict')
      await expect(runner.merging(dir)).resolves.toBe(true)
      await runner.mergeAbort(dir)
      await expect(runner.merging(dir)).resolves.toBe(false)
      await expect(runner.dirtyCount(dir)).resolves.toBe(0)
    } finally {
      await cleanup()
    }
  })

  it('returns clean for a fast-forward update', async () => {
    const { dir, cleanup } = await makeTempRepo()
    try {
      runGit(dir, ['checkout', '-q', '-b', 'feature'])
      runGit(dir, ['checkout', '-q', 'main'])
      await commitFile(dir, 'extra.txt', 'extra\n', 'main ahead')
      runGit(dir, ['checkout', '-q', 'feature'])
      const runner = new GitRunner()
      await expect(runner.mergeAllowConflicts(dir, 'main')).resolves.toBe('clean')
      await expect(runner.merging(dir)).resolves.toBe(false)
    } finally {
      await cleanup()
    }
  })
})

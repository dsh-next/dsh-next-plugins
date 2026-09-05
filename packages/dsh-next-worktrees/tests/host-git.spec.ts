import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GitError, GitRunner, type GitResult } from '../src/host/git.ts'

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
  const dirs: string[] = []
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  async function repo(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-wt-git-'))
    dirs.push(dir)
    const git = (args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
    git(['init', '-q', '-b', 'main'])
    git(['config', 'user.email', 'test@example.com'])
    git(['config', 'user.name', 'test'])
    await writeFile(join(dir, 'file.txt'), 'base\n')
    git(['add', 'file.txt'])
    git(['commit', '-q', '-m', 'base'])
    return dir
  }

  it('reports merging, then abort restores a clean tree', async () => {
    const dir = await repo()
    const gitCmd = (args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
    gitCmd(['checkout', '-q', '-b', 'feature'])
    await writeFile(join(dir, 'file.txt'), 'feature\n')
    gitCmd(['add', 'file.txt'])
    gitCmd(['commit', '-q', '-m', 'feature'])
    gitCmd(['checkout', '-q', 'main'])
    await writeFile(join(dir, 'file.txt'), 'main\n')
    gitCmd(['add', 'file.txt'])
    gitCmd(['commit', '-q', '-m', 'main'])
    const runner = new GitRunner()
    await expect(runner.merging(dir)).resolves.toBe(false)
    await expect(runner.mergeAllowConflicts(dir, 'feature')).resolves.toBe('conflict')
    await expect(runner.merging(dir)).resolves.toBe(true)
    await runner.mergeAbort(dir)
    await expect(runner.merging(dir)).resolves.toBe(false)
    await expect(runner.dirtyCount(dir)).resolves.toBe(0)
  })

  it('returns clean for a fast-forward update', async () => {
    const dir = await repo()
    const gitCmd = (args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
    gitCmd(['checkout', '-q', '-b', 'feature'])
    gitCmd(['checkout', '-q', 'main'])
    await writeFile(join(dir, 'extra.txt'), 'extra\n')
    gitCmd(['add', 'extra.txt'])
    gitCmd(['commit', '-q', '-m', 'main ahead'])
    gitCmd(['checkout', '-q', 'feature'])
    const runner = new GitRunner()
    await expect(runner.mergeAllowConflicts(dir, 'main')).resolves.toBe('clean')
    await expect(runner.merging(dir)).resolves.toBe(false)
  })
})

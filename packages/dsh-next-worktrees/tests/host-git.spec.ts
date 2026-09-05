import { describe, expect, it } from 'vitest'
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

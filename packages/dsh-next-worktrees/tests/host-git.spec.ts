// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GitError, GitRunner } from '../src/host/git.ts'

let root: string
let repo: string

function git(args: string[], cwd: string): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' })
}

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-next-worktrees-git-')))
  repo = join(root, 'repo')
  mkdirSync(repo)
  git(['init', '-q', '-b', 'main'], repo)
  git(['config', 'user.email', 'test@example.com'], repo)
  git(['config', 'user.name', 'Test'], repo)
  writeFileSync(join(repo, 'base.txt'), 'base\n')
  git(['add', '.'], repo)
  git(['commit', '-qm', 'base'], repo)
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('GitRunner against a real repository', () => {
  it('reports git available', async () => {
    expect(await new GitRunner().available()).toBe(true)
  })

  it('resolves facts with the repo as primary', async () => {
    const facts = await new GitRunner().facts(repo)
    expect(facts.toplevel).toBe(repo)
    expect(facts.gitCommonDir).toBe(`${repo}/.git`)
    expect(facts.placement).toEqual({ primaryRoot: repo, isLinkedWorktree: false })
  })

  it('resolves facts from inside a linked worktree (same primary)', async () => {
    const runner = new GitRunner()
    const path = join(repo, '.dsh/worktrees/linked-01')
    await runner.createWorktree({ primaryRoot: repo, path, branch: 'dsh-worktrees/linked-01', baseRef: 'HEAD' })
    const facts = await runner.facts(path)
    expect(facts.placement).toEqual({ primaryRoot: repo, isLinkedWorktree: true })
  })

  it('throws not-a-repository outside a repo', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'dsh-next-worktrees-out-'))
    try {
      await expect(new GitRunner().facts(outside)).rejects.toMatchObject({ code: 'not-a-repository' })
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('falls back to local HEAD as the base ref', async () => {
    expect(await new GitRunner().resolveBaseRef(repo)).toBe('HEAD')
  })

  it('maps creation collisions to typed errors', async () => {
    const runner = new GitRunner()
    const path = join(repo, '.dsh/worktrees/dup-01')
    await runner.createWorktree({ primaryRoot: repo, path, branch: 'dsh-worktrees/dup-01', baseRef: 'HEAD' })
    await expect(runner.createWorktree({
      primaryRoot: repo, path, branch: 'dsh-worktrees/dup-01', baseRef: 'HEAD',
    })).rejects.toMatchObject({ code: 'branch-exists' })
  })

  it('lists worktrees including linked ones', async () => {
    const paths = await new GitRunner().listWorktrees(repo)
    expect(paths).toContain(repo)
    expect(paths.some((p) => p.startsWith(`${repo}/.dsh/worktrees/`))).toBe(true)
  })

  it('counts ahead commits and reads dirtiness', async () => {
    const runner = new GitRunner()
    const path = join(repo, '.dsh/worktrees/ahead-01')
    await runner.createWorktree({ primaryRoot: repo, path, branch: 'dsh-worktrees/ahead-01', baseRef: 'HEAD' })
    expect(await runner.aheadCount(repo, 'HEAD', 'dsh-worktrees/ahead-01')).toBe(0)
    expect(await runner.dirty(path)).toBe(false)
    writeFileSync(join(path, 'note.txt'), 'note\n')
    expect(await runner.dirty(path)).toBe(true)
    git(['add', '.'], path)
    git(['commit', '-qm', 'one'], path)
    expect(await runner.aheadCount(repo, 'HEAD', 'dsh-worktrees/ahead-01')).toBe(1)
    expect(await runner.dirty(path)).toBe(false)
  })

  it('refuses dirty removal and forces after confirmation', async () => {
    const runner = new GitRunner()
    const path = join(repo, '.dsh/worktrees/dirty-01')
    await runner.createWorktree({ primaryRoot: repo, path, branch: 'dsh-worktrees/dirty-01', baseRef: 'HEAD' })
    writeFileSync(join(path, 'uncommitted.txt'), 'x\n')
    await expect(runner.removeWorktree({ primaryRoot: repo, path, force: false }))
      .rejects.toMatchObject({ code: 'dirty-remove-refused' })
    await runner.removeWorktree({ primaryRoot: repo, path, force: true })
    const paths = await runner.listWorktrees(repo)
    expect(paths).not.toContain(path)
  })

  it('detects gitignore coverage of the worktree dir', async () => {
    const runner = new GitRunner()
    expect(await runner.dirIgnored(repo, '.dsh/worktrees')).toBe(false)
    writeFileSync(join(repo, '.gitignore'), '.dsh/\n')
    expect(await runner.dirIgnored(repo, '.dsh/worktrees')).toBe(true)
  })

  it('reads .worktreeinclude entries and tolerates absence', async () => {
    const runner = new GitRunner()
    expect(await runner.worktreeInclude(repo)).toEqual([])
    writeFileSync(join(repo, '.worktreeinclude'), '# comment\n.env\nnode_modules/.cache\n')
    expect(await runner.worktreeInclude(repo)).toEqual(['.env', 'node_modules/.cache'])
  })

  it('wraps non-git failures as GitError', () => {
    const failing = new GitRunner(async () => ({ code: 1, stdout: '', stderr: 'boom' }))
    expect(failing.listWorktrees(repo)).rejects.toMatchObject({ code: "git-failed" })
  })
})

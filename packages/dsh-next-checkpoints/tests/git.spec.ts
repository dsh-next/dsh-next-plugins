import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { GitRunner, parseStatusPorcelainZ, type GitResult } from '../src/host/git.ts'

describe('parseStatusPorcelainZ', () => {
  it('keeps the new path of a rename and does not slice the old path', () => {
    expect(parseStatusPorcelainZ('R  new name.txt\0old name.txt\0')).toEqual(['new name.txt'])
  })

  it('parses ordinary, deleted, and untracked records', () => {
    expect(parseStatusPorcelainZ(' M src/a.ts\0 D gone.txt\0?? extra.txt\0')).toEqual([
      'src/a.ts',
      'gone.txt',
      'extra.txt',
    ])
  })

  it('skips a copy\'s extra field', () => {
    expect(parseStatusPorcelainZ('C  dest.ts\0src.ts\0')).toEqual(['dest.ts'])
  })
})

describe('GitRunner', () => {
  function runner(handler: (args: readonly string[]) => Partial<GitResult>): GitRunner {
    return new GitRunner(async (_file, args) => ({
      code: 0,
      stdout: '',
      stderr: '',
      ...handler(args),
    }))
  }

  it('returns null HEAD when rev-parse fails', async () => {
    const git = runner(() => ({ code: 128, stderr: 'not a git repository' }))
    expect(await git.head('/plain')).toBeNull()
  })

  it('returns empty name lists when git fails', async () => {
    const git = runner(() => ({ code: 128 }))
    expect(await git.statusNames('/plain')).toEqual([])
  })
})

describe('GitRunner against a real repo', () => {
  it('reads HEAD, status names, and blob bytes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-next-checkpoints-git-'))
    try {
      execFileSync('git', ['init', '-q'], { cwd: dir })
      execFileSync('git', ['config', 'user.email', 't@t.t'], { cwd: dir })
      execFileSync('git', ['config', 'user.name', 't'], { cwd: dir })
      await writeFile(join(dir, 'seed.txt'), 'seed\n')
      execFileSync('git', ['add', 'seed.txt'], { cwd: dir })
      execFileSync('git', ['commit', '-q', '-m', 'seed'], { cwd: dir })
      const git = new GitRunner()
      const head = await git.head(dir)
      expect(head?.sha).toMatch(/^[0-9a-f]{40}$/)
      expect(head?.branch).not.toBeNull()
      await writeFile(join(dir, 'seed.txt'), 'changed\n')
      await writeFile(join(dir, 'extra.txt'), 'extra\n')
      expect(await git.statusNames(dir)).toContain('seed.txt')
      await rm(join(dir, 'seed.txt'))
      expect(await git.statusNames(dir)).toEqual(expect.arrayContaining(['seed.txt', 'extra.txt']))
      const shown = await git.show(dir, head!.sha, 'seed.txt')
      expect(new TextDecoder().decode(shown!)).toBe('seed\n')
      expect(await git.show(dir, head!.sha, 'missing.txt')).toBeNull()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

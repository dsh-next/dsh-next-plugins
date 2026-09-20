import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, symlink, rm, readlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readWorktreeText } from '../src/host/worktree-read.ts'
import { nodeFs, memoryFs } from '../src/host/fs-adapter.ts'
import { createFixture, type GitFixture } from './git-fixture.ts'
import { GitService } from '../src/host/git-service.ts'
import { GitRunner } from '../src/host/git-runner.ts'

const roots: string[] = [], fixtures: GitFixture[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); fixtures.splice(0).forEach(f => f.dispose()) })
async function root() { const value = await mkdtemp(join(tmpdir(), 'git-safe-read-')); roots.push(value); return value }

describe('bounded no-follow checkout reads', () => {
  it('reads ordinary UTF-8 without following symlink targets or parents', async () => {
    const base = await root(), outside = await root()
    await writeFile(join(outside, 'secret'), 'OUTSIDE_SECRET_BYTES')
    await writeFile(join(base, 'plain'), 'normal')
    await symlink(join(outside, 'secret'), join(base, 'link'))
    await symlink(outside, join(base, 'parent'))
    expect(await readWorktreeText(base, 'plain')).toEqual({ kind: 'text', text: 'normal' })
    expect(await readWorktreeText(base, 'link')).toEqual({ kind: 'symlink', text: await readlink(join(base, 'link')) })
    expect(await readWorktreeText(base, 'parent/secret')).toBeNull()
    expect(await readWorktreeText(base, '../secret')).toBeNull()
    expect(await readWorktreeText(base, '.git/config')).toBeNull()
    expect(await readWorktreeText(base, join(outside, 'secret'))).toBeNull()
  })

  it('bounds data and distinguishes binary, invalid text, directories and missing paths', async () => {
    const base = await root()
    await writeFile(join(base, 'large'), 'x'.repeat(128))
    await writeFile(join(base, 'binary'), Buffer.from([0, 1]))
    await writeFile(join(base, 'invalid'), Buffer.from([255, 128]))
    await mkdir(join(base, 'folder'))
    expect(await readWorktreeText(base, 'large', 64)).toEqual({ kind: 'oversize', text: '' })
    expect((await readWorktreeText(base, 'binary'))?.kind).toBe('binary')
    expect((await readWorktreeText(base, 'invalid'))?.kind).toBe('binary')
    expect(await readWorktreeText(base, 'folder')).toBeNull()
    expect(await readWorktreeText(base, 'missing')).toBeNull()
  })

  it('never includes an outside secret in untracked diff or AI context', async () => {
    const f = createFixture('clean'); fixtures.push(f)
    const outside = await root()
    await writeFile(join(outside, 'secret'), 'OUTSIDE_SECRET_BYTES')
    await symlink(join(outside, 'secret'), f.path('link'))
    const service = new GitService({ runner: new GitRunner(), fs: nodeFs(), cwdOf: () => f.dir, platform: process.platform, env: process.env })
    const diff = await service.diff({ sessionId: 's', path: 'link', side: 'unstaged' })
    expect(diff.file?.patch).toContain('new file mode 120000')
    expect(diff.file?.patch).not.toContain('OUTSIDE_SECRET_BYTES')
    expect(JSON.stringify(await service.agentFiles({ sessionId: 's', verb: 'review' }))).not.toContain('OUTSIDE_SECRET_BYTES')
    await writeFile(f.path('oversize'), 'x'.repeat(2 * 1024 * 1024 + 1))
    expect((await service.diff({ sessionId: 's', path: 'oversize', side: 'unstaged' })).file).toMatchObject({ byteLimited: true, tooLarge: true })
    expect((await service.agentFiles({ sessionId: 's', verb: 'review' })).omittedPaths).toContain('oversize')
  })

  it('provides the same bounded contract in the filesystem test adapter', async () => {
    const fs = memoryFs({ '/root/file': 'text', '/root/binary': 'a\0b', '/root/large': 'x'.repeat(2 * 1024 * 1024 + 1) })
    expect(await fs.readWorktree('/root', 'file')).toEqual({ kind: 'text', text: 'text' })
    expect(await fs.readWorktree('/root', 'missing')).toBeNull()
    expect((await fs.readWorktree('/root', 'binary'))?.kind).toBe('binary')
    expect((await fs.readWorktree('/root', 'large'))?.kind).toBe('oversize')
  })
})

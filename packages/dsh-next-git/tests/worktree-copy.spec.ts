import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it, vi } from 'vitest'
import { chmod, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, symlink, writeFile, type FileHandle } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { copyWorktreeFile } from '../src/host/worktree-copy.ts'

const LIMIT = 32 * 1024 * 1024

describe('copyWorktreeFile (real filesystem)', () => {
  let root: string
  let source: string
  let target: string
  let sibling: string

  beforeEach(async () => {
    // macOS exposes the OS temp directory through a symlink; use its real root.
    root = await mkdtemp(join(await realpath(tmpdir()), 'worktree-copy-'))
    source = join(root, 'source')
    target = join(root, 'target')
    sibling = join(root, 'sibling')
    await Promise.all([source, target, sibling].map(path => mkdir(path)))
    await writeFile(join(sibling, 'secret'), 'sibling secret')
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    try {
      const names = await readdir(root, { recursive: true })
      assert.equal(names.some(name => name.includes('.dsh-worktree-copy-')), false, 'no owned temporary files remain')
      assert.equal(await readFile(join(sibling, 'secret'), 'utf8'), 'sibling secret')
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('copies ordinary nested files and preserves executable/read-only permissions', async () => {
    await mkdir(join(source, 'nested'))
    await writeFile(join(source, 'nested', 'run'), '#!/bin/sh\necho hello\n')
    await chmod(join(source, 'nested', 'run'), 0o551)
    assert.equal(await copyWorktreeFile(source, 'nested/run', target), true)
    assert.equal(await readFile(join(target, 'nested', 'run'), 'utf8'), '#!/bin/sh\necho hello\n')
    assert.equal((await lstat(join(target, 'nested', 'run'))).mode & 0o7777, 0o551)
    assert.notEqual((await lstat(join(target, 'nested', 'run'))).ino, (await lstat(join(source, 'nested', 'run'))).ino)
  })

  it('copies binary bytes and empty files without text conversion', async () => {
    for (const [name, bytes] of [['binary', Buffer.from([0, 255, 128, 10, 13])], ['empty', Buffer.alloc(0)]] as const) {
      await writeFile(join(source, name), bytes)
      assert.equal(await copyWorktreeFile(source, name, target), true)
      assert.deepEqual(await readFile(join(target, name)), bytes)
    }
  })

  it('never changes an existing target file, regardless of tracked status', async () => {
    await writeFile(join(source, 'file'), 'replacement')
    await writeFile(join(target, 'file'), 'tracked or untracked original')
    await chmod(join(target, 'file'), 0o640)
    const before = await lstat(join(target, 'file'))
    assert.equal(await copyWorktreeFile(source, 'file', target), false)
    assert.equal(await readFile(join(target, 'file'), 'utf8'), 'tracked or untracked original')
    const after = await lstat(join(target, 'file'))
    assert.equal(after.ino, before.ino)
    assert.equal(after.mode, before.mode)
    assert.equal(after.mtimeMs, before.mtimeMs)
  })

  it('allows exactly one concurrent installation without leftover temporaries', async () => {
    await writeFile(join(source, 'file'), Buffer.alloc(256 * 1024, 0xa5))
    const results = await Promise.all(Array.from({ length: 8 }, () => copyWorktreeFile(source, 'file', target)))
    assert.equal(results.filter(Boolean).length, 1)
    assert.deepEqual(await readFile(join(target, 'file')), await readFile(join(source, 'file')))
  })

  it('does not read a source leaf symlink to a sibling secret', async () => {
    await symlink(join(sibling, 'secret'), join(source, 'secret'))
    assert.equal(await copyWorktreeFile(source, 'secret', target), false)
    assert.deepEqual(await readdir(target), [])
  })

  it('rejects source symlink ancestors and source symlink roots', async () => {
    await symlink(sibling, join(source, 'nested'))
    assert.equal(await copyWorktreeFile(source, 'nested/secret', target), false)
    const alias = join(root, 'source-alias')
    await symlink(sibling, alias)
    assert.equal(await copyWorktreeFile(alias, 'secret', target), false)
    assert.deepEqual(await readdir(target), [])
  })

  it('does not replace target leaf symlinks, including dangling symlinks', async () => {
    await writeFile(join(source, 'secret'), 'replacement')
    await symlink(join(sibling, 'secret'), join(target, 'secret'))
    assert.equal(await copyWorktreeFile(source, 'secret', target), false)
    assert.equal((await lstat(join(target, 'secret'))).isSymbolicLink(), true)
    await writeFile(join(source, 'dangling'), 'replacement')
    await symlink(join(sibling, 'absent'), join(target, 'dangling'))
    assert.equal(await copyWorktreeFile(source, 'dangling', target), false)
    assert.equal((await lstat(join(target, 'dangling'))).isSymbolicLink(), true)
    await assert.rejects(lstat(join(sibling, 'absent')), { code: 'ENOENT' })
  })

  it('never creates files or directories through target ancestor/root symlinks', async () => {
    await mkdir(join(source, 'nested', 'new'), { recursive: true })
    await writeFile(join(source, 'nested', 'secret'), 'replacement')
    await writeFile(join(source, 'nested', 'new', 'file'), 'replacement')
    await symlink(sibling, join(target, 'nested'))
    assert.equal(await copyWorktreeFile(source, 'nested/secret', target), false)
    assert.equal(await copyWorktreeFile(source, 'nested/new/file', target), false)
    assert.deepEqual(await readdir(sibling), ['secret'])
    await writeFile(join(source, 'secret'), 'replacement')
    const alias = join(root, 'target-alias')
    await symlink(sibling, alias)
    assert.equal(await copyWorktreeFile(source, 'secret', alias), false)
  })

  it('rejects metadata, absolute, traversal and platform-ambiguous paths', async () => {
    await mkdir(join(source, '.git'))
    await writeFile(join(source, '.git', 'config'), 'metadata')
    for (const path of ['', '.', '..', '../sibling/secret', 'nested/../../secret', '/etc/passwd', 'C:/secret', 'C:secret', '\\server\\share', '.git', '.git/config', 'nested/.GiT/config', '.git./config', '.git /config', 'a/../secret', 'a//secret', 'a/./secret', 'a\\secret', 'a\0secret']) {
      assert.equal(await copyWorktreeFile(source, path, target), false, JSON.stringify(path))
    }
    assert.deepEqual(await readdir(target), [])
  })

  it('skips missing roots/files, source directories and obstructed target parents', async () => {
    assert.equal(await copyWorktreeFile(source, 'absent', target), false)
    assert.equal(await copyWorktreeFile(join(root, 'absent'), 'file', target), false)
    await mkdir(join(source, 'directory'))
    assert.equal(await copyWorktreeFile(source, 'directory', target), false)
    await writeFile(join(source, 'file'), 'data')
    assert.equal(await copyWorktreeFile(source, 'file', join(root, 'absent')), false)
    await mkdir(join(target, 'file'))
    assert.equal(await copyWorktreeFile(source, 'file', target), false)
    await writeFile(join(source, 'directory', 'file'), 'data')
    await writeFile(join(target, 'directory'), 'obstruction')
    assert.equal(await copyWorktreeFile(source, 'directory/file', target), false)
    assert.equal(await readFile(join(target, 'directory'), 'utf8'), 'obstruction')
  })

  for (const change of ['inode', 'mode', 'size'] as const) {
    it('skips a source whose ' + change + ' changes during copying and cleans its temporary', async () => {
      const path = join(source, 'changing')
      await writeFile(path, 'original')
      const probe = await open(path, 'r')
      const prototype = Object.getPrototypeOf(probe)
      const originalRead = prototype.read
      await probe.close()
      let changed = false
      // Intercept only the scheduling point; the mutation and reads use real files.
      vi.spyOn(prototype, 'read').mockImplementation(async function (this: FileHandle, ...args: unknown[]) {
        if (!changed) {
          changed = true
          if (change === 'inode') { await rm(path); await writeFile(path, 'replaced') }
          if (change === 'mode') await chmod(path, 0o400)
          if (change === 'size') await writeFile(path, 'larger replacement')
        }
        return originalRead.apply(this, args)
      })
      assert.equal(await copyWorktreeFile(source, 'changing', target), false)
      assert.equal(changed, true)
      assert.deepEqual(await readdir(target), [])
    })
  }

  it('copies the exact limit and skips an oversized sparse file', async () => {
    const file = await open(join(source, 'large'), 'w')
    try { await file.truncate(LIMIT) } finally { await file.close() }
    assert.equal(await copyWorktreeFile(source, 'large', target), true)
    assert.equal((await lstat(join(target, 'large'))).size, LIMIT)
    const oversized = await open(join(source, 'oversized'), 'w')
    try { await oversized.truncate(LIMIT + 1) } finally { await oversized.close() }
    assert.equal(await copyWorktreeFile(source, 'oversized', target), false)
    await assert.rejects(lstat(join(target, 'oversized')), { code: 'ENOENT' })
  })
})

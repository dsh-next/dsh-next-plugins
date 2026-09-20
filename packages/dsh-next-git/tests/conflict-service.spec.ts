import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConflictService, CONFLICT_MAX_BYTES } from '../src/host/conflict-service.ts'
import { GitRunner } from '../src/host/git-runner.ts'
import { GitService } from '../src/host/git-service.ts'
import { nodeFs } from '../src/host/fs-adapter.ts'
import { createFixture, type GitFixture } from './git-fixture.ts'

const fixtures: GitFixture[] = []
afterEach(() => { for (const fixture of fixtures.splice(0)) fixture.dispose() })

function fixture() { const f = createFixture('clean'); fixtures.push(f); return f }
function services(f: GitFixture, cwd = f.dir) {
  const runner = new GitRunner()
  const git = new GitService({ runner, fs: nodeFs(), cwdOf: () => cwd, platform: process.platform, env: process.env })
  return { runner, git, service: new ConflictService({ runner, resolveRepo: source => git.repoFor(source) }) }
}
function conflict(options: { path?: string; base?: Buffer | string | null; current?: Buffer | string | null; incoming?: Buffer | string | null } = {}) {
  const f = fixture()
  const path = options.path ?? 'conflict.txt'
  const base = options.base === undefined ? 'base\n' : options.base
  const current = options.current === undefined ? 'current\n' : options.current
  const incoming = options.incoming === undefined ? 'incoming\n' : options.incoming
  const write = (content: Buffer | string | null) => {
    mkdirSync(join(f.path(path), '..'), { recursive: true })
    if (content === null) rmSync(f.path(path), { force: true })
    else writeFileSync(f.path(path), content)
    f.gitOk(['add', '-A'])
    f.commitIndex('fixture change')
  }
  if (base !== null) write(base)
  f.gitOk(['branch', 'incoming'])
  write(current)
  f.gitOk(['switch', 'incoming'])
  write(incoming)
  f.gitOk(['switch', 'main'])
  expect(f.git(['merge', 'incoming']).code).not.toBe(0)
  return { f, path, ...services(f) }
}
const input = (workspace: { path: string; version: string }) => ({ path: workspace.path, expectedVersion: workspace.version })

/**
 * A text conflict on a path carrying one .gitattributes line.
 *
 * The attribute is committed on both sides, so Git itself writes the worktree
 * conflict with it and the service reads the same declaration.
 */
function attributedConflict(attribute: string) {
  const f = fixture()
  const path = 'conflict.txt'
  f.write('.gitattributes', `${path} ${attribute}\n`)
  f.gitOk(['add', '--', '.gitattributes'])
  f.commitIndex('attrs')
  const commit = (contents: string, message: string): void => {
    f.write(path, contents)
    f.gitOk(['add', '--', path])
    f.commitIndex(message)
  }
  commit('base\n', 'base')
  f.gitOk(['branch', 'incoming'])
  commit('current\n', 'current')
  f.gitOk(['switch', 'incoming'])
  commit('incoming\n', 'incoming')
  f.gitOk(['switch', 'main'])
  expect(f.git(['merge', 'incoming']).code).not.toBe(0)
  return { f, path, ...services(f) }
}

// Real Git assertions cover the DTO and the corresponding index/worktree truth.
describe('ConflictService', () => {
  it('inspects actual index stages and marker model without mutating the worktree or index', async () => {
    const { f, path, service } = conflict()
    const index = readFileSync(join(f.gitDir, 'index'))
    const original = readFileSync(f.path(path))
    const workspace = await service.inspect({ cwd: f.dir }, path)
    expect(workspace.stages.base.content).toBe('base\n')
    expect(workspace.stages.current.content).toBe('current\n')
    expect(workspace.stages.incoming.content).toBe('incoming\n')
    expect(workspace.labels).toMatchObject({ operation: 'merge', currentRef: 'main', incomingRef: f.gitOk(['rev-parse', 'incoming']).trim() })
    expect(workspace.model?.segments.some(segment => segment.kind === 'conflict')).toBe(true)
    expect(workspace).toMatchObject({ path, canSave: true, canMarkResolved: false, unsupportedReason: null, choices: ['current', 'incoming', 'base', 'delete'] })
    expect(JSON.parse(JSON.stringify(workspace))).toEqual(workspace)
    expect(readFileSync(join(f.gitDir, 'index'))).toEqual(index)
    expect(readFileSync(f.path(path))).toEqual(original)
    expect(existsSync(join(f.gitDir, 'dsh-conflicts'))).toBe(false)
  })

  it('atomically saves text with original permissions, backs up inputs, and only explicitly stages a marker-free result', async () => {
    const { f, path, service, git } = conflict()
    chmodSync(f.path(path), 0o751)
    const workspace = await service.inspect({ cwd: f.dir }, path)
    const original = readFileSync(f.path(path))
    const index = readFileSync(join(f.gitDir, 'index'))
    await expect(service.markResolved({ cwd: f.dir }, input(workspace))).rejects.toThrow('unresolved markers')
    await expect(git.stage({ cwd: f.dir, paths: [path] })).rejects.toThrow()
    const saved = await service.save({ cwd: f.dir }, { ...input(workspace), content: '\ufeffresolved\r\n' })
    expect(saved.workspace.canMarkResolved).toBe(true)
    expect(lstatSync(f.path(path)).mode & 0o7777).toBe(0o751)
    expect(readFileSync(f.path(path), 'utf8')).toBe('\ufeffresolved\r\n')
    expect(readFileSync(join(f.gitDir, 'index'))).toEqual(index)
    const backup = join(f.gitDir, 'dsh-conflicts', saved.backupId)
    expect(readFileSync(join(backup, 'worktree'))).toEqual(original)
    expect(readFileSync(join(backup, 'base'), 'utf8')).toBe('base\n')
    expect(readFileSync(join(backup, 'current'), 'utf8')).toBe('current\n')
    expect(readFileSync(join(backup, 'incoming'), 'utf8')).toBe('incoming\n')
    expect(JSON.parse(readFileSync(join(backup, 'manifest.json'), 'utf8'))).toMatchObject({ action: 'save', version: workspace.version, path, worktree: { permissions: 0o751 } })
    await expect(service.markResolved({ cwd: f.dir }, input(workspace))).rejects.toMatchObject({ failure: { code: 'dirty-tree' } })
    const marked = await service.markResolved({ cwd: f.dir }, input(saved.workspace))
    expect(marked).toMatchObject({ path, resolved: true })
    expect(f.gitOk(['ls-files', '-u'])).toBe('')
    f.commitIndex('resolved merge')
    expect(f.gitOk(['show', 'HEAD:' + path])).toBe('\ufeffresolved\r\n')
    await expect(service.inspect({ cwd: f.dir }, path)).rejects.toMatchObject({ failure: { code: 'path-missing' } })
  })

  it.each(['current', 'incoming', 'base'] as const)('chooses %s without staging', async side => {
    const { f, path, service } = conflict()
    const workspace = await service.inspect({ cwd: f.dir }, path)
    const chosen = await service.choose({ cwd: f.dir }, { ...input(workspace), side })
    expect(readFileSync(f.path(path), 'utf8')).toBe(side + '\n')
    expect(f.gitOk(['ls-files', '-u'])).not.toBe('')
    expect(chosen.workspace.canMarkResolved).toBe(true)
    expect(chosen.backupId).toMatch(/^[a-f0-9-]+$/)
  })

  it('requires explicit deletion for modify/delete conflicts and preserves stages until mark', async () => {
    const { f, path, service } = conflict({ incoming: null })
    const workspace = await service.inspect({ cwd: f.dir }, path)
    expect(workspace.stages.incoming.kind).toBe('absent')
    expect(workspace.choices).not.toContain('incoming')
    await expect(service.choose({ cwd: f.dir }, { ...input(workspace), side: 'incoming' })).rejects.toThrow('not supported')
    const chosen = await service.choose({ cwd: f.dir }, { ...input(workspace), side: 'delete' })
    expect(existsSync(f.path(path))).toBe(false)
    expect(f.gitOk(['ls-files', '-u'])).not.toBe('')
    expect((await service.inspect({ cwd: f.dir }, path)).canMarkResolved).toBe(true)
    await service.markResolved({ cwd: f.dir }, input(chosen.workspace))
    expect(f.gitOk(['ls-files', '-u'])).toBe('')
    expect(f.gitOk(['ls-files', '--', path])).toBe('')
  })

  it('handles add/add with no fabricated base and delete/modify with absent worktree', async () => {
    const { f, path, service } = conflict({ base: null })
    const workspace = await service.inspect({ cwd: f.dir }, path)
    expect(workspace.stages.base).toMatchObject({ kind: 'absent', content: null })
    expect(workspace.choices).not.toContain('base')
    const second = conflict({ current: null })
    rmSync(second.f.path(second.path), { force: true })
    const deleted = await second.service.inspect({ cwd: second.f.dir }, second.path)
    expect(deleted.worktree.kind).toBe('absent')
    expect(deleted.canMarkResolved).toBe(false)
    const saved = await second.service.save({ cwd: second.f.dir }, { ...input(deleted), content: 'restored\n' })
    expect(saved.workspace.canMarkResolved).toBe(true)
  })

  it('preserves exact binary bytes, rejects text save, and persists an explicit choice across service restarts', async () => {
    const incoming = Buffer.from([0, 255, 254, 128, 10])
    const { f, path, service } = conflict({ base: Buffer.from([0, 1]), current: Buffer.from([0, 2]), incoming })
    const workspace = await service.inspect({ cwd: f.dir }, path)
    expect(workspace.stages.incoming).toMatchObject({ kind: 'binary', content: null, size: incoming.length })
    expect(workspace.canMarkResolved).toBe(false)
    await expect(service.save({ cwd: f.dir }, { ...input(workspace), content: 'fake text' })).rejects.toThrow('cannot be saved as text')
    await expect(service.markResolved({ cwd: f.dir }, input(workspace))).rejects.toThrow('explicit')
    const chosen = await service.choose({ cwd: f.dir }, { ...input(workspace), side: 'incoming' })
    expect(readFileSync(f.path(path))).toEqual(incoming)
    const fresh = services(f).service
    expect((await fresh.inspect({ cwd: f.dir }, path)).canMarkResolved).toBe(true)
    await fresh.markResolved({ cwd: f.dir }, input(chosen.workspace))
    expect(execFileSync('git', ['show', ':' + path], { cwd: f.dir })).toEqual(incoming)
  })

  it('invalidates explicit nontext decisions after any unrelated edit', async () => {
    const { f, path, service } = conflict({ base: Buffer.from([0, 1]), current: Buffer.from([0, 2]), incoming: Buffer.from([0, 3]) })
    const before = await service.inspect({ cwd: f.dir }, path)
    const choice = await service.choose({ cwd: f.dir }, { ...input(before), side: 'incoming' })
    writeFileSync(f.path(path), Buffer.from([0, 4]))
    const changed = await service.inspect({ cwd: f.dir }, path)
    expect(changed.canMarkResolved).toBe(false)
    await expect(service.markResolved({ cwd: f.dir }, input(choice.workspace))).rejects.toMatchObject({ failure: { code: 'dirty-tree' } })
  })

  it.each(['bytes', 'mode', 'head', 'index'] as const)('rejects a stale %s fingerprint before save, choice, or staging', async change => {
    const { f, path, service } = conflict()
    const workspace = await service.inspect({ cwd: f.dir }, path)
    if (change === 'bytes') writeFileSync(f.path(path), 'unrelated later edit\n')
    if (change === 'mode') chmodSync(f.path(path), 0o755)
    if (change === 'head') f.gitOk(['update-ref', 'HEAD', 'HEAD^'])
    if (change === 'index') {
      const oid = workspace.stages.incoming.oid!
      execFileSync('git', ['update-index', '--index-info'], { cwd: f.dir, input: '100644 ' + oid + ' 2\t' + path + '\n' })
    }
    const original = readFileSync(f.path(path))
    for (const mutation of [() => service.save({ cwd: f.dir }, { ...input(workspace), content: 'bad' }), () => service.choose({ cwd: f.dir }, { ...input(workspace), side: 'current' }), () => service.markResolved({ cwd: f.dir }, input(workspace))]) {
      await expect(mutation()).rejects.toMatchObject({ failure: { code: 'dirty-tree' } })
    }
    expect(readFileSync(f.path(path))).toEqual(original)
    expect(existsSync(join(f.gitDir, 'dsh-conflicts'))).toBe(false)
  })

  it('reports index-lock failures without clearing unresolved stages or losing backups', async () => {
    const { f, path, service } = conflict()
    const before = await service.inspect({ cwd: f.dir }, path)
    const saved = await service.save({ cwd: f.dir }, { ...input(before), content: 'resolved' })
    const lock = join(f.gitDir, 'index.lock')
    writeFileSync(lock, '')
    await expect(service.markResolved({ cwd: f.dir }, input(saved.workspace))).rejects.toMatchObject({ failure: { code: 'index-locked' } })
    expect(f.gitOk(['ls-files', '-u'])).not.toBe('')
    expect(readFileSync(f.path(path), 'utf8')).toBe('resolved')
    expect(existsSync(join(f.gitDir, 'dsh-conflicts', saved.backupId, 'worktree'))).toBe(true)
    rmSync(lock)
    await service.markResolved({ cwd: f.dir }, input(saved.workspace))
    expect(f.gitOk(['ls-files', '-u'])).toBe('')
  })

  it('rechecks external changes after backup and removes abandoned temporary files', async () => {
    const { f, path, service, runner } = conflict()
    const workspace = await service.inspect({ cwd: f.dir }, path)
    const run = runner.runOk.bind(runner)
    let reads = 0
    vi.spyOn(runner, 'runOk').mockImplementation(async (args, cwd, options) => {
      if (args.includes('ls-files') && ++reads === 3) writeFileSync(f.path(path), 'later external edit')
      return run(args, cwd, options)
    })
    await expect(service.save({ cwd: f.dir }, { ...input(workspace), content: 'resolution' })).rejects.toMatchObject({ failure: { code: 'dirty-tree' } })
    expect(readFileSync(f.path(path), 'utf8')).toBe('later external edit')
    expect(readdirSync(f.dir).filter(name => name.startsWith('.dsh-conflict-'))).toEqual([])
    expect(readdirSync(join(f.gitDir, 'dsh-conflicts'))).toHaveLength(1)
    expect(f.gitOk(['ls-files', '-u'])).not.toBe('')
  })

  it('serializes same-version writes: exactly one succeeds', async () => {
    const { f, path, service, runner } = conflict()
    const spy = vi.spyOn(runner, 'mutate')
    const workspace = await service.inspect({ cwd: f.dir }, path)
    const result = await Promise.allSettled(['one\n', 'two\n'].map(content => service.save({ cwd: f.dir }, { ...input(workspace), content })))
    expect(result.map(item => item.status).sort()).toEqual(['fulfilled', 'rejected'])
    expect(spy.mock.calls.every(call => call[0] === f.gitDir)).toBe(true)
  })

  it.each(['../outside', '/absolute', '.git/config', '.GIT/config', 'a/../b', 'a//b', './file', 'C:/file', 'a\\b', 'bad\0path'])('rejects malicious path %j', async path => {
    const { f, service } = conflict()
    await expect(service.inspect({ cwd: f.dir }, path)).rejects.toMatchObject({ failure: { code: 'invalid-name' } })
  })

  it('uses literal pathspecs for wildcard filenames', async () => {
    const { f, path, service } = conflict({ path: ':(glob)*.txt' })
    const workspace = await service.inspect({ cwd: f.dir }, path)
    const chosen = await service.choose({ cwd: f.dir }, { ...input(workspace), side: 'incoming' })
    await service.markResolved({ cwd: f.dir }, input(chosen.workspace))
    expect(f.gitOk(['--literal-pathspecs', 'ls-files', '-u', '--', path])).toBe('')
  })

  it('refuses symlink ancestors and never writes through a symlink leaf', async () => {
    const { f, path, service } = conflict({ path: 'nested/file.txt' })
    const workspace = await service.inspect({ cwd: f.dir }, path)
    const outside = f.scratch('conflict-outside-')
    writeFileSync(join(outside, 'file.txt'), 'outside')
    renameSync(f.path('nested'), f.path('old-nested'))
    symlinkSync(outside, f.path('nested'))
    await expect(service.inspect({ cwd: f.dir }, path)).rejects.toThrow('symlink')
    await expect(service.save({ cwd: f.dir }, { ...input(workspace), content: 'bad' })).rejects.toThrow('symlink')
    expect(readFileSync(join(outside, 'file.txt'), 'utf8')).toBe('outside')
    rmSync(f.path('nested'))
    renameSync(f.path('old-nested'), f.path('nested'))
    rmSync(f.path(path))
    symlinkSync(join(outside, 'file.txt'), f.path(path))
    const link = await service.inspect({ cwd: f.dir }, path)
    expect(link.worktree).toMatchObject({ kind: 'symlink', content: null })
    await expect(service.save({ cwd: f.dir }, { ...input(link), content: 'bad' })).rejects.toThrow('cannot be saved as text')
    await service.choose({ cwd: f.dir }, { ...input(link), side: 'current' })
    expect(lstatSync(f.path(path)).isFile()).toBe(true)
    expect(readFileSync(join(outside, 'file.txt'), 'utf8')).toBe('outside')
  })

  it('only allows safe explicit symlink choices and never interprets a link target as text', async () => {
    const { f, path, service } = conflict()
    const targetOid = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: f.dir, input: 'relative-target' }).toString().trim()
    const unsafeOid = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: f.dir, input: '../../outside' }).toString().trim()
    execFileSync('git', ['update-index', '--index-info'], { cwd: f.dir, input: '120000 ' + targetOid + ' 2\t' + path + '\n120000 ' + unsafeOid + ' 3\t' + path + '\n' })
    const workspace = await service.inspect({ cwd: f.dir }, path)
    expect(workspace.stages.current).toMatchObject({ kind: 'symlink', content: null })
    expect(workspace.canSave).toBe(false)
    expect(workspace.choices).not.toContain('incoming')
    await expect(service.choose({ cwd: f.dir }, { ...input(workspace), side: 'incoming' })).rejects.toThrow('not supported')
    const chosen = await service.choose({ cwd: f.dir }, { ...input(workspace), side: 'current' })
    expect(readlinkSync(f.path(path))).toBe('relative-target')
    await service.markResolved({ cwd: f.dir }, input(chosen.workspace))
    expect(f.gitOk(['ls-files', '-s', '--', path])).toContain('120000')
  })

  it('makes submodule, nonregular, and oversized conflicts explicitly unsupported', async () => {
    const { f, path, service } = conflict()
    const head = f.gitOk(['rev-parse', 'HEAD']).trim()
    execFileSync('git', ['update-index', '--index-info'], { cwd: f.dir, input: '160000 ' + head + ' 2\t' + path + '\n' })
    const submodule = await service.inspect({ cwd: f.dir }, path)
    expect(submodule).toMatchObject({ canSave: false, canMarkResolved: false, choices: [], unsupportedReason: 'Submodule conflicts require an external Git workflow' })
    await expect(service.choose({ cwd: f.dir }, { ...input(submodule), side: 'delete' })).rejects.toThrow('not supported')
    const second = conflict()
    rmSync(second.f.path(second.path))
    mkdirSync(second.f.path(second.path))
    expect((await second.service.inspect({ cwd: second.f.dir }, second.path)).worktree.kind).toBe('nonregular')
    rmSync(second.f.path(second.path), { recursive: true })
    writeFileSync(second.f.path(second.path), Buffer.alloc(CONFLICT_MAX_BYTES + 1, 65))
    const large = await second.service.inspect({ cwd: second.f.dir }, second.path)
    expect(large).toMatchObject({ worktree: { kind: 'oversize', content: null }, canSave: false, choices: [] })
    await expect(second.service.save({ cwd: second.f.dir }, { ...input(large), content: 'bad' })).rejects.toThrow('cannot be saved')
  })

  it('rejects binary/oversized/invalid UTF-16 save payloads without mutations', async () => {
    const { f, path, service } = conflict()
    const workspace = await service.inspect({ cwd: f.dir }, path)
    for (const content of ['\0bad', '\ud800', 'x'.repeat(CONFLICT_MAX_BYTES + 1)]) await expect(service.save({ cwd: f.dir }, { ...input(workspace), content })).rejects.toThrow()
    expect(existsSync(join(f.gitDir, 'dsh-conflicts'))).toBe(false)
  })

  it('honors a conflict-marker-size attribute and resolves with the smaller markers', async () => {
    const { f, path, service } = attributedConflict('conflict-marker-size=3')
    expect(readFileSync(f.path(path), 'utf8')).toContain('<<<')
    expect(readFileSync(f.path(path), 'utf8')).not.toContain('<<<<')
    const workspace = await service.inspect({ cwd: f.dir }, path)
    expect(workspace.markerSize).toBe(3)
    expect(workspace.model?.markerSize).toBe(3)
    expect(workspace.canSave).toBe(true)
    expect(workspace.unsupportedReason).toBeNull()

    // A seven-character marker is still a marker at width three, so the
    // service must not accept it as an ordinary line.
    const wrong = await service.save({ cwd: f.dir }, {
      path, expectedVersion: workspace.version, content: '<<<<<<< HEAD\ncurrent\n=======\nincoming\n>>>>>>> incoming\n',
    })
    await expect(service.markResolved({ cwd: f.dir }, input(wrong.workspace))).rejects.toThrow('unresolved markers')

    const saved = await service.save({ cwd: f.dir }, {
      path, expectedVersion: wrong.workspace.version, content: 'resolved\n',
    })
    expect(saved.workspace.markerSize).toBe(3)
    expect(saved.workspace.canMarkResolved).toBe(true)
    await service.markResolved({ cwd: f.dir }, input(saved.workspace))
    // The merge is still open, so status is not clean; what must be true is
    // that the path has no unresolved stages left and holds the saved text.
    expect(f.gitOk(['ls-files', '-u', '--', path]).trim()).toBe('')
    expect(f.gitOk(['show', `:${path}`])).toBe('resolved\n')
    expect(readFileSync(f.path(path), 'utf8')).toBe('resolved\n')
  })

  it('refuses a working-tree-encoding attribute instead of writing converted bytes', async () => {
    // ISO-8859-1 is Git's safely interoperable single-byte encoding: the
    // declaration is honored without Git refusing the blob itself.
    const { f, path, service } = attributedConflict('working-tree-encoding=ISO-8859-1')
    const workspace = await service.inspect({ cwd: f.dir }, path)
    expect(workspace.canSave).toBe(false)
    expect(workspace.unsupportedReason).toContain('working-tree encoding')
    await expect(service.save({ cwd: f.dir }, {
      path, expectedVersion: workspace.version, content: 'resolved\n',
    })).rejects.toThrow('cannot be saved as text')
  })

  it('refuses a Git filter attribute instead of double-converting on save', async () => {
    const { f, path, service } = attributedConflict('filter=dsh-identity')
    // A no-op filter still puts the path in a conversion workflow the raw
    // blob choices cannot honor.
    f.gitOk(['config', 'filter.dsh-identity.clean', 'cat'])
    f.gitOk(['config', 'filter.dsh-identity.smudge', 'cat'])
    const workspace = await service.inspect({ cwd: f.dir }, path)
    expect(workspace.canSave).toBe(false)
    expect(workspace.unsupportedReason).toContain('Git filters')
    expect(workspace.choices).toEqual([])
    await expect(service.choose({ cwd: f.dir }, { ...input(workspace), side: 'current' })).rejects.toThrow()
  })

  it('rejects valid, malformed, and partial unresolved markers after save', async () => {
    const { f, path, service } = conflict()
    for (const content of ['<<<<<<< current\na\n=======\nb\n>>>>>>> incoming\n', '<<<<<<< broken\n', '=======\n']) {
      const before = await service.inspect({ cwd: f.dir }, path)
      const saved = await service.save({ cwd: f.dir }, { ...input(before), content })
      expect(saved.workspace.canMarkResolved).toBe(false)
      await expect(service.markResolved({ cwd: f.dir }, input(saved.workspace))).rejects.toThrow('unresolved markers')
      expect(f.gitOk(['ls-files', '-u'])).not.toBe('')
    }
  })

  it('refuses symlink backup storage before overwriting anything', async () => {
    const { f, path, service } = conflict()
    const before = await service.inspect({ cwd: f.dir }, path)
    const outside = f.scratch('backup-outside-')
    symlinkSync(outside, join(f.gitDir, 'dsh-conflicts'))
    await expect(service.save({ cwd: f.dir }, { ...input(before), content: 'bad' })).rejects.toThrow('safe directory')
    expect(readdirSync(outside)).toEqual([])
    expect(readFileSync(f.path(path), 'utf8')).toContain('<<<<<<<')
  })

  it('uses the linked checkout and its gitDir, not the primary root', async () => {
    const { f, path } = conflict()
    f.gitOk(['merge', '--abort'])
    const linked = f.addWorktree('conflict-linked', 'main')
    expect(f.git(['merge', 'incoming'], { cwd: linked }).code).not.toBe(0)
    const { service, git } = services(f, linked)
    const repo = await git.repoFor({ cwd: linked })
    expect(repo.toplevel).toBe(linked)
    expect(repo.root).toBe(f.dir)
    const workspace = await service.inspect({ cwd: linked }, path)
    const saved = await service.save({ cwd: linked }, { ...input(workspace), content: 'linked only\n' })
    expect(readFileSync(f.path(path), 'utf8')).toBe('current\n')
    expect(readFileSync(join(linked, path), 'utf8')).toBe('linked only\n')
    expect(existsSync(join(repo.gitDir, 'dsh-conflicts', saved.backupId, 'manifest.json'))).toBe(true)
    expect(existsSync(join(f.gitDir, 'dsh-conflicts'))).toBe(false)
    await service.markResolved({ cwd: linked }, input(saved.workspace))
    expect(f.gitOk(['ls-files', '-u'], { cwd: linked })).toBe('')
  })

  it('does not fetch oversized blobs, and rejects invalid UTF-8 as binary', async () => {
    const { f, path, service, runner } = conflict()
    const big = f.path('large-input')
    writeFileSync(big, Buffer.alloc(CONFLICT_MAX_BYTES + 1, 65))
    const oid = f.gitOk(['hash-object', '-w', big]).trim()
    execFileSync('git', ['update-index', '--index-info'], { cwd: f.dir, input: '100644 ' + oid + ' 3\t' + path + '\n' })
    const spy = vi.spyOn(runner, 'runBytesOk')
    const workspace = await service.inspect({ cwd: f.dir }, path)
    expect(workspace.stages.incoming).toMatchObject({ kind: 'oversize', content: null })
    expect(workspace.choices).toEqual([])
    expect(spy.mock.calls.some(call => call[0].includes(oid))).toBe(false)
    const binary = conflict({ base: Buffer.from([255, 1]), current: Buffer.from([255, 2]), incoming: Buffer.from([255, 3]) })
    expect((await binary.service.inspect({ cwd: binary.f.dir }, binary.path)).stages.incoming.kind).toBe('binary')
  })

  it.each(['cherry-pick', 'revert'] as const)('labels actual %s index-stage meaning', async operation => {
    const { f, path, service } = conflict()
    f.gitOk(['merge', '--abort'])
    expect(f.git([operation, 'incoming']).code).not.toBe(0)
    const workspace = await service.inspect({ cwd: f.dir }, path)
    expect(workspace.labels.operation).toBe(operation)
    expect(workspace.labels.incomingRef).toBe(f.gitOk(['rev-parse', operation === 'revert' ? 'incoming^' : 'incoming']).trim())
    expect(workspace.stages.incoming.content).toBe(operation === 'revert' ? 'base\n' : 'incoming\n')
  })

  it('uses neutral stage labels for conflicts outside a known history operation', async () => {
    const { f, path, service } = conflict()
    rmSync(join(f.gitDir, 'MERGE_HEAD'))
    const workspace = await service.inspect({ cwd: f.dir }, path)
    expect(workspace.labels).toMatchObject({ operation: 'unknown', current: 'Index stage 2', incoming: 'Index stage 3', incomingRef: null })
  })

  it('preserves rebase stage meaning instead of claiming stage 2 is the user branch', async () => {
    const { f, path } = conflict()
    f.gitOk(['merge', '--abort'])
    expect(f.git(['rebase', 'incoming']).code).not.toBe(0)
    const { service } = services(f)
    const workspace = await service.inspect({ cwd: f.dir }, path)
    expect(workspace.labels.operation).toBe('rebase')
    expect(workspace.labels.current).toContain('Rebased-onto')
    expect(workspace.labels.incoming).toContain('Replayed')
    expect(workspace.stages.current.content).toBe('incoming\n')
    expect(workspace.stages.incoming.content).toBe('current\n')
  })
})

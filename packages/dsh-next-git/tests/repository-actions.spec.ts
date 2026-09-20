// @vitest-environment node
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RepositoryActions } from '../src/host/repository-actions.ts'
import type { RepositoryActionsPorts } from '../src/host/repository-actions.ts'
import { GitRunner } from '../src/host/git-runner.ts'
import type { HunkApplyRequest, HunkPreview, RepositoryActionExecution, RepositoryActionRequest } from '../src/core/repository-actions.ts'
import type { SourceRef } from '../src/host/git-service.ts'
import { createFixture, type GitFixture } from './git-fixture.ts'

const fixtures: GitFixture[] = []
afterEach(() => { vi.restoreAllMocks(); for (const f of fixtures.splice(0)) f.dispose() })
function setup() {
  const f = createFixture('clean'); fixtures.push(f)
  const runner = new GitRunner()
  const source = { cwd: f.dir }
  const resolveRepo = async (s: SourceRef) => {
    const cwd = s.cwd ?? f.dir
    const gitDir = (await runner.runOk(['rev-parse', '--absolute-git-dir'], cwd)).trim()
    const commonDir = (await runner.runOk(['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd)).trim()
    const toplevel = (await runner.runOk(['rev-parse', '--show-toplevel'], cwd)).trim()
    return { root: f.dir, toplevel, cwd, gitDir, commonDir }
  }
  return { f, runner, source, resolveRepo, ops: new RepositoryActions({ runner, resolveRepo }) }
}
function changed(f: GitFixture, path = 'hunks.txt') {
  const original = Array.from({ length: 40 }, (_, i) => 'line ' + i).join('\n') + '\n'
  f.write(path, original); f.gitOk(['--literal-pathspecs', 'add', '--', path]); f.commitIndex('hunk fixture')
  const content = original.replace('line 2\n', 'first changed\n').replace('line 32\n', 'second changed\n')
  f.write(path, content)
  return { original, content, path }
}
function selection(preview: HunkPreview, indices = [0]): HunkApplyRequest {
  return { path: preview.path, side: preview.side, version: preview.version, hunkIds: indices.map(i => preview.hunks[i]!.id), approved: true }
}
async function execute(ops: RepositoryActions, source: SourceRef, request: RepositoryActionRequest) {
  const preview = await ops.preview(source, request)
  return ops.execute(source, { request: preview.request, version: preview.version, approved: true })
}
function bare(f: GitFixture) {
  const remote = join(f.scratch('remote'), 'origin.git')
  f.gitOk(['init', '--bare', '-b', 'main', remote])
  f.gitOk(['remote', 'add', 'origin', remote])
  return remote
}
const push = { action: 'push', remote: 'origin', branch: 'main' } as const

describe('selected tracked text hunks using real Git', () => {
  it('lists stable IDs and stages only the selected hunk without changing worktree content', async () => {
    const { f, ops, source } = setup(); const { original, content, path } = changed(f)
    const p = await ops.inspectHunks(source, { path, side: 'unstaged' })
    expect(p).toEqual({ path, side: 'unstaged', version: expect.stringMatching(/^[a-f0-9]{64}$/), hunks: [expect.objectContaining({ id: expect.any(String), header: expect.any(String), patch: expect.any(String) }), expect.any(Object)], unsupported: null, wholeFileFallback: false })
    expect(await ops.inspectHunks(source, { path, side: 'unstaged' })).toEqual(p)
    expect(await ops.applyHunks(source, selection(p))).toEqual({ status: 'completed', refresh: true, conflictRefresh: false, reason: null, message: null, stashOid: null })
    expect(f.gitOk(['show', ':' + path])).toBe(original.replace('line 2\n', 'first changed\n'))
    expect(readFileSync(f.path(path), 'utf8')).toBe(content)
    expect(f.gitOk(['diff', '--cached'])).not.toContain('second changed')
    expect(f.gitOk(['diff'])).toContain('second changed')
    expect(readdirSync(f.gitDir).filter(name => name.startsWith('dsh-actions-'))).toEqual([])
  })
  it('unstages only the selected staged hunk using reverse apply', async () => {
    const { f, ops, source } = setup(); const { original, content, path } = changed(f)
    f.gitOk(['add', '--', path])
    const p = await ops.inspectHunks(source, { path, side: 'staged' })
    expect(p.hunks).toHaveLength(2)
    expect((await ops.applyHunks(source, selection(p, [1]))).status).toBe('completed')
    expect(f.gitOk(['show', ':' + path])).toBe(original.replace('line 2\n', 'first changed\n'))
    expect(readFileSync(f.path(path), 'utf8')).toBe(content)
  })
  it.each([':(glob)* [x].txt', '-option ; $(touch NEVER).txt', 'a\tquote"\nname.txt'])('uses literal filenames: %s', async path => {
    const { f, ops, source } = setup(); changed(f, path)
    const p = await ops.inspectHunks(source, { path, side: 'unstaged' })
    expect(p.hunks).toHaveLength(2)
    expect((await ops.applyHunks(source, selection(p, [1]))).status).toBe('completed')
    expect(f.gitOk(['show', ':' + path])).toContain('second changed')
    expect(f.gitOk(['show', ':' + path])).not.toContain('first changed')
    expect(existsSync(f.path('NEVER'))).toBe(false)
  })
  it.each(['worktree', 'index', 'head'] as const)('rejects stale %s without additional index edits', async drift => {
    const { f, ops, source } = setup(); const { path } = changed(f)
    const p = await ops.inspectHunks(source, { path, side: 'unstaged' })
    if (drift === 'worktree') f.write(path, 'different content\n')
    if (drift === 'index') { f.write('other', 'other'); f.gitOk(['add', 'other']) }
    if (drift === 'head') f.gitOk(['commit', '--allow-empty', '-m', 'moved'])
    const before = f.gitOk(['ls-files', '--stage'])
    expect((await ops.applyHunks(source, selection(p))).reason).toBe('stale-preview')
    expect(f.gitOk(['ls-files', '--stage'])).toBe(before)
  })
  it('rejects nonexistent, duplicate, empty, malformed IDs and arbitrary patch input', async () => {
    const { f, ops, source } = setup(); const { path } = changed(f)
    const p = await ops.inspectHunks(source, { path, side: 'unstaged' })
    for (const hunkIds of [[], ['0'.repeat(64)], ['bad'], [p.hunks[0]!.id, p.hunks[0]!.id]]) {
      expect((await ops.applyHunks(source, { ...selection(p), hunkIds })).reason).toBe('invalid-selection')
    }
    expect((await ops.applyHunks(source, { ...selection(p), patch: 'user patch' } as HunkApplyRequest)).reason).toBe('invalid-request')
    expect(f.gitOk(['diff', '--cached'])).toBe('')
  })
  it('writes private patch files and preserves the index on a real Git apply failure', async () => {
    const { f, runner, source, resolveRepo } = setup(); const { path } = changed(f)
    const run = runner.runOk.bind(runner)
    let checked = false
    vi.spyOn(runner, 'runOk').mockImplementation(async (args, cwd, options) => {
      if (args.includes('apply') && args.includes('--check')) {
        const patch = args.at(-1)!
        expect(statSync(patch).mode & 0o777).toBe(0o600)
        expect(statSync(dirname(patch)).mode & 0o777).toBe(0o700)
        expect(patch.startsWith(f.gitDir + '/')).toBe(true)
        checked = true
        // Real Git, not a mocked success/failure: corrupt only the host temp patch.
        writeFileSync(patch, 'not a valid patch\n')
      }
      return run(args, cwd, options)
    })
    const ops = new RepositoryActions({ runner, resolveRepo })
    const p = await ops.inspectHunks(source, { path, side: 'unstaged' })
    const before = f.gitOk(['ls-files', '--stage'])
    expect((await ops.applyHunks(source, selection(p))).status).toBe('failed')
    expect(checked).toBe(true)
    expect(f.gitOk(['ls-files', '--stage'])).toBe(before)
    expect(readdirSync(f.gitDir).filter(name => name.startsWith('dsh-actions-'))).toEqual([])
  })
  it('revalidates after apply --check before index mutation', async () => {
    const { f, runner, source, resolveRepo } = setup(); const { path } = changed(f)
    const run = runner.runOk.bind(runner)
    vi.spyOn(runner, 'runOk').mockImplementation(async (args, cwd, options) => {
      const output = await run(args, cwd, options)
      if (args.includes('apply') && args.includes('--check')) f.write(path, 'external edit\n')
      return output
    })
    const ops = new RepositoryActions({ runner, resolveRepo })
    const p = await ops.inspectHunks(source, { path, side: 'unstaged' })
    expect((await ops.applyHunks(source, selection(p))).reason).toBe('stale-preview')
    expect(f.gitOk(['diff', '--cached'])).toBe('')
  })
  it('reports clean and explicit binary/new-file/rename/deleted/mode fallback', async () => {
    const { f, ops, source } = setup()
    expect(await ops.inspectHunks(source, { path: 'src/app.ts', side: 'unstaged' })).toMatchObject({ hunks: [], unsupported: null, wholeFileFallback: false })
    f.commit('bin', 'a\0b', 'binary'); writeFileSync(f.path('bin'), Buffer.from([0, 255, 2]))
    expect(await ops.inspectHunks(source, { path: 'bin', side: 'unstaged' })).toMatchObject({ hunks: [], unsupported: 'binary', wholeFileFallback: true })
    f.write('new', 'new\n')
    expect((await ops.inspectHunks(source, { path: 'new', side: 'unstaged' })).unsupported).toBe('new-file')
    f.gitOk(['add', 'new'])
    expect((await ops.inspectHunks(source, { path: 'new', side: 'staged' })).unsupported).toBe('new-file')
    f.gitOk(['mv', 'src/app.ts', 'src/renamed.ts'])
    expect((await ops.inspectHunks(source, { path: 'src/renamed.ts', side: 'staged' })).unsupported).toBe('rename')
    f.remove('README.md')
    expect((await ops.inspectHunks(source, { path: 'README.md', side: 'unstaged' })).unsupported).toBe('deleted-file')
    f.gitOk(['update-index', '--chmod=+x', '--', 'new'])
    expect((await ops.inspectHunks(source, { path: 'new', side: 'staged' })).wholeFileFallback).toBe(true)
  })
  it('rejects symlink traversal and unsafe paths without staging escaped data', async () => {
    const { f, ops, source } = setup(); const outside = f.scratch('outside')
    writeFileSync(join(outside, 'secret'), 'secret')
    symlinkSync(outside, f.path('link'))
    for (const path of ['link/secret', '../secret', '/tmp/secret', '.git/config', 'src']) {
      await expect(ops.inspectHunks(source, { path, side: 'unstaged' })).rejects.toMatchObject({ reason: expect.stringMatching(/unsafe-path|invalid-path/) })
    }
    expect(f.gitOk(['diff', '--cached'])).toBe('')
  })
  it('targets the active linked checkout rather than primary root or nested cwd', async () => {
    const { f, ops } = setup(); const { path } = changed(f)
    f.gitOk(['add', path]); f.commitIndex('base for linked checkout')
    const linked = f.addWorktree('actions'); mkdirSync(join(linked, 'nested'))
    const source = { cwd: join(linked, 'nested') }
    const content = readFileSync(join(linked, path), 'utf8').replace('line 10', 'linked change')
    writeFileSync(join(linked, path), content)
    const p = await ops.inspectHunks(source, { path, side: 'unstaged' })
    expect((await ops.applyHunks(source, selection(p))).status).toBe('completed')
    expect(f.gitOk(['diff', '--cached'])).toBe('')
    expect(f.gitOk(['-C', linked, 'diff', '--cached'])).toContain('linked change')
  })
})

describe('repository action boundary cases', () => {
  it('handles insertion/deletion offsets and missing final newlines', async () => {
    const { f, ops, source } = setup()
    const original = Array.from({ length: 50 }, (_, i) => 'row ' + i).join('\n')
    f.commit('offsets', original, 'offsets')
    const changed = original.replace('row 2\n', 'inserted A\ninserted B\nrow 2\n').replace('row 30\n', '').replace('row 49', 'last row changed')
    f.write('offsets', changed)
    const p = await ops.inspectHunks(source, { path: 'offsets', side: 'unstaged' })
    expect(p.hunks).toHaveLength(3)
    expect((await ops.applyHunks(source, selection(p, [0, 2]))).status).toBe('completed')
    expect(f.gitOk(['show', ':offsets'])).toBe(original.replace('row 2\n', 'inserted A\ninserted B\nrow 2\n').replace('row 49', 'last row changed'))
    const staged = await ops.inspectHunks(source, { path: 'offsets', side: 'staged' })
    expect((await ops.applyHunks(source, selection(staged, [1]))).status).toBe('completed')
    expect(f.gitOk(['show', ':offsets'])).toBe(original.replace('row 2\n', 'inserted A\ninserted B\nrow 2\n'))
    expect(readFileSync(f.path('offsets'), 'utf8')).toBe(changed)
  })
  it('rejects malformed hunk envelopes and requires approval', async () => {
    const { f, ops, source } = setup(); const { path } = changed(f)
    const p = await ops.inspectHunks(source, { path, side: 'unstaged' })
    expect((await ops.applyHunks(source, null as unknown as HunkApplyRequest)).reason).toBe('invalid-request')
    expect((await ops.applyHunks(source, { ...selection(p), approved: false } as unknown as HunkApplyRequest)).reason).toBe('approval-required')
    expect((await ops.applyHunks(source, { ...selection(p), version: '' })).reason).toBe('invalid-version')
    await expect(ops.inspectHunks(source, { path, side: 'other' } as never)).rejects.toMatchObject({ reason: 'invalid-side' })
    await expect(ops.inspectHunks(source, null as never)).rejects.toMatchObject({ reason: 'invalid-request' })
  })
  it('rejects hidden index flags and active index locks', async () => {
    const { f, ops, source } = setup()
    f.gitOk(['update-index', '--assume-unchanged', 'src/app.ts'])
    await expect(ops.preview(source, { action: 'stash-save', includeUntracked: false })).rejects.toMatchObject({ reason: 'hidden-index-state' })
    f.gitOk(['update-index', '--no-assume-unchanged', 'src/app.ts'])
    writeFileSync(join(f.gitDir, 'index.lock'), '')
    await expect(ops.preview(source, { action: 'stash-save', includeUntracked: false })).rejects.toMatchObject({ reason: 'active-operation' })
  })
  it('returns explicit non-UTF8 and mode-only fallbacks and refuses partial binary writes', async () => {
    const { f, ops, source } = setup()
    f.commit('not-utf8', 'abc\n', 'text'); writeFileSync(f.path('not-utf8'), Buffer.from([97, 255, 10]))
    expect((await ops.inspectHunks(source, { path: 'not-utf8', side: 'unstaged' })).unsupported).toBe('non-text')
    f.gitOk(['update-index', '--chmod=+x', '--', 'src/app.ts'])
    expect((await ops.inspectHunks(source, { path: 'src/app.ts', side: 'staged' })).unsupported).toBe('mode-change')
    f.commit('bin', 'old\0bytes', 'binary'); writeFileSync(f.path('bin'), 'new\0bytes')
    const p = await ops.inspectHunks(source, { path: 'bin', side: 'unstaged' })
    expect((await ops.applyHunks(source, { path: p.path, side: p.side, version: p.version, approved: true, hunkIds: ['0'.repeat(64)] })).reason).toBe('unsupported-hunks')
  })
})

describe('explicit local-remote and stash actions', () => {
  it('inventories remotes and fetches only after approved execution, optionally pruning', async () => {
    const { f, ops, source } = setup(); const remote = bare(f)
    f.gitOk(['push', 'origin', 'HEAD:main', 'HEAD:gone'])
    f.gitOk(['update-ref', '-d', 'refs/remotes/origin/main'])
    expect((await ops.inventory(source)).remotes).toEqual([{ name: 'origin', fetchUrls: [remote], pushUrls: [remote] }])
    const p = await ops.preview(source, { action: 'fetch', remote: 'origin', prune: false })
    expect(f.git(['rev-parse', '--verify', 'refs/remotes/origin/main']).code).not.toBe(0)
    expect((await ops.execute(source, { request: p.request, version: p.version, approved: true })).status).toBe('completed')
    expect(f.gitOk(['rev-parse', 'refs/remotes/origin/main']).trim()).toBe(p.head)
    f.gitOk(['--git-dir=' + remote, 'update-ref', '-d', 'refs/heads/gone'])
    f.gitOk(['update-ref', 'refs/tags/local-only', 'HEAD'])
    f.gitOk(['config', 'fetch.pruneTags', 'true'])
    f.gitOk(['config', 'remote.origin.pruneTags', 'true'])
    expect((await execute(ops, source, { action: 'fetch', remote: 'origin', prune: false })).status).toBe('completed')
    expect(f.git(['rev-parse', '--verify', 'refs/remotes/origin/gone']).code).toBe(0)
    expect((await execute(ops, source, { action: 'fetch', remote: 'origin', prune: true })).status).toBe('completed')
    expect(f.git(['rev-parse', '--verify', 'refs/remotes/origin/gone']).code).not.toBe(0)
    expect(f.git(['rev-parse', '--verify', 'refs/tags/local-only']).code).toBe(0)
  })
  it('pushes the exact HEAD and rejects non-fastforward even with configured force refspecs', async () => {
    const { f, ops, source } = setup(); const remote = bare(f)
    expect((await execute(ops, source, push)).status).toBe('completed')
    const first = f.gitOk(['rev-parse', 'HEAD']).trim()
    const second = f.commit('next', 'next', 'next commit')
    expect((await execute(ops, source, push)).status).toBe('completed')
    f.gitOk(['reset', '--hard', first]); f.commit('diverged', 'diverged', 'diverged commit')
    f.gitOk(['config', 'remote.origin.push', '+HEAD:refs/heads/main'])
    expect((await execute(ops, source, push)).status).toBe('failed')
    expect(f.gitOk(['--git-dir=' + remote, 'rev-parse', 'refs/heads/main']).trim()).toBe(second)
    await expect(ops.preview(source, { ...push, force: true } as RepositoryActionRequest)).rejects.toMatchObject({ reason: 'invalid-request' })
  })
  it('rejects changed HEAD, remote configuration, and changed requests before push', async () => {
    const { f, ops, source } = setup(); const remote = bare(f)
    const p = await ops.preview(source, push)
    f.gitOk(['commit', '--allow-empty', '-m', 'moved'])
    expect((await ops.execute(source, { request: p.request, version: p.version, approved: true })).reason).toBe('stale-preview')
    const fresh = await ops.preview(source, push)
    f.gitOk(['config', 'remote.origin.pushurl', remote])
    expect((await ops.execute(source, { request: fresh.request, version: fresh.version, approved: true })).reason).toBe('stale-preview')
    const current = await ops.preview(source, push)
    expect((await ops.execute(source, { request: { ...push, branch: 'other' }, version: current.version, approved: true })).reason).toBe('stale-preview')
    expect(f.git(['--git-dir=' + remote, 'rev-parse', '--verify', 'refs/heads/main']).code).not.toBe(0)
  })
  it('saves with explicit untracked inclusion and applies without dropping the stash', async () => {
    const { f, ops, source } = setup()
    f.write('src/app.ts', 'stash content\n'); f.write('untracked', 'untracked content\n')
    const saved = await execute(ops, source, { action: 'stash-save', includeUntracked: true, message: 'literal $(touch NEVER); "text"' })
    expect(saved).toMatchObject({ status: 'completed', stashOid: expect.stringMatching(/^[a-f0-9]{40}$/) })
    expect(f.gitOk(['status', '--porcelain'])).toBe('')
    expect((await ops.inventory(source)).stashes).toEqual([{ oid: saved.stashOid, label: 'stash@{0}' }])
    expect((await execute(ops, source, { action: 'stash-apply', stashOid: saved.stashOid! })).status).toBe('completed')
    expect(readFileSync(f.path('src/app.ts'), 'utf8')).toBe('stash content\n')
    expect(readFileSync(f.path('untracked'), 'utf8')).toBe('untracked content\n')
    expect(f.gitOk(['stash', 'list', '--format=%H']).trim()).toBe(saved.stashOid)
    expect(existsSync(f.path('NEVER'))).toBe(false)
  })
  it('leaves untracked files alone when excluded and reports no-op on a clean tracked tree', async () => {
    const { f, ops, source } = setup(); f.write('untracked', 'leave me')
    expect((await execute(ops, source, { action: 'stash-save', includeUntracked: false })).status).toBe('noop')
    expect(readFileSync(f.path('untracked'), 'utf8')).toBe('leave me')
    f.write('src/app.ts', 'tracked change')
    expect((await execute(ops, source, { action: 'stash-save', includeUntracked: false })).status).toBe('completed')
    expect(readFileSync(f.path('untracked'), 'utf8')).toBe('leave me')
  })
  it('detects same-path untracked content drift before stash save', async () => {
    const { f, ops, source } = setup(); f.write('untracked', 'first')
    const p = await ops.preview(source, { action: 'stash-save', includeUntracked: true })
    f.write('untracked', 'other')
    expect((await ops.execute(source, { request: p.request, version: p.version, approved: true })).reason).toBe('stale-preview')
    expect(f.gitOk(['stash', 'list'])).toBe('')
  })
  it('reports stash conflicts and keeps the entry for recovery', async () => {
    const { f, ops, source } = setup(); f.write('src/app.ts', 'stashed version\n')
    const saved = await execute(ops, source, { action: 'stash-save', includeUntracked: false })
    f.commit('src/app.ts', 'incompatible committed version\n', 'incompatible')
    const applied = await execute(ops, source, { action: 'stash-apply', stashOid: saved.stashOid! })
    expect(applied).toMatchObject({ status: 'conflicted', refresh: true, conflictRefresh: true })
    await expect(ops.preview(source, { action: 'stash-save', includeUntracked: false })).rejects.toMatchObject({ reason: 'conflicts' })
    expect(f.gitOk(['ls-files', '-u'])).not.toBe('')
    expect(f.gitOk(['stash', 'list', '--format=%H']).trim()).toBe(saved.stashOid)
  })
  it('refuses dirty stash apply and non-stash or revision-expression object selections', async () => {
    const { f, ops, source } = setup(); f.write('src/app.ts', 'stash\n')
    const saved = await execute(ops, source, { action: 'stash-save', includeUntracked: false })
    f.write('untracked', 'do not overwrite')
    await expect(ops.preview(source, { action: 'stash-apply', stashOid: saved.stashOid! })).rejects.toMatchObject({ reason: 'dirty-tree' })
    for (const stashOid of ['stash@{0}', '--help', '0'.repeat(40), f.gitOk(['rev-parse', 'HEAD']).trim()]) {
      await expect(ops.preview(source, { action: 'stash-apply', stashOid })).rejects.toMatchObject({ reason: 'invalid-stash' })
    }
  })
  it.each(['MERGE_HEAD', 'rebase-merge', 'rebase-apply', 'sequencer', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'BISECT_START'])('guards active %s for dirty interfering operations', async marker => {
    const { f, ops, source } = setup(); bare(f); f.write('src/app.ts', 'dirty\n')
    const dir = join(f.gitDir, marker)
    if (marker.includes('rebase') || marker === 'sequencer') mkdirSync(dir)
    else writeFileSync(dir, f.gitOk(['rev-parse', 'HEAD']))
    await expect(ops.preview(source, { action: 'stash-save', includeUntracked: false })).rejects.toMatchObject({ reason: 'active-operation' })
    await expect(ops.preview(source, push)).rejects.toMatchObject({ reason: 'active-operation' })
    await expect(ops.inspectHunks(source, { path: 'src/app.ts', side: 'unstaged' })).rejects.toMatchObject({ reason: 'active-operation' })
  })
  it('rejects malformed requests, missing approval, refs and unconfigured remote names', async () => {
    const { f, ops, source } = setup(); bare(f)
    for (const remote of ['--all', 'https://example.invalid/repo', 'origin;touch X', 'missing', '../origin', 'origin\nother']) {
      await expect(ops.preview(source, { action: 'fetch', remote, prune: false })).rejects.toMatchObject({ reason: 'invalid-remote' })
    }
    for (const branch of ['--force', '+main', 'main:other', 'HEAD~1', 'main\nother']) {
      await expect(ops.preview(source, { ...push, branch })).rejects.toMatchObject({ reason: 'invalid-ref' })
    }
    for (const request of [null, {}, { action: 'stash-save' }, { action: 'fetch', remote: 'origin' }, { action: 'stash-save', includeUntracked: false, message: '\0' }]) {
      await expect(ops.preview(source, request as RepositoryActionRequest)).rejects.toMatchObject({ reason: 'invalid-request' })
    }
    const p = await ops.preview(source, push)
    for (const approved of [false, 'true', undefined]) expect((await ops.execute(source, { request: push, version: p.version, approved } as RepositoryActionExecution)).reason).toBe('approval-required')
    expect((await ops.execute(source, { request: push, version: 'invalid', approved: true })).reason).toBe('invalid-version')
    expect((await ops.execute(source, null as unknown as RepositoryActionExecution)).reason).toBe('invalid-request')
  })
  it('masks credential-bearing remote inventory and never leaks stderr on read/write errors', async () => {
    const { f, runner, source, resolveRepo } = setup(); bare(f)
    // These URLs are inspected only; all actual remote I/O in the suite is local bare Git.
    f.gitOk(['remote', 'set-url', 'origin', 'https://user:secret@example.invalid/repo?token=private#secret'])
    const ops = new RepositoryActions({ runner, resolveRepo })
    const inventory = await ops.inventory(source)
    expect(JSON.stringify(inventory)).not.toMatch(/user|secret|token|private/)
    expect(inventory.remotes[0]!.fetchUrls).toEqual(['https://example.invalid/repo'])
    const read = runner.runOk.bind(runner)
    vi.spyOn(runner, 'runOk').mockImplementation(async (args, cwd, options) => {
      if (args.includes('push')) throw new Error('https://user:secret@example.invalid/repo?token=private')
      return read(args, cwd, options)
    })
    expect(JSON.stringify(await execute(ops, source, push))).not.toMatch(/secret|private/)
    const badPorts: RepositoryActionsPorts = { runner, resolveRepo: async () => { throw new Error('https://user:secret@example.invalid') } }
    await expect(new RepositoryActions(badPorts).inventory(source)).rejects.toMatchObject({ reason: 'git-failed', message: 'Git could not inspect or update this repository. Refresh and retry.' })
  })
})

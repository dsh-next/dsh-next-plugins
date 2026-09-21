// @vitest-environment node
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync, chmodSync, renameSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseRepositoryCommand, type RepositoryCommandRequest } from '../src/core/repository-commands.ts'
import { RepositoryCommands } from '../src/host/repository-commands.ts'
import { GitRunner } from '../src/host/git-runner.ts'
import { createFixture, type GitFixture } from './git-fixture.ts'
const fixtures: GitFixture[] = []
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); for (const f of fixtures.splice(0)) f.dispose() })
function setup() {
  vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null'); vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1')
  const f = createFixture('clean'); fixtures.push(f)
  const runner = new GitRunner()
  const source = { cwd: f.dir }
  const resolveRepo = async () => ({ root: f.dir, toplevel: f.dir, cwd: f.dir, gitDir: f.gitDir, commonDir: f.gitDir })
  const ops = new RepositoryCommands({ runner, resolveRepo })
  const execute = async (request: RepositoryCommandRequest) => { const p = await ops.preview(source, request); return ops.execute(source, { request, version: p.version, approved: true }) }
  return { f, runner, source, resolveRepo, ops, execute }
}
function bare(f: GitFixture) {
  const path = join(f.scratch('remote'), 'origin.git')
  f.gitOk(['init', '--bare', '-b', 'main', path]); f.gitOk(['remote', 'add', 'origin', path]); f.gitOk(['push', 'origin', 'HEAD:refs/heads/main'])
  return path
}
const requests: RepositoryCommandRequest[] = [
  { action: 'pull', remote: 'origin', branch: 'main', rebase: false }, { action: 'sync', remote: 'origin', branch: 'main' },
  { action: 'push-force', remote: 'origin', branch: 'main' }, { action: 'fetch-all', prune: false }, { action: 'publish', remote: 'origin', branch: 'main' },
  { action: 'merge', ref: 'HEAD' }, { action: 'rebase', ref: 'HEAD' }, { action: 'remote-add', name: 'new', url: '/tmp/example' }, { action: 'remote-remove', remote: 'origin' },
  { action: 'remote-branch-delete', remote: 'origin', branch: 'topic' }, { action: 'tag-create', name: 'v1', ref: 'HEAD', message: '' }, { action: 'tag-delete', tag: 'v1' },
  { action: 'remote-tag-delete', remote: 'origin', tag: 'v1' }, { action: 'tags-push', remote: 'origin' }, { action: 'stash-staged', message: '' },
  { action: 'stash-pop', stashOid: 'a'.repeat(40) }, { action: 'stash-drop', stashOid: 'a'.repeat(40) }, { action: 'stash-clear' }, { action: 'undo-commit' }, { action: 'clone', url: '/tmp/example', directory: 'new' },
]
describe('strict JSON command contract', () => {
  it.each(requests)('roundtrips $action, refuses missing, wrong-typed and extra fields', request => {
    expect(parseRepositoryCommand(request)).toEqual(request)
    expect(() => parseRepositoryCommand({ ...request, extra: true })).toThrow()
    for (const key of Object.keys(request)) {
      const bad = { ...request } as Record<string, unknown>; delete bad[key]
      expect(() => parseRepositoryCommand(bad)).toThrow()
      expect(() => parseRepositoryCommand({ ...request, [key]: 42 })).toThrow()
    }
  })
  it.each([null, [], 'pull', {}, { action: '__proto__' }, { action: 'stash-staged', message: '\0' }])('rejects invalid input %j', input => expect(() => parseRepositoryCommand(input)).toThrow())
})
describe('real Git repository commands', () => {
  it('adds/removes remotes and creates/deletes lightweight and annotated tags', async () => {
    const { f, execute } = setup(); const path = bare(f)
    expect((await execute({ action: 'remote-add', name: 'second', url: path })).status).toBe('completed')
    expect((await execute({ action: 'remote-remove', remote: 'second' })).status).toBe('completed')
    for (const message of ['', 'annotated']) {
      expect((await execute({ action: 'tag-create', name: 'v1', ref: 'HEAD', message })).status).toBe('completed')
      expect(f.gitOk(['rev-parse', 'v1^{commit}'])).toBe(f.gitOk(['rev-parse', 'HEAD']))
      expect((await execute({ action: 'tag-delete', tag: 'v1' })).status).toBe('completed')
    }
  })
  it.each(['global', 'local'] as const)('metadata operations ignore unused %s LFS declarations and never invoke active filters', async scope => {
    const { f, runner, execute } = setup()
    const marker = f.path('filter-ran')
    if (scope === 'global') {
      const config = join(f.scratch('config'), 'gitconfig')
      writeFileSync(config, '[filter "lfs"]\n clean = touch ' + marker + '\n smudge = touch ' + marker + '\n process = touch ' + marker + '\n')
      vi.stubEnv('GIT_CONFIG_GLOBAL', config)
    } else {
      for (const key of ['clean', 'smudge', 'process']) f.gitOk(['config', 'filter.lfs.' + key, 'touch ' + marker])
    }
    f.gitOk(['config', 'remote.unrelated.uploadpack', 'unexpected-helper'])
    const run = runner.runOk.bind(runner)
    vi.spyOn(runner, 'runOk').mockImplementation((args, cwd, options) => {
      expect(args).not.toContain('status'); expect(args).not.toContain('diff')
      return run(args, cwd, options)
    })
    for (const active of [false, true]) {
      if (active) f.write('.gitattributes', '* filter=lfs\n')
      const name = active ? 'active' : 'unused'
      expect((await execute({ action: 'remote-add', name, url: '/tmp/not-contacted' })).status).toBe('completed')
      expect((await execute({ action: 'remote-remove', remote: name })).status).toBe('completed')
      expect((await execute({ action: 'tag-create', name, ref: 'HEAD', message: '' })).status).toBe('completed')
      expect((await execute({ action: 'tag-delete', tag: name })).status).toBe('completed')
      expect(existsSync(marker)).toBe(false)
    }
  })
  it('stashes staged files while preserving disjoint tracked unstaged edits', async () => {
    const { f, execute } = setup()
    f.commit('unstaged', 'original', 'base')
    f.write('unstaged', 'keep me')
    f.write('staged', 'save me'); f.gitOk(['add', 'staged'])
    const saved = await execute({ action: 'stash-staged', message: 'disjoint' })
    expect(saved.status).toBe('completed')
    expect(readFileSync(f.path('unstaged'), 'utf8')).toBe('keep me')
    expect(existsSync(f.path('staged'))).toBe(false)
    expect(f.gitOk(['show', saved.stashOid + ':staged'])).toBe('save me')
    expect(f.gitOk(['diff', '--cached', '--name-only'])).toBe('')
  })
  it('fetches, pulls both ways, syncs, publishes and pushes tags using a local bare remote', async () => {
    const { f, execute } = setup(); const path = bare(f)
    for (const request of [
      { action: 'fetch-all', prune: true }, { action: 'pull', remote: 'origin', branch: 'main', rebase: false },
      { action: 'pull', remote: 'origin', branch: 'main', rebase: true }, { action: 'sync', remote: 'origin', branch: 'main' },
      { action: 'publish', remote: 'origin', branch: 'main' },
    ] as RepositoryCommandRequest[]) expect((await execute(request)).status).toBe('completed')
    expect(f.gitOk(['config', 'branch.main.remote']).trim()).toBe('origin')
    expect((await execute({ action: 'tags-push', remote: 'origin' })).status).toBe('noop')
    f.gitOk(['tag', 'v1'])
    expect((await execute({ action: 'tags-push', remote: 'origin' })).status).toBe('completed')
    expect(f.gitOk(['--git-dir=' + path, 'show-ref', '--tags'])).toContain('refs/tags/v1')
    expect((await execute({ action: 'remote-tag-delete', remote: 'origin', tag: 'v1' })).status).toBe('completed')
    f.gitOk(['push', 'origin', 'HEAD:refs/heads/topic'])
    expect((await execute({ action: 'remote-branch-delete', remote: 'origin', branch: 'topic' })).status).toBe('completed')
  })
  it('pins advertised remote force leases and refuses a moved remote', async () => {
    const { f, runner, ops, source, execute } = setup(); const path = bare(f)
    f.gitOk(['commit', '--allow-empty', '-m', 'new'])
    const request = { action: 'push-force', remote: 'origin', branch: 'main' } as const
    const p = await ops.preview(source, request)
    const old = f.gitOk(['--git-dir=' + path, 'rev-parse', 'main']).trim()
    const run = runner.runOk.bind(runner); const calls: string[][] = []
    vi.spyOn(runner, 'runOk').mockImplementation((args, cwd, options) => { calls.push([...args]); return run(args, cwd, options) })
    expect((await execute(request)).status).toBe('completed')
    expect(calls.some(args => args.includes('--force-with-lease=refs/heads/main:' + old))).toBe(true)
    expect(calls.some(args => args.includes('--force'))).toBe(false)
    expect((await ops.execute(source, { request, version: p.version, approved: true })).reason).toBe('stale-preview')
  })
  it.each(['merge', 'rebase'] as const)('%s uses resolved commits', async action => {
    const { f, execute } = setup()
    f.gitOk(['branch', 'topic']); f.gitOk(['checkout', 'topic']); f.gitOk(['commit', '--allow-empty', '-m', 'topic']); f.gitOk(['checkout', 'main'])
    expect((await execute({ action, ref: 'topic' })).status).toBe('completed')
    expect(f.gitOk(['rev-parse', 'HEAD'])).toBe(f.gitOk(['rev-parse', 'topic']))
  })
  it('undo commit preserves staged, unstaged and untracked content', async () => {
    const { f, execute } = setup(); f.gitOk(['commit', '--allow-empty', '-m', 'second'])
    f.write('staged', 'staged'); f.gitOk(['add', 'staged']); f.write('staged', 'unstaged'); f.write('loose', 'untracked')
    const index = f.gitOk(['ls-files', '--stage']); const parent = f.gitOk(['rev-parse', 'HEAD^'])
    expect((await execute({ action: 'undo-commit' })).status).toBe('completed')
    expect(f.gitOk(['rev-parse', 'HEAD'])).toBe(parent); expect(f.gitOk(['ls-files', '--stage'])).toBe(index)
    expect(readFileSync(f.path('staged'), 'utf8')).toBe('unstaged'); expect(readFileSync(f.path('loose'), 'utf8')).toBe('untracked')
  })
  it('stashes staged changes, inspects, applies then drops, drops and clears pinned stashes', async () => {
    const { f, execute, ops, source } = setup()
    f.write('staged', 'hello'); f.gitOk(['add', 'staged'])
    const saved = await execute({ action: 'stash-staged', message: 'safe' })
    expect(saved.status).toBe('completed'); expect(saved.stashOid).toMatch(/^[a-f0-9]{40}$/)
    expect((await ops.inspectStash(source, saved.stashOid!)).patch).toContain('hello')
    expect((await execute({ action: 'stash-pop', stashOid: saved.stashOid! })).status).toBe('completed')
    f.gitOk(['add', 'staged']); f.gitOk(['stash', 'push', '-m', 'one'])
    const id = f.gitOk(['rev-parse', 'stash']).trim()
    expect((await execute({ action: 'stash-drop', stashOid: id })).status).toBe('completed')
    for (const text of ['two', 'three']) { f.write('staged', text); f.gitOk(['add', 'staged']); f.gitOk(['stash', 'push', '-m', text]) }
    expect((await execute({ action: 'stash-clear' })).status).toBe('completed')
    expect(f.gitOk(['stash', 'list'])).toBe('')
    expect((await ops.output(source)).text).toContain('stash-pop: completed')
    expect((await ops.output(source)).text).not.toContain('hello')
  })
  it('clones a full checkout only into a new source-relative directory', async () => {
    const { f, execute, ops, source } = setup(); const path = bare(f)
    expect((await execute({ action: 'clone', url: path, directory: 'cloned' })).status).toBe('completed')
    expect(existsSync(f.path('cloned/.git'))).toBe(true)
    const tracked = f.gitOk(['ls-files']).trim().split('\n')
    for (const file of tracked) expect(readFileSync(f.path('cloned/' + file))).toEqual(readFileSync(f.path(file)))
    expect(f.gitOk(['status', '--porcelain'], { cwd: f.path('cloned') })).toBe('')
    for (const directory of ['../outside', '/tmp/outside', 'cloned', '.git/child']) await expect(ops.preview(source, { action: 'clone', url: path, directory })).rejects.toThrow()
    symlinkSync(f.scratch('external'), f.path('link'))
    await expect(ops.preview(source, { action: 'clone', url: path, directory: 'link/new' })).rejects.toThrow()
  })
  it('rejects stale requests, unapproved executions and active operations', async () => {
    const { f, ops, source } = setup(); const request = { action: 'tag-create', name: 'v1', ref: 'HEAD', message: '' } as const
    const p = await ops.preview(source, request)
    expect((await ops.execute(source, { request: { ...request, name: 'v2' }, version: p.version, approved: true })).reason).toBe('stale-preview')
    f.gitOk(['config', 'test.changed', 'yes'])
    expect((await ops.execute(source, { request, version: p.version, approved: true })).reason).toBe('stale-preview')
    expect((await ops.execute(source, { request, version: p.version, approved: false } as never)).reason).toBe('approval-required')
    mkdirSync(join(f.gitDir, 'rebase-merge'))
    await expect(ops.preview(source, request)).rejects.toThrow('active Git operation')
  })
  it('refuses unsafe URLs, helper configurations and option/ref injection', async () => {
    const { f, ops, source, execute } = setup(); bare(f)
    for (const url of ['ext::sh -c anything', 'evil::payload', '--upload-pack=bad', 'ftp://example.test/repo']) await expect(ops.preview(source, { action: 'remote-add', name: 'unsafe', url })).rejects.toThrow()
    await expect(ops.preview(source, { action: 'merge', ref: '--help' })).rejects.toThrow()
    await expect(ops.preview(source, { action: 'push-force', remote: 'origin', branch: '+main:other' })).rejects.toThrow()
    f.gitOk(['config', 'remote.origin.uploadpack', 'sh -c bad'])
    await expect(ops.preview(source, { action: 'fetch-all', prune: false })).rejects.toThrow('helper overrides')
    f.gitOk(['config', 'remote.origin.url', 'ext::unsafe'])
    expect((await execute({ action: 'remote-remove', remote: 'origin' })).status).toBe('completed')
  })
  it('refuses dirty merges and unstaged staged-only stash without losing data', async () => {
    const { f, ops, source } = setup()
    f.write('new', 'untracked')
    await expect(ops.preview(source, { action: 'merge', ref: 'HEAD' })).rejects.toThrow('clean checkout')
    f.gitOk(['add', 'new']); f.write('new', 'unstaged')
    await expect(ops.preview(source, { action: 'stash-staged', message: '' })).rejects.toThrow('unstaged')
    expect(readFileSync(f.path('new'), 'utf8')).toBe('unstaged')
  })
  it.each(['merge', 'rebase', 'pull'] as const)('%s tolerates unrelated ignored dependencies and rejects ignored collisions', async action => {
    const { f, execute } = setup()
    f.commit('.gitignore', 'node_modules/\ncollision\n', 'ignore build data')
    if (action === 'pull') bare(f)
    f.gitOk(['checkout', '-b', 'topic'])
    f.write('collision', 'remote data'); f.gitOk(['add', '-f', 'collision']); f.commitIndex('collision')
    f.gitOk(['checkout', 'main'])
    f.write('node_modules/pkg/large', 'x'.repeat(9 * 1024 * 1024))
    const request: RepositoryCommandRequest = action === 'pull' ? { action, remote: 'origin', branch: 'main', rebase: false } : { action, ref: 'HEAD' }
    expect((await execute(request)).status).toBe('completed')
    f.write('collision', 'keep me')
    if (action === 'pull') f.gitOk(['push', 'origin', 'topic:main'])
    const colliding: RepositoryCommandRequest = action === 'pull' ? request : { action, ref: 'topic' }
    expect((await execute(colliding)).reason).toBe('ignored-collision')
    expect(readFileSync(f.path('collision'), 'utf8')).toBe('keep me')
  })
  it('accepts SCP SSH addresses and preserves configured credential helpers', async () => {
    const { f, runner, execute } = setup()
    f.gitOk(['config', 'credential.helper', 'osxkeychain'])
    const run = runner.runOk.bind(runner); const calls: string[][] = []
    vi.spyOn(runner, 'runOk').mockImplementation((args, cwd, options) => { calls.push([...args]); return run(args, cwd, options) })
    expect((await execute({ action: 'remote-add', name: 'github', url: 'git@github.com:owner/repo.git' })).status).toBe('completed')
    expect(f.gitOk(['remote', 'get-url', 'github']).trim()).toBe('git@github.com:owner/repo.git')
    expect(calls.flat()).not.toContain('credential.helper=')
  })
  it('never runs clone checkout hooks and refuses executable filters before cloning', async () => {
    const { f, execute, ops, source } = setup(); const path = bare(f)
    const hooks = f.scratch('hooks'), marker = join(hooks, 'ran')
    writeFileSync(join(hooks, 'post-checkout'), '#!/bin/sh\ntouch "' + marker + '"\n'); chmodSync(join(hooks, 'post-checkout'), 0o755)
    const config = join(f.scratch('config'), 'gitconfig')
    writeFileSync(config, '[core]\n hooksPath = ' + hooks + '\n')
    vi.stubEnv('GIT_CONFIG_GLOBAL', config)
    expect((await execute({ action: 'clone', url: path, directory: 'checkout' })).status).toBe('completed')
    expect(existsSync(marker)).toBe(false)
    writeFileSync(config, '[filter "unsafe"]\n smudge = touch ' + marker + '\n')
    await expect(ops.preview(source, { action: 'clone', url: path, directory: 'filtered' })).rejects.toThrow('Executable filters')
    expect(existsSync(f.path('filtered'))).toBe(false)
  })
  it.each(['stash-drop', 'stash-pop', 'stash-clear'] as const)('%s refuses external ref locks without deleting or applying a stash', async action => {
    const { f, ops, source } = setup()
    f.write('saved', 'precious'); f.gitOk(['add', 'saved']); f.gitOk(['stash', 'push'])
    const id = f.gitOk(['rev-parse', 'stash']).trim()
    const request: RepositoryCommandRequest = action === 'stash-clear' ? { action } : { action, stashOid: id }
    const preview = await ops.preview(source, request)
    writeFileSync(join(f.gitDir, 'refs/stash.lock'), 'external writer')
    expect((await ops.execute(source, { request, version: preview.version, approved: true })).status).toBe('failed')
    expect(f.gitOk(['rev-parse', 'stash']).trim()).toBe(id)
    expect(readFileSync(join(f.gitDir, 'refs/stash.lock'), 'utf8')).toBe('external writer')
    expect(existsSync(f.path('saved'))).toBe(false)
  })
  it.each(['stash-drop', 'stash-pop', 'stash-clear'] as const)('%s rejects an external arrival after final preview validation', async action => {
    const { f, runner, execute } = setup()
    f.write('saved', 'precious'); f.gitOk(['add', 'saved']); f.gitOk(['stash', 'push'])
    const id = f.gitOk(['rev-parse', 'stash']).trim()
    const external = f.gitOk(['commit-tree', id + '^{tree}', '-p', id + '^1', '-p', id + '^2', '-m', 'external']).trim()
    const run = runner.runSoft.bind(runner); let arrived = false
    vi.spyOn(runner, 'runSoft').mockImplementation(async (args, cwd, options) => {
      if (args.includes('extensions.refStorage') && !arrived) {
        arrived = true; f.gitOk(['stash', 'store', '-m', 'external arrival', external])
      }
      return run(args, cwd, options)
    })
    const request: RepositoryCommandRequest = action === 'stash-clear' ? { action } : { action, stashOid: id }
    expect((await execute(request)).reason).toBe('stash-changed')
    expect(f.gitOk(['stash', 'list', '--format=%H']).trim().split('\n')).toEqual([external, id])
    expect(existsSync(f.path('saved'))).toBe(false)
    expect(existsSync(join(f.gitDir, 'refs/stash.lock'))).toBe(false)
  })
  it('holds the real stash ref lock across pop apply and preserves the reflog on application failure', async () => {
    const { f, runner, execute } = setup()
    f.write('saved', 'precious'); f.gitOk(['add', 'saved']); f.gitOk(['stash', 'push'])
    const id = f.gitOk(['rev-parse', 'stash']).trim()
    const run = runner.runOk.bind(runner)
    vi.spyOn(runner, 'runOk').mockImplementation(async (args, cwd, options) => {
      if (args.includes('apply')) {
        expect(existsSync(join(f.gitDir, 'refs/stash.lock'))).toBe(true)
        expect(f.git(['update-ref', 'refs/stash', id]).code).not.toBe(0)
        throw new Error('simulated application failure')
      }
      return run(args, cwd, options)
    })
    expect((await execute({ action: 'stash-pop', stashOid: id })).status).toBe('failed')
    expect(f.gitOk(['rev-parse', 'stash']).trim()).toBe(id)
    expect(existsSync(join(f.gitDir, 'refs/stash.lock'))).toBe(false)
  })
  it.each(['refs', 'logs', 'logs/refs', 'refs/stash', 'logs/refs/stash', 'packed-refs'])('refuses symlinked stash metadata %s before preview reads', async path => {
    const { f, ops, source } = setup()
    f.write('saved', 'precious'); f.gitOk(['add', 'saved']); f.gitOk(['stash', 'push'])
    const id = f.gitOk(['rev-parse', 'stash']).trim()
    if (path === 'packed-refs') writeFileSync(join(f.gitDir, path), '# pack-refs with: peeled\n')
    const outside = join(f.scratch('outside'), 'metadata')
    renameSync(join(f.gitDir, path), outside)
    symlinkSync(outside, join(f.gitDir, path))
    await expect(ops.preview(source, { action: 'stash-drop', stashOid: id })).rejects.toThrow('stash metadata')
    expect(existsSync(outside)).toBe(true)
  })
  it.each(['refs/stash.lock', 'logs/refs/stash.lock', 'packed-refs.lock'])('preserves foreign replacement of owned %s after apply', async path => {
    const { f, runner, execute } = setup()
    f.write('saved', 'precious'); f.gitOk(['add', 'saved']); f.gitOk(['stash', 'push'])
    const id = f.gitOk(['rev-parse', 'stash']).trim()
    const log = readFileSync(join(f.gitDir, 'logs/refs/stash'))
    const run = runner.runOk.bind(runner)
    vi.spyOn(runner, 'runOk').mockImplementation(async (args, cwd, options) => {
      if (args.includes('apply')) {
        unlinkSync(join(f.gitDir, path)); writeFileSync(join(f.gitDir, path), 'foreign lock')
        return ''
      }
      return run(args, cwd, options)
    })
    expect((await execute({ action: 'stash-pop', stashOid: id })).reason).toBe('stash-changed')
    expect(readFileSync(join(f.gitDir, path), 'utf8')).toBe('foreign lock')
    expect(readFileSync(join(f.gitDir, 'logs/refs/stash'))).toEqual(log)
    expect(f.gitOk(['rev-parse', 'stash']).trim()).toBe(id)
  })
  it('refuses a symlinked log ancestor introduced during stash apply without writing outside', async () => {
    const { f, runner, execute } = setup()
    f.write('saved', 'precious'); f.gitOk(['add', 'saved']); f.gitOk(['stash', 'push'])
    const id = f.gitOk(['rev-parse', 'stash']).trim()
    const outside = join(f.scratch('outside'), 'logs')
    const run = runner.runOk.bind(runner)
    vi.spyOn(runner, 'runOk').mockImplementation(async (args, cwd, options) => {
      if (args.includes('apply')) {
        renameSync(join(f.gitDir, 'logs'), outside); symlinkSync(outside, join(f.gitDir, 'logs'))
        return ''
      }
      return run(args, cwd, options)
    })
    const log = readFileSync(join(f.gitDir, 'logs/refs/stash'))
    expect((await execute({ action: 'stash-pop', stashOid: id })).reason).toBe('unsafe-stash-path')
    expect(readFileSync(join(outside, 'refs/stash'))).toEqual(log)
    expect(readFileSync(join(outside, 'refs/stash.lock'), 'utf8')).toBe('')
  })
  it('drops a middle stash by identity, rewrites the chain and permits subsequent Git stash operations', async () => {
    const { f, execute } = setup(); const ids: string[] = []
    for (const value of ['one', 'two', 'three']) {
      f.write('saved', value); f.gitOk(['add', 'saved']); f.gitOk(['stash', 'push', '-m', value]); ids.push(f.gitOk(['rev-parse', 'stash']).trim())
    }
    expect((await execute({ action: 'stash-drop', stashOid: ids[1]! })).status).toBe('completed')
    expect(f.gitOk(['stash', 'list', '--format=%H']).trim().split('\n')).toEqual([ids[2], ids[0]])
    f.gitOk(['stash', 'pop'])
    expect(readFileSync(f.path('saved'), 'utf8')).toBe('three')
    expect(f.gitOk(['stash', 'list', '--format=%H']).trim()).toBe(ids[0])
  })
  it('logs only safe command outcomes, not credential-bearing URLs or raw failures', async () => {
    const { runner, ops, source, execute } = setup()
    const run = runner.runOk.bind(runner)
    vi.spyOn(runner, 'runOk').mockImplementation(async (args, cwd, options) => {
      if (args.includes('remote') && args.includes('add')) throw new Error('https://user:password@example.test token=secret')
      return run(args, cwd, options)
    })
    expect((await execute({ action: 'remote-add', name: 'test', url: 'https://user:password@example.test/repo' })).status).toBe('failed')
    expect(await ops.output(source)).toEqual({ text: 'remote-add: failed' })
    await expect(ops.inspectStash(source, 'not-an-oid')).rejects.toThrow('current stash')
  })
  it('sanitizes authority failures and never leaks stderr secrets', async () => {
    const { runner, source } = setup()
    const ops = new RepositoryCommands({ runner, resolveRepo: async () => { throw new Error('https://secret:password@example.test') } })
    await expect(ops.output(source)).rejects.toThrow('Git could not safely')
    expect(JSON.stringify(await ops.execute(source, { request: { action: 'stash-clear' }, approved: true, version: 'a'.repeat(64) }))).not.toContain('password')
  })
})

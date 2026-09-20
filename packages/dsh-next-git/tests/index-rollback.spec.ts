import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs/promises'
import { chmodSync, existsSync, lstatSync, readFileSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { GitRunner } from '../src/host/git-runner.ts'
import type { RepoRef } from '../src/host/git-service.ts'
import { captureIndexSnapshot, restoreIndexSnapshot, type IndexSnapshot } from '../src/host/index-rollback.ts'
import { createFixture, type GitFixture } from './git-fixture.ts'

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, open: vi.fn(actual.open), rename: vi.fn(actual.rename) }
})
const actualFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
let fixture: GitFixture
let runner: GitRunner
let repo: RepoRef
let index: string
let lock: string

function setup(scenario: 'clean' | 'unborn' = 'clean'): void {
  fixture = createFixture(scenario)
  runner = new GitRunner(async (_file, args, options) => fixture.git(args, { cwd: options.cwd }))
  repo = { root: fixture.dir, toplevel: fixture.dir, cwd: fixture.dir, gitDir: fixture.gitDir, commonDir: fixture.gitDir }
  index = join(repo.gitDir, 'index')
  lock = index + '.lock'
}

async function capture(): Promise<IndexSnapshot> {
  const snapshot = await captureIndexSnapshot(runner, repo)
  expect(snapshot).not.toBeNull()
  return snapshot!
}

function stage(): string {
  fixture.write('src/app.ts', 'plugin staged content\n')
  fixture.gitOk(['add', '-A'])
  return fixture.gitOk(['write-tree']).trim()
}

beforeEach(() => {
  vi.mocked(fs.open).mockReset().mockImplementation(actualFs.open)
  vi.mocked(fs.rename).mockReset().mockImplementation(actualFs.rename)
})
afterEach(() => { vi.restoreAllMocks(); fixture?.dispose() })

describe('index rollback with real Git', () => {
  it('restores exact partial staged bytes/mode, retaining later hook working-tree edits', async () => {
    setup()
    fixture.write('src/app.ts', 'previous partial stage\n')
    fixture.gitOk(['add', 'src/app.ts'])
    chmodSync(index, 0o640)
    const bytes = readFileSync(index)
    const snapshot = await capture()
    const tree = stage()
    fixture.write('src/app.ts', 'hook changed working copy\n')
    fixture.write('hook-output.txt', 'hook output survives\n')
    expect(await restoreIndexSnapshot(runner, repo, snapshot, tree)).toBe(true)
    expect(readFileSync(index)).toEqual(bytes)
    expect(lstatSync(index).mode & 0o777).toBe(0o640)
    expect(fixture.gitOk(['show', ':src/app.ts'])).toBe('previous partial stage\n')
    expect(readFileSync(fixture.path('src/app.ts'), 'utf8')).toBe('hook changed working copy\n')
    expect(readFileSync(fixture.path('hook-output.txt'), 'utf8')).toBe('hook output survives\n')
    expect(existsSync(lock)).toBe(false)
  })

  it('preserves external staged-only content added after a precheck but before lock acquisition', async () => {
    setup()
    const snapshot = await capture()
    const tree = stage()
    expect(fixture.gitOk(['write-tree']).trim()).toBe(tree) // The old, unsafe precheck.
    let externalBytes: Buffer | undefined
    vi.mocked(fs.open).mockImplementation(async (path, flags, mode) => {
      if (path === lock && flags === 'wx') {
        fixture.write('external.txt', 'external staged-only content\n')
        fixture.gitOk(['add', '--', 'external.txt'])
        fixture.remove('external.txt')
        externalBytes = readFileSync(index)
      }
      return actualFs.open(path, flags, mode)
    })
    expect(await restoreIndexSnapshot(runner, repo, snapshot, tree)).toBe(false)
    expect(externalBytes).toBeDefined()
    expect(readFileSync(index)).toEqual(externalBytes)
    expect(fixture.gitOk(['show', ':external.txt'])).toBe('external staged-only content\n')
    expect(existsSync(lock)).toBe(false)
  })

  it('performs read-only logical verification while holding the real exclusive lock', async () => {
    setup()
    const snapshot = await capture()
    const tree = stage()
    const runBytes = runner.runBytesOk.bind(runner)
    const calls: string[] = []
    vi.spyOn(runner, 'runBytesOk').mockImplementation(async (args, cwd, options) => {
      expect(existsSync(lock)).toBe(true)
      calls.push(args[0]!)
      if (args[0] === 'ls-files') {
        await expect(actualFs.open(lock, 'wx')).rejects.toMatchObject({ code: 'EEXIST' })
      }
      return runBytes(args, cwd, options)
    })
    const run = vi.spyOn(runner, 'run')
    expect(await restoreIndexSnapshot(runner, repo, snapshot, tree)).toBe(true)
    expect(calls).toEqual(['ls-tree', 'ls-files'])
    expect(run.mock.calls.every(([args, , options]) => !args.includes('write-tree') && !args.includes('read-tree') && !options?.lockRetries)).toBe(true)
  })

  it('never steals an existing lock and consumes the snapshot without retries', async () => {
    setup()
    const snapshot = await capture()
    const tree = stage()
    const bytes = readFileSync(index)
    writeFileSync(lock, 'external lock')
    expect(await restoreIndexSnapshot(runner, repo, snapshot, tree)).toBe(false)
    expect(readFileSync(lock, 'utf8')).toBe('external lock')
    unlinkSync(lock)
    expect(await restoreIndexSnapshot(runner, repo, snapshot, tree)).toBe(false)
    expect(readFileSync(index)).toEqual(bytes)
    expect(vi.mocked(fs.open).mock.calls.filter(([path, flags]) => path === lock && flags === 'wx')).toHaveLength(1)
  })

  it('refuses changed HEAD and changed symbolic HEAD even at the same commit', async () => {
    setup()
    const snapshot = await capture()
    const tree = stage()
    fixture.gitOk(['update-ref', 'HEAD', fixture.gitOk(['rev-parse', 'HEAD^']).trim()])
    const bytes = readFileSync(index)
    expect(await restoreIndexSnapshot(runner, repo, snapshot, tree)).toBe(false)
    expect(readFileSync(index)).toEqual(bytes)
    const second = await capture()
    fixture.gitOk(['branch', 'other'])
    fixture.gitOk(['symbolic-ref', 'HEAD', 'refs/heads/other'])
    expect(await restoreIndexSnapshot(runner, repo, second, tree)).toBe(false)
    expect(readFileSync(index)).toEqual(bytes)
    expect(existsSync(lock)).toBe(false)
  })

  it('rechecks HEAD after logical verification', async () => {
    setup()
    const snapshot = await capture()
    const tree = stage()
    const bytes = readFileSync(index)
    const runBytes = runner.runBytesOk.bind(runner)
    vi.spyOn(runner, 'runBytesOk').mockImplementation(async (args, cwd, options) => {
      const result = await runBytes(args, cwd, options)
      if (args[0] === 'ls-files') fixture.gitOk(['update-ref', 'HEAD', fixture.gitOk(['rev-parse', 'HEAD^']).trim()])
      return result
    })
    expect(await restoreIndexSnapshot(runner, repo, snapshot, tree)).toBe(false)
    expect(readFileSync(index)).toEqual(bytes)
    expect(existsSync(lock)).toBe(false)
  })

  it('restores absent unborn index without deleting newly created worktree files', async () => {
    setup('unborn')
    expect(existsSync(index)).toBe(false)
    const snapshot = await capture()
    const tree = stage()
    expect(await restoreIndexSnapshot(runner, repo, snapshot, tree)).toBe(true)
    expect(existsSync(index)).toBe(false)
    expect(existsSync(lock)).toBe(false)
    expect(readFileSync(fixture.path('src/app.ts'), 'utf8')).toBe('plugin staged content\n')
    expect(fixture.gitOk(['ls-files'])).toBe('')
  })

  it('restores an existing unborn index and its staged selection', async () => {
    setup('unborn')
    fixture.write('first.txt', 'first staged\n')
    fixture.gitOk(['add', 'first.txt'])
    const bytes = readFileSync(index)
    const snapshot = await capture()
    expect(await restoreIndexSnapshot(runner, repo, snapshot, stage())).toBe(true)
    expect(readFileSync(index)).toEqual(bytes)
  })

  it('preserves raw assume-unchanged and skip-worktree flags', async () => {
    setup()
    fixture.gitOk(['update-index', '--assume-unchanged', 'README.md'])
    fixture.gitOk(['update-index', '--skip-worktree', 'src/app.ts'])
    const before = fixture.gitOk(['ls-files', '-v'])
    const bytes = readFileSync(index)
    const snapshot = await capture()
    fixture.gitOk(['update-index', '--no-assume-unchanged', 'README.md'])
    fixture.gitOk(['update-index', '--no-skip-worktree', 'src/app.ts'])
    expect(await restoreIndexSnapshot(runner, repo, snapshot, stage())).toBe(true)
    expect(readFileSync(index)).toEqual(bytes)
    expect(fixture.gitOk(['ls-files', '-v'])).toBe(before)
  })

  it('handles unusual filename bytes, modes and symlink entries without touching their files', async () => {
    setup()
    // APFS rejects invalid UTF-8; Linux also exercises the byte-reversible path.
    const suffix = process.platform === 'darwin' ? Buffer.from('é') : Buffer.from([0xff])
    const unusual = Buffer.concat([Buffer.from(fixture.dir + '/odd\t\n'), suffix])
    writeFileSync(unusual, 'raw filename\n')
    fixture.write('executable', 'executable\n')
    chmodSync(fixture.path('executable'), 0o755)
    symlinkSync('src/app.ts', fixture.path('link'))
    fixture.gitOk(['add', '-A'])
    const snapshot = await capture()
    const bytes = readFileSync(index)
    expect(await restoreIndexSnapshot(runner, repo, snapshot, stage())).toBe(true)
    expect(readFileSync(index)).toEqual(bytes)
    expect(readFileSync(unusual, 'utf8')).toBe('raw filename\n')
    expect(lstatSync(fixture.path('link')).isSymbolicLink()).toBe(true)
  })

  it('supports the active index of a linked worktree, leaving the primary index alone', async () => {
    setup()
    const primary = readFileSync(index)
    const cwd = fixture.addWorktree('rollback')
    const gitDir = fixture.gitOk(['rev-parse', '--absolute-git-dir'], { cwd }).trim()
    repo = { ...repo, toplevel: cwd, cwd, gitDir }
    index = join(gitDir, 'index')
    lock = index + '.lock'
    const bytes = readFileSync(index)
    const snapshot = await capture()
    writeFileSync(join(cwd, 'new.txt'), 'linked worktree\n')
    fixture.gitOk(['add', '-A'], { cwd })
    const tree = fixture.gitOk(['write-tree'], { cwd }).trim()
    expect(await restoreIndexSnapshot(runner, repo, snapshot, tree)).toBe(true)
    expect(readFileSync(index)).toEqual(bytes)
    expect(readFileSync(join(fixture.gitDir, 'index'))).toEqual(primary)
  })

  it.each(['index', 'HEAD', 'config', 'refs/heads/main'])('refuses symlink metadata leaf %s at capture', async leaf => {
    setup()
    const path = join(fixture.gitDir, leaf)
    const outside = join(fixture.scratch('outside'), 'saved')
    renameSync(path, outside)
    symlinkSync(outside, path)
    const bytes = readFileSync(outside)
    expect(await captureIndexSnapshot(runner, repo)).toBeNull()
    expect(readFileSync(outside)).toEqual(bytes)
    expect(existsSync(lock)).toBe(false)
  })

  it('refuses symlink metadata directories and outside RepoRef paths', async () => {
    setup()
    const outside = join(fixture.scratch('metadata'), 'actual-git')
    renameSync(fixture.gitDir, outside)
    symlinkSync(outside, fixture.gitDir)
    expect(await captureIndexSnapshot(runner, repo)).toBeNull()
    expect(await captureIndexSnapshot(runner, { ...repo, gitDir: outside, commonDir: outside })).toBeNull()
  })

  it('refuses an active outside index discovered by the shared runner', async () => {
    setup()
    const outside = join(fixture.scratch('index'), 'index')
    writeFileSync(outside, readFileSync(index))
    const alternative = new GitRunner(async (_file, args, options) => fixture.git(args, { cwd: options.cwd, env: { GIT_INDEX_FILE: outside } }))
    expect(await captureIndexSnapshot(alternative, repo)).toBeNull()
    expect(existsSync(outside + '.lock')).toBe(false)
  })

  it.each(['index', 'index.lock'])('refuses a symlink %s introduced after capture', async leaf => {
    setup()
    const snapshot = await capture()
    const tree = stage()
    const outside = join(fixture.scratch('outside'), 'index')
    const path = join(repo.gitDir, leaf)
    if (leaf === 'index') renameSync(path, outside)
    else writeFileSync(outside, 'external lock target')
    symlinkSync(outside, path)
    const bytes = readFileSync(outside)
    expect(await restoreIndexSnapshot(runner, repo, snapshot, tree)).toBe(false)
    expect(readFileSync(outside)).toEqual(bytes)
    expect(lstatSync(path).isSymbolicLink()).toBe(true)
  })

  it('declines capture for split indexes, locks, unreadable files, and oversized files', async () => {
    setup()
    fixture.gitOk(['update-index', '--split-index'])
    expect(await captureIndexSnapshot(runner, repo)).toBeNull()
    fixture.gitOk(['update-index', '--no-split-index'])
    writeFileSync(lock, 'busy')
    expect(await captureIndexSnapshot(runner, repo)).toBeNull()
    unlinkSync(lock)
    const open = actualFs.open
    vi.mocked(fs.open).mockImplementation(async (path, flags, mode) => {
      if (path === index) throw Object.assign(new Error('denied'), { code: 'EACCES' })
      return open(path, flags, mode)
    })
    expect(await captureIndexSnapshot(runner, repo)).toBeNull()
    vi.mocked(fs.open).mockImplementation(actualFs.open)
    await actualFs.truncate(index, 32 * 1024 * 1024 + 1)
    expect(await captureIndexSnapshot(runner, repo)).toBeNull()
  })

  it.each(['writeFile', 'sync', 'rename', 'git'])('contains %s errors, closes the fd, and cleans only its own lock', async failure => {
    setup()
    const snapshot = await capture()
    const tree = stage()
    const bytes = readFileSync(index)
    let handle: fs.FileHandle | undefined
    let closed: ReturnType<typeof vi.spyOn> | undefined
    vi.mocked(fs.open).mockImplementation(async (path, flags, mode) => {
      const opened = await actualFs.open(path, flags, mode)
      if (path === lock && flags === 'wx') {
        handle = opened
        closed = vi.spyOn(opened, 'close')
        if (failure === 'writeFile' || failure === 'sync') vi.spyOn(opened, failure).mockRejectedValue(new Error('injected I/O failure'))
      }
      return opened
    })
    if (failure === 'rename') vi.mocked(fs.rename).mockRejectedValue(new Error('rename refused'))
    if (failure === 'git') vi.spyOn(runner, 'runBytesOk').mockRejectedValue(new Error('read failed'))
    const hookError = new Error('original hook failure')
    const commitCatch = async (): Promise<never> => {
      try { throw hookError } catch (error) {
        expect(await restoreIndexSnapshot(runner, repo, snapshot, tree)).toBe(false)
        throw error
      }
    }
    await expect(commitCatch()).rejects.toBe(hookError)
    expect(readFileSync(index)).toEqual(bytes)
    expect(existsSync(lock)).toBe(false)
    expect(closed).toHaveBeenCalledOnce()
    expect(handle!.fd).toBe(-1)
  })

  it('does not unlink a foreign lock replacing the owned lock', async () => {
    setup()
    const snapshot = await capture()
    const tree = stage()
    const bytes = readFileSync(index)
    const runBytes = runner.runBytesOk.bind(runner)
    vi.spyOn(runner, 'runBytesOk').mockImplementation(async (args, cwd, options) => {
      const result = await runBytes(args, cwd, options)
      if (args[0] === 'ls-files') {
        unlinkSync(lock)
        writeFileSync(lock, 'foreign replacement')
      }
      return result
    })
    expect(await restoreIndexSnapshot(runner, repo, snapshot, tree)).toBe(false)
    expect(readFileSync(index)).toEqual(bytes)
    expect(readFileSync(lock, 'utf8')).toBe('foreign replacement')
  })

  it('closes a capture fd on read failure without ever creating a lock', async () => {
    setup()
    let handle: fs.FileHandle | undefined
    vi.mocked(fs.open).mockImplementation(async (path, flags, mode) => {
      const opened = await actualFs.open(path, flags, mode)
      if (path === index) {
        handle = opened
        vi.spyOn(opened, 'read').mockRejectedValue(new Error('snapshot read failed'))
      }
      return opened
    })
    expect(await captureIndexSnapshot(runner, repo)).toBeNull()
    expect(handle!.fd).toBe(-1)
    expect(existsSync(lock)).toBe(false)
  })

  it('declines capture when the index grows during the bounded read', async () => {
    setup()
    vi.mocked(fs.open).mockImplementation(async (path, flags, mode) => {
      const opened = await actualFs.open(path, flags, mode)
      if (path === index) {
        const read = opened.read.bind(opened)
        vi.spyOn(opened, 'read').mockImplementationOnce(async (...args) => {
          await actualFs.appendFile(index, 'concurrent append')
          return read(...args)
        })
      }
      return opened
    })
    expect(await captureIndexSnapshot(runner, repo)).toBeNull()
    expect(existsSync(lock)).toBe(false)
  })

  it('declines a non-cooperating index rewrite after lock-held logical verification', async () => {
    setup()
    const snapshot = await capture()
    const tree = stage()
    const runBytes = runner.runBytesOk.bind(runner)
    let external: Buffer | undefined
    vi.spyOn(runner, 'runBytesOk').mockImplementation(async (args, cwd, options) => {
      const result = await runBytes(args, cwd, options)
      if (args[0] === 'ls-files') {
        external = Buffer.concat([readFileSync(index), Buffer.from('external change')])
        writeFileSync(index, external)
      }
      return result
    })
    expect(await restoreIndexSnapshot(runner, repo, snapshot, tree)).toBe(false)
    expect(readFileSync(index)).toEqual(external)
    expect(existsSync(lock)).toBe(false)
  })

  it.each(['truncated', 'conflicted'])('declines %s logical entries without modifying the index', async kind => {
    setup()
    const snapshot = await capture()
    const tree = stage()
    const bytes = readFileSync(index)
    const runBytes = runner.runBytesOk.bind(runner)
    vi.spyOn(runner, 'runBytesOk').mockImplementation(async (args, cwd, options) => {
      const result = await runBytes(args, cwd, options)
      if (args[0] !== 'ls-files') return result
      if (kind === 'truncated') return result.subarray(0, result.length - 1)
      return Buffer.from(Buffer.from(result).toString('latin1').replace(' 0\t', ' 1\t'), 'latin1')
    })
    expect(await restoreIndexSnapshot(runner, repo, snapshot, tree)).toBe(false)
    expect(readFileSync(index)).toEqual(bytes)
    expect(existsSync(lock)).toBe(false)
  })

  it('restores the previous index from an owned empty staged tree', async () => {
    setup()
    const snapshot = await capture()
    const bytes = readFileSync(index)
    fixture.gitOk(['rm', '--cached', '-r', '.'])
    const tree = fixture.gitOk(['write-tree']).trim()
    expect(await restoreIndexSnapshot(runner, repo, snapshot, tree)).toBe(true)
    expect(readFileSync(index)).toEqual(bytes)
    expect(existsSync(fixture.path('README.md'))).toBe(true)
  })

  it('declines unreadable HEAD rather than confusing failure with unborn HEAD', async () => {
    setup('unborn')
    const snapshot = await capture()
    const tree = stage()
    const bytes = readFileSync(index)
    const run = runner.run.bind(runner)
    vi.spyOn(runner, 'run').mockImplementation(async (args, cwd, options) => {
      if (args.includes('--verify') && args.includes('HEAD')) return { code: 128, stdout: '', stderr: 'read failure' }
      return run(args, cwd, options)
    })
    expect(await restoreIndexSnapshot(runner, repo, snapshot, tree)).toBe(false)
    expect(readFileSync(index)).toEqual(bytes)
    expect(existsSync(lock)).toBe(false)
  })

  it('refuses invalid tree identifiers, forged snapshots and cross-repository reuse', async () => {
    setup()
    const snapshot = await capture()
    const tree = stage()
    expect(await restoreIndexSnapshot(runner, repo, snapshot, '--help')).toBe(false)
    expect(await restoreIndexSnapshot(runner, repo, { indexPath: index }, tree)).toBe(false)
    const second = await capture()
    expect(await restoreIndexSnapshot(runner, { ...repo, cwd: fixture.path('src') }, second, tree)).toBe(false)
    expect(existsSync(lock)).toBe(false)
  })
})

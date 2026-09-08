// Disposable diagnosis harness. Exercises production wiring with temporary repositories only.
import { mkdir, readFile, realpath, symlink, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply } from '../src/index.ts'
import { registerRpc } from '../src/host/rpc.ts'
import { GitRunner } from '../src/host/git.ts'
import { RegistryStore } from '../src/host/registry-store.ts'
import { WorktreesService, type ServicePorts } from '../src/host/service.ts'
import { commitFile, makeTempRepo, runGit } from './git-fixture.ts'

vi.mock('../src/host/rpc.ts', () => ({ registerRpc: vi.fn() }))

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((fn) => fn()))
  vi.clearAllMocks()
})

async function repo() {
  const fixture = await makeTempRepo()
  cleanup.push(fixture.cleanup)
  return realpath(fixture.dir)
}

function productionService(): WorktreesService {
  apply({
    get: () => undefined,
    provide: () => {},
  } as never)
  return vi.mocked(registerRpc).mock.calls.at(-1)![1]
}

describe('diagnostic worktree creation safety', () => {
  it.each(['symlink', 'regular-file', 'skip-copy'] as const)(
    'does not overwrite a primary file through a checked-out include: %s', async (mode) => {
    const primary = await repo()
    const victim = join(primary, 'untouched.txt')
    await writeFile(victim, 'keep this primary file\n')
    if (mode === 'regular-file') await writeFile(join(primary, '.env.local'), 'old configuration\n')
    else await symlink(victim, join(primary, '.env.local'))
    await commitFile(primary, '.worktreeinclude', mode === 'skip-copy' ? '' : '.env.local\n', 'include local config')
    runGit(primary, ['add', '.env.local'])
    runGit(primary, ['commit', '-q', '-m', 'track config link'])
    await unlink(join(primary, '.env.local'))
    await writeFile(join(primary, '.env.local'), 'fixture configuration\n')

    const created = await productionService().create({ cwd: primary, name: 'include-test' })

    expect(created.path).not.toBe(primary)
    expect(await readFile(victim, 'utf8')).toBe('keep this primary file\n')
  })

  it('skips an included path whose checked-out parent is a symlink', async () => {
    const primary = await repo()
    const external = join(primary, 'outside')
    await mkdir(external)
    await writeFile(join(external, 'config.env'), 'keep this primary file\n')
    await symlink(external, join(primary, 'config'))
    await commitFile(primary, '.worktreeinclude', 'config/config.env\n', 'include nested config')
    runGit(primary, ['add', 'config'])
    runGit(primary, ['commit', '-q', '-m', 'track config link'])
    await unlink(join(primary, 'config'))
    await mkdir(join(primary, 'config'))
    await writeFile(join(primary, 'config/config.env'), 'local configuration\n')

    await productionService().create({ cwd: primary, name: 'include-parent-link' })

    expect(await readFile(join(external, 'config.env'), 'utf8')).toBe('keep this primary file\n')
  })

  it('runs setup in both repositories when they use the same folder name', async () => {
    const first = await repo()
    const second = await repo()
    for (const cwd of [first, second]) {
      await writeFile(join(cwd, '.worktrees.json'), JSON.stringify({
        'setup-worktree': ['printf setup-ok > setup.done'],
      }))
    }
    const service = productionService()
    const a = await service.create({ cwd: first, name: 'same-name' })
    await service.setup({ cwd: first, slug: a.slug })
    expect(await readFile(join(a.path, 'setup.done'), 'utf8')).toBe('setup-ok')

    const b = await service.create({ cwd: second, name: 'same-name' })
    await service.setup({ cwd: second, slug: b.slug })
    const contents = await readFile(join(b.path, 'setup.done'), 'utf8').catch(() => null)
    expect(contents).toBe('setup-ok')
  })

  it.each(['same-name', 'different-name', 'separate-service'] as const)(
    'reports the correct repository failure for concurrent setups: %s', async (mode) => {
    const first = await repo()
    const second = await repo()
    for (const cwd of [first, second]) {
      await writeFile(join(cwd, '.worktrees.json'), JSON.stringify({ 'setup-worktree': ['fixture-setup'] }))
    }
    type Result = Awaited<ReturnType<NonNullable<ServicePorts['runCommand']>>>
    const pending = new Map<string, (result: Result) => void>()
    let bothEntered!: () => void
    const entered = new Promise<void>((resolve) => { bothEntered = resolve })
    const makeService = () => new WorktreesService({
      git: new GitRunner(), store: new RegistryStore(),
      getSessionCwd: () => null, applySandboxMode: () => true, isSessionRunning: () => false,
      copyFile: async () => {},
      readText: async (path) => readFile(path, 'utf8').catch(() => null),
      runCommand: (input) => new Promise<Result>((resolve) => {
        pending.set(input.env.ROOT_WORKTREE_PATH!, resolve)
        if (pending.size === 2) bothEntered()
      }),
    })
    const service = makeService()
    const secondService = mode === 'separate-service' ? makeService() : service
    const a = await service.create({ cwd: first, name: 'same-name' })
    const b = await secondService.create({ cwd: second, name: mode === 'different-name' ? 'another-name' : 'same-name' })
    await entered
    pending.get(first)!({ code: 1, stdout: '', stderr: 'first repository failed' })
    pending.get(second)!({ code: 0, stdout: '', stderr: '' })
    await expect(service.setup({ cwd: first, slug: a.slug })).rejects.toMatchObject({
      code: 'setup-failed', hint: 'first repository failed',
    })
    await expect(secondService.setup({ cwd: second, slug: b.slug })).resolves.toBeUndefined()
  })
})

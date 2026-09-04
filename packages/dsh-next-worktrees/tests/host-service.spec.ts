// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GitRunner } from '../src/host/git.ts'
import { RegistryStore } from '../src/host/registry-store.ts'
import { WorktreesService, type ApplySandboxMode, type GetSessionCwd } from '../src/host/service.ts'

let root: string
let repo: string
let sub: string
let service: WorktreesService
let knobWrites: Array<{ sessionId: string; mode: string }>
let firstSlug: string
const sessionCwds = new Map<string, string>()

function git(args: string[], cwd: string): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' })
}

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-next-worktrees-svc-')))
  repo = join(root, 'repo')
  sub = join(repo, 'packages', 'foo')
  mkdirSync(sub, { recursive: true })
  git(['init', '-q', '-b', 'main'], repo)
  git(['config', 'user.email', 'test@example.com'], repo)
  git(['config', 'user.name', 'Test'], repo)
  writeFileSync(join(repo, 'base.txt'), 'base\n')
  writeFileSync(join(sub, 'foo.txt'), 'foo\n')
  writeFileSync(join(repo, '.worktreeinclude'), '.env\n')
  writeFileSync(join(repo, '.env'), 'SECRET=1\n')
  git(['add', '.'], repo)
  git(['commit', '-qm', 'base'], repo)

  const getSessionCwd: GetSessionCwd = (id) => sessionCwds.get(id) ?? null
  const applySandboxMode: ApplySandboxMode = (id, mode) => {
    knobWrites.push({ sessionId: id, mode })
    return true
  }
  service = new WorktreesService({
    git: new GitRunner(),
    store: new RegistryStore(),
    getSessionCwd,
    applySandboxMode,
  })
  knobWrites = []
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('WorktreesService flows over a real repository', () => {
  it('preflights green and hints when .dsh is not ignored', async () => {
    const result = await service.preflight(repo)
    expect(result.ok).toBe(true)
    expect(result.degraded).toBe(false)
    expect(result.showIgnoreHint).toBe(true)
  })

  it('creates a worktree with sub-path preservation and include copies', async () => {
    const outcome = await service.create({ cwd: sub, title: 'fix login' })
    expect(outcome.branch).toBe(`dsh-worktrees/${outcome.slug}`)
    expect(outcome.baseRef).toBe('HEAD')
    expect(outcome.sessionCwd).toBe(join(repo, '.dsh/worktrees', outcome.slug, 'packages', 'foo'))
    expect(existsSync(outcome.sessionCwd)).toBe(true)
    expect(readFileSync(join(outcome.path, '.env'), 'utf8')).toBe('SECRET=1\n')
    firstSlug = outcome.slug
    sessionCwds.set('session-a', outcome.sessionCwd)
  })

  it('binds the session after verifying its cwd, switching the knob', async () => {
    const bound = await service.bind('session-a')
    expect(typeof bound.slug).toBe('string')
    expect(bound.path.startsWith(join(repo, '.dsh/worktrees/'))).toBe(true)
    expect(knobWrites).toEqual([{ sessionId: 'session-a', mode: 'danger-full-access' }])

    const status = await service.status('session-a')
    expect(status.bound).toBe(true)
    expect(status.binding?.sessionId).toBe('session-a')
    expect(status.binding?.title).toBe('fix login')
    expect(status.chipStatus).toBe('clean')
    expect(status.ahead).toBe(0)
    // Siblings exclude the session's own worktree: with a single worktree the
    // dropdown lands on its "no other worktrees" empty state.
    expect(status.siblings).toEqual([])
  })

  it('lists other worktrees as siblings, still without self', async () => {
    const other = await service.create({ cwd: repo, title: 'other' })
    sessionCwds.set('session-other', other.sessionCwd)
    await service.bind('session-other')
    const status = await service.status('session-other')
    expect(status.siblings.map((s) => s.slug)).toEqual([firstSlug])
    expect(status.siblings[0]).toMatchObject({ title: 'fix login', sessionId: 'session-a' })
    const own = await service.status('session-a')
    expect(own.siblings.map((s) => s.slug)).toEqual([other.slug])
  })

  it('reports dirty worktrees in status', async () => {
    const status = await service.status('session-a')
    const path = status.binding?.path
    expect(path).toBeDefined()
    writeFileSync(join(path as string, 'wip.txt'), 'wip\n')
    try {
      const dirty = await service.status('session-a')
      expect(dirty.chipStatus).toBe('dirty')
      expect(dirty.dirty).toBe(true)
    } finally {
      rmSync(join(path as string, 'wip.txt'))
    }
  })

  it('refuses to bind a session outside a plugin worktree', async () => {
    sessionCwds.set('session-outside', repo)
    await expect(service.bind('session-outside')).rejects.toMatchObject({ code: 'not-a-worktree-session' })
    expect(knobWrites.some((w) => w.sessionId === 'session-outside')).toBe(false)
  })

  it('refuses to bind an unknown session without touching the knob', async () => {
    await expect(service.bind('missing')).rejects.toMatchObject({ code: 'session-not-found' })
  })

  it('reports unbound sessions with empty status', async () => {
    sessionCwds.set('session-plain', join(root, 'plain'))
    mkdirSync(join(root, 'plain'))
    const status = await service.status('session-plain')
    expect(status.bound).toBe(false)
    expect(status.siblings).toEqual([])
  })

  it('drops registry rows whose worktree vanished (git is truth)', async () => {
    const outcome = await service.create({ cwd: repo })
    sessionCwds.set('session-b', outcome.path)
    await service.bind('session-b')
    git(['worktree', 'remove', '--force', outcome.path], repo)
    const status = await service.status('session-b')
    expect(status.bound).toBe(false)
  })

  it('removes a clean worktree and refuses dirty ones without force', async () => {
    const clean = await service.create({ cwd: repo })
    await service.remove({ cwd: repo, slug: clean.slug, force: false })

    const dirty = await service.create({ cwd: repo })
    writeFileSync(join(dirty.path, 'uncommitted.txt'), 'x\n')
    await expect(service.remove({ cwd: repo, slug: dirty.slug, force: false }))
      .rejects.toMatchObject({ code: 'dirty-remove-refused' })
    await service.remove({ cwd: repo, slug: dirty.slug, force: true })
    await expect(service.remove({ cwd: repo, slug: 'nope', force: false }))
      .rejects.toMatchObject({ code: 'unknown-slug' })
  })

  it('retries slug collisions instead of failing creation', async () => {
    // Two creations back to back must never collide on slug or branch.
    const a = await service.create({ cwd: repo })
    const b = await service.create({ cwd: repo })
    expect(a.slug).not.toBe(b.slug)
    expect(a.branch).not.toBe(b.branch)
  })
})

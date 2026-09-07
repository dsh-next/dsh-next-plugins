import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { MemoryBlobStore } from '../src/host/blobs.ts'
import { CheckpointsService, type DiskPorts, type SessionLike } from '../src/host/service.ts'
import type { GitPorts } from '../src/host/git.ts'
import type { HeadInfo } from '../src/core/types.ts'
import { checkpointId } from '../src/core/store.ts'

class FakeGit implements GitPorts {
  current: HeadInfo | null = { sha: 'aaa', short: 'aaa', branch: 'main' }
  status: string[] = []
  shown = new Map<string, Uint8Array>()

  async head(): Promise<HeadInfo | null> { return this.current }
  async statusNames(): Promise<readonly string[]> { return this.status }
  async show(_cwd: string, sha: string, path: string): Promise<Uint8Array | null> {
    return this.shown.get(`${sha}:${path}`) ?? null
  }
}

class FakeDisk implements DiskPorts {
  files = new Map<string, Uint8Array>()
  kinds = new Map<string, 'text' | 'binary' | 'symlink' | 'directory' | 'too-large' | 'missing'>()

  async inspect(absPath: string) {
    const forced = this.kinds.get(absPath)
    if (forced === 'symlink' || forced === 'directory' || forced === 'too-large' || forced === 'missing') {
      return { kind: forced, bytes: null, mtimeMs: null }
    }
    const bytes = this.files.get(absPath)
    if (bytes === undefined) return { kind: 'missing' as const, bytes: null, mtimeMs: null }
    if (forced === 'binary' || [...bytes].includes(0)) return { kind: 'binary' as const, bytes, mtimeMs: 1_700_000_000_000 }
    return { kind: 'text' as const, bytes, mtimeMs: 1_700_000_000_000 }
  }
  async writeFile(absPath: string, bytes: Uint8Array) { this.files.set(absPath, bytes) }
  async deleteFile(absPath: string) { this.files.delete(absPath) }
  async listFiles(cwd: string) {
    const root = cwd.replace(/\/+$/, '')
    return [...this.files.keys()].filter((path) => path === root || path.startsWith(`${root}/`))
  }
}

function session(
  id: string,
  cwd: string,
  events: readonly { type: string; seq: number; data?: unknown }[] = [],
): SessionLike & { appends: unknown[]; nodes: number[]; seq: number } {
  const appends: unknown[] = []
  const nodes: number[] = []
  return {
    id,
    header: { cwd },
    seq: 0,
    get surface() { return { nodes } },
    appends,
    nodes,
    snapshotEvents: () => events,
    append(type, data, opts) {
      appends.push({ type, data, opts })
      const seq = nodes.length === 0 ? 0 : Math.max(...nodes) + 1
      nodes.push(seq)
      return { seq }
    },
  }
}

describe('CheckpointsService', () => {
  async function setup(
    forkSession?: (session: SessionLike, boundary: number) => SessionLike | undefined,
    extras: {
      reclaimWorktree?: (from: string, to: string) => Promise<void>
      attachWorkspace?: (from: string, to: string) => Promise<void>
    } = {},
  ) {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-next-checkpoints-'))
    const git = new FakeGit()
    const disk = new FakeDisk()
    const blobs = new MemoryBlobStore()
    const live = new Map<string, SessionLike>()
    const service = new CheckpointsService({
      blobs,
      git,
      disk,
      dataDir: dir,
      now: () => 1_700_000_000_000,
      getSession: (id) => live.get(id),
      ...forkSession === undefined ? {} : { forkSession },
      ...extras,
    })
    return { dir, git, disk, service, live }
  }

  it('snapshots a write at turn/end and projects a create hunk', async () => {
    const { service, disk, live, dir } = await setup()
    const sess = session('s1', '/repo')
    live.set('s1', sess)
    service.attach(sess)
    await service.whenIdle('s1')
    service.noteIntent(sess, '/repo/a.ts', 'a.ts', '/repo/a.ts')
    await service.whenIdle('s1')
    disk.files.set('/repo/a.ts', new TextEncoder().encode('hello\n'))
    service.onEvent(sess, { type: 'turn/start', seq: 0, data: { turn: 1 } })
    service.onEvent(sess, { type: 'turn/end', seq: 4, data: { turn: 1 } })
    const listed = await service.list('s1')
    expect(listed.checkpoints.map((item) => item.turn)).toEqual([0, 1])
    const diffs = await service.diffs('s1', listed.checkpoints[1]!.id)
    expect(diffs.files[0]?.kind).toBe('create')
    expect(diffs.files[0]?.hunks[0]?.oldText).toBeNull()
    await rm(dir, { recursive: true, force: true })
  })

  it('caps the user prompt on a turn checkpoint', async () => {
    const { service, disk, live, dir } = await setup()
    const sess = session('s1', '/repo', [{
      type: 'user/message',
      seq: 1,
      data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'Improve the header design' }] },
    }])
    live.set('s1', sess)
    disk.files.set('/repo/a.ts', new TextEncoder().encode('hello\n'))
    service.attach(sess)
    await service.noteIntent(sess, '/repo/a.ts', 'a.ts', '/repo/a.ts')
    service.onEvent(sess, { type: 'turn/end', seq: 4, data: { turn: 1 } })
    const listed = await service.list('s1')
    expect(listed.checkpoints.find((item) => item.turn === 1)?.promptPreview).toBe('Improve the header design')
    await rm(dir, { recursive: true, force: true })
  })

  it('refuses rewind while a turn is open', async () => {
    const { service, disk, live, dir } = await setup()
    const sess = session('s1', '/repo')
    live.set('s1', sess)
    disk.files.set('/repo/a.ts', new TextEncoder().encode('v1\n'))
    service.attach(sess)
    service.noteIntent(sess, '/repo/a.ts', 'a.ts', '/repo/a.ts')
    service.onEvent(sess, { type: 'turn/end', seq: 2, data: { turn: 1 } })
    const id = (await service.list('s1')).checkpoints[0]!.id
    service.onEvent(sess, { type: 'turn/start', seq: 3, data: { turn: 2 } })
    await expect(service.rewind('s1', id)).rejects.toMatchObject({ code: 'turn-open' })
    await rm(dir, { recursive: true, force: true })
  })

  it('rewinds files, shadows later surface nodes, leaves git ports untouched', async () => {
    const { service, disk, live, git, dir } = await setup()
    const sess = session('s1', '/repo')
    sess.nodes.push(0, 1, 5, 8)
    live.set('s1', sess)
    disk.files.set('/repo/a.ts', new TextEncoder().encode('v1\n'))
    service.attach(sess)
    service.noteIntent(sess, '/repo/a.ts', 'a.ts', '/repo/a.ts')
    service.onEvent(sess, { type: 'turn/end', seq: 2, data: { turn: 1 } })
    await service.whenIdle('s1')
    disk.files.set('/repo/a.ts', new TextEncoder().encode('v2\n'))
    await service.noteIntent(sess, '/repo/b.ts', 'b.ts', '/repo/b.ts')
    disk.files.set('/repo/b.ts', new TextEncoder().encode('new\n'))
    service.onEvent(sess, { type: 'turn/end', seq: 9, data: { turn: 2 } })
    await service.whenIdle('s1')
    const listed = await service.list('s1')
    const first = listed.checkpoints.find((item) => item.turn === 1)!.id
    expect(first).toBe(checkpointId('s1', 1, 2))
    const preview = await service.preview('s1', first)
    expect(preview.headMoved).toBe(false)
    expect(preview.turnsShadowed).toBe(1)
    const result = await service.rewind('s1', first)
    expect(result.ok).toBe(true)
    expect(new TextDecoder().decode(disk.files.get('/repo/a.ts'))).toBe('v1\n')
    expect(disk.files.has('/repo/b.ts')).toBe(false)
    expect(sess.appends).toHaveLength(1)
    const append = sess.appends[0] as { opts: { surfaceOp: { op: string; start: number; end: number } } }
    expect(append.opts.surfaceOp.op).toBe('replace')
    expect(append.opts.surfaceOp.start).toBe(5)
    expect(append.opts.surfaceOp.end).toBe(8)
    expect((git as FakeGit).current?.sha).toBe('aaa')
    const after = await service.list('s1')
    expect(after.checkpoints.map((item) => item.turn)).toEqual([0, 1])
    expect(after.rewoundTo).toBe(first)
    await rm(dir, { recursive: true, force: true })
  })

  it('forks a child session so Chat can drop later turns', async () => {
    const child = session('child', '/repo')
    const { service, disk, live, dir } = await setup(() => child)
    const sess = session('s1', '/repo')
    live.set('s1', sess)
    live.set('child', child)
    disk.files.set('/repo/a.ts', new TextEncoder().encode('v1\n'))
    service.attach(sess)
    await service.noteIntent(sess, '/repo/a.ts', 'a.ts', '/repo/a.ts')
    disk.files.set('/repo/a.ts', new TextEncoder().encode('v2\n'))
    service.onEvent(sess, { type: 'turn/end', seq: 2, data: { turn: 1 } })
    await service.whenIdle('s1')
    const origin = (await service.list('s1')).checkpoints.find((item) => item.turn === 0)!
    const result = await service.rewind('s1', origin.id)
    expect(result.nextSessionId).toBe('child')
    const childList = await service.list('child')
    expect(childList.checkpoints.map((item) => item.turn)).toEqual([0])
    await rm(dir, { recursive: true, force: true })
  })

  it('attaches the forked session to the parent workspace', async () => {
    const child = session('child', '/repo')
    const attachWorkspace = vi.fn().mockResolvedValue(undefined)
    const { service, disk, live, dir } = await setup(() => child, { attachWorkspace })
    const sess = session('s1', '/repo')
    live.set('s1', sess)
    live.set('child', child)
    disk.files.set('/repo/a.ts', new TextEncoder().encode('v1\n'))
    service.attach(sess)
    await service.noteIntent(sess, '/repo/a.ts', 'a.ts', '/repo/a.ts')
    service.onEvent(sess, { type: 'turn/end', seq: 2, data: { turn: 1 } })
    await service.whenIdle('s1')
    const origin = (await service.list('s1')).checkpoints.find((item) => item.turn === 0)!
    await service.rewind('s1', origin.id)
    expect(attachWorkspace).toHaveBeenCalledWith('s1', 'child')
    await rm(dir, { recursive: true, force: true })
  })

  it('still forks when workspace attach throws', async () => {
    const child = session('child', '/repo')
    const { service, disk, live, dir } = await setup(() => child, {
      attachWorkspace: vi.fn().mockRejectedValue(new Error('attach refused')),
    })
    const sess = session('s1', '/repo')
    live.set('s1', sess)
    live.set('child', child)
    disk.files.set('/repo/a.ts', new TextEncoder().encode('v1\n'))
    service.attach(sess)
    await service.noteIntent(sess, '/repo/a.ts', 'a.ts', '/repo/a.ts')
    service.onEvent(sess, { type: 'turn/end', seq: 2, data: { turn: 1 } })
    await service.whenIdle('s1')
    const origin = (await service.list('s1')).checkpoints.find((item) => item.turn === 0)!
    const result = await service.rewind('s1', origin.id)
    expect(result.nextSessionId).toBe('child')
    await rm(dir, { recursive: true, force: true })
  })

  it('reclaims a plugin worktree onto the forked session', async () => {
    const child = session('child', '/repo/.dsh/worktrees/swift-01')
    const reclaim = vi.fn().mockResolvedValue(undefined)
    const { service, disk, live, dir } = await setup(() => child, { reclaimWorktree: reclaim })
    const sess = session('s1', '/repo/.dsh/worktrees/swift-01')
    live.set('s1', sess)
    live.set('child', child)
    disk.files.set('/repo/.dsh/worktrees/swift-01/a.ts', new TextEncoder().encode('v1\n'))
    service.attach(sess)
    await service.noteIntent(sess, '/repo/.dsh/worktrees/swift-01/a.ts', 'a.ts', '/repo/.dsh/worktrees/swift-01/a.ts')
    service.onEvent(sess, { type: 'turn/end', seq: 2, data: { turn: 1 } })
    await service.whenIdle('s1')
    const origin = (await service.list('s1')).checkpoints.find((item) => item.turn === 0)!
    await service.rewind('s1', origin.id)
    expect(reclaim).toHaveBeenCalledWith('s1', 'child')
    await rm(dir, { recursive: true, force: true })
  })

  it('warns when HEAD moved and still allows rewind', async () => {
    const { service, disk, live, git, dir } = await setup()
    const sess = session('s1', '/repo')
    live.set('s1', sess)
    disk.files.set('/repo/a.ts', new TextEncoder().encode('v1\n'))
    service.attach(sess)
    service.noteIntent(sess, '/repo/a.ts', 'a.ts', '/repo/a.ts')
    service.onEvent(sess, { type: 'turn/end', seq: 2, data: { turn: 1 } })
    await service.whenIdle('s1')
    git.current = { sha: 'bbb', short: 'bbb', branch: 'main' }
    const id = (await service.list('s1')).checkpoints.find((item) => item.turn === 1)!.id
    const preview = await service.preview('s1', id)
    expect(preview.headMoved).toBe(true)
    expect(preview.blockers).toEqual([])
    await rm(dir, { recursive: true, force: true })
  })

  it('lists a live in-progress checkpoint and diffs current disk', async () => {
    const { service, disk, live, dir } = await setup()
    const sess = session('s1', '/repo')
    live.set('s1', sess)
    service.attach(sess)
    await service.whenIdle('s1')
    service.onEvent(sess, { type: 'turn/start', seq: 0, data: { turn: 1 } })
    await service.noteIntent(sess, '/repo/a.ts', 'a.ts', '/repo/a.ts')
    disk.files.set('/repo/a.ts', new TextEncoder().encode('hello\n'))
    const listed = await service.list('s1')
    expect(listed.openTurn).toBe(true)
    const liveRow = listed.checkpoints.find((item) => item.live)
    expect(liveRow?.turn).toBe(1)
    expect(liveRow?.id).toContain(':live:')
    expect(listed.checkpoints.filter((item) => item.live)).toHaveLength(1)
    const diffs = await service.diffs('s1', liveRow!.id)
    expect(diffs.files[0]?.kind).toBe('create')
    expect(liveRow?.added).toBeGreaterThan(0)
    const livePreview = await service.preview('s1', liveRow!.id)
    expect(livePreview.blockers).toContain('turn-open')
    expect(livePreview.turnsShadowed).toBe(0)
    await expect(service.rewind('s1', liveRow!.id)).rejects.toMatchObject({ code: 'turn-open' })
    service.onEvent(sess, { type: 'turn/end', seq: 4, data: { turn: 1 } })
    const after = await service.list('s1')
    expect(after.openTurn).toBe(false)
    expect(after.checkpoints.some((item) => item.live)).toBe(false)
    expect(after.checkpoints.map((item) => item.turn)).toEqual([0, 1])
    await rm(dir, { recursive: true, force: true })
  })

  it('commits the live turn when the agent goes idle after Stop', async () => {
    const { service, disk, live, dir } = await setup()
    const sess = session('s1', '/repo')
    live.set('s1', sess)
    service.attach(sess)
    await service.whenIdle('s1')
    service.onEvent(sess, { type: 'turn/start', seq: 0, data: { turn: 1 } })
    await service.noteIntent(sess, '/repo/a.ts', 'a.ts', '/repo/a.ts')
    disk.files.set('/repo/a.ts', new TextEncoder().encode('hello\n'))
    expect((await service.list('s1')).openTurn).toBe(true)
    sess.seq = 7
    service.onAgentIdle(sess)
    const after = await service.list('s1')
    expect(after.openTurn).toBe(false)
    expect(after.checkpoints.some((item) => item.live)).toBe(false)
    expect(after.checkpoints.map((item) => item.turn)).toEqual([0, 1])
    const committed = after.checkpoints.find((item) => item.turn === 1)!
    expect(committed.id).not.toContain(':live:')
    expect((await service.preview('s1', committed.id)).blockers).toEqual([])
    await expect(service.rewind('s1', committed.id)).resolves.toMatchObject({ ok: true })
    await rm(dir, { recursive: true, force: true })
  })

  it('does not double-commit when idle follows turn/end', async () => {
    const { service, disk, live, dir } = await setup()
    const sess = session('s1', '/repo')
    live.set('s1', sess)
    service.attach(sess)
    await service.whenIdle('s1')
    service.onEvent(sess, { type: 'turn/start', seq: 0, data: { turn: 1 } })
    await service.noteIntent(sess, '/repo/a.ts', 'a.ts', '/repo/a.ts')
    disk.files.set('/repo/a.ts', new TextEncoder().encode('hello\n'))
    service.onEvent(sess, { type: 'turn/end', seq: 4, data: { turn: 1 } })
    service.onAgentIdle(sess)
    expect((await service.list('s1')).checkpoints.map((item) => item.turn)).toEqual([0, 1])
    await rm(dir, { recursive: true, force: true })
  })

  it('closes an open turn from turn/end even without data.turn', async () => {
    const { service, disk, live, dir } = await setup()
    const sess = session('s1', '/repo')
    live.set('s1', sess)
    service.attach(sess)
    await service.whenIdle('s1')
    service.onEvent(sess, { type: 'turn/start', seq: 0, data: { turn: 1 } })
    await service.noteIntent(sess, '/repo/a.ts', 'a.ts', '/repo/a.ts')
    disk.files.set('/repo/a.ts', new TextEncoder().encode('hello\n'))
    service.onEvent(sess, { type: 'turn/end', seq: 4 })
    const after = await service.list('s1')
    expect(after.openTurn).toBe(false)
    expect(after.checkpoints.map((item) => item.turn)).toEqual([0, 1])
    await rm(dir, { recursive: true, force: true })
  })

  it('capture snapshots the cwd as the next turn-boundary checkpoint', async () => {
    const { service, disk, live, git, dir } = await setup()
    const sess = session('s1', '/repo')
    live.set('s1', sess)
    service.attach(sess)
    await service.whenIdle('s1')
    disk.files.set('/repo/a.ts', new TextEncoder().encode('hello\n'))
    git.status = ['a.ts']
    const captured = await service.capture('s1')
    expect(captured.turn).toBe(1)
    const listed = await service.list('s1')
    expect(listed.checkpoints.map((item) => item.turn)).toEqual([0, 1])
    const diffs = await service.diffs('s1', captured.checkpointId)
    expect(diffs.files[0]?.kind).toBe('create')
    await rm(dir, { recursive: true, force: true })
  })

  it('does not show later edits as deletes on an earlier chat-only turn', async () => {
    const { service, disk, live, git, dir } = await setup()
    const sess = session('s1', '/repo')
    live.set('s1', sess)
    disk.files.set('/repo/App.jsx', new TextEncoder().encode('original\n'))
    git.shown.set('aaa:src/App.jsx', new TextEncoder().encode('original\n'))
    git.shown.set('aaa:App.jsx', new TextEncoder().encode('original\n'))
    service.attach(sess)
    await service.whenIdle('s1')
    service.onEvent(sess, { type: 'turn/end', seq: 2, data: { turn: 1 } })
    await service.whenIdle('s1')
    await service.noteIntent(sess, '/repo/App.jsx', 'App.jsx', '/repo/App.jsx')
    disk.files.set('/repo/App.jsx', new TextEncoder().encode('rewritten\n'))
    service.onEvent(sess, { type: 'turn/end', seq: 9, data: { turn: 2 } })
    await service.whenIdle('s1')
    const listed = await service.list('s1')
    const chat = listed.checkpoints.find((item) => item.turn === 1)!
    const edit = listed.checkpoints.find((item) => item.turn === 2)!
    expect((await service.diffs('s1', chat.id)).files).toEqual([])
    const edited = await service.diffs('s1', edit.id)
    expect(edited.files).toHaveLength(1)
    expect(edited.files[0]?.kind).toBe('diff')
    expect(edited.files[0]?.displayPath).toBe('App.jsx')
    await service.rewind('s1', chat.id)
    expect(new TextDecoder().decode(disk.files.get('/repo/App.jsx'))).toBe('original\n')
    await rm(dir, { recursive: true, force: true })
  })

  it('does not absorb git-dirty files this session never touched', async () => {
    const { service, disk, live, git, dir } = await setup()
    const sess = session('s1', '/repo')
    live.set('s1', sess)
    disk.files.set('/repo/other.ts', new TextEncoder().encode('from another session\n'))
    git.shown.set('aaa:dirty.ts', new TextEncoder().encode('original\n'))
    disk.files.set('/repo/dirty.ts', new TextEncoder().encode('already dirty\n'))
    git.status = ['other.ts', 'dirty.ts']
    service.attach(sess)
    await service.whenIdle('s1')
    service.onEvent(sess, { type: 'turn/end', seq: 2, data: { turn: 1 } })
    const listed = await service.list('s1')
    const turn = listed.checkpoints.find((item) => item.turn === 1)!
    expect((await service.diffs('s1', turn.id)).files).toEqual([])
    await rm(dir, { recursive: true, force: true })
  })

  it('follows a session-touched file after a bash move to a subdirectory', async () => {
    const { service, disk, live, git, dir } = await setup()
    const sess = session('s1', '/repo')
    live.set('s1', sess)
    service.attach(sess)
    await service.noteIntent(sess, '/repo/notes-kettle.txt', 'notes-kettle.txt', '/repo/notes-kettle.txt')
    disk.files.set('/repo/notes-kettle.txt', new TextEncoder().encode('alpha\n'))
    service.onEvent(sess, { type: 'turn/end', seq: 2, data: { turn: 1 } })
    await service.whenIdle('s1')
    const first = (await service.list('s1')).checkpoints.find((item) => item.turn === 1)!
    expect((await service.diffs('s1', first.id)).files.map((file) => file.displayPath)).toEqual(['notes-kettle.txt'])
    git.status = []
    disk.files.delete('/repo/notes-kettle.txt')
    disk.files.set('/repo/random-files/notes-kettle.txt', new TextEncoder().encode('alpha\n'))
    service.onEvent(sess, { type: 'turn/end', seq: 9, data: { turn: 2 } })
    await service.whenIdle('s1')
    const second = (await service.list('s1')).checkpoints.find((item) => item.turn === 2)!
    const files = (await service.diffs('s1', second.id)).files
    expect(files.map((file) => file.displayPath)).toEqual(['random-files/notes-kettle.txt'])
    expect(files[0]?.kind).toBe('create')
    git.status = ['random-files/notes-kettle.txt']
    const preview = await service.preview('s1', first.id)
    expect(preview.dirtyNonAgent.some((path) => path.includes('random-files'))).toBe(true)
    await rm(dir, { recursive: true, force: true })
  })

  it('capture of a tracked file missing from disk projects a delete', async () => {
    const { service, disk, live, git, dir } = await setup()
    const sess = session('s1', '/repo')
    live.set('s1', sess)
    git.shown.set('aaa:gone.ts', new TextEncoder().encode('doomed\n'))
    git.status = ['gone.ts']
    service.attach(sess)
    await service.whenIdle('s1')
    const captured = await service.capture('s1')
    const files = (await service.diffs('s1', captured.checkpointId)).files
    expect(files).toHaveLength(1)
    expect(files[0]?.kind).toBe('delete')
    expect(files[0]?.displayPath).toBe('gone.ts')
    expect(disk.files.has('/repo/gone.ts')).toBe(false)
    await rm(dir, { recursive: true, force: true })
  })

  it('a session-created then deleted file has no net row on the later checkpoint', async () => {
    const { service, disk, live, git, dir } = await setup()
    const sess = session('s1', '/repo')
    live.set('s1', sess)
    service.attach(sess)
    await service.whenIdle('s1')
    disk.files.set('/repo/gone.ts', new TextEncoder().encode('doomed\n'))
    git.status = ['gone.ts']
    const created = await service.capture('s1')
    expect((await service.diffs('s1', created.checkpointId)).files[0]?.kind).toBe('create')
    disk.files.delete('/repo/gone.ts')
    git.status = []
    const later = await service.capture('s1')
    expect((await service.diffs('s1', later.checkpointId)).files).toEqual([])
    await rm(dir, { recursive: true, force: true })
  })

  it('does not treat capture-seeded git names as non-agent dirty', async () => {
    const { service, disk, live, git, dir } = await setup()
    const sess = session('s1', '/repo')
    live.set('s1', sess)
    service.attach(sess)
    await service.whenIdle('s1')
    disk.files.set('/repo/a.ts', new TextEncoder().encode('hello\n'))
    git.status = ['a.ts']
    const captured = await service.capture('s1')
    const preview = await service.preview('s1', captured.checkpointId)
    expect(preview.dirtyNonAgent).toEqual([])
    await rm(dir, { recursive: true, force: true })
  })

  it('restores binary bytes and refuses missing blobs and unrestorable symlinks', async () => {
    const { service, disk, live, git, dir } = await setup()
    const sess = session('s1', '/repo')
    live.set('s1', sess)
    disk.files.set('/repo/a.bin', new Uint8Array([65, 0, 66]))
    git.status = ['a.bin']
    service.attach(sess)
    const captured = await service.capture('s1')
    disk.files.set('/repo/a.bin', new TextEncoder().encode('changed\n'))
    const result = await service.rewind('s1', captured.checkpointId)
    expect(result.ok).toBe(true)
    expect([...disk.files.get('/repo/a.bin')!]).toEqual([65, 0, 66])

    disk.kinds.set('/repo/link', 'symlink')
    git.status = ['link']
    const withLink = await service.capture('s1')
    disk.kinds.set('/repo/link', 'text')
    disk.files.set('/repo/link', new TextEncoder().encode('now a file\n'))
    const preview = await service.preview('s1', withLink.checkpointId)
    expect(preview.blockers).toContain('unrestorable')
    await expect(service.rewind('s1', withLink.checkpointId)).rejects.toMatchObject({ code: 'unrestorable' })
    await rm(dir, { recursive: true, force: true })
  })

  it('refuses capture while a turn is open and unknown sessions', async () => {
    const { service, live, dir } = await setup()
    const sess = session('s1', '/repo')
    live.set('s1', sess)
    service.attach(sess)
    service.onEvent(sess, { type: 'turn/start', seq: 0, data: { turn: 1 } })
    await expect(service.capture('s1')).rejects.toMatchObject({ code: 'turn-open' })
    await expect(service.capture('missing')).rejects.toMatchObject({ code: 'session-not-found' })
    await expect(service.diffs('s1', 'nope')).rejects.toMatchObject({ code: 'checkpoint-not-found' })
    await rm(dir, { recursive: true, force: true })
  })

  it('still truncates the generation when surface replace throws', async () => {
    const { service, disk, live, dir } = await setup()
    const sess = session('s1', '/repo')
    sess.nodes.push(0, 1, 5)
    sess.append = () => { throw new Error('surface') }
    live.set('s1', sess)
    disk.files.set('/repo/a.ts', new TextEncoder().encode('v1\n'))
    service.attach(sess)
    await service.noteIntent(sess, '/repo/a.ts', 'a.ts', '/repo/a.ts')
    service.onEvent(sess, { type: 'turn/end', seq: 2, data: { turn: 1 } })
    await service.whenIdle('s1')
    disk.files.set('/repo/a.ts', new TextEncoder().encode('v2\n'))
    await service.noteIntent(sess, '/repo/a.ts', 'a.ts', '/repo/a.ts')
    service.onEvent(sess, { type: 'turn/end', seq: 9, data: { turn: 2 } })
    const first = (await service.list('s1')).checkpoints.find((item) => item.turn === 1)!.id
    const result = await service.rewind('s1', first)
    expect(result.ok).toBe(true)
    expect((await service.list('s1')).checkpoints.map((item) => item.turn)).toEqual([0, 1])
    expect(new TextDecoder().decode(disk.files.get('/repo/a.ts'))).toBe('v1\n')
    await rm(dir, { recursive: true, force: true })
  })

  it('rewinds to session start to restore baseline file bytes', async () => {
    const { service, disk, live, dir } = await setup()
    const sess = session('s1', '/repo')
    live.set('s1', sess)
    disk.files.set('/repo/a.ts', new TextEncoder().encode('v0\n'))
    service.attach(sess)
    await service.noteIntent(sess, '/repo/a.ts', 'a.ts', '/repo/a.ts')
    disk.files.set('/repo/a.ts', new TextEncoder().encode('v1\n'))
    service.onEvent(sess, { type: 'turn/end', seq: 2, data: { turn: 1 } })
    await service.whenIdle('s1')
    const origin = (await service.list('s1')).checkpoints.find((item) => item.turn === 0)!
    const result = await service.rewind('s1', origin.id)
    expect(result.ok).toBe(true)
    expect(new TextDecoder().decode(disk.files.get('/repo/a.ts'))).toBe('v0\n')
    expect((await service.list('s1')).checkpoints.map((item) => item.turn)).toEqual([0])
    await rm(dir, { recursive: true, force: true })
  })

  it('does not write paths that escape the session cwd', async () => {
    const { service, disk, live, dir } = await setup()
    const sess = session('s1', '/repo')
    live.set('s1', sess)
    service.replaceState({
      sessionId: 's1',
      cwd: '/repo',
      sessionStartHead: null,
      baseline: {},
      intentKeys: [],
      openTurn: null,
      rewoundTo: null,
      seqCursor: 1,
      checkpoints: [{
        id: 's1:1:1',
        sessionId: 's1',
        turn: 1,
        seq: 1,
        time: 1,
        head: null,
        tree: [{
          targetKey: '/etc/passwd',
          displayPath: '../etc/passwd',
          kind: 'text',
          blobHash: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
        }],
      }],
    })
    const preview = await service.preview('s1', 's1:1:1')
    expect(preview.blockers).toContain('unrestorable')
    expect(disk.files.has('/etc/passwd')).toBe(false)
    await rm(dir, { recursive: true, force: true })
  })
})

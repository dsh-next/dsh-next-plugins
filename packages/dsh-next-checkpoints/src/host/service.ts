/**
 * Checkpoint orchestration: snapshot at turn/end, project cumulative diffs,
 * rewind files + model surface together. Checkpoints are not git.
 */
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionSeq } from '@deepseek-ai/dsh-session/types'
import { confineToCwd, headMoved, relativeToCwd } from '../core/paths.ts'
import { sumDiffs } from '../core/diffstat.ts'
import { replaceRange } from '../core/rewind-range.ts'
import {
  appendCheckpoint,
  ensureOriginCheckpoint,
  findCheckpoint,
  isLiveCheckpointId,
  liveCheckpointId,
  listItems,
  overlayTree,
  toListItem,
  rehomeState,
  rewindDeletes,
  rememberBaseline,
  rememberIntent,
  setOpenTurn,
  setSessionStartHead,
  truncateAfter,
  turnsShadowedAfter,
} from '../core/store.ts'
import {
  PLUGIN_ID,
  type Checkpoint,
  type CheckpointDiffs,
  type CheckpointList,
  type FileRow,
  type RewindBlocker,
  type RewindPreview,
  type RewindResult,
  type SessionState,
} from '../core/types.ts'
import { buildSnapshot, entryFromInspect, projectCheckpoint } from './snapshot.ts'
import type { BlobStore } from './blobs.ts'
import type { GitPorts } from './git.ts'
import { inspectPath, type InspectFn } from './inspect.ts'
import { listFilesUnder } from './walk.ts'
import { loadState, saveState } from './persist.ts'

/** Structured flow error crossing the RPC boundary as `{ error: { code } }`. */
export class CheckpointsError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly hint?: string,
  ) {
    super(message)
    this.name = 'CheckpointsError'
  }
}

/** Minimal session face the service needs. */
export interface SessionLike {
  readonly id: string | { toString(): string }
  readonly header: { readonly cwd?: string; readonly agentPreset?: string }
  readonly surface?: { readonly nodes: readonly number[] }
  readonly seq?: number
  snapshotEvents?(): readonly { readonly type: string; readonly seq: number; readonly data?: unknown }[]
  append?(
    type: 'user/message',
    data: unknown,
    opts: { surfaceOp: 'append' | { op: 'replace'; start: number; end: number }; sourceEventSeqs?: readonly number[] },
  ): unknown
}

export interface DiskPorts {
  inspect: InspectFn
  writeFile: (absPath: string, bytes: Uint8Array) => Promise<void>
  deleteFile: (absPath: string) => Promise<void>
  /** Absolute file paths under cwd; used to follow a moved session-touched blob. */
  listFiles: (cwd: string) => Promise<readonly string[]>
}

export interface ServicePorts {
  readonly blobs: BlobStore
  readonly git: GitPorts
  readonly disk: DiskPorts
  readonly dataDir: string
  readonly now: () => number
  readonly getSession: (sessionId: string) => SessionLike | undefined
  readonly forkSession?: (
    session: SessionLike,
    boundary: number,
    turn: number,
  ) => SessionLike | undefined | Promise<SessionLike | undefined>
  /** Retarget a plugin worktree claim from the parent session onto the fork. */
  readonly reclaimWorktree?: (from: string, to: string) => Promise<void>
  /** Keep the fork in the parent session's Host workspace group. */
  readonly attachWorkspace?: (from: string, to: string) => Promise<void>
}

function sessionIdOf(session: SessionLike): string {
  return typeof session.id === 'string' ? session.id : String(session.id)
}

function cwdOf(session: SessionLike): string {
  return typeof session.header.cwd === 'string' ? session.header.cwd : ''
}

async function writeBytes(absPath: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(absPath), { recursive: true })
  await writeFile(absPath, bytes)
}

async function deleteBytes(absPath: string): Promise<void> {
  try {
    await unlink(absPath)
  } catch {
    // already gone
  }
}

export const defaultDisk: DiskPorts = {
  inspect: inspectPath,
  writeFile: writeBytes,
  deleteFile: deleteBytes,
  listFiles: listFilesUnder,
}

/** Reuse a live snapshot if it is newer than this many ms. */
const LIVE_MIN_MS = 400

interface LiveFrame {
  readonly checkpoint: Checkpoint
  readonly files: readonly FileRow[]
  readonly at: number
}

export class CheckpointsService {
  private readonly states = new Map<string, SessionState>()
  private readonly inflight = new Map<string, Promise<void>>()
  private readonly liveFrames = new Map<string, LiveFrame>()

  constructor(private readonly ports: ServicePorts) {}

  private async load(session: SessionLike): Promise<SessionState> {
    const id = sessionIdOf(session)
    const cached = this.states.get(id)
    if (cached !== undefined) return cached
    const cwd = cwdOf(session)
    const loaded = await loadState(this.ports.dataDir, id, cwd)
    this.states.set(id, loaded)
    return loaded
  }

  private async persist(state: SessionState): Promise<void> {
    this.states.set(state.sessionId, state)
    await saveState(this.ports.dataDir, state)
  }

  private enqueue(sessionId: string, work: () => Promise<void>): void {
    const prev = this.inflight.get(sessionId) ?? Promise.resolve()
    // Swallow so a failed snapshot cannot stick the queue rejected.
    const next = prev.then(work, work).then(() => undefined, () => undefined)
    this.inflight.set(sessionId, next)
    void next.finally(() => {
      if (this.inflight.get(sessionId) === next) this.inflight.delete(sessionId)
    })
  }

  /** Serialize all session work on one queue. */
  private run<T>(sessionId: string, work: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.enqueue(sessionId, async () => {
        try {
          resolve(await work())
        } catch (error) {
          reject(error)
        }
      })
    })
  }

  private resolveAbs(cwd: string, keyOrPath: string): string | null {
    if (cwd === '') return null
    return confineToCwd(cwd, keyOrPath)
  }

  private resolveSnapshot(cwd: string, entry: { targetKey: string; displayPath: string }): string | null {
    return this.resolveAbs(cwd, entry.targetKey.startsWith('/') ? entry.targetKey : entry.displayPath)
  }

  private async ignoreFailure(work: Promise<void> | undefined): Promise<void> {
    try { await work } catch { /* optional collaborator */ }
  }

  /** Load, record session-start HEAD/dirt once, and ensure the origin checkpoint. */
  private async hydrate(session: SessionLike): Promise<SessionState> {
    let state = await this.load(session)
    if (state.checkpoints.some((item) => item.turn === 0)) return state
    state = await this.prepareSession(session, state)
    state = ensureOriginCheckpoint(state, this.ports.now())
    await this.persist(state)
    return state
  }

  /** Ensure a session is tracked (created or first event). */
  attach(session: SessionLike): void {
    this.enqueue(sessionIdOf(session), async () => {
      await this.hydrate(session)
    })
  }

  /**
   * Record session-start HEAD for the moved-HEAD warning. Pre-session dirty
   * files stay out of the ledger so another session's dirt is not attributed
   * here; fs-tool intents capture first-seen bytes when this session touches
   * a path.
   */
  private async prepareSession(session: SessionLike, state: SessionState): Promise<SessionState> {
    const cwd = cwdOf(session)
    if (cwd !== '' && state.cwd !== cwd) state = { ...state, cwd }
    if (cwd === '') return state
    if (state.sessionStartHead === null) {
      const head = await this.ports.git.head(cwd)
      state = setSessionStartHead(state, head)
    }
    return state
  }

  onEvent(session: SessionLike, event: { type: string; seq: number; data?: { turn?: number } }): void {
    const id = sessionIdOf(session)
    this.enqueue(id, async () => {
      const state = await this.hydrate(session)
      if (event.type === 'turn/start' && typeof event.data?.turn === 'number') {
        this.liveFrames.delete(id)
        await this.persist(setOpenTurn(state, event.data.turn))
        return
      }
      if (event.type === 'turn/end') {
        const turn = typeof event.data?.turn === 'number' ? event.data.turn : state.openTurn
        if (turn === null) return
        await this.finishTurn(session, state, turn, event.seq)
      }
    })
  }

  /** Stop / cancel converges here: no driver remains, even if `turn/end` is late. */
  onAgentIdle(session: SessionLike): void {
    const id = sessionIdOf(session)
    this.enqueue(id, async () => {
      const state = await this.hydrate(session)
      if (state.openTurn === null) return
      const seq = typeof session.seq === 'number' ? session.seq : state.seqCursor
      await this.finishTurn(session, state, state.openTurn, seq)
    })
  }

  private async finishTurn(
    session: SessionLike,
    state: SessionState,
    turn: number,
    seq: number,
  ): Promise<void> {
    this.liveFrames.delete(sessionIdOf(session))
    let next = setOpenTurn(state, null)
    if (!state.checkpoints.some((item) => item.turn === turn)) {
      next = await this.snapshotTurn(session, next, turn, seq)
    }
    await this.persist(next)
  }

  /**
   * Observe an fs write/edit intent BEFORE the mutation so first-seen
   * content is the baseline. Callers must await this before `next()`.
   */
  noteIntent(session: SessionLike, targetKey: string, displayPath: string, absPath: string): Promise<void> {
    return this.run(sessionIdOf(session), async () => {
      let state = await this.hydrate(session)
      const cwd = state.cwd !== '' ? state.cwd : cwdOf(session)
      const confined = cwd !== '' ? confineToCwd(cwd, absPath) : absPath
      if (confined === null) return
      state = rememberIntent(state, targetKey)
      if (state.baseline[targetKey] === undefined) {
        const inspected = await this.ports.disk.inspect(confined)
        const hash = inspected.bytes !== null ? await this.ports.blobs.put(inspected.bytes) : null
        const display = cwd !== '' ? relativeToCwd(cwd, confined) : displayPath
        state = rememberBaseline(state, entryFromInspect(targetKey, display, inspected, hash))
      }
      this.liveFrames.delete(sessionIdOf(session))
      await this.persist(state)
    })
  }

  private snapshotIo() {
    return {
      inspect: (absPath: string) => this.ports.disk.inspect(absPath),
      listFiles: (cwd: string) => this.ports.disk.listFiles(cwd),
      put: (bytes: Uint8Array) => this.ports.blobs.put(bytes),
      get: (hash: string) => this.ports.blobs.get(hash),
      head: (cwd: string) => this.ports.git.head(cwd),
      show: (cwd: string, sha: string, path: string) => this.ports.git.show(cwd, sha, path),
      now: this.ports.now,
    }
  }

  private async snapshotTurn(
    session: SessionLike,
    state: SessionState,
    turn: number,
    seq: number,
  ): Promise<SessionState> {
    const built = await buildSnapshot({
      sessionId: sessionIdOf(session),
      cwd: state.cwd !== '' ? state.cwd : cwdOf(session),
      events: session.snapshotEvents?.() ?? [],
      state,
      turn,
      seq,
      io: this.snapshotIo(),
    })
    if (built.checkpoint === null) return built.state
    return appendCheckpoint(built.state, built.checkpoint)
  }

  private async refreshLive(session: SessionLike, state: SessionState): Promise<LiveFrame | null> {
    const turn = state.openTurn
    if (turn === null) return null
    const id = sessionIdOf(session)
    const cached = this.liveFrames.get(id)
    const now = this.ports.now()
    if (cached !== undefined && cached.checkpoint.turn === turn && now - cached.at < LIVE_MIN_MS) {
      return cached
    }
    const liveSeq = typeof session.seq === 'number' ? session.seq : 0
    const seq = Math.max(liveSeq, state.seqCursor)
    const built = await buildSnapshot({
      sessionId: sessionIdOf(session),
      cwd: state.cwd !== '' ? state.cwd : cwdOf(session),
      events: session.snapshotEvents?.() ?? [],
      state,
      turn,
      seq,
      io: this.snapshotIo(),
    })
    if (built.checkpoint === null) return null
    if (built.state !== state) await this.persist(built.state)
    const checkpoint: Checkpoint = {
      ...built.checkpoint,
      id: liveCheckpointId(built.state.sessionId, turn),
    }
    const files = await projectCheckpoint(built.state, checkpoint, this.snapshotIo())
    const frame: LiveFrame = { checkpoint, files, at: now }
    this.liveFrames.set(id, frame)
    return frame
  }

  private async resolveCheckpoint(
    sessionId: string,
    checkpointId: string,
  ): Promise<{ state: SessionState; checkpoint: Checkpoint; files?: readonly FileRow[] }> {
    const state = this.requireState(sessionId)
    const committed = findCheckpoint(state, checkpointId)
    if (committed !== undefined) return { state, checkpoint: committed }
    if (!isLiveCheckpointId(checkpointId) || state.openTurn === null) {
      throw new CheckpointsError('checkpoint-not-found', `unknown checkpoint ${checkpointId}`)
    }
    const session = this.ports.getSession(sessionId)
    if (session === undefined) {
      throw new CheckpointsError('checkpoint-not-found', `unknown checkpoint ${checkpointId}`)
    }
    const frame = await this.refreshLive(session, this.requireState(sessionId))
    if (frame === null || frame.checkpoint.id !== checkpointId) {
      throw new CheckpointsError('checkpoint-not-found', `unknown checkpoint ${checkpointId}`)
    }
    return { state: this.requireState(sessionId), checkpoint: frame.checkpoint, files: frame.files }
  }

  async list(sessionId: string): Promise<CheckpointList> {
    return this.run(sessionId, () => this.listNow(sessionId))
  }

  private async listNow(sessionId: string): Promise<CheckpointList> {
    const session = this.ports.getSession(sessionId)
    if (session !== undefined) await this.hydrate(session)
    const state = this.states.get(sessionId)
    if (state === undefined) {
      return {
        sessionId,
        checkpoints: [],
        rewoundTo: null,
        openTurn: false,
        cwd: session !== undefined ? cwdOf(session) : null,
      }
    }
    const items = [...listItems(state)]
    if (state.openTurn !== null && session !== undefined) {
      const frame = await this.refreshLive(session, this.requireState(sessionId))
      if (frame !== null) {
        const totals = sumDiffs(frame.files)
        items.push(toListItem(frame.checkpoint, {
          live: true,
          added: totals.added,
          removed: totals.removed,
        }))
      }
    }
    return {
      sessionId,
      checkpoints: items,
      rewoundTo: state.rewoundTo,
      openTurn: state.openTurn !== null,
      cwd: state.cwd,
    }
  }

  /**
   * Snapshot the session cwd as the next turn-boundary checkpoint without
   * waiting for `turn/end`. Used by the e2e lane (no live model) and by
   * anything that needs a tree as-of-now. Refuses while a turn is open.
   */
  async capture(sessionId: string): Promise<{ checkpointId: string; turn: number }> {
    return this.run(sessionId, () => this.captureNow(sessionId))
  }

  private async captureNow(sessionId: string): Promise<{ checkpointId: string; turn: number }> {
    const session = this.ports.getSession(sessionId)
    if (session === undefined) {
      throw new CheckpointsError('session-not-found', `unknown session ${sessionId}`)
    }
    let state = await this.hydrate(session)
    if (state.openTurn !== null) {
      throw new CheckpointsError('turn-open', 'Refuse capture while a turn is open')
    }
    const cwd = state.cwd !== '' ? state.cwd : cwdOf(session)
    if (cwd !== '') {
      for (const name of await this.ports.git.statusNames(cwd)) {
        const abs = confineToCwd(cwd, name)
        if (abs === null) continue
        state = rememberIntent(state, abs)
      }
    }
    const last = state.checkpoints[state.checkpoints.length - 1]
    const turn = (last?.turn ?? 0) + 1
    const liveSeq = typeof session.seq === 'number' ? session.seq : 0
    const seq = Math.max(liveSeq, last?.seq ?? 0, state.seqCursor) + 1
    state = await this.snapshotTurn(session, state, turn, seq)
    await this.persist(state)
    const created = state.checkpoints[state.checkpoints.length - 1]
    if (created === undefined) {
      throw new CheckpointsError('internal', 'capture produced no checkpoint')
    }
    return { checkpointId: created.id, turn: created.turn }
  }

  async diffs(sessionId: string, checkpointId: string): Promise<CheckpointDiffs> {
    return this.run(sessionId, () => this.diffsNow(sessionId, checkpointId))
  }

  private async diffsNow(sessionId: string, checkpointId: string): Promise<CheckpointDiffs> {
    const resolved = await this.resolveCheckpoint(sessionId, checkpointId)
    const files = resolved.files ?? await projectCheckpoint(resolved.state, resolved.checkpoint, this.snapshotIo())
    return { checkpointId, files }
  }

  async preview(sessionId: string, checkpointId: string): Promise<RewindPreview> {
    return this.run(sessionId, () => this.previewNow(sessionId, checkpointId))
  }

  private async previewNow(sessionId: string, checkpointId: string): Promise<RewindPreview> {
    const resolved = await this.resolveCheckpoint(sessionId, checkpointId)
    const state = resolved.state
    const checkpoint = resolved.checkpoint
    const index = state.checkpoints.findIndex((item) => item.id === checkpointId)
    const later = rewindDeletes(state, checkpointId)
    const effective = overlayTree(state.baseline, checkpoint.tree)
    const filesWritten = effective
      .filter((entry) => entry.blobHash !== null)
      .map((entry) => entry.displayPath)
    const labels = new Map<string, string>()
    for (const entry of effective) labels.set(entry.targetKey, entry.displayPath)
    for (const item of state.checkpoints) {
      for (const entry of item.tree) {
        if (!labels.has(entry.targetKey)) labels.set(entry.targetKey, entry.displayPath)
      }
    }
    const filesDeleted = later.map((key) => labels.get(key) ?? relativeToCwd(state.cwd, key))
    const currentHead = state.cwd !== '' ? await this.ports.git.head(state.cwd) : null
    const status = state.cwd !== '' ? await this.ports.git.statusNames(state.cwd) : []
    const intent = new Set(state.intentKeys)
    const restoreKeys = new Set([
      ...effective.map((entry) => entry.targetKey),
      ...later,
    ])
    const dirtyNonAgent = status.filter((name) => {
      const abs = this.resolveAbs(state.cwd, name)
      if (abs === null) return false
      return restoreKeys.has(abs) && !intent.has(abs) && !intent.has(name)
    })
    const blockers: RewindBlocker[] = []
    if (state.openTurn !== null) blockers.push('turn-open')
    for (const entry of effective) {
      const abs = this.resolveSnapshot(state.cwd, entry)
      if (abs === null) {
        blockers.push('unrestorable')
        break
      }
      if (entry.kind === 'symlink' || entry.kind === 'directory') {
        const now = await this.ports.disk.inspect(abs)
        if (now.kind !== entry.kind) {
          blockers.push('unrestorable')
          break
        }
        continue
      }
      if (entry.kind === 'too-large' && entry.blobHash === null) {
        blockers.push('unrestorable')
        break
      }
      if (entry.blobHash !== null) {
        const bytes = await this.ports.blobs.get(entry.blobHash)
        if (bytes === null) {
          blockers.push('missing-blob')
          break
        }
      }
    }
    return {
      checkpointId,
      filesWritten,
      filesDeleted: [...new Set(filesDeleted)],
      turnsShadowed: turnsShadowedAfter(state.checkpoints.length, index),
      dirtyNonAgent,
      headMoved: headMoved(currentHead, checkpoint.head),
      currentHead,
      checkpointHead: checkpoint.head,
      openTurn: state.openTurn !== null,
      blockers: [...new Set(blockers)],
    }
  }

  async rewind(sessionId: string, checkpointId: string): Promise<RewindResult> {
    return this.run(sessionId, () => this.rewindNow(sessionId, checkpointId))
  }

  private async rewindNow(sessionId: string, checkpointId: string): Promise<RewindResult> {
    const session = this.ports.getSession(sessionId)
    if (session === undefined) {
      throw new CheckpointsError('session-not-found', `unknown session ${sessionId}`)
    }
    const preview = await this.previewNow(sessionId, checkpointId)
    if (preview.blockers.includes('turn-open')) {
      throw new CheckpointsError('turn-open', 'Refuse rewind while a turn is open')
    }
    if (preview.blockers.length > 0) {
      throw new CheckpointsError(preview.blockers[0]!, 'Cannot restore one or more paths')
    }
    let state = this.requireState(sessionId)
    const checkpoint = findCheckpoint(state, checkpointId)
    if (checkpoint === undefined) {
      throw new CheckpointsError('checkpoint-not-found', `unknown checkpoint ${checkpointId}`)
    }
    const later = rewindDeletes(state, checkpointId)
    const effective = overlayTree(state.baseline, checkpoint.tree)
    let filesDeleted = 0
    for (const key of later) {
      const abs = this.resolveAbs(state.cwd, key)
      if (abs === null) continue
      await this.ports.disk.deleteFile(abs)
      filesDeleted += 1
    }
    let filesWritten = 0
    for (const entry of effective) {
      const abs = this.resolveSnapshot(state.cwd, entry)
      if (abs === null) continue
      if (entry.kind === 'missing' || entry.blobHash === null) {
        if (entry.kind === 'missing') {
          await this.ports.disk.deleteFile(abs)
          filesDeleted += 1
        }
        continue
      }
      const bytes = await this.ports.blobs.get(entry.blobHash)
      if (bytes === null) {
        throw new CheckpointsError('missing-blob', `missing blob for ${entry.displayPath}`)
      }
      await this.ports.disk.writeFile(abs, bytes)
      filesWritten += 1
    }

    try {
      this.appendReplace(session, checkpoint.seq, checkpoint.turn)
    } catch {
      // Files already match the checkpoint. Still fold the generation so
      // the Changes tab cannot rewind into a tree we already wrote.
    }
    state = truncateAfter(state, checkpointId)
    await this.persist(state)
    let nextSessionId: string | undefined
    let rewoundTo = checkpointId
    try {
      const child = await this.ports.forkSession?.(session, checkpoint.seq, checkpoint.turn)
      if (child !== undefined) {
        const childId = sessionIdOf(child)
        if (childId !== sessionId) {
          const relocated = rehomeState(state, childId)
          // Same queue as session/created attach, so an empty origin persist
          // cannot land after this and wipe the rewound fold.
          await this.run(childId, async () => { await this.persist(relocated) })
          await this.ignoreFailure(this.ports.reclaimWorktree?.(sessionId, childId))
          await this.ignoreFailure(this.ports.attachWorkspace?.(sessionId, childId))
          nextSessionId = childId
          rewoundTo = relocated.rewoundTo ?? relocated.checkpoints[relocated.checkpoints.length - 1]?.id ?? checkpoint.id
        }
      }
    } catch {
      // In-place files + model replace already landed. Chat stays on this session.
    }
    return { ok: true, rewoundTo, filesWritten, filesDeleted, ...nextSessionId === undefined ? {} : { nextSessionId } }
  }

  private appendReplace(session: SessionLike, checkpointSeq: number, turn: number): void {
    if (typeof session.append !== 'function') return
    const nodes = session.surface?.nodes ?? []
    const range = replaceRange([...nodes], checkpointSeq)
    if (range === null) return
    const message = createUserMessage({
      content: [{
        type: 'text',
        text: `Rewound to turn ${turn}. Later messages are not sent to the model.`,
      }],
      source: {
        kind: 'plugin',
        plugin: PLUGIN_ID,
        form: 'notice',
        summary: `Rewound to turn ${turn}`,
      },
    })
    session.append('user/message', message, {
      surfaceOp: {
        op: 'replace',
        start: range.start as SessionSeq,
        end: range.end as SessionSeq,
      },
      sourceEventSeqs: range.shadowed as SessionSeq[],
    })
  }

  private requireState(sessionId: string): SessionState {
    const state = this.states.get(sessionId)
    if (state === undefined) {
      throw new CheckpointsError('session-not-found', `unknown session ${sessionId}`)
    }
    return state
  }

  private async wait(sessionId: string): Promise<void> {
    for (;;) {
      const pending = this.inflight.get(sessionId)
      if (pending === undefined) return
      await pending
    }
  }

  /** Test helper: seed a fold without going through events. */
  replaceState(state: SessionState): void {
    this.states.set(state.sessionId, state)
  }

  peek(sessionId: string): SessionState | undefined {
    return this.states.get(sessionId)
  }

  /** Drain queued capture work (tests). */
  async whenIdle(sessionId: string): Promise<void> {
    await this.wait(sessionId)
  }
}

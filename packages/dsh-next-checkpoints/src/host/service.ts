/**
 * Checkpoint orchestration: snapshot at turn/end, project cumulative diffs,
 * rewind files + model surface together. Checkpoints are not git.
 */
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionSeq } from '@deepseek-ai/dsh-session/types'
import { containsNul, decodeUtf8, lfNormalize } from '../core/hunks.ts'
import { absFromCwd, confineToCwd, headMoved, relativeToCwd } from '../core/paths.ts'
import { projectRows, type BlobText } from '../core/project.ts'
import { promptPreviewFromEvents } from '../core/prompt.ts'
import { replaceRange } from '../core/rewind-range.ts'
import {
  appendCheckpoint,
  checkpointId,
  ensureOriginCheckpoint,
  findCheckpoint,
  listItems,
  overlayTree,
  rehomeState,
  rewindDeletes,
  rememberBaseline,
  rememberIntent,
  setOpenTurn,
  setSessionStartHead,
  truncateAfter,
} from '../core/store.ts'
import {
  DIFF_MAX_BYTES,
  PLUGIN_ID,
  type BaselineEntry,
  type Checkpoint,
  type CheckpointDiffs,
  type CheckpointList,
  type FileKind,
  type RewindBlocker,
  type RewindPreview,
  type RewindResult,
  type SessionState,
  type SnapshotEntry,
} from '../core/types.ts'
import type { BlobStore } from './blobs.ts'
import type { GitPorts } from './git.ts'
import { inspectPath, type InspectFn } from './inspect.ts'
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
}

function entryFromInspect(
  targetKey: string,
  displayPath: string,
  inspected: { kind: FileKind; bytes: Uint8Array | null; mtimeMs?: number | null },
  hash: string | null,
): SnapshotEntry {
  return {
    targetKey,
    displayPath,
    kind: inspected.kind,
    blobHash: hash,
    mtimeMs: inspected.mtimeMs ?? null,
  }
}

function classifyBytes(bytes: Uint8Array): FileKind {
  if (bytes.length > DIFF_MAX_BYTES) return 'too-large'
  if (containsNul(bytes)) return 'binary'
  if (decodeUtf8(bytes) === undefined) return 'invalid-utf8'
  return 'text'
}

/**
 * Checkpoints service. One instance per plugin apply.
 */
export class CheckpointsService {
  private readonly states = new Map<string, SessionState>()
  private readonly inflight = new Map<string, Promise<void>>()

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
   * Record session-start HEAD and first-seen disk bytes of already-dirty
   * paths so pre-session dirt is not attributed to the first checkpoint.
   */
  private async prepareSession(session: SessionLike, state: SessionState): Promise<SessionState> {
    const cwd = cwdOf(session)
    if (cwd !== '' && state.cwd !== cwd) state = { ...state, cwd }
    if (cwd === '') return state
    if (state.sessionStartHead === null) {
      const head = await this.ports.git.head(cwd)
      state = setSessionStartHead(state, head)
    }
    const names = new Set<string>()
    if (state.sessionStartHead !== null) {
      for (const name of await this.ports.git.diffNames(cwd, state.sessionStartHead.sha)) names.add(name)
    }
    for (const name of await this.ports.git.untracked(cwd)) names.add(name)
    for (const name of await this.ports.git.statusNames(cwd)) names.add(name)
    for (const name of names) {
      const abs = confineToCwd(cwd, name)
      if (abs === null) continue
      if (state.baseline[abs] !== undefined) continue
      const display = relativeToCwd(cwd, abs)
      const inspected = await this.ports.disk.inspect(abs)
      const hash = inspected.bytes !== null ? await this.ports.blobs.put(inspected.bytes) : null
      state = rememberBaseline(state, {
        targetKey: abs,
        displayPath: display,
        kind: inspected.kind,
        blobHash: hash,
      })
    }
    return state
  }

  onEvent(session: SessionLike, event: { type: string; seq: number; data?: { turn?: number } }): void {
    const id = sessionIdOf(session)
    this.enqueue(id, async () => {
      let state = await this.hydrate(session)
      if (event.type === 'turn/start' && typeof event.data?.turn === 'number') {
        state = setOpenTurn(state, event.data.turn)
        await this.persist(state)
        return
      }
      if (event.type === 'turn/end' && typeof event.data?.turn === 'number') {
        state = setOpenTurn(state, null)
        state = await this.snapshotTurn(session, state, event.data.turn, event.seq)
        await this.persist(state)
      }
    })
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
      await this.persist(state)
    })
  }

  noteTool(session: SessionLike, name: string): void {
    if (!/^(bash|shell|exec)$/i.test(name)) return
    // Git discovery at turn/end covers bash-touched tracked files. Nothing
    // to snapshot mid-call: the mutation may not have finished.
    void session
  }

  private async snapshotTurn(
    session: SessionLike,
    state: SessionState,
    turn: number,
    seq: number,
  ): Promise<SessionState> {
    const cwd = state.cwd !== '' ? state.cwd : cwdOf(session)
    if (cwd === '') return state
    if (state.sessionStartHead === null) {
      state = setSessionStartHead(state, await this.ports.git.head(cwd))
    }
    const names = new Set<string>(state.intentKeys)
    if (state.sessionStartHead !== null) {
      for (const name of await this.ports.git.diffNames(cwd, state.sessionStartHead.sha)) names.add(name)
    }
    for (const name of await this.ports.git.untracked(cwd)) names.add(name)
    for (const name of await this.ports.git.statusNames(cwd)) names.add(name)

    const tree: SnapshotEntry[] = []
    const seen = new Set<string>()

    const consider = async (targetKey: string, displayPath: string, absPath: string): Promise<void> => {
      if (seen.has(targetKey)) return
      seen.add(targetKey)
      if (state.baseline[targetKey] === undefined) {
        let baseline: BaselineEntry
        const head = state.sessionStartHead
        const fromGit = head !== null ? await this.ports.git.show(cwd, head.sha, displayPath) : null
        if (fromGit !== null) {
          const kind = classifyBytes(fromGit)
          const hash = kind === 'too-large' ? null : await this.ports.blobs.put(fromGit)
          baseline = { targetKey, displayPath, kind, blobHash: hash }
        } else {
          baseline = { targetKey, displayPath, kind: 'missing', blobHash: null }
        }
        state = rememberBaseline(state, baseline)
      }
      const inspected = await this.ports.disk.inspect(absPath)
      const hash = inspected.bytes !== null ? await this.ports.blobs.put(inspected.bytes) : null
      tree.push(entryFromInspect(targetKey, displayPath, inspected, hash))
    }

    const previous = state.checkpoints[state.checkpoints.length - 1]
    for (const entry of overlayTree(state.baseline, previous?.tree ?? [])) {
      const abs = this.resolveSnapshot(cwd, entry)
      if (abs === null) continue
      await consider(entry.targetKey, relativeToCwd(cwd, abs), abs)
    }
    for (const key of state.intentKeys) {
      const base = state.baseline[key]
      const display = base?.displayPath ?? key
      const abs = this.resolveAbs(cwd, display.startsWith('/') ? display : absFromCwd(cwd, display))
      if (abs === null) continue
      await consider(key, relativeToCwd(cwd, abs), abs)
    }
    for (const name of names) {
      const abs = this.resolveAbs(cwd, name)
      if (abs === null) continue
      const display = relativeToCwd(cwd, abs)
      await consider(abs, display, abs)
    }

    tree.sort((a, b) => a.displayPath.localeCompare(b.displayPath))
    const promptPreview = promptPreviewFromEvents(
      session.snapshotEvents?.() ?? [],
      previous?.seq ?? -1,
      seq,
    )
    const checkpoint: Checkpoint = {
      id: checkpointId(state.sessionId, turn, seq),
      sessionId: state.sessionId,
      turn,
      seq,
      time: this.ports.now(),
      tree,
      head: await this.ports.git.head(cwd),
      promptPreview,
    }
    return appendCheckpoint(state, checkpoint)
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
    return {
      sessionId,
      checkpoints: listItems(state),
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
    const state = this.requireState(sessionId)
    const checkpoint = findCheckpoint(state, checkpointId)
    if (checkpoint === undefined) {
      throw new CheckpointsError('checkpoint-not-found', `unknown checkpoint ${checkpointId}`)
    }
    const hashes = new Set<string>()
    for (const entry of Object.values(state.baseline)) {
      if (entry.blobHash !== null) hashes.add(entry.blobHash)
    }
    for (const entry of checkpoint.tree) {
      if (entry.blobHash !== null) hashes.add(entry.blobHash)
    }
    const blobs: Record<string, BlobText> = {}
    for (const hash of hashes) {
      const bytes = await this.ports.blobs.get(hash)
      if (bytes === null) continue
      const kind = classifyBytes(bytes)
      const decoded = kind === 'text' ? decodeUtf8(bytes) : undefined
      blobs[hash] = {
        kind,
        text: decoded !== undefined ? lfNormalize(decoded) : null,
      }
    }
    return {
      checkpointId,
      files: projectRows({
        baseline: state.baseline,
        tree: checkpoint.tree,
        blobs,
        cwd: state.cwd,
      }).map((row) => ({
        ...row,
        changedAt: row.changedAt ?? checkpoint.time,
      })),
    }
  }

  async preview(sessionId: string, checkpointId: string): Promise<RewindPreview> {
    return this.run(sessionId, () => this.previewNow(sessionId, checkpointId))
  }

  private async previewNow(sessionId: string, checkpointId: string): Promise<RewindPreview> {
    const state = this.requireState(sessionId)
    const checkpoint = findCheckpoint(state, checkpointId)
    if (checkpoint === undefined) {
      throw new CheckpointsError('checkpoint-not-found', `unknown checkpoint ${checkpointId}`)
    }
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
    const worktree = state.cwd !== '' ? await this.ports.git.isWorktree(state.cwd) : false
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
      turnsShadowed: Math.max(0, state.checkpoints.length - index - 1),
      worktree,
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

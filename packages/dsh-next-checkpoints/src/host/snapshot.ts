/**
 * Turn-boundary tree snapshot and cumulative row projection.
 */
import { containsNul, decodeUtf8, lfNormalize } from '../core/hunks.ts'
import { absFromCwd, confineToCwd, relativeToCwd } from '../core/paths.ts'
import { projectRows, type BlobText } from '../core/project.ts'
import { promptPreviewFromEvents } from '../core/prompt.ts'
import { checkpointId, overlayTree, rememberBaseline, setSessionStartHead } from '../core/store.ts'
import {
  DIFF_MAX_BYTES,
  type BaselineEntry,
  type Checkpoint,
  type FileKind,
  type FileRow,
  type SessionState,
  type SnapshotEntry,
} from '../core/types.ts'
import type { InspectFn } from './inspect.ts'

export interface SnapshotIo {
  inspect: InspectFn
  listFiles: (cwd: string) => Promise<readonly string[]>
  put: (bytes: Uint8Array) => Promise<string>
  get: (hash: string) => Promise<Uint8Array | null>
  head: (cwd: string) => Promise<SessionState['sessionStartHead']>
  show: (cwd: string, sha: string, path: string) => Promise<Uint8Array | null>
  now: () => number
}

function resolveAbs(cwd: string, keyOrPath: string): string | null {
  if (cwd === '') return null
  return confineToCwd(cwd, keyOrPath)
}

function resolveSnapshot(cwd: string, entry: { targetKey: string; displayPath: string }): string | null {
  return resolveAbs(cwd, entry.targetKey.startsWith('/') ? entry.targetKey : entry.displayPath)
}

export function entryFromInspect(
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

export function classifyBytes(bytes: Uint8Array): FileKind {
  if (bytes.length > DIFF_MAX_BYTES) return 'too-large'
  if (containsNul(bytes)) return 'binary'
  if (decodeUtf8(bytes) === undefined) return 'invalid-utf8'
  return 'text'
}

export async function buildSnapshot(input: {
  readonly sessionId: string
  readonly cwd: string
  readonly events: readonly { readonly type: string; readonly seq: number; readonly data?: unknown }[]
  readonly state: SessionState
  readonly turn: number
  readonly seq: number
  readonly io: SnapshotIo
}): Promise<{ state: SessionState; checkpoint: Checkpoint | null }> {
  const { sessionId, cwd, events, turn, seq, io } = input
  let { state } = input
  if (cwd === '') return { state, checkpoint: null }
  if (state.sessionStartHead === null) {
    state = setSessionStartHead(state, await io.head(cwd))
  }
  const tree: SnapshotEntry[] = []
  const seen = new Set<string>()

  const consider = async (targetKey: string, displayPath: string, absPath: string): Promise<void> => {
    if (seen.has(targetKey)) return
    seen.add(targetKey)
    if (state.baseline[targetKey] === undefined) {
      let baseline: BaselineEntry
      const head = state.sessionStartHead
      const fromGit = head !== null ? await io.show(cwd, head.sha, displayPath) : null
      if (fromGit !== null) {
        const kind = classifyBytes(fromGit)
        const hash = kind === 'too-large' ? null : await io.put(fromGit)
        baseline = { targetKey, displayPath, kind, blobHash: hash }
      } else {
        baseline = { targetKey, displayPath, kind: 'missing', blobHash: null }
      }
      state = rememberBaseline(state, baseline)
    }
    const inspected = await io.inspect(absPath)
    const hash = inspected.bytes !== null ? await io.put(inspected.bytes) : null
    tree.push(entryFromInspect(targetKey, displayPath, inspected, hash))
  }

  const previous = state.checkpoints[state.checkpoints.length - 1]
  for (const entry of overlayTree(state.baseline, previous?.tree ?? [])) {
    const abs = resolveSnapshot(cwd, entry)
    if (abs === null) continue
    await consider(entry.targetKey, relativeToCwd(cwd, abs), abs)
  }
  for (const key of state.intentKeys) {
    const base = state.baseline[key]
    const display = base?.displayPath ?? key
    const abs = resolveAbs(cwd, display.startsWith('/') ? display : absFromCwd(cwd, display))
    if (abs === null) continue
    await consider(key, relativeToCwd(cwd, abs), abs)
  }

  const wanted = new Set<string>()
  const nowByKey = new Map(tree.map((entry) => [entry.targetKey, entry]))
  for (const prev of previous?.tree ?? []) {
    if (prev.blobHash === null) continue
    const now = nowByKey.get(prev.targetKey)
    if (now !== undefined && now.kind !== 'missing') continue
    wanted.add(prev.blobHash)
  }
  if (wanted.size > 0) {
    for (const abs of await io.listFiles(cwd)) {
      if (wanted.size === 0) break
      const confined = confineToCwd(cwd, abs)
      if (confined === null || seen.has(confined)) continue
      const inspected = await io.inspect(confined)
      if (inspected.bytes === null) continue
      const hash = await io.put(inspected.bytes)
      if (!wanted.has(hash)) continue
      wanted.delete(hash)
      await consider(confined, relativeToCwd(cwd, confined), confined)
    }
  }

  tree.sort((a, b) => a.displayPath.localeCompare(b.displayPath))
  const checkpoint: Checkpoint = {
    id: checkpointId(sessionId, turn, seq),
    sessionId,
    turn,
    seq,
    time: io.now(),
    tree,
    head: await io.head(cwd),
    promptPreview: promptPreviewFromEvents(events, previous?.seq ?? -1, seq),
  }
  return { state, checkpoint }
}

export async function projectCheckpoint(
  state: SessionState,
  checkpoint: Checkpoint,
  io: Pick<SnapshotIo, 'get'>,
): Promise<FileRow[]> {
  const hashes = new Set<string>()
  for (const entry of Object.values(state.baseline)) {
    if (entry.blobHash !== null) hashes.add(entry.blobHash)
  }
  for (const entry of checkpoint.tree) {
    if (entry.blobHash !== null) hashes.add(entry.blobHash)
  }
  const blobs: Record<string, BlobText> = {}
  for (const hash of hashes) {
    const bytes = await io.get(hash)
    if (bytes === null) continue
    const kind = classifyBytes(bytes)
    const decoded = kind === 'text' ? decodeUtf8(bytes) : undefined
    blobs[hash] = {
      kind,
      text: decoded !== undefined ? lfNormalize(decoded) : null,
    }
  }
  return projectRows({
    baseline: state.baseline,
    tree: checkpoint.tree,
    blobs,
    cwd: state.cwd,
  }).map((row) => ({
    ...row,
    changedAt: row.changedAt ?? checkpoint.time,
  }))
}

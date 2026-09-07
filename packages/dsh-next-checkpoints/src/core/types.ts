/**
 * Shared checkpoint vocabulary. Host and browser agree on these shapes;
 * blob bytes never leave the host.
 */

/** Plugin id used as a message source and settings/data key. */
export const PLUGIN_ID = 'dsh-next-checkpoints'

/** Context lines `structuredPatch` keeps on each side of a hunk. */
export const DIFF_CONTEXT = 3

/** Byte cap reused from fs-local's diff basis. */
export const DIFF_MAX_BYTES = 10 * 1024 * 1024

/** Soft cap on rendered DiffBlock rows (old + new lines across hunks). */
export const DIFF_MAX_RENDERED_ROWS = 2000

/** jsdiff `structuredPatch` timeout in milliseconds. */
export const DIFF_TIMEOUT_MS = 1000

/** How a snapshotted path is classified. */
export type FileKind =
  | 'text'
  | 'binary'
  | 'missing'
  | 'symlink'
  | 'directory'
  | 'too-large'
  | 'invalid-utf8'

/** Git HEAD recorded on a checkpoint when cwd is a repo. */
export interface HeadInfo {
  readonly sha: string
  readonly short: string
  readonly branch: string | null
}

/** One path in a turn-boundary tree snapshot. */
export interface SnapshotEntry {
  readonly targetKey: string
  readonly displayPath: string
  readonly kind: FileKind
  /** Content-addressed blob; null when there are no bytes to restore. */
  readonly blobHash: string | null
  /** Disk mtime at snapshot, epoch ms. Absent on older persisted trees. */
  readonly mtimeMs?: number | null
}

/** First-seen content of a path (session baseline). */
export interface BaselineEntry {
  readonly targetKey: string
  readonly displayPath: string
  readonly kind: FileKind
  readonly blobHash: string | null
}

/** One turn-boundary checkpoint. */
export interface Checkpoint {
  readonly id: string
  readonly sessionId: string
  readonly turn: number
  readonly seq: number
  readonly time: number
  readonly tree: readonly SnapshotEntry[]
  readonly head: HeadInfo | null
  /** Capped user prompt for the rail; null on Session start or older trees. */
  readonly promptPreview?: string | null
}

/** Durable per-session checkpoint fold. */
export interface SessionState {
  readonly sessionId: string
  readonly cwd: string
  readonly sessionStartHead: HeadInfo | null
  readonly baseline: Record<string, BaselineEntry>
  readonly checkpoints: readonly Checkpoint[]
  readonly intentKeys: readonly string[]
  readonly openTurn: number | null
  readonly rewoundTo: string | null
  /** High-water event seq; survives rewind so capture ids never collide. */
  readonly seqCursor: number
}

/** List row the Changes rail renders. */
export interface CheckpointListItem {
  readonly id: string
  readonly turn: number
  readonly seq: number
  readonly time: number
  readonly fileCount: number
  readonly head: HeadInfo | null
  readonly promptPreview: string | null
  readonly promptTooltip: string | null
}

/** One line inside a unified hunk (`context` is unchanged). */
export type FileDiffLineKind = 'context' | 'add' | 'del'

export interface FileDiffLine {
  readonly kind: FileDiffLineKind
  readonly text: string
}

/** One hunk ready for the GitHub-style preview (`oldText` null = create). */
export interface FileDiffHunk {
  readonly path: string
  readonly oldText: string | null
  readonly newText: string
  readonly oldStart: number
  readonly newStart: number
  readonly lines: readonly FileDiffLine[]
}

/** Why a file row is not a DiffBlock, or that it is. */
export type FileRowKind =
  | 'diff'
  | 'create'
  | 'delete'
  | 'binary'
  | 'too-large'
  | 'invalid-utf8'
  | 'timeout'
  | 'symlink'
  | 'directory'

/** Cumulative net of one path vs session baseline. */
export interface FileRow {
  readonly targetKey: string
  readonly displayPath: string
  readonly kind: FileRowKind
  readonly added: number
  readonly removed: number
  readonly hunks: readonly FileDiffHunk[]
  /** Last modified/added at this checkpoint, epoch ms. */
  readonly changedAt: number | null
}

/** Confirm-modal facts. Selecting a row never produces this. */
export interface RewindPreview {
  readonly checkpointId: string
  readonly filesWritten: readonly string[]
  readonly filesDeleted: readonly string[]
  readonly turnsShadowed: number
  readonly worktree: boolean
  readonly dirtyNonAgent: readonly string[]
  readonly headMoved: boolean
  readonly currentHead: HeadInfo | null
  readonly checkpointHead: HeadInfo | null
  readonly openTurn: boolean
  readonly blockers: readonly RewindBlocker[]
}

/** Reasons rewind must refuse. A moved HEAD is a warning, not a blocker. */
export type RewindBlocker = 'turn-open' | 'unrestorable' | 'missing-blob'

/** List RPC envelope. */
export interface CheckpointList {
  readonly sessionId: string
  readonly checkpoints: readonly CheckpointListItem[]
  readonly rewoundTo: string | null
  readonly openTurn: boolean
  readonly cwd: string | null
}

/** Diffs RPC envelope. */
export interface CheckpointDiffs {
  readonly checkpointId: string
  readonly files: readonly FileRow[]
}

/** Successful rewind RPC envelope. */
export interface RewindResult {
  readonly ok: true
  readonly rewoundTo: string
  readonly filesWritten: number
  readonly filesDeleted: number
  /** Child session whose log ends at the checkpoint; open this to drop later Chat bubbles. */
  readonly nextSessionId?: string
}

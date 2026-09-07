/**
 * Cumulative net: session baseline tree vs one checkpoint tree, then hunk.
 * Never stacks per-edit hunks. Never feeds DiffBlock a whole file.
 */
import { changeCounts, computeHunkDiffs, lfNormalize } from './hunks.ts'
import { toDisplayPath } from './paths.ts'
import { overlayTree } from './store.ts'
import type {
  BaselineEntry,
  FileKind,
  FileRow,
  FileRowKind,
  SnapshotEntry,
} from './types.ts'

/** Decoded blob the host looked up for projection. */
export interface BlobText {
  readonly kind: FileKind
  /** LF-normalized UTF-8 when `kind` is `text`; otherwise absent. */
  readonly text: string | null
}

function lookup(
  key: string,
  baseline: Record<string, BaselineEntry>,
  tree: ReadonlyMap<string, SnapshotEntry>,
): { displayPath: string; before: BaselineEntry | undefined; after: SnapshotEntry | undefined } {
  const after = tree.get(key)
  const before = baseline[key]
  return {
    displayPath: after?.displayPath ?? before?.displayPath ?? key,
    before,
    after,
  }
}

function sideKind(entry: BaselineEntry | SnapshotEntry | undefined): FileKind {
  return entry?.kind ?? 'missing'
}

function rowKindFrom(kind: FileKind): FileRowKind | undefined {
  if (kind === 'binary') return 'binary'
  if (kind === 'too-large') return 'too-large'
  if (kind === 'invalid-utf8') return 'invalid-utf8'
  if (kind === 'symlink') return 'symlink'
  if (kind === 'directory') return 'directory'
  return undefined
}

/**
 * Project one path. Returns null when the net is identical (nothing to show).
 */
export function projectPath(input: {
  readonly displayPath: string
  readonly targetKey: string
  readonly beforeKind: FileKind
  readonly afterKind: FileKind
  readonly beforeText: string | null
  readonly afterText: string | null
}): Omit<FileRow, 'changedAt'> | null {
  const { displayPath, targetKey, beforeKind, afterKind, beforeText, afterText } = input
  const afterSpecial = rowKindFrom(afterKind)
  if (afterSpecial !== undefined) {
    if (beforeKind === afterKind && beforeKind !== 'text' && beforeKind !== 'missing') return null
    return {
      targetKey,
      displayPath,
      kind: afterSpecial,
      added: 0,
      removed: 0,
      hunks: [],
    }
  }
  const beforeSpecial = rowKindFrom(beforeKind)
  if (beforeSpecial !== undefined && afterKind === 'missing') {
    return {
      targetKey,
      displayPath,
      kind: 'delete',
      added: 0,
      removed: 0,
      hunks: [],
    }
  }

  // A text side with no decoded bytes is a missing blob, not a create/delete.
  if (afterKind === 'text' && afterText === null) {
    return {
      targetKey,
      displayPath,
      kind: 'too-large',
      added: 0,
      removed: 0,
      hunks: [],
    }
  }
  if (beforeKind === 'text' && beforeText === null && afterKind === 'text') {
    return {
      targetKey,
      displayPath,
      kind: 'too-large',
      added: 0,
      removed: 0,
      hunks: [],
    }
  }

  const created = beforeKind === 'missing'
  const deleted = afterKind === 'missing'

  if (created && deleted) return null

  if (deleted) {
    const oldText = lfNormalize(beforeText ?? '')
    return {
      targetKey,
      displayPath,
      kind: 'delete',
      added: 0,
      removed: oldText === '' ? 0 : oldText.split('\n').length,
      hunks: [{
        path: displayPath,
        oldText,
        newText: '',
        oldStart: 1,
        newStart: 0,
        lines: oldText === '' ? [] : oldText.split('\n').map((text) => ({ kind: 'del' as const, text })),
      }],
    }
  }

  if (created) {
    const newText = lfNormalize(afterText ?? '')
    const hunks = computeHunkDiffs(displayPath, '', newText)
    if (!hunks.ok) {
      return {
        targetKey,
        displayPath,
        kind: hunks.reason === 'timeout' ? 'timeout' : 'too-large',
        added: 0,
        removed: 0,
        hunks: [],
      }
    }
    return {
      targetKey,
      displayPath,
      kind: 'create',
      added: changeCounts('', newText).added,
      removed: 0,
      hunks: hunks.hunks.length > 0
        ? hunks.hunks
        : [{
          path: displayPath,
          oldText: null,
          newText,
          oldStart: 0,
          newStart: 1,
          lines: newText.split('\n').map((text) => ({ kind: 'add' as const, text })),
        }],
    }
  }

  const before = lfNormalize(beforeText ?? '')
  const after = lfNormalize(afterText ?? '')
  if (before === after) return null
  const hunks = computeHunkDiffs(displayPath, before, after)
  if (!hunks.ok) {
    return {
      targetKey,
      displayPath,
      kind: hunks.reason === 'timeout' ? 'timeout' : 'too-large',
      added: 0,
      removed: 0,
      hunks: [],
    }
  }
  if (hunks.hunks.length === 0) return null
  const counts = changeCounts(before, after)
  return {
    targetKey,
    displayPath,
    kind: 'diff',
    added: counts.added,
    removed: counts.removed,
    hunks: hunks.hunks,
  }
}

/** Cumulative net rows for the Changes pane, sorted by display path. */
export function projectRows(input: {
  readonly baseline: Record<string, BaselineEntry>
  readonly tree: readonly SnapshotEntry[]
  readonly blobs: Readonly<Record<string, BlobText>>
  readonly cwd?: string
}): FileRow[] {
  const tree = new Map(overlayTree(input.baseline, input.tree).map((entry) => [entry.targetKey, entry]))
  const keys = new Set([...Object.keys(input.baseline), ...tree.keys()])
  const rows: FileRow[] = []
  const cwd = input.cwd ?? ''
  for (const key of [...keys].sort()) {
    const looked = lookup(key, input.baseline, tree)
    const displayPath = toDisplayPath(cwd, looked.displayPath)
    const { before, after } = looked
    const beforeBlob = before?.blobHash ? input.blobs[before.blobHash] : undefined
    const afterBlob = after?.blobHash ? input.blobs[after.blobHash] : undefined
    const row = projectPath({
      displayPath,
      targetKey: key,
      beforeKind: sideKind(before),
      afterKind: sideKind(after),
      beforeText: beforeBlob?.text ?? null,
      afterText: afterBlob?.text ?? null,
    })
    if (row !== null) {
      rows.push({ ...row, changedAt: after?.mtimeMs ?? null })
    }
  }
  return rows.sort((a, b) => a.displayPath.localeCompare(b.displayPath))
}

/**
 * Host-side hunk projection. Reimplements tool-fs `computeHunkDiffs`
 * (not exported) so the client never sees whole files or the `diff` package.
 */
import { structuredPatch } from 'diff'
import {
  DIFF_CONTEXT,
  DIFF_MAX_RENDERED_ROWS,
  DIFF_TIMEOUT_MS,
  type FileDiffHunk,
  type FileDiffLine,
} from './types.ts'

interface PatchHunk {
  readonly oldStart: number
  readonly newStart: number
  readonly lines: readonly string[]
}

function patchHunks(
  before: string,
  after: string,
  context: number,
  timeoutMs: number,
): PatchHunk[] {
  // jsdiff accepts `timeout` at runtime; shipped PatchOptions omits it, and
  // ReturnType includes the callback overload's `void`.
  const patch = structuredPatch('', '', before, after, undefined, undefined, {
    context,
    timeout: timeoutMs,
  } as { context: number }) as { hunks: PatchHunk[] }
  return patch.hunks
}

export { validateHunks } from './validate.ts'

/** LF-normalize like fs-local so DiffBlock's `\\n` split does not lie. */
export function lfNormalize(text: string): string {
  return text.replace(/\r\n/g, '\n')
}

/**
 * True when a NUL appears anywhere in the buffer. fs-local samples 8 KiB
 * for Read; late NULs still fail edit, so snapshot classification scans
 * the whole file.
 */
export function containsNul(bytes: Uint8Array): boolean {
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) return true
  }
  return false
}

/** Decode UTF-8 or reject. */
export function decodeUtf8(bytes: Uint8Array): string | undefined {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return undefined
  }
}

export type HunkResult =
  | { readonly ok: true; readonly hunks: readonly FileDiffHunk[] }
  | { readonly ok: false; readonly reason: 'timeout' | 'too-large' }

/**
 * One FileDiff-shaped hunk per applied change, three lines of context.
 * Pure insertions use `oldText: null`. Patch-only no-newline markers omitted.
 */
export function computeHunkDiffs(
  path: string,
  before: string,
  after: string,
  timeoutMs: number = DIFF_TIMEOUT_MS,
): HunkResult {
  const oldText = lfNormalize(before)
  const newText = lfNormalize(after)
  if (oldText === newText) return { ok: true, hunks: [] }
  let hunkList: PatchHunk[]
  try {
    hunkList = patchHunks(oldText, newText, DIFF_CONTEXT, timeoutMs)
  } catch {
    return { ok: false, reason: 'timeout' }
  }
  const hunks: FileDiffHunk[] = []
  let rendered = 0
  for (const hunk of hunkList) {
    const oldLines: string[] = []
    const newLines: string[] = []
    const lines: FileDiffLine[] = []
    for (const line of hunk.lines) {
      if (line.startsWith('\\')) continue
      const text = line.slice(1)
      if (line.startsWith('-')) {
        oldLines.push(text)
        lines.push({ kind: 'del', text })
      } else if (line.startsWith('+')) {
        newLines.push(text)
        lines.push({ kind: 'add', text })
      } else {
        oldLines.push(text)
        newLines.push(text)
        lines.push({ kind: 'context', text })
      }
    }
    rendered += oldLines.length + newLines.length
    if (rendered > DIFF_MAX_RENDERED_ROWS) return { ok: false, reason: 'too-large' }
    hunks.push({
      path,
      oldText: oldLines.length > 0 ? oldLines.join('\n') : null,
      newText: newLines.join('\n'),
      oldStart: hunk.oldStart,
      newStart: hunk.newStart,
      lines,
    })
  }
  return { ok: true, hunks }
}

/**
 * `+A -R` badges with context stripped (DiffBlock's footer inflates both
 * sides with the three context lines; do not copy those numbers).
 */
export function changeCounts(before: string, after: string): { added: number; removed: number } {
  const oldText = lfNormalize(before)
  const newText = lfNormalize(after)
  if (oldText === newText) return { added: 0, removed: 0 }
  let hunkList: PatchHunk[]
  try {
    hunkList = patchHunks(oldText, newText, 0, DIFF_TIMEOUT_MS)
  } catch {
    return { added: 0, removed: 0 }
  }
  let added = 0
  let removed = 0
  for (const hunk of hunkList) {
    for (const line of hunk.lines) {
      if (line.startsWith('\\')) continue
      if (line.startsWith('+')) added += 1
      else if (line.startsWith('-')) removed += 1
    }
  }
  return { added, removed }
}


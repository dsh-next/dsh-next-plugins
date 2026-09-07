/**
 * Client-safe hunk validation. Lives apart from `hunks.ts` so the browser
 * bundle never pulls the `diff` package.
 */
import type { FileDiffHunk, FileDiffLine } from './types.ts'

function parseLines(value: unknown): FileDiffLine[] {
  if (!Array.isArray(value)) return []
  const out: FileDiffLine[] = []
  for (const item of value) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue
    const rec = item as { kind?: unknown; text?: unknown }
    if (rec.kind !== 'context' && rec.kind !== 'add' && rec.kind !== 'del') continue
    if (typeof rec.text !== 'string') continue
    out.push({ kind: rec.kind, text: rec.text })
  }
  return out
}

/** Drop malformed hunks before they reach DiffBlock (`Ki(undefined)` throws). */
export function validateHunks(value: unknown): FileDiffHunk[] {
  if (!Array.isArray(value)) return []
  const out: FileDiffHunk[] = []
  for (const item of value) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue
    const rec = item as {
      path?: unknown
      oldText?: unknown
      newText?: unknown
      oldStart?: unknown
      newStart?: unknown
      lines?: unknown
    }
    if (typeof rec.path !== 'string') continue
    if (rec.oldText !== null && typeof rec.oldText !== 'string') continue
    if (typeof rec.newText !== 'string') continue
    out.push({
      path: rec.path,
      oldText: rec.oldText,
      newText: rec.newText,
      oldStart: typeof rec.oldStart === 'number' && Number.isFinite(rec.oldStart) ? rec.oldStart : 1,
      newStart: typeof rec.newStart === 'number' && Number.isFinite(rec.newStart) ? rec.newStart : 1,
      lines: parseLines(rec.lines),
    })
  }
  return out
}

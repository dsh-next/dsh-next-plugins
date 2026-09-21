/**
 * Unified-diff parsing for the panel's native diff view.
 *
 * The host runs `git diff` (or `--cached`) and hands the patch text here. The
 * panel renders exact per-hunk comparisons through the platform `DiffBlock`
 * primitive, which takes an old/new text pair — so a file's patch is split
 * into one {@link DiffHunkText} per `@@` block, each carrying only that
 * block's old and new lines. Feeding whole files instead would push the
 * primitive past its bounded edit-graph search and make it print the entire
 * file as replaced.
 *
 * A file whose patch crosses {@link DIFF_SIZE_CAP_LINES} is marked `tooLarge`:
 * the panel then shows counts plus a copyable patch rather than a wall of
 * rows. The raw patch is always returned.
 */

import type { DiffFile, DiffHunkText } from './types.ts'

/** Rendered-diff line budget per file before the counts-only fallback. */
export const DIFF_SIZE_CAP_LINES = 4000

/** One parsed file section of a patch. */
interface MutableFile {
  path: string
  oldPath: string | null
  binary: boolean
  hunks: DiffHunkText[]
  lines: number
  added: number
  removed: number
  patch: string[]
}

/**
 * Parse a `git diff` patch.
 *
 * Handles ordinary diffs, renames (`rename from`/`rename to`), new and deleted
 * files (`/dev/null`), mode-only changes (no hunks), and binary diffs
 * (`Binary files … differ` or a `GIT binary patch` payload).
 *
 * @param patch - raw `git diff` output.
 * @param options.sizeCap - line budget per file (defaults to {@link DIFF_SIZE_CAP_LINES}).
 * @returns one entry per file, in patch order.
 */
export function parseUnifiedDiff(
  patch: string,
  options: { sizeCap?: number } = {},
): DiffFile[] {
  const cap = options.sizeCap ?? DIFF_SIZE_CAP_LINES
  const files: MutableFile[] = []
  let current: MutableFile | null = null

  const flush = (): void => {
    if (current !== null) files.push(current)
    current = null
  }

  const lines = patch.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!
    if (line.startsWith('diff --git ')) {
      flush()
      const parsed = pathsFromGitHeader(line)
      current = {
        path: parsed.path,
        oldPath: null,
        binary: false,
        hunks: [],
        lines: 0,
        added: 0,
        removed: 0,
        patch: [line],
      }
      continue
    }
    if (current === null) continue
    current.patch.push(line)

    if (line.startsWith('rename from ')) {
      current.oldPath = line.slice('rename from '.length)
      continue
    }
    if (line.startsWith('rename to ')) {
      current.path = line.slice('rename to '.length)
      continue
    }
    if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
      current.binary = true
      continue
    }
    if (!line.startsWith('@@')) continue

    const header = line.slice(2).replace(/ @@.*$/, '')
    // The hunk header's `+start` is where the block begins in the new file,
    // which is the numbering a whole-file view decorates.
    const start = /\+(\d+)/.exec(header)
    const hunk: {
      header: string
      oldText: string[]
      newText: string[]
      seen: number
      /** New-file line numbers this hunk adds. */
      addedLines: number[]
      /** New-file line numbers a deletion sits **before** (1 = the file's head). */
      removedAt: number[]
      next: number
    } = {
      header: header.trim(),
      oldText: [],
      newText: [],
      seen: 0,
      addedLines: [],
      removedAt: [],
      next: start === null ? 1 : Number.parseInt(start[1]!, 10),
    }
    index += 1
    for (; index < lines.length; index += 1) {
      const body = lines[index]!
      // A new hunk or a new file ends this one; step back so the outer loop
      // dispatches that line itself (and records it in the right patch).
      if (body.startsWith('diff --git ') || body.startsWith('@@')) {
        index -= 1
        break
      }
      current.patch.push(body)
      hunk.seen += 1
      current.lines += 1
      const marker = body[0]
      if (marker === '+') {
        hunk.newText.push(body.slice(1))
        hunk.addedLines.push(hunk.next)
        hunk.next += 1
        current.added += 1
      } else if (marker === '-') {
        hunk.oldText.push(body.slice(1))
        // A deletion occupies no line in the new file: it is recorded as a
        // marker before the next surviving line, so the view can show that
        // content was removed there.
        if (hunk.removedAt.at(-1) !== hunk.next) hunk.removedAt.push(hunk.next)
        current.removed += 1
      } else if (marker === ' ') {
        hunk.oldText.push(body.slice(1))
        hunk.newText.push(body.slice(1))
        hunk.next += 1
      } else if (marker === '\\') {
        // `\ No newline at end of file`: not a content line.
        current.lines -= 1
      } else if (body === '') {
        // A trailing empty line belongs to the split, not the hunk.
        current.lines -= 1
      } else {
        current.lines -= 1
      }
    }
    current.hunks.push({
      header: hunk.header,
      oldText: hunk.oldText.join('\n'),
      newText: hunk.newText.join('\n'),
      addedLines: hunk.addedLines,
      removedAt: hunk.removedAt,
    })
  }
  flush()

  return files.map((file) => {
    const tooLarge = file.lines > cap
    return {
      path: file.path,
      displayPath: file.oldPath === null ? file.path : `${file.oldPath} -> ${file.path}`,
      hunks: tooLarge ? [] : file.hunks,
      added: file.added,
      removed: file.removed,
      binary: file.binary,
      tooLarge,
      patch: file.patch.join('\n'),
    }
  })
}

/** Content line count; empty text is zero lines. */
export function lineCount(text: string): number {
  if (text === '') return 0
  return text.split('\n').length
}

/** Path pair from a `diff --git a/x b/y` header, favouring the `b` side. */
export function pathsFromGitHeader(line: string): { path: string; oldPath: string | null } {
  const rest = line.slice('diff --git '.length)
  const match = /^a\/(.+?) b\/(.+)$/.exec(rest)
  if (match !== null) {
    const oldPath = match[1]!
    const path = match[2]!
    return { path, oldPath: oldPath === path ? null : oldPath }
  }
  return { path: rest, oldPath: null }
}

/**
 * `--numstat` counts, keyed by path.
 *
 * Binary files report `-` for both counts; they are reported as 0/0 with a
 * binary flag the caller already has from the patch.
 *
 * @param raw - `git diff --numstat -z` output (NUL-framed).
 * @returns one entry per path; a rename's entry is keyed by the new path.
 */
export function parseNumstat(raw: string): Map<string, { added: number; removed: number; binary: boolean }> {
  const result = new Map<string, { added: number; removed: number; binary: boolean }>()
  if (raw === '') return result
  const records = raw.split('\0').filter((record) => record !== '')
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]!
    const first = record.indexOf('\t')
    const second = first < 0 ? -1 : record.indexOf('\t', first + 1)
    if (first < 0 || second < 0) continue
    const added = record.slice(0, first)
    const removed = record.slice(first + 1, second)
    let path = record.slice(second + 1)
    if (path === '') {
      // A rename with `-z`: the two paths are the record's fields 3 and 4.
      const next = records[index + 1]
      if (next !== undefined) {
        path = next
        index += 1
      }
    }
    if (path === '') continue
    const binary = added === '-' || removed === '-'
    result.set(path, {
      added: binary ? 0 : Number(added),
      removed: binary ? 0 : Number(removed),
      binary,
    })
  }
  return result
}

/**
 * Merge `--numstat` counts into parsed patch files.
 *
 * @param files - {@link parseUnifiedDiff} output.
 * @param counts - {@link parseNumstat} output.
 * @returns the same files with authoritative counts and binary flags.
 */
export function applyNumstat(
  files: readonly DiffFile[],
  counts: ReadonlyMap<string, { added: number; removed: number; binary: boolean }>,
): DiffFile[] {
  return files.map((file) => {
    const count = counts.get(file.path)
    if (count === undefined) return file
    return {
      ...file,
      added: count.added,
      removed: count.removed,
      binary: file.binary || count.binary,
    }
  })
}

/**
 * Convert a parsed file into the `DiffBlock` input shape.
 *
 * @param file - one parsed file.
 * @returns one entry per hunk, each carrying the file's display path so the
 * primitive draws the path header once and `⋯` between hunks.
 */
export function toDiffHunks(file: DiffFile): { path: string; oldText: string | null; newText: string }[] {
  return file.hunks.map((hunk) => ({
    path: file.displayPath,
    oldText: hunk.oldText,
    newText: hunk.newText,
  }))
}

/**
 * Whether the panel can render this file natively.
 *
 * @param file - one parsed file.
 * @returns false for binary files and files past the size cap.
 */
export function canRenderNative(file: DiffFile): boolean {
  return !file.binary && !file.tooLarge && file.hunks.length > 0
}

/**
 * Build the diff of a file git has never seen (an untracked path).
 *
 * `git diff` reports nothing for an untracked file, but the panel still has to
 * show it. The host reads the file and synthesizes the same shape a patch
 * parse would produce: one hunk whose old side is empty.
 *
 * @param path - repository-relative path.
 * @param content - the file's text.
 * @param options.sizeCap - line budget (defaults to {@link DIFF_SIZE_CAP_LINES}).
 * @returns a parsed-file shape with a single added hunk, or a binary marker.
 */
export function addedFileDiff(
  path: string,
  content: string,
  options: { sizeCap?: number; binary?: boolean } = {},
): DiffFile {
  const cap = options.sizeCap ?? DIFF_SIZE_CAP_LINES
  if (options.binary === true) {
    return {
      path,
      displayPath: path,
      hunks: [],
      added: 0,
      removed: 0,
      binary: true,
      tooLarge: false,
      patch: `Binary file ${path} added`,
    }
  }
  const lines = content === '' ? [] : content.replace(/\n$/, '').split('\n')
  const tooLarge = lines.length > cap
  const hunk: DiffHunkText = {
    header: `-0,0 +1,${lines.length}`,
    oldText: '',
    newText: lines.join('\n'),
    // A brand-new file adds every line and removes none.
    addedLines: lines.map((_, index) => index + 1),
    removedAt: [],
  }
  const patch = [
    `diff --git a/${path} b/${path}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${path}`,
    `@@ ${hunk.header} @@`,
    ...lines.map((line) => `+${line}`),
  ].join('\n')
  return {
    path,
    displayPath: path,
    hunks: tooLarge ? [] : [hunk],
    added: lines.length,
    removed: 0,
    binary: false,
    tooLarge,
    patch,
  }
}

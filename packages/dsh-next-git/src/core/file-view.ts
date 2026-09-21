/**
 * The whole-file change view: the new side of a change, and the lines to
 * decorate.
 *
 * The panel's diff answers "what changed" with only the hunks; this view
 * answers it inside the file the way an editor gutter does — the complete file
 * stays readable and the changed lines are marked in place. A deletion has no
 * line of its own on the new side, so it becomes a marker attached to the
 * position it was removed from rather than a row that would misrepresent the
 * file's own line numbering.
 */

import type { ChangeMarker, DiffFile } from './types.ts'

/** The decorations one parsed file contributes, merged and ascending. */
export function changeMarkers(file: Pick<DiffFile, 'hunks'>): readonly ChangeMarker[] {
  const markers = new Map<number, ChangeMarker>()
  for (const hunk of file.hunks) {
    for (const line of hunk.addedLines) markers.set(line, { line, kind: 'added' })
  }
  // An added line wins a shared position: the line exists and is new here,
  // while a deletion at the same position is the secondary fact.
  for (const hunk of file.hunks) {
    for (const line of hunk.removedAt) {
      if (!markers.has(line)) markers.set(line, { line, kind: 'removed' })
    }
  }
  return [...markers.values()].sort((left, right) => left.line - right.line)
}

/** Unchanged lines kept around each change in the changed-lines view. */
export const CHANGE_CONTEXT_LINES = 3

/**
 * The lines a changed-lines view hides.
 *
 * Each change keeps a few lines of context around it, so a reader sees the
 * change in place rather than a bare line; everything else between two distant
 * changes is hidden and the view marks where it skipped. A file with no markers
 * hides nothing: there is no change to zoom in on.
 *
 * @param markers - the change markers, in any order.
 * @param lineCount - the displayed file's line count.
 * @param context - unchanged lines kept on each side of a change.
 * @returns the 1-based line numbers to hide, empty when nothing is hidden.
 */
export function hiddenLineNumbers(
  markers: readonly ChangeMarker[],
  lineCount: number,
  context: number = CHANGE_CONTEXT_LINES,
): ReadonlySet<number> {
  if (markers.length === 0 || lineCount <= 0) return new Set()
  const shown = new Set<number>()
  const reach = Math.max(0, Math.trunc(context))
  for (const marker of markers) {
    for (let line = marker.line - reach; line <= marker.line + reach; line += 1) {
      if (line >= 1 && line <= lineCount) shown.add(line)
    }
  }
  const hidden = new Set<number>()
  for (let line = 1; line <= lineCount; line += 1) {
    if (!shown.has(line)) hidden.add(line)
  }
  return hidden
}

/**
 * Grammar hints the platform highlighter accepts, by file extension.
 *
 * The primitive resolves a hint against its own alias table and renders plain
 * text for anything absent, so this table mirrors exactly that set: a hint this
 * function returns always highlights, and an unknown extension returns
 * `undefined` rather than a label that would silently do nothing.
 */
const LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  sh: 'shellscript',
  bash: 'shellscript',
  zsh: 'shellscript',
  json: 'json',
  jsonc: 'jsonc',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  c: 'c',
  h: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  kt: 'kotlin',
  kts: 'kotlin',
  swift: 'swift',
  php: 'php',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  ini: 'ini',
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'mdx',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  sql: 'sql',
  xml: 'xml',
  lua: 'lua',
}

/**
 * The grammar hint for a path, from its extension.
 *
 * @param path - repository-relative path.
 * @returns a supported hint, or undefined when the extension has no grammar.
 */
export function languageFor(path: string): string | undefined {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase()
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return undefined
  return LANGUAGE_BY_EXTENSION[name.slice(dot + 1)]
}

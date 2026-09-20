/** Pure, lossless conflict editing. No filesystem, Git, or UI dependencies. */
export type ConflictSide = 'current' | 'incoming'
export type ConflictResolution =
  | { readonly kind: ConflictSide }
  | { readonly kind: 'both'; readonly order: 'current-incoming' | 'incoming-current' }
  | { readonly kind: 'edit'; readonly text: string }

export interface ConflictLabels {
  readonly current: string | null
  readonly base: string | null
  readonly incoming: string | null
}

export interface ConflictHunk {
  readonly kind: 'conflict'
  /** Original UTF-16 offset identity; stable through edits, not across file versions. */
  readonly id: string
  readonly start: number
  readonly end: number
  readonly markerSize: number
  readonly labels: ConflictLabels
  readonly current: string
  /** null means no base marker; an empty base section is the empty string. */
  readonly base: string | null
  readonly incoming: string
  readonly original: string
  /** Initially the original marker block, never an implicitly chosen side. */
  readonly result: string
  readonly resolution: ConflictResolution | null
}

export interface ConflictTextSegment {
  readonly kind: 'text'
  readonly text: string
}

export interface ConflictParseIssue {
  readonly code: 'unexpected-marker' | 'nested-marker' | 'marker-size-mismatch' | 'unclosed-conflict'
  readonly line: number
  readonly offset: number
}

export interface TextConflictModel {
  readonly kind: 'text'
  /** Effective configured width; retained when resolving or reparsing drafts. */
  readonly markerSize: number
  readonly segments: readonly (ConflictTextSegment | ConflictHunk)[]
  /** Invalid blocks remain literal text and cannot be accepted piecemeal. */
  readonly issues: readonly ConflictParseIssue[]
}

export interface ConflictMarker {
  readonly kind: 'current' | 'base' | 'separator' | 'incoming'
  readonly size: number
  readonly label: string | null
  readonly line: number
  readonly offset: number
}

export interface ConflictValidation {
  /** Only marker-free, not proof of semantic correctness or a resolved Git index. */
  readonly valid: boolean
  readonly markers: readonly ConflictMarker[]
}

interface Line {
  readonly text: string
  readonly start: number
  readonly end: number
  readonly number: number
}

function linesOf(text: string): Line[] {
  const lines: Line[] = []
  const pattern = /([^\r\n]*)(\r\n|\n|\r|$)/g
  for (const match of text.matchAll(pattern)) {
    if (match[0] === '') break
    lines.push({ text: match[1]!, start: match.index, end: match.index + match[0].length, number: lines.length + 1 })
  }
  return lines
}

function markerOf(line: Line, markerSize: number): ConflictMarker | null {
  // Keep the default short-operator behavior, but recognize configured small
  // markers too. Retain conservative detection of ordinary/larger markers.
  // A fixed regex bounds allocation by the input, never by the attribute value.
  const match = /^(<+|\|+|=+|>+)(?:[ \t](.*))?$/.exec(line.text)
  if (!match || match[1]!.length < Math.min(7, markerSize)) return null
  const run = match[1]!
  const kind = run[0] === '<' ? 'current' : run[0] === '|' ? 'base' : run[0] === '=' ? 'separator' : 'incoming'
  if (kind === 'separator' && (match[2] ?? '').trim() !== '') return null
  return { kind, size: run.length, label: match[2] ?? null, line: line.number, offset: line.start }
}

/**
 * Parse standard and diff3/zdiff3 blocks. zdiff3's common context is already
 * outside its markers; it is retained verbatim with every original newline.
 * Malformed/nested blocks are reported and preserved, never guessed at.
 */
export function parseConflictText(text: string, markerSize = 7): TextConflictModel {
  if (!Number.isSafeInteger(markerSize) || markerSize <= 0) throw new RangeError('Conflict marker size must be a positive safe integer')
  const segments: (ConflictTextSegment | ConflictHunk)[] = []
  const issues: ConflictParseIssue[] = []
  let cursor = 0
  let active: {
    start: Line
    open: ConflictMarker
    base: Line | null
    baseLabel: string | null
    separator: Line | null
    depth: number
    invalid: boolean
  } | null = null
  const issue = (code: ConflictParseIssue['code'], marker: ConflictMarker) => {
    issues.push({ code, line: marker.line, offset: marker.offset })
  }
  for (const line of linesOf(text)) {
    const marker = markerOf(line, markerSize)
    if (!marker) continue
    if (!active) {
      if (marker.kind === 'current') {
        active = { start: line, open: marker, base: null, baseLabel: null, separator: null, depth: 1, invalid: false }
      } else issue('unexpected-marker', marker)
      continue
    }
    if (marker.kind === 'current') {
      active.depth++
      active.invalid = true
      issue('nested-marker', marker)
      continue
    }
    if (marker.size !== active.open.size) {
      active.invalid = true
      issue('marker-size-mismatch', marker)
    }
    if (active.depth > 1) {
      if (marker.kind === 'incoming') active.depth--
      continue
    }
    if (marker.kind === 'base' && !active.base && !active.separator) {
      active.base = line
      active.baseLabel = marker.label
    } else if (marker.kind === 'separator' && !active.separator) {
      active.separator = line
    } else if (marker.kind === 'incoming') {
      const separator = active.separator
      if (!separator) {
        active.invalid = true
        issue('unexpected-marker', marker)
      }
      if (!active.invalid && separator) {
        if (cursor < active.start.start) segments.push({ kind: 'text', text: text.slice(cursor, active.start.start) })
        const original = text.slice(active.start.start, line.end)
        segments.push({
          kind: 'conflict', id: 'conflict:' + active.start.start, start: active.start.start, end: line.end,
          markerSize: active.open.size,
          labels: { current: active.open.label, base: active.baseLabel, incoming: marker.label },
          current: text.slice(active.start.end, (active.base ?? separator).start),
          base: active.base ? text.slice(active.base.end, separator.start) : null,
          incoming: text.slice(separator.end, line.start), original, result: original, resolution: null,
        })
        cursor = line.end
      }
      active = null
    } else {
      active.invalid = true
      issue('unexpected-marker', marker)
    }
  }
  if (active) issue('unclosed-conflict', active.open)
  if (cursor < text.length) segments.push({ kind: 'text', text: text.slice(cursor) })
  return { kind: 'text', markerSize, segments, issues }
}

/** Apply an explicit hunk choice without reparsing or renumbering other hunks. */
export function resolveConflictHunk(model: TextConflictModel, id: string, resolution: ConflictResolution): TextConflictModel {
  if (!model.segments.some((segment) => segment.kind === 'conflict' && segment.id === id)) {
    throw new Error('Unknown conflict hunk: ' + id)
  }
  return {
    ...model,
    segments: model.segments.map((segment) => {
      if (segment.kind !== 'conflict' || segment.id !== id) return segment
      let result: string
      switch (resolution.kind) {
        case 'current': result = segment.current; break
        case 'incoming': result = segment.incoming; break
        case 'both':
          if (resolution.order !== 'current-incoming' && resolution.order !== 'incoming-current') {
            throw new Error('Accept both requires an explicit side order')
          }
          // Concatenate exact source slices. Never normalize or invent newlines.
          result = resolution.order === 'current-incoming'
            ? segment.current + segment.incoming : segment.incoming + segment.current
          break
        case 'edit': result = resolution.text; break
      }
      return { ...segment, result, resolution }
    }),
  }
}

export function renderConflictResult(model: TextConflictModel): string {
  return model.segments.map((segment) => segment.kind === 'text' ? segment.text : segment.result).join('')
}

/** Standalone marker-shaped lines are conservative warnings even if unpaired. */
export function validateConflictResult(text: string, markerSize = 7): ConflictValidation {
  if (!Number.isSafeInteger(markerSize) || markerSize <= 0) return { valid: false, markers: [] }
  const markers = linesOf(text).flatMap((line) => {
    const marker = markerOf(line, markerSize)
    return marker ? [marker] : []
  })
  return { valid: markers.length === 0, markers }
}

/** Opaque index stage metadata, not decoded or synthesized file contents. */
export interface ConflictFileSide {
  readonly path: string
  readonly oid: string
  readonly mode: string
}

export type NonTextConflictDecision =
  | { readonly kind: ConflictSide }
  | { readonly kind: 'delete' }
  | { readonly kind: 'external' }

export interface NonTextConflictModel {
  readonly kind: 'nontext'
  readonly reason: 'binary' | 'symlink' | 'submodule' | 'rename' | 'delete-modify' | 'nontext'
  readonly base: ConflictFileSide | null
  readonly current: ConflictFileSide | null
  readonly incoming: ConflictFileSide | null
  /** External means review an out-of-band resolution, not that it is resolved. */
  readonly decision: NonTextConflictDecision | null
}

export type ConflictModel = TextConflictModel | NonTextConflictModel

/** Missing stages require an explicit deletion decision rather than empty text. */
export function resolveNonTextConflict(model: NonTextConflictModel, decision: NonTextConflictDecision): NonTextConflictModel {
  if ((decision.kind === 'current' || decision.kind === 'incoming') && model[decision.kind] === null) {
    throw new Error('Missing ' + decision.kind + ' conflict side; choose deletion explicitly')
  }
  return { ...model, decision }
}

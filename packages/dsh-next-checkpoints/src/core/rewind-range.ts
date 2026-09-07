/**
 * Surface-replace range: shadow every current surface node after the
 * checkpoint's turn/end seq. `start`/`end` must be live surface nodes.
 */

export interface ReplaceRange {
  readonly start: number
  readonly end: number
  readonly shadowed: readonly number[]
}

/**
 * Compute the replace span for a rewind. Null when nothing later is on the
 * surface (files-only restore).
 */
export function replaceRange(
  nodes: readonly number[],
  checkpointSeq: number,
): ReplaceRange | null {
  const shadowed = nodes.filter((seq) => seq > checkpointSeq).sort((a, b) => a - b)
  if (shadowed.length === 0) return null
  return {
    start: shadowed[0]!,
    end: shadowed[shadowed.length - 1]!,
    shadowed,
  }
}

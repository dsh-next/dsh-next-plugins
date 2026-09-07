/**
 * GitHub-style diffstat: grouped +/− counts and a five-block add/del/empty bar.
 * Floor the ratios so a tiny side does not steal a block (4,801 / 66 → 4 green, 1 empty).
 */

export const DIFFSTAT_BLOCKS = 5

export type DiffstatBlock = 'add' | 'del' | 'empty'

function nonNegative(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.floor(n)
}

/** Absolute count with en-US grouping (`4801` → `4,801`). */
export function formatDiffCount(n: number): string {
  return nonNegative(n).toLocaleString('en-US')
}

/**
 * Five blocks, greens then reds then empty. Floor so both sides cannot
 * exceed five; leftover cells stay empty.
 */
export function diffstatBlocks(added: number, removed: number): readonly DiffstatBlock[] {
  const add = nonNegative(added)
  const del = nonNegative(removed)
  const total = add + del
  if (total === 0) {
    return Array.from({ length: DIFFSTAT_BLOCKS }, () => 'empty' as const)
  }
  const addN = Math.floor((add / total) * DIFFSTAT_BLOCKS)
  const delN = Math.floor((del / total) * DIFFSTAT_BLOCKS)
  const blocks: DiffstatBlock[] = []
  for (let i = 0; i < addN; i += 1) blocks.push('add')
  for (let i = 0; i < delN; i += 1) blocks.push('del')
  while (blocks.length < DIFFSTAT_BLOCKS) blocks.push('empty')
  return blocks
}

export function sumDiffs(
  files: readonly { readonly added: number; readonly removed: number }[],
): { readonly added: number; readonly removed: number } {
  let added = 0
  let removed = 0
  for (const file of files) {
    added += nonNegative(file.added)
    removed += nonNegative(file.removed)
  }
  return { added, removed }
}

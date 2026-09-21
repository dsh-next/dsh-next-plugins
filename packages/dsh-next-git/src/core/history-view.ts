import type { CommitSummary } from './types.ts'

export interface CommitFile {
  readonly path: string
  readonly status: string
  readonly oldPath?: string
}

export interface CommitDetails {
  readonly commit: CommitSummary
  readonly message: string
  /** Diff parent used for merge commits; null denotes the empty tree. */
  readonly parent: string | null
  readonly files: readonly CommitFile[]
}

export interface CommitComparison {
  readonly from: string
  readonly to: string
  readonly summary: string
  readonly patch: string
  readonly truncated: boolean
}

/** Immutable inspection and pagination accept only full SHA-1 or SHA-256 IDs. */
export function isHistoryOid(value: string): boolean {
  return /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)
}

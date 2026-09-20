import type { CommitSummary } from './types.ts'

/** Literal search filters. A selected ref is resolved once per history window. */
export interface HistoryQuery {
  readonly ref: string | null
  readonly search: string
  readonly author: string
  readonly since: string
  readonly until: string
}

export const emptyHistoryQuery: HistoryQuery = { ref: null, search: '', author: '', since: '', until: '' }

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

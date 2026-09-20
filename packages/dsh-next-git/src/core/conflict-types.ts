/** JSON-only conflict workspace contract; filesystem data stays in the host. */
import type { TextConflictModel } from './conflicts.ts'

export type ConflictFileKind = 'absent' | 'text' | 'binary' | 'symlink' | 'submodule' | 'oversize' | 'nonregular'
export type ConflictFileChoice = 'current' | 'incoming' | 'base' | 'delete'

export interface ConflictFile {
  readonly kind: ConflictFileKind
  readonly mode: string | null
  readonly oid: string | null
  readonly size: number
  /** Text only. Binary bytes and symlink targets are never editable text. */
  readonly content: string | null
}

export interface ConflictOperationLabels {
  readonly operation: 'merge' | 'rebase' | 'cherry-pick' | 'revert' | 'unknown'
  readonly current: string
  readonly incoming: string
  readonly base: string
  readonly currentRef: string | null
  readonly incomingRef: string | null
}

export interface ConflictWorkspace {
  readonly path: string
  readonly version: string
  /** Effective Git conflict-marker-size; null disables writes for unsupported values. */
  readonly markerSize: number | null
  readonly stages: { readonly base: ConflictFile; readonly current: ConflictFile; readonly incoming: ConflictFile }
  readonly worktree: ConflictFile
  readonly labels: ConflictOperationLabels
  readonly model: TextConflictModel | null
  readonly canSave: boolean
  readonly canMarkResolved: boolean
  readonly choices: readonly ConflictFileChoice[]
  /** Technical English explanation when an action cannot be offered safely. */
  readonly unsupportedReason: string | null
}

export interface ConflictVersionInput {
  readonly path: string
  readonly expectedVersion: string
}
export interface ConflictSaveInput extends ConflictVersionInput {
  readonly content: string
}
export interface ConflictChooseInput extends ConflictVersionInput {
  readonly side: ConflictFileChoice
}
export interface ConflictWriteResult {
  readonly workspace: ConflictWorkspace
  /** Durable input snapshot under the checkout's gitDir/dsh-conflicts. */
  readonly backupId: string
}
export interface ConflictResolvedResult {
  readonly path: string
  readonly resolved: true
  readonly backupId: string
}

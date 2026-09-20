/** JSON-only contract for deterministic, explicitly approved repository actions. */
export type HunkSide = 'staged' | 'unstaged'
export interface HunkRequest { readonly path: string; readonly side: HunkSide }
export interface SelectableHunk {
  readonly id: string
  readonly header: string
  readonly patch: string
}
export type HunkUnsupported = 'binary' | 'rename' | 'new-file' | 'deleted-file' | 'mode-change' | 'symlink' | 'submodule' | 'non-text'
export interface HunkPreview extends HunkRequest {
  readonly version: string
  readonly hunks: readonly SelectableHunk[]
  readonly unsupported: HunkUnsupported | null
  /** Use the separately approved whole-file stage/unstage workflow, never a partial patch. */
  readonly wholeFileFallback: boolean
}
export interface HunkApplyRequest extends HunkRequest {
  readonly version: string
  readonly hunkIds: readonly string[]
  readonly approved: true
}
export interface RepositoryRemote {
  readonly name: string
  readonly fetchUrls: readonly string[]
  readonly pushUrls: readonly string[]
}
export interface RepositoryStash { readonly oid: string; readonly label: string }
export interface RepositoryInventory {
  readonly remotes: readonly RepositoryRemote[]
  readonly stashes: readonly RepositoryStash[]
}
export type RepositoryActionRequest =
  | { readonly action: 'fetch'; readonly remote: string; readonly prune: boolean }
  | { readonly action: 'push'; readonly remote: string; readonly branch: string }
  | { readonly action: 'stash-save'; readonly includeUntracked: boolean; readonly message?: string }
  | { readonly action: 'stash-apply'; readonly stashOid: string }
export interface RepositoryActionPreview {
  readonly version: string
  readonly request: RepositoryActionRequest
  readonly checkout: string
  readonly head: string | null
  readonly summary: string
  readonly warnings: readonly string[]
}
export interface RepositoryActionExecution {
  readonly request: RepositoryActionRequest
  readonly version: string
  readonly approved: true
}
export interface RepositoryActionResult {
  readonly status: 'completed' | 'noop' | 'rejected' | 'failed' | 'conflicted'
  readonly refresh: boolean
  readonly conflictRefresh: boolean
  readonly reason: string | null
  readonly message: string | null
  readonly stashOid: string | null
}

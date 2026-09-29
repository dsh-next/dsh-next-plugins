import type { PanelState } from '../../core/types.ts'
import type { GitApi } from '../api.ts'
import type { Translate } from '../dictionaries.ts'

export type RepositoryAction = 'fetch' | 'push' | 'stash-save' | 'stash-apply' | 'branch-create' | 'branch-rename' | 'branch-delete'

export interface RepositoryWorkspaceViewProps {
  sessionId: string
  state: PanelState
  api: GitApi
  t: Translate
  action: RepositoryAction
  initialPrune?: boolean
  initialIncludeUntracked?: boolean
  latestStash?: boolean
  flexibleStartPoint?: boolean
  onClose(): void
  onChanged(): Promise<void> | void
}

export function repositoryActionLabel(action: RepositoryAction): Parameters<Translate>[0] {
  switch (action) {
    case 'branch-create': return 'repository.branch.create'
    case 'branch-rename': return 'repository.branch.rename'
    case 'branch-delete': return 'repository.branch.delete'
    default: return `repository.${action}`
  }
}

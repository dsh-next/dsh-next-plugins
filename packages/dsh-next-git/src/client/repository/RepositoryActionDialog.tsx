import * as React from 'react'
import { RepositoryWorkspaceView, type RepositoryAction } from './RepositoryWorkspace.tsx'
import { RepositoryCommandDialog, type RepositoryCommandDialogProps } from './RepositoryCommandDialog.tsx'
import { LocalCommandDialog } from './LocalCommandDialog.tsx'
import { CommitCommandDialog } from './CommitCommandDialog.tsx'

/**
 * One selected command mounts exactly one focused dialog.
 *
 * `checkout` is absent on purpose: the panel routes it to the ref picker, so
 * a checkout names a ref the same way the header's branch chip does.
 */
export function RepositoryActionDialog(props: RepositoryCommandDialogProps): React.ReactElement {
  const { command } = props
  if (command === 'commit' || command.startsWith('commit-')) return <CommitCommandDialog {...props}
    mode={command.startsWith('commit-all') ? 'all' : 'staged'} amend={command.endsWith('-amend')} signoff={command.endsWith('-signoff')} />
  if (['stage-all', 'unstage-all', 'discard-all', 'abort-rebase'].includes(command)) return <LocalCommandDialog {...props} />
  const action: RepositoryAction | null = command === 'fetch-prune' ? 'fetch'
    : command === 'push-to' ? 'push'
      : command === 'stash-untracked' ? 'stash-save'
        : command === 'stash-apply-latest' ? 'stash-apply'
          : command === 'branch-create-from' ? 'branch-create'
            : ['fetch', 'push', 'stash-save', 'stash-apply', 'branch-create', 'branch-rename', 'branch-delete'].includes(command) ? command as RepositoryAction : null
  if (action) return <RepositoryWorkspaceView {...props} action={action}
    flexibleStartPoint={command === 'branch-create-from'} initialPrune={command === 'fetch-prune'} initialIncludeUntracked={command === 'stash-untracked'} latestStash={command === 'stash-apply-latest'} />
  return <RepositoryCommandDialog {...props} />
}

import * as React from 'react'
import { BranchWorkspace } from './BranchWorkspace.tsx'
import { TransferWorkspace } from './TransferWorkspace.tsx'
import type { RepositoryWorkspaceViewProps } from './workspace-types.ts'

export { repositoryActionLabel, type RepositoryAction, type RepositoryWorkspaceViewProps } from './workspace-types.ts'

/** A command owns one dialog, keyed so changing modes never retains approvals. */
export function RepositoryWorkspaceView(props: RepositoryWorkspaceViewProps): React.ReactElement {
  const key = JSON.stringify([props.sessionId, props.state.root, props.action])
  if (props.action.startsWith('branch-')) return <BranchWorkspace key={key} {...props} />
  return <TransferWorkspace key={key} {...props} />
}

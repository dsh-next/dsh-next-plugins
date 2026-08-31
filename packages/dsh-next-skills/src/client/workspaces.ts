/**
 * Defensive extraction of workspace rows from the client `IWorkspaces` service.
 * The concrete `WorkspaceView` type lives in a package not installed in this
 * repo, so this reads the list snapshot structurally and normalizes it into
 * the pure {@link WorkspaceRow} shape.
 */
import type { IWorkspaces } from '@deepseek-ai/dsh-client-runtime/client'
import type { WorkspaceRow } from '../core/types.ts'

interface WorkspaceViewLike {
  workspaceId?: unknown
  path?: string
  title?: string
}

export function extractWorkspaces(workspaces: IWorkspaces | undefined): WorkspaceRow[] {
  if (!workspaces?.list) return []
  try {
    const snapshot = workspaces.list.getSnapshot()
    const items = (snapshot?.items ?? []) as readonly WorkspaceViewLike[]
    return items
      .filter((w): w is WorkspaceViewLike & { path: string } => typeof w?.path === 'string' && w.path !== '')
      .map((w) => ({
        id: typeof w.workspaceId === 'string' ? w.workspaceId : String(w.workspaceId ?? w.path),
        title: typeof w.title === 'string' && w.title !== '' ? w.title : w.path,
        path: w.path,
      }))
  } catch {
    return []
  }
}

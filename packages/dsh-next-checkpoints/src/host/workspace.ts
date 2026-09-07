/**
 * Attach a rewind fork to the parent session's Host workspace group.
 * Host `sessions.fork` copies cwd but does not call `attachSession`;
 * without that the child lands under Ungrouped.
 */

/** Structural face of `ctx.workspaceRegistry` — never import the package. */
export interface WorkspaceRegistryLike {
  list(): readonly {
    readonly sessionIds: readonly string[]
    attachSession(sessionId: string): Promise<void>
  }[]
}

/** Find the workspace that already accounts `from` and attach `to`. */
export async function attachForkToWorkspace(
  registry: WorkspaceRegistryLike | undefined,
  from: string,
  to: string,
): Promise<void> {
  if (registry === undefined || typeof registry.list !== 'function') return
  const workspace = registry.list().find((item) => item.sessionIds.includes(from))
  if (workspace === undefined || typeof workspace.attachSession !== 'function') return
  await workspace.attachSession(to)
}

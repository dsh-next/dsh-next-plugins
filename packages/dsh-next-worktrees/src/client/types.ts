/**
 * Loose client-side faces shared across the worktrees browser half.
 *
 * These are structural subsets of the SDK service/controller types,
 * declared locally so pure modules stay dependency-free and testable
 * under jsdom without the SDK runtime. The strict types remain the
 * contract; these faces stay narrower than them by construction.
 */

/** Per-workspace creation facts from the topology RPC. */
export interface WorkspaceFactsLike {
  readonly cwd: string
  readonly primary: string
  readonly canCreate: boolean
  readonly reason?: string
}

/** The workspaces service face this plugin drives. */
export interface WorkspacesServiceLike {
  create(input: { path: string }): Promise<{ workspaceId: string; path: string }>
  /** The stock delete: drops the host workspace registry entry. */
  delete(workspaceId: string): Promise<void>
  /** The stock archive: moves a session out of its workspace's list. */
  archiveSession(sessionId: string): Promise<void>
  /** The stock rename: display title only, not the path. */
  rename?(workspaceId: string, title: string): Promise<unknown>
}

/** One listed session row this plugin reads (running + prompt handoff). */
export interface SessionListRowLike {
  readonly running?: boolean
}

/** The sessions service face this plugin drives. */
export interface SessionsServiceLike {
  create(input: { workspaceId: string }): Promise<string>
  open(sessionId: string): void
  readonly list?: {
    getSnapshot(): { byId: Readonly<Record<string, SessionListRowLike | undefined>> }
  }
  binding?(sessionId: string): {
    session: {
      prompt(
        content: readonly { type: 'text'; text: string }[],
        mode: 'queue' | 'steer',
      ): Promise<unknown>
    }
  } | undefined
}

/** Translate face backed by the locale dictionaries. */
export type Translate = (key: string, params?: Record<string, string | number>) => string

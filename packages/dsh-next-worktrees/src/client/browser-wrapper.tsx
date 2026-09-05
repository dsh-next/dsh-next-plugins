/**
 * The plugin-owned seat around the official Workspace Browser.
 *
 * Strategy B (docs/ideas/dsh-next-worktrees-sidebar-ux.md): this plugin
 * replaces the stock `ui-workspace` loader row and registers the official
 * browser, wrapped here. The wrapper owns the NESTING PROJECTION: it
 * pulls the worktree topology from the host RPC, hides the worktree
 * workspace groups, re-parents their sessions under the repo group with
 * decoration metadata, and guards the mutations that are unsafe for
 * re-parented rows (fork, reorder). The derived renderer seams turn the
 * metadata into the branch-icon identity, the indent, and the suppressed
 * affordances.
 */
import * as React from 'react'
import {
  decorateSessions,
  projectWorkspaceSidebar,
  type WorkspaceItemLike,
} from './projection.ts'
import { updateBridgeFacts } from './bridge.ts'
import { modalState } from './create-store.ts'
import { rpc, REFRESH_EVENT, requestTopologyRefresh, type WorktreeTopology } from './rpc.ts'
import { sweepAbandonedWorktrees } from './sweeper.ts'

/** Minimal component shape the wrapper needs from the official Browser. */
export type OfficialBrowserComponent = React.ComponentType<Record<string, unknown>>

/** Props the wrapper adds beyond the official Browser's own. */
export interface WorktreeBrowserExtraProps {
  readonly OfficialBrowser: OfficialBrowserComponent
}

const EMPTY_TOPOLOGY: WorktreeTopology = { repos: [], workspaces: [] }

/** Selector-hook face the official Browser consumes for store reads. */
type UseState<T> = (selector: (state: T) => unknown) => unknown

interface WorkspaceStateLike {
  readonly items: readonly WorkspaceItemLike[]
}

interface SessionStateLike {
  readonly ids: readonly string[]
  readonly byId: Readonly<Record<string, { id: string; blank?: boolean } | undefined>>
  readonly current?: string
}

interface OfficialPropsLike {
  readonly useWorkspaces?: UseState<WorkspaceStateLike>
  readonly useSessions?: UseState<SessionStateLike>
  readonly forkSession?: (sessionId: string) => void | Promise<void>
  readonly insertSessionBefore?: (
    workspaceId: string,
    sessionId: string,
    beforeSessionId?: string,
  ) => void | Promise<void>
  readonly startSession?: (workspaceId?: string) => void | Promise<void>
}

/**
 * Render the official Browser with the worktree projection applied.
 *
 * @param props - the sidebar slot's render props plus the official
 * component to wrap.
 * @returns the official Browser element fed projected state.
 */
export function WorktreeBrowser(
  props: WorktreeBrowserExtraProps & Record<string, unknown>,
): React.ReactElement {
  const { OfficialBrowser, ...rest } = props
  const officialProps = rest as unknown as OfficialPropsLike & Record<string, unknown>

  const workspaceState = officialProps.useWorkspaces !== undefined
    ? officialProps.useWorkspaces((state: WorkspaceStateLike) => state) as WorkspaceStateLike
    : { items: [] }
  const sessionState = officialProps.useSessions !== undefined
    ? officialProps.useSessions((state: SessionStateLike) => state) as SessionStateLike
    : { ids: [], byId: {} }

  const [topology, setTopology] = React.useState<WorktreeTopology>(EMPTY_TOPOLOGY)
  const workspaceKey = workspaceState.items
    .map((w) => `${w.workspaceId}:${w.sessionIds.join(',')}`)
    .join('|')
  const sessionKey = sessionState.ids.join('|')
  const currentKey = sessionState.current ?? ''
  // Live refs so a sweep that started from an older render still sees the
  // session the user just opened (create race) without refetching git
  // topology on every session switch.
  const itemsRef = React.useRef(workspaceState.items)
  itemsRef.current = workspaceState.items
  const byIdRef = React.useRef(sessionState.byId)
  byIdRef.current = sessionState.byId
  const currentRef = React.useRef(sessionState.current)
  currentRef.current = sessionState.current

  const sweepNow = React.useCallback((): Promise<readonly string[]> =>
    sweepAbandonedWorktrees({
      workspaces: itemsRef.current,
      sessionsById: byIdRef.current,
      currentSessionId: currentRef.current,
      creating: modalState().creating,
    }), [])

  React.useEffect(() => {
    let active = true
    const paths = workspaceState.items.map((w) => w.path)
    const refresh = (): void => {
      rpc<WorktreeTopology>('topology', { cwds: paths })
        .then(
          (value) => {
            if (!active) return
            setTopology(value)
            updateBridgeFacts(value.workspaces)
            // Reap worktrees whose sessions were replaced/removed without
            // ever starting (the platform replaces blank sessions); when
            // something was swept, re-pull once so the sidebar settles.
            void sweepNow().then((swept) => {
              if (active && swept.length > 0) refresh()
            })
          },
          () => { if (active) setTopology(EMPTY_TOPOLOGY) },
        )
    }
    refresh()
    window.addEventListener(REFRESH_EVENT, refresh)
    return () => {
      active = false
      window.removeEventListener(REFRESH_EVENT, refresh)
    }
    // Membership only: switching the open session must not fan out git
    // status across every worktree.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceKey, sessionKey, sweepNow])

  React.useEffect(() => {
    void sweepNow().then((swept) => {
      if (swept.length > 0) requestTopologyRefresh()
    })
  }, [currentKey, sweepNow])

  const projection = React.useMemo(
    () => projectWorkspaceSidebar({
      workspaces: workspaceState.items,
      sessionsById: sessionState.byId,
      topology,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [topology, workspaceKey, sessionKey],
  )

  const projectedWorkspaces = React.useMemo(
    () => workspaceState.items
      .filter((w) => !projection.hiddenWorkspaceIds.has(w.workspaceId))
      .map((w) => {
        const merged = projection.workspaces.find((p) => p.workspaceId === w.workspaceId)
        return merged === undefined ? w : { ...w, sessionIds: merged.sessionIds }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workspaceState, projection],
  )

  const projectedSessions = React.useMemo(
    () => decorateSessions(sessionState.byId, projection.decorations),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionState, projection],
  )

  const useProjectedWorkspaces = ((selector: (state: unknown) => unknown): unknown =>
    selector({ ...workspaceState, items: projectedWorkspaces })) as OfficialPropsLike['useWorkspaces']
  const useProjectedSessions = ((selector: (state: unknown) => unknown): unknown =>
    selector({ ...sessionState, byId: projectedSessions })) as OfficialPropsLike['useSessions']

  const guardedProps: Record<string, unknown> = {
    ...(officialProps as object),
    useWorkspaces: useProjectedWorkspaces,
    useSessions: useProjectedSessions,
    forkSession: (sessionId: string): void | Promise<void> => {
      if (projection.decorations.has(sessionId)) return
      return officialProps.forkSession?.(sessionId)
    },
    insertSessionBefore: (
      workspaceId: string,
      sessionId: string,
      beforeSessionId?: string,
    ): void | Promise<void> => {
      if (projection.decorations.has(sessionId)) return
      if (beforeSessionId !== undefined && projection.decorations.has(beforeSessionId)) return
      if (projection.hiddenWorkspaceIds.has(workspaceId)) return
      return officialProps.insertSessionBefore?.(workspaceId, sessionId, beforeSessionId)
    },
  }

  return <OfficialBrowser {...guardedProps} />
}

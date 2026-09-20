import type {
  ISessions, SessionBinding, SessionEventWindow, SessionFace, SessionListState,
  SessionReference, SessionRetainOptions, SessionTarget,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type {
  IWorkspaces, WorkspaceId,
} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { UiWorkspace } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    dshNextGit: unknown
  }
}

/** Pick only the binding faces consumed here; full SDK services satisfy these contracts. */
type PromptReference = { readonly binding: { readonly session: Pick<SessionFace, 'prompt'> } }
type ObservedBinding = Pick<SessionBinding, 'eventSource'>
type ObservedReference = Pick<SessionReference, 'release'> & {
  readonly ready: Promise<ObservedBinding>
}

export interface SessionBridgeDependencies {
  sessions: Pick<ISessions, 'create' | 'list'> & {
    using<T>(target: SessionTarget, options: SessionRetainOptions,
      operation: (reference: PromptReference) => T | Promise<T>): Promise<T>
    retain(target: SessionTarget, options: SessionRetainOptions): ObservedReference
  }
  workspaces: Pick<IWorkspaces, 'list'>
  uiWorkspace: Pick<UiWorkspace, 'openSession'>
}

export type SessionBridgeErrorCode =
  | 'missing-source' | 'cwd-mismatch' | 'cancelled' | 'create-failed'
  | 'workspace-attach-failed' | 'send-failed' | 'prompt-rejected'
  | 'open-failed' | 'not-accepted' | 'subscription-failed'

/** Codes, not transport messages, are the presentation/localization contract. */
export class SessionBridgeError extends Error {
  readonly name = 'SessionBridgeError'
  constructor(
    readonly code: SessionBridgeErrorCode,
    readonly sessionId?: SessionId,
    cause?: unknown,
  ) {
    super(code, { cause })
  }
}

export interface SessionSourceMetadata {
  readonly sessionId: SessionId
  readonly title: string
  readonly cwd?: string
  readonly workspaceId?: WorkspaceId
  readonly workspaceTitle?: string
  readonly workspacePath?: string
}

export interface SessionDeliveryInput {
  readonly target: 'current' | 'new'
  /** Authoritative slot source, never the globally selected session. */
  readonly sourceSessionId: SessionId
  /** Checkout captured when the chooser opens, not a later selection. */
  readonly expectedCwd: string
  readonly text: string
  readonly requestId?: Parameters<SessionFace['prompt']>[3]
}

export interface SessionDeliverySnapshot {
  readonly requestId?: NonNullable<Parameters<SessionFace['prompt']>[3]>
  readonly createdSessionId?: SessionId
  readonly sessionId?: SessionId
  readonly accepted: boolean
  readonly opened: boolean
}

export interface SessionDelivery {
  getSnapshot(): SessionDeliverySnapshot
  /** Retries reuse the created identity; concurrent calls share one submission. */
  send(signal?: AbortSignal): Promise<SessionDeliverySnapshot>
  /** Navigation only. A failure here must never cause another prompt. */
  open(): SessionDeliverySnapshot
}

export interface SessionBridge {
  getSource(sourceSessionId: SessionId): SessionSourceMetadata | undefined
  createDelivery(input: SessionDeliveryInput): SessionDelivery
  /** Neither reason means the requested Git task succeeded; refresh Git state instead. */
  subscribeTurnEnd(sessionId: SessionId,
    onRefresh: (reason: 'turn-end' | 'reconnect') => void,
    onError?: (error: SessionBridgeError) => void): () => void
}

function cancelled(signal: AbortSignal | undefined, sessionId?: SessionId): void {
  if (signal?.aborted) throw new SessionBridgeError('cancelled', sessionId, signal.reason)
}

/** Decode an error boundary without importing the SDK's runtime Error constructor. */
function attachmentFailure(error: unknown): { sessionId?: SessionId } | undefined {
  if (typeof error !== 'object' || error === null || !('rpcError' in error)) return
  const failure = error.rpcError
  if (typeof failure !== 'object' || failure === null || !('code' in failure)
    || failure.code !== 'session/workspace-attach-failed') return
  if ('details' in failure && typeof failure.details === 'object' && failure.details !== null
    && 'sessionId' in failure.details && typeof failure.details.sessionId === 'string'
    && failure.details.sessionId.length > 0) {
    // This is nominal admission of the Host-issued identity, not a service-shape cast.
    return { sessionId: failure.details.sessionId as SessionId }
  }
  return {}
}

/** Adapt the official alpha.2 services without borrowing a scope or navigation selection. */
export function createSessionBridge(deps: SessionBridgeDependencies): SessionBridge {
  function getSource(sourceSessionId: SessionId): SessionSourceMetadata | undefined {
    const catalog: SessionListState = deps.sessions.list.getSnapshot()
    const row = catalog.byId[sourceSessionId]
    if (!row) return
    const workspace = deps.workspaces.list.getSnapshot().items.find(
      item => item.sessionIds.includes(sourceSessionId),
    )
    return {
      sessionId: sourceSessionId, title: row.displayTitle,
      cwd: row.cwd ?? workspace?.path,
      workspaceId: workspace?.workspaceId, workspaceTitle: workspace?.title,
      workspacePath: workspace?.path,
    }
  }

  function createDelivery(input: SessionDeliveryInput): SessionDelivery {
    // Copy primitives: subsequent mutation of the caller's chooser state cannot retarget this turn.
    const { target, sourceSessionId, expectedCwd, text } = input
    // Host prompt admission deduplicates this identity even if an acknowledgement is lost.
    const requestId = input.requestId ?? (globalThis.crypto.randomUUID() as NonNullable<Parameters<SessionFace['prompt']>[3]>)
    let createdSessionId: SessionId | undefined
    let sessionId: SessionId | undefined
    let accepted = false
    let opened = false
    let inflight: Promise<SessionDeliverySnapshot> | undefined
    let createOptions: Parameters<ISessions['create']>[0]
    let partialCreate = false
    let unidentifiedPartial: SessionBridgeError | undefined

    const getSnapshot = (): SessionDeliverySnapshot => ({ requestId, createdSessionId, sessionId, accepted, opened })
    const checkSource = (): SessionSourceMetadata => {
      const source = getSource(sourceSessionId)
      if (!source) throw new SessionBridgeError('missing-source', sourceSessionId)
      if (!expectedCwd || source.cwd !== expectedCwd) {
        throw new SessionBridgeError('cwd-mismatch', sourceSessionId)
      }
      return source
    }

    async function submit(signal?: AbortSignal): Promise<SessionDeliverySnapshot> {
      if (accepted) return getSnapshot()
      cancelled(signal, sessionId)
      const source = checkSource()
      if (unidentifiedPartial) throw unidentifiedPartial
      if (target === 'new' && (!createdSessionId || partialCreate)) {
        // Workspace membership is authoritative. An unrelated workspace with the same path is not.
        createOptions ??= source.workspaceId && source.workspacePath === expectedCwd
          ? { workspaceId: source.workspaceId }
          : { cwd: expectedCwd }
        if (createOptions.workspaceId && deps.workspaces.list.getSnapshot().items.find(
          item => item.workspaceId === createOptions?.workspaceId,
        )?.path !== expectedCwd) {
          throw new SessionBridgeError('cwd-mismatch', createdSessionId ?? sourceSessionId)
        }
        try {
          createdSessionId = await deps.sessions.create(partialCreate
            ? { ...createOptions, sessionId: createdSessionId }
            : createOptions)
          sessionId = createdSessionId
          partialCreate = false
        } catch (error) {
          const partial = attachmentFailure(error)
          if (partial) {
            createdSessionId = partial.sessionId ?? createdSessionId
            sessionId = createdSessionId
            partialCreate = true
            const failure = new SessionBridgeError('workspace-attach-failed', createdSessionId, error)
            // Without the published id, retrying create could leak another fresh Session.
            if (!createdSessionId) unidentifiedPartial = failure
            throw failure
          }
          throw new SessionBridgeError('create-failed', createdSessionId, error)
        }
      }
      sessionId = target === 'current' ? sourceSessionId : createdSessionId
      if (!sessionId) throw new SessionBridgeError('create-failed')
      cancelled(signal, sessionId)
      const destination = sessionId
      try {
        await deps.sessions.using(destination, { source: 'dshNextGit', signal }, async ref => {
          cancelled(signal, destination)
          checkSource()
          const destinationCwd = getSource(destination)?.cwd
          if (destinationCwd !== undefined && destinationCwd !== expectedCwd) {
            throw new SessionBridgeError('cwd-mismatch', destination)
          }
          const result = await ref.binding.session.prompt([{ type: 'text', text }], 'queue', signal, requestId)
          if (!result.ok) {
            throw new SessionBridgeError(result.error.code === 'gateway/cancelled'
              ? 'cancelled' : 'prompt-rejected', destination, result.error)
          }
          // Once admitted, even a concurrent abort or reference-release failure cannot undo it.
          accepted = true
        })
      } catch (error) {
        if (accepted) return getSnapshot()
        if (error instanceof SessionBridgeError) throw error
        throw new SessionBridgeError(signal?.aborted ? 'cancelled' : 'send-failed', destination, error)
      }
      return getSnapshot()
    }

    return {
      getSnapshot,
      send(signal) {
        if (inflight) return inflight
        inflight = submit(signal).finally(() => { inflight = undefined })
        return inflight
      },
      open() {
        if (!accepted || !sessionId) throw new SessionBridgeError('not-accepted', sessionId)
        if (opened) return getSnapshot()
        try {
          deps.uiWorkspace.openSession(sessionId)
          opened = true
        } catch (error) {
          throw new SessionBridgeError('open-failed', sessionId, error)
        }
        return getSnapshot()
      },
    }
  }

  function subscribeTurnEnd(sessionId: SessionId,
    onRefresh: (reason: 'turn-end' | 'reconnect') => void,
    onError?: (error: SessionBridgeError) => void): () => void {
    const controller = new AbortController()
    let disposed = false
    let unsubscribe: (() => void) | undefined
    let reference: ObservedReference | undefined
    const dispose = (): void => {
      if (disposed) return
      disposed = true
      controller.abort()
      try { unsubscribe?.() } finally { reference?.release() }
    }
    try {
      reference = deps.sessions.retain(sessionId, { source: 'dshNextGit', signal: controller.signal })
      void reference.ready.then(binding => {
        if (disposed) return
        const source = binding.eventSource
        let revision = source.getSnapshot().revision
        unsubscribe = source.subscribe(() => {
          if (disposed) return
          const window: SessionEventWindow = source.getSnapshot()
          if (window.revision === revision) return
          revision = window.revision
          if (window.change.kind === 'replace') onRefresh('reconnect')
          else if (window.change.kind === 'append' && window.change.entries.some(
            entry => entry.type === 'event' && entry.event.type === 'turn/end',
          )) onRefresh('turn-end')
        })
      }).catch(error => {
        if (disposed) return
        dispose()
        onError?.(new SessionBridgeError('subscription-failed', sessionId, error))
      })
    } catch (error) {
      dispose()
      onError?.(new SessionBridgeError('subscription-failed', sessionId, error))
    }
    return dispose
  }

  return { getSource, createDelivery, subscribeTurnEnd }
}

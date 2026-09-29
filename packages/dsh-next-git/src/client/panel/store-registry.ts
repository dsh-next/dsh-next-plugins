import * as React from 'react'
import { PanelStore } from '../controller.ts'

/** Stores are shared between the body and the live chip title. */
const stores = new Map<string, { store: PanelStore; refs: number }>()

/**
 * Registry revision, and who listens to it.
 *
 * The chip title is a separate seat from the body, and the strip usually
 * renders before the body does, so the chip's first render has no store to
 * read and would keep the type label until something else re-rendered it. The
 * body announces the store joining (and leaving) the registry, and the chip
 * re-reads it.
 */
let registryVersion = 0
const registryListeners = new Set<() => void>()

/** The registry's current revision. */
export function storesVersion(): number {
  return registryVersion
}

/** Subscribe to stores joining and leaving the registry. */
export function subscribeStores(listener: () => void): () => void {
  registryListeners.add(listener)
  return () => {
    registryListeners.delete(listener)
  }
}

/** Publish one registry membership change. */
export function announceStores(): void {
  registryVersion += 1
  for (const listener of registryListeners) listener()
}

/** The API factory the panel uses; overridden in tests through `setPanelApi`. */
let apiFactory: () => GitApiLike = () => createApiRef()

/** Injectable API factory (tests). */
export function setPanelApi(factory: () => GitApiLike): void {
  apiFactory = factory
}

/** Structural API face the panel needs. */
export type GitApiLike = {
  call<T>(method: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<T>
}

// Read lazily so client registration can configure the default before first use.
let createApiRef: () => GitApiLike = () => {
  throw new Error('git api not configured')
}

/** Wire the default API factory (called once by the client entry). */
export function configurePanelApi(factory: () => GitApiLike): void {
  createApiRef = factory
}

/** Acquire a shared store only after React commits the seat. */
export function usePanelStore(sessionId: string): PanelStore | null {
  const [committed, setCommitted] = React.useState<{ sessionId: string; store: PanelStore } | null>(null)
  React.useLayoutEffect(() => {
    const existing = stores.get(sessionId)
    const store = existing?.store ?? new PanelStore(apiFactory(), sessionId)
    if (existing === undefined) stores.set(sessionId, { store, refs: 1 })
    else existing.refs += 1
    setCommitted({ sessionId, store })
    announceStores()
    return () => {
      releaseStore(sessionId)
      announceStores()
    }
  }, [sessionId])
  // A changed session never briefly reads the previous session's snapshot.
  return committed?.sessionId === sessionId ? committed.store : null
}

/** Release one reference; the last release disposes the store. */
export function releaseStore(sessionId: string): void {
  const entry = stores.get(sessionId)
  if (entry === undefined) return
  entry.refs -= 1
  if (entry.refs > 0) return
  stores.delete(sessionId)
  entry.store.dispose()
}

/** The store for a session, when the body has created it (the chip title path). */
export function peekStore(sessionId: string | undefined): PanelStore | undefined {
  return sessionId === undefined ? undefined : stores.get(sessionId)?.store
}

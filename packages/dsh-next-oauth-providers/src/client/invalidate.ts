/**
 * One in-process invalidation channel for the Models seats. The native page
 * refreshes on `settings/document-updated`; our own cards must do the same or
 * they keep a snapshot taken before a config write landed.
 */
type Listener = () => void

const listeners = new Set<Listener>()

/** Subscribe one seat to settings invalidations. */
export function onInvalidate(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Publish one settings invalidation to every mounted seat. */
export function notifyInvalidate(): void {
  for (const listener of [...listeners]) listener()
}

/**
 * Minimal structural timer surface shared by the host and client halves
 * (matches the Cordis `timer` service's `timeout`/`interval` helpers). Lives
 * in core so both halves may import it without a cross-zone value import.
 */
export interface TimerLike {
  timeout(callback: () => void, delay: number): () => void
  interval(callback: () => void, delay: number): () => void
}

/**
 * Client-side open-then-archive. Reverse that order and the stock
 * `clearArchivedCurrent` wipes the selection to the no-session hero.
 *
 * Idempotent: if `next` is already current, skip open; if `from` is
 * already archived, skip archive.
 */
export interface SwitchPorts {
  /**
   * Show the next session. `false` means the host cannot navigate right now,
   * and the switch stops before archiving so the user keeps the session they
   * are in.
   */
  open(sessionId: string): boolean
  archive(sessionId: string): Promise<void>
}

export type SwitchResult = 'switched' | 'noop'

export async function openThenArchive(input: {
  readonly fromId: string
  readonly nextId: string
  readonly currentId: string | undefined
  readonly archivedIds: readonly string[]
  readonly ports: SwitchPorts
}): Promise<SwitchResult> {
  const { fromId, nextId, currentId, archivedIds, ports } = input
  if (nextId === '' || fromId === nextId) return 'noop'
  let did = false
  if (currentId !== nextId) {
    if (!ports.open(nextId)) return 'noop'
    did = true
  }
  if (!archivedIds.includes(fromId)) {
    await ports.archive(fromId)
    did = true
  }
  return did ? 'switched' : 'noop'
}

/**
 * Client-side open-then-archive. Reverse that order and the stock
 * `clearArchivedCurrent` wipes the selection to the no-session hero.
 *
 * Idempotent: if `next` is already current, skip open; if `from` is
 * already archived, skip archive.
 */
export interface SwitchPorts {
  open(sessionId: string): void
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
    ports.open(nextId)
    did = true
  }
  if (!archivedIds.includes(fromId)) {
    await ports.archive(fromId)
    did = true
  }
  return did ? 'switched' : 'noop'
}

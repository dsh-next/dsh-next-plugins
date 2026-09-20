import { createHash } from 'node:crypto'

/** Compact, collision-resistant identity for the exact context shown in a chooser. */
export function contextFingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

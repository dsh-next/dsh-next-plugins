/**
 * Per-session JSON fold. Blobs live beside it. Resume reloads this file.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { SessionState } from '../core/types.ts'
import { emptyState } from '../core/store.ts'

export function statePath(dataDir: string, sessionId: string): string {
  return join(dataDir, sessionId, 'state.json')
}

export async function loadState(dataDir: string, sessionId: string, cwd: string): Promise<SessionState> {
  try {
    const raw = await readFile(statePath(dataDir, sessionId), 'utf8')
    const parsed = JSON.parse(raw) as SessionState
    if (parsed === null || typeof parsed !== 'object' || parsed.sessionId !== sessionId) {
      return emptyState(sessionId, cwd)
    }
    return {
      ...emptyState(sessionId, cwd),
      ...parsed,
      cwd: typeof parsed.cwd === 'string' && parsed.cwd !== '' ? parsed.cwd : cwd,
      checkpoints: Array.isArray(parsed.checkpoints) ? parsed.checkpoints : [],
      intentKeys: Array.isArray(parsed.intentKeys) ? parsed.intentKeys : [],
      baseline: parsed.baseline && typeof parsed.baseline === 'object' ? parsed.baseline : {},
      seqCursor: typeof parsed.seqCursor === 'number'
        ? parsed.seqCursor
        : Math.max(0, ...(Array.isArray(parsed.checkpoints) ? parsed.checkpoints.map((item) => item.seq) : [0])),
    }
  } catch {
    return emptyState(sessionId, cwd)
  }
}

export async function saveState(dataDir: string, state: SessionState): Promise<void> {
  const path = statePath(dataDir, state.sessionId)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(state)}\n`, 'utf8')
}

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { emptyState } from '../src/core/store.ts'
import { loadState, saveState, statePath } from '../src/host/persist.ts'

describe('persist', () => {
  async function dir(): Promise<string> {
    return mkdtemp(join(tmpdir(), 'dsh-next-checkpoints-persist-'))
  }

  it('round-trips a session fold', async () => {
    const dataDir = await dir()
    try {
      const state = {
        ...emptyState('s1', '/repo'),
        intentKeys: ['/repo/a.ts'],
        rewoundTo: 's1:1:1',
      }
      await saveState(dataDir, state)
      const loaded = await loadState(dataDir, 's1', '/other')
      expect(loaded.sessionId).toBe('s1')
      expect(loaded.cwd).toBe('/repo')
      expect(loaded.intentKeys).toEqual(['/repo/a.ts'])
      expect(loaded.rewoundTo).toBe('s1:1:1')
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('returns empty state for missing, corrupt, or mismatched files', async () => {
    const dataDir = await dir()
    try {
      expect(await loadState(dataDir, 'missing', '/repo')).toEqual(emptyState('missing', '/repo'))
      await saveState(dataDir, emptyState('s1', '/repo'))
      await writeFile(statePath(dataDir, 's1'), '{', 'utf8')
      expect(await loadState(dataDir, 's1', '/repo')).toEqual(emptyState('s1', '/repo'))
      await writeFile(statePath(dataDir, 's1'), JSON.stringify({ sessionId: 'other' }), 'utf8')
      expect(await loadState(dataDir, 's1', '/repo')).toEqual(emptyState('s1', '/repo'))
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })
})

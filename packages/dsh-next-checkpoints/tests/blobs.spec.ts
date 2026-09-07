import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { blobHash, DiskBlobStore, MemoryBlobStore } from '../src/host/blobs.ts'

describe('MemoryBlobStore', () => {
  it('returns the same hash for identical bytes and null for unknown hashes', async () => {
    const store = new MemoryBlobStore()
    const bytes = new TextEncoder().encode('hello\n')
    const hash = await store.put(bytes)
    expect(hash).toBe(blobHash(bytes))
    expect(await store.put(bytes)).toBe(hash)
    expect(new TextDecoder().decode((await store.get(hash))!)).toBe('hello\n')
    expect(await store.get('0'.repeat(64))).toBeNull()
  })
})

describe('DiskBlobStore', () => {
  it('persists bytes and rejects non-sha256 keys', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-next-checkpoints-blobs-'))
    try {
      const store = new DiskBlobStore(dir)
      const bytes = new TextEncoder().encode('on disk\n')
      const hash = await store.put(bytes)
      expect(await store.put(bytes)).toBe(hash)
      expect(new TextDecoder().decode((await store.get(hash))!)).toBe('on disk\n')
      expect(await store.get('../escape')).toBeNull()
      expect(await store.get('xyz')).toBeNull()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

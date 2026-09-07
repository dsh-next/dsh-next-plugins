/**
 * Content-addressed blob store. Bytes live under the plugin data dir,
 * keyed by SHA-256. Checkpoints are not git.
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface BlobStore {
  put(bytes: Uint8Array): Promise<string>
  get(hash: string): Promise<Uint8Array | null>
}

/** Hex SHA-256 of the bytes. */
export function blobHash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Disk blob store: `<root>/<hash>`. */
export class DiskBlobStore implements BlobStore {
  constructor(private readonly root: string) {}

  async put(bytes: Uint8Array): Promise<string> {
    const hash = blobHash(bytes)
    await mkdir(this.root, { recursive: true })
    const path = join(this.root, hash)
    try {
      await writeFile(path, bytes, { flag: 'wx' })
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EEXIST') throw error
    }
    return hash
  }

  async get(hash: string): Promise<Uint8Array | null> {
    if (!/^[0-9a-f]{64}$/.test(hash)) return null
    try {
      const buf = await readFile(join(this.root, hash))
      return new Uint8Array(buf)
    } catch {
      return null
    }
  }
}

/** In-memory store for tests. */
export class MemoryBlobStore implements BlobStore {
  private readonly data = new Map<string, Uint8Array>()

  async put(bytes: Uint8Array): Promise<string> {
    const hash = blobHash(bytes)
    if (!this.data.has(hash)) this.data.set(hash, bytes)
    return hash
  }

  async get(hash: string): Promise<Uint8Array | null> {
    return this.data.get(hash) ?? null
  }
}

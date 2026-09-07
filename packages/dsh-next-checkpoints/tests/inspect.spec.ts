import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DIFF_MAX_BYTES } from '../src/core/types.ts'
import { inspectPath } from '../src/host/inspect.ts'

describe('inspectPath', () => {
  async function dir(): Promise<string> {
    return mkdtemp(join(tmpdir(), 'dsh-next-checkpoints-inspect-'))
  }

  it('classifies missing, text, binary, directory, and symlink', async () => {
    const root = await dir()
    try {
      expect(await inspectPath(join(root, 'nope'))).toEqual({ kind: 'missing', bytes: null, mtimeMs: null })
      const text = join(root, 'a.ts')
      await writeFile(text, 'hello\n')
      const textHit = await inspectPath(text)
      expect(textHit.kind).toBe('text')
      expect(textHit.mtimeMs).toEqual(expect.any(Number))
      expect(new TextDecoder().decode(textHit.bytes!)).toBe('hello\n')

      const bin = join(root, 'a.bin')
      await writeFile(bin, Buffer.from([65, 0, 66]))
      expect((await inspectPath(bin)).kind).toBe('binary')

      const late = join(root, 'late.bin')
      const bytes = Buffer.alloc(8 * 1024 + 2, 65)
      bytes[8 * 1024] = 0
      await writeFile(late, bytes)
      expect((await inspectPath(late)).kind).toBe('binary')

      const nested = join(root, 'sub')
      await mkdir(nested)
      const nestedHit = await inspectPath(nested)
      expect(nestedHit.kind).toBe('directory')
      expect(nestedHit.bytes).toBeNull()
      expect(nestedHit.mtimeMs).toEqual(expect.any(Number))

      const link = join(root, 'link')
      await symlink(text, link)
      const linkHit = await inspectPath(link)
      expect(linkHit.kind).toBe('symlink')
      expect(linkHit.bytes).toBeNull()
      expect(linkHit.mtimeMs).toEqual(expect.any(Number))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects invalid UTF-8 and skips bodies over the byte cap', async () => {
    const root = await dir()
    try {
      const bad = join(root, 'bad.txt')
      await writeFile(bad, Buffer.from([0xff, 0xfe, 0x41]))
      expect((await inspectPath(bad)).kind).toBe('invalid-utf8')

      const huge = join(root, 'huge.txt')
      await writeFile(huge, Buffer.alloc(DIFF_MAX_BYTES + 1, 65))
      const hugeHit = await inspectPath(huge)
      expect(hugeHit.kind).toBe('too-large')
      expect(hugeHit.bytes).toBeNull()
      expect(hugeHit.mtimeMs).toEqual(expect.any(Number))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

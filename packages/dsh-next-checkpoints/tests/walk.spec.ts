import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { listFilesUnder } from '../src/host/walk.ts'

describe('listFilesUnder', () => {
  it('lists nested files and skips VCS and node_modules', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-next-checkpoints-walk-'))
    try {
      await mkdir(join(dir, 'random-files'), { recursive: true })
      await writeFile(join(dir, 'random-files', 'notes-kettle.txt'), 'a\n')
      await mkdir(join(dir, 'node_modules', 'pkg'), { recursive: true })
      await writeFile(join(dir, 'node_modules', 'pkg', 'index.js'), 'nope\n')
      await mkdir(join(dir, '.git'), { recursive: true })
      await writeFile(join(dir, '.git', 'HEAD'), 'ref\n')
      const listed = await listFilesUnder(dir)
      expect(listed.some((path) => path.endsWith('notes-kettle.txt'))).toBe(true)
      expect(listed.some((path) => path.includes('node_modules'))).toBe(false)
      expect(listed.some((path) => path.includes('.git'))).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('returns empty when cwd cannot be read', async () => {
    expect(await listFilesUnder('/no/such/dsh-next-checkpoints-walk')).toEqual([])
  })
})

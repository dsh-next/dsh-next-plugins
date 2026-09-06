import { describe, expect, it, vi } from 'vitest'
import { openThenArchive } from '../src/core/switch.ts'

function ports() {
  return {
    open: vi.fn(),
    archive: vi.fn().mockResolvedValue(undefined),
  }
}

describe('openThenArchive', () => {
  it('opens next then archives from', async () => {
    const p = ports()
    await expect(openThenArchive({
      fromId: 'old',
      nextId: 'next',
      currentId: 'old',
      archivedIds: [],
      ports: p,
    })).resolves.toBe('switched')
    expect(p.open.mock.calls).toEqual([['next']])
    expect(p.archive.mock.calls).toEqual([['old']])
    expect(p.open.mock.invocationCallOrder[0]!).toBeLessThan(p.archive.mock.invocationCallOrder[0]!)
  })

  it('skips open when next is already current', async () => {
    const p = ports()
    await openThenArchive({
      fromId: 'old',
      nextId: 'next',
      currentId: 'next',
      archivedIds: [],
      ports: p,
    })
    expect(p.open).not.toHaveBeenCalled()
    expect(p.archive).toHaveBeenCalledWith('old')
  })

  it('skips archive when from is already archived', async () => {
    const p = ports()
    await openThenArchive({
      fromId: 'old',
      nextId: 'next',
      currentId: 'old',
      archivedIds: ['old'],
      ports: p,
    })
    expect(p.open).toHaveBeenCalledWith('next')
    expect(p.archive).not.toHaveBeenCalled()
  })

  it('is a no-op when already switched', async () => {
    const p = ports()
    await expect(openThenArchive({
      fromId: 'old',
      nextId: 'next',
      currentId: 'next',
      archivedIds: ['old'],
      ports: p,
    })).resolves.toBe('noop')
    expect(p.open).not.toHaveBeenCalled()
    expect(p.archive).not.toHaveBeenCalled()
  })

  it('refuses a missing next id', async () => {
    const p = ports()
    await expect(openThenArchive({
      fromId: 'old',
      nextId: '',
      currentId: 'old',
      archivedIds: [],
      ports: p,
    })).resolves.toBe('noop')
    expect(p.open).not.toHaveBeenCalled()
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as store from '../src/client/create-store.ts'

const target = { slug: 'first', title: 'first', branch: 'branch', path: '/first', dirty: false, ahead: 2, merged: false }
const host = { archiveSession: async () => {}, removeWorkspace: async () => {} }
const operations = [
  ['merge', 'openMerge'], ['merge', 'executeMerge'], ['merge', 'cleanupMerged'],
  ['update', 'openUpdate'], ['update', 'executeUpdate'], ['update', 'abortUpdate'],
  ['delete', 'executeDelete'],
] as const

beforeEach(() => { store.resetModalStore() })

async function flush(): Promise<void> {
  for (let i = 0; i < 12; i++) await Promise.resolve()
}

describe.each(operations)('%s modal: %s failure', (kind, operation) => {
  it.each(['error', 'string', 'other-kind', 'same-kind', 'coercion-reset'] as const)(
    'preserves catch state handling for %s', async (mode) => {
      const open = (next: typeof target): void => {
        if (kind === 'delete') store.openDelete(next)
        else store[kind === 'merge' ? 'openMerge' : 'openUpdate'](next, async () => ({}))
      }
      open(target)
      await flush()
      let reject!: (error: unknown) => void
      const rpc = vi.fn(() => new Promise((_, fail) => { reject = fail }))
      let completion: void | Promise<void>
      if (operation === 'openMerge' || operation === 'openUpdate') completion = store[operation](target, rpc)
      else if (operation === 'cleanupMerged' || operation === 'executeDelete') completion = store[operation](rpc, host)
      else completion = store[operation](rpc)
      const replacement = { ...target, slug: 'second', path: '/second' }
      if (mode === 'other-kind') store.openCreate('/other', 'other', () => new Promise(() => {}))
      if (mode === 'same-kind') { open(replacement); await flush() }
      const before = store.modalState()
      const listener = vi.fn()
      const unsubscribe = store.subscribeModal(listener)
      const toString = vi.fn(() => {
        if (mode === 'coercion-reset') store.resetModalStore()
        return 'failure'
      })
      try {
        reject(mode === 'error' ? new Error('failure') : mode === 'string' ? 'failure' : { toString })
        await flush()
        if (completion !== undefined) await expect(completion).resolves.toBeUndefined()
        expect(rpc).toHaveBeenCalledTimes(1)
        if (mode === 'other-kind') {
          expect(store.modalState()).toBe(before)
          expect(toString).not.toHaveBeenCalled()
          expect(listener).not.toHaveBeenCalled()
        } else {
          expect(store.modalState().kind).toBe(kind)
          expect(store.modalState()[kind]).toMatchObject({ busy: false, error: 'failure' })
          expect(store.modalState()[kind]?.target).toBe(mode === 'same-kind' ? replacement : target)
          expect(listener).toHaveBeenCalledTimes(mode === 'coercion-reset' ? 2 : 1)
          if (mode === 'same-kind' || mode === 'coercion-reset') expect(toString).toHaveBeenCalledTimes(1)
        }
      } finally {
        unsubscribe()
      }
    },
  )
})

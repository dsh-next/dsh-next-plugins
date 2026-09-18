import { describe, expect, it, vi } from 'vitest'
import {
  bindDomTriggers,
  mergeReasons,
  RefreshScheduler,
  visibleTriggered,
  type RefreshReason,
} from '../src/client/refresh.ts'

/** A scheduler whose load resolves on demand. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('refresh scheduler', () => {
  it('runs one read per request when nothing overlaps', async () => {
    const loads: RefreshReason[] = []
    const scheduler = new RefreshScheduler({
      load: async (reason) => {
        loads.push(reason)
        return { changed: false }
      },
      onError: () => {},
    })
    await scheduler.request('open', true)
    await scheduler.request('manual', true)
    expect(loads).toEqual(['open', 'manual'])
    expect(scheduler.busy).toBe(false)
  })

  it('coalesces triggers that arrive during a read into one follow-up', async () => {
    const loads: RefreshReason[] = []
    const gate = deferred()
    const scheduler = new RefreshScheduler({
      load: async (reason) => {
        loads.push(reason)
        if (loads.length === 1) await gate.promise
        return { changed: false }
      },
      onError: () => {},
    })
    const running = scheduler.request('open')
    // Three triggers while the first read is in flight.
    void scheduler.request('focus')
    void scheduler.request('visible')
    scheduler.trigger('agent-turn')
    expect(scheduler.busy).toBe(true)
    gate.resolve()
    await running
    // `visible` outranks `agent-turn`, so it is the reason the follow-up run
    // reports (the spinner copy only needs the deliberate one).
    expect(loads).toEqual(['open', 'visible'])
  })

  it('keeps the more deliberate reason when several collapse', () => {
    expect(mergeReasons(null, 'focus')).toBe('focus')
    expect(mergeReasons('focus', 'manual')).toBe('manual')
    expect(mergeReasons('manual', 'focus')).toBe('manual')
    expect(mergeReasons('agent-turn', 'write')).toBe('write')
    expect(mergeReasons('write', 'agent-turn')).toBe('write')
    expect(mergeReasons('visible', 'focus')).toBe('focus')
    expect(mergeReasons('agent-turn', 'visible')).toBe('visible')
  })

  it('resolves a waiting request only after its read settled', async () => {
    const gate = deferred()
    const order: string[] = []
    const scheduler = new RefreshScheduler({
      load: async () => {
        order.push('load:start')
        await gate.promise
        order.push('load:end')
        return { changed: false }
      },
      onError: () => {},
    })
    const waiting = scheduler.request('open', true)
    // The read is already in flight; the promise resolves only after it ends.
    expect(order).toEqual(['load:start'])
    gate.resolve()
    await waiting
    expect(order).toEqual(['load:start', 'load:end'])
  })

  it('reports a read failure without throwing to the caller', async () => {
    const errors: unknown[] = []
    const scheduler = new RefreshScheduler({
      load: async () => {
        throw new Error('boom')
      },
      onError: (error) => errors.push(error),
    })
    await expect(scheduler.request('open', true)).resolves.toBeUndefined()
    expect(errors).toHaveLength(1)
  })

  it('ignores work after dispose and releases waiters', async () => {
    const loads: RefreshReason[] = []
    const scheduler = new RefreshScheduler({
      load: async (reason) => {
        loads.push(reason)
        return { changed: false }
      },
      onError: () => {},
    })
    scheduler.dispose()
    await scheduler.request('open', true)
    scheduler.trigger('focus')
    await Promise.resolve()
    expect(loads).toEqual([])
  })

  it('stops the loop once disposed mid-read', async () => {
    const gate = deferred()
    const loads: RefreshReason[] = []
    const scheduler = new RefreshScheduler({
      load: async (reason) => {
        loads.push(reason)
        await gate.promise
        return { changed: false }
      },
      onError: () => {},
    })
    const running = scheduler.request('open')
    void scheduler.request('focus')
    scheduler.dispose()
    gate.resolve()
    await running
    expect(loads).toEqual(['open'])
  })

  it('decides visibility from the hidden flag', () => {
    expect(visibleTriggered(false)).toBe(true)
    expect(visibleTriggered(true)).toBe(false)
  })
})

describe('dom triggers', () => {
  it('binds focus and visibility, and unbinds them', () => {
    const listeners = new Map<string, () => void>()
    const target = {
      addEventListener: (type: string, listener: () => void) => {
        listeners.set(type, listener)
      },
      removeEventListener: (type: string) => {
        listeners.delete(type)
      },
    }
    const reasons = vi.fn()
    const off = bindDomTriggers(target, reasons, () => false)
    listeners.get('focus')?.()
    listeners.get('visibilitychange')?.()
    expect(reasons.mock.calls.map((call) => call[0])).toEqual(['focus', 'visible'])
    off()
    expect(listeners.size).toBe(0)
  })

  it('does not refresh when the document is hidden', () => {
    const listeners = new Map<string, () => void>()
    const target = {
      addEventListener: (type: string, listener: () => void) => {
        listeners.set(type, listener)
      },
      removeEventListener: () => {},
    }
    const reasons = vi.fn()
    bindDomTriggers(target, reasons, () => true)
    listeners.get('visibilitychange')?.()
    expect(reasons).not.toHaveBeenCalled()
  })
})

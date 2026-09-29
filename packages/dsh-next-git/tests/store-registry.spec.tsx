import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import {
  announceStores,
  peekStore,
  releaseStore,
  setPanelApi,
  storesVersion,
  subscribeStores,
  usePanelStore,
} from '../src/client/panel/store-registry.ts'
import { PanelStore } from '../src/client/controller.ts'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('panel store registry', () => {
  it('notifies title subscribers only while registered', () => {
    const listener = vi.fn()
    const initial = storesVersion()
    const unsubscribe = subscribeStores(listener)
    announceStores()
    expect(storesVersion()).toBe(initial + 1)
    expect(listener).toHaveBeenCalledOnce()
    unsubscribe()
    announceStores()
    expect(storesVersion()).toBe(initial + 2)
    expect(listener).toHaveBeenCalledOnce()
  })

  it('shares one committed store per session and disposes it at the last unmount', () => {
    const factory = vi.fn(() => ({ call: vi.fn() }))
    setPanelApi(factory)
    const root = createRoot(document.createElement('div'))
    const received: PanelStore[] = []
    function Probe(): null {
      const store = usePanelStore('registry-shared-session')
      if (store !== null) received.push(store)
      return null
    }
    try {
      expect(peekStore(undefined)).toBeUndefined()
      expect(peekStore('missing')).toBeUndefined()
      releaseStore('missing')
      act(() => root.render(<><Probe /><Probe /></>))
      expect(factory).toHaveBeenCalledOnce()
      expect(received).toHaveLength(2)
      expect(received[0]).toBe(received[1])
      expect(peekStore('registry-shared-session')).toBe(received[0])
      const dispose = vi.spyOn(received[0]!, 'dispose')
      act(() => root.render(<Probe />))
      expect(dispose).not.toHaveBeenCalled()
      expect(peekStore('registry-shared-session')).toBe(received[0])
      act(() => root.unmount())
      expect(dispose).toHaveBeenCalledOnce()
      expect(peekStore('registry-shared-session')).toBeUndefined()
      releaseStore('registry-shared-session')
      expect(dispose).toHaveBeenCalledOnce()
    } finally {
      if (peekStore('registry-shared-session') !== undefined) act(() => root.unmount())
    }
  })

  it('does not acquire from a render React abandons', () => {
    const factory = vi.fn(() => ({ call: vi.fn() }))
    setPanelApi(factory)
    const root = createRoot(document.createElement('div'))
    const never = new Promise<void>(() => {})
    function Suspended(): null {
      usePanelStore('registry-suspended-session')
      throw never
    }
    try {
      act(() => root.render(<React.Suspense fallback={null}><Suspended /></React.Suspense>))
      expect(factory).not.toHaveBeenCalled()
      expect(peekStore('registry-suspended-session')).toBeUndefined()
    } finally {
      act(() => root.unmount())
    }
  })

  it('balances Strict Mode effect replay without leaving an old store registered', () => {
    const factory = vi.fn(() => ({ call: vi.fn() }))
    const dispose = vi.spyOn(PanelStore.prototype, 'dispose')
    setPanelApi(factory)
    const root = createRoot(document.createElement('div'))
    function Probe(): null {
      usePanelStore('registry-strict-session')
      return null
    }
    try {
      act(() => root.render(<React.StrictMode><Probe /></React.StrictMode>))
      expect(factory).toHaveBeenCalledTimes(2)
      expect(dispose).toHaveBeenCalledTimes(1)
      expect(peekStore('registry-strict-session')?.isDisposed).toBe(false)
      act(() => root.unmount())
      expect(dispose).toHaveBeenCalledTimes(2)
      expect(peekStore('registry-strict-session')).toBeUndefined()
    } finally {
      vi.restoreAllMocks()
    }
  })
})

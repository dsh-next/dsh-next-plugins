import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { PresenceView } from '../src/client/PresenceView.tsx'
import { createPresenceReporter, type PresenceReporter } from '../src/client/presence.ts'

type Props = React.ComponentProps<typeof PresenceView>
const roots = new Map<Root, HTMLElement>()
const reporters: PresenceReporter[] = []

function panelStore(initial: string | null) {
  let activePanelId = initial
  const listeners = new Set<() => void>()
  const subscribe = vi.fn((listener: () => void) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  })
  const usePanelInfo: Props['usePanelInfo'] = selector => {
    const id = React.useSyncExternalStore(subscribe, () => activePanelId)
    return selector({ activePanelId: id } as Parameters<typeof selector>[0])
  }
  return {
    usePanelInfo, subscribe, listeners,
    set(id: string | null) { activePanelId = id; for (const listener of listeners) listener() },
  }
}
function mount(element: React.ReactElement) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.set(root, container)
  act(() => root.render(element))
  return { root, container }
}

beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true) })
afterEach(() => {
  for (const [root, container] of roots) { act(() => root.unmount()); container.remove() }
  roots.clear()
  for (const reporter of reporters.splice(0)) reporter.dispose()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('PresenceView committed panel presence', () => {
  it('renders children without publishing during render and publishes in the layout phase', () => {
    const store = panelStore('settings')
    const onChange = vi.fn()
    const childRender = vi.fn()
    const passiveEffect = vi.fn()
    function Child() {
      childRender()
      expect(onChange).not.toHaveBeenCalled()
      React.useEffect(() => {
        passiveEffect()
        expect(onChange).toHaveBeenCalledExactlyOnceWith(true)
      }, [])
      return <span>Notifications</span>
    }
    const { container } = mount(<PresenceView usePanelInfo={store.usePanelInfo} onChange={onChange}><Child /></PresenceView>)
    expect(childRender).toHaveBeenCalledOnce()
    expect(passiveEffect).toHaveBeenCalledOnce()
    expect(container.textContent).toBe('Notifications')
    expect(onChange).toHaveBeenCalledExactlyOnceWith(true)
  })

  it('tracks current panel state and callback identity without repeating unchanged activity', () => {
    const store = panelStore(null)
    const onChange = vi.fn()
    const { root } = mount(<PresenceView usePanelInfo={store.usePanelInfo} onChange={onChange}>Overlay</PresenceView>)
    expect(onChange.mock.calls).toEqual([[false]])
    act(() => store.set('settings'))
    act(() => store.set('plugins'))
    expect(onChange.mock.calls).toEqual([[false], [true]])
    const replacement = vi.fn()
    act(() => root.render(<PresenceView usePanelInfo={store.usePanelInfo} onChange={replacement}>Overlay</PresenceView>))
    expect(replacement.mock.calls).toEqual([[true]])
    act(() => store.set(null))
    expect(replacement.mock.calls).toEqual([[true], [false]])
    act(() => root.render(<></>))
    expect(store.listeners.size).toBe(0)
    act(() => store.set('settings'))
    expect(replacement.mock.calls).toEqual([[true], [false]])
  })

  it('tolerates StrictMode replay without duplicate presence reports or leaked subscriptions', () => {
    const store = panelStore('settings')
    const send = vi.fn().mockResolvedValue({})
    const reporter = createPresenceReporter(undefined, undefined, send)
    reporters.push(reporter)
    send.mockClear()
    const { root } = mount(<React.StrictMode><PresenceView usePanelInfo={store.usePanelInfo} onChange={reporter.setPanelActive}>Overlay</PresenceView></React.StrictMode>)
    expect(send).toHaveBeenCalledOnce()
    expect(send.mock.calls[0]).toEqual(['reportPresence', expect.objectContaining({ open: true, sessionId: null })])
    expect(store.subscribe).toHaveBeenCalledTimes(2)
    expect(store.listeners.size).toBe(1)
    act(() => store.set(null))
    expect(send).toHaveBeenCalledTimes(2)
    act(() => root.render(<></>))
    expect(store.listeners.size).toBe(0)
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('does not publish or subscribe for an abandoned suspended render', () => {
    const store = panelStore('settings')
    const onChange = vi.fn()
    const attempted = vi.fn()
    const pending = new Promise<void>(() => {})
    function Suspended(): React.ReactElement {
      attempted()
      throw pending
    }
    const { root, container } = mount(<React.Suspense fallback={<span>Waiting</span>}>
      <PresenceView usePanelInfo={store.usePanelInfo} onChange={onChange}><Suspended /></PresenceView>
    </React.Suspense>)
    expect(attempted).toHaveBeenCalled()
    expect(container.textContent).toBe('Waiting')
    expect(onChange).not.toHaveBeenCalled()
    expect(store.subscribe).not.toHaveBeenCalled()
    act(() => root.render(<span>Replacement</span>))
    act(() => store.set(null))
    expect(container.textContent).toBe('Replacement')
    expect(onChange).not.toHaveBeenCalled()
    expect(store.listeners.size).toBe(0)
  })
})

/**
 * jsdom render test for the notifier settings card's disclosure header: the
 * title and tagline render through the locale dictionary, the chevron is the
 * shell's disclosure icon primitive (an SVG, not a text glyph), and the
 * header toggles aria-expanded as the accordion opens. The full card body is
 * driven by the real-mount e2e marker.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NotifierCard } from '../src/client/card.tsx'
import { defaultConfig } from '../src/core/config.ts'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('NotifierCard header', () => {
  const container = document.createElement('div')
  let root: Root | undefined

  afterEach(() => {
    act(() => { root?.unmount() })
    container.remove()
  })

  function renderCard(rpc?: (method: string, args?: unknown) => Promise<unknown>, enqueueTestToast?: () => void): void {
    document.body.appendChild(container)
    root = createRoot(container)
    root.render(React.createElement(NotifierCard, {
      rpc: rpc ?? vi.fn(async () => ({})),
      showWebNotification: vi.fn(),
      enqueueTestToast: enqueueTestToast as never,
    }))
  }

  it('renders the localized title and tagline with the shell chevron icon', () => {
    act(renderCard)
    const header = container.querySelector('button[aria-expanded]')
    expect(header, 'the disclosure header should render').not.toBeNull()
    expect(header!.textContent).toContain('Notifier')
    expect(header!.textContent).toContain('Alerts when the agent finishes or needs you')
    // The chevron is the primitives SVG icon, not a text glyph.
    expect(header!.querySelector('svg')).not.toBeNull()
    expect(header!.getAttribute('aria-expanded')).toBe('false')
  })

  it('toggles aria-expanded when the header is clicked', () => {
    act(renderCard)
    const header = container.querySelector('button[aria-expanded]') as HTMLButtonElement
    act(() => { header.click() })
    expect(header.getAttribute('aria-expanded')).toBe('true')
    act(() => { header.click() })
    expect(header.getAttribute('aria-expanded')).toBe('false')
  })

  it('enqueues a test toast from the Show button in the open body', async () => {
    const enqueue = vi.fn()
    const rpc = vi.fn(async () => ({ config: defaultConfig(), sounds: [], platform: null, webPermission: 'granted' }))
    act(() => { renderCard(rpc, enqueue) })
    await act(async () => { await Promise.resolve() })
    const header = container.querySelector('button[aria-expanded]') as HTMLButtonElement
    act(() => { header.click() })
    const show = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Show')
    expect(show, 'the Show test-toast button should render').not.toBeUndefined()
    act(() => { show!.click() })
    expect(enqueue).toHaveBeenCalledTimes(1)
    const payload = enqueue.mock.calls[0][0] as Record<string, unknown>
    expect(payload.title).toBe('Test toast')
    expect(payload.body).toBe('In-page toasts work — click me to open this session.')
  })
})

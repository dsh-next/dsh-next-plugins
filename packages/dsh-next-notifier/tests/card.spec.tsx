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

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('NotifierCard header', () => {
  const container = document.createElement('div')
  let root: Root | undefined

  afterEach(() => {
    act(() => { root?.unmount() })
    container.remove()
  })

  function renderCard(): void {
    document.body.appendChild(container)
    root = createRoot(container)
    root.render(React.createElement(NotifierCard, {
      rpc: vi.fn(async () => ({})),
      showWebNotification: vi.fn(),
    }))
  }

  it('renders the localized title and tagline with the shell chevron icon', () => {
    act(renderCard)
    const header = container.querySelector('button[aria-expanded]')
    expect(header, 'the disclosure header should render').not.toBeNull()
    expect(header!.textContent).toContain('DSH Next Notifier')
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
})

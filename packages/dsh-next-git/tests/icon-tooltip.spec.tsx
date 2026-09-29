import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { IconTooltip } from '../src/client/ui/IconTooltip.tsx'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

it('uses the merge tooltip placement on hover and keyboard focus without altering the action', async () => {
  const click = vi.fn()
  await act(async () => {
    root.render(<IconTooltip label="Merge into main"><button type="button" aria-label="Merge into main" onClick={click}>Action</button></IconTooltip>)
  })
  const button = container.querySelector('button')!
  expect(button.parentElement?.parentElement).toBe(container)
  expect(button.parentElement?.hasAttribute('tabindex')).toBe(false)
  await act(async () => button.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
  const bubble = document.querySelector<HTMLElement>('[role="tooltip"]')!
  expect(bubble.textContent).toBe('Merge into main')
  expect(bubble.parentElement).toBe(document.body)
  expect(bubble.dataset).toMatchObject({ side: 'top', align: 'end', portal: 'true' })
  await act(async () => button.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })))
  expect(document.querySelector('[role="tooltip"]')).toBeNull()
  await act(async () => button.focus())
  expect(document.querySelector('[role="tooltip"]')?.textContent).toBe('Merge into main')
  await act(async () => button.click())
  expect(click).toHaveBeenCalledOnce()
  expect(document.querySelector('[role="tooltip"]')).toBeNull()
})

it('exposes disabled icon tooltips to mouse and keyboard without activating an enclosing row', async () => {
  const rowClick = vi.fn()
  await act(async () => {
    root.render(<div onClick={rowClick}>
      <IconTooltip label="Delete worktree"><button type="button" disabled aria-label="Delete worktree">Delete</button></IconTooltip>
    </div>)
  })
  const button = container.querySelector('button')!
  const target = button.parentElement as HTMLSpanElement
  expect(button.disabled).toBe(true)
  expect(target.getAttribute('role')).toBe('note')
  expect(target.getAttribute('aria-label')).toBe('Delete worktree')
  expect(target.tabIndex).toBe(0)
  await act(async () => target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
  expect(document.querySelector('[role="tooltip"]')?.textContent).toBe('Delete worktree')
  await act(async () => target.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })))
  await act(async () => target.focus())
  expect(document.querySelector('[role="tooltip"]')?.textContent).toBe('Delete worktree')
  await act(async () => target.click())
  expect(rowClick).not.toHaveBeenCalled()
  await act(async () => root.render(<div onClick={rowClick}>
    <IconTooltip label="Delete worktree"><button type="button" aria-label="Delete worktree">Delete</button></IconTooltip>
  </div>))
  expect(container.querySelector('button')).toBe(button)
  expect(target.hasAttribute('tabindex')).toBe(false)
  expect(target.getAttribute('role')).toBeNull()
})

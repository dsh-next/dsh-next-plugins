import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { useRepositoryMenuPlacement } from '../src/client/repository/menu-placement.ts'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root, container: HTMLDivElement, row: HTMLButtonElement, submenu: HTMLDivElement
let frames: Map<number, FrameRequestCallback>, next: number
const rect = (x: number, y: number, width: number, height: number) => ({ x, y, left: x, top: y, right: x + width, bottom: y + height, width, height, toJSON() {} })
function Probe({ open }: { open: boolean }): null { useRepositoryMenuPlacement(open); return null }
async function render(open: boolean): Promise<void> { await act(async () => root.render(<Probe open={open} />)) }
async function flush(): Promise<void> { await act(async () => { for (const [id, callback] of [...frames]) { frames.delete(id); callback(0) } }) }
beforeEach(() => {
  frames = new Map(); next = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++next, callback); return next })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  vi.stubGlobal('innerWidth', 800); vi.stubGlobal('innerHeight', 600)
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  const wrap = document.createElement('div'); row = document.createElement('button'); row.setAttribute('role', 'menuitem')
  const label = document.createElement('span'); label.dataset.dshGit = 'repository-group'; row.append(label)
  submenu = document.createElement('div'); submenu.setAttribute('role', 'menu'); wrap.append(row, submenu); document.body.append(wrap)
  row.getBoundingClientRect = () => rect(600, 500, 180, 32)
  submenu.getBoundingClientRect = () => rect(12, 12, 220, 300)
})
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals() })
it('positions left and clamps long submenus inside the viewport', async () => {
  await render(true); await flush()
  expect(submenu.style.getPropertyValue('--git-submenu-x')).toBe('380px')
  expect(submenu.style.getPropertyValue('--git-submenu-y')).toBe('288px')
  expect(submenu.dataset.gitSide).toBe('left')
})
it('opens right when there is not enough left space and clamps top', async () => {
  row.getBoundingClientRect = () => rect(20, -10, 180, 32)
  await render(true); await flush()
  expect(submenu.dataset.gitSide).toBe('right')
  expect(submenu.style.getPropertyValue('--git-submenu-x')).toBe('200px')
  expect(submenu.style.getPropertyValue('--git-submenu-y')).toBe('12px')
})
it('repositions on scroll/resize and coalesces pending frames', async () => {
  await render(true); await flush()
  row.getBoundingClientRect = () => rect(500, 20, 180, 32)
  window.dispatchEvent(new Event('resize')); window.dispatchEvent(new Event('scroll'))
  expect(frames.size).toBe(1); await flush()
  expect(submenu.style.getPropertyValue('--git-submenu-x')).toBe('280px')
  expect(submenu.style.getPropertyValue('--git-submenu-y')).toBe('20px')
})
it('ignores absent rows/submenus and disconnects listeners when closed', async () => {
  submenu.remove()
  await render(true); await flush()
  await act(async () => { row.parentElement!.append(submenu) }); await flush()
  expect(submenu.style.getPropertyValue('--git-submenu-x')).toBe('380px')
  window.dispatchEvent(new Event('resize')); expect(frames.size).toBe(1)
  await render(false); expect(frames.size).toBe(0)
  window.dispatchEvent(new Event('resize')); expect(frames.size).toBe(0)
})
it('does nothing while closed', async () => {
  await render(false); expect(frames.size).toBe(0)
  expect(submenu.style.getPropertyValue('--git-submenu-x')).toBe('')
})

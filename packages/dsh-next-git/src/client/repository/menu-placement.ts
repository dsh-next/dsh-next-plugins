import * as React from 'react'

/** Keep the SDK's nested cards usable at sidebar edges and on short screens. */
export function useRepositoryMenuPlacement(open: boolean): void {
  React.useLayoutEffect(() => {
    if (!open) return
    let frame = 0
    const position = (): void => {
      frame = 0
      for (const label of document.querySelectorAll<HTMLElement>('[data-dsh-git="repository-group"]')) {
        const row = label.closest<HTMLElement>('[role="menuitem"]')
        const submenu = row?.parentElement?.querySelector<HTMLElement>('[role="menu"]')
        if (!row || !submenu) continue
        resizeObserver?.observe(submenu)
        // Set the viewport constraints before measuring; long localized labels
        // can otherwise make an intrinsic submenu grow after its x coordinate is
        // calculated, pushing the far edge outside the viewport.
        const margin = 12, gap = 0
        submenu.style.position = 'fixed'
        submenu.style.right = 'auto'
        submenu.style.bottom = 'auto'
        submenu.style.boxSizing = 'border-box'
        const viewportWidth = document.documentElement.clientWidth || window.innerWidth
        const viewportHeight = document.documentElement.clientHeight || window.innerHeight
        const availableWidth = Math.max(0, viewportWidth - margin * 2)
        submenu.style.maxWidth = `${availableWidth}px`
        submenu.style.maxHeight = `${Math.max(0, viewportHeight - margin * 2)}px`
        submenu.style.overflowY = 'auto'
        const anchor = row.getBoundingClientRect()
        let card = submenu.getBoundingClientRect()
        const computed = getComputedStyle(submenu)
        // SDK menus may be nested under a transformed panel, making `fixed`
        // coordinates relative to that containing block rather than the viewport.
        const offsetX = card.left - (Number.parseFloat(computed.left) || 0)
        const offsetY = card.top - (Number.parseFloat(computed.top) || 0)
        if (card.width > availableWidth) {
          submenu.style.width = `${availableWidth}px`
          card = submenu.getBoundingClientRect()
        }
        // Cards touch the row edge so scrolling overflow cannot clip a pointer bridge.
        const left = anchor.left - card.width - gap
        const side = left >= margin ? 'left' : 'right'
        const x = Math.max(margin, Math.min(side === 'left' ? left : anchor.right + gap, viewportWidth - card.width - margin))
        const y = Math.max(margin, Math.min(anchor.top, viewportHeight - card.height - margin))
        submenu.style.left = `${x - offsetX}px`
        submenu.style.top = `${y - offsetY}px`
        submenu.dataset.gitSide = side
      }
    }
    const schedule = (): void => { if (!frame) frame = requestAnimationFrame(position) }
    const observer = new MutationObserver(schedule)
    const resizeObserver = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule)
    observer.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, true)
    schedule()
    return () => {
      observer.disconnect()
      resizeObserver?.disconnect()
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, true)
    }
  }, [open])
}

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
        const anchor = row.getBoundingClientRect(), card = submenu.getBoundingClientRect()
        // Cards touch the row edge so scrolling overflow cannot clip a pointer bridge.
        const margin = 12, gap = 0
        const left = anchor.left - card.width - gap
        const side = left >= margin ? 'left' : 'right'
        const x = Math.max(margin, Math.min(side === 'left' ? left : anchor.right + gap, window.innerWidth - card.width - margin))
        const y = Math.max(margin, Math.min(anchor.top, window.innerHeight - card.height - margin))
        submenu.style.setProperty('--git-submenu-x', `${x}px`)
        submenu.style.setProperty('--git-submenu-y', `${y}px`)
        submenu.dataset.gitSide = side
      }
    }
    const schedule = (): void => { if (!frame) frame = requestAnimationFrame(position) }
    const observer = new MutationObserver(schedule)
    observer.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, true)
    schedule()
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, true)
    }
  }, [open])
}

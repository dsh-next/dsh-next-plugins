import * as React from 'react'

/** Add initial focus, keyboard containment and focus restoration to native modals. */
export function useDialogFocus(body: React.RefObject<HTMLElement>): void {
  React.useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = body.current?.closest<HTMLElement>('[role="dialog"]')
    if (!dialog) return
    const controls = (): HTMLElement[] => [...dialog.querySelectorAll<HTMLElement>(
      ':is(button, input, textarea, select, summary, a[href], [tabindex]):not(:disabled)',
    )].filter((element) => element.getAttribute('tabindex') !== '-1'
      && !element.closest('[hidden], [inert], [aria-hidden="true"]'))
    const previousTabIndex = dialog.getAttribute('tabindex')
    dialog.tabIndex = -1
    const first = controls()[0]
    ;(first ?? dialog).focus()
    const trap = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return
      const list = controls()
      if (list.length === 0) { event.preventDefault(); dialog.focus(); return }
      const index = list.indexOf(document.activeElement as HTMLElement)
      if (event.shiftKey && index <= 0) { event.preventDefault(); list.at(-1)?.focus() }
      else if (!event.shiftKey && (index < 0 || index === list.length - 1)) { event.preventDefault(); list[0]?.focus() }
    }
    const contain = (event: FocusEvent): void => {
      // A nested modal owns focus until it closes.
      const top = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].at(-1)
      if (top !== dialog || dialog.contains(event.target as Node)) return
      ;(controls()[0] ?? dialog).focus()
    }
    dialog.addEventListener('keydown', trap)
    document.addEventListener('focusin', contain)
    return () => {
      dialog.removeEventListener('keydown', trap)
      document.removeEventListener('focusin', contain)
      if (previousTabIndex === null) dialog.removeAttribute('tabindex')
      else dialog.setAttribute('tabindex', previousTabIndex)
      if (previous?.isConnected) previous.focus()
    }
  }, [body])
}

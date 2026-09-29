/**
 * Browser presence reporting: tracks window focus, page visibility, and the
 * current session id, then reports to the Host over the RPC route. The Host
 * uses this for "mute while viewing the session" and page-alive gating.
 */
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { TimerLike } from '../core/timer.ts'
import type { ClientPresence } from '../core/notifications.ts'
import { webPermission } from './drainer.ts'

export type PresenceReport = ClientPresence

export function currentSessionId(sessions: ISessions | undefined): string | null {
  if (!sessions) return null
  try {
    const rows = sessions.list.getSnapshot().byId
    return Object.values(rows).find(row => (row.retainedBy.mainView ?? 0) > 0)?.id ?? null
  } catch { return null }
}

/**
 * Whether the user is looking at the page right now: the window holds focus
 * and the document is visible (not minimized, not backgrounded). The toast
 * drainer uses this to fall back to a web notification when a toast-channel
 * event arrives after the user stopped looking.
 */
export function isLookingNow(): boolean {
  const focused = typeof document !== 'undefined' && typeof document.hasFocus === 'function' ? document.hasFocus() : false
  const visible = typeof document === 'undefined' || document.visibilityState === undefined ? true : document.visibilityState === 'visible'
  return focused && visible
}

export interface PresenceReporter {
  readonly clientId: string
  snapshot: () => ClientPresence
  report: () => void
  setPanelActive: (active: boolean) => void
  dispose: () => void
}

export function createPresenceReporter(
  sessions: ISessions | undefined,
  timer: TimerLike | undefined,
  send: (method: string, args: unknown) => Promise<unknown>,
): PresenceReporter {
  // Per reporter, not per tab storage: an HMR replacement is a new client.
  const clientId = crypto.randomUUID()
  let sequence = 0
  let open = true
  let disposed = false
  let panelActive = false
  const snapshot = (): ClientPresence => ({
    clientId,
    sequence: ++sequence,
    focused: open && !disposed && typeof document !== 'undefined' && typeof document.hasFocus === 'function' ? document.hasFocus() : false,
    visible: open && !disposed && (typeof document === 'undefined' || document.visibilityState === undefined || document.visibilityState === 'visible'),
    open: open && !disposed,
    sessionId: open && !disposed && !panelActive ? currentSessionId(sessions) : null,
    permission: webPermission(),
  })

  const report = (): void => {
    if (disposed) return
    try { void send('reportPresence', snapshot()).catch(() => {}) } catch {
      // A synchronous transport failure must not interrupt browser teardown.
    }
  }

  const offs: (() => void)[] = []
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    const onAny = (): void => report()
    const onHide = (): void => {
      if (disposed || !open) return
      open = false
      report()
    }
    const onShow = (): void => {
      if (disposed || open) return
      open = true
      report()
    }
    window.addEventListener('focus', onAny)
    window.addEventListener('blur', onAny)
    window.addEventListener('pagehide', onHide)
    window.addEventListener('pageshow', onShow)
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', onAny)
      offs.push(() => document.removeEventListener('visibilitychange', onAny))
    }
    offs.push(() => {
      window.removeEventListener('focus', onAny)
      window.removeEventListener('blur', onAny)
      window.removeEventListener('pagehide', onHide)
      window.removeEventListener('pageshow', onShow)
    })
  }

  if (timer && typeof timer.interval === 'function') {
    const offInt = timer.interval(report, 5000)
    offs.push(() => {
      try { offInt() } catch {}
    })
  }

  // Retention changes when the workspace navigation selects another session.
  if (sessions?.list && typeof sessions.list.subscribe === 'function') {
    offs.push(sessions.list.subscribe(() => report()))
  }

  report()

  return {
    clientId,
    snapshot,
    report,
    setPanelActive: active => { if (disposed || panelActive === active) return; panelActive = active; report() },
    dispose: () => {
      if (disposed) return
      open = false
      report()
      disposed = true
      for (const off of offs.splice(0)) {
        try { off() } catch {}
      }
    },
  }
}

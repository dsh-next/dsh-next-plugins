/**
 * Browser presence reporting: tracks window focus, page visibility, and the
 * current session id, then reports to the Host over the RPC route. The Host
 * uses this for "mute while viewing the session" and page-alive gating.
 */
import type { ISessions } from '@deepseek-ai/dsh-client-runtime/client'
import type { TimerLike } from '../core/timer.ts'

export interface PresenceReport {
  focused: boolean
  visible: boolean
  open: boolean
  sessionId: string | null
}

export function currentSessionId(sessions: ISessions | undefined): string | null {
  if (!sessions) return null
  // Primary channel: the current selection rides the session-list snapshot in
  // every runtime generation this plugin supports (0.1.1-rc.2 and the 0.1.2
  // shell — `SessionListState.current`). The 0.1.2 shell dropped the legacy
  // currentProvideInfo channel below, so reading it first made presence
  // report sessionId:null forever and "mute while viewing" never matched.
  try {
    const snap = sessions.list?.getSnapshot?.()
    if (snap && typeof snap.current === 'string' && snap.current.length > 0) return snap.current
  } catch {
    // fall through to the legacy channel
  }
  // Legacy channel: the 0.1.1-rc.2 runtime also exposed the current selection
  // as a HostObservable; keep it as a fallback for older shells.
  const info = sessions.currentProvideInfo
  if (!info || typeof info.getSnapshot !== 'function') return null
  try {
    const snap = info.getSnapshot()
    return snap && typeof snap.sessionId === 'string' ? snap.sessionId : null
  } catch {
    return null
  }
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
  report: () => void
  dispose: () => void
}

export function createPresenceReporter(
  sessions: ISessions | undefined,
  timer: TimerLike | undefined,
  send: (method: string, args: unknown) => Promise<unknown>,
): PresenceReporter {
  const compute = (): PresenceReport => ({
    focused: typeof document !== 'undefined' && typeof document.hasFocus === 'function' ? document.hasFocus() : false,
    visible: typeof document === 'undefined' || document.visibilityState === undefined ? true : document.visibilityState === 'visible',
    open: true,
    sessionId: currentSessionId(sessions),
  })

  const report = (): void => {
    void send('reportPresence', compute()).catch(() => {})
  }

  const offs: (() => void)[] = []
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    const onAny = (): void => report()
    window.addEventListener('focus', onAny)
    window.addEventListener('blur', onAny)
    window.addEventListener('pagehide', () => {
      void send('reportPresence', { focused: false, visible: false, open: false, sessionId: null }).catch(() => {})
    })
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', onAny)
      offs.push(() => document.removeEventListener('visibilitychange', onAny))
    }
    offs.push(() => {
      window.removeEventListener('focus', onAny)
      window.removeEventListener('blur', onAny)
    })
  }

  if (timer && typeof timer.interval === 'function') {
    const offInt = timer.interval(report, 5000)
    offs.push(() => {
      try { offInt() } catch {}
    })
  }

  // The current selection rides the list snapshot in both supported runtime
  // generations; subscribe there so switching sessions re-reports presence
  // immediately (the legacy currentProvideInfo channel is the fallback).
  if (sessions?.list && typeof sessions.list.subscribe === 'function') {
    offs.push(sessions.list.subscribe(() => report()))
  } else if (sessions?.currentProvideInfo && typeof sessions.currentProvideInfo.subscribe === 'function') {
    offs.push(sessions.currentProvideInfo.subscribe(() => report()))
  }

  report()

  return {
    report,
    dispose: () => {
      for (const off of offs) {
        try { off() } catch {}
      }
    },
  }
}

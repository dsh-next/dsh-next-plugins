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
  const info = sessions && sessions.currentProvideInfo
  if (!info || typeof info.getSnapshot !== 'function') return null
  try {
    const snap = info.getSnapshot()
    return snap && typeof snap.sessionId === 'string' ? snap.sessionId : null
  } catch {
    return null
  }
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

  if (sessions?.currentProvideInfo && typeof sessions.currentProvideInfo.subscribe === 'function') {
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

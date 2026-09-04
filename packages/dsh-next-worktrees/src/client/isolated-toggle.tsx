/**
 * The "Isolated" toggle on the blank-session composer (`conversation.input.left`).
 *
 * The toggle never sends: on confirm it asks the host to create the
 * worktree, registers the workspace, creates the session, binds it (the
 * host switches the session's sandbox knob after verifying its cwd), and
 * focuses the new session — the resident composer stays the submission
 * path. The draft stays in the source session (title derivation only).
 */
import * as React from 'react'
import { deriveTitle } from '../core/slug.ts'
import {
  projectedCwd,
  type CreateRpcOutcome,
  type EntryRuntimeProps,
  type PreflightRpcOutcome,
  type Rpc,
  type RpcErrorPayload,
  type Translate,
  type WorktreeClientServices,
} from './types.ts'
import styles from './worktrees.module.css'

/** Props: standard runtime share (loose faces) plus injected closures. */
export interface IsolatedToggleProps extends EntryRuntimeProps {
  readonly rpc: Rpc
  readonly t: Translate
  readonly services: WorktreeClientServices
}

type Phase = 'checking' | 'offered' | 'confirm' | 'busy' | 'error'

const HINT_KEY = 'dsh-next-worktrees:ignore-hint:v1'

/** The blank-session isolation switch. Renders null unless offered. */
export function IsolatedToggle(props: IsolatedToggleProps): React.ReactElement | null {
  const { rpc, t, services } = props
  const useSession = props.useSession
  const useInput = props.useInput

  // The lifecycle snapshot exposes `blank` (not composerPhase) and no cwd;
  // the cwd arrives through the sessions list projection, which can lag
  // session creation by a tick.
  const blank = useSession?.((s) => (s as { blank?: boolean } | undefined)?.blank) === true
  const projected = projectedCwd(services, props.sessionId)
  const cwd = projected ?? useSession?.((s) => (s as { cwd?: string } | undefined)?.cwd)
  const draft = useInput?.((s) => (s as { draft?: string } | undefined)?.draft ?? '') ?? ''

  const [phase, setPhase] = React.useState<Phase>(blank ? 'checking' : 'offered')
  const [preflight, setPreflight] = React.useState<PreflightRpcOutcome | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [hintDismissed, setHintDismissed] = React.useState(false)
  const [cwdTick, setCwdTick] = React.useState(0)

  React.useEffect(() => {
    if (!blank) return
    // The projection may not carry the fresh session's cwd yet; poll for it.
    if (cwd === undefined) {
      const handle = window.setTimeout(() => setCwdTick((n) => n + 1), 500)
      return () => { window.clearTimeout(handle) }
    }
    let active = true
    setPhase('checking')
    setError(null)
    void rpc('preflight', { cwd }).then((response) => {
      if (!active) return
      const result = response as PreflightRpcOutcome & RpcErrorPayload
      if (result?.error !== undefined || result?.degraded === true || result?.ok !== true) {
        setPreflight(null)
        setPhase('error')
        setError(result?.error?.message ?? 'git preflight failed')
        return
      }
      setPreflight(result)
      setPhase('offered')
    }).catch(() => {
      if (!active) return
      setPhase('error')
      setError('rpc unreachable')
    })
    return () => { active = false }
  }, [rpc, blank, cwd, cwdTick])

  if (!blank) return null
  if (phase === 'checking') return null
  // Degraded (git unusable) hides the toggle: read-only mode, nothing broken.
  if (phase === 'error' && preflight === null) return null

  const startConfirm = (): void => {
    setError(null)
    setPhase('confirm')
  }

  const beginCreate = async (): Promise<void> => {
    if (cwd === undefined) return
    setPhase('busy')
    setError(null)
    try {
      const created = (await rpc('create', {
        cwd,
        title: deriveTitle(draft),
      })) as CreateRpcOutcome & RpcErrorPayload
      if (created?.error !== undefined || typeof created?.sessionCwd !== 'string') {
        throw new Error(created?.error?.message ?? 'create failed')
      }
      if (services.workspaces === undefined || services.sessions === undefined) {
        throw new Error('runtime services unavailable')
      }
      const workspace = await services.workspaces.create({ path: created.sessionCwd })
      const targetId = await services.sessions.create({ workspaceId: workspace.workspaceId })
      const bound = await rpc('bind', { sessionId: targetId }) as RpcErrorPayload
      if (bound?.error !== undefined) {
        throw new Error(bound.error?.message ?? 'bind failed')
      }
      services.sessions.open(targetId)
      // Navigation unmounts this entry; no further state writes needed.
    } catch (cause) {
      setPhase('error')
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const showHint = preflight?.showIgnoreHint === true && !hintDismissed
    && (typeof window === 'undefined' || window.localStorage?.getItem(HINT_KEY) !== '1')
  const dismissHint = (): void => {
    setHintDismissed(true)
    try {
      window.localStorage?.setItem(HINT_KEY, '1')
    } catch { /* storage unavailable: per-mount dismissal only */ }
  }

  return (
    <span className={styles.toggle} data-testid="worktrees-toggle">
      <button
        type="button"
        role="switch"
        aria-checked={false}
        aria-label={t('toggle.label')}
        className={styles.toggleButton}
        disabled={phase === 'busy' || phase === 'error'}
        onClick={startConfirm}
        data-testid="worktrees-toggle-button"
      >
        <span className={styles.toggleGlyph} aria-hidden="true">
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
            <rect x="2" y="2" width="12" height="12" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
            <path d="M5 8.5l2 2 4-4.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </span>
        {t('toggle.label')}
      </button>
      {phase === 'busy' ? <span className={styles.spinner} aria-label={t('toggle.busy')} /> : null}
      {showHint
        ? (
          <span className={styles.hint} data-testid="worktrees-ignore-hint">
            {t('hint.ignore')}
            <button type="button" className={styles.hintAction} onClick={dismissHint}>
              {t('hint.dismiss')}
            </button>
          </span>
        )
        : null}
      {(phase === 'confirm' || phase === 'busy')
        ? (
          <span className={styles.overlay} role="dialog" aria-modal="true" aria-label={t('modal.title')}>
            <span className={styles.modalPanel}>
              <span className={styles.modalTitle}>{t('modal.title')}</span>
              <span className={styles.modalNote}>{t('modal.description')}</span>
              <span className={styles.modalNote}>{t('modal.fullAccess')}</span>
              <span className={styles.modalNote}>{t('modal.draftStays')}</span>
              {error !== null ? <span className={styles.error} role="alert">{t('error.create', { message: error })}</span> : null}
              <span className={styles.modalFooter}>
                <button type="button" className={styles.button} disabled={phase === 'busy'} onClick={() => setPhase('offered')}>
                  {t('modal.cancel')}
                </button>
                <button
                  type="button"
                  className={styles.buttonPrimary}
                  disabled={phase === 'busy'}
                  onClick={() => { void beginCreate() }}
                  data-testid="worktrees-confirm"
                >
                  {phase === 'busy' ? t('toggle.busy') : t('modal.confirm')}
                </button>
              </span>
            </span>
          </span>
        )
        : null}
      {phase === 'error' && error !== null
        ? (
          <span className={styles.error} role="alert">
            {t('error.create', { message: error })}
          </span>
        )
        : null}
    </span>
  )
}

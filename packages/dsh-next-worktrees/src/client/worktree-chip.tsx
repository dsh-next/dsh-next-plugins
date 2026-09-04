/**
 * The session-header chip (`conversation.session.header.actions`) for
 * sessions bound to a plugin worktree.
 *
 * Shows title, ahead count, and one status dot (clean/dirty/error); the
 * dropdown carries worktree facts, sibling navigation (open another bound
 * session), copy actions, "new session here" gated on an idle session, and
 * remove with danger grammar (dirty worktrees need an explicit forced
 * confirm; the branch and its commits always survive).
 */
import * as React from 'react'
import {
  projectedCwd,
  type EntryRuntimeProps,
  type Rpc,
  type RpcErrorPayload,
  type StatusRpcOutcome,
  type Translate,
  type WorktreeClientServices,
} from './types.ts'
import styles from './worktrees.module.css'

/** Props: standard runtime share (loose faces) plus injected closures. */
export interface WorktreeChipProps extends EntryRuntimeProps {
  readonly rpc: Rpc
  readonly t: Translate
  readonly services: WorktreeClientServices
}

const REFRESH_MS = 10_000

/** The header chip; renders null for sessions without a plugin worktree. */
export function WorktreeChip(props: WorktreeChipProps): React.ReactElement | null {
  const { rpc, t, services } = props
  const sessionId = props.sessionId
  const useSession = props.useSession

  // The lifecycle snapshot has no cwd; the sessions list projection does.
  const cwd = projectedCwd(services, sessionId)
    ?? useSession?.((s) => (s as { cwd?: string } | undefined)?.cwd)
  const running = useSession?.((s) => (s as { running?: boolean } | undefined)?.running) === true

  const [status, setStatus] = React.useState<StatusRpcOutcome | null>(null)
  const [open, setOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [copied, setCopied] = React.useState<string | null>(null)
  const [removeOpen, setRemoveOpen] = React.useState(false)
  const [removeDirty, setRemoveDirty] = React.useState(false)
  const [removeError, setRemoveError] = React.useState<string | null>(null)

  const refresh = React.useCallback(async (): Promise<void> => {
    if (sessionId === undefined) return
    try {
      const response = await rpc('status', { sessionId }) as StatusRpcOutcome & RpcErrorPayload
      if (response?.error === undefined) setStatus(response)
    } catch { /* transient transport failure: keep last status */ }
  }, [rpc, sessionId])

  React.useEffect(() => {
    if (sessionId === undefined) return
    void refresh()
    const handle = window.setInterval(() => { void refresh() }, REFRESH_MS)
    return () => { window.clearInterval(handle) }
  }, [refresh, sessionId])

  if (sessionId === undefined || status === null || status.bound !== true || status.binding === null) {
    return null
  }
  const binding = status.binding
  const chipLabel = binding.title.length > 0 ? binding.title : binding.branch
  const statusText = status.chipStatus === 'clean'
    ? t('chip.clean')
    : status.chipStatus === 'dirty' ? t('chip.dirty') : t('chip.error')

  const copy = async (label: string, text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(label)
      window.setTimeout(() => setCopied(null), 1500)
    } catch { /* clipboard unavailable: no feedback */ }
  }

  const openSibling = (target: string): void => {
    services.sessions?.open(target)
  }

  const newSessionHere = async (): Promise<void> => {
    if (running || cwd === undefined) return
    setBusy(true)
    try {
      if (services.workspaces === undefined || services.sessions === undefined) return
      const workspace = await services.workspaces.create({ path: cwd })
      const created = await services.sessions.create({ workspaceId: workspace.workspaceId })
      await rpc('bind', { sessionId: created }) as RpcErrorPayload
      services.sessions.open(created)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (force: boolean): Promise<void> => {
    if (cwd === undefined) return
    setBusy(true)
    setRemoveError(null)
    try {
      const response = await rpc('remove', { cwd, slug: binding.slug, force }) as RpcErrorPayload
      if (response?.error !== undefined) {
        setRemoveError(response.error?.message ?? 'remove failed')
        return
      }
      setRemoveOpen(false)
      setOpen(false)
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className={styles.chipWrap}>
      <button
        type="button"
        className={styles.chip}
        aria-label={t('chip.open')}
        onClick={() => { setOpen((value) => !value) }}
        data-testid="worktrees-chip"
        data-status={status.chipStatus ?? 'error'}
      >
        <span className={`${styles.dot} ${styles['dot-' + (status.chipStatus ?? 'error')]}`} aria-hidden="true" />
        <span className={styles.chipTitle}>{chipLabel}</span>
        {status.ahead !== null && status.ahead > 0
          ? <span className={styles.ahead}>{t('chip.ahead', { count: status.ahead })}</span>
          : null}
        {busy ? <span className={styles.spinner} aria-hidden="true" /> : null}
      </button>

      {open
        ? (
          <div className={styles.panel} data-testid="worktrees-panel" role="menu">
            <dl className={styles.facts}>
              <div><dt>{t('panel.branch')}</dt><dd>{binding.branch}</dd></div>
              <div><dt>{t('panel.base')}</dt><dd>{binding.baseRef}</dd></div>
              <div><dt>{t('panel.path')}</dt><dd className={styles.path}>{binding.path}</dd></div>
            </dl>

            <div className={styles.section}>{t('panel.siblings')}</div>
            {status.siblings.length === 0
              ? <div className={styles.siblingNone}>{t('panel.siblings.none')}</div>
              : (
                <ul className={styles.siblings}>
                  {status.siblings.map((sibling) => (
                    <li key={sibling.slug}>
                      <button
                        type="button"
                        className={styles.sibling}
                        disabled={sibling.sessionId === null}
                        title={sibling.running === true
                          ? t('panel.siblings.running')
                          : sibling.sessionId === null ? t('panel.siblings.none') : t('panel.siblings.idle')}
                        onClick={() => { if (sibling.sessionId !== null) openSibling(sibling.sessionId) }}
                      >
                        <span className={styles.siblingName}>
                          {sibling.title.length > 0 ? sibling.title : sibling.branch}
                        </span>
                        <span className={styles.siblingState}>
                          {sibling.running === true ? t('panel.siblings.running') : t('panel.siblings.idle')}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}

            <div className={styles.actions}>
              <button type="button" className={styles.action} onClick={() => { void copy('branch', binding.branch) }}>
                {copied === 'branch' ? t('panel.copied') : t('panel.copyBranch')}
              </button>
              <button
                type="button"
                className={styles.action}
                onClick={() => { void copy('merge', `git merge ${binding.branch}`) }}
              >
                {copied === 'merge' ? t('panel.copied') : t('panel.copyMerge')}
              </button>
              <button
                type="button"
                className={styles.action}
                disabled={running || busy}
                title={running ? t('panel.newSession.busy') : undefined}
                onClick={() => { void newSessionHere() }}
              >
                {t('panel.newSession')}
              </button>
              <button type="button" className={styles.action} onClick={() => { void refresh() }}>
                {t('panel.refresh')}
              </button>
              <button
                type="button"
                className={`${styles.action} ${styles.actionDanger}`}
                onClick={() => {
                  setRemoveDirty(status.dirty === true)
                  setRemoveError(null)
                  setRemoveOpen(true)
                }}
              >
                {t('panel.remove')}
              </button>
            </div>
          </div>
        )
        : null}

      {removeOpen
        ? (
          <span className={styles.overlay} role="dialog" aria-modal="true" aria-label={t('remove.title')}>
            <span className={styles.modalPanel}>
              <span className={styles.modalTitle}>{t('remove.title')}</span>
              <span className={styles.modalNote}>{t('remove.survives', { branch: binding.branch })}</span>
              {removeDirty ? <span className={styles.modalNote}>{t('remove.dirty')}</span> : null}
              {removeError !== null ? <span className={styles.error} role="alert">{t('error.flow', { message: removeError })}</span> : null}
              <span className={styles.modalFooter}>
                <button type="button" className={styles.button} disabled={busy} onClick={() => setRemoveOpen(false)}>
                  {t('remove.cancel')}
                </button>
                {removeDirty
                  ? (
                    <button
                      type="button"
                      className={styles.buttonDanger}
                      disabled={busy}
                      onClick={() => { void remove(true) }}
                      data-testid="worktrees-remove-force"
                    >
                      {t('remove.force')}
                    </button>
                  )
                  : (
                    <button
                      type="button"
                      className={styles.buttonDanger}
                      disabled={busy}
                      onClick={() => { void remove(false) }}
                      data-testid="worktrees-remove-confirm"
                    >
                      {t('remove.confirm')}
                    </button>
                  )}
              </span>
            </span>
          </span>
        )
        : null}
    </span>
  )
}

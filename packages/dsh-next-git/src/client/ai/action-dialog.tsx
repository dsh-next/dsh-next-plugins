import * as React from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AgentVerb } from '../../core/agent-verbs.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { AiTaskResults } from './task-results.ts'
import type { PanelStore, AgentActionScope, PreparedAgentAction } from '../controller.ts'
import type { Translate } from '../GitPanel.tsx'
import { SessionBridgeError, type SessionDelivery, type SessionSourceMetadata } from './session-bridge.ts'
import { useDialogFocus } from '../ui/dialog-focus.ts'
import classes from './action-dialog.module.css'

/** Bound to the pane's source session, never the globally selected chat. */
export interface AgentSessionControls {
  getSource(): SessionSourceMetadata | undefined
  createDelivery(input: { target: 'current' | 'new'; expectedCwd: string; text: string }): SessionDelivery
  subscribeRefresh(refresh: () => void): () => void
  taskResults?(root: string): AiTaskResults
  openSession?(sessionId: SessionId): void
}

export interface AgentActionRequest {
  readonly verb: AgentVerb
  readonly scope?: AgentActionScope
}

/** Every AI affordance enters here; opening or cancelling never submits. */
export interface AgentActionDialogProps {
  request: AgentActionRequest
  store: PanelStore
  sessions: AgentSessionControls
  t: Translate
  onClose(): void
}

export function AgentActionDialog(props: AgentActionDialogProps): React.ReactElement {
  return <ActionDialog key={JSON.stringify([props.request.verb, props.request.scope, props.sessions.getSource()?.sessionId])} {...props} />
}

function ActionDialog(props: AgentActionDialogProps): React.ReactElement {
  const { request, store, sessions, t } = props
  const [prepared, setPrepared] = React.useState<PreparedAgentAction | null>(null)
  const [target, setTarget] = React.useState<'current' | 'new' | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [accepted, setAccepted] = React.useState(false)
  const [preparing, setPreparing] = React.useState(true)
  const [preparationAttempt, setPreparationAttempt] = React.useState(0)
  const [pathsChoice, setPathsChoice] = React.useState<readonly string[] | undefined>()
  const [catalog, setCatalog] = React.useState<readonly string[]>([])
  const defaultPaths = React.useRef<readonly string[]>([])
  const scope = React.useMemo(() => pathsChoice === undefined ? request.scope : { ...request.scope, paths: pathsChoice, includeSensitive: true }, [request.scope, pathsChoice])
  const generation = React.useRef(0)
  const delivery = React.useRef<SessionDelivery | null>(null)
  const active = React.useRef(true)
  const abort = React.useRef<AbortController | null>(null)
  const body = React.useRef<HTMLDivElement>(null)
  useDialogFocus(body)

  React.useEffect(() => {
    const current = ++generation.current
    active.current = true
    delivery.current = null
    abort.current = null
    setPrepared(null)
    setTarget(null)
    setError(null)
    setAccepted(false)
    setBusy(false)
    setPreparing(true)
    const isCurrent = (): boolean => active.current && generation.current === current
    void store.prepareAgentAction(request.verb, scope).then((value) => {
      if (isCurrent()) {
        setPrepared(value)
        defaultPaths.current = value.payload.includedFiles
        setCatalog(old => [...new Set([...old, ...(value.availableFiles ?? value.payload.includedFiles)])])
      }
    }, () => { if (isCurrent()) setError(t('agent.error.context')) })
      .finally(() => { if (isCurrent()) setPreparing(false) })
    return () => { active.current = false; abort.current?.abort() }
  }, [store, sessions, request, scope, t, preparationAttempt])

  const close = (): void => {
    if (!active.current) return
    active.current = false
    abort.current?.abort()
    props.onClose()
  }
  const open = (): void => {
    try { delivery.current?.open(); props.onClose() }
    catch { setError(t('agent.error.open-failed')) }
  }
  const start = async (): Promise<void> => {
    if (!active.current || target === null || prepared === null || busy || abort.current !== null) return
    setBusy(true)
    setError(null)
    const controller = new AbortController()
    const current = generation.current
    abort.current = controller
    const isCurrent = (): boolean => active.current && generation.current === current && !controller.signal.aborted
    try {
      // Preview may have sat open while another session changed the repository.
      if (delivery.current === null) {
        const fresh = await store.prepareAgentAction(request.verb, scope)
        if (!isCurrent()) return
        if (fresh.fingerprint !== prepared.fingerprint) {
          setPrepared(fresh)
          defaultPaths.current = fresh.payload.includedFiles
          setCatalog(old => [...new Set([...old, ...(fresh.availableFiles ?? fresh.payload.includedFiles)])])
          setTarget(null)
          setError(t('agent.contextChanged'))
          return
        }
        delivery.current = sessions.createDelivery({ target, expectedCwd: fresh.state.cwd, text: fresh.payload.prompt })
      }
      await delivery.current.send(controller.signal)
      if (!isCurrent()) return
      setAccepted(true)
      const receipt = delivery.current.getSnapshot()
      const source = sessions.getSource()
      if (source !== undefined && receipt.sessionId !== undefined && receipt.requestId !== undefined) {
        sessions.taskResults?.(prepared.state.root).admit({
          accepted: true, sourceSessionId: source.sessionId, targetSessionId: receipt.sessionId, requestId: receipt.requestId,
          root: prepared.state.root, cwd: prepared.state.cwd, fingerprint: request.verb === 'draft' && !request.scope?.commits ? prepared.repositoryVersion ?? prepared.fingerprint : prepared.fingerprint,
          verb: request.scope?.commits ? 'history-' + request.verb : request.verb,
        })
      }
      store.agentQueued()
      if (target === 'new') open()
      else props.onClose()
    } catch (cause) {
      if (isCurrent()) {
        setAccepted(delivery.current?.getSnapshot().accepted ?? false)
        setError(cause instanceof SessionBridgeError ? t(('agent.error.' + cause.code) as Parameters<Translate>[0]) : t('agent.error.context'))
      }
    } finally {
      if (isCurrent()) { abort.current = null; setBusy(false) }
    }
  }
  const chooseWithKeyboard = (event: React.KeyboardEvent<HTMLFieldSetElement>): void => {
    if (busy || delivery.current !== null || !(event.target instanceof HTMLInputElement)) return
    const choices = [...event.currentTarget.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
      .filter(input => !input.disabled)
    const index = choices.indexOf(event.target)
    if (index < 0) return
    let next: number
    switch (event.key) {
      case 'ArrowRight': case 'ArrowDown': next = (index + 1) % choices.length; break
      case 'ArrowLeft': case 'ArrowUp': next = (index + choices.length - 1) % choices.length; break
      case 'Home': next = 0; break
      case 'End': next = choices.length - 1; break
      case ' ': next = index; break
      default: return
    }
    event.preventDefault()
    const choice = choices[next]!
    choice.focus()
    choice.click()
  }
  const source = sessions.getSource()
  const title = t(('agent.' + request.verb) as Parameters<Translate>[0])
  return (
    <Modal open title={title} onClose={close} closeLabel={t('confirm.cancel')}
      footer={<>
        <Button variant="ghost" onClick={close}>{t('confirm.cancel')}</Button>
        <Button variant="primary" disabled={busy || (!accepted && (target === null || prepared === null || (prepared.payload.includedFiles.length === 0 && !request.scope?.commits?.length)))}
          onClick={() => { if (accepted) open(); else void start() }}>
          {accepted ? t('agent.openSession') : busy ? t('busy.agent') : t('agent.start')}
        </Button>
      </>}>
      <div ref={body} className={classes.body} data-dsh-git="agent-dialog">
        <p>{t('agent.destination')}</p>
        <fieldset className={classes.choices} disabled={busy || delivery.current !== null} aria-label={t('agent.destination')} onKeyDown={chooseWithKeyboard}>
          <label><input type="radio" name="git-agent-target" value="current" checked={target === 'current'}
            disabled={source === undefined} onChange={() => setTarget('current')} />{t('agent.currentSession')}</label>
          <span className={classes.hint}>{source?.title ?? t('agent.unavailable')}</span>
          <label><input type="radio" name="git-agent-target" value="new" checked={target === 'new'}
            disabled={source === undefined} onChange={() => setTarget('new')} />{t('agent.newSession')}</label>
        </fieldset>
        <p className={classes.hint}>{t('agent.queueHint')}</p>
        {request.scope?.commits === undefined && catalog.length > 0 && <fieldset className={classes.fileChoices} disabled={busy || delivery.current !== null}>
          <legend>{t('agent.filesToShare')}</legend>
          <p className={classes.hint}>{t('agent.sensitiveHint')}</p>
          {catalog.slice(0, 200).map(path => <label key={path}><input type="checkbox" checked={(pathsChoice ?? defaultPaths.current).includes(path)} onChange={() => {
            setPathsChoice(old => { const next = new Set(old ?? defaultPaths.current); if (next.has(path)) next.delete(path); else next.add(path); return [...next] })
          }} />{path}</label>)}
          {catalog.length > 200 && <p>{t('agent.fileChoiceLimit')}</p>}
        </fieldset>}
        {prepared === null && preparing ? <p role="status">{t('agent.preparing')}</p> : null}
        {prepared === null && !preparing ? <Button variant="ghost" onClick={() => setPreparationAttempt(value => value + 1)}>{t('state.retry')}</Button> : null}
        {prepared !== null ? <>
          <dl className={classes.context}>
            <dt>{t('agent.checkout')}</dt><dd>{prepared.state.root}</dd>
            <dt>{t('agent.branch')}</dt><dd>{prepared.state.head.branch ?? t('header.detached')}</dd>
            <dt>{t('agent.scope')}</dt><dd>{request.scope?.commits ? t('agent.commitCount', { count: request.scope.commits.length }) : t('agent.fileCount', { count: prepared.payload.includedFiles.length })}</dd>
          </dl>
          <p className={classes.hint}>{request.verb === 'resolve' ? t('agent.editPermission') : t('agent.readPermission')}</p>
          {prepared.payload.truncated ? <p role="status">{t('agent.truncated')}</p> : null}
          {prepared.payload.includedFiles.length === 0 && !request.scope?.commits?.length && <p role="status">{t('agent.noFiles')}</p>}
          <details><summary>{t('agent.contextPreview')}</summary><pre className={classes.preview}>{prepared.payload.prompt}</pre></details>
        </> : null}
        {delivery.current?.getSnapshot().createdSessionId ? <p className={classes.hint}>{t('agent.createdRetry')}</p> : null}
        {error === null ? null : <p role="alert" className={classes.error}>{error}</p>}
      </div>
    </Modal>
  )
}

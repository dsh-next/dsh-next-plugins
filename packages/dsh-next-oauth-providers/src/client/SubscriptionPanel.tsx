/**
 * One family's subscription UI: owns the sign-in attempt it started and
 * renders the stock editor card. Used both by the Add entry (a family with no
 * profile yet) and by the native provider card (a configured family).
 */
import * as React from 'react'
import type { Family } from '../core/catalog.ts'
import type { AttemptView, ProviderState } from '../core/types.ts'
import { type RpcCall, subscriptionsApi } from './api.ts'
import { resolveTranslate } from './dictionaries.ts'
import { errorText } from './error-text.ts'
import { ProviderEditor } from './ProviderEditor.tsx'
import styles from './footer.module.css'
import type { Translate } from './ProviderEditor.tsx'

export interface SubscriptionPanelProps {
  family: Family
  provider?: ProviderState
  rpc: RpcCall
  t: Translate
  readOnly: boolean
  /** The panel finished: `true` when an Apply committed provider settings. */
  onChanged: (changed: boolean) => void
}

export function SubscriptionPanel(props: SubscriptionPanelProps): React.ReactElement {
  const { family, rpc } = props
  const t = React.useMemo(() => resolveTranslate(props.t), [props.t])
  const api = React.useMemo(() => subscriptionsApi(rpc), [rpc])
  const [attempt, setAttemptState] = React.useState<AttemptView | undefined>()
  const [promptValue, setPromptValue] = React.useState('')
  const [error, setError] = React.useState<string | undefined>()
  const ownedAttempt = React.useRef<AttemptView | undefined>()
  const mounted = React.useRef(false)
  const loginGeneration = React.useRef(0)

  const setAttempt = React.useCallback((next: AttemptView | undefined): void => {
    ownedAttempt.current = next
    if (mounted.current) setAttemptState(next)
  }, [])

  const reportError = React.useCallback((caught: unknown): void => {
    if (mounted.current) setError(errorText(caught, t))
  }, [t])

  React.useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      loginGeneration.current++
      const current = ownedAttempt.current
      ownedAttempt.current = undefined
      if (current?.status === 'running') void api.cancelLogin(current.id).catch(() => {})
    }
  }, [api])

  const abandonAttempt = React.useCallback((): void => {
    loginGeneration.current++
    const current = ownedAttempt.current
    setAttempt(undefined)
    setPromptValue('')
    if (current?.status === 'running') void api.cancelLogin(current.id).catch(reportError)
  }, [api, reportError, setAttempt])

  const startLogin = async (): Promise<void> => {
    const generation = ++loginGeneration.current
    setError(undefined)
    try {
      const next = await api.startLogin(family.family)
      if (!mounted.current || generation !== loginGeneration.current) {
        if (next.status === 'running') await api.cancelLogin(next.id)
        return
      }
      setAttempt(next)
      setPromptValue('')
    } catch (caught) {
      if (generation === loginGeneration.current) reportError(caught)
    }
  }

  const cancelLogin = (): void => {
    const current = ownedAttempt.current
    if (current === undefined) return
    void api.cancelLogin(current.id).then((next) => {
      if (mounted.current && ownedAttempt.current?.id === current.id) setAttempt(next)
    }).catch(reportError)
  }

  const submitPrompt = (): void => {
    const current = ownedAttempt.current
    if (current?.prompt === undefined) return
    void api.submitPrompt(current.id, current.prompt.id, promptValue).then((next) => {
      if (!mounted.current || ownedAttempt.current?.id !== current.id) return
      setPromptValue('')
      setAttempt(next)
    }).catch(reportError)
  }

  const attemptId = attempt?.id
  const attemptRunning = attempt?.status === 'running'
  React.useEffect(() => {
    if (attemptId === undefined || !attemptRunning) return
    let cancelled = false
    const tick = (): void => {
      void api.getAttempt(attemptId).then((next) => {
        if (cancelled || ownedAttempt.current?.id !== attemptId || ownedAttempt.current.status !== 'running'
          || next === null || typeof next !== 'object' || !('id' in next)) return
        setAttempt(next)
      }).catch((caught) => {
        if (!cancelled) reportError(caught)
      })
    }
    tick()
    const timer = window.setInterval(tick, 400)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [api, attemptId, attemptRunning, reportError, setAttempt])

  React.useEffect(() => {
    if (attempt === undefined) return
    if (attempt.status === 'authorized') {
      setAttempt(undefined)
      props.onChanged(true)
      return
    }
    if (attempt.status === 'cancelled') {
      setAttempt(undefined)
      return
    }
    if (attempt.status === 'failed') {
      if (attempt.error !== undefined) setError(t(`error.${attempt.error.code}` as Parameters<Translate>[0], attempt.error.params))
      setAttempt(undefined)
    }
  }, [attempt, props, setAttempt, t])

  const activeAttempt = attempt !== undefined && attempt.family === family.family ? attempt : undefined

  return (
    <>
      {error === undefined ? null : <p className={styles.error} role="alert">{error}</p>}
      <ProviderEditor
        family={family}
        provider={props.provider}
        t={t}
        rpc={rpc}
        readOnly={props.readOnly}
        attempt={activeAttempt}
        promptValue={promptValue}
        onPromptValue={setPromptValue}
        onSignIn={() => { void startLogin() }}
        onCancelLogin={cancelLogin}
        onSubmitPrompt={submitPrompt}
        onClose={(changed) => {
          abandonAttempt()
          props.onChanged(changed)
        }}
      />
    </>
  )
}

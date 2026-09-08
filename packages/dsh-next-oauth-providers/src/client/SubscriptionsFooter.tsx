/**
 * Models footer: stock provider rows, Add provider card, fetch-models modal.
 */
import * as React from 'react'
import { Button, Modal, IconPlusOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { FAMILIES, familyById, type Family, type FamilyId } from '../core/catalog.ts'
import type { AttemptView, PluginState } from '../core/types.ts'
import { ClientRpcError, subscriptionsApi, type RpcCall } from './api.ts'
import { resolveTranslate, type MessageKey } from './dictionaries.ts'
import { ProviderEditor } from './ProviderEditor.tsx'
import styles from './footer.module.css'

export type Translate = (key: MessageKey, params?: Record<string, string | number>) => string

export interface SubscriptionsFooterProps {
  rpc: RpcCall
  t?: Translate
}

function familyLabel(t: Translate, id: FamilyId): string {
  return t(`family.${id}` as MessageKey)
}

function errorText(error: unknown, t: Translate): string {
  if (error instanceof ClientRpcError) {
    return t(`error.${error.code}` as MessageKey, error.params)
  }
  return t('error.unknown')
}

export function SubscriptionsFooter(props: SubscriptionsFooterProps): React.ReactElement {
  const t = React.useMemo(() => resolveTranslate(props.t), [props.t])
  const api = React.useMemo(() => subscriptionsApi(props.rpc), [props.rpc])
  const [state, setState] = React.useState<PluginState | undefined>()
  const [error, setError] = React.useState<string | undefined>()
  const [editing, setEditing] = React.useState<FamilyId | undefined>()
  const [adding, setAdding] = React.useState(false)
  const [addFamily, setAddFamily] = React.useState<Family | undefined>()
  const [attempt, setAttemptState] = React.useState<AttemptView | undefined>()
  const ownedAttempt = React.useRef<AttemptView | undefined>()
  const mounted = React.useRef(false)
  const loginGeneration = React.useRef(0)
  const setAttempt = React.useCallback((next: AttemptView | undefined): void => {
    ownedAttempt.current = next
    if (mounted.current) setAttemptState(next)
  }, [])

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
  const [promptValue, setPromptValue] = React.useState('')
  const [deleteTarget, setDeleteTarget] = React.useState<Family | undefined>()
  const [deleting, setDeleting] = React.useState(false)
  const [deleteFailure, setDeleteFailure] = React.useState<string | undefined>()
  const [saved, setSaved] = React.useState<string | undefined>()

  const load = React.useCallback(async (): Promise<PluginState | undefined> => {
    try {
      const next = await api.getState()
      if (!mounted.current) return undefined
      setState(next)
      setError(undefined)
      return next
    } catch (caught) {
      if (mounted.current) setError(errorText(caught, t))
      return undefined
    }
  }, [api, t])

  React.useEffect(() => {
    void load()
  }, [load])

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
        if (!cancelled) setError(errorText(caught, t))
      })
    }
    tick()
    const timer = window.setInterval(tick, 400)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [api, attemptId, attemptRunning, t, setAttempt])

  React.useEffect(() => {
    if (attempt === undefined) return
    if (attempt.status === 'authorized') {
      setAttempt(undefined)
      void load()
      return
    }
    if (attempt.status === 'cancelled') {
      setAttempt(undefined)
      return
    }
    if (attempt.status === 'failed') {
      if (attempt.error !== undefined) setError(t(`error.${attempt.error.code}` as MessageKey, attempt.error.params))
      setAttempt(undefined)
    }
  }, [attempt, load, t, setAttempt])

  const listed = state?.providers ?? []
  const addable = FAMILIES.filter((family) => !listed.some((row) => row.family === family.family))
  const writable = state?.writable !== false
  const listedFamilyKey = listed.map((row) => row.family).join(',')

  React.useEffect(() => {
    if (!adding || addFamily === undefined) return
    if (!listedFamilyKey.split(',').includes(addFamily.family)) return
    setAdding(false)
    setAddFamily(undefined)
  }, [adding, addFamily, listedFamilyKey])
  const activeFamily = adding ? addFamily : (editing === undefined ? undefined : familyById(editing))
  const activeAttempt = attempt !== undefined && attempt.family === activeFamily?.family ? attempt : undefined

  const reportError = (caught: unknown): void => {
    if (mounted.current) setError(errorText(caught, t))
  }

  const abandonAttempt = (): void => {
    loginGeneration.current++
    const current = ownedAttempt.current
    setAttempt(undefined)
    setPromptValue('')
    if (current?.status === 'running') void api.cancelLogin(current.id).catch(reportError)
  }

  const startLogin = async (family: FamilyId): Promise<void> => {
    const generation = ++loginGeneration.current
    setError(undefined)
    try {
      const next = await api.startLogin(family)
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

  const closeEditor = (changed: boolean, family: Family): void => {
    abandonAttempt()
    setAdding(false)
    setEditing(undefined)
    setAddFamily(undefined)
    if (changed) {
      setSaved(t('savedProvider', { provider: familyLabel(t, family.family) }))
      void load()
    }
  }

  return (
    <section className={styles.section} data-testid="dsh-next-oauth-providers" aria-label={t('a11y.section')}>
      <h3 className={styles.title}>{t('title')}</h3>
      <p className={styles.intro}>{t('intro')}</p>
      {error === undefined ? null : <p className={styles.error} role="alert">{error}</p>}
      {saved === undefined ? null : <p className={styles.savedNotice}>{saved}</p>}
      <ul className={styles.rows}>
        {listed.map((provider) => {
          const family = familyById(provider.family)
          if (family === undefined) return null
          const open = !adding && editing === provider.family
          const connected = provider.status === 'connected'
          return (
            <li key={provider.family} className={styles.rowCard} data-testid={`dsh-next-oauth-providers-${provider.family}`}>
              <div className={styles.rowHead}>
                <span className={styles.rowIdentity}>
                  <span className={styles.rowName}>{familyLabel(t, provider.family)}</span>
                  <span
                    className={`${styles.credentialDot} ${connected ? styles.credentialDotConfigured : styles.credentialDotMissing}`}
                    role="img"
                    aria-label={connected ? t('credentialConfigured') : t('credentialMissing')}
                    title={connected ? t('credentialConfigured') : t('credentialMissing')}
                  />
                </span>
                <span className={styles.rowActions}>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    aria-label={t('editProvider', { provider: familyLabel(t, provider.family) })}
                    onClick={() => {
                      abandonAttempt()
                      setSaved(undefined)
                      setAdding(false)
                      setEditing(open ? undefined : provider.family)
                    }}
                  >
                    {t('edit')}
                  </button>
                  <button
                    type="button"
                    className={styles.dangerButton}
                    aria-label={t('removeProvider', { provider: familyLabel(t, provider.family) })}
                    disabled={!writable}
                    onClick={() => {
                      setSaved(undefined)
                      setDeleteFailure(undefined)
                      setDeleteTarget(family)
                    }}
                  >
                    {t('remove')}
                  </button>
                </span>
              </div>
              {open ? (
                <ProviderEditor
                  family={family}
                  provider={provider}
                  t={t}
                  rpc={props.rpc}
                  readOnly={!writable}
                  attempt={activeAttempt}
                  promptValue={promptValue}
                  onPromptValue={setPromptValue}
                  onSignIn={() => { void startLogin(provider.family) }}
                  onCancelLogin={cancelLogin}
                  onSubmitPrompt={submitPrompt}
                  onClose={(changed) => { closeEditor(changed, family) }}
                />
              ) : null}
            </li>
          )
        })}
      </ul>
      <div className={styles.addBlock}>
        {adding && addFamily !== undefined ? (
          <div className={styles.addCard}>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>{t('provider')}</span>
              <select
                className={`${styles.input} ${styles.selectInput}`}
                value={addFamily.family}
                aria-label={t('provider')}
                data-testid="oauth-provider-select"
                onChange={(event) => {
                  const next = familyById(event.target.value)
                  if (next !== undefined) {
                    abandonAttempt()
                    setAddFamily(next)
                  }
                }}
              >
                {addable.map((family) => (
                  <option key={family.family} value={family.family}>{familyLabel(t, family.family)}</option>
                ))}
              </select>
            </div>
            <ProviderEditor
              key={addFamily.family}
              family={addFamily}
              hideTitle
              provider={listed.find((row) => row.family === addFamily.family)}
              t={t}
              rpc={props.rpc}
              readOnly={!writable}
              attempt={activeAttempt}
              promptValue={promptValue}
              onPromptValue={setPromptValue}
              onSignIn={() => { void startLogin(addFamily.family) }}
              onCancelLogin={cancelLogin}
              onSubmitPrompt={submitPrompt}
              onClose={(changed) => { closeEditor(changed, addFamily) }}
            />
          </div>
        ) : (
          <div className={styles.addActions}>
            <button
              type="button"
              className={styles.addButton}
              disabled={addable.length === 0 || !writable}
              data-testid="oauth-add-provider"
              onClick={() => {
                const first = addable[0]
                if (first === undefined) return
                abandonAttempt()
                setSaved(undefined)
                setEditing(undefined)
                setAdding(true)
                setAddFamily(first)
              }}
            >
              <IconPlusOutline16 size={14} />
              {t('add')}
            </button>
          </div>
        )}
      </div>
      <Modal
        open={deleteTarget !== undefined}
        onClose={() => { setDeleteTarget(undefined) }}
        title={deleteTarget === undefined ? '' : t('deleteTitle', { provider: familyLabel(t, deleteTarget.family) })}
        closeLabel={t('close')}
        description={deleteTarget === undefined ? '' : t('deleteDescription', { provider: familyLabel(t, deleteTarget.family) })}
        className={styles.deleteDialog}
        footer={(
          <>
            <Button variant="outline" autoFocus disabled={deleting} onClick={() => { setDeleteTarget(undefined) }}>
              {t('cancel')}
            </Button>
            <Button
              variant="outline"
              className={styles.deleteConfirm}
              disabled={deleting}
              data-testid="oauth-delete-confirm"
              onClick={() => {
                if (deleteTarget === undefined) return
                setDeleting(true)
                void api.removeProvider(deleteTarget.family).then((next) => {
                  setState(next)
                  setDeleteTarget(undefined)
                  setEditing(undefined)
                }).catch((caught) => {
                  setDeleteFailure(errorText(caught, t))
                }).finally(() => {
                  setDeleting(false)
                })
              }}
            >
              {deleteTarget === undefined ? '' : t(deleting ? 'deleting' : 'deleteConfirm', { provider: familyLabel(t, deleteTarget.family) })}
            </Button>
          </>
        )}
      >
        {deleteFailure === undefined ? null : <p className={styles.error}>{deleteFailure}</p>}
      </Modal>
    </section>
  )
}

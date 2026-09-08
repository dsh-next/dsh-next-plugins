/**
 * One subscription editor card: Sign in in place of the API-key field, then
 * the stock Customized settings fold and Cancel / Apply footer.
 */
import * as React from 'react'
import { validateModels } from '../core/capacity.ts'
import type { Family } from '../core/catalog.ts'
import type { AttemptView, ProviderState } from '../core/types.ts'
import { ClientRpcError, type RpcCall, subscriptionsApi } from './api.ts'
import { resolveTranslate, type MessageKey } from './dictionaries.ts'
import { ModelListEditor, type EditorModel } from './ModelListEditor.tsx'
import styles from './footer.module.css'

export type Translate = (key: MessageKey, params?: Record<string, string | number>) => string

export interface ProviderEditorProps {
  family: Family
  hideTitle?: boolean
  provider?: ProviderState
  t: Translate
  rpc: RpcCall
  readOnly: boolean
  attempt?: AttemptView
  promptValue: string
  onPromptValue: (value: string) => void
  onSignIn: () => void
  onCancelLogin: () => void
  onSubmitPrompt: () => void
  onClose: (changed: boolean) => void
}

function draftsOf(rows: readonly { id: string; name: string; contextWindow?: number; maxTokens?: number }[]): EditorModel[] {
  return rows.map((row) => ({
    id: row.id,
    ...row.name === row.id ? {} : { name: row.name },
    ...row.contextWindow === undefined ? {} : { contextWindow: row.contextWindow },
    ...row.maxTokens === undefined ? {} : { maxTokens: row.maxTokens },
  }))
}

export function ProviderEditor(props: ProviderEditorProps): React.ReactElement {
  const t = resolveTranslate(props.t)
  const api = React.useMemo(() => subscriptionsApi(props.rpc), [props.rpc])
  const inherited = React.useMemo(() => draftsOf(props.provider?.defaultModels ?? []), [props.provider?.defaultModels])
  const [overridden, setOverridden] = React.useState(props.provider?.modelsOverridden === true)
  const [models, setModels] = React.useState<EditorModel[]>(
    props.provider?.modelsOverridden === true ? draftsOf(props.provider.models) : inherited,
  )
  const [busy, setBusy] = React.useState(false)
  const [failure, setFailure] = React.useState<string | undefined>()

  React.useEffect(() => {
    if (!overridden) setModels(inherited)
  }, [inherited, overridden])

  const connected = props.provider?.status === 'connected'
  const connecting = props.attempt?.status === 'running' || props.provider?.status === 'connecting'
  const modelFailure = overridden ? validateModels(models) : undefined
  const disabled = props.readOnly || busy

  const apply = async (): Promise<void> => {
    if (modelFailure !== undefined) return
    setBusy(true)
    setFailure(undefined)
    try {
      await api.addProvider(props.family.family)
      if (overridden && models.length > 0) await api.setModels(props.family.alias, models)
      else if (overridden || props.provider?.modelsOverridden === true) await api.restoreModels(props.family.alias)
      props.onClose(true)
    } catch (error) {
      setFailure(error instanceof ClientRpcError ? t(`error.${error.code}` as MessageKey, error.params) : t('error.unknown'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.editor}>
      {props.hideTitle === true ? null : (
        <div className={styles.editorHeader}>
          <span className={styles.editorTitle}>{props.provider?.displayName ?? props.family.displayName}</span>
          <span className={styles.editorRoute}>{props.family.alias}</span>
        </div>
      )}
      <div className={styles.field}>
        <span className={styles.fieldLabel}>{t('signIn')}</span>
        {connecting && props.attempt !== undefined ? (
          <AttemptBody
            attempt={props.attempt}
            t={t}
            promptValue={props.promptValue}
            onPromptValue={props.onPromptValue}
            onSubmit={props.onSubmitPrompt}
            onCancel={props.onCancelLogin}
          />
        ) : (
          <div className={styles.signInRow}>
            {connected ? <span>{props.provider?.accountLabel ?? t('signedIn')}</span> : null}
            <button
              type="button"
              className={styles.secondaryButton}
              disabled={disabled}
              onClick={props.onSignIn}
              data-testid={connected ? 'oauth-reconnect' : 'oauth-sign-in'}
            >
              {connected ? t('reconnect') : t('signIn')}
            </button>
          </div>
        )}
      </div>
      <details className={styles.customized}>
        <summary className={styles.customizedSummary}>{t('customized')}</summary>
        <div className={styles.customizedBody}>
          <ModelListEditor
            family={props.family.family}
            models={overridden ? models : inherited}
            defaults={inherited}
            overridden={overridden}
            rpc={props.rpc}
            t={t}
            disabled={disabled}
            signedIn={connected}
            onChange={(next) => {
              setOverridden(true)
              setModels(next)
            }}
            onReset={() => {
              setOverridden(false)
              setModels(inherited)
            }}
          />
        </div>
      </details>
      {modelFailure === undefined ? null : (
        <p className={styles.error}>{`${t('model')} ${String(modelFailure.index + 1)}: ${t(modelFailure.key)}`}</p>
      )}
      {failure === undefined ? null : <p className={styles.error}>{failure}</p>}
      <div className={styles.editorActions}>
        <button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => { props.onClose(false) }}>
          {t('cancel')}
        </button>
        <button
          type="button"
          className={styles.primaryButton}
          disabled={disabled || modelFailure !== undefined}
          onClick={() => { void apply() }}
          data-testid="oauth-apply"
        >
          {busy ? t('applying') : t('apply')}
        </button>
      </div>
    </div>
  )
}

function AttemptBody(props: {
  attempt: AttemptView
  t: Translate
  promptValue: string
  onPromptValue: (value: string) => void
  onSubmit: () => void
  onCancel: () => void
}): React.ReactElement {
  const notice = props.attempt.notice
  const prompt = props.attempt.prompt
  const message = notice?.message
    ?? (notice?.code !== undefined ? props.t('attempt.device') : notice?.url !== undefined ? props.t('attempt.browser') : props.t('attempt.waiting'))
  return (
    <div className={styles.attemptStack} data-testid="oauth-attempt">
      {notice?.code === undefined ? null : <p className={styles.code}>{notice.code}</p>}
      <p className={styles.attemptMessage}>{message}</p>
      {notice?.url === undefined ? null : (
        <a className={styles.linkButton} href={notice.url} target="_blank" rel="noopener noreferrer">{props.t('openPage')}</a>
      )}
      {prompt === undefined ? null : (
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={`oauth-prompt-${prompt.id}`}>{prompt.message}</label>
          {prompt.kind === 'select' ? (
            <select
              id={`oauth-prompt-${prompt.id}`}
              className={`${styles.input} ${styles.selectInput}`}
              value={props.promptValue}
              onChange={(event) => { props.onPromptValue(event.target.value) }}
            >
              <option value=""></option>
              {(prompt.options ?? []).map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
          ) : (
            <input
              id={`oauth-prompt-${prompt.id}`}
              className={styles.input}
              type={prompt.kind === 'secret' ? 'password' : 'text'}
              value={props.promptValue}
              placeholder={prompt.placeholder ?? props.t('attempt.placeholder')}
              onChange={(event) => { props.onPromptValue(event.target.value) }}
            />
          )}
          <button type="button" className={styles.primaryButton} onClick={props.onSubmit} data-testid="oauth-submit-prompt">
            {props.t('submit')}
          </button>
        </div>
      )}
      <button type="button" className={styles.secondaryButton} onClick={props.onCancel} data-testid="oauth-cancel">
        {props.t('cancel')}
      </button>
    </div>
  )
}

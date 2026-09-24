/**
 * The native provider card's adapter extension: the subscription controls for
 * one declared family. The stock Models page renders the row, the status dot,
 * Edit, and Delete; this seat adds sign-in, account state, and the model
 * catalog editor.
 *
 * The seat's editor stays collapsed until the row is expanded, and Cancel or
 * Apply collapses it again: on a configured row the card is a disclosure, not
 * an always-open form.
 */
import * as React from 'react'
import type { ProviderCardExtrasOwnerProps } from '@deepseek-ai/dsh-client-ui-settings-models/client'
import { familyByAlias } from '../core/catalog.ts'
import type { PluginState } from '../core/types.ts'
import { type RpcCall, subscriptionsApi } from './api.ts'
import { errorText } from './error-text.ts'
import { onInvalidate } from './invalidate.ts'
import { resolveTranslate } from './dictionaries.ts'
import { SubscriptionPanel } from './SubscriptionPanel.tsx'
import type { Translate } from './ProviderEditor.tsx'
import styles from './footer.module.css'

export interface SubscriptionCardProps extends ProviderCardExtrasOwnerProps {
  rpc: RpcCall
  t: Translate
}

export function SubscriptionCard(props: SubscriptionCardProps): React.ReactElement | null {
  const { rpc } = props
  const t = React.useMemo(() => resolveTranslate(props.t), [props.t])
  const api = React.useMemo(() => subscriptionsApi(rpc), [rpc])
  const [state, setState] = React.useState<PluginState | undefined>()
  const [error, setError] = React.useState<string | undefined>()
  const [busy, setBusy] = React.useState(false)
  const [open, setOpen] = React.useState(false)
  const [saved, setSaved] = React.useState(false)
  const mounted = React.useRef(false)
  const family = familyByAlias(props.provider.provider)

  const load = React.useCallback(async (): Promise<void> => {
    try {
      const next = await api.getState()
      if (!mounted.current) return
      setState(next)
      setError(undefined)
    } catch (caught) {
      if (mounted.current) setError(errorText(caught, t))
    }
  }, [api, t])

  React.useEffect(() => {
    mounted.current = true
    void load()
    return () => { mounted.current = false }
  }, [load])

  // A config write (ours or another surface's) lands after this card mounted.
  React.useEffect(() => onInvalidate(() => { void load() }), [load])

  if (family === undefined) return null

  const row = state?.providers.find((candidate) => candidate.alias === family.alias)
  const connected = row?.status === 'connected'

  const signOut = async (): Promise<void> => {
    setBusy(true)
    try {
      const next = await api.disconnect(family.family)
      if (!mounted.current) return
      setState(next)
      setError(undefined)
    } catch (caught) {
      if (mounted.current) setError(errorText(caught, t))
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  return (
    <div className={styles.rowCard} data-testid={`dsh-next-oauth-providers-card-${family.family}`}>
      <div className={styles.rowHead}>
        <span className={styles.rowIdentity}>
          <button
            type="button"
            className={styles.cardSummary}
            aria-expanded={open}
            onClick={() => {
              setSaved(false)
              setOpen((current) => !current)
            }}
            data-testid="oauth-card-toggle"
          >
            <span className={styles.rowName}>{t(`family.${family.family}` as Parameters<Translate>[0])}</span>
          </button>
          <span
            className={`${styles.credentialDot} ${connected ? styles.credentialDotConfigured : styles.credentialDotMissing}`}
            role="img"
            aria-label={connected ? t('credentialConfigured') : t('credentialMissing')}
            title={connected ? t('credentialConfigured') : t('credentialMissing')}
          />
        </span>
        <span className={styles.rowActions}>
          {connected ? (
            <button
              type="button"
              className={styles.secondaryButton}
              disabled={busy || state?.writable === false}
              onClick={() => { void signOut() }}
              data-testid="oauth-sign-out"
            >
              {t('signOut')}
            </button>
          ) : null}
        </span>
      </div>
      <p className={styles.intro}>
        {connected
          ? row?.accountLabel ?? t('signedIn')
          : state === undefined ? t('statusLoading') : t('statusDisconnected')}
      </p>
      {saved ? (
        <p className={styles.savedNotice} role="status">
          {t('savedProvider', { provider: t(`family.${family.family}` as Parameters<Translate>[0]) })}
        </p>
      ) : null}
      {error === undefined ? null : <p className={styles.error} role="alert">{error}</p>}
      {open ? (
        <SubscriptionPanel
          family={family}
          provider={row}
          rpc={rpc}
          t={t}
          readOnly={state?.writable === false}
          onChanged={(changed) => {
            // Cancel and Apply both close the editor; Apply also announces the
            // save, because the editor that showed it is gone.
            setOpen(false)
            setSaved(changed)
            if (changed) void load()
          }}
        />
      ) : null}
    </div>
  )
}

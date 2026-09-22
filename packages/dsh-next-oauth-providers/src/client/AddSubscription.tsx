/**
 * Models footer: the one entry point for adding a subscription. Configured
 * families live on their native provider rows, so this seat renders only the
 * Add control (and says so once every family is configured).
 */
import * as React from 'react'
import { IconPlusOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { FAMILIES, familyById, type Family } from '../core/catalog.ts'
import type { PluginState } from '../core/types.ts'
import { type RpcCall, subscriptionsApi } from './api.ts'
import { errorText } from './error-text.ts'
import { onInvalidate } from './invalidate.ts'
import { SubscriptionPanel } from './SubscriptionPanel.tsx'
import { resolveTranslate } from './dictionaries.ts'
import type { Translate } from './ProviderEditor.tsx'
import styles from './footer.module.css'

export interface AddSubscriptionProps {
  rpc: RpcCall
  t: Translate
}

export function AddSubscription(props: AddSubscriptionProps): React.ReactElement {
  const { rpc } = props
  const t = React.useMemo(() => resolveTranslate(props.t), [props.t])
  const api = React.useMemo(() => subscriptionsApi(rpc), [rpc])
  const [state, setState] = React.useState<PluginState | undefined>()
  const [error, setError] = React.useState<string | undefined>()
  const [adding, setAdding] = React.useState(false)
  const [family, setFamily] = React.useState<Family | undefined>()
  const mounted = React.useRef(false)

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

  React.useEffect(() => onInvalidate(() => { void load() }), [load])

  const listed = (state?.providers ?? []).filter((row) => row.listed)
  const addable = FAMILIES.filter((candidate) => !listed.some((row) => row.family === candidate.family))
  const listedFamilies = listed.map((row) => row.family).join(',')

  // A family added from another surface (or another tab) leaves the draft.
  React.useEffect(() => {
    if (!adding || family === undefined) return
    if (!listedFamilies.split(',').includes(family.family)) return
    setAdding(false)
    setFamily(undefined)
  }, [adding, family, listedFamilies])

  const writable = state?.writable !== false

  return (
    <section className={styles.section} data-testid="dsh-next-oauth-providers" aria-label={t('a11y.section')}>
      <h3 className={styles.title}>{t('title')}</h3>
      <p className={styles.intro}>{t('intro')}</p>
      {error === undefined ? null : <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.addBlock}>
        {adding && family !== undefined ? (
          <div className={styles.addCard}>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>{t('provider')}</span>
              <select
                className={`${styles.input} ${styles.selectInput}`}
                value={family.family}
                aria-label={t('provider')}
                data-testid="oauth-provider-select"
                onChange={(event) => {
                  const next = familyById(event.target.value)
                  if (next !== undefined) setFamily(next)
                }}
              >
                {addable.map((candidate) => (
                  <option key={candidate.family} value={candidate.family}>
                    {t(`family.${candidate.family}` as Parameters<Translate>[0])}
                  </option>
                ))}
              </select>
            </div>
            <SubscriptionPanel
              key={family.family}
              family={family}
              rpc={rpc}
              t={t}
              readOnly={!writable}
              onChanged={(changed) => {
                if (changed) {
                  setAdding(false)
                  setFamily(undefined)
                }
                void load()
              }}
            />
          </div>
        ) : (
          <div className={styles.addActions}>
            <button
              type="button"
              className={styles.addButton}
              disabled={state === undefined || addable.length === 0 || !writable}
              data-testid="oauth-add-provider"
              onClick={() => {
                const first = addable[0]
                if (first === undefined) return
                setAdding(true)
                setFamily(first)
              }}
            >
              <IconPlusOutlineRegular size={14} />
              {t('add')}
            </button>
            {state !== undefined && addable.length === 0 ? (
              <p className={styles.intro}>{t('allConfigured')}</p>
            ) : null}
          </div>
        )}
      </div>
    </section>
  )
}

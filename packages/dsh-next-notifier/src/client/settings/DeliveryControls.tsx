import * as React from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { webPermission } from '../drainer.ts'
import type { Translate } from '../dictionaries.ts'
import styles from '../card.module.css'

export interface DeliveryControlsProps {
  t: Translate
  reportPermission: () => void
  testSystem: () => Promise<boolean>
  testToast: () => void
}

/** Permission is a client capability, separate from the saved event preferences. */
export function DeliveryControls({ t, reportPermission, testSystem, testToast }: DeliveryControlsProps): React.ReactElement {
  const [permission, setPermission] = React.useState(webPermission)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState(false)
  const owner = React.useRef<{ active: boolean; busy: boolean } | null>(null)
  React.useEffect(() => {
    const life = { active: true, busy: false }
    owner.current = life
    setBusy(false)
    const refresh = () => { setPermission(webPermission()); reportPermission() }
    window.addEventListener('focus', refresh)
    return () => { life.active = false; window.removeEventListener('focus', refresh) }
  }, [reportPermission])
  async function act(): Promise<void> {
    const life = owner.current
    if (!life?.active || life.busy) return
    life.busy = true
    setBusy(true)
    setError(false)
    try {
      if (webPermission() !== 'granted') {
        const result = await Notification.requestPermission()
        if (!life.active) return
        setPermission(result)
        reportPermission()
      } else {
        const shown = await testSystem()
        if (life.active) setError(!shown)
      }
    } catch { if (life.active) setError(true) }
    finally { life.busy = false; if (life.active) setBusy(false) }
  }
  return <section className={styles.group} aria-label={t('delivery.title')}>
    <div className={styles.row}><span className={styles.text}>
      <span className={styles.label}>{t('web.test')}</span>
      <span className={styles.hint}>{t(`web.hint.${permission}`)}</span></span>
      <Button size="sm" variant="outline" disabled={busy || permission === 'denied' || permission === 'unsupported'}
        onClick={() => { void act() }}>{t(permission === 'granted' ? 'web.button.test' : 'web.button.enable')}</Button>
    </div>
    <div className={styles.row}><span className={styles.text}>
      <span className={styles.label}>{t('toast.test')}</span>
      <span className={styles.hint}>{t('toast.test.hint')}</span></span>
      <Button size="sm" variant="outline" onClick={testToast}>{t('toast.button.test')}</Button></div>
    {error && <p role="alert" className={styles.error}>{t('delivery.failed')}</p>}
  </section>
}

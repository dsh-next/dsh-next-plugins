import * as React from 'react'
import { Button, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConfigPageForm } from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { englishTranslate, type Translate } from './dictionaries.ts'
import { useSettings } from './settings/use-settings.ts'
import { EventGroup } from './settings/EventGroup.tsx'
import { DeliveryControls, type DeliveryControlsProps } from './settings/DeliveryControls.tsx'
import styles from './card.module.css'

export type { Translate } from './dictionaries.ts'
export interface CardDeps extends Omit<DeliveryControlsProps, 't'> {
  form?: ConfigPageForm
  t?: Translate
  preview: (id: string, volume: number) => Promise<boolean>
}

/** Subscribe to the host-owned form directly on the installed bundle page. */
export function NotifierSettings({ form, ...props }: Omit<CardDeps, 'form'> & {
  form: ConfigForm<Record<string, unknown>>
}): React.ReactElement {
  const subscribe = React.useCallback((listener: () => void) => form.subscribe(listener), [form])
  const snapshot = React.useCallback(() => form.getSnapshot(), [form])
  const state = React.useSyncExternalStore(subscribe, snapshot, snapshot)
  const mutate = React.useCallback<ConfigPageForm['mutate']>((ops, revision) => form.mutate(ops, revision), [form])
  return <NotifierCard {...props} form={{ state, mutate }} />
}

/** The shell owns title/navigation; this page owns automatic preferences and client tests. */
export function NotifierCard({ form, t = englishTranslate, preview, ...delivery }: CardDeps): React.ReactElement {
  const editor = useSettings(form)
  const { config, disabled } = editor
  const [audioFailed, setAudioFailed] = React.useState(false)
  const owner = React.useRef<{ active: boolean; revision: number } | null>(null)
  React.useEffect(() => {
    const life = { active: true, revision: 0 }
    owner.current = life
    return () => { life.active = false }
  }, [])
  function previewSound(id: string, volume: number): void {
    const life = owner.current
    if (!life?.active) return
    const revision = ++life.revision
    setAudioFailed(false)
    void preview(id, volume).then(ok => {
      if (life.active && revision === life.revision) setAudioFailed(!ok)
    }, () => { if (life.active && revision === life.revision) setAudioFailed(true) })
  }
  return <div className={styles.page} data-testid="dsh-next-notifier-settings">
    {!editor.available ? <p className={styles.hint}>{t(form?.state.status === 'loading' ? 'settings.loading' : 'settings.unavailable')}</p> : <div>
      {!editor.writable && <p className={styles.hint}>{t('settings.readOnly')}</p>}
      <div className={styles.row}><span className={styles.text}>
        <span className={styles.label}>{t('toggle.enable')}</span><span className={styles.hint}>{t('toggle.enable.hint')}</span></span>
        <Switch label={t('toggle.enable')} checked={config.enabled} disabled={disabled}
          onChange={value => editor.edit(['enabled'], value)} /></div>
      <div className={styles.row}><span className={styles.text}>
        <span className={styles.label}>{t('toggle.muteViewing')}</span><span className={styles.hint}>{t('toggle.muteViewing.hint')}</span></span>
        <Switch label={t('toggle.muteViewing')} checked={config.suppressFocused} disabled={disabled || !config.enabled}
          onChange={value => editor.edit(['suppressFocused'], value)} /></div>
      <div className={styles.row}><span className={styles.text}>
        <label className={styles.label} htmlFor="notifier-volume">{t('volume.label')}</label>
        <span className={styles.hint}>{t('volume.hint')}</span></span>
        <input id="notifier-volume" type="range" className={styles.range} min={0} max={100} step={1}
          value={config.volume} disabled={disabled || !config.enabled}
          onChange={event => editor.edit(['volume'], Number(event.target.value))} />
        <span className={styles.hint}>{t('volume.value', { count: config.volume })}</span></div>
      {(['finished', 'approval', 'question'] as const).map(group =>
        <EventGroup key={group} group={group} editor={editor} t={t} preview={previewSound} />)}
      {audioFailed && <p role="alert" className={styles.error}>{t('sound.failed')}</p>}
      <div className={styles.actions}><Button size="sm" variant="ghost" disabled={disabled} onClick={editor.reset}>
        {t('settings.reset')}</Button></div>
      <p role={editor.failed ? 'alert' : 'status'} className={editor.failed ? styles.error : styles.hint}>
        {t(editor.failed ? 'settings.saveFailed' : editor.saving ? 'settings.saving' : 'settings.automatic')}
      </p>
    </div>}
    <DeliveryControls {...delivery} t={t} />
  </div>
}

import * as React from 'react'
import { Button, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { SOUNDS } from '../../core/sounds.ts'
import type { Translate, MessageKey } from '../dictionaries.ts'
import type { GroupKey, SettingsEditor } from './use-settings.ts'
import styles from '../card.module.css'

/** Event-owned controls; sound previews never trigger another settings write. */
export function EventGroup({ group, editor, t, preview }: {
  group: GroupKey; editor: SettingsEditor; t: Translate; preview: (id: string, volume: number) => void
}): React.ReactElement {
  const config = editor.config[group]
  const disabled = editor.disabled || !editor.config.enabled
  const nestedDisabled = disabled || !config.enabled
  const id = React.useId()
  return <section className={styles.group} aria-label={t(`group.${group}.title`)}>
    <div className={styles.row}>
      <div className={styles.text}><span className={styles.label}>{t(`group.${group}.title`)}</span>
        <span className={styles.hint}>{t(`group.${group}.hint`)}</span></div>
      <Switch label={t(`group.${group}.title`)} checked={config.enabled} disabled={disabled}
        onChange={value => editor.edit([group, 'enabled'], value)} />
    </div>
    <div className={styles.sub}>
      {group === 'finished' && <>
        <div className={styles.row}><span className={styles.text}>
          <span className={styles.label}>{t('group.finished.subagent')}</span>
          <span className={styles.hint}>{t('group.finished.subagent.hint')}</span></span>
          <Switch label={t('group.finished.subagent')} checked={config.subagent} disabled={nestedDisabled}
            onChange={value => editor.edit([group, 'subagent'], value)} /></div>
        <div className={styles.row}><span className={styles.text}>
          <span className={styles.label}>{t('group.finished.goalOnly')}</span>
          <span className={styles.hint}>{t('group.finished.goalOnly.hint')}</span></span>
          <Switch label={t('group.finished.goalOnly')} checked={config.goalOnly} disabled={nestedDisabled}
            onChange={value => editor.edit([group, 'goalOnly'], value)} /></div>
      </>}
      <div className={styles.row}><span className={styles.label}>{t('group.playSound')}</span>
        <Switch label={t('group.playSound')} checked={config.sound} disabled={nestedDisabled}
          onChange={value => editor.edit([group, 'sound'], value)} /></div>
      <div className={styles.row}>
        <label className={styles.label} htmlFor={id}>{t('group.sound')}</label>
        <select id={id} className={styles.select} value={config.soundName} disabled={nestedDisabled || !config.sound}
          onChange={event => editor.edit([group, 'soundName'], event.target.value)}>
          {SOUNDS.map(sound => <option key={sound.id} value={sound.id}>{t(`sound.${sound.id}` as MessageKey)}</option>)}
        </select>
        <Button size="sm" variant="outline" disabled={nestedDisabled || !config.sound || editor.config.volume === 0}
          onClick={() => preview(config.soundName, editor.config.volume)}>{t('sound.preview')}</Button>
      </div>
    </div>
  </section>
}

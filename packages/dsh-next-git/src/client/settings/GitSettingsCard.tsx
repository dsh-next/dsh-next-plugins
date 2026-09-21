import * as React from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { GitApi } from '../api.ts'
import type { Translate } from '../GitPanel.tsx'
import styles from './settings.module.css'

interface DraftingConfig { draftingProvider: string; draftingModel: string; draftingInstructions: string }
interface ModelOption { provider: string; model: string; label?: string }
const keyOf = (provider: string, model: string): string => provider || model ? JSON.stringify([provider, model]) : ''

/** Bundle configuration body; the Plugins page owns its title and navigation. */
export function GitSettingsCard({ api, t }: { api: GitApi; t: Translate }): React.ReactElement {
  const [config, setConfig] = React.useState<DraftingConfig | null>(null)
  const [instructions, setInstructions] = React.useState('')
  const [models, setModels] = React.useState<ModelOption[]>([])
  const [error, setError] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [revision, setRevision] = React.useState(0)
  const active = React.useRef(false)
  const saving = React.useRef(false)
  React.useEffect(() => {
    let alive = true
    active.current = true
    setConfig(null); setError(false)
    Promise.all([api.call<DraftingConfig>('getConfig', {}), api.call<{ models: ModelOption[] }>('draftingModelCatalog', {})])
      .then(([next, catalog]) => { if (alive) { setConfig(next); setInstructions(next.draftingInstructions ?? ''); setModels(catalog.models) } })
      .catch(() => { if (alive) setError(true) })
    return () => { alive = false; active.current = false }
  }, [api, revision])
  const selected = config ? keyOf(config.draftingProvider, config.draftingModel) : ''
  const missing = selected !== '' && !models.some(model => keyOf(model.provider, model.model) === selected)
  async function save(patch: Partial<DraftingConfig>): Promise<void> {
    if (!config || saving.current) return
    saving.current = true; setBusy(true); setError(false)
    try {
      const next = await api.call<DraftingConfig>('setConfig', patch)
      if (active.current) {
        setConfig(next)
        if (patch.draftingInstructions !== undefined) setInstructions(next.draftingInstructions)
      }
    } catch { if (active.current) setError(true) }
    finally { saving.current = false; if (active.current) setBusy(false) }
  }
  function update(value: string): void {
    const model = models.find(item => keyOf(item.provider, item.model) === value)
    if (value !== '' && !model) return
    void save({ draftingProvider: model?.provider ?? '', draftingModel: model?.model ?? '' })
  }
  return <section className={styles.body} data-dsh-git="settings-card" aria-label={t('settings.description')}>
      <label className={styles.row}><span className={styles.heading}><span>{t('settings.model')}</span><span className={styles.hint}>{t('settings.modelHint')}</span></span>
        <select value={selected} disabled={!config || busy} onChange={event => { void update(event.target.value) }}>
          <option value="">{t('settings.defaultModel')}</option>
          {missing && <option value={selected} disabled>{config?.draftingProvider} / {config?.draftingModel}</option>}
          {models.map(model => <option key={keyOf(model.provider, model.model)} value={keyOf(model.provider, model.model)}>{model.label ?? `${model.provider} / ${model.model}`}</option>)}
        </select>
      </label>
      <label className={styles.instructions}>
        <span>{t('settings.instructions')}</span>
        <span className={styles.hint}>{t('settings.instructionsHint')}</span>
        <textarea rows={4} maxLength={4000} value={instructions} disabled={!config || busy}
          placeholder={t('settings.instructionsPlaceholder')} onChange={event => setInstructions(event.target.value)} />
      </label>
      <div className={styles.actions}><Button size="sm" variant="primary"
        disabled={!config || busy || instructions.trim() === (config.draftingInstructions ?? '')}
        onClick={() => { void save({ draftingInstructions: instructions }) }}>{t('settings.save')}</Button></div>
      {!config && !error && <p className={styles.hint} role="status">{t('settings.loading')}</p>}
      {busy && <p className={styles.hint} role="status">{t('settings.saving')}</p>}
      {error && <p className={styles.error} role="alert">{t('settings.error')} {!config && <button type="button" onClick={() => setRevision(value => value + 1)}>{t('settings.retry')}</button>}</p>}
  </section>
}

import * as React from 'react'
import { IconChevronDownOutlineRegular, IconPlusOutlineRegular, IconTrashOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { formatContextCapacity, parseContextCapacity } from '../../core/model-capacity.ts'
import { DEFAULT_BASE_URL, DecisionError, type DecisionModel, type ProviderChange, type ProviderView } from '../../core/types.ts'
import { parseProvider } from '../../core/validation.ts'
import type { Translate } from '../dictionaries.ts'
import styles from './providers.module.css'

interface ModelRowDraft { key: number; id: string; name: string; context: string }
const draftOf = (model: DecisionModel, key: number): ModelRowDraft => ({ key, id: model.id, name: model.name ?? '', context: formatContextCapacity(model.contextWindow) })

export interface ProviderEditorSeed { id: string; name: string; baseUrl: string }

export function ProviderEditor({ provider, seed, fixedConnection = false, hideTitle = false, revision, busy, t, onSave, onCancel, onDirtyChange, extraDirty }: {
  provider?: ProviderView; seed?: ProviderEditorSeed; fixedConnection?: boolean; hideTitle?: boolean; revision: string; busy: boolean; t: Translate
  onSave(value: ProviderChange): void; onCancel(): void
  onDirtyChange?(dirty: boolean): void; extraDirty?(): boolean
}): React.ReactElement {
  const initial = provider ?? seed ?? { id: '', name: '', baseUrl: DEFAULT_BASE_URL }
  const [id, setId] = React.useState(initial.id)
  const [name, setName] = React.useState(initial.name)
  const [baseUrl, setBaseUrl] = React.useState(initial.baseUrl)
  const originalModels = provider?.models ?? [{ id: '' }]
  const [models, setModels] = React.useState<ModelRowDraft[]>(() => originalModels.map(draftOf))
  const [expandedRows, setExpandedRows] = React.useState<Set<number>>(() => new Set(provider ? [] : [0]))
  const nextRowKey = React.useRef(originalModels.length)
  const inputRefs = React.useRef(new Map<number, HTMLInputElement>())
  const focusNewRow = React.useRef<number | null>(null)
  const [apiKey, setApiKey] = React.useState('')
  const [clearKey, setClearKey] = React.useState(false)
  const [error, setError] = React.useState<string>()
  const formId = React.useId()
  const modelsChanged = models.length !== originalModels.length || models.some((row, index) =>
    row.id !== originalModels[index]?.id || row.name !== (originalModels[index]?.name ?? '') || row.context !== formatContextCapacity(originalModels[index]?.contextWindow))
  const patchModel = (key: number, changes: Partial<ModelRowDraft>) => {
    setModels(current => current.map(row => row.key === key ? { ...row, ...changes } : row))
    setError(undefined)
  }
  const toggleModel = (key: number) => setExpandedRows(current => {
    const next = new Set(current)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })
  const dirty = id !== initial.id || name !== initial.name || baseUrl !== initial.baseUrl || modelsChanged || Boolean(apiKey || clearKey)
  const cancel = () => { if ((!dirty && !extraDirty?.()) || window.confirm(t('discard'))) onCancel() }
  React.useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])
  React.useEffect(() => {
    const row = focusNewRow.current
    if (row !== null) { inputRefs.current.get(row)?.focus(); focusNewRow.current = null }
  }, [models])
  React.useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  return <form className={styles.editor} data-testid="decision-provider-editor" onSubmit={event => {
    event.preventDefault()
    if (busy) return
    setError(undefined)
    try {
      if (fixedConnection && !provider && !apiKey.trim()) {
        setError(t('error.keyRequired'))
        return
      }
      const contexts = models.map(row => parseContextCapacity(row.context))
      if (contexts.some(value => Number.isNaN(value))) {
        setError(t('error.invalid-context'))
        return
      }
      const parsed = parseProvider({ id, name, baseUrl, models: models.map((row, index) => ({
        id: row.id.trim(),
        ...(row.name.trim() ? { name: row.name.trim() } : {}),
        ...(contexts[index] === undefined ? {} : { contextWindow: contexts[index] }),
      })) })
      onSave({ provider: parsed, revision, mode: provider ? 'edit' : 'create', ...(apiKey ? { apiKey } : {}), ...(clearKey ? { clearKey: true } : {}) })
    } catch (caught) { setError(t(`error.${caught instanceof DecisionError ? caught.code : 'failed'}`)) }
  }}>
    {!hideTitle && <h4 className={styles.title}>{t(provider ? 'editTitle' : 'newTitle')}</h4>}
    <p className={styles.protocol}>{t('protocol')}</p>
    <p className={styles.hint}>{t('protocolHint')}</p>
    <fieldset className={styles.fields} disabled={busy}>
      <label className={styles.field} htmlFor={`${formId}-id`}>
        <span>{t('id')}</span>
        <input id={`${formId}-id`} aria-label={t('id')} className={styles.input} value={id} onChange={event => { setId(event.target.value); setError(undefined) }} disabled={Boolean(provider) || fixedConnection} required autoComplete="off" aria-describedby={`${formId}-id-hint`} />
        <span className={styles.hint} id={`${formId}-id-hint`}>{t(fixedConnection ? 'idPresetHint' : 'idHint')}</span>
      </label>
      <label className={styles.field}>
        <span>{t('name')}</span>
        <input className={styles.input} value={name} onChange={event => { setName(event.target.value); setError(undefined) }} required maxLength={120} />
      </label>
      <label className={styles.field} htmlFor={`${formId}-url`}>
        <span>{t('baseUrl')}</span>
        <input id={`${formId}-url`} aria-label={t('baseUrl')} className={styles.input} type="url" value={baseUrl} onChange={event => { setBaseUrl(event.target.value); setError(undefined) }} disabled={fixedConnection} required autoComplete="off" aria-describedby={`${formId}-url-hint`} />
        <span className={styles.hint} id={`${formId}-url-hint`}>{t(fixedConnection ? 'urlPresetHint' : 'urlHint')}</span>
      </label>
      <label className={styles.field} htmlFor={`${formId}-key`}>
        <span>{t('apiKey')}</span>
        <input id={`${formId}-key`} aria-label={t('apiKey')} className={styles.input} type="password" autoComplete="new-password" spellCheck={false} value={apiKey} disabled={clearKey} required={fixedConnection && !provider} onChange={event => { setApiKey(event.target.value); setError(undefined) }} aria-describedby={`${formId}-key-hint`} />
        <span className={styles.hint} id={`${formId}-key-hint`}>{t(fixedConnection ? (provider ? 'keyPresetEditHint' : 'keyPresetHint') : 'keyHint')}</span>
      </label>
      {provider?.keyConfigured && <label className={styles.check}><input type="checkbox" checked={clearKey} onChange={event => { setClearKey(event.target.checked); setApiKey(''); setError(undefined) }} />{t('clearKey')}</label>}
      <div className={styles.field}>
        <span id={`${formId}-models-title`}>{t('models')}</span>
        <p className={styles.hint} id={`${formId}-models-hint`}>{t('modelsHint')}</p>
        {models.length === 0 && <p className={styles.hint}>{t('modelsEmpty')}</p>}
        <ul className={styles.modelRows} aria-labelledby={`${formId}-models-title`}>
          {models.map((row, index) => {
            const isExpanded = expandedRows.has(row.key)
            const detailsId = `${formId}-model-${row.key}-details`
            return <li className={styles.modelEntry} key={row.key}>
              <div className={styles.modelRow}>
                <input
                  ref={element => { if (element) inputRefs.current.set(row.key, element); else inputRefs.current.delete(row.key) }}
                  className={styles.input}
                  aria-label={t('modelId', { index: index + 1 })}
                  aria-describedby={`${formId}-models-hint`}
                  placeholder={t('modelIdPlaceholder')}
                  value={row.id}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={event => patchModel(row.key, { id: event.target.value })}
                />
                <input
                  className={styles.input}
                  aria-label={t('modelName', { index: index + 1 })}
                  placeholder={t('modelNamePlaceholder')}
                  value={row.name}
                  maxLength={120}
                  onChange={event => patchModel(row.key, { name: event.target.value })}
                />
                <button type="button" className={styles.modelToggle} aria-label={t('modelDetails', { index: index + 1 })} aria-expanded={isExpanded} aria-controls={isExpanded ? detailsId : undefined} onClick={() => toggleModel(row.key)}><IconChevronDownOutlineRegular size={16} /></button>
                <button type="button" className={styles.removeModel} aria-label={t('removeModel', { index: index + 1 })} onClick={() => {
                  setModels(current => current.filter(item => item.key !== row.key))
                  setExpandedRows(current => { const next = new Set(current); next.delete(row.key); return next })
                  setError(undefined)
                }}><IconTrashOutlineRegular size={16} /></button>
              </div>
              {isExpanded && <div className={styles.modelAdvanced} id={detailsId}>
                <label className={styles.field}>
                  <span>{t('contextWindow')}</span>
                  <input className={styles.input} aria-label={t('modelContext', { index: index + 1 })} aria-describedby={`${formId}-model-${row.key}-context-hint`} value={row.context} placeholder={t('contextPlaceholder')} inputMode="numeric" spellCheck={false} onChange={event => patchModel(row.key, { context: event.target.value })} />
                </label>
                <label className={styles.field}>
                  <span>{t('outputType')}</span>
                  <input className={styles.input} value={t('outputChoice')} disabled readOnly />
                </label>
                <p className={styles.hint} id={`${formId}-model-${row.key}-context-hint`}>{t('contextHint')}</p>
                <fieldset className={styles.inputTypes} disabled>
                  <legend>{t('inputTypes')}</legend>
                  <label><input type="checkbox" checked readOnly />{t('inputText')}</label>
                  <label><input type="checkbox" checked={false} readOnly />{t('inputImage')}</label>
                </fieldset>
                <p className={styles.hint}>{t('inputHint')}</p>
              </div>}
            </li>
          })}
        </ul>
        <button type="button" className={styles.addModel} disabled={models.length >= 100} onClick={() => {
          const key = nextRowKey.current++
          focusNewRow.current = key
          setModels(current => [...current, { key, id: '', name: '', context: '' }])
          setExpandedRows(current => new Set(current).add(key))
          setError(undefined)
        }}><IconPlusOutlineRegular size={14} />{t('addModel')}</button>
      </div>
    </fieldset>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <div className={styles.actions}>
      <button type="button" className={styles.button} disabled={busy} onClick={cancel}>{t('cancel')}</button>
      <button type="submit" className={styles.primary} disabled={busy}>{t(busy ? 'saving' : 'save')}</button>
    </div>
  </form>
}

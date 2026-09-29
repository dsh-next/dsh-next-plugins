import * as React from 'react'
import { IconPlusOutlineRegular, SegmentedControl } from '@deepseek-ai/dsh-client-ui-primitives'
import { formatContextCapacity } from '../../core/model-capacity.ts'
import { DEFAULT_BASE_URL, DecisionError, type ProviderChange, type ProvidersState, type ProviderView } from '../../core/types.ts'
import type { DecisionApi } from '../api.ts'
import type { Translate } from '../dictionaries.ts'
import { ProviderEditor } from './ProviderEditor.tsx'
import styles from './providers.module.css'

type AddMode = 'known' | 'custom'

export function ProvidersSection({ api, t }: { api: DecisionApi; t: Translate }): React.ReactElement {
  const [state, setState] = React.useState<ProvidersState>()
  const [editing, setEditing] = React.useState<{ provider: ProviderView; revision: string }>()
  const [adding, setAdding] = React.useState(false)
  const [addMode, setAddMode] = React.useState<AddMode>('known')
  const [addDirty, setAddDirty] = React.useState({ known: false, custom: false })
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set())
  const [removing, setRemoving] = React.useState<string>()
  const [error, setError] = React.useState<string>()
  const [notice, setNotice] = React.useState<string>()
  const [busy, setBusy] = React.useState(false)
  const [testingProvider, setTestingProvider] = React.useState<string>()
  const [selected, setSelected] = React.useState<Record<string, string>>({})
  const pending = React.useRef<AbortController>()
  const mounted = React.useRef(false)
  const heading = React.useId()
  const modeId = `${heading}-mode`
  const onKnownDirty = React.useCallback((dirty: boolean) => setAddDirty(current => current.known === dirty ? current : { ...current, known: dirty }), [])
  const onCustomDirty = React.useCallback((dirty: boolean) => setAddDirty(current => current.custom === dirty ? current : { ...current, custom: dirty }), [])
  const run = React.useCallback(async <T,>(work: (signal: AbortSignal) => Promise<T>, accept: (value: T) => void) => {
    pending.current?.abort()
    const controller = new AbortController()
    pending.current = controller
    setBusy(true); setError(undefined); setNotice(undefined)
    try {
      const value = await work(controller.signal)
      if (mounted.current && pending.current === controller && !controller.signal.aborted) accept(value)
    } catch (caught) {
      if (mounted.current && pending.current === controller && !controller.signal.aborted) setError(t(`error.${caught instanceof DecisionError ? caught.code : 'failed'}`))
    } finally {
      if (mounted.current && pending.current === controller) { setBusy(false); setTestingProvider(undefined); pending.current = undefined }
    }
  }, [t])
  const refresh = React.useCallback(() => { void run(signal => api.state(signal), setState) }, [api, run])
  React.useEffect(() => {
    mounted.current = true
    refresh()
    return () => { mounted.current = false; pending.current?.abort(); pending.current = undefined }
  }, [refresh])
  const knownAvailable = !state?.providers.some(provider => provider.id === 'typesafe')
  const locked = busy || Boolean(editing) || adding || Boolean(removing)
  const closeAdd = () => { setAdding(false); setAddDirty({ known: false, custom: false }); setError(undefined) }
  const saveAdd = (change: ProviderChange) => {
    void run(signal => api.save(change, signal), next => { setState(next); closeAdd(); setNotice(t('saved')) })
  }
  const openAdd = () => {
    setAddMode(knownAvailable ? 'known' : 'custom')
    setAddDirty({ known: false, custom: false })
    setAdding(true); setRemoving(undefined); setError(undefined); setNotice(undefined)
  }
  const toggle = (id: string) => setExpanded(current => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  return <section className={styles.section} aria-labelledby={heading} data-testid="dsh-next-decisions">
    <div className={styles.head}>
      <h3 className={styles.title} id={heading}>{t('title')}</h3>
      <button type="button" className={styles.button} disabled={locked} onClick={refresh}>{t('refresh')}</button>
    </div>
    <p className={styles.intro}>{t('intro')}</p>
    {state?.writable === false && <p className={styles.hint}>{t('readOnly')}</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    {!state && busy && <p role="status" className={styles.hint}>{t('loading')}</p>}
    {state?.providers.length === 0 && !adding && <p className={styles.hint}>{t('empty')}</p>}
    {state && <ul className={styles.rows}>
      {state.providers.map(provider => {
        const open = expanded.has(provider.id)
        const isEditing = editing?.provider.id === provider.id
        const isRemoving = removing === provider.id
        const detailsId = `${heading}-details-${provider.id}`
        return <li className={styles.card} key={provider.id} data-testid="decision-provider-card">
          <div className={styles.head}>
            <span className={styles.identity}>
              <strong className={styles.name}>{provider.name}</strong>
              {provider.keyConfigured && <span className={styles.keyDot} role="img" aria-label={t('keyConfigured')} title={t('keyConfigured')} />}
              {!provider.keyConfigured && provider.id === 'typesafe' && provider.baseUrl === DEFAULT_BASE_URL && <span className={styles.keyMissingDot} role="img" aria-label={t('keyMissing')} title={t('keyMissing')} />}
            </span>
            <div className={styles.actions}>
              <button type="button" className={styles.button} aria-label={t('editProvider', { name: provider.name, id: provider.id })} disabled={locked || !state.writable} onClick={() => { setEditing({ provider, revision: state.revision }); setRemoving(undefined); setError(undefined); setNotice(undefined) }}>{t('edit')}</button>
              <button type="button" className={styles.button} aria-label={t('removeProvider', { name: provider.name, id: provider.id })} disabled={locked || !state.writable} onClick={() => { setRemoving(provider.id); setNotice(undefined) }}>{t('remove')}</button>
            </div>
          </div>
          {isEditing ? <ProviderEditor provider={editing.provider} fixedConnection={provider.id === 'typesafe' && provider.baseUrl === DEFAULT_BASE_URL} revision={editing.revision} busy={busy} t={t}
            onCancel={() => { setEditing(undefined); setError(undefined) }}
            onSave={change => { void run(signal => api.save(change, signal), next => { setState(next); setEditing(undefined); setNotice(t('saved')); setExpanded(current => { const rest = new Set(current); rest.delete(provider.id); return rest }) }) }} />
            : isRemoving ? <div className={styles.confirm}>
              <p className={styles.intro}>{t('removeConfirm', { name: provider.name })}</p>
              <div className={styles.actions}>
                <button type="button" className={styles.button} disabled={busy} onClick={() => setRemoving(undefined)}>{t('cancel')}</button>
                <button type="button" className={styles.danger} disabled={busy} onClick={() => { void run(signal => api.remove(provider.id, state.revision, signal), next => { setState(next); setRemoving(undefined); setExpanded(current => { const rest = new Set(current); rest.delete(provider.id); return rest }); setNotice(t('removed')) }) }}>{t('confirmRemove')}</button>
              </div>
            </div> : <>
              <button type="button" className={styles.disclosure} aria-expanded={open} aria-controls={open ? detailsId : undefined} disabled={busy} onClick={() => toggle(provider.id)}>{t('modelsAndTest', { count: provider.models.length })}</button>
              {open && <div className={styles.detailBody} id={detailsId}>
                <p className={styles.hint}>{provider.baseUrl}</p>
                <p className={styles.hint}>{t(provider.keyConfigured ? 'keyConfigured' : 'keyMissing')}</p>
                <ul className={styles.models}>{provider.models.map(model => <li key={model.id}>
                  <code>{model.id}</code>
                  {model.name && <span className={styles.modelMeta}>{model.name}</span>}
                  {model.contextWindow !== undefined && <span className={styles.modelMeta}>{t('contextSummary', { capacity: formatContextCapacity(model.contextWindow) })}</span>}
                </li>)}</ul>
                <div className={styles.testRow}>
                  <label className={styles.testField}>
                    <span className={styles.hint}>{t('model')}</span>
                    <select aria-label={t('model')} className={styles.input} value={provider.models.some(model => model.id === selected[provider.id]) ? selected[provider.id] : provider.models[0].id} disabled={locked} onChange={event => { setSelected(previous => ({ ...previous, [provider.id]: event.target.value })); setNotice(undefined) }}>
                      {provider.models.map(model => <option value={model.id} key={model.id}>{model.name ? `${model.name} (${model.id})` : model.id}</option>)}
                    </select>
                  </label>
                  <button type="button" className={styles.button} disabled={locked} onClick={() => {
                    setTestingProvider(provider.id)
                    const model = provider.models.some(item => item.id === selected[provider.id]) ? selected[provider.id] : provider.models[0].id
                    void run(signal => api.test(provider.id, model, signal), result => setNotice(t('testResult', { model: result.model, milliseconds: result.elapsedMs })))
                  }}>{t('test')}</button>
                  {testingProvider === provider.id && <button type="button" className={styles.button} onClick={() => { pending.current?.abort(); setTestingProvider(undefined); setBusy(false) }}>{t('cancel')}</button>}
                </div>
                <p className={styles.hint}>{t('testHint')}</p>
              </div>}
            </>}
        </li>
      })}
    </ul>}
    {adding && state ? <div className={styles.addCard} data-testid="decision-add-card">
      <h4 className={styles.title}>{t('newTitle')}</h4>
      <SegmentedControl id={modeId} value={addMode} className={styles.addModes} label={t('addModeLabel')} disabled={busy}
        options={[{ value: 'known', label: t('knownMode'), disabled: !knownAvailable, title: !knownAvailable ? t('knownConfigured') : undefined }, { value: 'custom', label: t('customMode') }]}
        onChange={setAddMode} />
      <div role="tabpanel" aria-labelledby={`${modeId}-known`} id={`${modeId}-known-panel`} hidden={addMode !== 'known'}>
        <ProviderEditor key="known" seed={{ id: 'typesafe', name: t('knownProviderName'), baseUrl: DEFAULT_BASE_URL }} fixedConnection hideTitle revision={state.revision} busy={busy} t={t}
          onDirtyChange={onKnownDirty} extraDirty={() => addDirty.custom} onCancel={closeAdd} onSave={saveAdd} />
      </div>
      <div role="tabpanel" aria-labelledby={`${modeId}-custom`} id={`${modeId}-custom-panel`} hidden={addMode !== 'custom'}>
        <ProviderEditor key="custom" seed={{ id: '', name: '', baseUrl: '' }} hideTitle revision={state.revision} busy={busy} t={t}
          onDirtyChange={onCustomDirty} extraDirty={() => addDirty.known} onCancel={closeAdd} onSave={saveAdd} />
      </div>
    </div> : <button type="button" className={styles.add} disabled={busy || !state?.writable || Boolean(editing) || Boolean(removing)} onClick={openAdd}>
      <IconPlusOutlineRegular size={14} />{t('add')}
    </button>}
  </section>
}

/**
 * Stock Models catalog: editable rows, Fetch available models picker, Add model.
 */
import * as React from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { formatCapacity, parseCapacity } from '../core/capacity.ts'
import type { FamilyId } from '../core/catalog.ts'
import type { ModelDraft } from '../core/settings.ts'
import { ClientRpcError, type RpcCall, subscriptionsApi } from './api.ts'
import { resolveTranslate, type MessageKey } from './dictionaries.ts'
import { IconChevron, IconTrash } from './icons.tsx'
import styles from './footer.module.css'

export type Translate = (key: MessageKey, params?: Record<string, string | number>) => string

export interface EditorModel {
  id: string
  name?: string
  contextWindow?: number
  maxTokens?: number
}

export interface ModelListEditorProps {
  family: FamilyId
  models: readonly EditorModel[]
  defaults?: readonly EditorModel[]
  overridden: boolean
  onChange: (models: EditorModel[]) => void
  onReset?: () => void
  rpc: RpcCall
  t: Translate
  disabled: boolean
  signedIn: boolean
}

function textOf(model: EditorModel, field: 'id' | 'name'): string {
  const value = model[field]
  return typeof value === 'string' ? value : ''
}

function numberOf(model: EditorModel, field: 'contextWindow' | 'maxTokens'): number | undefined {
  const value = model[field]
  return typeof value === 'number' ? value : undefined
}

function capacitySpelling(value: number | undefined): string {
  return value === undefined || Number.isNaN(value) ? '' : formatCapacity(value)
}

function adopt(candidate: ModelDraft): EditorModel {
  return {
    id: candidate.id,
    ...candidate.name === undefined ? {} : { name: candidate.name },
    ...candidate.contextWindow === undefined ? {} : { contextWindow: candidate.contextWindow },
    ...candidate.maxTokens === undefined ? {} : { maxTokens: candidate.maxTokens },
  }
}

export function ModelListEditor(props: ModelListEditorProps): React.ReactElement {
  const t = resolveTranslate(props.t)
  const api = React.useMemo(() => subscriptionsApi(props.rpc), [props.rpc])
  const { models, onChange, disabled } = props
  const [busy, setBusy] = React.useState(false)
  const [failure, setFailure] = React.useState<string | undefined>()
  const [candidates, setCandidates] = React.useState<ModelDraft[] | undefined>()
  const [picked, setPicked] = React.useState<Set<string>>(new Set())
  const [candidateQuery, setCandidateQuery] = React.useState('')
  const [expanded, setExpanded] = React.useState<Set<number>>(new Set())
  const [editing, setEditing] = React.useState<Map<string, string>>(new Map())

  // Patched copies inherit their row identity; unrelated rows keep theirs even
  // when a preceding row is removed. Replaced catalogs get fresh identities.
  const rowKeys = React.useRef(new WeakMap<EditorModel, number>())
  const nextRowKey = React.useRef(0)
  const rowKey = (model: EditorModel): number => {
    let key = rowKeys.current.get(model)
    if (key === undefined) {
      key = nextRowKey.current++
      rowKeys.current.set(model, key)
    }
    return key
  }
  const bufferKey = (model: EditorModel, field: string): string => `${String(rowKey(model))}:${field}`

  const patch = (index: number, next: Partial<EditorModel>): void => {
    onChange(models.map((model, at) => {
      if (at !== index) return model
      const merged: EditorModel = { ...model, ...next }
      rowKeys.current.set(merged, rowKey(model))
      if (next.name === undefined && 'name' in next) delete merged.name
      if (next.contextWindow === undefined && 'contextWindow' in next) delete merged.contextWindow
      if (next.maxTokens === undefined && 'maxTokens' in next) delete merged.maxTokens
      return merged
    }))
  }

  const editCapacity = (index: number, field: 'contextWindow' | 'maxTokens', text: string): void => {
    setEditing((current) => new Map(current).set(bufferKey(models[index]!, field), text))
    patch(index, { [field]: parseCapacity(text) })
  }

  const fallbackCapacity = (model: EditorModel, field: 'contextWindow' | 'maxTokens'): number | undefined => {
    if (numberOf(model, field) !== undefined) return undefined
    const match = (props.defaults ?? []).find((row) => row.id === model.id)
    return match === undefined ? undefined : numberOf(match, field)
  }

  const capacityPlaceholder = (model: EditorModel, field: 'contextWindow' | 'maxTokens'): string => {
    const fallback = fallbackCapacity(model, field)
    if (fallback !== undefined) return formatCapacity(fallback)
    return t(field === 'contextWindow' ? 'contextWindowPlaceholder' : 'maxTokensPlaceholder')
  }

  const capacityText = (model: EditorModel, field: 'contextWindow' | 'maxTokens'): string =>
    editing.get(bufferKey(model, field)) ?? capacitySpelling(numberOf(model, field))

  const fetchModels = async (): Promise<void> => {
    setBusy(true)
    setFailure(undefined)
    try {
      const found = await api.listModels(props.family)
      if (found.length === 0) {
        setFailure(t('fetchEmpty'))
        return
      }
      const known = new Set(models.map((model) => textOf(model, 'id')))
      setCandidateQuery('')
      setCandidates(found)
      setPicked(new Set(found.filter((model) => !known.has(model.id)).map((model) => model.id)))
    } catch (error) {
      setFailure(error instanceof ClientRpcError ? t(`error.${error.code}` as MessageKey, error.params) : t('error.unknown'))
    } finally {
      setBusy(false)
    }
  }

  const closePicker = (): void => {
    setCandidates(undefined)
    setPicked(new Set())
    setCandidateQuery('')
  }

  const adoptPicked = (): void => {
    if (candidates === undefined) return
    const byId = new Map(models.map((model) => [textOf(model, 'id'), model]))
    for (const candidate of candidates) {
      if (!picked.has(candidate.id)) continue
      byId.set(candidate.id, byId.get(candidate.id) ?? adopt(candidate))
    }
    onChange([...byId.values()].filter((row) => row.id.trim() !== ''))
    closePicker()
  }

  const normalizedQuery = candidateQuery.trim().toLowerCase()
  const activeCandidates = candidates ?? []
  const visibleCandidates = normalizedQuery.length === 0
    ? activeCandidates
    : activeCandidates.filter((candidate) =>
      candidate.id.toLowerCase().includes(normalizedQuery)
      || candidate.name?.toLowerCase().includes(normalizedQuery) === true)
  const allVisiblePicked = visibleCandidates.length > 0 && visibleCandidates.every((candidate) => picked.has(candidate.id))

  return (
    <section className={styles.modelCatalog} aria-label={t('models')}>
      <div className={styles.modelListHead}>
        <div className={styles.modelCatalogHeading}>
          <span className={styles.modelCatalogTitle}>{t('models')}</span>
          <span className={styles.modelCatalogMeta}>
            {props.overridden ? t('modelsCustomized') : t('modelsInherited')}
          </span>
        </div>
        {props.overridden && props.onReset !== undefined ? (
          <button type="button" className={styles.linkButton} disabled={disabled} onClick={() => {
            setEditing(new Map())
            setExpanded(new Set())
            props.onReset?.()
          }}>
            {t('resetModels')}
          </button>
        ) : null}
        <button
          type="button"
          className={styles.linkButton}
          disabled={disabled || busy || !props.signedIn}
          title={props.signedIn ? undefined : t('fetchNeedsSignIn')}
          onClick={() => { void fetchModels() }}
          data-testid="oauth-fetch-models"
        >
          {busy ? t('fetching') : t('fetchModels')}
        </button>
      </div>
      {models.length === 0 ? <p className={styles.modelEmpty}>{t('modelsEmpty')}</p> : null}
      {models.map((model, index) => (
        <div className={styles.modelEntry} key={rowKey(model)}>
          <div className={styles.modelRow}>
            <input
              className={styles.input}
              type="text"
              value={textOf(model, 'id')}
              placeholder={t('modelId')}
              aria-label={`${t('modelId')} ${String(index + 1)}`}
              disabled={disabled}
              onChange={(event) => { patch(index, { id: event.target.value }) }}
            />
            <input
              className={styles.input}
              type="text"
              value={textOf(model, 'name')}
              placeholder={t('modelName')}
              aria-label={`${t('modelName')} ${String(index + 1)}`}
              disabled={disabled}
              onChange={(event) => {
                patch(index, { name: event.target.value === '' ? undefined : event.target.value })
              }}
            />
            <button
              type="button"
              className={styles.iconButton}
              aria-label={`${t('modelAdvanced')} ${String(index + 1)}`}
              aria-expanded={expanded.has(rowKey(model))}
              title={t('modelAdvanced')}
              onClick={() => {
                setExpanded((current) => {
                  const next = new Set(current)
                  const key = rowKey(model)
                  if (!next.delete(key)) next.add(key)
                  return next
                })
              }}
            >
              <IconChevron open={expanded.has(rowKey(model))} />
            </button>
            <button
              type="button"
              className={`${styles.iconButton} ${styles.iconButtonDanger}`}
              aria-label={`${t('removeModel')} ${String(index + 1)}`}
              title={t('removeModel')}
              disabled={disabled}
              onClick={() => {
                onChange(models.filter((_model, at) => at !== index))
                setExpanded((current) => {
                  const next = new Set(current)
                  next.delete(rowKey(model))
                  return next
                })
                setEditing((current) => {
                  const next = new Map(current)
                  next.delete(bufferKey(model, 'contextWindow'))
                  next.delete(bufferKey(model, 'maxTokens'))
                  return next
                })
              }}
            >
              <IconTrash />
            </button>
          </div>
          {expanded.has(rowKey(model)) ? (
            <div className={styles.modelAdvanced}>
              <label className={styles.modelField}>
                <span className={styles.modelFieldLabel}>{t('modelContextWindow')}</span>
                <input
                  className={styles.input}
                  type="text"
                  inputMode="numeric"
                  value={capacityText(model, 'contextWindow')}
                  placeholder={capacityPlaceholder(model, 'contextWindow')}
                  aria-label={`${t('modelContextWindow')} ${String(index + 1)}`}
                  disabled={disabled}
                  onChange={(event) => { editCapacity(index, 'contextWindow', event.target.value) }}
                />
              </label>
              <label className={styles.modelField}>
                <span className={styles.modelFieldLabel}>{t('modelMaxTokens')}</span>
                <input
                  className={styles.input}
                  type="text"
                  inputMode="numeric"
                  value={capacityText(model, 'maxTokens')}
                  placeholder={capacityPlaceholder(model, 'maxTokens')}
                  aria-label={`${t('modelMaxTokens')} ${String(index + 1)}`}
                  disabled={disabled}
                  onChange={(event) => { editCapacity(index, 'maxTokens', event.target.value) }}
                />
              </label>
            </div>
          ) : null}
        </div>
      ))}
      <button
        type="button"
        className={styles.addModelButton}
        disabled={disabled}
        onClick={() => { onChange([...models, { id: '' }]) }}
        data-testid="oauth-add-model"
      >
        {t('addModel')}
      </button>
      {failure === undefined ? null : <p className={styles.error}>{failure}</p>}
      <Modal
        open={candidates !== undefined}
        onClose={closePicker}
        title={t('fetchTitle')}
        closeLabel={t('close')}
        description={t('fetchDescription')}
        className={styles.fetchDialog}
        footer={(
          <>
            <Button variant="outline" onClick={closePicker}>{t('cancel')}</Button>
            <Button variant="outline" onClick={adoptPicked}>{t('fetchAdopt')}</Button>
          </>
        )}
      >
        <div className={styles.candidateToolbar}>
          <input
            className={`${styles.input} ${styles.candidateSearch}`}
            type="search"
            value={candidateQuery}
            placeholder={t('fetchSearch')}
            aria-label={t('fetchSearch')}
            onChange={(event) => { setCandidateQuery(event.target.value) }}
          />
          <Button
            variant="ghost"
            size="sm"
            disabled={visibleCandidates.length === 0}
            onClick={() => {
              setPicked((current) => {
                if (visibleCandidates.every((candidate) => current.has(candidate.id))) return new Set()
                const next = new Set(current)
                for (const candidate of visibleCandidates) next.add(candidate.id)
                return next
              })
            }}
          >
            {t(allVisiblePicked ? 'fetchDeselectAll' : 'fetchSelectAll')}
          </Button>
        </div>
        {visibleCandidates.length === 0 ? (
          <p className={styles.candidateEmpty} role="status">{t('fetchNoMatches')}</p>
        ) : (
          <ul className={styles.candidateList} data-testid="oauth-fetch-dialog">
            {visibleCandidates.map((candidate) => (
              <li className={styles.candidate} key={candidate.id}>
                <label className={styles.candidateLabel}>
                  <input
                    type="checkbox"
                    checked={picked.has(candidate.id)}
                    onChange={() => {
                      setPicked((current) => {
                        const next = new Set(current)
                        if (!next.delete(candidate.id)) next.add(candidate.id)
                        return next
                      })
                    }}
                  />
                  <span className={styles.candidateId}>{candidate.id}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </section>
  )
}

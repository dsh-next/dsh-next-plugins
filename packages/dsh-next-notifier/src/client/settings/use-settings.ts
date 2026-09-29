import * as React from 'react'
import type { ConfigPageForm } from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { SettingsFormPathOp } from '@deepseek-ai/dsh-client-ui-primitives'
import { normalizeConfig } from '../../core/config.ts'
import type { NotifierConfig } from '../../core/types.ts'

type Pending = { ops: readonly SettingsFormPathOp[]; saving: boolean; failed: boolean }
interface Owner {
  active: boolean
  form: ConfigPageForm | undefined
  queued: SettingsFormPathOp[]
  inFlight: SettingsFormPathOp[]
  busy: boolean
  timer: ReturnType<typeof setTimeout> | undefined
  failed: boolean
  flush: () => Promise<void>
}

/** Optimistic autosave over the shared, revision-fenced Host write queue. */
export function useSettings(form: ConfigPageForm | undefined) {
  const [pending, setPending] = React.useState<Pending>({ ops: [], saving: false, failed: false })
  const lifetime = React.useRef<Owner | null>(null)
  React.useLayoutEffect(() => {
    const owner: Owner = { active: true, form, queued: [], inFlight: [], busy: false,
      timer: undefined, failed: false, flush: async () => {} }
    const publish = () => {
      if (owner.active) setPending({ ops: [...owner.inFlight, ...owner.queued],
        saving: owner.busy || owner.queued.length > 0, failed: owner.failed })
    }
    owner.flush = async () => {
      if (owner.busy || owner.queued.length === 0) return
      clearTimeout(owner.timer)
      owner.timer = undefined
      if (owner.form?.state.status !== 'ready' || !owner.form.state.writable) {
        owner.queued = []; owner.failed = true; publish(); return
      }
      owner.inFlight = owner.queued
      owner.queued = []
      owner.busy = true
      publish()
      try {
        // The shared form fences each queued write against its latest accepted revision.
        owner.failed = !await owner.form.mutate(owner.inFlight)
      } catch { owner.failed = true }
      finally {
        owner.inFlight = []
        owner.busy = false
        publish()
        if (owner.timer === undefined) void owner.flush()
      }
    }
    lifetime.current = owner
    publish()
    return () => {
      owner.active = false
      clearTimeout(owner.timer)
      owner.timer = undefined
      // Leaving the page commits an already-requested slider change instead of losing it.
      void owner.flush()
    }
  }, [form?.mutate])
  React.useLayoutEffect(() => { if (lifetime.current) lifetime.current.form = form }, [form])

  const raw = { ...form?.state.value } as Record<string, unknown>
  for (const op of pending.ops) {
    const [field, child] = op.path
    if (child) raw[field] = { ...(raw[field] as object), [child]: op.op === 'set' ? op.value : undefined }
    else if (op.op === 'set') raw[field] = op.value
    else raw[field] = (form?.state.base as Record<string, unknown> | undefined)?.[field]
  }
  const config = normalizeConfig(raw)
  const available = form?.state.status === 'ready'
  const writable = Boolean(available && form.state.writable)
  function queue(ops: SettingsFormPathOp[], debounce = false): void {
    const owner = lifetime.current
    if (!owner?.active || !writable) return
    owner.failed = false
    for (const op of ops) {
      owner.queued = owner.queued.filter(item => !op.path.every((part, index) => item.path[index] === part))
      owner.queued.push(op)
    }
    setPending({ ops: [...owner.inFlight, ...owner.queued], saving: true, failed: false })
    clearTimeout(owner.timer)
    owner.timer = undefined
    if (debounce) owner.timer = setTimeout(() => { owner.timer = undefined; void owner.flush() }, 250)
    else void owner.flush()
  }
  return {
    config, disabled: !writable, available, writable, saving: pending.saving, failed: pending.failed,
    edit: (path: readonly string[], value: unknown) => queue([{ op: 'set', path, value }], path[0] === 'volume'),
    reset: () => queue(Object.keys(config).map(field => ({ op: 'unset', path: [field] }))),
  }
}

export type SettingsEditor = ReturnType<typeof useSettings>
export type GroupKey = 'finished' | 'approval' | 'question'
export type GroupConfig = NotifierConfig[GroupKey]

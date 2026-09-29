import * as React from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AiTaskRecord, AiTaskResults } from './task-results.ts'
import type { AgentSessionControls } from './action-dialog.tsx'
import type { PanelStore } from '../controller.ts'
import type { Translate } from '../dictionaries.ts'
import { useDialogFocus } from '../ui/dialog-focus.ts'
import classes from './action-dialog.module.css'

export function AgentResults(props: { results: AiTaskResults; sessions: AgentSessionControls; store: PanelStore; t: Translate }): React.ReactElement | null {
  const { results, sessions, store, t } = props
  const snapshot = React.useSyncExternalStore(results.subscribe, results.getSnapshot, results.getSnapshot)
  const [confirmation, setConfirmation] = React.useState<{ record: AiTaskRecord; draft: string } | null>(null)
  const [error, setError] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const active = React.useRef(true)
  const pending = React.useRef(false)
  React.useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  const useMessage = async (record: AiTaskRecord, expectedDraft: string): Promise<void> => {
    if (pending.current || !record.canUseMessage || record.finalAssistantText === null) return
    pending.current = true; setBusy(true); setError(false)
    try {
      const current = await store.prepareAgentAction('draft', { side: 'staged' })
      if (!active.current || store.isDisposed) return
      if (current.state.root !== record.root || (current.repositoryVersion ?? current.fingerprint) !== record.fingerprint || store.getSnapshot().message !== expectedDraft) { setError(true); return }
      store.setMessage(record.finalAssistantText.trim())
      setConfirmation(null)
    } catch { if (active.current) setError(true) }
    finally { pending.current = false; if (active.current) setBusy(false) }
  }
  if (snapshot.records.length === 0) return null
  return <section className={classes.body} data-dsh-git="agent-results" aria-label={t('agent.result.title')}>
    {snapshot.records.slice(-3).reverse().map(record => <details key={record.requestId}>
      <summary>{t('agent.' + (['review', 'explain', 'draft', 'resolve'].find(verb => record.verb === verb) ?? 'title') as Parameters<Translate>[0])} — {t('agent.result.phase.' + record.phase as Parameters<Translate>[0])}</summary>
      {record.finalAssistantText && <pre className={classes.preview}>{record.finalAssistantText}</pre>}
      {record.textTruncated && <p className={classes.hint}>{t('agent.result.incomplete')}</p>}
      <Button size="sm" variant="ghost" disabled={sessions.openSession === undefined} onClick={() => sessions.openSession?.(record.targetSessionId)}>{t('agent.openSession')}</Button>
      {record.verb === 'draft' && record.canUseMessage && <Button size="sm" variant="primary" disabled={busy} onClick={() => {
        const draft = store.getSnapshot().message
        if (draft.trim() !== '') setConfirmation({ record, draft })
        else void useMessage(record, draft)
      }}>{t('agent.result.useMessage')}</Button>}
    </details>)}
    {snapshot.recordsTruncated && <p className={classes.hint}>{t('agent.result.retained')}</p>}
    {error && <p role="alert" className={classes.error}>{t('agent.result.useFailed')}</p>}
    {confirmation && <ReplaceDraft t={t} busy={busy} onClose={() => setConfirmation(null)} onConfirm={() => void useMessage(confirmation.record, confirmation.draft)} />}
  </section>
}

function ReplaceDraft({ t, busy, onClose, onConfirm }: { t: Translate; busy: boolean; onClose(): void; onConfirm(): void }): React.ReactElement {
  const body = React.useRef<HTMLDivElement>(null)
  useDialogFocus(body)
  return <Modal open title={t('agent.result.replaceTitle')} closeLabel={t('confirm.cancel')} onClose={onClose}
    footer={<><Button variant="ghost" disabled={busy} onClick={onClose}>{t('confirm.cancel')}</Button><Button variant="primary" disabled={busy} onClick={onConfirm}>{t('agent.result.useMessage')}</Button></>}>
    <div ref={body}>{t('agent.result.replaceBody')}</div>
  </Modal>
}

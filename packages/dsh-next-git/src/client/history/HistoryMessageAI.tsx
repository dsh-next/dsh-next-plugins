import * as React from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { CommitSummary } from '../../core/types.ts'
import type { GitApi } from '../api.ts'
import type { Translate } from '../dictionaries.ts'
import type { AgentSessionControls } from '../ai/action-dialog.tsx'
import { InlineMessageDraft } from '../ai/InlineMessageDraft.tsx'

export interface HistoryMessageAIProps {
  sessionId: SessionId
  action: 'squash' | 'reword'
  commits: readonly CommitSummary[]
  message: string
  onMessage(message: string): void
  sessions?: AgentSessionControls
  root: string
  cwd: string
  api: GitApi
  t: Translate
  disabled: boolean
}

export function HistoryMessageAI(props: HistoryMessageAIProps): React.ReactElement {
  const scope = JSON.stringify([props.sessionId, props.root, props.cwd, props.action, props.commits.map(commit => commit.hash)])
  return <InlineMessageDraft scope={scope} t={props.t} disabled={props.disabled || !props.commits.length}
    onMessage={props.onMessage} generate={signal => props.api.call<string>('draftInput', {
      sessionId: props.sessionId, kind: props.action, commits: props.commits.map(commit => commit.hash), message: props.message,
    }, signal)} />
}

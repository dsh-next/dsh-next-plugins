/**
 * Browser-half entry: register `git` as a right-Sidebar tab type.
 *
 * The public two-stage path, unmodified — the type into `ctx.sidebarRightTabs`,
 * its body into the keyed `sidebar.right.pane.tab` seat and its chip title into
 * `sidebar.right.pane.tab.title`, both under this package's id. The Start-guide
 * capsule is part of the same definition (`guide[]`), so it needs no extra
 * registration and no CSS: the platform draws it.
 *
 * `priority: 'extension'` is what makes this package's type outrank a builtin
 * viewer of the same address, matching how the shipped Files type declares
 * itself against the document preview.
 *
 * Agent verbs are wired here, at the only place that can reach the session:
 * `ctx.sessions` resolves the session face and queues the payload as a turn.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createSessionBridge } from './ai/session-bridge.ts'
import { createAiTaskResults, type AiTaskResults } from './ai/task-results.ts'
import type { AgentSessionControls } from './ai/action-dialog.tsx'
// Type-only: pulls the sidebar-right Context merge (ctx.sidebarRight,
// ctx.sidebarRightTabs), the slots SlotMap merges for the two keyed seats this
// package registers into, and the session standard-props merge (sessionId).
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: pulls the conversation SlotMap merge for the composer tool row
// seat this package's branch chip registers into.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import * as React from 'react'
import { createApi } from './api.ts'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { BranchChip } from './composer/BranchChip.tsx'
import { GitSettingsCard } from './settings/GitSettingsCard.tsx'
import { ChangeFileTab } from './file/ChangeFileTab.tsx'
import { CHANGES_ADDRESS_PREFIX, changeFileTitle } from '../core/address.ts'
import {
  ChangeFileTitle,
  configurePanelApi,
  GitPanel,
  GitPanelUnavailable,
  GitTitle,
  BranchGlyph,
  type GitPanelProps,
} from './GitPanel.tsx'
import { en, englishTranslate, NS, zh, type MessageKey } from './dictionaries.ts'

/** The tab kind this package owns. */
export const GIT_KIND = 'git'

/** This implementation's identity in the tab system, and the body's slot key. */
export const GIT_ID = '@dsh-next/dsh-next-git'

/** The change view's kind and identity: a second type this package contributes. */
export const CHANGE_KIND = 'git-change'
export const CHANGE_ID = '@dsh-next/dsh-next-git/change'

/** Services required before registration. */
export const inject = ['slots', 'locale', 'sidebarRightTabs', 'sessions', 'workspaces', 'uiWorkspace'] as const

/** The tab type's static face. */
export function gitDefinition(t: (key: MessageKey, params?: Record<string, string | number>) => string) {
  return {
    id: GIT_ID,
    kind: GIT_KIND,
    priority: 'extension' as const,
    title: () => t('type.label'),
    guide: [
      {
        id: 'source-control',
        order: 20,
        title: () => t('guide.title'),
        description: () => t('guide.description'),
        icon: BranchGlyph,
      },
    ],
  }
}

/**
 * The change view's static face: every `dsh-resource://git-changes/…` address
 * this package's own tabs open.
 *
 * The band is inherited from the default (`extension`), which is what lets a
 * plugin type outrank the viewers shipped with the product, and it is honest
 * here: the address's protocol is ours, so nothing else can claim it.
 */
export function changeDefinition() {
  return {
    id: CHANGE_ID,
    kind: CHANGE_KIND,
    patterns: [CHANGES_ADDRESS_PREFIX + '**'],
    title: (address: string) => changeFileTitle(address),
  }
}

/** Remove only the deleted checkout's registration; the SDK retains sessions and files. */
export function makeWorktreeUnregister(ctx: Context): ((path: string) => Promise<void>) | undefined {
  if (ctx.get('workspaces') === undefined) return undefined
  return async (path: string): Promise<void> => {
    const workspaces = ctx.get('workspaces')
    if (workspaces === undefined) throw new Error('workspace service is unavailable')
    const snapshot = workspaces.list.getSnapshot()
    if (snapshot.phase !== 'ready' || snapshot.state === 'error') throw new Error('workspace registry is unavailable')
    for (const workspace of snapshot.items.filter(item => item.path === path)) {
      await workspaces.delete(workspace.workspaceId)
    }
  }
}

/** Register the folder, then create a genuinely new session in that checkout. */
export function makeWorktreeOpener(ctx: Context): ((path: string) => Promise<void>) | undefined {
  const workspaces = ctx.get('workspaces')
  const sessions = ctx.get('sessions')
  const navigation = ctx.get('uiWorkspace')
  if (workspaces === undefined || sessions === undefined || navigation === undefined) return undefined
  return async (path: string): Promise<void> => {
    const workspaces = ctx.get('workspaces'), sessions = ctx.get('sessions'), navigation = ctx.get('uiWorkspace')
    if (workspaces === undefined || sessions === undefined || navigation === undefined) throw new Error('workspace navigation is unavailable')
    const workspace = await workspaces.create({ path })
    const sessionId = await sessions.create({ workspaceId: workspace.workspaceId })
    navigation.openSession(sessionId)
  }
}

export function apply(ctx: Context): void {
  const locale = ctx.get('locale')
  const slots = ctx.get('slots')
  if (locale !== undefined) {
    ctx.effect(() => {
      try {
        return locale.register(NS, { en, zh })
      } catch {
        return () => {}
      }
    }, 'dsh-next-git: dictionaries')
  }
  const t = locale !== undefined ? locale.bind(NS) : englishTranslate

  // The panel's API factory: one same-origin RPC route, created lazily so a
  // disposed panel does not keep a fetch closure alive.
  configurePanelApi(() => createApi())
  const settingsApi = createApi()
  ctx.effect(() => slots.inject('plugins.bundle.config', () => slots.register(
    { name: 'plugins.bundle.config', key: GIT_ID, registrant: GIT_ID },
    () => React.createElement(GitSettingsCard, { api: settingsApi, t }),
  )), 'dsh-next-git: drafting settings')

  // The composer's branch chip: the same picker as the panel header, offered
  // where a session starts and during it. A workspace that is not a git
  // repository renders nothing there, so a composer without a repository is
  // untouched.
  const chipApi = createApi()
  ctx.effect(
    () =>
      slots.inject('conversation.input.left', () =>
        slots.register(
          { name: 'conversation.input.left', id: GIT_ID + '/branch', order: 10, locale: NS },
          (props: unknown) => {
            const share = props as { sessionId?: SessionId }
            if (share.sessionId === undefined) return null
            return React.createElement(BranchChip, { sessionId: share.sessionId, api: chipApi, t })
          },
        ),
      ),
    'dsh-next-git: composer branch chip',
  )

  ctx.effect(() => ctx.sidebarRightTabs.register(gitDefinition(t)), 'dsh-next-git: git tab type')
  ctx.effect(() => ctx.sidebarRightTabs.register(changeDefinition()), 'dsh-next-git: change file tab type')

  const sessions = ctx.get('sessions')
  const workspaces = ctx.get('workspaces')
  const uiWorkspace = ctx.get('uiWorkspace')
  const bridge = sessions !== undefined && workspaces !== undefined && uiWorkspace !== undefined
    ? createSessionBridge({ sessions, workspaces, uiWorkspace }) : undefined
  const openWorktreeSession = makeWorktreeOpener(ctx)
  const unregisterDeletedWorktree = makeWorktreeUnregister(ctx)
  const registerCreatedWorktree = workspaces === undefined ? undefined : async (path: string): Promise<void> => {
    await workspaces.create({ path })
  }
  const controls = new Map<SessionId, AgentSessionControls>()
  const results = new Map<string, AiTaskResults>()
  const controlsFor = (sourceSessionId: SessionId): AgentSessionControls | undefined => {
    if (bridge === undefined || sessions === undefined || uiWorkspace === undefined) return undefined
    const existing = controls.get(sourceSessionId)
    if (existing !== undefined) return existing
    const bound: AgentSessionControls = {
      getSource: () => bridge.getSource(sourceSessionId),
      createDelivery: input => bridge.createDelivery({ ...input, sourceSessionId }),
      subscribeRefresh: refresh => bridge.subscribeTurnEnd(sourceSessionId, refresh),
      openSession: target => uiWorkspace.openSession(target),
      taskResults: root => {
        const key = JSON.stringify([sourceSessionId, root])
        let value = results.get(key)
        if (value === undefined) { value = createAiTaskResults({ sessions, sourceSessionId, root }); results.set(key, value) }
        return value
      },
    }
    controls.set(sourceSessionId, bound)
    return bound
  }
  ctx.effect(() => () => { for (const result of results.values()) result.dispose(); results.clear(); controls.clear() }, 'dsh-next-git: AI task results')

  ctx.effect(
    () =>
      slots.inject('sidebar.right.pane.tab', () =>
        slots.register(
          { name: 'sidebar.right.pane.tab', key: GIT_ID, locale: NS },
          (props: unknown) => {
            const share = props as {
              sessionId?: SessionId
              useTabInfo?: GitPanelProps['useTabInfo']
            }
            // Never return null: a registered seat that renders nothing leaves
            // an empty pane, and this seat does hand a partial share. Without a
            // session there is nothing to read, so say that instead.
            if (share.sessionId === undefined) {
              return React.createElement(GitPanelUnavailable, { t })
            }
            const agentSessions = controlsFor(share.sessionId)
            return React.createElement(GitPanel, {
              sessionId: share.sessionId,
              ...(share.useTabInfo === undefined ? {} : { useTabInfo: share.useTabInfo }),
              t,
              ...(agentSessions === undefined ? {} : { agentSessions }),
              ...(openWorktreeSession === undefined ? {} : { openWorktreeSession }),
              ...(registerCreatedWorktree === undefined ? {} : { registerCreatedWorktree }),
              ...(unregisterDeletedWorktree === undefined ? {} : { unregisterDeletedWorktree }),
            })
          },
        ),
      ),
    'dsh-next-git: git tab body',
  )

  // One changed file, read in place. Unlike the panel seat this body is
  // dispatched per tab, and the address it was opened with carries the whole
  // read: which session, which side, which path. The API is built once per
  // plugin lifetime: a per-render instance would re-issue the read.
  const changeApi = createApi()
  ctx.effect(
    () =>
      slots.inject('sidebar.right.pane.tab', () =>
        slots.register(
          { name: 'sidebar.right.pane.tab', key: CHANGE_ID, locale: NS },
          (props: unknown) => {
            const share = props as { useTabInfo?: () => { tab: { navigation: { address: string } } } }
            // The framework hook throws while the tab record is not committed,
            // which the shell passes through during a session switch or a
            // layout restore; the body says so instead of taking the seat down.
            let address = ''
            try {
              address = share.useTabInfo?.().tab.navigation.address ?? ''
            } catch {
              address = ''
            }
            return React.createElement(ChangeFileTab, { address, api: changeApi, t })
          },
        ),
      ),
    'dsh-next-git: change file tab body',
  )

  // The change view's chip: same glyph as the panel's, so a tab opened from
  // Source control reads as Source control's own view of the change.
  ctx.effect(
    () =>
      slots.inject('sidebar.right.pane.tab.title', () =>
        slots.register(
          { name: 'sidebar.right.pane.tab.title', key: CHANGE_ID, locale: NS },
          (props: unknown) => {
            const share = props as { useTabInfo?: () => { tab: { navigation: { address: string } } } }
            // The framework hook throws while the tab record is not committed;
            // the chip still has to render, so it falls back to the label.
            let address = ''
            try {
              address = share.useTabInfo?.().tab.navigation.address ?? ''
            } catch {
              address = ''
            }
            return React.createElement(ChangeFileTitle, { t, address })
          },
        ),
      ),
    'dsh-next-git: change file tab title',
  )

  ctx.effect(
    () =>
      slots.inject('sidebar.right.pane.tab.title', () =>
        slots.register(
          { name: 'sidebar.right.pane.tab.title', key: GIT_ID, locale: NS },
          (props: unknown) => {
            // Always render: a title seat that returns null leaves the chip
            // blank, and GitTitle falls back to the type label whenever the
            // store has nothing to say yet.
            const share = props as { sessionId?: string }
            return React.createElement(GitTitle, {
              t,
              ...(share.sessionId === undefined ? {} : { sessionId: share.sessionId }),
            })
          },
        ),
      ),
    'dsh-next-git: git tab title',
  )
}

import * as React from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { CHANGES_ADDRESS_PREFIX, changeFileTitle } from '../../core/address.ts'
import { createGitAgentControls } from '../ai/controls.ts'
import { createApi } from '../api.ts'
import { NS, type MessageKey, type Translate } from '../dictionaries.ts'
import { ChangeFileTab } from '../file/ChangeFileTab.tsx'
import { GitPanel, type GitPanelProps } from '../GitPanel.tsx'
import { BranchGlyph, ChangeFileTitle, GitTitle } from '../panel/GitTitle.tsx'
import { GitPanelUnavailable } from '../panel/PanelBoundary.tsx'
import { makeWorktreeOpener, makeWorktreeUnregister } from '../worktrees/navigation.ts'

export const GIT_KIND = 'git'
export const GIT_ID = '@dsh-next/dsh-next-git'
export const CHANGE_KIND = 'git-change'
export const CHANGE_ID = '@dsh-next/dsh-next-git/change'

/** The tab type's static face, including its Start-guide capsule. */
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

/** This package's resource addresses outrank built-in document viewers. */
export function changeDefinition() {
  return {
    id: CHANGE_ID,
    kind: CHANGE_KIND,
    patterns: [CHANGES_ADDRESS_PREFIX + '**'],
    title: (address: string) => changeFileTitle(address),
  }
}

/** Own the two tab types and their four keyed body/title seats. */
export function registerGitTabs(ctx: Context, t: Translate): void {
  const slots = ctx.get('slots')
  ctx.effect(() => ctx.sidebarRightTabs.register(gitDefinition(t)), 'dsh-next-git: git tab type')
  ctx.effect(() => ctx.sidebarRightTabs.register(changeDefinition()), 'dsh-next-git: change file tab type')

  const workspaces = ctx.get('workspaces')
  const openWorktreeSession = makeWorktreeOpener(ctx)
  const unregisterDeletedWorktree = makeWorktreeUnregister(ctx)
  const registerCreatedWorktree = workspaces === undefined ? undefined : async (path: string): Promise<void> => {
    await workspaces.create({ path })
  }
  const controlsFor = createGitAgentControls(ctx)

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
            // A partial share must name the unavailable session, not leave an empty seat.
            if (share.sessionId === undefined) return React.createElement(GitPanelUnavailable, { t })
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

  // The address identifies one file, side and session; keep one API per plugin
  // lifetime rather than creating one on every render of the change-view seat.
  const changeApi = createApi()
  ctx.effect(
    () =>
      slots.inject('sidebar.right.pane.tab', () =>
        slots.register(
          { name: 'sidebar.right.pane.tab', key: CHANGE_ID, locale: NS },
          (props: unknown) => {
            const share = props as { useTabInfo?: () => { tab: { navigation: { address: string } } } }
            // The framework hook can throw before a tab record is committed.
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

  ctx.effect(
    () =>
      slots.inject('sidebar.right.pane.tab.title', () =>
        slots.register(
          { name: 'sidebar.right.pane.tab.title', key: CHANGE_ID, locale: NS },
          (props: unknown) => {
            const share = props as { useTabInfo?: () => { tab: { navigation: { address: string } } } }
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

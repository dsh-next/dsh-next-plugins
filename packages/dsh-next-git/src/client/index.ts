/** Browser entry: locale, settings and composer wiring; the tab seats live in tabs/. */
import * as React from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createApi } from './api.ts'
import { BranchChip } from './composer/BranchChip.tsx'
import { en, englishTranslate, NS, zh } from './dictionaries.ts'
import { configurePanelApi } from './panel/store-registry.ts'
import { GitSettingsCard } from './settings/GitSettingsCard.tsx'
import { GIT_ID, registerGitTabs } from './tabs/register.ts'

export { GIT_ID, GIT_KIND, CHANGE_ID, CHANGE_KIND, gitDefinition, changeDefinition } from './tabs/register.ts'
export { makeWorktreeOpener, makeWorktreeUnregister } from './worktrees/navigation.ts'

export const inject = ['slots', 'locale', 'sidebarRightTabs', 'sessions', 'workspaces', 'uiWorkspace'] as const

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

  // Create the panel's same-origin RPC only when a committed seat needs it.
  configurePanelApi(() => createApi())
  const settingsApi = createApi()
  ctx.effect(() => slots.inject('plugins.bundle.config', () => slots.register(
    { name: 'plugins.bundle.config', key: GIT_ID, registrant: GIT_ID },
    () => React.createElement(GitSettingsCard, { api: settingsApi, t }),
  )), 'dsh-next-git: drafting settings')

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

  registerGitTabs(ctx, t)
}

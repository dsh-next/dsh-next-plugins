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
// Type-only: pulls the sidebar-right Context merge (ctx.sidebarRight,
// ctx.sidebarRightTabs), the slots SlotMap merges for the two keyed seats this
// package registers into, and the session standard-props merge (sessionId).
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import * as React from 'react'
import { createApi } from './api.ts'
import { configurePanelApi, GitPanel, GitTitle, BranchGlyph, type GitPanelProps } from './GitPanel.tsx'
import { en, englishTranslate, NS, zh, type MessageKey } from './dictionaries.ts'

/** The tab kind this package owns. */
export const GIT_KIND = 'git'

/** This implementation's identity in the tab system, and the body's slot key. */
export const GIT_ID = '@dsh-next/dsh-next-git'

/** Services required before registration. */
export const inject = ['slots', 'locale', 'sidebarRightTabs', 'sessions'] as const

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

/** One session face surface this entry needs for the agent verbs. */
interface SessionFaceLike {
  prompt(content: unknown[], mode: 'queue' | 'steer'): Promise<unknown>
}

/** The workspace registry face, as much of it as this entry needs. */
interface WorkspacesFaceLike {
  create(input: { path: string }): Promise<{ workspaceId: string }>
}

/** The workspace navigation face, as much of it as this entry needs. */
interface UiWorkspaceFaceLike {
  openWorkspace(workspaceId: string): Promise<void>
}

/**
 * Build the "open a session in this worktree" action.
 *
 * Registers the worktree as a workspace (idempotent) and navigates to a session
 * in it. Both services are resolved through the context rather than declared as
 * hard dependencies: the action is a convenience, and a host that does not
 * offer workspace navigation should still mount the panel.
 *
 * @param ctx - the client context.
 * @returns the action, or undefined when the host cannot navigate workspaces.
 */
export function makeWorktreeOpener(ctx: Context): ((path: string) => Promise<void>) | undefined {
  const available = (): boolean =>
    ctx.get('workspaces') !== undefined && ctx.get('uiWorkspace') !== undefined
  if (!available()) return undefined
  return async (path: string): Promise<void> => {
    const workspaces = ctx.get('workspaces') as WorkspacesFaceLike | undefined
    const uiWorkspace = ctx.get('uiWorkspace') as UiWorkspaceFaceLike | undefined
    if (workspaces === undefined || uiWorkspace === undefined) {
      throw new Error('workspace navigation is unavailable')
    }
    const view = await workspaces.create({ path })
    await uiWorkspace.openWorkspace(view.workspaceId)
  }
}

interface SessionsFace {
  scope?(id: string): unknown
  sessionOf?(ctx: unknown): SessionFaceLike | undefined
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

  ctx.effect(() => ctx.sidebarRightTabs.register(gitDefinition(t)), 'dsh-next-git: git tab type')

  const sessions = ctx.get('sessions') as SessionsFace | undefined
  const openWorktreeSession = makeWorktreeOpener(ctx)

  ctx.effect(
    () =>
      slots.inject('sidebar.right.pane.tab', () =>
        slots.register(
          { name: 'sidebar.right.pane.tab', key: GIT_ID, locale: NS },
          (props: unknown) => {
            const share = props as {
              sessionId?: string
              useTabInfo?: GitPanelProps['useTabInfo']
            }
            if (share.sessionId === undefined || share.useTabInfo === undefined) return null
            const sendPrompt = makePromptSender(sessions, share.sessionId)
            return React.createElement(GitPanel, {
              sessionId: share.sessionId,
              useTabInfo: share.useTabInfo,
              t,
              ...(sendPrompt === undefined ? {} : { sendPrompt }),
              ...(openWorktreeSession === undefined ? {} : { openWorktreeSession }),
            })
          },
        ),
      ),
    'dsh-next-git: git tab body',
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

/**
 * Build the prompt sender for one session, or undefined when the session face
 * cannot be resolved (the panel then hides the agent verbs rather than
 * offering an action that does nothing).
 */
export function makePromptSender(
  sessions: SessionsFace | undefined,
  sessionId: string,
): ((prompt: string) => Promise<void>) | undefined {
  if (sessions === undefined || typeof sessions.scope !== 'function' || typeof sessions.sessionOf !== 'function') {
    return undefined
  }
  const scoped = sessions.scope(sessionId)
  if (scoped === undefined) return undefined
  const face = sessions.sessionOf(scoped)
  if (face === undefined || typeof face.prompt !== 'function') return undefined
  return async (prompt: string) => {
    await face.prompt([{ type: 'text', text: prompt }], 'queue')
  }
}

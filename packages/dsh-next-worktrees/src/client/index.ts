/**
 * Browser-half entry for the worktrees plugin — runs inside the dsh web GUI.
 *
 * Strategy B registration: the stock `ui-workspace` loader row is disabled
 * by this package's cordis.patch.yml, and this entry materializes the
 * OFFICIAL workspace client (derived at build time, version- and
 * SHA-256-gated — see scripts/derive-workspace-browser.mjs) and applies it
 * under a context proxy that intercepts the `sidebar.workspaces`
 * registration. The official Browser component is wrapped by
 * {@link WorktreeBrowser}, which owns the nesting projection; every other
 * declaration (locale, stores, picker, directory-flow holes) registers
 * from the official source unchanged.
 *
 * The entry also owns the plugin's own surfaces: the locale dictionaries,
 * the derived-browser bridge (repo-row create button, hover facts), and
 * the body-level modal root (merge and delete).
 *
 * The `require` identifier is the loader-provided module resolver in
 * scope inside this bundle's factory closure (see loader-require.d.ts).
 */
import * as React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Context } from '@deepseek-ai/cordis'
import { runOfficialWorkspaceClient } from '../generated/workspace-browser.generated.mjs'
import { WorktreeBrowser } from './browser-wrapper.tsx'
import { installBridge } from './bridge.ts'
import { openDelete, openMerge, runCreateFlow } from './create-store.ts'
import { ModalHost } from './modal-host.tsx'
import { requestTopologyRefresh, rpc } from './rpc.ts'
import { configureWorktreeSweeper } from './sweeper.ts'
import { WORKTREE_STYLES } from './styles.ts'
import { en, englishTranslate, NS, zh, type MessageKey } from './dictionaries.ts'
import type {
  SessionsServiceLike,
  Translate,
  WorkspacesServiceLike,
} from './types.ts'

interface SlotsLike {
  inject(name: string, callback: () => unknown): void
  register(descriptor: Record<string, unknown>, component: unknown): unknown
}

interface LocaleLike {
  register(ns: string, dictionaries: { en: unknown; zh: unknown }): unknown
  bind(ns: string): unknown
}

interface ContextLike {
  get(name: string): unknown
  effect(setup: () => void | (() => void), label?: string): void
  slots: SlotsLike
  on(event: 'dispose', listener: () => void): void
}

/** The materialized official client (apply + its inject declaration). */
const official = runOfficialWorkspaceClient(require)

/**
 * The official client's own inject list (its apply reads remote, sessions,
 * workspaces, ... through ctx.get, and Cordis refuses an undeclared get),
 * unioned with the services this plugin's own surfaces read.
 */
export const inject: readonly string[] = Array.from(new Set([
  ...official.inject,
  'slots',
  'locale',
  'sessions',
  'workspaces',
]))

/**
 * Apply the browser half: official client under the register proxy, plus
 * the plugin's own surfaces.
 *
 * @param ctx - client root context (loose face; the strict Cordis types
 * couple to internals this wrapper deliberately avoids).
 */
export function apply(ctx: Context): void {
  const loose = ctx as unknown as ContextLike

  // Plugin-owned styles for the derived rows and modals (tokens only).
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.dshNextWorktrees = 'true'
    style.textContent = WORKTREE_STYLES
    document.head.append(style)
    return () => { style.remove() }
  }, 'dsh-next-worktrees: styles')

  const locale = loose.get('locale') as LocaleLike | undefined
  const t: Translate = (() => {
    if (locale !== undefined && typeof locale.bind === 'function') {
      const bound = locale.bind(NS) as Translate
      if (typeof bound === 'function') return bound
    }
    return englishTranslate as unknown as Translate
  })()
  ctx.effect(() => {
    if (locale === undefined || typeof locale.register !== 'function') return () => {}
    try {
      return locale.register(NS, { en, zh }) as () => void
    } catch {
      return () => {}
    }
  }, 'dsh-next-worktrees: dictionaries')

  const workspaces = loose.get('workspaces') as WorkspacesServiceLike | undefined
  const sessions = loose.get('sessions') as SessionsServiceLike | undefined

  // The derived-browser bridge: repo-row button gating, the auto-named
  // create flow, menu labels, and localized hover facts.
  ctx.effect(() => installBridge({
    createLabel: (repoLabel) => t('create.title' satisfies MessageKey, { repo: repoLabel }),
    requestCreate: (cwd) => {
      // Failures surface through the store (create-error modal); the
      // flow itself never rejects.
      void runCreateFlow({
        cwd,
        rpc,
        workspaces: workspaces ?? { create: async () => ({ workspaceId: '' }) },
        sessions: sessions ?? { create: async () => '', open: () => {} },
        onTopologyRefresh: requestTopologyRefresh,
      })
    },
    menuLabel: (key) => t(key as MessageKey),
    worktreeFacts: (decoration) => {
      const status = decoration.merged
        ? t('status.merged')
        : decoration.dirty
          ? t('status.dirty')
          : decoration.ahead > 0
            ? t('status.ahead', { count: decoration.ahead })
            : t('status.clean')
      return [
        decoration.title,
        `${t('row.facts.branch')}: ${decoration.branch}`,
        `${t('row.facts.status')}: ${status}`,
      ]
    },
    requestMenu: (action, decoration) => {
      if (action === 'refresh') {
        requestTopologyRefresh()
        return
      }
      if (action === 'merge') {
        openMerge(decoration, rpc)
        return
      }
      if (action === 'delete') {
        openDelete(decoration)
      }
    },
  }), 'dsh-next-worktrees: bridge')

  // The abandoned-worktree sweeper: same host-truth faces the delete
  // modal drives, minus the UI.
  ctx.effect(() => {
    if (workspaces === undefined) return () => {}
    configureWorktreeSweeper({
      removeWorktree: (input) => rpc('remove', { ...input, force: false }) as Promise<void>,
      deleteWorkspace: (workspaceId) => workspaces.delete(workspaceId),
    })
    return () => { configureWorktreeSweeper(undefined) }
  }, 'dsh-next-worktrees: sweeper')

  // The modal root: our overlays live in their own React tree at the body
  // level; the conversation and sidebar stay pure harness.
  ctx.effect(() => {
    if (workspaces === undefined || sessions === undefined) return () => {}
    const container = document.createElement('div')
    container.dataset.dshNextWorktreesModals = 'true'
    document.body.append(container)
    const root: Root = createRoot(container)
    root.render(React.createElement(ModalHost, { t, workspaces, sessions }))
    return () => {
      root.unmount()
      container.remove()
    }
  }, 'dsh-next-worktrees: modal root')

  const proxiedCtx = new Proxy(loose, {
    get(target, key, receiver) {
      if (key !== 'slots') return Reflect.get(target, key, receiver)
      const slots = Reflect.get(target, key, receiver) as SlotsLike | undefined
      if (slots === undefined || typeof slots.register !== 'function') return slots
      return new Proxy(slots, {
        get(slotTarget, slotKey, slotReceiver) {
          if (slotKey !== 'register') return Reflect.get(slotTarget, slotKey, slotReceiver)
          return (
            descriptor: Record<string, unknown>,
            component: unknown,
          ): unknown => {
            if (descriptor.name !== 'sidebar.workspaces') {
              return Reflect.apply(
                Reflect.get(slotTarget, 'register', slotReceiver) as (...a: unknown[]) => unknown,
                slotTarget,
                [descriptor, component],
              )
            }
            const OfficialBrowser = component as React.ComponentType<Record<string, unknown>>
            const Wrapped = (props: Record<string, unknown>): React.ReactElement =>
              React.createElement(WorktreeBrowser, {
                ...(props as object),
                OfficialBrowser,
              })
            return Reflect.apply(
              Reflect.get(slotTarget, 'register', slotReceiver) as (...a: unknown[]) => unknown,
              slotTarget,
              [descriptor, Wrapped],
            )
          }
        },
      })
    },
  })

  official.apply(proxiedCtx as unknown as Parameters<typeof official.apply>[0])
}


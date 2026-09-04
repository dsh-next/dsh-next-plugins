/**
 * Browser-half entry for the worktrees plugin — runs inside the dsh web GUI.
 *
 * Strategy B registration: the stock `ui-workspace` loader row is disabled
 * by this package's cordis.patch.yml, and this entry materializes the
 * OFFICIAL workspace client (derived at build time, version- and
 * SHA-256-gated — see scripts/derive-workspace-browser.mjs) and applies it
 * under a context proxy that intercepts the `sidebar.workspaces`
 * registration. The official Browser component is wrapped by
 * {@link WorktreeBrowser}, which will carry the nesting projection; every
 * other declaration (locale, stores, picker, directory-flow holes)
 * registers from the official source unchanged.
 *
 * The `require` identifier is the loader-provided module resolver in
 * scope inside this bundle's factory closure (see loader-require.d.ts).
 */
import * as React from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { runOfficialWorkspaceClient } from '../generated/workspace-browser.generated.mjs'
import { WorktreeBrowser } from './browser-wrapper.tsx'
import { WORKTREE_STYLES } from './styles.ts'

interface SlotsLike {
  inject(name: string, callback: () => unknown): void
  register(descriptor: Record<string, unknown>, component: unknown): unknown
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
 * The official client's own inject list, re-declared as this plugin's:
 * its apply reads services (remote, sessions, workspaces, ...) through
 * ctx.get, and Cordis refuses an undeclared get. Everything the browser
 * region needs is therefore everything this plugin declares.
 */
export const inject = official.inject

/**
 * Apply the browser half: official client under the register proxy.
 *
 * @param ctx - client root context (loose face; the strict Cordis types
 * couple to internals this wrapper deliberately avoids).
 */
export function apply(ctx: Context): void {
  const loose = ctx as unknown as ContextLike

  // Plugin-owned styles for the derived rows (tokens only; see styles.ts).
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.dshNextWorktrees = 'true'
    style.textContent = WORKTREE_STYLES
    document.head.append(style)
    return () => { style.remove() }
  }, 'dsh-next-worktrees: styles')

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

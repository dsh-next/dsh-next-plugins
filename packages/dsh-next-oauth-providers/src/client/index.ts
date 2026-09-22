/**
 * Browser half: the Models footer Add entry and the per-family seat inside the
 * native provider cards.
 */
import * as React from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { ProviderCardExtrasOwnerProps } from '@deepseek-ai/dsh-client-ui-settings-models/client'
import { SETTINGS_NS } from '../core/ids.ts'
import { createRpc } from './api.ts'
import { en, NS, resolveTranslate, zh } from './dictionaries.ts'
import { AddSubscription } from './AddSubscription.tsx'
import { notifyInvalidate } from './invalidate.ts'
import { SubscriptionCard } from './SubscriptionCard.tsx'

export const inject = ['slots', 'locale', 'remote'] as const

export function apply(ctx: Context): void {
  const slots = ctx.get('slots')
  const locale = ctx.get('locale')

  if (locale !== undefined) {
    // The locale SDK currently resolves an older slots namespace table than
    // this plugin. Use its public single-locale overload without a type cast.
    ctx.effect(() => locale.register(NS, 'en', en), 'oauth-providers: English dictionary')
    ctx.effect(() => locale.register(NS, 'zh', zh), 'oauth-providers: Chinese dictionary')
  }

  const t = resolveTranslate(locale !== undefined ? locale.bind(NS) : undefined)
  const rpc = createRpc()

  // The Models page refreshes on forwarded settings events; the seats in this
  // plugin live inside that page and need the same signal.
  const remote = ctx.get('remote')
  if (remote !== undefined && typeof remote.$on === 'function') {
    ctx.effect(() => remote.$on('settings/document-updated', () => { notifyInvalidate() }), 'oauth-providers: settings invalidation')
  }

  if (slots && typeof slots.inject === 'function') {
    slots.inject('settings.models.footer', () => slots.register(
      { name: 'settings.models.footer', id: 'dsh-next-oauth-providers-add', order: 10 },
      () => React.createElement(AddSubscription, { rpc, t }),
    ))
    // Keyed by the owning settings namespace: the plugin's own Loader entry id,
    // which is what the native page dispatches for its declared provider rows.
    slots.inject('settings.models.provider-card', () => slots.register(
      { name: 'settings.models.provider-card', id: 'dsh-next-oauth-providers-card', key: SETTINGS_NS, order: 10 },
      (owner: ProviderCardExtrasOwnerProps) => React.createElement(SubscriptionCard, { ...owner, rpc, t }),
    ))
  }
}

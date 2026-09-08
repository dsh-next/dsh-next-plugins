/**
 * Browser half: Models footer for subscription sign-in.
 */
import * as React from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'
import { createRpc } from './api.ts'
import { en, NS, resolveTranslate, zh } from './dictionaries.ts'
import { SubscriptionsFooter } from './SubscriptionsFooter.tsx'

export const inject = ['slots', 'locale'] as const

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

  if (slots && typeof slots.inject === 'function') {
    slots.inject('settings.models.footer', () => slots.register(
      { name: 'settings.models.footer', id: 'dsh-next-oauth-providers', order: 10 },
      () => React.createElement(SubscriptionsFooter, { rpc, t }),
    ))
  }
}

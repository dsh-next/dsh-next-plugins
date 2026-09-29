import * as React from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'
import { createApi } from './api.ts'
import { en, zh, NS, englishTranslate, type Translate } from './dictionaries.ts'
import { ProvidersSection } from './providers/ProvidersSection.tsx'

export const inject = ['slots', 'locale'] as const
export function apply(ctx: Context): void {
  const locale = ctx.get('locale')
  if (locale) {
    ctx.effect(() => locale.register(NS, 'en', en), 'decisions: English dictionary')
    ctx.effect(() => locale.register(NS, 'zh', zh), 'decisions: Chinese dictionary')
  }
  const t: Translate = locale ? locale.bind(NS) : englishTranslate
  const api = createApi()
  const slots = ctx.get('slots')
  slots?.inject('settings.models.footer', () => slots.register(
    { name: 'settings.models.footer', id: 'dsh-next-decisions', order: 20 },
    () => React.createElement(ProvidersSection, { api, t }),
  ))
}

import * as React from 'react'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import type { Context } from '@deepseek-ai/cordis'
import type { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.ts'
import { en, NS, zh } from '../src/client/dictionaries.ts'
import type { AddSubscriptionProps } from '../src/client/AddSubscription.tsx'

const require = createRequire(import.meta.url)

/** Load the published runtime's factory, stubbing only unused UI dependencies. */
function localeRuntime(): LocaleRuntime {
  let Runtime!: new (ctx: Context) => LocaleRuntime
  runInNewContext(readFileSync(require.resolve('@deepseek-ai/dsh-client-locale/client'), 'utf8'), {
    navigator: { languages: ['en'] },
    window: { __ModuleLoader__: { load(entry: { factory: (load: (id: string) => unknown) => { LocaleRuntime: typeof Runtime } }) {
      Runtime = entry.factory((id) => id.startsWith('react') ? require(id) : {}).LocaleRuntime
    } } },
  })
  return new Runtime({ emit: vi.fn() } as unknown as Context)
}

describe('browser plugin SDK contract', () => {
  it('registers both dictionaries and both Models seats, translates Chinese and disposes its namespace', () => {
    const locale = localeRuntime()
    const effects: (() => void)[] = []
    const components: Array<(props?: unknown) => React.ReactElement<AddSubscriptionProps>> = []
    const slots = {
      inject: vi.fn((_name: string, setup: () => void) => setup()),
      register: vi.fn((_options: unknown, component: (props?: unknown) => React.ReactElement<AddSubscriptionProps>) => {
        components.push(component)
        return () => {}
      }),
    }
    const ctx = {
      get: (name: string) => name === 'locale' ? locale : name === 'slots' ? slots : undefined,
      effect: (setup: () => () => void) => { effects.push(setup()) },
    } as unknown as Context
    apply(ctx)
    expect(locale.bind(NS)('add')).toBe(en.add)
    locale.setLocale('zh')
    expect(locale.bind(NS)('add')).toBe(zh.add)
    expect(components).toHaveLength(2)
    expect(components[0]!().props.t?.('add')).toBe(zh.add)
    expect(slots.inject).toHaveBeenCalledWith('settings.models.footer', expect.any(Function))
    expect(slots.inject).toHaveBeenCalledWith('settings.models.provider-card', expect.any(Function))
    expect(slots.register).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'settings.models.footer', id: 'dsh-next-oauth-providers-add' }),
      expect.any(Function),
    )
    expect(slots.register).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'settings.models.provider-card',
        id: 'dsh-next-oauth-providers-card',
        key: 'dsh-next-oauth-providers',
      }),
      expect.any(Function),
    )
    for (const dispose of effects) dispose()
    expect(locale.bind(NS)('add')).toBe('add')
    apply(ctx)
    expect(locale.bind(NS)('add')).toBe(zh.add)
    for (const dispose of effects) dispose()
  })
})

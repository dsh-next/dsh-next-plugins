import * as React from 'react'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import type { Context } from '@deepseek-ai/cordis'
import type { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.ts'
import { en, NS, zh } from '../src/client/dictionaries.ts'
import type { SubscriptionsFooterProps } from '../src/client/SubscriptionsFooter.tsx'

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
  it('registers both dictionaries with the SDK receiver, translates Chinese and disposes its namespace', () => {
    const locale = localeRuntime()
    const effects: (() => void)[] = []
    let render!: () => React.ReactElement<SubscriptionsFooterProps>
    const slots = {
      inject: vi.fn((_name: string, setup: () => void) => setup()),
      register: vi.fn((_options: unknown, component: typeof render) => { render = component; return () => {} }),
    }
    const ctx = {
      get: (name: string) => name === 'locale' ? locale : name === 'slots' ? slots : undefined,
      effect: (setup: () => () => void) => { effects.push(setup()) },
    } as unknown as Context
    apply(ctx)
    expect(locale.bind(NS)('title')).toBe(en.title)
    locale.setLocale('zh')
    expect(locale.bind(NS)('title')).toBe(zh.title)
    expect(render().props.t?.('title')).toBe(zh.title)
    expect(slots.inject).toHaveBeenCalledWith('settings.models.footer', expect.any(Function))
    for (const dispose of effects) dispose()
    expect(locale.bind(NS)('title')).toBe('title')
    apply(ctx)
    expect(locale.bind(NS)('title')).toBe(zh.title)
    for (const dispose of effects) dispose()
  })
})

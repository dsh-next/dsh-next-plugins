/**
 * Client-entry wiring: the locale service pattern. The dictionaries register
 * under this package's namespace, the settings section carries a function
 * label bound to that namespace, a duplicate registration cannot break the
 * panel (aggregate bundles can double-apply), and a composition without the
 * locale service degrades to English. Uses the identity-bind double pattern
 * the wider plugin ecosystem uses (the bound key is the assertion target).
 */
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { apply } from '../src/client/index.ts'
import { en, interpolate, NS, zh } from '../src/client/dictionaries.ts'

interface RegisteredSection {
  name: string
  id?: string
  label?: string | (() => string)
  locale?: string
  order?: number
}

interface LocaleDouble {
  registered: Map<string, Record<string, Record<string, string>>>
  bindImpl: (key: string) => string
  registerThrows: boolean
}

interface Fixture {
  ctx: Context
  sections: RegisteredSection[]
  locale: LocaleDouble
}

function makeFixture(over: { locale?: LocaleDouble; withLocale?: boolean } = {}): Fixture {
  const sections: RegisteredSection[] = []
  const locale: LocaleDouble = over.locale ?? { registered: new Map(), bindImpl: (k) => k, registerThrows: false }
  const ctx = {
    effect: (fn: () => (() => void) | void) => {
      const off = fn()
      return typeof off === 'function' ? off : () => {}
    },
    get: (name: string) => {
      if (name === 'slots') {
        return {
          register: (options: RegisteredSection) => {
            sections.push(options)
            return () => { const i = sections.indexOf(options); if (i >= 0) sections.splice(i, 1) }
          },
        }
      }
      // The locale service rides ctx.get in the entry (the only legal
      // optional read); the double serves it when the fixture has one.
      if (name === 'locale' && over.withLocale !== false) {
        return {
          register: (ns: string, dicts: Record<string, Record<string, string>>) => {
            if (locale.registerThrows) throw new Error(`locale namespace "${ns}" already has locale "en"`)
            locale.registered.set(ns, dicts)
            return () => { locale.registered.delete(ns) }
          },
          bind: (ns: string) => (key: string) => locale.bindImpl(`${ns}:${key}`),
        }
      }
      return undefined
    },
  } as unknown as Context
  return { ctx, sections, locale }
}

const sectionOf = (f: Fixture): RegisteredSection | undefined =>
  f.sections.find((s) => s.name === 'settings.section' && s.id === 'cc-plugins')

describe('client apply localization wiring', () => {
  it('registers the en and zh dictionaries under the cc-plugins namespace', () => {
    const f = makeFixture()
    apply(f.ctx)
    const dicts = f.locale.registered.get(NS)
    expect(dicts?.en).toEqual(en)
    expect(dicts?.zh).toEqual(zh)
  })

  it('registers the section with a namespaced function label', () => {
    const f = makeFixture()
    apply(f.ctx)
    const section = sectionOf(f)
    expect(section).toBeDefined()
    expect(section?.locale).toBe(NS)
    expect(section?.order).toBe(17)
    // The identity bind surfaces the namespaced key: the label resolves
    // through the locale service at call time, not a captured string.
    expect(typeof section?.label).toBe('function')
    expect((section?.label as () => string)()).toBe('cc-plugins:nav')
  })

  it('survives a duplicate dictionary registration (double apply)', () => {
    const f = makeFixture({ locale: { registered: new Map(), bindImpl: (k) => k, registerThrows: true } })
    expect(() => apply(f.ctx)).not.toThrow()
    // The section still registered despite the dictionaries throwing.
    expect(sectionOf(f)).toBeDefined()
  })

  it('renders English without the locale service', () => {
    const f = makeFixture({ withLocale: false })
    apply(f.ctx)
    const section = sectionOf(f)
    expect(section?.locale).toBe(NS)
    // No service: the label function falls back to the English dictionary.
    expect((section?.label as () => string)()).toBe(en.nav)
  })
})

describe('dictionary parity', () => {
  it('zh mirrors every en key with non-empty values', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
    for (const value of Object.values(zh)) expect(value.length).toBeGreaterThan(0)
    for (const value of Object.values(en)) expect(value.length).toBeGreaterThan(0)
  })

  it('every zh value that differs from en contains Chinese characters', () => {
    // Guards against untranslated copy-paste English slipping in.
    for (const [key, value] of Object.entries(zh)) {
      if (value === en[key as keyof typeof en]) continue
      expect(/[\u4e00-\u9fff]/.test(value), `zh[${key}] carries CJK`).toBe(true)
    }
  })

  it('interpolate substitutes known params and leaves unknown names', () => {
    expect(interpolate('installed {version}', { version: '1.2.0' })).toBe('installed 1.2.0')
    expect(interpolate('{count} of {total}', { count: 2 })).toBe('2 of {total}')
    expect(interpolate('plain')).toBe('plain')
  })
})

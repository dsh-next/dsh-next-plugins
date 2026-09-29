import { describe, expect, it, vi } from 'vitest'
import { createConfigScope } from '../src/host/config-scope.ts'

describe('host config scope', () => {
  it('falls back from a failed settings description to the live fiber', () => {
    const scope = createConfigScope({
      entryId: 'oauth',
      entry: { options: { config: { providers: { xai: { displayName: 'Grok' } } } } },
      settings: { describe: () => { throw new Error('unavailable') } },
    })
    expect(scope.get()).toEqual({ providers: { xai: { displayName: 'Grok' } } })
  })

  it('keeps the existing provider section when an update omits it', async () => {
    const providers = { xai: { displayName: 'Grok' } }
    const edit = vi.fn(async (_entry: unknown, change: (current: Record<string, unknown>, inherited: Record<string, unknown>) => Record<string, unknown>) => {
      expect(change({ keep: true }, {})).toEqual({ keep: true, providers })
    })
    const scope = createConfigScope({
      entryId: 'oauth',
      entry: { options: { config: { providers } } },
      editor: { edit },
    })
    await scope.update({})
    expect(edit).toHaveBeenCalledOnce()
  })

  it('does not write when the config editor or fiber entry is unavailable', async () => {
    const edit = vi.fn()
    const withoutEntry = createConfigScope({ entryId: 'oauth', entry: undefined, editor: { edit } })
    const withoutEditor = createConfigScope({ entryId: 'oauth', entry: {} })
    await withoutEntry.replace({ providers: { xai: {} } })
    await withoutEditor.replace({ providers: { xai: {} } })
    expect(edit).not.toHaveBeenCalled()
    expect(withoutEntry.get()).toEqual({ providers: [] })
  })
})

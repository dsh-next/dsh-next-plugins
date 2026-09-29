// @vitest-environment node
import type { CredentialKey, CredentialProvider, CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_BASE_URL, DecisionError, SERVICE_KEY, type DecisionProvider } from '../src/core/types.ts'
import { Config, configStore, type ConfigEditor } from '../src/host/config.ts'
import { decisionKeys } from '../src/host/credentials.ts'

function provider(overrides: Partial<DecisionProvider> = {}): DecisionProvider {
  return { id: 'typesafe', name: 'TypeSafe', baseUrl: DEFAULT_BASE_URL, models: [{ id: 'decision-model-v1' }], ...overrides }
}
function editorFixture(options: { id?: string; inherited?: Record<string, unknown>; override?: Record<string, unknown> } = {}) {
  const entry = { id: options.id ?? SERVICE_KEY }
  const unrelated = { entry: { id: 'unrelated-plugin' }, inherited: {}, override: { untouched: true } }
  const current = { entry, inherited: options.inherited ?? {}, override: options.override ?? {} }
  const rows: ReturnType<ConfigEditor['configuration']> = [unrelated, current]
  const editor = {
    entries: vi.fn(() => [unrelated.entry, entry]),
    configuration: vi.fn(() => rows),
    edit: vi.fn<ConfigEditor['edit']>(async (target, change) => {
      expect(target).toBe(entry)
      current.override = change(current.override, current.inherited)
    }),
  } satisfies ConfigEditor
  return { entry, current, unrelated, rows, editor }
}
function credentialFixture() {
  const records = new Map<CredentialKey, CredentialRecord>()
  const port = {
    readRecord: vi.fn<CredentialProvider['readRecord']>(async key => records.get(key)),
    modifyRecord: vi.fn<CredentialProvider['modifyRecord']>(async (key, change) => {
      const next = await change(records.get(key))
      if (next !== undefined) records.set(key, next)
      return records.get(key)
    }),
    deleteRecord: vi.fn<CredentialProvider['deleteRecord']>(async key => { records.delete(key) }),
    resolve: vi.fn<CredentialProvider['resolve']>(),
    set: vi.fn<CredentialProvider['set']>(),
    unset: vi.fn<CredentialProvider['unset']>(),
    listRecords: vi.fn<CredentialProvider['listRecords']>(),
  }
  // The adapter only needs record operations; other service lifecycle methods are not involved.
  const keys = decisionKeys(port as unknown as CredentialProvider)
  return { records, port, keys }
}

describe('Config schema', () => {
  it('defaults to no explicit providers and exposes a volatile reference', () => {
    const config = Config({})
    expect(config.providers.get()).toEqual([])
    expect(Config.dict?.providers.meta.volatile).toBe(true)
    expect(Object.keys(Config.dict ?? {})).toEqual(['providers'])
    expect(Object.keys(Config.dict?.providers.inner?.dict ?? {}).sort()).toEqual(['baseUrl', 'id', 'modelIds', 'models', 'name'])
    expect(Object.keys(Config.dict?.providers.inner?.dict?.models.inner?.dict ?? {}).sort()).toEqual(['contextWindow', 'id', 'name'])
  })
  it('accepts optional canonical row metadata through the real schema without manufacturing capabilities', () => {
    const input = [provider({ models: [{ id: 'explicit-a', name: 'Display A', contextWindow: 128_000 }, { id: 'explicit-b' }] })]
    const config = Config({ providers: input })
    expect(config.providers.get()).toEqual([{ ...input[0], modelIds: [] }])
    expect(configStore(config, undefined).read()).toEqual(input)
    expect(Object.keys(configStore(config, undefined).read()[0].models[1])).toEqual(['id'])
  })
  it('accepts legacy modelIds in the host schema until the next canonical save', () => {
    const legacy = [{ id: 'typesafe', name: 'TypeSafe', baseUrl: DEFAULT_BASE_URL, modelIds: ['explicit-a', 'explicit-b'] }]
    const config = Config({ providers: legacy })
    expect(config.providers.get()).toEqual([{ ...legacy[0], models: [] }])
    expect(configStore(config, undefined).read()).toEqual([provider({ models: [{ id: 'explicit-a' }, { id: 'explicit-b' }] })])
  })
  it.each([{ maxOutputTokens: 2048 }, { imageInput: true }])('does not silently drop unsupported model capabilities %# at the host schema boundary', capability => {
    const input = [{ ...provider(), models: [{ id: 'choice', ...capability }] }]
    expect(() => {
      const config = Config({ providers: input })
      configStore(config, undefined).read()
    }).toThrow()
  })
  it.each([
    { providers: 'not-an-array' },
    { providers: [1] },
    { providers: [{ ...provider(), id: 1 }] },
    { providers: [{ ...provider(), name: false }] },
    { providers: [{ ...provider(), baseUrl: [] }] },
    { providers: [{ ...provider(), models: 'discover' }] },
    { providers: [{ ...provider(), models: [1] }] },
    { providers: [{ ...provider(), models: [{ id: 1 }] }] },
    { providers: [{ ...provider(), models: [{ id: 'choice', contextWindow: '128K' }] }] },
    { providers: [{ ...provider(), modelIds: 'discover' }] },
    { providers: [{ ...provider(), modelIds: [1] }] },
  ])('rejects malformed structural configuration %#', value => {
    expect(() => Config(value as unknown as Parameters<typeof Config>[0])).toThrow()
  })
})

describe('configStore reads and writability', () => {
  it.each([undefined, {}, { providers: { get: () => undefined } }, { providers: { get: () => null } }])('defaults missing fallback config %# to read-only empty providers', config => {
    const store = configStore(config, undefined)
    expect(store.writable).toBe(false)
    expect(store.read()).toEqual([])
  })
  it('reads a live fallback reference rather than caching or exposing its arrays', () => {
    let raw = [provider()]
    const get = vi.fn(() => raw)
    const store = configStore({ providers: { get } }, undefined)
    const first = store.read()
    first[0].models[0].id = 'caller-only'
    first.push(provider({ id: 'caller-only' }))
    expect(store.read()).toEqual([provider()])
    raw = [provider({ id: 'new-provider' })]
    expect(store.read()).toEqual(raw)
    expect(get).toHaveBeenCalledTimes(3)
  })
  it.each([SERVICE_KEY, `include:${SERVICE_KEY}`])('uses the matching editor entry %s instead of fallback config', id => {
    const fixture = editorFixture({ id, inherited: { providers: [provider()] } })
    const get = vi.fn(() => [provider({ id: 'fallback' })])
    const store = configStore({ providers: { get } }, fixture.editor)
    expect(store.writable).toBe(true)
    expect(store.read()).toEqual([provider()])
    expect(get).not.toHaveBeenCalled()
    fixture.current.inherited = { providers: [provider({ id: 'updated' })] }
    expect(store.read()).toEqual([provider({ id: 'updated' })])
  })
  it('stays read-only for an unrelated editor entry and never edits it', async () => {
    const fixture = editorFixture({ id: 'not-dsh-next-decisions', override: { providers: [provider({ id: 'unrelated' })] } })
    const store = configStore({ providers: { get: () => [provider()] } }, fixture.editor)
    expect(store.writable).toBe(false)
    expect(store.read()).toEqual([provider()])
    await expect(store.write([], [provider()])).rejects.toMatchObject({ name: 'DecisionError', code: 'read-only' })
    expect(fixture.editor.edit).not.toHaveBeenCalled()
    expect(fixture.editor.configuration).not.toHaveBeenCalled()
  })
  it('rejects writes without an editor even when fallback providers exist', async () => {
    const store = configStore({ providers: { get: () => [provider()] } }, undefined)
    await expect(store.write([], store.read())).rejects.toMatchObject({ name: 'DecisionError', code: 'read-only' })
    expect(store.read()).toEqual([provider()])
  })
  it('prefers overrides to inherited providers without merging their arrays', () => {
    const fixture = editorFixture({ inherited: { providers: [provider({ id: 'inherited' })] }, override: { providers: [provider({ id: 'override' })] } })
    const store = configStore(undefined, fixture.editor)
    expect(store.read()).toEqual([provider({ id: 'override' })])
    fixture.current.override = { providers: [] }
    expect(store.read()).toEqual([])
    fixture.current.override = { unrelated: 'keep' }
    expect(store.read()).toEqual([provider({ id: 'inherited' })])
  })
  it('migrates legacy rows in editor configuration on read without mutating that layer', () => {
    const legacy = { id: 'typesafe', name: 'TypeSafe', baseUrl: DEFAULT_BASE_URL, modelIds: ['old-one', 'old-two'] }
    const fixture = editorFixture({ override: { providers: [legacy], untouched: true } })
    expect(configStore(undefined, fixture.editor).read()).toEqual([provider({ models: [{ id: 'old-one' }, { id: 'old-two' }] })])
    expect(fixture.current.override).toEqual({ providers: [legacy], untouched: true })
  })
  it('defaults a matching entry with no provider layers to empty', () => {
    const fixture = editorFixture()
    fixture.rows[1] = { entry: fixture.entry }
    expect(configStore(undefined, fixture.editor).read()).toEqual([])
  })
  it('fails closed if a captured editor entry disappears instead of serving fallback state', () => {
    const fixture = editorFixture()
    const store = configStore({ providers: { get: () => [provider()] } }, fixture.editor)
    fixture.rows.splice(1)
    expect(() => store.read()).toThrowError(new DecisionError('configuration'))
  })
  it.each([
    ['invalid collection', {}, 'configuration'],
    ['invalid provider', [{ ...provider(), id: 'BAD' }], 'invalid-provider'],
    ['no explicit models', [provider({ models: [] })], 'invalid-models'],
    ['duplicate model IDs', [provider({ models: [{ id: 'duplicate' }, { id: 'duplicate', contextWindow: 1 }] })], 'invalid-models'],
    ['sparse model rows', [provider({ models: Array(1) })], 'invalid-models'],
    ['invalid advertised context', [provider({ models: [{ id: 'choice', contextWindow: 1_000_001 }] })], 'invalid-models'],
    ['duplicate IDs', [provider(), provider()], 'configuration'],
  ])('validates %s in both fallback and editor-backed reads', (_label, providers, code) => {
    const fixture = editorFixture({ override: { providers } })
    for (const store of [configStore({ providers: { get: () => providers } }, undefined), configStore(undefined, fixture.editor)]) {
      expect(() => store.read()).toThrowError(expect.objectContaining({ name: 'DecisionError', code }))
    }
  })
  it('propagates fallback and editor read failures without substituting empty state', () => {
    const error = new Error('configuration unavailable')
    const store = configStore({ providers: { get() { throw error } } }, undefined)
    expect(() => store.read()).toThrow(error)
    const fixture = editorFixture()
    fixture.editor.configuration.mockImplementation(() => { throw error })
    expect(() => configStore(undefined, fixture.editor).read()).toThrow(error)
  })
})

describe('configStore persistence and compare-and-swap', () => {
  it.each([SERVICE_KEY, `include:${SERVICE_KEY}`])('persists create/edit/remove through %s while preserving unrelated overrides', async id => {
    const fixture = editorFixture({ id, inherited: { inheritedOnly: 'not copied' }, override: { unrelated: { enabled: true } } })
    const store = configStore(undefined, fixture.editor)
    const first = [provider()]
    await store.write(first, [])
    expect(store.read()).toEqual(first)
    expect(fixture.current.override).toEqual({ unrelated: { enabled: true }, providers: first })
    const updated = [provider({ name: 'Renamed', models: [{ id: 'explicit-b', name: 'Display B', contextWindow: 128_000 }, { id: 'explicit-c' }] })]
    await store.write(updated, store.read())
    expect(configStore(undefined, fixture.editor).read()).toEqual(updated)
    await store.write([], store.read())
    expect(store.read()).toEqual([])
    expect(fixture.current.override).toEqual({ unrelated: { enabled: true }, providers: [] })
    expect(fixture.current.inherited).toEqual({ inheritedOnly: 'not copied' })
    expect(fixture.unrelated.override).toEqual({ untouched: true })
    expect(fixture.editor.edit).toHaveBeenCalledTimes(3)
  })
  it('round-trips a YAML-compatible configEditor document, migrates legacy models, preserves other providers, CAS and separate secrets', async () => {
    const legacy = { id: 'typesafe', name: 'TypeSafe', baseUrl: DEFAULT_BASE_URL, modelIds: ['old-choice'] }
    const other = provider({ id: 'other', models: [{ id: 'keep', name: 'Untouched', contextWindow: 1_000_000 }] })
    const fixture = editorFixture({ inherited: { global: 'inherited-only' }, override: { providers: [legacy, other], unrelated: { enabled: true } } })
    const keys = credentialFixture()
    await keys.keys.write('typesafe', 'isolated-secret')
    const store = configStore(undefined, fixture.editor)
    const snapshot = store.read()
    expect(snapshot).toEqual([provider({ models: [{ id: 'old-choice' }] }), other])
    expect(fixture.current.override.providers).toEqual([legacy, other])
    let document = ''
    fixture.editor.edit.mockImplementation(async (_entry, change) => {
      // JSON flow notation is a valid YAML 1.2 document and serializes the whole editor override.
      document = JSON.stringify(change(fixture.current.override, fixture.current.inherited))
      fixture.current.override = JSON.parse(document)
    })
    const updated = provider({ models: [{ id: 'new-choice', name: 'Displayed choice', contextWindow: 128_000 }] })
    await store.write([updated, snapshot[1]], snapshot)
    expect(JSON.parse(document)).toEqual({ providers: [updated, other], unrelated: { enabled: true } })
    expect(document).not.toContain('modelIds')
    expect(document).not.toContain('isolated-secret')
    expect(fixture.current.inherited).toEqual({ global: 'inherited-only' })
    expect(fixture.unrelated.override).toEqual({ untouched: true })
    expect(store.read()).toEqual([updated, other])
    expect(await keys.keys.read('typesafe')).toBe('isolated-secret')
    expect(keys.port.deleteRecord).not.toHaveBeenCalled()
    const stale = structuredClone(fixture.current.override)
    await expect(store.write([updated], snapshot)).rejects.toMatchObject({ code: 'conflict' })
    expect(fixture.current.override).toEqual(stale)
  })
  it('persists an explicit empty override to remove inherited providers without mutating inheritance', async () => {
    const inherited = { providers: [provider()], inheritedOnly: true }
    const fixture = editorFixture({ inherited, override: { unrelated: 'keep' } })
    const store = configStore(undefined, fixture.editor)
    await store.write([], store.read())
    expect(store.read()).toEqual([])
    expect(fixture.current.override).toEqual({ unrelated: 'keep', providers: [] })
    expect(inherited).toEqual({ providers: [provider()], inheritedOnly: true })
  })
  it('uses normalized persisted state for compare-and-swap', async () => {
    const fixture = editorFixture({ override: { providers: [provider({ name: '  TypeSafe  ', baseUrl: `${DEFAULT_BASE_URL}///` })] } })
    const store = configStore(undefined, fixture.editor)
    expect(store.read()).toEqual([provider()])
    await store.write([provider({ name: 'Updated' })], store.read())
    expect(store.read()).toEqual([provider({ name: 'Updated' })])
  })
  it.each(['override', 'inherited'] as const)('rejects stale expected providers when the %s layer changes', async layer => {
    const fixture = editorFixture({ [layer]: { providers: [provider()], unrelated: 'keep' } })
    const store = configStore(undefined, fixture.editor)
    const expected = store.read()
    fixture.current[layer] = { providers: [provider({ models: [{ id: 'externally-changed', contextWindow: 64_000 }] })], unrelated: 'keep' }
    const before = structuredClone(fixture.current.override)
    await expect(store.write([], expected)).rejects.toMatchObject({ name: 'DecisionError', code: 'conflict' })
    expect(fixture.current.override).toEqual(before)
    expect(store.read()).toEqual([provider({ models: [{ id: 'externally-changed', contextWindow: 64_000 }] })])
  })
  it('does not conflict on unrelated config changes but preserves those changes', async () => {
    const fixture = editorFixture({ override: { providers: [provider()], unrelated: 'old' } })
    const store = configStore(undefined, fixture.editor)
    const expected = store.read()
    fixture.current.override = { ...fixture.current.override, unrelated: 'external edit' }
    await store.write([], expected)
    expect(fixture.current.override).toEqual({ providers: [], unrelated: 'external edit' })
  })
  it('compares against state inside the exclusive edit callback, not a pre-edit snapshot', async () => {
    const fixture = editorFixture({ override: { providers: [provider()] } })
    const store = configStore(undefined, fixture.editor)
    const expected = store.read()
    fixture.editor.edit.mockImplementation(async (_entry, change) => {
      fixture.current.override = { providers: [provider({ name: 'Changed while waiting for editor' })] }
      fixture.current.override = change(fixture.current.override, fixture.current.inherited)
    })
    await expect(store.write([], expected)).rejects.toMatchObject({ name: 'DecisionError', code: 'conflict' })
    expect(store.read()).toEqual([provider({ name: 'Changed while waiting for editor' })])
  })
  it('allows only one write from a shared stale snapshot', async () => {
    const fixture = editorFixture({ override: { providers: [provider()] } })
    const store = configStore(undefined, fixture.editor)
    const expected = store.read()
    const outcomes = await Promise.allSettled([
      store.write([provider({ name: 'First writer' })], expected),
      store.write([provider({ name: 'Second writer' })], expected),
    ])
    expect(outcomes[0].status).toBe('fulfilled')
    expect(outcomes[1]).toMatchObject({ status: 'rejected', reason: { name: 'DecisionError', code: 'conflict' } })
    expect(store.read()).toEqual([provider({ name: 'First writer' })])
  })
  it('validates current stored configuration inside the edit callback before overwriting it', async () => {
    const fixture = editorFixture({ override: { providers: [provider()] } })
    const store = configStore(undefined, fixture.editor)
    const expected = store.read()
    fixture.current.override = { providers: [provider({ models: [] })] }
    await expect(store.write([], expected)).rejects.toMatchObject({ name: 'DecisionError', code: 'invalid-models' })
    expect(fixture.current.override).toEqual({ providers: [provider({ models: [] })] })
  })
  it('awaits durable editor completion and propagates persistence failure', async () => {
    const fixture = editorFixture({ override: { providers: [provider()] } })
    const store = configStore(undefined, fixture.editor)
    let fail!: (reason: unknown) => void
    fixture.editor.edit.mockImplementation(() => new Promise<void>((_resolve, reject) => { fail = reject }))
    let settled = false
    const saving = store.write([], store.read())
    const assertion = expect(saving).rejects.toThrow('disk unavailable')
    void saving.then(() => { settled = true }, () => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    fail(new Error('disk unavailable'))
    await assertion
    expect(store.read()).toEqual([provider()])
  })
})

describe('decisionKeys credential storage', () => {
  it('stores and rereads secrets only under the Decisions-owned record namespace', async () => {
    const { records, port, keys } = credentialFixture()
    records.set('llm-typesafe/typesafe' as CredentialKey, { kind: 'api-key', key: 'other-plugin-secret' })
    await keys.write('typesafe', 'decisions-secret')
    expect(port.modifyRecord).toHaveBeenCalledExactlyOnceWith('dsh-next-decisions/typesafe', expect.any(Function))
    expect([...records]).toEqual([
      ['llm-typesafe/typesafe', { kind: 'api-key', key: 'other-plugin-secret' }],
      ['dsh-next-decisions/typesafe', { kind: 'api-key', key: 'decisions-secret' }],
    ])
    expect(await keys.read('typesafe')).toBe('decisions-secret')
    expect(port.readRecord).toHaveBeenCalledExactlyOnceWith('dsh-next-decisions/typesafe')
    expect(port.resolve).not.toHaveBeenCalled()
    expect(port.set).not.toHaveBeenCalled()
    expect(port.unset).not.toHaveBeenCalled()
    expect(port.listRecords).not.toHaveBeenCalled()
  })
  it('keeps provider IDs isolated and observes rotations on every read', async () => {
    const { records, keys } = credentialFixture()
    await keys.write('provider-a', 'secret-a')
    await keys.write('provider-b', 'secret-b')
    expect(await keys.read('provider-a')).toBe('secret-a')
    expect(await keys.read('provider-b')).toBe('secret-b')
    records.set('dsh-next-decisions/provider-a' as CredentialKey, { kind: 'api-key', key: 'rotated' })
    expect(await keys.read('provider-a')).toBe('rotated')
    expect(await keys.read('provider-b')).toBe('secret-b')
  })
  it('returns undefined for an absent record without discovering ambient or another plugin key', async () => {
    const { records, port, keys } = credentialFixture()
    records.set('llm-typesafe/typesafe' as CredentialKey, { kind: 'api-key', key: 'not-ours' })
    port.resolve.mockResolvedValue({ value: 'ambient-secret', source: 'env' })
    expect(await keys.read('typesafe')).toBeUndefined()
    expect(port.resolve).not.toHaveBeenCalled()
    expect(port.listRecords).not.toHaveBeenCalled()
  })
  it('writes exactly an api-key record, replacing stale grant and environment payloads', async () => {
    const { records, port, keys } = credentialFixture()
    const address = 'dsh-next-decisions/typesafe' as CredentialKey
    records.set(address, { kind: 'grant', payload: { token: 'stale' } })
    await keys.write('typesafe', 'replacement')
    expect(records.get(address)).toEqual({ kind: 'api-key', key: 'replacement' })
    records.set(address, { kind: 'api-key', key: 'old', env: { OLD_SECRET: 'do-not-retain' } })
    await keys.write('typesafe', 'rotated')
    expect(records.get(address)).toEqual({ kind: 'api-key', key: 'rotated' })
    expect(port.readRecord).not.toHaveBeenCalled()
    expect(port.deleteRecord).not.toHaveBeenCalled()
  })
  it('uses deleteRecord for clearing, including idempotent deletion, without touching other owners', async () => {
    const { records, port, keys } = credentialFixture()
    records.set('llm-typesafe/typesafe' as CredentialKey, { kind: 'api-key', key: 'not-ours' })
    await keys.write('typesafe', 'ours')
    port.modifyRecord.mockClear()
    await keys.write('typesafe', undefined)
    await keys.write('typesafe', undefined)
    expect(port.deleteRecord).toHaveBeenNthCalledWith(1, 'dsh-next-decisions/typesafe')
    expect(port.deleteRecord).toHaveBeenNthCalledWith(2, 'dsh-next-decisions/typesafe')
    expect(port.modifyRecord).not.toHaveBeenCalled()
    expect(await keys.read('typesafe')).toBeUndefined()
    expect([...records]).toEqual([['llm-typesafe/typesafe', { kind: 'api-key', key: 'not-ours' }]])
  })
  it.each([
    { kind: 'grant', payload: { token: 'not-an-api-key' } },
    { kind: 'api-key' }, { kind: 'api-key', env: { TOKEN: 'not-a-key' } },
    { kind: 'api-key', key: null }, { kind: 'api-key', key: 42 },
  ])('rejects an unusable stored record %# with a stable credential error', async record => {
    const { port, keys } = credentialFixture()
    port.readRecord.mockResolvedValue(record as CredentialRecord)
    await expect(keys.read('typesafe')).rejects.toMatchObject({ name: 'DecisionError', code: 'credentials', message: 'credentials' })
  })
  it.each(['', 'BAD', '1provider', 'provider_name', 'provider/id', '../provider', 'provider:secret', ' provider', 'provider ', 'a'.repeat(65), 'provider\0', 'provider\n', 'provider\r', 'provider\r\n', 'provider\u2028', 'provider\u2029'])('rejects invalid credential key identifier %j before any storage call', async id => {
    const { port, keys } = credentialFixture()
    await expect(keys.read(id)).rejects.toMatchObject({ name: 'DecisionError', code: 'invalid-provider' })
    await expect(keys.write(id, 'secret')).rejects.toMatchObject({ name: 'DecisionError', code: 'invalid-provider' })
    await expect(keys.write(id, undefined)).rejects.toMatchObject({ name: 'DecisionError', code: 'invalid-provider' })
    expect(port.readRecord).not.toHaveBeenCalled()
    expect(port.modifyRecord).not.toHaveBeenCalled()
    expect(port.deleteRecord).not.toHaveBeenCalled()
  })
  it.each(['readRecord', 'modifyRecord', 'deleteRecord'] as const)('propagates %s backend failures without reporting false success', async operation => {
    const { port, keys } = credentialFixture()
    const error = new Error('credential store unavailable')
    port[operation].mockRejectedValue(error)
    const result = operation === 'readRecord' ? keys.read('typesafe') : keys.write('typesafe', operation === 'deleteRecord' ? undefined : 'secret')
    await expect(result).rejects.toBe(error)
  })
  it('awaits credential writes and deletes before resolving', async () => {
    const { port, keys } = credentialFixture()
    let finishWrite!: (value: CredentialRecord | undefined) => void
    port.modifyRecord.mockImplementation(() => new Promise(resolve => { finishWrite = resolve }))
    let written = false
    const writing = keys.write('typesafe', 'secret').then(() => { written = true })
    await Promise.resolve()
    expect(written).toBe(false)
    finishWrite({ kind: 'api-key', key: 'secret' })
    await writing
    expect(written).toBe(true)

    let finishDelete!: () => void
    port.deleteRecord.mockImplementation(() => new Promise<void>(resolve => { finishDelete = resolve }))
    let deleted = false
    const deleting = keys.write('typesafe', undefined).then(() => { deleted = true })
    await Promise.resolve()
    expect(deleted).toBe(false)
    finishDelete()
    await deleting
    expect(deleted).toBe(true)
  })
})

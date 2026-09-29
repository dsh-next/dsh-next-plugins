// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BASE_URL, DecisionError, ERROR_CODES, RPC_PATH, SERVICE_KEY,
  type ChoiceQuestion, type ChoiceRequest, type DecisionProvider, type ErrorCode,
} from '../src/core/types.ts'
import {
  baseUrl, parseChoiceRequest, parseChoiceResponse, parseProvider, parseProviders, providerId, record,
} from '../src/core/validation.ts'

function provider(overrides: Partial<DecisionProvider> = {}): DecisionProvider {
  return { id: 'typesafe', name: 'TypeSafe', baseUrl: DEFAULT_BASE_URL, models: [{ id: 'decision-model-v1' }], ...overrides }
}
function question(overrides: Partial<ChoiceQuestion> = {}): ChoiceQuestion {
  return { type: 'choice', instructions: 'Choose the stated color.', criteria: { blue: 'Blue is stated.', green: null }, ...overrides }
}
function request(overrides: Partial<ChoiceRequest> = {}): ChoiceRequest {
  return { providerId: 'typesafe', modelId: 'decision-model-v1', state: 'The sky is blue.', questions: { color: question() }, ...overrides }
}
function response() {
  return {
    model: 'decision-model-v1-2026',
    answers: { color: { type: 'choice', choice: 'blue', probabilities: { blue: 0.8, green: 0.2 }, confidence: 0.6 } },
    usage: { input_tokens: 25, output_tokens: 7 },
  }
}
function rejects(run: () => unknown, code: ErrorCode): void {
  expect(run).toThrowError(expect.objectContaining({ name: 'DecisionError', message: code, code }))
}
const invalidText: Array<[string, unknown]> = [
  ['missing', undefined], ['null', null], ['number', 1], ['array', []], ['object', {}],
  ['empty', ''], ['blank', '   '], ['newline', 'a\nb'], ['NUL', 'a\0b'], ['DEL', 'a\x7fb'],
]

describe('public constants and DecisionError', () => {
  it('pins the decision-only service, RPC path, and default endpoint', () => {
    expect(SERVICE_KEY).toBe('dsh-next-decisions')
    expect(RPC_PATH).toBe('/dsh-next-decisions/rpc')
    expect(DEFAULT_BASE_URL).toBe('https://api.typesafe.ai/v1')
    expect(ERROR_CODES).toEqual([
      'invalid-provider', 'invalid-models', 'invalid-request', 'not-found', 'conflict', 'read-only',
      'credentials', 'configuration', 'network', 'http', 'invalid-response', 'busy', 'cancelled',
      'timeout', 'disposed', 'origin', 'failed',
    ])
  })
  it.each(ERROR_CODES)('exposes %s as a stable typed error without provider diagnostics', code => {
    const error = new DecisionError(code)
    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(DecisionError)
    expect(error.name).toBe('DecisionError')
    expect(error.message).toBe(code)
    expect(error.code).toBe(code)
    expect(error.stack).toContain(`DecisionError: ${code}`)
  })
})

describe('record', () => {
  it.each([{}, { nested: [] }, Object.create(null)])('accepts object records: %j', value => {
    expect(record(value)).toBe(true)
  })
  it.each([null, undefined, [], ['value'], 'value', 0, true, Symbol('record'), () => ({})].map(value => [value] as const))('rejects non-record %#', value => {
    expect(record(value)).toBe(false)
  })
})

describe('providerId', () => {
  it.each(['a', 'typesafe', 'local-2', `a${'0'.repeat(63)}`])('accepts the explicit identifier %s', id => {
    expect(providerId(id)).toBe(id)
  })
  it.each([
    ...invalidText, ['uppercase', 'TypeSafe'], ['digit prefix', '1typesafe'], ['hyphen prefix', '-typesafe'],
    ['underscore', 'type_safe'], ['namespace separator', 'llm/typesafe'], ['traversal', '../typesafe'],
    ['colon', 'typesafe:key'], ['leading whitespace', ' typesafe'], ['trailing whitespace', 'typesafe '],
    ['final LF', 'typesafe\n'], ['final CR', 'typesafe\r'], ['final CRLF', 'typesafe\r\n'],
    ['Unicode line separator', 'typesafe\u2028'], ['Unicode paragraph separator', 'typesafe\u2029'],
    ['overlong', 'a'.repeat(65)],
  ])('rejects %s identifiers', (_label, value) => rejects(() => providerId(value), 'invalid-provider'))
})

describe('baseUrl', () => {
  it.each([
    ['https://api.example.test', 'https://api.example.test'],
    ['https://API.EXAMPLE.TEST:443/v1///', 'https://api.example.test/v1'],
    ['https://api.example.test:8443/custom/v1/', 'https://api.example.test:8443/custom/v1'],
    ['http://localhost:8080/v1/', 'http://localhost:8080/v1'],
    ['http://127.0.0.1:8080/', 'http://127.0.0.1:8080'],
    ['http://[::1]:8080/v1/', 'http://[::1]:8080/v1'],
    ['https://api.example.test/path%3Fpart%23part/', 'https://api.example.test/path%3Fpart%23part'],
  ])('normalizes an allowed endpoint %s', (input, expected) => expect(baseUrl(input)).toBe(expected))

  it('accepts the URL length limit without truncating it', () => {
    const prefix = 'https://api.example.test/'
    const input = prefix + 'a'.repeat(2048 - prefix.length)
    expect(baseUrl(input)).toBe(input)
  })
  it.each([
    ...invalidText, ['relative', '/v1'], ['missing scheme', 'api.example.test/v1'],
    ['malformed URL', 'https://[invalid'], ['overlong', `https://api.example.test/${'a'.repeat(2048)}`],
    ['remote HTTP', 'http://api.example.test/v1'], ['LAN HTTP', 'http://192.168.1.2/v1'],
    ['near-loopback HTTP', 'http://127.0.0.2/v1'], ['IPv6 remote HTTP', 'http://[::2]/v1'],
    ['localhost lookalike', 'http://localhost.example.test/v1'], ['FTP', 'ftp://localhost/v1'],
    ['file', 'file:///tmp/v1'], ['JavaScript', 'javascript:alert(1)'],
    ['username', 'https://user@api.example.test/v1'], ['password', 'https://:secret@api.example.test/v1'],
    ['encoded credentials', 'https://user%40example:secret@api.example.test/v1'],
    ['query', 'https://api.example.test/v1?key=secret'], ['fragment', 'https://api.example.test/v1#part'],
    ['empty query', 'https://api.example.test/v1?'], ['empty fragment', 'https://api.example.test/v1#'],
  ])('rejects %s endpoints', (_label, value) => rejects(() => baseUrl(value), 'invalid-provider'))
})

describe('parseProvider', () => {
  it('normalizes names and URL but preserves case-sensitive exact IDs, order, and optional metadata', () => {
    const input = provider({ name: '  Local decisions  ', baseUrl: 'http://localhost:9000/v1///', models: [
      { id: 'org/Model:2026', name: '  Display model  ', contextWindow: 1_000_000 },
      { id: 'model-B', name: '   ' }, { id: 'model-b', contextWindow: 1 },
    ] })
    const parsed = parseProvider(input)
    expect(parsed).toEqual({ ...input, name: 'Local decisions', baseUrl: 'http://localhost:9000/v1', models: [
      { id: 'org/Model:2026', name: 'Display model', contextWindow: 1_000_000 },
      { id: 'model-B' }, { id: 'model-b', contextWindow: 1 },
    ] })
    expect(parsed).not.toBe(input)
    expect(parsed.models).not.toBe(input.models)
    expect(parsed.models[0]).not.toBe(input.models[0])
    parsed.models[0].name = 'Separate copy'
    parsed.models.push({ id: 'separate-copy' })
    expect(input.models[0].name).toBe('  Display model  ')
    expect(input.models).toHaveLength(3)
  })
  it('accepts inclusive provider name, model ID/name/context, and 100-model limits', () => {
    const input = provider({ name: 'n'.repeat(120), models: Array.from({ length: 100 }, (_, index) => ({
      id: `${index}`.padEnd(256, 'm'), name: 'N'.repeat(120), contextWindow: index === 0 ? 1 : 1_000_000,
    })) })
    expect(parseProvider(input)).toEqual(input)
  })
  it('accepts legacy modelIds on read but emits only canonical models in the same order', () => {
    const legacy = { id: 'typesafe', name: 'TypeSafe', baseUrl: DEFAULT_BASE_URL, modelIds: ['org/Model:2026', 'model-B'] }
    const parsed = parseProvider(legacy)
    expect(parsed).toEqual({ id: legacy.id, name: legacy.name, baseUrl: legacy.baseUrl, models: [{ id: 'org/Model:2026' }, { id: 'model-B' }] })
    expect(Object.hasOwn(parsed, 'modelIds')).toBe(false)
    legacy.modelIds[0] = 'changed'
    expect(parsed.models[0].id).toBe('org/Model:2026')
  })
  it('preserves canonical metadata when matching legacy IDs are present during a migration', () => {
    const models = [{ id: 'choice-1', name: 'Display one', contextWindow: 128_000 }, { id: 'choice-2' }]
    expect(parseProvider({ ...provider({ models }), modelIds: ['choice-1', 'choice-2'] })).toEqual(provider({ models }))
  })
  it.each([undefined, null, [], 'provider', 1].map(value => [value] as const))('rejects non-object provider %#', value => rejects(() => parseProvider(value), 'invalid-provider'))
  it.each([...invalidText, ['overlong', 'n'.repeat(121)]])('rejects %s display names', (_label, name) => {
    rejects(() => parseProvider({ ...provider(), name }), 'invalid-provider')
  })
  it.each(['apiKey', 'keyConfigured', 'discoverModels', 'chat', 'extra', 'maxOutputTokens', 'imageInput'])('rejects the undeclared %s provider field', field => {
    rejects(() => parseProvider({ ...provider(), [field]: true }), 'invalid-provider')
  })
  it('validates the provider identifier and URL', () => {
    rejects(() => parseProvider(provider({ id: 'BAD' })), 'invalid-provider')
    rejects(() => parseProvider(provider({ baseUrl: 'http://remote.example.test' })), 'invalid-provider')
  })
  it.each([
    ['missing', undefined], ['null', null], ['string', 'model'], ['object', {}], ['empty', []],
    ['duplicate ID', [{ id: 'model', name: 'First' }, { id: 'model', name: 'Second' }]],
    ['too many', Array.from({ length: 101 }, (_, index) => ({ id: `model-${index}` }))],
    ['sparse', Array(1)], ['hole between valid rows', [{ id: 'a' }, , { id: 'c' }]],
    ...invalidText.map(([label, value]): [string, unknown] => [`${label} model ID`, [{ id: value }]]),
    ['padded ID', [{ id: ' model' }]], ['trailing space', [{ id: 'model ' }]], ['overlong ID', [{ id: 'm'.repeat(257) }]],
    ['string row', ['model']], ['null row', [null]], ['array row', [[{ id: 'model' }]]],
  ])('requires explicit canonical model rows: %s', (_label, models) => rejects(() => parseProvider({ ...provider(), models }), 'invalid-models'))
  it.each(['maxOutputTokens', 'inputTokens', 'imageInput', 'supportsVision', 'capabilities', 'modelIds', 'extra'])('rejects undeclared %s model metadata instead of silently dropping it', field => {
    rejects(() => parseProvider(provider({ models: [{ id: 'model', [field]: true }] })), 'invalid-models')
  })
  it.each([null, 1, {}, [], 'a'.repeat(121)])('rejects invalid model display name %#', name => {
    rejects(() => parseProvider({ ...provider(), models: [{ id: 'model', name }] }), 'invalid-models')
  })
  it.each([...Array.from({ length: 32 }, (_, code) => [code, `before${String.fromCharCode(code)}after`] as const), [127, 'before\x7fafter'] as const])('rejects control character U+%i in a model display name', (_code, name) => {
    rejects(() => parseProvider({ ...provider(), models: [{ id: 'model', name }] }), 'invalid-models')
  })
  it.each([null, '128K', false, {}, 0, -1, Number.MIN_VALUE, 1.5, 1_000_001, Number.NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid advertised context %#', contextWindow => {
    rejects(() => parseProvider({ ...provider(), models: [{ id: 'model', contextWindow }] }), 'invalid-models')
  })
  it('permits duplicate display names but never duplicate IDs, even when metadata differs', () => {
    const models = [{ id: 'exact', name: 'Shared' }, { id: 'Exact', name: 'Shared' }]
    expect(parseProvider(provider({ models })).models).toEqual(models)
    rejects(() => parseProvider(provider({ models: [{ id: 'exact', contextWindow: 1 }, { id: 'exact', contextWindow: 128_000 }] })), 'invalid-models')
  })
  it.each([
    ['missing models', { models: undefined }], ['malformed legacy IDs', { models: undefined, modelIds: ['valid', null] }],
    ['legacy duplicate IDs', { models: undefined, modelIds: ['same', 'same'] }],
    ['legacy sparse IDs', { models: undefined, modelIds: Array(1) }],
    ['legacy padded ID', { models: undefined, modelIds: [' choice '] }],
    ['legacy control character ID', { models: undefined, modelIds: ['choice\n'] }],
    ['legacy overlong ID', { models: undefined, modelIds: ['x'.repeat(257)] }],
    ['legacy non-array', { models: undefined, modelIds: 'choice' }],
    ['conflicting migration order', { models: [{ id: 'first' }, { id: 'second' }], modelIds: ['second', 'first'] }],
    ['conflicting migration ID', { models: [{ id: 'first' }], modelIds: ['different'] }],
    ['conflicting migration length', { models: [{ id: 'first' }], modelIds: ['first', 'second'] }],
  ])('rejects %s without silently dropping configured model IDs', (_label, fields) => {
    rejects(() => parseProvider({ ...provider(), ...fields }), 'invalid-models')
  })
})

describe('parseProviders', () => {
  it('allows no providers and preserves order without sharing caller-owned arrays or rows', () => {
    expect(parseProviders([])).toEqual([])
    const input = [provider({ id: 'b' }), provider({ id: 'a' })]
    const parsed = parseProviders(input)
    expect(parsed).toEqual(input)
    expect(parsed).not.toBe(input)
    expect(parsed[0]).not.toBe(input[0])
    expect(parsed[0].models).not.toBe(input[0].models)
    expect(parsed[0].models[0]).not.toBe(input[0].models[0])
  })
  it('allows 50 distinct providers, including shared names and model IDs', () => {
    const input = Array.from({ length: 50 }, (_, index) => provider({ id: `provider-${index}` }))
    expect(parseProviders(input)).toEqual(input)
  })
  it('migrates every provider from mixed legacy and canonical rows without dropping metadata', () => {
    const providers = [provider({ models: [{ id: 'one', name: 'First', contextWindow: 1_000_000 }] }), { ...provider({ id: 'older' }), models: undefined, modelIds: ['old-a', 'old-b'] }]
    expect(parseProviders(providers)).toEqual([provider({ models: [{ id: 'one', name: 'First', contextWindow: 1_000_000 }] }), provider({ id: 'older', models: [{ id: 'old-a' }, { id: 'old-b' }] })])
  })
  it.each([undefined, null, {}, 'providers'])('rejects a non-array collection %#', value => rejects(() => parseProviders(value), 'configuration'))
  it('rejects over-capacity and duplicate identifiers', () => {
    rejects(() => parseProviders(Array.from({ length: 51 }, (_, index) => provider({ id: `provider-${index}` }))), 'configuration')
    rejects(() => parseProviders([provider(), provider({ name: 'Different name', models: [{ id: 'other' }] })]), 'configuration')
  })
  it('preserves precise validation errors from collection members, including sparse entries', () => {
    rejects(() => parseProviders([null]), 'invalid-provider')
    rejects(() => parseProviders(Array(1)), 'invalid-provider')
    rejects(() => parseProviders([provider({ models: [] })]), 'invalid-models')
    rejects(() => parseProviders([provider(), provider({ id: 'second', models: [{ id: 'valid' }, { id: 'broken', contextWindow: 1_000_001 }] })]), 'invalid-models')
  })
})

describe('parseChoiceRequest', () => {
  it.each(['', 'Text\nwith lines', {}, [], { nested: [null, true, 42, { value: 'data' }] }, ['one', 2, false, null]].map(state => [state] as const))('preserves JSON state %#', state => {
    const input = request({ state })
    expect(parseChoiceRequest(input)).toEqual(input)
  })
  it('takes a detached snapshot of all mutable request input', () => {
    const state = { nested: { items: ['original'] } }
    const input = request({ state })
    const parsed = parseChoiceRequest(input)
    state.nested.items[0] = 'changed'
    input.questions.color.criteria.blue = 'Changed criterion'
    input.questions.color.instructions = 'Changed instructions'
    expect(parsed.state).toEqual({ nested: { items: ['original'] } })
    expect(parsed.questions.color).toEqual(question())
    parsed.questions.color.criteria.green = 'Changed output'
    expect(input.questions.color.criteria.green).toBeNull()
  })
  it('accepts inclusive model, question-name, instruction, and description limits', () => {
    const input = request({ modelId: 'm'.repeat(256), questions: { ['q'.repeat(100)]: question({ instructions: 'i'.repeat(8000), criteria: { ['c'.repeat(256)]: 'd'.repeat(8000), other: '' } }) } })
    expect(parseChoiceRequest(input)).toEqual(input)
  })
  it('allows multiline instructions and descriptions without changing their content', () => {
    const input = request({ questions: { color: question({ instructions: 'First line\nSecond line', criteria: { blue: 'Line one\nLine two', green: null } }) } })
    expect(parseChoiceRequest(input)).toEqual(input)
  })
  it('accepts exactly 16 questions and exactly 255 criteria', () => {
    const questions = Object.fromEntries(Array.from({ length: 16 }, (_, index) => [`q${index}`, question()]))
    expect(parseChoiceRequest(request({ questions })).questions).toEqual(questions)
    const criteria = Object.fromEntries(Array.from({ length: 255 }, (_, index) => [`c${index}`, null]))
    expect(parseChoiceRequest(request({ questions: { color: question({ criteria }) } })).questions.color.criteria).toEqual(criteria)
  })
  it('enforces the complete serialized request size at 64,000 characters', () => {
    const input = request({ state: '' })
    input.state = 's'.repeat(64_000 - JSON.stringify(input).length)
    expect(JSON.stringify(input)).toHaveLength(64_000)
    expect(parseChoiceRequest(input)).toEqual(input)
    rejects(() => parseChoiceRequest({ ...input, state: `${input.state}s` }), 'invalid-request')
  })
  it.each([undefined, null, [], 'request', 1, true, Symbol('request'), () => ({}), 1n].map(value => [value] as const))('rejects non-request or non-JSON input %#', value => {
    rejects(() => parseChoiceRequest(value), 'invalid-request')
  })
  it('rejects cycles, BigInt, and failed serialization with the public error code', () => {
    const cycle: Record<string, unknown> = {}
    cycle.self = cycle
    rejects(() => parseChoiceRequest(request({ state: cycle })), 'invalid-request')
    rejects(() => parseChoiceRequest(request({ state: { big: 1n } })), 'invalid-request')
    rejects(() => parseChoiceRequest({ toJSON() { throw new Error('private serialization failure') } }), 'invalid-request')
  })
  it.each([
    ['undefined property', { value: undefined }], ['function property', { value: () => 'discarded' }],
    ['symbol property', { value: Symbol('discarded') }], ['NaN', { value: Number.NaN }],
    ['Infinity', { value: Number.POSITIVE_INFINITY }], ['negative Infinity', { value: Number.NEGATIVE_INFINITY }],
    ['undefined array entry', [undefined]], ['sparse array', Array(1)],
  ])('rejects %s rather than silently changing request state', (_label, state) => {
    rejects(() => parseChoiceRequest(request({ state })), 'invalid-request')
  })
  it('accepts shared but acyclic JSON objects and null-prototype state', () => {
    const shared = { value: 'shared' }
    const state = Object.assign(Object.create(null), { first: shared, second: shared })
    const parsed = parseChoiceRequest(request({ state }))
    expect(parsed.state).toEqual({ first: shared, second: shared })
    expect((parsed.state as Record<string, unknown>).first).not.toBe(shared)
  })
  it.each([
    ['Date', new Date('2026-01-01T00:00:00Z')], ['Map', new Map([['key', 'value']])],
    ['Set', new Set(['value'])], ['RegExp', /value/], ['custom prototype', Object.create({ inherited: true })],
    ['symbol-keyed property', { [Symbol('hidden')]: 'value' }],
    ['non-enumerable property', Object.defineProperty({}, 'hidden', { value: 'value' })],
    ['extra array property', Object.assign(['value'], { extra: 'discarded' })],
  ])('rejects non-JSON %s state without silently flattening it', (_label, state) => {
    rejects(() => parseChoiceRequest({ ...request(), state }), 'invalid-request')
  })
  it('rejects accessors and toJSON hooks without executing caller code', () => {
    let getterCalls = 0
    let toJSONCalls = 0
    const accessor = Object.defineProperty({}, 'value', { enumerable: true, get() { getterCalls += 1; return 'unsafe' } })
    const customJSON = { toJSON() { toJSONCalls += 1; return { replaced: true } } }
    rejects(() => parseChoiceRequest(request({ state: accessor })), 'invalid-request')
    rejects(() => parseChoiceRequest(request({ state: customJSON })), 'invalid-request')
    expect(getterCalls).toBe(0)
    expect(toJSONCalls).toBe(0)
  })
  it('bounds deeply nested state and maps introspection failures to invalid-request', () => {
    let state: Record<string, unknown> = {}
    for (let index = 0; index < 31; index += 1) state = { child: state }
    expect(parseChoiceRequest(request({ state })).state).toEqual(state)
    rejects(() => parseChoiceRequest(request({ state: { child: state } })), 'invalid-request')
    const broken = new Proxy({}, { ownKeys() { throw new Error('private introspection failure') } })
    rejects(() => parseChoiceRequest(request({ state: broken })), 'invalid-request')
    rejects(() => parseChoiceRequest(request({ state: Array(32_000).fill(0) })), 'invalid-request')
  })
  it.each(['modelIds', 'discoverModels', 'apiKey', 'extra'])('rejects undeclared request field %s', field => {
    rejects(() => parseChoiceRequest({ ...request(), [field]: true }), 'invalid-request')
  })
  it('does not let JSON serialization hide undeclared fields', () => {
    rejects(() => parseChoiceRequest({ ...request(), extra: undefined }), 'invalid-request')
    rejects(() => parseChoiceRequest(request({ questions: { color: { ...question(), extra: undefined } as ChoiceQuestion } })), 'invalid-request')
  })
  it.each([...invalidText, ['overlong', 'm'.repeat(257)]])('rejects %s explicit request model', (_label, modelId) => {
    rejects(() => parseChoiceRequest({ ...request(), modelId }), 'invalid-request')
  })
  it.each([undefined, null, true, 1])('rejects non-string/object/array state %#', state => {
    rejects(() => parseChoiceRequest({ ...request(), state }), 'invalid-request')
  })
  it('validates provider identifiers without replacing their error code for JSON input', () => {
    const missing: Partial<ChoiceRequest> = request()
    delete missing.providerId
    rejects(() => parseChoiceRequest(missing), 'invalid-provider')
    rejects(() => parseChoiceRequest(request({ providerId: 'other/namespace' })), 'invalid-provider')
  })
  it.each([undefined, null, [], 'questions', {}, Object.fromEntries(Array.from({ length: 17 }, (_, index) => [`q${index}`, question()]))].map(value => [value] as const))('rejects invalid questions collection %#', questions => {
    rejects(() => parseChoiceRequest({ ...request(), questions }), 'invalid-request')
  })
  it.each(['', ' ', 'q\n', 'q\0', 'q\x7f', 'q'.repeat(101)])('rejects invalid question name %j', id => {
    rejects(() => parseChoiceRequest(request({ questions: { [id]: question() } })), 'invalid-request')
  })
  it.each([
    undefined, null, [], 'question', { ...question(), extra: true }, { ...question(), type: 'boolean' },
    { ...question(), type: undefined }, { ...question(), instructions: undefined }, { ...question(), instructions: 1 },
    { ...question(), instructions: '' }, { ...question(), instructions: ' \n ' }, { ...question(), instructions: 'i'.repeat(8001) },
  ].map(value => [value] as const))('rejects malformed question %#', color => {
    rejects(() => parseChoiceRequest({ ...request(), questions: { color } }), 'invalid-request')
  })
  it.each([
    undefined, null, [], 'criteria', {}, { only: null },
    Object.fromEntries(Array.from({ length: 256 }, (_, index) => [`c${index}`, null])),
    { blue: undefined, green: null }, { blue: false, green: null }, { blue: 1, green: null },
    { blue: [], green: null }, { blue: {}, green: null }, { blue: 'd'.repeat(8001), green: null },
  ].map(value => [value] as const))('rejects malformed criteria %#', criteria => {
    rejects(() => parseChoiceRequest({ ...request(), questions: { color: { ...question(), criteria } } }), 'invalid-request')
  })
  it.each(['', ' ', 'c\n', 'c\0', 'c\x7f', 'c'.repeat(257)])('rejects invalid criterion name %j', key => {
    rejects(() => parseChoiceRequest(request({ questions: { color: question({ criteria: { [key]: null, other: null } }) } })), 'invalid-request')
  })
})

describe('parseChoiceResponse', () => {
  it('preserves the reported model and provider-derived confidence independently of the winning probability', () => {
    const input = response()
    const parsed = parseChoiceResponse(input, request())
    expect(parsed).toEqual(input)
    expect(parsed.model).not.toBe(request().modelId)
    expect(parsed.answers.color.confidence).toBe(0.6)
    expect(parsed.answers.color.probabilities.blue).toBe(0.8)
    expect(parsed).not.toBe(input)
    expect(parsed.answers).not.toBe(input.answers)
    expect(parsed.answers.color).not.toBe(input.answers.color)
    expect(parsed.answers.color.probabilities).not.toBe(input.answers.color.probabilities)
    expect(parsed.usage).not.toBe(input.usage)
    input.answers.color.probabilities.blue = 0
    input.usage.input_tokens = 100
    expect(parsed.answers.color.probabilities.blue).toBe(0.8)
    expect(parsed.usage.input_tokens).toBe(25)
  })
  it('validates multiple questions by exact identifier rather than insertion order', () => {
    const input = response()
    const questions = { color: question(), shade: question({ criteria: { light: null, dark: null } }) }
    const answers = { shade: { type: 'choice', choice: 'dark', probabilities: { light: 0, dark: 1 }, confidence: 0 }, color: input.answers.color }
    expect(parseChoiceResponse({ ...input, answers }, request({ questions })).answers).toEqual(answers)
  })
  it('returns only the public answer and usage fields', () => {
    const input = response()
    const parsed = parseChoiceResponse({
      ...input, debug: 'provider diagnostics',
      answers: { color: { ...input.answers.color, internal: 'not public' } },
      usage: { ...input.usage, total_tokens: 32, internal: 'not public' },
    }, request())
    expect(parsed).toEqual(input)
    expect(Object.keys(parsed).sort()).toEqual(['answers', 'model', 'usage'])
  })
  it.each([0, 1])('allows boundary confidence %s without claiming measured accuracy', confidence => {
    const input = response()
    input.answers.color.confidence = confidence
    expect(parseChoiceResponse(input, request()).answers.color.confidence).toBe(confidence)
  })
  it.each([
    ['deterministic', { blue: 1, green: 0 }, 'blue'], ['tie', { blue: 0.5, green: 0.5 }, 'blue'],
    ['within normalization tolerance above', { blue: 0.5, green: 0.509 }, 'green'],
    ['within normalization tolerance below', { blue: 0.5, green: 0.491 }, 'blue'],
    ['at normalization tolerance above', { blue: 0.51, green: 0.5 }, 'blue'],
    ['at normalization tolerance below', { blue: 0.5, green: 0.49 }, 'blue'],
    ['within argmax rounding tolerance', { blue: 0.49999975, green: 0.50000025 }, 'blue'],
  ])('accepts %s distributions without renormalizing them', (_label, probabilities, choice) => {
    const input = response()
    input.answers.color.probabilities = probabilities
    input.answers.color.choice = choice
    expect(parseChoiceResponse(input, request()).answers.color.probabilities).toEqual(probabilities)
  })
  it.each([
    ['sum too high', { blue: 0.6, green: 0.411 }], ['sum too low', { blue: 0.6, green: 0.389 }],
    ['zero sum', { blue: 0, green: 0 }], ['non-maximal choice', { blue: 0.2, green: 0.8 }],
    ['outside argmax tolerance', { blue: 0.499999, green: 0.500001 }],
  ])('rejects %s distributions', (_label, probabilities) => {
    const input = response()
    input.answers.color.probabilities = probabilities
    rejects(() => parseChoiceResponse(input, request()), 'invalid-response')
  })
  it.each([undefined, null, [], 'response', 1].map(value => [value] as const))('rejects malformed response envelope %#', value => {
    rejects(() => parseChoiceResponse(value, request()), 'invalid-response')
  })
  it.each([...invalidText, ['overlong', 'm'.repeat(257)]])('rejects %s response model', (_label, model) => {
    rejects(() => parseChoiceResponse({ ...response(), model }, request()), 'invalid-response')
  })
  it.each([undefined, null, [], 'answers', {}, { extra: response().answers.color }, { color: response().answers.color, extra: response().answers.color }].map(value => [value] as const))('rejects malformed or mismatched answers %#', answers => {
    rejects(() => parseChoiceResponse({ ...response(), answers }, request()), 'invalid-response')
  })
  it.each([
    undefined, null, [], 'answer', {}, { ...response().answers.color, type: 'boolean' },
    { ...response().answers.color, choice: undefined }, { ...response().answers.color, choice: 1 },
    { ...response().answers.color, choice: 'unknown' }, { ...response().answers.color, choice: 'toString' },
  ].map(value => [value] as const))('rejects malformed choice answer %#', color => {
    rejects(() => parseChoiceResponse({ ...response(), answers: { color } }, request()), 'invalid-response')
  })
  it.each([undefined, null, [], 'probabilities', {}, { blue: 1 }, { blue: 0.8, other: 0.2 }, { blue: 0.8, green: 0.2, extra: 0 }].map(value => [value] as const))('rejects malformed or mismatched probabilities %#', probabilities => {
    const input = response()
    rejects(() => parseChoiceResponse({ ...input, answers: { color: { ...input.answers.color, probabilities } } }, request()), 'invalid-response')
  })
  it.each([undefined, null, false, '0.8', Number.NaN, Infinity, -Infinity, -0.01, 1.01])('rejects out-of-domain probability and confidence %#', value => {
    const input = response()
    rejects(() => parseChoiceResponse({ ...input, answers: { color: { ...input.answers.color, probabilities: { blue: value, green: 0.2 } } } }, request()), 'invalid-response')
    rejects(() => parseChoiceResponse({ ...input, answers: { color: { ...input.answers.color, confidence: value } } }, request()), 'invalid-response')
  })
  it('requires own answer and probability keys, not inherited lookalikes', () => {
    const input = response()
    const inheritedAnswer = Object.assign(Object.create({ color: input.answers.color }), { other: input.answers.color })
    rejects(() => parseChoiceResponse({ ...input, answers: inheritedAnswer }, request()), 'invalid-response')
    const inheritedProbability = Object.assign(Object.create({ green: 0.2 }), { blue: 0.8, other: 0.2 })
    rejects(() => parseChoiceResponse({ ...input, answers: { color: { ...input.answers.color, probabilities: inheritedProbability } } }, request()), 'invalid-response')
  })
  it('safely preserves prototype-looking JSON keys without prototype pollution', () => {
    const criteria = JSON.parse('{"__proto__":null,"constructor":null,"toString":null}') as Record<string, null>
    const questions = Object.fromEntries(['__proto__', 'constructor', 'toString'].map(id => [id, question({ criteria })]))
    const parsedRequest = parseChoiceRequest(request({ questions }))
    const probabilities = JSON.parse('{"__proto__":0.8,"constructor":0.1,"toString":0.1}') as Record<string, number>
    const answers = Object.fromEntries(Object.keys(questions).map(id => [id, { type: 'choice', choice: '__proto__', probabilities, confidence: 0.4 }]))
    const parsed = parseChoiceResponse({ ...response(), answers }, parsedRequest)
    expect(Object.getPrototypeOf(parsed.answers)).toBeNull()
    expect(Object.keys(parsed.answers)).toEqual(['__proto__', 'constructor', 'toString'])
    for (const answer of Object.values(parsed.answers)) {
      expect(Object.hasOwn(answer.probabilities, '__proto__')).toBe(true)
      expect(answer.probabilities.__proto__).toBe(0.8)
      expect(answer.probabilities.constructor).toBe(0.1)
      expect(Object.getPrototypeOf(answer.probabilities)).toBe(Object.prototype)
    }
    expect(Object.getPrototypeOf({})).toBe(Object.prototype)
  })
  it.each([undefined, null, [], 'usage', 1].map(value => [value] as const))('requires an object usage field %#', usage => {
    rejects(() => parseChoiceResponse({ ...response(), usage }, request()), 'invalid-response')
  })
  it.each([{}, { input_tokens: 0 }, { output_tokens: 0 }, { input_tokens: Number.MAX_SAFE_INTEGER, output_tokens: Number.MAX_SAFE_INTEGER }])('allows omitted counters and safe integer boundaries %#', usage => {
    expect(parseChoiceResponse({ ...response(), usage }, request()).usage).toEqual(usage)
  })
  it.each([null, '1', false, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN, Infinity, -Infinity])('rejects invalid token counter %#', count => {
    for (const key of ['input_tokens', 'output_tokens']) {
      rejects(() => parseChoiceResponse({ ...response(), usage: { [key]: count } }, request()), 'invalid-response')
    }
  })
})

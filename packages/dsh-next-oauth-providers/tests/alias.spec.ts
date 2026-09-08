import { describe, expect, it } from 'vitest'
import type { Message } from '@deepseek-ai/dsh-llm'
import { rewriteMessagesForNative } from '../src/core/alias.ts'

function assistant(provider: string, replay?: unknown): Message {
  return {
    id: 'm1' as Message['id'],
    role: 'assistant',
    content: [],
    source: {
      kind: 'model',
      provider,
      model: 'x',
      ...replay === undefined ? {} : { replayState: replay },
    },
  }
}

describe('alias rewrite', () => {
  it('maps the current route alias to the native provider and keeps replay', () => {
    const replay = { response: { provider: 'kimi-coding' } }
    const [rewritten] = rewriteMessagesForNative([assistant('kimi-coding-oauth', replay)], 'kimi-coding-oauth')
    expect(rewritten.source).toMatchObject({ kind: 'model', provider: 'kimi-coding', replayState: replay })
  })

  it('strips foreign replay from another subscription alias', () => {
    const replay = { response: { provider: 'anthropic' } }
    const [rewritten] = rewriteMessagesForNative([assistant('anthropic-oauth', replay)], 'kimi-coding-oauth')
    expect(rewritten.source).toMatchObject({ kind: 'model', provider: 'anthropic' })
    expect('replayState' in rewritten.source ? rewritten.source.replayState : undefined).toBeUndefined()
  })

  it('does not mutate the original message', () => {
    const original = assistant('kimi-coding-oauth', { keep: true })
    rewriteMessagesForNative([original], 'kimi-coding-oauth')
    expect(original.source).toMatchObject({ provider: 'kimi-coding-oauth' })
  })
})

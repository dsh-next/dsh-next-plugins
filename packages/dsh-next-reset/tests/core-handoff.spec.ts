import { describe, expect, it } from 'vitest'
import { RESET_HANDOFF, handoffNextId } from '../src/core/handoff.ts'

describe('handoffNextId', () => {
  it('reads nextSessionId from a reset/handoff event', () => {
    expect(handoffNextId({ type: RESET_HANDOFF, data: { nextSessionId: 's-next' } })).toBe('s-next')
  })

  it('ignores other event types', () => {
    expect(handoffNextId({ type: 'command/done', data: { nextSessionId: 's-next' } })).toBeUndefined()
  })

  it('ignores a missing or empty id', () => {
    expect(handoffNextId({ type: RESET_HANDOFF, data: {} })).toBeUndefined()
    expect(handoffNextId({ type: RESET_HANDOFF, data: { nextSessionId: '' } })).toBeUndefined()
    expect(handoffNextId({ type: RESET_HANDOFF, data: null })).toBeUndefined()
  })
})

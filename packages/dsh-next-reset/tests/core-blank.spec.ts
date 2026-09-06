import { describe, expect, it } from 'vitest'
import { sessionIsBlank } from '../src/core/blank.ts'

describe('sessionIsBlank', () => {
  it('treats an empty log as blank', () => {
    expect(sessionIsBlank([])).toBe(true)
  })

  it('ignores command lifecycle on an otherwise empty session', () => {
    expect(sessionIsBlank([
      { type: 'command/run' },
      { type: 'command/done' },
    ])).toBe(true)
  })

  it('treats a user message as utilized', () => {
    expect(sessionIsBlank([{ type: 'command/run' }, { type: 'user/message' }])).toBe(false)
  })

  it('treats a turn start as utilized', () => {
    expect(sessionIsBlank([{ type: 'turn/start' }])).toBe(false)
  })
})

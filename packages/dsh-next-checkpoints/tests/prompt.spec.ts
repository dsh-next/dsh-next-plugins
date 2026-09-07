import { describe, expect, it } from 'vitest'
import { capPrompt, promptPreviewFromEvents, promptTooltip, userPromptText } from '../src/core/prompt.ts'

describe('capPrompt', () => {
  it('leaves short prompts unchanged and ellipsizes after 30 characters', () => {
    expect(capPrompt('short prompt')).toBe('short prompt')
    expect(capPrompt('Improve the header design now')).toBe('Improve the header design now')
    expect(capPrompt('123456789012345678901234567890')).toBe('123456789012345678901234567890')
    expect(capPrompt('1234567890123456789012345678901')).toBe('123456789012345678901234567890...')
  })
})

describe('promptTooltip', () => {
  it('is absent at or under 60 characters and otherwise returns 60 characters', () => {
    expect(promptTooltip('short')).toBeNull()
    expect(promptTooltip('x'.repeat(60))).toBeNull()
    expect(promptTooltip('x'.repeat(61))).toBe('x'.repeat(60))
  })
})

describe('promptPreviewFromEvents', () => {
  it('takes the last user prompt in the seq window and skips plugin notices', () => {
    expect(userPromptText({
      source: { kind: 'plugin' },
      content: [{ type: 'text', text: 'Rewound' }],
    })).toBeNull()
    expect(promptPreviewFromEvents([
      { type: 'user/message', seq: 1, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'first' }] } },
      { type: 'user/message', seq: 4, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'second turn prompt here' }] } },
      { type: 'user/message', seq: 9, data: { source: { kind: 'plugin' }, content: [{ type: 'text', text: 'notice' }] } },
    ], 2, 10)).toBe('second turn prompt here')
  })
})

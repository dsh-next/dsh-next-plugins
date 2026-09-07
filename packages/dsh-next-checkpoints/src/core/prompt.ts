/** Prompt preview shown on a checkpoint rail row. */

export const PROMPT_CAP = 30
export const PROMPT_TOOLTIP_MIN = 60

export interface PromptEvent {
  readonly type: string
  readonly seq: number
  readonly data?: unknown
}

/** Collapse whitespace and cap, with `...` only when longer. */
export function capPrompt(text: string, cap = PROMPT_CAP): string {
  const trimmed = text.replace(/\s+/g, ' ').trim()
  if (trimmed.length <= cap) return trimmed
  return `${trimmed.slice(0, cap)}...`
}

/** First-party user text from a user/message payload; skip plugin notices. */
export function userPromptText(data: unknown): string | null {
  if (data === null || typeof data !== 'object') return null
  const rec = data as { source?: { kind?: unknown }; content?: unknown }
  if (rec.source !== undefined && rec.source !== null && typeof rec.source === 'object') {
    if (rec.source.kind !== undefined && rec.source.kind !== 'user') return null
  }
  if (!Array.isArray(rec.content)) return null
  const parts: string[] = []
  for (const block of rec.content) {
    if (block === null || typeof block !== 'object') continue
    const item = block as { type?: unknown; text?: unknown }
    if (item.type !== 'text' || typeof item.text !== 'string' || item.text === '') continue
    parts.push(item.text)
  }
  const joined = parts.join(' ').replace(/\s+/g, ' ').trim()
  return joined === '' ? null : joined
}

/**
 * Last user prompt in (afterSeq, untilSeq]. Null when the slice has none.
 */
export function promptPreviewFromEvents(
  events: readonly PromptEvent[],
  afterSeq: number,
  untilSeq: number,
): string | null {
  let found: string | null = null
  for (const event of events) {
    if (event.seq <= afterSeq || event.seq > untilSeq) continue
    if (event.type !== 'user/message') continue
    const text = userPromptText(event.data)
    if (text !== null) found = text
  }
  return found
}

/** Hover title: first 60 characters only when the prompt is longer than 60. */
export function promptTooltip(text: string | null, min = PROMPT_TOOLTIP_MIN): string | null {
  if (text === null || text.length <= min) return null
  return text.slice(0, min)
}

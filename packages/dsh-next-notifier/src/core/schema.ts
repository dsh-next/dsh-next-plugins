/**
 * The Schemastery config schema for the `dsh-next-notifier` plugin. It is the
 * single source of truth for defaults and UI metadata. Every top-level field is
 * volatile, so a `configEditor.edit` write commits into the running fiber
 * without a restart; the next delivery reads the current preferences.
 */
import Schema from '@deepseek-ai/schemastery'
import { DEFAULT_SOUNDS, SOUND_IDS } from './sounds.ts'

function soundName(fallback: string) {
  return Schema.union(SOUND_IDS.map((id) => Schema.const(id))).default(fallback)
}

function group(fallback: string) {
  // All three groups share one shape so the resolved type is a single uniform
  // NotifyGroup; subagent/goalOnly are only honored by the "finished" group
  // at runtime but declaring them everywhere keeps the config type flat.
  return Schema.object({
    enabled: Schema.boolean().default(true),
    sound: Schema.boolean().default(true),
    soundName: soundName(fallback),
    subagent: Schema.boolean().default(false),
    goalOnly: Schema.boolean().default(true),
  })
}

export const notifierSchema = Schema.object({
  enabled: Schema.boolean().default(true).description('Master switch for all agent notifications').volatile(),
  suppressFocused: Schema.boolean().default(true).description('No alert for the session you are actively viewing').volatile(),
  volume: Schema.number().min(0).max(100).step(1).default(70).description('Sound loudness for all notifications').volatile(),
  finished: group(DEFAULT_SOUNDS.finished).volatile(),
  approval: group(DEFAULT_SOUNDS.approval).volatile(),
  question: group(DEFAULT_SOUNDS.question).volatile(),
})

export type NotifierConfigShape = Schemastery.TypeT<typeof notifierSchema>

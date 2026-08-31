/**
 * Pure parsing of Claude Code `hooks/hooks.json` into the hook entries this
 * bridge can execute. Claude's shape is an object keyed by event name whose
 * values are arrays of `{ matcher, hooks: [{ type, command, timeout? }] }`.
 *
 * Event mapping (this bridge), each to a DSH runtime event:
 *  - `PreToolUse`  -> `tools/pre-execute` (may deny the call)
 *  - `PostToolUse` -> `tools/post-execute` (observe)
 *  - `UserPromptSubmit` -> `agent/pre-step` (may reject the step; stdout
 *    becomes injected model context)
 *  - `SessionStart`     -> `agent/session-start` (observe; stdout becomes
 *    injected model context; the matcher selects startup/resume/clear/compact)
 *  - `Stop`             -> `agent/turn-stopping` (a block steers the agent so
 *    the turn continues instead of closing; loop-guarded, see the runtime)
 *  - `SubagentStop`     -> `subagent/end` (observe only)
 * Every other Claude hook event (PreCompact, Notification, SessionEnd, ...)
 * has no faithful DSH counterpart here yet and is reported as unsupported.
 */
export interface HookEntry {
  /** Tool-name matcher: a regex source, or '' / '*' for every tool. */
  matcher: string
  /** Shell command line to execute. */
  command: string
  /** Per-hook timeout in milliseconds (Claude's `timeout` field, seconds). */
  timeoutMs: number
}

export interface HookSet {
  pre: HookEntry[]
  post: HookEntry[]
  userPromptSubmit: HookEntry[]
  sessionStart: HookEntry[]
  stop: HookEntry[]
  subagentStop: HookEntry[]
  /** Event names present in the file but not mappable to a DSH event. */
  unsupported: string[]
  /** Parse problems (bad entries), reported without failing the install. */
  notes: string[]
}

/** The Claude hook events this bridge can run, and their entry buckets. */
const SUPPORTED_EVENTS = {
  PreToolUse: 'pre',
  PostToolUse: 'post',
  UserPromptSubmit: 'userPromptSubmit',
  SessionStart: 'sessionStart',
  Stop: 'stop',
  SubagentStop: 'subagentStop',
} as const

type SupportedEvent = keyof typeof SUPPORTED_EVENTS

/** Claude's default hook timeout is 60 seconds. */
export const DEFAULT_HOOK_TIMEOUT_MS = 60_000

function matcherOf(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const t = raw.trim()
  return t === '*' ? '' : t
}

function timeoutOf(raw: unknown): number {
  // Claude expresses timeouts in seconds; DSH hooks run with milliseconds.
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return Math.round(raw * 1000)
  return DEFAULT_HOOK_TIMEOUT_MS
}

/**
 * Parse the hooks file. A malformed document yields an empty set plus notes,
 * never a throw: hooks are additive automation, not a precondition.
 */
export function parseHookSet(rawHooksJson: string): HookSet {
  const out: HookSet = {
    pre: [],
    post: [],
    userPromptSubmit: [],
    sessionStart: [],
    stop: [],
    subagentStop: [],
    unsupported: [],
    notes: [],
  }
  let data: unknown
  try {
    data = JSON.parse(rawHooksJson)
  } catch {
    out.notes.push('hooks/hooks.json is not valid JSON; hooks not installed')
    return out
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    out.notes.push('hooks/hooks.json has an unexpected shape; hooks not installed')
    return out
  }
  for (const [event, entries] of Object.entries(data as Record<string, unknown>)) {
    if (!(event in SUPPORTED_EVENTS)) {
      out.unsupported.push(event)
      continue
    }
    if (!Array.isArray(entries)) {
      out.notes.push(`hooks event "${event}" is not an array; skipped`)
      continue
    }
    for (const entry of entries) {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        out.notes.push(`hooks event "${event}" has a non-object entry; skipped`)
        continue
      }
      const e = entry as Record<string, unknown>
      const hooks = Array.isArray(e.hooks) ? e.hooks : []
      let any = false
      for (const hook of hooks) {
        if (hook === null || typeof hook !== 'object' || Array.isArray(hook)) continue
        const h = hook as Record<string, unknown>
        const command = typeof h.command === 'string' ? h.command : ''
        if (command === '') continue
        const parsed: HookEntry = { matcher: matcherOf(e.matcher), command, timeoutMs: timeoutOf(h.timeout) }
        out[SUPPORTED_EVENTS[event as SupportedEvent]].push(parsed)
        any = true
      }
      if (!any) out.notes.push(`hooks event "${event}" entry has no command hook; skipped`)
    }
  }
  return out
}

/** Whether a hook entry's matcher applies to a subject name. Invalid regexes match nothing. */
export function hookMatches(entry: HookEntry, subject: string): boolean {
  if (entry.matcher === '') return true
  try {
    return new RegExp(entry.matcher).test(subject)
  } catch {
    return false
  }
}

/**
 * Whether a SessionStart hook entry's matcher selects one DSH session-start
 * source. Claude's SessionStart matchers are pipe-separated source names
 * (`startup|resume`), which the regex semantics used everywhere else happen
 * to express; `''` / `'*'` select every source.
 */
export function sessionStartMatches(entry: HookEntry, source: string): boolean {
  return hookMatches(entry, source)
}

// ---------------------------------------------------------------------------
// Payloads (Claude-compatible field names; DSH-only fields ride `dsh`)
// ---------------------------------------------------------------------------

function basePayload(hookEventName: SupportedEvent, sessionId: string): Record<string, unknown> {
  return {
    hook_event_name: hookEventName,
    session_id: sessionId,
    dsh: { harness: 'dsh-next-cc-plugins' },
  }
}

/**
 * The Claude-compatible JSON payload written to a tool hook command's stdin.
 * Field names follow Claude Code's hook protocol so existing hook scripts
 * work unmodified.
 */
export function hookPayload(args: {
  hookEventName: 'PreToolUse' | 'PostToolUse'
  toolName: string
  toolInput: unknown
  sessionId: string
}): string {
  return JSON.stringify({
    ...basePayload(args.hookEventName, args.sessionId),
    tool_name: args.toolName,
    tool_input: args.toolInput ?? {},
  })
}

/** Payload for `UserPromptSubmit` hooks (`prompt` carries the submitted text). */
export function userPromptPayload(args: { prompt: string; sessionId: string }): string {
  return JSON.stringify({ ...basePayload('UserPromptSubmit', args.sessionId), prompt: args.prompt })
}

/** Payload for `SessionStart` hooks (`source` is the DSH start source). */
export function sessionStartPayload(args: { source: string; sessionId: string }): string {
  return JSON.stringify({ ...basePayload('SessionStart', args.sessionId), source: args.source })
}

/** Payload for `Stop` hooks (`stop_hook_active` mirrors Claude's loop guard). */
export function stopPayload(args: { sessionId: string; stopHookActive: boolean }): string {
  return JSON.stringify({ ...basePayload('Stop', args.sessionId), stop_hook_active: args.stopHookActive })
}

/** Payload for `SubagentStop` hooks (observe-only). */
export function subagentStopPayload(args: { sessionId: string; stopReason: string }): string {
  return JSON.stringify({
    ...basePayload('SubagentStop', args.sessionId),
    dsh: { harness: 'dsh-next-cc-plugins', stopReason: args.stopReason },
  })
}

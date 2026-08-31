/**
 * Hook parsing and matching: the Claude hooks.json shapes this bridge
 * executes, plus matcher, deny-decision, block, and context behavior. Pure
 * core coverage for `core/hooks.ts` and the runtime's outcome interpreters.
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_HOOK_TIMEOUT_MS,
  hookMatches,
  hookPayload,
  parseHookSet,
  sessionStartMatches,
  sessionStartPayload,
  stopPayload,
  subagentStopPayload,
  userPromptPayload,
} from '../src/core/hooks.ts'
import { blockReasonFrom, contextFrom, denyReasonFrom } from '../src/host/runtime.ts'

const HOOKS = JSON.stringify({
  PreToolUse: [
    { matcher: 'Bash', hooks: [{ type: 'command', command: 'check-bash.sh' }] },
    { matcher: 'Edit|Write', hooks: [{ type: 'command', command: 'check-edit.sh', timeout: 5 }] },
  ],
  PostToolUse: [
    { hooks: [{ type: 'command', command: 'log-everything.sh' }] },
  ],
  Stop: [{ hooks: [{ type: 'command', command: 'on-stop.sh' }] }],
})

describe('parseHookSet', () => {
  it('maps PreToolUse and PostToolUse entries and reports other events', () => {
    const set = parseHookSet(HOOKS)
    expect(set.pre).toEqual([
      { matcher: 'Bash', command: 'check-bash.sh', timeoutMs: DEFAULT_HOOK_TIMEOUT_MS },
      { matcher: 'Edit|Write', command: 'check-edit.sh', timeoutMs: 5000 },
    ])
    expect(set.post).toEqual([{ matcher: '', command: 'log-everything.sh', timeoutMs: DEFAULT_HOOK_TIMEOUT_MS }])
    expect(set.stop).toEqual([{ matcher: '', command: 'on-stop.sh', timeoutMs: DEFAULT_HOOK_TIMEOUT_MS }])
    expect(set.unsupported).toEqual([])
    expect(set.notes).toEqual([])
  })

  it('parses the lifecycle events onto their own buckets', () => {
    const set = parseHookSet(JSON.stringify({
      UserPromptSubmit: [{ hooks: [{ command: 'prompt-guard.sh' }] }],
      SessionStart: [{ matcher: 'startup|resume', hooks: [{ command: 'session-log.sh', timeout: 10 }] }],
      SubagentStop: [{ hooks: [{ command: 'sub-stop.sh' }] }],
    }))
    expect(set.userPromptSubmit).toEqual([{ matcher: '', command: 'prompt-guard.sh', timeoutMs: DEFAULT_HOOK_TIMEOUT_MS }])
    expect(set.sessionStart).toEqual([{ matcher: 'startup|resume', command: 'session-log.sh', timeoutMs: 10000 }])
    expect(set.subagentStop).toEqual([{ matcher: '', command: 'sub-stop.sh', timeoutMs: DEFAULT_HOOK_TIMEOUT_MS }])
  })

  it('still reports unmappable Claude events as unsupported', () => {
    const set = parseHookSet(JSON.stringify({ PreCompact: [{ hooks: [{ command: 'x' }] }], Notification: [{ hooks: [{ command: 'x' }] }] }))
    expect(set.unsupported).toEqual(['PreCompact', 'Notification'])
    expect(set.notes).toEqual([])
  })

  it('treats a "*" matcher as match-everything', () => {
    const set = parseHookSet(JSON.stringify({ PreToolUse: [{ matcher: '*', hooks: [{ command: 'x' }] }] }))
    expect(set.pre[0].matcher).toBe('')
  })

  it('returns notes instead of throwing on malformed documents', () => {
    expect(parseHookSet('{oops').notes.join(' ')).toContain('not valid JSON')
    expect(parseHookSet('[]').notes.join(' ')).toContain('unexpected shape')
    const noCommand = parseHookSet(JSON.stringify({ PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command' }] }] }))
    expect(noCommand.pre).toEqual([])
    expect(noCommand.notes.join(' ')).toContain('no command hook')
    const badEntry = parseHookSet(JSON.stringify({ PreToolUse: 'nope' }))
    expect(badEntry.pre).toEqual([])
    expect(badEntry.notes.join(' ')).toContain('not an array')
  })

  it('skips non-object entries and non-object hooks', () => {
    const set = parseHookSet(JSON.stringify({
      PreToolUse: ['nope', { matcher: 'Bash', hooks: ['nope', { command: 'ok.sh' }] }],
    }))
    expect(set.pre).toEqual([{ matcher: 'Bash', command: 'ok.sh', timeoutMs: DEFAULT_HOOK_TIMEOUT_MS }])
  })
})

describe('hookMatches', () => {
  it('matches everything with an empty matcher and by regex otherwise', () => {
    const all = { matcher: '', command: 'x', timeoutMs: 1 }
    expect(hookMatches(all, 'Anything')).toBe(true)
    const bash = { matcher: 'Bash', command: 'x', timeoutMs: 1 }
    expect(hookMatches(bash, 'Bash')).toBe(true)
    expect(hookMatches(bash, 'Read')).toBe(false)
    const alternation = { matcher: 'Edit|Write', command: 'x', timeoutMs: 1 }
    expect(hookMatches(alternation, 'Write')).toBe(true)
    expect(hookMatches(alternation, 'Read')).toBe(false)
  })

  it('never throws on an invalid regex', () => {
    expect(hookMatches({ matcher: '(', command: 'x', timeoutMs: 1 }, 'Bash')).toBe(false)
  })
})

describe('sessionStartMatches', () => {
  it('selects the matching DSH start sources', () => {
    const startupOnly = { matcher: 'startup', command: 'x', timeoutMs: 1 }
    expect(sessionStartMatches(startupOnly, 'startup')).toBe(true)
    expect(sessionStartMatches(startupOnly, 'resume')).toBe(false)
    const pipe = { matcher: 'startup|resume', command: 'x', timeoutMs: 1 }
    expect(sessionStartMatches(pipe, 'resume')).toBe(true)
    expect(sessionStartMatches(pipe, 'compact')).toBe(false)
    const all = { matcher: '', command: 'x', timeoutMs: 1 }
    expect(sessionStartMatches(all, 'clear')).toBe(true)
  })
})

describe('hookPayload', () => {
  it('follows the Claude hook field names', () => {
    const payload = JSON.parse(hookPayload({ hookEventName: 'PreToolUse', toolName: 'Bash', toolInput: { command: 'ls' }, sessionId: 's1' }))
    expect(payload).toEqual({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
      session_id: 's1',
      dsh: { harness: 'dsh-next-cc-plugins' },
    })
  })

  it('carries the prompt for UserPromptSubmit', () => {
    const payload = JSON.parse(userPromptPayload({ prompt: 'deploy now', sessionId: 's1' }))
    expect(payload).toEqual({
      hook_event_name: 'UserPromptSubmit',
      prompt: 'deploy now',
      session_id: 's1',
      dsh: { harness: 'dsh-next-cc-plugins' },
    })
  })

  it('carries the source for SessionStart', () => {
    const payload = JSON.parse(sessionStartPayload({ source: 'resume', sessionId: 's1' }))
    expect(payload).toEqual({
      hook_event_name: 'SessionStart',
      source: 'resume',
      session_id: 's1',
      dsh: { harness: 'dsh-next-cc-plugins' },
    })
  })

  it('carries the loop-guard flag for Stop', () => {
    const payload = JSON.parse(stopPayload({ sessionId: 's1', stopHookActive: true }))
    expect(payload).toEqual({
      hook_event_name: 'Stop',
      stop_hook_active: true,
      session_id: 's1',
      dsh: { harness: 'dsh-next-cc-plugins' },
    })
  })

  it('carries the child identity for SubagentStop', () => {
    const payload = JSON.parse(subagentStopPayload({ sessionId: 'child-1', stopReason: 'completed' }))
    expect(payload.hook_event_name).toBe('SubagentStop')
    expect(payload.session_id).toBe('child-1')
    expect(payload.dsh).toEqual({ harness: 'dsh-next-cc-plugins', stopReason: 'completed' })
  })
})

describe('denyReasonFrom', () => {
  it('denies on exit code 2 with stderr or stdout as the reason', () => {
    expect(denyReasonFrom({ code: 2, stdout: '', stderr: 'not allowed', timedOut: false })).toBe('not allowed')
    expect(denyReasonFrom({ code: 2, stdout: 'blocked: demo', stderr: '', timedOut: false })).toBe('blocked: demo')
    expect(denyReasonFrom({ code: 2, stdout: '', stderr: '', timedOut: false })).toContain('exit 2')
  })

  it('denies on a JSON permissionDecision deny', () => {
    const outcome = {
      code: 0,
      stdout: JSON.stringify({ decision: 'block', hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'readonly repo' } }),
      stderr: '',
      timedOut: false,
    }
    expect(denyReasonFrom(outcome)).toBe('readonly repo')
  })

  it('allows exit 0 without a deny decision', () => {
    expect(denyReasonFrom({ code: 0, stdout: 'all good', stderr: '', timedOut: false })).toBeUndefined()
    expect(denyReasonFrom({ code: 1, stdout: '', stderr: 'hook bug', timedOut: false })).toBeUndefined()
  })
})

describe('blockReasonFrom', () => {
  it('blocks on a JSON decision block with reason', () => {
    const outcome = { code: 0, stdout: JSON.stringify({ decision: 'block', reason: 'prompt denied' }), stderr: '', timedOut: false }
    expect(blockReasonFrom(outcome)).toBe('prompt denied')
  })

  it('blocks on exit code 2 with stderr or stdout as the reason', () => {
    expect(blockReasonFrom({ code: 2, stdout: '', stderr: 'nope', timedOut: false })).toBe('nope')
    expect(blockReasonFrom({ code: 2, stdout: 'fallback text', stderr: '', timedOut: false })).toBe('fallback text')
    expect(blockReasonFrom({ code: 2, stdout: '', stderr: '', timedOut: false })).toContain('exit 2')
  })

  it('does not block on plain stdout or non-blocking exits', () => {
    expect(blockReasonFrom({ code: 0, stdout: 'some context', stderr: '', timedOut: false })).toBeUndefined()
    expect(blockReasonFrom({ code: 1, stdout: '', stderr: 'hook bug', timedOut: false })).toBeUndefined()
  })
})

describe('contextFrom', () => {
  it('extracts trimmed stdout from a clean exit', () => {
    expect(contextFrom({ code: 0, stdout: '  extra context\n', stderr: '', timedOut: false })).toBe('extra context')
  })

  it('rejects non-zero exits, timeouts, and empty stdout', () => {
    expect(contextFrom({ code: 1, stdout: 'x', stderr: '', timedOut: false })).toBeUndefined()
    expect(contextFrom({ code: 0, stdout: 'x', stderr: '', timedOut: true })).toBeUndefined()
    expect(contextFrom({ code: 0, stdout: '   ', stderr: '', timedOut: false })).toBeUndefined()
  })
})

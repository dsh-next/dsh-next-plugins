/**
 * The runtime bridge: makes installed Claude Code plugin components live in
 * this DSH process.
 *
 *  - Slash commands register on the DSH command registry (`ctx.commands`) at
 *    boot and after every install/uninstall/update. A command's handler
 *    expands `$ARGUMENTS` into the plugin's markdown template and submits it
 *    to the receiving agent as a model-visible user turn (the same producer
 *    pattern `/plan` uses).
 *  - Hook commands run while `runtime.hooks` is enabled, each on its DSH
 *    event twin: PreToolUse/PostToolUse on the `tools/pre-execute` and
 *    `tools/post-execute` waterfalls (exit code 2 or a JSON deny decision
 *    blocks the call), UserPromptSubmit on `agent/pre-step` (a block rejects
 *    the step; stdout on success is injected as model context), SessionStart
 *    on `agent/session-start` (observe; stdout injected), Stop on
 *    `agent/turn-stopping` (a block steers the agent so the turn continues;
 *    loop-guarded per turn so a hook cannot ping-pong forever), and
 *    SubagentStop on `subagent/end` (observe only). Every hook receives the
 *    Claude-compatible JSON payload on stdin with `CLAUDE_PLUGIN_ROOT`/
 *    `CLAUDE_PLUGIN_DATA` set.
 *
 * Both paths read only the per-plugin file cache materialized at install
 * time, so activation never touches the network or a live marketplace.
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only merges: ctx.commands (dsh-commands), the tools/pre-execute +
// tools/post-execute events (dsh-tools), the agent/* lifecycle events
// (dsh-agent), and the subagent/end event (dsh-subagent).
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-subagent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { commandsFromFiles, expandTemplate } from '../core/commands.ts'
import {
  hookMatches,
  hookPayload,
  parseHookSet,
  sessionStartMatches,
  sessionStartPayload,
  stopPayload,
  subagentStopPayload,
  userPromptPayload,
  type HookEntry,
  type HookSet,
} from '../core/hooks.ts'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { InstalledPlugin } from '../core/types.ts'
import type { HookRunner, HookRunOutcome } from './hook-runner.ts'
import type { Store } from './store.ts'

export interface RuntimeConfig {
  commands: boolean
  hooks: boolean
}

export interface RuntimeDeps {
  store: Store
  config: RuntimeConfig
  runHook: HookRunner
  /** Absolute path of a plugin's materialized root (CLAUDE_PLUGIN_ROOT, hook cwd). */
  pluginRoot(key: string): string
  /** Absolute path of a plugin's writable data directory (CLAUDE_PLUGIN_DATA). */
  pluginData(key: string): string
  logger?: { warn: (message: string) => void }
}

interface LoadedPlugin {
  record: InstalledPlugin
  files: Record<string, string>
  hooks: HookSet
}

/**
 * A PreToolUse deny extracted from a hook outcome: Claude's exit-code-2
 * convention or the JSON `hookSpecificOutput.permissionDecision: "deny"`.
 */
export function denyReasonFrom(outcome: HookRunOutcome): string | undefined {
  const stdout = outcome.stdout.trim()
  if (stdout !== '') {
    try {
      const data = JSON.parse(stdout) as {
        hookSpecificOutput?: { permissionDecision?: unknown; permissionDecisionReason?: unknown }
      }
      const decision = data.hookSpecificOutput
      if (decision !== undefined && decision.permissionDecision === 'deny') {
        const reason = typeof decision.permissionDecisionReason === 'string' ? decision.permissionDecisionReason : ''
        return reason !== '' ? reason : `blocked by hook (${outcome.code !== 0 ? `exit ${outcome.code}` : 'deny decision'})`
      }
    } catch {
      // Not JSON: fall through to the exit-code convention.
    }
  }
  if (outcome.code === 2) {
    const text = outcome.stderr.trim() !== '' ? outcome.stderr.trim() : stdout
    return text !== '' ? text : 'blocked by hook (exit 2)'
  }
  return undefined
}

/**
 * A UserPromptSubmit / Stop block extracted from a hook outcome: Claude's
 * JSON `decision: "block"` with `reason`, or the exit-code-2 convention.
 */
export function blockReasonFrom(outcome: HookRunOutcome): string | undefined {
  const stdout = outcome.stdout.trim()
  if (stdout !== '') {
    try {
      const data = JSON.parse(stdout) as { decision?: unknown; reason?: unknown }
      if (data.decision === 'block') {
        const reason = typeof data.reason === 'string' ? data.reason : ''
        return reason !== '' ? reason : 'blocked by hook'
      }
    } catch {
      // Not JSON: fall through to the exit-code convention.
    }
  }
  if (outcome.code === 2) {
    const text = outcome.stderr.trim() !== '' ? outcome.stderr.trim() : stdout
    return text !== '' ? text : 'blocked by hook (exit 2)'
  }
  return undefined
}

/**
 * Model-facing context from a hook outcome, following Claude's convention
 * for UserPromptSubmit and SessionStart: plain stdout on a clean exit
 * becomes context; JSON stdout and non-zero exits do not.
 */
export function contextFrom(outcome: HookRunOutcome): string | undefined {
  if (outcome.code !== 0 || outcome.timedOut) return undefined
  const stdout = outcome.stdout.trim()
  return stdout === '' ? undefined : stdout
}

/** One injected-context user message attributed to this plugin. */
function injectedContextMessage(text: string): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: 'dsh-next-cc-plugins' },
  })
}

export class CcRuntime {
  private readonly commandDisposers: Array<() => void> = []
  private readonly hookDisposers: Array<() => void> = []
  private loaded: LoadedPlugin[] = []
  private refreshInFlight: Promise<void> | undefined
  private commandsContext: Context | undefined
  /** Per agent, the last turn a Stop hook forced to continue (loop guard). */
  private readonly lastSteeredTurn = new Map<string, number>()

  constructor(private readonly deps: RuntimeDeps) {}

  /** Attach to the Cordis context: initial registration plus hook listeners. */
  attach(ctx: Context): void {
    this.commandsContext = ctx
    if (this.deps.config.hooks) this.attachHooks(ctx)
    ctx.effect(() => () => this.dispose(), 'dsh-next-cc-plugins: runtime registrations')
    void this.refresh().catch((error: unknown) => {
      this.deps.logger?.warn(`dsh-next-cc-plugins runtime refresh failed: ${error instanceof Error ? error.message : String(error)}`)
    })
  }

  /** Dispose every live registration (commands and hook listeners). */
  dispose(): void {
    for (const off of this.hookDisposers.splice(0)) {
      try { off() } catch { /* a dead listener disposer is not fatal */ }
    }
    this.clearCommands()
    this.loaded = []
  }

  private clearCommands(): void {
    for (const off of this.commandDisposers.splice(0)) {
      try { off() } catch { /* ignore */ }
    }
  }

  /**
   * Re-read the install registry and re-register slash commands. Single-
   * flight: concurrent triggers (install + uninstall in quick succession)
   * collapse into the last refresh winning.
   */
  async refresh(): Promise<void> {
    if (this.refreshInFlight !== undefined) {
      await this.refreshInFlight
      // A queued caller still triggers one more pass to see the latest state.
    }
    const run = (async () => {
      this.clearCommands()
      const plugins = await this.deps.store.readInstalled()
      this.loaded = []
      const ctx = this.commandsContext
      if (this.deps.config.commands && ctx !== undefined) {
        for (const record of plugins.plugins) {
          const files = await this.deps.store.readCachedPluginFiles(record.marketplaceId, record.pluginName)
          if (files === undefined) continue
          const hooksRaw = files['hooks/hooks.json'] ?? files[hooksOverrideOf(files)] ?? ''
          this.loaded.push({ record, files, hooks: parseHookSet(hooksRaw) })
          const { commands } = commandsFromFiles(files, record.pluginName)
          for (const command of commands) {
            try {
              const off = ctx.commands.register({
                name: command.name,
                description: command.description,
                // Claude's `argument-hint` frontmatter, passed through as the
                // composer placeholder when the command declares one.
                ...(command.hint !== '' ? { input: { hint: command.hint } } : {}),
                handler: (invocation) => {
                  const text = expandTemplate(command.template, invocation.rawInput)
                  invocation.agent.followup(createUserMessage({
                    content: [{ type: 'text', text }],
                    source: { kind: 'user' },
                  }))
                  return { kind: 'success', text: `submitted /${command.name} prompt to the agent` }
                },
              })
              this.commandDisposers.push(off)
            } catch (error) {
              this.deps.logger?.warn(`dsh-next-cc-plugins could not register command "${command.name}": ${error instanceof Error ? error.message : String(error)}`)
            }
          }
        }
      }
    })()
    this.refreshInFlight = run
    try {
      await run
    } finally {
      this.refreshInFlight = undefined
    }
  }

  private attachHooks(ctx: Context): void {
    this.hookDisposers.push(
      ctx.on('tools/pre-execute', async (exec, next) => {
        const deny = await this.runMatchingHooks('PreToolUse', exec.name, exec.arguments, exec.agent?.id ?? '', exec.signal)
        if (deny !== undefined) return { kind: 'deny', reason: deny }
        return await next()
      }),
      ctx.on('tools/post-execute', async (exec, _result, next) => {
        await this.runMatchingHooks('PostToolUse', exec.name, exec.arguments, exec.agent?.id ?? '', exec.signal)
        return await next()
      }),
      // UserPromptSubmit: a block rejects the step; stdout becomes context.
      ctx.on('agent/pre-step', async (payload, next) => {
        const prompt = promptOf(payload.messages)
        if (prompt !== undefined) {
          const outcomes = await this.runEntries(
            (hooks) => hooks.userPromptSubmit,
            (entry) => hookMatches(entry, 'UserPromptSubmit'),
            userPromptPayload({ prompt, sessionId: String(payload.agent.id) }),
            'UserPromptSubmit',
            payload.signal,
          )
          for (const outcome of outcomes) {
            const block = blockReasonFrom(outcome)
            if (block !== undefined) return { kind: 'reject' }
            const context = contextFrom(outcome)
            if (context !== undefined) payload.agent.inject(injectedContextMessage(context))
          }
        }
        return await next()
      }),
      // SessionStart: observe; stdout becomes context (non-blocking, like Claude).
      ctx.on('agent/session-start', (payload) => {
        void this.runEntries(
          (hooks) => hooks.sessionStart,
          (entry) => sessionStartMatches(entry, payload.source),
          sessionStartPayload({ source: payload.source, sessionId: String(payload.agent.id) }),
          'SessionStart',
        ).then((outcomes) => {
          for (const outcome of outcomes) {
            const context = contextFrom(outcome)
            if (context !== undefined) payload.agent.inject(injectedContextMessage(context))
          }
        }).catch(() => { /* session-start hook failures are logged per run */ })
      }),
      // Stop: a block steers the agent so the turn runs another step. The
      // second stop boundary of the same turn runs hooks with Claude's
      // stop_hook_active flag and ignores further blocks, so a hook that
      // always exits 2 cannot loop forever.
      ctx.on('agent/turn-stopping', (payload) => {
        void (async () => {
          const active = this.lastSteeredTurn.get(String(payload.agent.id)) === payload.turn
          const outcomes = await this.runEntries(
            (hooks) => hooks.stop,
            (entry) => hookMatches(entry, 'Stop'),
            stopPayload({ sessionId: String(payload.agent.id), stopHookActive: active }),
            'Stop',
            payload.signal,
          )
          if (active) return
          for (const outcome of outcomes) {
            const block = blockReasonFrom(outcome)
            if (block === undefined) continue
            this.lastSteeredTurn.set(String(payload.agent.id), payload.turn)
            payload.agent.steer(createUserMessage({
              content: [{ type: 'text', text: block }],
              source: { kind: 'plugin', plugin: 'dsh-next-cc-plugins' },
            }))
            return
          }
        })().catch(() => { /* stop hook failures are logged per run */ })
      }),
      // SubagentStop: observe only.
      ctx.on('subagent/end', (info) => {
        void this.runEntries(
          (hooks) => hooks.subagentStop,
          (entry) => hookMatches(entry, String(info.id)),
          subagentStopPayload({ sessionId: String(info.id), stopReason: String(info.stopReason ?? '') }),
          'SubagentStop',
        ).catch(() => { /* subagent-stop hook failures are logged per run */ })
      }),
    )
  }

  /**
   * Run every installed plugin's matching hook entries for one tool event.
   * Returns the first deny reason (pre events); post events ignore outcomes.
   */
  private async runMatchingHooks(
    event: 'PreToolUse' | 'PostToolUse',
    toolName: string,
    toolInput: unknown,
    sessionId: string,
    signal: AbortSignal,
  ): Promise<string | undefined> {
    const payload = hookPayload({ hookEventName: event, toolName, toolInput, sessionId })
    for (const plugin of this.loaded) {
      const entries: HookEntry[] = event === 'PreToolUse' ? plugin.hooks.pre : plugin.hooks.post
      for (const entry of entries) {
        if (!hookMatches(entry, toolName)) continue
        const outcome = await this.runOne(plugin, entry, payload, toolName, signal)
        if (outcome === undefined) continue
        if (event === 'PreToolUse') {
          const deny = denyReasonFrom(outcome)
          if (deny !== undefined) return deny
        }
      }
    }
    return undefined
  }

  /**
   * Run one event's matching entries across every loaded plugin, in install
   * order, and collect their outcomes. Failed or timed-out runs are logged
   * and skipped, never thrown: one broken hook must not break the event.
   */
  private async runEntries(
    select: (hooks: HookSet) => HookEntry[],
    matches: (entry: HookEntry) => boolean,
    payload: string,
    event: string,
    signal?: AbortSignal,
  ): Promise<HookRunOutcome[]> {
    const outcomes: HookRunOutcome[] = []
    for (const plugin of this.loaded) {
      for (const entry of select(plugin.hooks)) {
        if (!matches(entry)) continue
        const outcome = await this.runOne(plugin, entry, payload, event, signal)
        if (outcome !== undefined) outcomes.push(outcome)
      }
    }
    return outcomes
  }

  /** Execute one hook entry for one plugin; undefined on failure or timeout. */
  private async runOne(
    plugin: LoadedPlugin,
    entry: HookEntry,
    payload: string,
    subject: string,
    signal?: AbortSignal,
  ): Promise<HookRunOutcome | undefined> {
    try {
      const outcome = await this.deps.runHook({
        command: entry.command,
        payload,
        cwd: this.deps.pluginRoot(plugin.record.key),
        pluginRoot: this.deps.pluginRoot(plugin.record.key),
        pluginData: this.deps.pluginData(plugin.record.key),
        timeoutMs: entry.timeoutMs,
        ...(signal !== undefined ? { signal } : {}),
      })
      if (outcome.timedOut) {
        this.deps.logger?.warn(`dsh-next-cc-plugins ${subject} hook timed out`)
        return undefined
      }
      return outcome
    } catch (error) {
      this.deps.logger?.warn(`dsh-next-cc-plugins hook for ${subject} failed: ${error instanceof Error ? error.message : String(error)}`)
      return undefined
    }
  }
}

/** The first user-authored step message's prompt text, if any. */
function promptOf(messages: readonly UserMessage[]): string | undefined {
  for (const message of messages) {
    if (message.source.kind !== 'user') continue
    const text = message.content.find((block) => block.type === 'text')
    if (text !== undefined && text.type === 'text' && text.text.trim() !== '') return text.text
  }
  return undefined
}

/** The plugin.json `hooks` path override when present. */
function hooksOverrideOf(files: Record<string, string>): string {
  try {
    const manifest = JSON.parse(files['.claude-plugin/plugin.json'] ?? '{}') as Record<string, unknown>
    const hooks = manifest.hooks
    return typeof hooks === 'string' ? hooks : ''
  } catch {
    return ''
  }
}

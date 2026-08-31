/**
 * Default hook-command runner: executes one Claude Code hook command line
 * through the shell with the hook payload on stdin, Claude-compatible
 * environment additions, and a hard timeout. Injectable so tests can double
 * it without spawning processes.
 */
import { exec } from 'node:child_process'

export interface HookRunOutcome {
  /** Process exit code (-1 when the run failed to start or timed out). */
  code: number
  stdout: string
  stderr: string
  /** True when the timeout killed the run. */
  timedOut: boolean
}

export type HookRunner = (args: {
  command: string
  payload: string
  cwd: string
  pluginRoot: string
  pluginData: string
  timeoutMs: number
  signal?: AbortSignal
}) => Promise<HookRunOutcome>

export function nodeHookRunner(): HookRunner {
  return async (args) => {
    return await new Promise<HookRunOutcome>((resolve) => {
      const child = exec(
        args.command,
        {
          cwd: args.cwd,
          timeout: args.timeoutMs,
          env: {
            ...process.env,
            // Claude Code hook contract: the plugin's install root and its
            // writable data directory (grok-build sets the same aliases).
            CLAUDE_PLUGIN_ROOT: args.pluginRoot,
            CLAUDE_PLUGIN_DATA: args.pluginData,
          },
          maxBuffer: 1024 * 1024,
          signal: args.signal,
        },
        (error, stdout, stderr) => {
          const err = error as (NodeJS.ErrnoException & { killed?: boolean }) | null
          const timedOut = err?.killed === true
          const code = err !== null && typeof err.code === 'number'
            ? err.code
            : err === null
              ? 0
              : -1
          resolve({ code, stdout: stdout.toString(), stderr: stderr.toString(), timedOut })
        },
      )
      child.stdin?.end(args.payload)
    })
  }
}

/**
 * Production runner for `.worktrees.json` setup steps. Host-only: shells
 * out with a long timeout so `pnpm install` can finish.
 */
import { execFile } from 'node:child_process'
import { setupChildEnv } from '../core/setup-env.ts'
import type { ServicePorts } from './service.ts'

const SETUP_TIMEOUT_MS = 300_000

/** POSIX-safe single-quote of a path for `sh -c`. */
export function posixShellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** cmd.exe-safe double-quote of a path for `cd /d`. */
export function winShellQuote(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

/**
 * Force the shell into `cwd` before the user command. `execFile`'s cwd
 * option is not enough: pnpm also reads `PWD` / workspace discovery from
 * the parent harbor if the nested checkout is still settling.
 */
export function wrapSetupCommand(command: string, cwd: string, win: boolean): string {
  return win
    ? `cd /d ${winShellQuote(cwd)} && ${command}`
    : `cd ${posixShellQuote(cwd)} && ${command}`
}

export const runSetupCommand: NonNullable<ServicePorts['runCommand']> = (input) =>
  new Promise((resolve) => {
    const win = process.platform === 'win32'
    const command = input.command === undefined
      ? undefined
      : wrapSetupCommand(input.command, input.cwd, win)
    const file = input.script === undefined
      ? (win ? 'cmd.exe' : 'sh')
      : (win ? 'powershell.exe' : 'sh')
    const args = input.script === undefined
      ? (win ? ['/d', '/s', '/c', command ?? ''] : ['-c', command ?? ''])
      : (win ? ['-NoProfile', '-NonInteractive', '-File', input.script] : [input.script])
    execFile(
      file,
      args,
      {
        cwd: input.cwd,
        timeout: SETUP_TIMEOUT_MS,
        env: setupChildEnv(process.env, input.env, input.cwd),
        maxBuffer: 16 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        const err = error as (NodeJS.ErrnoException & { code?: number | string }) | null
        if (err && err.code === 'ENOENT') {
          resolve({ code: 127, stdout: String(stdout ?? ''), stderr: String(stderr ?? 'command not found') })
          return
        }
        const code = typeof err?.code === 'number' ? err.code : err ? 1 : 0
        resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
      },
    )
  })

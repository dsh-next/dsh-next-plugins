/**
 * Production runner for `.worktrees.json` setup steps. Host-only: shells
 * out with a long timeout so `pnpm install` can finish.
 */
import { execFile } from 'node:child_process'
import type { ServicePorts } from './service.ts'

const SETUP_TIMEOUT_MS = 300_000

export const runSetupCommand: NonNullable<ServicePorts['runCommand']> = (input) =>
  new Promise((resolve) => {
    const win = process.platform === 'win32'
    const file = input.script === undefined
      ? (win ? 'cmd.exe' : 'sh')
      : (win ? 'powershell.exe' : 'sh')
    const args = input.script === undefined
      ? (win ? ['/d', '/s', '/c', input.command ?? ''] : ['-c', input.command ?? ''])
      : (win ? ['-NoProfile', '-NonInteractive', '-File', input.script] : [input.script])
    execFile(
      file,
      args,
      {
        cwd: input.cwd,
        timeout: SETUP_TIMEOUT_MS,
        env: { ...process.env, ...input.env },
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

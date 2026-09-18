/**
 * The `.worktrees.json` setup-step executor.
 *
 * A step is either a shell command (`sh -c` / `cmd.exe /d /s /c`) or a
 * project-relative script (`sh <file>` / `powershell -File <file>`). Both run
 * with the fresh worktree as cwd and the environment from
 * `core/worktree.ts`'s `setupChildEnv`.
 *
 * Steps are bounded: each has its own timeout, output is captured and clipped,
 * and the first failure stops the sequence (later steps would run against a
 * broken checkout). The result is reported to the panel, not thrown: a failed
 * setup leaves a usable worktree.
 */

import { execFile } from 'node:child_process'
import { setupChildEnv } from '../core/worktree.ts'
import type { SetupStep } from '../core/types.ts'

/** Output ceiling kept from a step's combined streams. */
export const SETUP_OUTPUT_MAX = 4000

/** Per-step timeout. */
export const SETUP_TIMEOUT_MS = 600_000

/** One step's outcome. */
export interface SetupStepResult {
  readonly code: number
  readonly output: string
}

/** Executes one setup step. Injectable so tests never spawn a shell. */
export type SetupExec = (
  step: SetupStep,
  cwd: string,
  env: Readonly<Record<string, string>>,
  timeoutMs: number,
) => Promise<SetupStepResult>

/** The last `max` characters of a step's output, trimmed. */
export function clipSetupOutput(raw: string, max: number = SETUP_OUTPUT_MAX): string {
  const trimmed = raw.trim()
  if (trimmed === '') return ''
  return trimmed.length <= max ? trimmed : `…${trimmed.slice(trimmed.length - max)}`
}

/** Production executor. */
export const execSetupStep: SetupExec = (step, cwd, env, timeoutMs) =>
  new Promise((resolve) => {
    const file = step.kind === 'script'
      ? (process.platform === 'win32' ? 'powershell' : 'sh')
      : (process.platform === 'win32' ? 'cmd.exe' : 'sh')
    const args = step.kind === 'script'
      ? (process.platform === 'win32' ? ['-NoProfile', '-File', step.path] : [step.path])
      : (process.platform === 'win32' ? ['/d', '/s', '/c', step.command] : ['-c', step.command])
    execFile(
      file,
      args,
      { cwd, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, env: { ...env }, windowsHide: true },
      (error, stdout, stderr) => {
        const err = error as (Error & { code?: number | string }) | null
        const code = typeof err?.code === 'number' ? err.code : err === null ? 0 : 1
        resolve({ code, output: clipSetupOutput(`${stdout ?? ''}${stderr ?? ''}`) })
      },
    )
  })

/**
 * Run a resolved step list in order.
 *
 * @param steps - steps from `resolveSetupSteps`.
 * @param worktreePath - the fresh worktree (cwd for every step).
 * @param primary - the primary checkout path (`ROOT_WORKTREE_PATH`).
 * @param options - injectable executor, parent env and timeout.
 * @returns the number of steps that ran, whether one failed, and the last output.
 */
export async function runSetupSteps(
  steps: readonly SetupStep[],
  worktreePath: string,
  primary: string,
  options: {
    exec?: SetupExec
    parentEnv?: Readonly<Record<string, string | undefined>>
    timeoutMs?: number
  } = {},
): Promise<{ ran: number; failed: boolean; output: string }> {
  const exec = options.exec ?? execSetupStep
  const env = setupChildEnv(options.parentEnv ?? process.env, { ROOT_WORKTREE_PATH: primary }, worktreePath)
  const timeoutMs = options.timeoutMs ?? SETUP_TIMEOUT_MS
  let ran = 0
  let failed = false
  let output = ''

  for (const step of steps) {
    const result = await exec(step, worktreePath, env, timeoutMs)
    ran += 1
    output = result.output
    if (result.code !== 0) {
      failed = true
      break
    }
  }

  return { ran, failed, output }
}

/** The git-clean status of a setup run: success is `ran` steps and no failure. */
export function setupSucceeded(report: { ran: number; failed: boolean }): boolean {
  return !report.failed
}

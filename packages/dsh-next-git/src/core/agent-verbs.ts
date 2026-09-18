/**
 * The agent verbs' payload contract.
 *
 * "Review changes", "Explain diff", "Draft commit message" and "Resolve in
 * this session" hand the running session a prompt. What is sent, how much of
 * it, and where the result lands are part of the contract, not an accident of
 * the call site:
 *
 * - the payload is a plain prompt text;
 * - file lists are capped at {@link MAX_AGENT_FILES};
 * - diff text is capped at {@link MAX_AGENT_DIFF_CHARS}, per file and in
 *   total, always whole lines, with an explicit truncation marker naming how
 *   much was dropped;
 * - the result lands in the session's chat as a normal queued turn, which is
 *   the only place an agent answer can be reviewed and steered.
 */

import type { PanelState } from './types.ts'

/** The four agent verbs the panel offers. */
export type AgentVerb = 'review' | 'explain' | 'draft' | 'resolve'

/** File-list cap in one payload. */
export const MAX_AGENT_FILES = 40

/** Diff-text cap per file. */
export const MAX_AGENT_DIFF_CHARS = 8000

/** Total diff-text cap in one payload. */
export const MAX_AGENT_TOTAL_CHARS = 24000

/** One file's contribution to a payload. */
export interface AgentFileInput {
  readonly path: string
  /** Patch text; empty for an untracked or binary file with no rendered diff. */
  readonly patch: string
  readonly added: number
  readonly removed: number
  readonly binary: boolean
  readonly staged: boolean
}

/** What the panel sends, and what it tells the user was dropped. */
export interface AgentPayload {
  readonly verb: AgentVerb
  readonly prompt: string
  readonly includedFiles: readonly string[]
  readonly droppedFiles: readonly string[]
  readonly truncated: boolean
}

/** Trim text to at most `max` characters, ending on a line boundary. */
export function truncatePatch(patch: string, max: number = MAX_AGENT_DIFF_CHARS): { text: string; truncated: boolean } {
  if (patch.length <= max) return { text: patch, truncated: false }
  const clipped = patch.slice(0, max)
  const at = clipped.lastIndexOf('\n')
  const text = at <= 0 ? clipped : clipped.slice(0, at)
  return { text, truncated: true }
}

/** A compact file list line for the payload's header. */
export function fileListLine(files: readonly AgentFileInput[]): string {
  return files
    .map((file) => {
      const side = file.staged ? 'staged' : 'unstaged'
      const counts = file.binary ? 'binary' : `+${file.added}/-${file.removed}`
      return `- ${file.path} (${side}, ${counts})`
    })
    .join('\n')
}

/** The instruction each verb prepends to its payload. */
export function verbInstruction(verb: AgentVerb): string {
  switch (verb) {
    case 'review':
      return 'Review the uncommitted changes below for correctness, risk and missing tests. Report findings as a short list; do not change any file.'
    case 'explain':
      return 'Explain what the change below does and why it matters. Be concise and concrete.'
    case 'draft':
      return 'Draft a single Conventional Commit subject (max 72 characters) and an optional short body for the changes below. Reply with the message only.'
    case 'resolve':
      return 'Resolve the conflicts in the files below. Read each unmerged file, write the resolved content, then tell me which files still need review.'
  }
}

/**
 * Build the payload for one verb.
 *
 * @param input - verb, repository state, changed files and the conflict list.
 * @returns the prompt text plus the accounting the panel shows.
 */
export function buildAgentPayload(input: {
  verb: AgentVerb
  state: PanelState
  files: readonly AgentFileInput[]
  conflicts?: readonly string[]
}): AgentPayload {
  const { verb, state } = input
  const conflicts = input.conflicts ?? state.operation.conflicts
  const files = verb === 'resolve'
    ? input.files.filter((file) => conflicts.includes(file.path) || conflicts.length === 0)
    : input.files
  const included = files.slice(0, MAX_AGENT_FILES)
  const dropped = files.slice(MAX_AGENT_FILES).map((file) => file.path)

  const heading = [
    verbInstruction(verb),
    '',
    `Repository: ${state.root}`,
    `Branch: ${state.head.branch ?? '(detached HEAD)'}`,
    state.operation.kind === null ? 'Operation: none' : `Operation: ${state.operation.kind} in progress`,
    '',
    'Changed files:',
    fileListLine(included) === '' ? '(none)' : fileListLine(included),
  ]

  if (conflicts.length > 0) {
    heading.push('', 'Unmerged paths:', ...conflicts.map((path) => `- ${path}`))
  }

  let budget = MAX_AGENT_TOTAL_CHARS
  let truncated = dropped.length > 0
  const body: string[] = []
  for (const file of included) {
    if (budget <= 0) {
      truncated = true
      body.push(`\n[diff for ${file.path} omitted: payload budget exhausted]`)
      continue
    }
    if (file.binary) {
      body.push(`\n--- binary file: ${file.path} ---`)
      continue
    }
    if (file.patch === '') {
      body.push(`\n--- no rendered diff: ${file.path} ---`)
      continue
    }
    const perFile = truncatePatch(file.patch, Math.min(MAX_AGENT_DIFF_CHARS, budget))
    budget -= perFile.text.length
    if (perFile.truncated) truncated = true
    body.push(`\n--- ${file.path} ---\n${perFile.text}${perFile.truncated ? '\n[diff truncated]' : ''}`)
  }

  const tail = dropped.length > 0 ? `\n\n[${dropped.length} more changed file(s) not included]` : ''
  return {
    verb,
    prompt: `${heading.join('\n')}\n${body.join('\n')}${tail}\n`,
    includedFiles: included.map((file) => file.path),
    droppedFiles: dropped,
    truncated,
  }
}

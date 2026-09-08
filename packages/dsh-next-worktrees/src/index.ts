/**
 * Host loader entry for the worktrees plugin — runs in the DSH host process.
 *
 * Wires the git runner and registry store into the orchestration service
 * and serves the same-origin RPC route. DSH touchpoints are exactly two
 * ports: session-cwd lookup through the session store, and the canonical
 * sandbox-knob writer (`setSandboxMode`) — the write that makes git usable
 * inside a linked worktree (proven in
 * docs/archive/2026-09-04-worktrees-m0-probe.md).
 */
import { constants } from 'node:fs'
import { access, appendFile, lstat, mkdir, open, readFile } from 'node:fs/promises'
import { dirname, join, parse, relative } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
// Merges the host-side `sessions` service declaration (ctx.sessions).
import type {} from '@deepseek-ai/dsh-session'
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import { GitRunner } from './host/git.ts'
import { RegistryStore } from './host/registry-store.ts'
import {
  WorktreesService,
  type ApplySandboxMode,
  type GetSessionCwd,
  type IsSessionRunning,
} from './host/service.ts'
import { registerRpc } from './host/rpc.ts'
import { runSetupCommand } from './host/setup-exec.ts'
import { WORKTREES_SERVICE_KEY } from './core/service-key.ts'

export const inject = ['webServer', 'sessions'] as const

/** Create a fresh destination without traversing committed symlink paths. */
async function prepareCopyDestination(path: string): Promise<boolean> {
  const directory = dirname(path)
  const root = parse(directory).root
  let current = root
  for (const segment of relative(root, directory).split(/[\\/]/).filter(Boolean)) {
    current = join(current, segment)
    try {
      const entry = await lstat(current)
      if (!entry.isDirectory() || entry.isSymbolicLink()) return false
    } catch {
      try {
        await mkdir(current)
      } catch {
        return false
      }
    }
  }
  try {
    await lstat(path)
    // Includes are for untracked local files. Never replace a tracked file,
    // symlink, or a path that appeared while the destination was prepared.
    return false
  } catch {
    return true
  }
}

/** Copy with an exclusive, no-follow destination handle. */
async function copyIncludedFile(from: string, to: string): Promise<void> {
  if (!await prepareCopyDestination(to)) return
  const source = await open(from, 'r')
  let destination: typeof source | undefined
  try {
    const mode = (await source.stat()).mode & 0o777
    destination = await open(
      to,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      mode,
    )
    const buffer = Buffer.allocUnsafe(64 * 1024)
    let position = 0
    for (;;) {
      const { bytesRead } = await source.read(buffer, 0, buffer.length, position)
      if (bytesRead === 0) break
      await destination.write(buffer, 0, bytesRead, position)
      position += bytesRead
    }
  } finally {
    await destination?.close().catch(() => {})
    await source.close().catch(() => {})
  }
}

export function apply(ctx: Context): void {
  const git = new GitRunner()
  const store = new RegistryStore()

  // The session store's keyed lookup takes a branded SessionId; the RPC
  // boundary deals in plain strings, so retype the face once, locally.
  const sessions = ctx.get('sessions') as unknown as
    | { get(id: string): { header: { cwd: string } } | undefined }
    | undefined

  const getSessionCwd: GetSessionCwd = (sessionId) => {
    const session = sessions?.get?.(sessionId)
    return session && typeof session.header?.cwd === 'string' ? session.header.cwd : null
  }

  const applySandboxMode: ApplySandboxMode = (sessionId, mode) => {
    const session = sessions?.get?.(sessionId)
    if (!session) return false
    try {
      // The retyped lookup face loses the full Session type; the knob
      // writer only reads the header and appends events.
      setSandboxMode(session as Parameters<typeof setSandboxMode>[0], mode)
      return true
    } catch {
      return false
    }
  }

  const isSessionRunning: IsSessionRunning = (sessionId) => {
    const session = sessions?.get?.(sessionId) as { running?: boolean } | undefined
    return session?.running === true
  }

  const service = new WorktreesService({
    git,
    store,
    getSessionCwd,
    applySandboxMode,
    isSessionRunning,
    copyFile: async (from, to) => {
      try {
        await copyIncludedFile(from, to)
      } catch {
        // Best-effort convention: a missing source copies nothing.
      }
    },
    readText: async (path) => {
      try {
        return await readFile(path, 'utf8')
      } catch {
        return null
      }
    },
    exists: async (path) => {
      try {
        await access(path)
        return true
      } catch {
        return false
      }
    },
    ensureDotDshIgnored: async (primary) => {
      const ignored = await git.raw(['check-ignore', '-q', '.dsh'], primary)
      if (ignored.code === 0) return
      const excludePath = `${primary}/.git/info/exclude`
      let current = ''
      try {
        current = await readFile(excludePath, 'utf8')
      } catch {
        current = ''
      }
      if (/(?:^|\n)\.dsh\/?(?:\n|$)/.test(current)) return
      await mkdir(dirname(excludePath), { recursive: true })
      const prefix = current === '' || current.endsWith('\n') ? '' : '\n'
      await appendFile(
        excludePath,
        `${prefix}# dsh-next-worktrees nested checkouts\n.dsh/\n`,
      )
    },
    runCommand: runSetupCommand,
    platform: process.platform,
  })
  ctx.provide(WORKTREES_SERVICE_KEY, {
    reclaim: (from: string, to: string) => service.reclaim(from, to),
  })
  registerRpc(ctx, service)
}

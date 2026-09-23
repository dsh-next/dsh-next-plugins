/**
 * Host loader entry for the git plugin.
 *
 * The host half owns one thing: a git service the browser panel drives over
 * the same-origin RPC route. It also publishes the service on two Cordis keys:
 *
 * - `dsh-next-git` — this plugin's own key, for any future structural consumer;
 * - `dsh-next-worktrees` — the key `dsh-next-checkpoints` already resolves for
 *   its reincarnation handshake. It looks it up structurally and only calls
 *   `reclaim(from, to)`, so keeping the retired key alive here is what lets
 *   that migration stay a rename rather than an edit in another package (see
 *   `docs/ideas/dsh-next-git.md`, "Key Assumptions").
 *
 * Keep this entry thin: logic lives in `src/host/`, pure logic in `src/core/`.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ModelCatalog } from '@deepseek-ai/dsh-api-session-controller/types'
import { nodeFs } from './host/fs-adapter.ts'
import { GitService } from './host/git-service.ts'
import { CancellationRegistry, GitRunner } from './host/git-runner.ts'
import { registerRpc } from './host/rpc.ts'
import type { ReclaimResult } from './core/types.ts'
import { GitDrafting, currentDraftModel, GIT_SETTINGS_NAMESPACE, gitSettingsSchema, type DraftingSettingsStore, type DraftSettings } from './host/drafting.ts'
import { createConfigEditorDraftingStore, type ConfigEditor, type LoaderConfigEntry } from './host/drafting-config.ts'

/** Commit-message preferences live in this plugin's Loader entry config. */
export const Config = gitSettingsSchema

/** Services the host half needs. */
export const inject = ['webServer', 'sessions', 'settings', 'llm', 'sessionController'] as const

/** This plugin's own service key. */
export const GIT_SERVICE_KEY = 'dsh-next-git'

/** The retired worktrees plugin's key, kept alive for reset and checkpoints. */
export const WORKTREES_SERVICE_KEY = 'dsh-next-worktrees'

/** The structural face reset and checkpoints consume off {@link WORKTREES_SERVICE_KEY}. */
export interface ReclaimFace {
  reclaim(from: string, to: string): Promise<ReclaimResult>
}

/** The narrow sessions view needed to resolve a session's working directory. */
interface SessionsFace {
  get?(id: string): { header?: { cwd?: string } } | undefined
}

export function apply(ctx: Context): void {
  const sessions = ctx.get('sessions') as SessionsFace | undefined
  const cancellations = new CancellationRegistry()
  const runner = new GitRunner()

  const service = new GitService({
    runner,
    fs: nodeFs(),
    cwdOf: (sessionId) => {
      const cwd = sessions?.get?.(sessionId)?.header?.cwd
      return typeof cwd === 'string' && cwd !== '' ? cwd : undefined
    },
    platform: process.platform,
    env: process.env,
    cancellations,
    logWarn: (message) => ctx.logger.warn(message),
  })

  ctx.provide(GIT_SERVICE_KEY, service)
  // The retired key: only `reclaim` is part of that contract, and consumers
  // match the shape structurally rather than importing this package.
  ctx.provide(WORKTREES_SERVICE_KEY, {
    reclaim: (from: string, to: string) => service.reclaim(from, to),
  } satisfies ReclaimFace)

  const settings = ctx.get('settings') as {
    register?: (namespace: string, schema: typeof gitSettingsSchema, options: { applies: 'live' }) => DraftingSettingsStore
    writable?: boolean
  } | undefined
  const registeredScope = typeof settings?.register === 'function'
    ? settings.register(GIT_SETTINGS_NAMESPACE, gitSettingsSchema, { applies: 'live' })
    : null
  const settingsWritable = registeredScope !== null && settings?.writable === true
  const editor = ctx.get('configEditor') as ConfigEditor | undefined
  const entry = editor?.entries().find((candidate: LoaderConfigEntry) =>
    candidate.id === GIT_SETTINGS_NAMESPACE || candidate.id === `include:${GIT_SETTINGS_NAMESPACE}`)
  const loaderScope = editor === undefined || entry === undefined
    ? null
    : createConfigEditorDraftingStore(editor, entry, () => {
      const current = editor.configuration().find(item => item.entry.id === entry.id)
      const values = { ...current?.inherited, ...current?.override }
      return {
        draftingProvider: typeof values.draftingProvider === 'string' ? values.draftingProvider : '',
        draftingModel: typeof values.draftingModel === 'string' ? values.draftingModel : '',
        draftingInstructions: typeof values.draftingInstructions === 'string' ? values.draftingInstructions : '',
      }
    })
  const scope = settingsWritable ? registeredScope : loaderScope ?? registeredScope
  const writable = settingsWritable || loaderScope !== null
  if (!writable) {
    ctx.logger.warn('dsh-next-git: drafting preferences are read-only in this runtime')
  }
  const drafting = new GitDrafting({
    service, runner, scope,
    stream: options => ctx.llm.stream(options),
    modelFor: sessionId => currentDraftModel(ctx, sessionId),
    modelCatalog: () => (ctx.get('sessionController') as { modelCatalog(): Promise<ModelCatalog> }).modelCatalog(),
    writable: () => writable,
  })
  registerRpc(ctx, service, drafting)

  ctx.effect(() => () => {
    drafting.dispose()
    cancellations.dispose()
  }, 'dsh-next-git: cancel in-flight git reads')
}

import { normalizeConfig } from '../core/settings.ts'
import type { PluginConfigShape } from '../core/schema.ts'
import type { ConfigScopeFace } from './service.ts'

/** Bound on waiting for a config write to reach the live fiber (100 x 20ms). */
const PUBLISH_ATTEMPTS = 100

/** Interval between publish checks while a config write settles. */
const PUBLISH_INTERVAL_MS = 20

/** The volatile section this plugin reads and writes. */
interface ProvidersRef {
  get(): unknown
}

/** Structural face of the profile config editor this plugin writes through. */
export interface ConfigEditorFace {
  edit(
    entry: unknown,
    change: (current: Record<string, unknown>, inherited: Record<string, unknown>) => Record<string, unknown>,
  ): Promise<void>
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

/** The settings service's describe face, host side (no redaction). */
export interface SettingsDescribeFace {
  describe(options?: { redactSecrets?: boolean }): Array<{ ns: string; revision: number; value?: unknown; user?: unknown }>
}

/** The `providers` section a settings value carries, or undefined when it carries none. */
function providersOf(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  return 'providers' in value ? (value as { providers: unknown }).providers : undefined
}

/** Whether a providers section names anything: a row array or a profile dict. */
function listsProviders(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0
  return value !== null && typeof value === 'object' && Object.keys(value).length > 0
}

interface ConfigScopeOptions {
  config?: PluginConfigShape
  entry: unknown
  entryId: string
  editor?: ConfigEditorFace
  settings?: SettingsDescribeFace
}

/** Keep legacy settings reads and live-fiber write settlement in one host module. */
export function createConfigScope({ config, entry, entryId, editor, settings }: ConfigScopeOptions): ConfigScopeFace {
  const providersRef = (config?.providers ?? { get: () => [] }) as unknown as ProvidersRef
  /**
   * The section to read. The settings service projects the *live* fiber's
   * config, which is what a `configEditor` write publishes; the resolved
   * volatile reference the plugin was handed can lag that commit, so it is
   * only a fallback.
   *
   * An empty resolved section does not always mean an empty configuration: a
   * pre-0.1.7 `settings.yaml` section stores `providers` as a row array, which
   * the dict schema cannot carry and resolves to its empty default. The raw
   * user layer still holds those rows, so it is read here — that is what lets
   * `hydrate()` rewrite the stored section into the dict shape once instead of
   * dropping an existing setup.
   */
  const readProviders = (): unknown => {
    let descriptor: { value?: unknown; user?: unknown } | undefined
    try {
      descriptor = settings?.describe?.().find((row) => row.ns === entryId)
    } catch {
      // A settings surface that cannot describe falls through to the fiber config.
    }
    if (descriptor !== undefined) {
      const resolved = providersOf(descriptor.value)
      if (listsProviders(resolved)) return resolved
      const stored = providersOf(descriptor.user)
      return listsProviders(stored) ? stored : resolved
    }
    const live = (entry as { options?: { config?: { providers?: unknown } } } | undefined)?.options?.config?.providers
    return live !== undefined ? live : providersRef.get()
  }

  /**
   * Wait for the write to reach the live fiber. The profile's own patch reload
   * publishes a `configEditor` write, so the running section can trail the
   * edit; answering an RPC before it lands would report the previous profile.
   */
  const awaitPublished = async (providers: unknown): Promise<void> => {
    const expected = JSON.stringify(normalizeConfig({ providers }))
    for (let attempt = 0; attempt < PUBLISH_ATTEMPTS; attempt += 1) {
      const live = (entry as { options?: { config?: { providers?: unknown } } } | undefined)?.options?.config?.providers
      if (JSON.stringify(normalizeConfig({ providers: live })) === expected) return
      await new Promise<void>((resolve) => { setTimeout(resolve, PUBLISH_INTERVAL_MS) })
    }
  }

  /** Persist the next provider section through the native profile patch. */
  const write = async (providers: unknown): Promise<void> => {
    if (editor === undefined || entry === undefined) return
    await editor.edit(entry, (current) => ({ ...current, providers }))
    await awaitPublished(providers)
  }

  const scope: ConfigScopeFace = {
    get: () => ({ providers: readProviders() }),
    update: async (patch) => {
      const next = asRecord(patch)
      const providers = 'providers' in next ? next.providers : readProviders()
      await write(providers)
    },
    replace: async (section) => {
      await write(asRecord(section).providers ?? [])
    },
    watch: () => () => {},
  }

  return scope
}

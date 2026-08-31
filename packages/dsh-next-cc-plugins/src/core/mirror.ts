/**
 * The shareable settings mirror: this plugin's setup (marketplaces,
 * installed plugins, agent model mappings) rendered into one
 * `cc-plugins` namespace section of the DSH user-settings document
 * (`$DSH_HOME/settings.yaml`) — the same document the Models page stores
 * model providers in, so a single file carries a whole setup across
 * machines.
 *
 * The section is written through on every panel mutation and read back at
 * boot (and on external edits, which the settings provider hot-publishes):
 * missing marketplaces are added and missing plugins installed into their
 * recorded targets. Removals stay explicit through the panel — a hand edit
 * never uninstalls anything.
 *
 * Encoding stays YAML-friendly plain data: install targets render as
 * `global` / `workspace:<folder name>` strings (folder names travel across
 * machines; each machine resolves them against its own workspace registry,
 * and absolute paths are still accepted when hand-written), and the model
 * map's explicit inherit marker (`null`) renders as the word `inherit`.
 */
import type { InstalledPlugin, TargetLike } from './types.ts'

/** The word written for "this alias inherits the session's model". */
export const MIRROR_INHERIT = 'inherit'

/** One installed plugin as mirrored into the settings document. */
export interface MirrorInstall {
  /** The marketplace spec (owner/repo shorthand or path) the plugin came from. */
  marketplace: string
  /** Plugin name inside the marketplace index. */
  plugin: string
  /** Encoded install targets: `global` or `workspace:<abs path>`. */
  targets: string[]
}

/** The `cc-plugins` namespace section. */
export interface MirrorSection {
  marketplaces: string[]
  installs: MirrorInstall[]
  /** Claude alias to DSH model id, or {@link MIRROR_INHERIT}. */
  models: Record<string, string>
}

/** One decoded mirror target string. */
export type MirrorTarget =
  | { kind: 'global' }
  | { kind: 'workspace-path'; path: string }
  | { kind: 'workspace-name'; name: string }

/**
 * Encode one install target for the settings document. Workspace targets
 * write only the folder name (`workspace:web`): absolute paths differ on
 * every machine, so the shared file stays portable and reconcile matches
 * the name against the local workspace registry.
 */
export function encodeTarget(target: TargetLike): string {
  if (target.scope !== 'workspace') return 'global'
  const path = target.workspacePath ?? ''
  const name = path.split('/').filter(Boolean).pop() ?? path
  return `workspace:${name}`
}

/**
 * Classify one settings-document target string. Absolute paths
 * (`workspace:/abs/path`, the pre-portable form) stay supported for
 * hand-written files and exactness; malformed strings return undefined.
 */
export function classifyMirrorTarget(raw: string): MirrorTarget | undefined {
  if (raw === 'global') return { kind: 'global' }
  if (raw.startsWith('workspace:')) {
    const inner = raw.slice('workspace:'.length)
    if (inner === '') return undefined
    if (inner.startsWith('/')) return { kind: 'workspace-path', path: inner }
    return { kind: 'workspace-name', name: inner }
  }
  return undefined
}

/**
 * Render the whole section from the plugin's persisted state. Marketplaces
 * and installs sort by identity so repeated writes produce minimal diffs
 * (the settings provider replaces changed arrays wholesale).
 */
export function renderMirror(input: {
  marketplaces: ReadonlyArray<{ spec: string }>
  installed: readonly InstalledPlugin[]
  /** The saved overrides; `null` is the explicit inherit marker. */
  models: Record<string, string | null>
}): MirrorSection {
  const marketplaces = [...input.marketplaces].map((m) => m.spec).sort((a, b) => a.localeCompare(b))
  const installs = [...input.installed]
    .map((p): MirrorInstall => ({
      marketplace: p.marketplaceSpec,
      plugin: p.pluginName,
      targets: p.targets.map((t) => encodeTarget(t)).sort(),
    }))
    .sort((a, b) => `${a.marketplace}/${a.plugin}`.localeCompare(`${b.marketplace}/${b.plugin}`))
  const models: Record<string, string> = {}
  for (const [alias, model] of Object.entries(input.models)) {
    models[alias] = model ?? MIRROR_INHERIT
  }
  return { marketplaces, installs, models }
}

/**
 * Tolerant parse of the section as the settings provider resolved it:
 * non-object input, non-string scalars, and malformed entries drop out
 * rather than failing the whole read.
 */
export function parseMirror(raw: unknown): MirrorSection {
  const section: MirrorSection = { marketplaces: [], installs: [], models: {} }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return section
  const doc = raw as Record<string, unknown>
  if (Array.isArray(doc.marketplaces)) {
    section.marketplaces = doc.marketplaces.filter((s): s is string => typeof s === 'string' && s.trim() !== '')
  }
  if (Array.isArray(doc.installs)) {
    for (const entry of doc.installs) {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue
      const e = entry as Record<string, unknown>
      if (typeof e.marketplace !== 'string' || typeof e.plugin !== 'string') continue
      const targets = Array.isArray(e.targets)
        ? e.targets.filter((t): t is string => typeof t === 'string')
        : []
      section.installs.push({ marketplace: e.marketplace, plugin: e.plugin, targets })
    }
  }
  if (doc.models !== null && typeof doc.models === 'object' && !Array.isArray(doc.models)) {
    for (const [alias, model] of Object.entries(doc.models as Record<string, unknown>)) {
      if (typeof model === 'string' && model.trim() !== '') section.models[alias] = model.trim()
    }
  }
  return section
}

/**
 * The settings-seam adapter the host entry injects (a registered namespace
 * scope); the service stays testable with an in-memory double.
 */
export interface SettingsMirror {
  /** The provider's currently resolved section value. */
  read(): unknown
  /** Replace the user-layer section wholesale. */
  write(section: MirrorSection): Promise<void>
}

/**
 * The shareable settings mirror: this plugin's setup (marketplaces,
 * installed plugins with their install scope, agent model mappings)
 * rendered into one `cc-plugins` namespace section of the DSH user-settings
 * document (`$DSH_HOME/settings.yaml`) — the same document the Models page
 * stores model providers in, so a single file carries a whole setup across
 * machines.
 *
 * The section is written through on every panel mutation and read back at
 * boot (and on external edits, which the settings provider hot-publishes):
 * missing marketplaces are added and missing plugins installed into their
 * recorded scope. Removals stay explicit through the panel — a hand edit
 * never uninstalls anything.
 *
 * Scope encoding stays YAML-friendly and portable: a global install writes
 * nothing (the default), a workspace install writes the folder names of its
 * workspaces (`workspaces: [web, data]`) — absolute paths differ on every
 * machine, so reconcile resolves each name against that machine's
 * workspace registry. Hand-written absolute paths still work. Documents
 * from the pre-scope shape (installs carrying `targets` lists) import too:
 * any `global` entry means global; otherwise workspace-name entries become
 * the workspace set.
 */
import type { InstalledPlugin } from './types.ts'

/** The word written for "this alias inherits the session's model". */
export const MIRROR_INHERIT = 'inherit'

/** One installed plugin as mirrored into the settings document. */
export interface MirrorInstall {
  /** The marketplace spec (owner/repo shorthand or path) the plugin came from. */
  marketplace: string
  /** Plugin name inside the marketplace index. */
  plugin: string
  /** Folder names of the workspaces the plugin is scoped to; absent or
   *  empty means the global scope. */
  workspaces?: string[]
}

/** The `cc-plugins` namespace section. */
export interface MirrorSection {
  marketplaces: string[]
  installs: MirrorInstall[]
  /** Claude alias to DSH model id, or {@link MIRROR_INHERIT}. */
  models: Record<string, string>
}

/** One decoded mirror workspace reference. */
export type MirrorWorkspace =
  | { kind: 'name'; name: string }
  | { kind: 'path'; path: string }

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
    .map((p): MirrorInstall => {
      const base: MirrorInstall = { marketplace: p.marketplaceSpec, plugin: p.pluginName }
      if (p.scope.kind === 'workspaces') {
        // Folder names only: absolute paths differ per machine.
        base.workspaces = p.scope.workspacePaths.map((p2) => p2.split('/').filter(Boolean).pop() ?? p2).sort()
      }
      return base
    })
    .sort((a, b) => `${a.marketplace}/${a.plugin}`.localeCompare(`${b.marketplace}/${b.plugin}`))
  const models: Record<string, string> = {}
  for (const [alias, model] of Object.entries(input.models)) {
    models[alias] = model ?? MIRROR_INHERIT
  }
  return { marketplaces, installs, models }
}

/**
 * Classify one hand-written workspace reference: a folder name resolves
 * through the local workspace registry, an absolute path is used as-is.
 * Malformed strings return undefined.
 */
export function classifyMirrorWorkspace(raw: string): MirrorWorkspace | undefined {
  if (raw.trim() === '') return undefined
  if (raw.startsWith('/')) return { kind: 'path', path: raw }
  return { kind: 'name', name: raw }
}

/**
 * Tolerant parse of the section as the settings provider resolved it:
 * non-object input, non-string scalars, and malformed entries drop out
 * rather than failing the whole read. Legacy `targets` lists on installs
 * (the pre-scope encoding) are honored: `global` wins, otherwise
 * workspace-name entries become the workspace set.
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
      const install: MirrorInstall = { marketplace: e.marketplace, plugin: e.plugin }
      const workspaces = Array.isArray(e.workspaces)
        ? e.workspaces.filter((w): w is string => typeof w === 'string' && w.trim() !== '')
        : undefined
      if (workspaces !== undefined && workspaces.length > 0) {
        install.workspaces = workspaces
      } else if (workspaces === undefined && Array.isArray(e.targets)) {
        // Legacy encoding: 'global' or 'workspace:<name|abs path>'.
        const names: string[] = []
        let global = false
        for (const t of e.targets) {
          if (typeof t !== 'string') continue
          if (t === 'global') { global = true; continue }
          if (t.startsWith('workspace:')) {
            const inner = t.slice('workspace:'.length)
            if (inner === '') continue
            names.push(inner.startsWith('/') ? (inner.split('/').filter(Boolean).pop() ?? inner) : inner)
          }
        }
        if (!global && names.length > 0) install.workspaces = [...new Set(names)].sort()
      }
      section.installs.push(install)
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

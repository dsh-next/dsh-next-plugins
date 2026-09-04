/**
 * English dictionary — the key source for the `cc-plugins` locale namespace.
 *
 * English is this repo's language and the platform's fallback locale, so the
 * key set is defined here; `zh.ts` mirrors it (a missing or extra zh key is a
 * compile error via `Record<MessageKey, string>`, and the platform's typed
 * `register` checks both sides against the namespace's key union again).
 * Values may carry `{name}` placeholders — the platform's `t(key, params)`
 * substitutes them.
 *
 * English values are byte-identical to the strings this panel rendered
 * before localization, so English-language tests assert the same text.
 */

/** Dictionary namespace this panel owns (also the slot label's namespace). */
export const NS = 'cc-plugins'

export const en = {
  'nav': 'Claude Plugins',

  // Page scaffold (the shell's settings-section pattern: title, intro, tab
  // strip aria-label), mirroring the skills page's key set.
  'title': 'Claude Plugins',
  'intro': 'Install plugins from Claude Code marketplaces and control where each one works.',
  'tabs': 'Plugin views',

  'tab.plugins': 'Plugins',
  'tab.marketplaces': 'Marketplaces',
  'tab.models': 'Models',

  'search.placeholder': 'Search plugins…',
  'provider.aria': 'Marketplace',
  'provider.all': 'All marketplaces',
  'filter.installedOnly': 'Installed only',

  'empty.noMarketplacesPlugins': 'No marketplaces added yet. Add one in the Marketplaces tab (owner/repo GitHub shorthand, a GitHub URL, or a local path).',
  'empty.noMatch': 'No plugins match the current filters.',
  'empty.noMarketplacesSources': 'No marketplaces added yet. Add one with an owner/repo GitHub shorthand, a GitHub URL, or a local path.',

  'card.noDescription': 'no description',
  'card.notInstallable': 'not installable: {reason}',
  'card.resolveOnInstall': 'components resolve on install',
  'card.installedVersion': 'installed {version}',
  'card.noteCount.one': '{count} install note',
  'card.noteCount.many': '{count} install notes',
  'card.detailsTitle': 'details for {key}',
  'card.updateTitle': 'update {key} to {version}',
  'card.update': 'Update',
  'card.scopes': 'Scopes',
  'card.install': 'Install',

  'summary.skill.one': '{count} skill',
  'summary.skill.many': '{count} skills',
  'summary.mcp.one': '{count} MCP server',
  'summary.mcp.many': '{count} MCP servers',
  'summary.command.one': '{count} command',
  'summary.command.many': '{count} commands',
  'summary.agent.one': '{count} agent tool',
  'summary.agent.many': '{count} agent tools',
  'summary.hook.one': '{count} hook event (enable runtime.hooks)',
  'summary.hook.many': '{count} hook events (enable runtime.hooks)',
  'summary.requires': 'requires: {deps}',
  'summary.noComponents': 'no components',

  'unbridged.prefix': 'not bridged: ',
  'unbridged.lsp.one': '{count} LSP server',
  'unbridged.lsp.many': '{count} LSP servers',
  'unbridged.monitors.one': '{count} monitor',
  'unbridged.monitors.many': '{count} monitors',
  'unbridged.outputStyles.one': '{count} output style',
  'unbridged.outputStyles.many': '{count} output styles',
  'unbridged.themes.one': '{count} theme',
  'unbridged.themes.many': '{count} themes',
  'unbridged.workflows.one': '{count} workflow',
  'unbridged.workflows.many': '{count} workflows',
  'unbridged.executables.one': '{count} executable',
  'unbridged.executables.many': '{count} executables',
  'unbridged.settings.one': '{count} settings file',
  'unbridged.settings.many': '{count} settings files',

  'presence.global': 'global',
  'presence.in': 'in {targets}',
  'presence.installed': 'installed',

  'sync.never': 'never',
  'sync.unknown': 'unknown',
  'sync.justNow': 'just now',
  'sync.minutesAgo': '{count}m ago',
  'sync.hoursAgo': '{count}h ago',
  'sync.daysAgo': '{count}d ago',

  'modal.aria': 'Manage plugin "{name}"',
  'modal.available': '{version} available',
  'modal.hint': 'Choose where this plugin works. Skills install globally; the scope enables them in the selected workspaces. MCP servers, agents, commands, and hooks are plugin-level and activate once regardless of scope.',
  'modal.scope.global': 'Global (every workspace)',
  'modal.scope.workspaces': 'Selected workspaces',
  'modal.workspaces.hint': 'Skills are enabled only in the checked workspaces.',
  'modal.workspaces.empty': 'No workspaces registered.',
  'modal.workspaceMissing': 'not registered',
  'modal.save': 'Save scope',
  'modal.uninstall': 'Uninstall',
  'modal.uninstallTitle': 'Uninstall {name}?',
  'modal.uninstallHint': 'This removes the plugin and its components from your agent configuration.',
  'modal.cancel': 'Cancel',

  'detail.aria': 'Plugin details "{name}"',
  'detail.version': 'version {version}',
  'detail.notInstalled': 'not installed',
  'detail.from': 'from {marketplace}',
  'detail.author': 'author',
  'detail.homepage': 'homepage',
  'detail.category': 'category',
  'detail.tags': 'tags',
  'detail.skills': 'skills',
  'detail.commands': 'commands',
  'detail.agents': 'agents',
  'detail.mcpServers': 'MCP servers',
  'detail.hookEvents': 'hook events',
  'detail.notBridged': 'not bridged',
  'detail.requires': 'requires',
  'detail.inventoryNotes': 'inventory notes',
  'detail.close': 'Close',

  'marketplaces.placeholder': 'owner/repo, a GitHub URL, or a local path',
  'marketplaces.add': 'Add marketplace',
  'marketplaces.refreshAll': 'Refresh all',
  'marketplaces.refreshing': 'Refreshing…',
  'marketplaces.refreshProgress': 'Refreshing {done}/{total}…',
  'marketplaces.refreshedAll': 'Refreshed {count} marketplace(s)',
  'marketplaces.refreshFailed': 'Refresh failed for {count} marketplace(s): {items}',
  'marketplaces.hint': 'Snapshots older than 24 hours refresh automatically when this panel opens; Refresh all forces it now. Update buttons appear when a marketplace carries a newer version than the installed one.',
  'marketplaces.pluginCount.one': '{count} plugin',
  'marketplaces.pluginCount.many': '{count} plugins',
  'marketplaces.lastSynced': 'last synced {age}',
  'marketplaces.by': 'by {owner}',
  'marketplaces.remove': 'Remove',
  'marketplaces.removeAria': 'Remove marketplace "{name}"',
  'marketplaces.removeTitle': 'Remove {name}?',
  'marketplaces.removeHint': 'Installed plugins stay installed. The marketplace and its cached catalog are removed.',

  'status.requestFailed': 'Request failed',
  'status.done': 'Done',
  'status.refreshFailed': 'Refresh failed',

  'models.hint': "Map the Claude model names your agents use onto models this runtime offers. Unmapped names inherit the delegating session's model — the same default as Claude's `model: inherit` — and choosing inherit explicitly overrides a config-baseline mapping. Saving re-resolves installed agent rows without reinstalling; reload the profile to apply them.",
  'models.config': 'config',
  'models.selectAria': 'Model for {alias}',
  'models.inherit': 'Inherit session model',
  'models.save': 'Save model mappings',

  'import.skipped': '{count} import(s) from the settings file skipped on this machine (missing workspace names or sources): {items}. Register the workspace or install through the panel.',
}

/** Every dictionary key. */
export type MessageKey = keyof typeof en

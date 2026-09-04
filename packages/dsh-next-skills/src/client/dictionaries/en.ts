/**
 * English dictionary — the key source for the `skills` locale namespace.
 *
 * English is this repo's language and the platform's fallback locale, so the
 * key set is defined here; `zh.ts` mirrors it (a missing or extra zh key is a
 * compile error via `Record<MessageKey, string>`, and the platform's typed
 * `register` checks both sides against the namespace's key union again).
 * Values may carry `{name}` placeholders — the platform's `t(key, params)`
 * substitutes them.
 *
 * Keys follow the Claude Plugins page's conventions (`tab.*`, `search.*`,
 * `provider.*`, `filter.*`, `card.*`, `presence.*`, `sync.*`, `modal.*`,
 * `detail.*`) so the two settings pages stay grep-compatible; values adopt
 * the cc-plugins wording wherever the two surfaces share a concept.
 */

/** Dictionary namespace this panel owns (also the slot label's namespace). */
export const NS = 'skills'

export const en = {
  'nav': 'Skills',

  // Page scaffold (the shell's settings-section pattern: title, intro, tab
  // strip aria-label), mirroring the cc-plugins page's key set.
  'title': 'Skills',
  'intro': 'Install skills from providers and control where each one is enabled.',
  'tabs': 'Skill views',

  'tab.skills': 'Skills',
  'tab.providers': 'Providers',

  'search.placeholder': 'Search skills…',
  'provider.aria': 'Provider',
  'provider.all': 'All providers',
  'filter.installedOnly': 'Installed only',

  'empty.noProviders': 'No providers yet. Add a GitHub repository in the Providers tab to browse its skills.',
  'empty.noMatch': 'No skills match the current filters.',

  'card.noDescription': 'no description',
  'card.detailsTitle': 'details for {name}',
  'card.update': 'Update',
  'card.providers': 'Providers ({count})',
  'card.providersTitle': 'Switch where this skill comes from',
  'card.delete': 'Delete',
  'card.scopes': 'Scopes',
  'card.use': 'Use',
  'card.replace': 'Replace',

  'presence.everywhere': 'Everywhere',
  'presence.workspaces.one': '{count} workspace',
  'presence.workspaces.many': '{count} workspaces',
  'presence.off': 'Off',

  'source.projectDsh': 'project .dsh',
  'source.projectAgents': 'project .agents',
  'source.userDsh': 'user .dsh',
  'source.userAgents': 'user .agents',
  'source.custom': 'custom',

  'sync.never': 'never',
  'sync.unknown': 'unknown',
  'sync.justNow': 'just now',
  'sync.minutesAgo': '{count}m ago',
  'sync.hoursAgo': '{count}h ago',
  'sync.daysAgo': '{count}d ago',

  'modal.aria': 'Manage skill "{name}"',
  // The hint states the model: files install once, globally; the scope is
  // pure configuration and never writes into a project.
  'modal.hint': 'Skills install once, into your global skills directory; the scope only controls where they are enabled.',
  'modal.scope.global': 'Global (every workspace)',
  'modal.scope.workspaces': 'Selected workspaces',
  'modal.workspaces.hint': 'The skill works only in the checked workspaces.',
  'modal.workspaces.empty': 'No workspaces registered.',
  'modal.workspaceMissing': 'not registered',
  'modal.save': 'Save scope',
  'modal.cancel': 'Cancel',
  'modal.effectHint': 'Scope changes take effect on the next lookup or a new session.',
  'modal.confirmDelete': 'Delete',

  'delete.aria': 'Delete skill "{name}"',
  'delete.title': 'Delete {name}?',
  'delete.hint': 'This moves the copy below into the trash of its root (recoverable).',

  'sources.aria': 'Sources for skill "{name}"',
  'sources.title': 'Sources for {name}',
  'sources.hint': 'Pick where this skill comes from. Switching to a provider overwrites the copy in place.',
  'sources.local': 'Local (hand-managed)',
  'sources.localHint': 'Keep the files as they are; no provider updates.',
  'sources.current': 'Current',
  'sources.matches': 'Matches your copy',
  'sources.differs': 'Differs from your copy',
  'sources.detach': 'Detach',
  'sources.confirmTitle': 'Replace {name}?',
  // States the real updateSkill semantics: in-place overwrite, extras removed
  // permanently (no trash), scopes untouched.
  'sources.confirmBody': 'Your copy is overwritten with the {provider} version. Files that are not part of the provider copy are removed permanently (not moved to trash). Its visibility scopes are kept.',
  'sources.confirmReplace': 'Replace',

  'providers.placeholder': 'owner/repo or GitHub URL…',
  'providers.add': 'Add provider',
  'providers.refreshAll': 'Refresh all',
  'providers.refreshing': 'Refreshing…',
  'providers.refreshProgress': 'Refreshing {done}/{total}…',
  'providers.refreshFailed': 'Refresh failed for {count} provider(s): {items}',
  'providers.remove': 'Remove',
  'providers.skillCount.one': '{count} skill',
  'providers.skillCount.many': '{count} skills',
  'providers.lastSynced': 'last synced {age}',
  'providers.removeAria': 'Remove provider "{name}"',
  'providers.removeTitle': 'Remove {name}?',
  'providers.removeHint': 'Installed skills are kept. The provider and its cached skill catalog are removed.',
  'providers.hint': 'Providers are GitHub repositories with skill directories (a SKILL.md); syncing caches their files locally so installs work offline.',

  'detail.aria': 'Skill details "{name}"',
  'detail.modelInvocable': 'model invocable',
  'detail.modelBlocked': 'model blocked',
  'detail.userInvocable': 'user invocable',
  'detail.userBlocked': 'not user invocable',
  'detail.whenToUse': 'When to use: {text}',
  'detail.close': 'Close',

  'list.showMore': 'Show more skills',

  'status.working': 'Working…',
  'status.done': 'Done',
  'status.requestFailed': 'Request failed',
  'status.refreshFailed': 'Refresh failed',
  'rpc.failed': 'Skills request "{method}" failed (HTTP {status})',
}

/** Every dictionary key. */
export type MessageKey = keyof typeof en

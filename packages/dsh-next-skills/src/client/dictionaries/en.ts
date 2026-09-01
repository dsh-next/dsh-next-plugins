/**
 * English dictionary — the key source for the `skills` locale namespace.
 *
 * English is this repo's language and the platform's fallback locale, so the
 * key set is defined here; `zh.ts` mirrors it (a missing or extra zh key is a
 * compile error via `Record<MessageKey, string>`, and the platform's typed
 * `register` checks both sides against the namespace's key union again).
 * Values may carry `{name}` placeholders — the platform's `t(key, params)`
 * substitutes them.
 */

/** Dictionary namespace this panel owns (also the slot label's namespace). */
export const NS = 'skills'

export const en = {
  'section.title': 'Skills',

  'tab.skills': 'Skills',
  'tab.providers': 'Providers',

  'search.placeholder': 'Search skills…',
  'filter.installedOnly': 'Installed only',
  'provider.aria': 'Provider',
  'provider.all': 'All providers',

  'list.showing': 'Showing {shown} of {total} skills',
  'list.showMore': 'Show more skills',

  'card.add': 'Add',
  'card.manage': 'Manage',
  'card.update': 'Update',
  'card.installed': 'installed',
  'card.noDescription': 'No description',
  'card.detailsTitle': 'View {name}',

  'presence.everywhere': 'Everywhere',
  'presence.workspaces.one': '{count} workspace',
  'presence.workspaces.many': '{count} workspaces',
  'presence.off': 'Off',
  'presence.in': 'in {targets}',

  'badge.custom': 'custom',
  'badge.project': 'project',

  'modal.aria': 'Skill {name}',
  // The hint states the model: files install once, globally; the scope is
  // pure configuration and never writes into a project.
  'modal.hint': 'Skills install once, into your global skills directory; the scope only controls where they are enabled.',
  'modal.scope.global': 'Everywhere (default)',
  'modal.scope.workspaces': 'Only in selected workspaces',
  'modal.workspaces.empty': 'No workspaces registered yet.',
  'modal.workspaces.hint': 'The skill stays disabled outside the checked workspaces.',
  'modal.workspaceMissing': 'missing',
  'modal.update': 'Update',
  'modal.remove': 'Remove',
  'modal.confirmRemove': 'Confirm remove',
  'modal.save': 'Save',
  'modal.cancel': 'Cancel',

  'providers.placeholder': 'owner/repo or GitHub URL…',
  'providers.add': 'Add provider',
  'providers.refreshAll': 'Refresh all',
  'providers.remove': 'Remove',
  'providers.skillCount.one': '{count} skill',
  'providers.skillCount.many': '{count} skills',
  'providers.syncNever': 'never synced',
  'providers.justNow': 'synced just now',
  'providers.minutesAgo': 'synced {count} min ago',
  'providers.hoursAgo': 'synced {count} h ago',
  'providers.daysAgo': 'synced {count} d ago',
  'providers.hint': 'Providers are GitHub repositories with skill directories (a SKILL.md); syncing caches their files locally so installs work offline.',

  'empty.noProviders': 'No providers yet. Add a GitHub repository in the Providers tab to browse its skills.',
  'empty.noMatch': 'No skills match this search.',

  'detail.aria': 'Skill {name}',
  'detail.version': 'version {version}',
  'detail.from': 'from {provider}',
  'detail.notInstalled': 'not installed',
  'detail.modelInvocable': 'model invocable',
  'detail.modelBlocked': 'model blocked',
  'detail.userInvocable': 'user invocable',
  'detail.userBlocked': 'not user invocable',
  'detail.whenToUse': 'When to use: {text}',
  'detail.close': 'Close',

  'error.loadDetail': 'could not load the skill detail',

  'status.working': 'Working…',
}

/** Every dictionary key. */
export type MessageKey = keyof typeof en
